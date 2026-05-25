import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '@/lib/server/api/errors'
import type { Database } from '@/lib/server/supabase/database.types'

// Wrapper for the `consolidate_payment_earnings` RPC defined in migration
// 0048_phase_19b_consolidate_earnings_rpc.sql (per ADR-015). The RPC is
// the atomic primitive that transitions seller_fees.state from
// `confirmed` to `pending_payout` and moves all actor wallet entries
// for the payment from the `pending` bucket to `available_to_withdraw`
// in a single Postgres transaction with row locking.
//
// Re-invocation on an already-consolidated payment is a no-op and
// returns `actors_consolidated: 0`. This is the idempotency contract
// for the Vercel cron and the manual admin endpoint.

type DatabaseClient = SupabaseClient<Database>

export type SellerFeeState = Database['public']['Enums']['seller_fee_state']

export interface ConsolidatePaymentEarningsResult {
  paymentId: string
  sellerFeeId: string
  priorState: SellerFeeState
  newState: SellerFeeState
  actorsConsolidated: number
  amountConsolidated: number
}

function mapRpcError(error: { message?: string } | null): Error {
  const message = error?.message ?? 'Earnings consolidation failed.'
  if (message.includes('PAYMENT_ID_REQUIRED')) {
    return new ApiError('PAYMENT_ID_REQUIRED', 'Payment ID is required to consolidate.', 422)
  }
  if (message.includes('SELLER_FEE_NOT_FOUND_FOR_PAYMENT')) {
    return new ApiError(
      'SELLER_FEE_NOT_FOUND_FOR_PAYMENT',
      'No seller_fees row exists for this payment.',
      404,
    )
  }
  return new Error(message)
}

export async function consolidateEarningsForPayment(
  adminClient: DatabaseClient,
  input: { paymentId: string; actorProfileId?: string | null },
): Promise<ConsolidatePaymentEarningsResult> {
  const { data, error } = await adminClient.rpc('consolidate_payment_earnings', {
    p_payment_id: input.paymentId,
    p_actor_profile_id: input.actorProfileId ?? undefined,
  })

  if (error) {
    throw mapRpcError(error)
  }

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error('CONSOLIDATION_RETURNED_NO_DATA')
  }

  return {
    paymentId: row.payment_id,
    sellerFeeId: row.seller_fee_id,
    priorState: row.prior_state,
    newState: row.new_state,
    actorsConsolidated: row.actors_consolidated,
    amountConsolidated: Number(row.amount_consolidated),
  }
}
