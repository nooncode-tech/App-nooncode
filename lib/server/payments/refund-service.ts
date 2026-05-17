// Path D — admin-driven refund of an outbound payment.
//
// Triggers a Stripe refund via the SDK. Idempotent at the Stripe level
// (uses payment id as idempotency key). The DB-side reversal of the
// payment row + seller_fees state + earnings_ledger entries happens
// asynchronously via the `charge.refunded` webhook handler in
// `app/api/webhooks/stripe/route.ts` — that handler is the single
// source of reversal so manual Dashboard refunds and admin-endpoint
// refunds produce identical state transitions.
//
// Wallet credit reversal is intentionally out of scope of this iteration.
// The seller's `pending` bucket retains the original credit until either
// a future RPC `debit_wallet_bucket` lands or admin manually adjusts.
// No financial harm because `pending` is not withdrawable until
// admin consolidates to `available_to_withdraw`.

import type Stripe from 'stripe'
import {
  ApiError,
  ConflictApiError,
  NotFoundApiError,
} from '@/lib/server/api/errors'
import { getStripeClient } from '@/lib/server/stripe/client'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'

type SupabaseAdminClient = Awaited<ReturnType<typeof createSupabaseAdminClient>>

export interface RefundResult {
  paymentId: string
  refundId: string
  refundStatus: Stripe.Refund.Status | null
  paymentIntentId: string
}

export interface TriggerRefundInput {
  paymentId: string
  actorProfileId: string
}

export async function triggerRefund(
  client: SupabaseAdminClient,
  input: TriggerRefundInput
): Promise<RefundResult> {
  const { data: payment, error } = await client
    .from('payments')
    .select('id, status, stripe_payment_intent_id, amount')
    .eq('id', input.paymentId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load payment: ${error.message}`)
  }

  if (!payment) {
    throw new NotFoundApiError('Payment not found.')
  }

  if (payment.status === 'refunded') {
    throw new ConflictApiError(
      'Payment has already been refunded.',
      'PAYMENT_ALREADY_REFUNDED'
    )
  }

  if (payment.status !== 'succeeded') {
    throw new ApiError(
      'PAYMENT_NOT_REFUNDABLE',
      `Cannot refund payment in status '${payment.status}'. Only 'succeeded' payments can be refunded via this endpoint.`,
      422
    )
  }

  if (!payment.stripe_payment_intent_id) {
    throw new ApiError(
      'PAYMENT_MISSING_INTENT',
      'Payment has no Stripe payment_intent_id; cannot refund via Stripe SDK.',
      422
    )
  }

  const stripe = getStripeClient()

  let refund: Stripe.Refund
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        reason: 'requested_by_customer',
        metadata: {
          noon_payment_id: payment.id,
          noon_actor_id: input.actorProfileId,
          noon_refund_source: 'admin_endpoint',
        },
      },
      { idempotencyKey: `noon-refund-${payment.id}` }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Stripe refund failed: ${message}`)
  }

  return {
    paymentId: payment.id,
    refundId: refund.id,
    refundStatus: refund.status,
    paymentIntentId: payment.stripe_payment_intent_id,
  }
}
