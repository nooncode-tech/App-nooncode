import type Stripe from 'stripe'
import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { getStripeClient } from '@/lib/server/stripe/client'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import type { Database, Json } from '@/lib/server/supabase/database.types'
import { activatePaidProposal } from '@/lib/server/payments/activation'
import { getSellerFeeByPaymentId, getSellerFeeByProposalId } from '@/lib/server/seller-fees/repository'
import { cancelSellerFee, confirmSellerFee } from '@/lib/server/seller-fees/service'
import {
  beginStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from '@/lib/server/stripe/webhook-events'

type SupabaseAdminClient = Awaited<ReturnType<typeof createSupabaseAdminClient>>
type MonetaryEntryType = Database['public']['Enums']['monetary_entry_type']
type WalletBalanceBucket = 'available_to_spend' | 'available_to_withdraw' | 'pending' | 'locked'

async function creditWalletBucket(
  client: SupabaseAdminClient,
  input: {
    profileId: string
    amount: number
    currency: string
    entryType: MonetaryEntryType
    balanceBucket: WalletBalanceBucket
    referenceType: string
    referenceId: string
    actorProfileId?: string | null
    metadata?: Json
    idempotencyKey: string
    createdAt?: string
  }
) {
  const { error } = await client.rpc('credit_wallet_bucket', {
    p_profile_id: input.profileId,
    p_amount: input.amount,
    p_currency: input.currency,
    p_entry_type: input.entryType,
    p_balance_bucket: input.balanceBucket,
    p_reference_type: input.referenceType,
    p_reference_id: input.referenceId,
    p_actor_profile_id: input.actorProfileId ?? null,
    p_metadata: input.metadata ?? {},
    p_idempotency_key: input.idempotencyKey,
    p_created_at: input.createdAt,
  })

  if (error) {
    throw new Error(`Failed to credit wallet: ${error.message}`)
  }
}

// Exported for unit testing in tests/server/api/webhooks/stripe-checkout-completed.test.ts.
// Next.js route runtime only treats the named exports POST / GET / etc. as
// route handlers, so an additional export here is safe.
//
// `eventCreatedAt` is `event.created` (Unix seconds) for the Stripe event
// that triggered this handler — i.e. when Stripe fired
// `checkout.session.completed`, which approximates the moment of payment.
// We use it instead of `session.created` (when the checkout session was
// originally created) because the session can be created days before the
// customer actually pays; using session.created made `paid_at` /
// `handoff_ready_at` reflect link-creation time instead of payment time
// (B1.3a observation §1, 2026-05-17). Falls back to server `now()` if the
// caller cannot supply a numeric event timestamp.
export async function handleCheckoutSessionCompleted(
  client: SupabaseAdminClient,
  session: Stripe.Checkout.Session,
  eventCreatedAt?: number,
) {
  const proposalId = session.metadata?.noon_proposal_id
  const paymentIdFromMetadata = session.metadata?.noon_payment_id

  if (!proposalId && !paymentIdFromMetadata) {
    return
  }

  let paymentQuery = client
    .from('payments')
    .select('id, amount, proposal_id, project_id')

  paymentQuery = paymentIdFromMetadata
    ? paymentQuery.eq('id', paymentIdFromMetadata)
    : paymentQuery.eq('stripe_checkout_session_id', session.id)

  const { data: paymentBeforeActivation, error: paymentLookupError } = await paymentQuery.maybeSingle()

  if (paymentLookupError) {
    throw new Error(`Failed to resolve payment: ${paymentLookupError.message}`)
  }

  if (!paymentBeforeActivation) {
    throw new Error('Payment record not found for completed checkout session.')
  }

  const paidAt =
    typeof eventCreatedAt === 'number'
      ? new Date(eventCreatedAt * 1000).toISOString()
      : new Date().toISOString()
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  const activation = await activatePaidProposal(client, {
    paymentId: paymentBeforeActivation.id,
    providerPaymentIntentId: paymentIntentId,
    paidAt,
    actorProfileId: session.metadata?.noon_actor_id ?? null,
    metadata: {
      stripeCheckoutSessionId: session.id,
      stripePaymentStatus: session.payment_status,
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
    },
  })

  const projectId = activation.project_id

  // Fetch proposal separately to avoid PostgREST join ambiguity.
  const { data: proposal } = await client
    .from('lead_proposals')
    .select('id, lead_id, amount')
    .eq('id', activation.proposal_id)
    .maybeSingle()

  if (!proposal) return

  // Fetch lead separately
  const { data: leadRow } = await client
    .from('leads')
    .select('lead_origin, assigned_to, created_by')
    .eq('id', proposal.lead_id)
    .maybeSingle()

  if (!leadRow) return

  const leadOrigin = leadRow.lead_origin as 'inbound' | 'outbound' | null
  const sellerId = leadRow.assigned_to ?? leadRow.created_by
  const activationAmount = Number(paymentBeforeActivation.amount)

  // Resolve the seller fee amount from the persisted seller_fees row (per
  // ADR-007 §rule 1). For outbound proposals, every row in lead_proposals
  // has a corresponding seller_fees row since B3 Chunk 5 closure 2026-05-12
  // (new proposals via the proposal API since Chunk 3a; legacy in-flight
  // proposals from before Chunk 3a were backfilled one-time at that date).
  // Hitting the !sellerFeeRow branch below indicates a data integrity
  // breach — likely a proposal created via a bypass path that did not
  // route through the proposal API. Surface loudly so it gets caught;
  // Stripe will retry the webhook, which is the correct recovery posture
  // for an unexpected integrity gap.
  let sellerFeeRow: Awaited<ReturnType<typeof getSellerFeeByProposalId>> = null

  if (leadOrigin === 'outbound') {
    sellerFeeRow = await getSellerFeeByProposalId(client, activation.proposal_id)
    if (!sellerFeeRow) {
      throw new Error(
        `seller_fees row missing for outbound proposal ${activation.proposal_id}. ` +
        `Every outbound proposal must have a seller_fees row since B3 Chunk 5. ` +
        `This indicates a data integrity breach worth escalating.`
      )
    }
  }

  const sellerFeeAmount = leadOrigin === 'outbound' && sellerFeeRow
    ? Number(sellerFeeRow.amount)
    : 0

  // Fetch developer from project if linked
  let developerUserId: string | null = null
  if (projectId) {
    const { data: project } = await client
      .from('projects')
      .select('developer_user_id')
      .eq('id', projectId)
      .maybeSingle()
    developerUserId = project?.developer_user_id ?? null
  }

  const earningRows: Array<{
    actor_id: string | null
    actor_role: 'seller' | 'developer' | 'noon'
    earning_type: 'activation'
    amount: number
    currency: string
    lead_id: string
    proposal_id: string
    payment_id: string
    idempotency_key: string
    notes: string
  }> = []

  const base = leadOrigin === 'outbound'
    ? Math.max(activationAmount - sellerFeeAmount, 0)
    : activationAmount

  // Seller commission - outbound only, persisted value from seller_fees.
  if (leadOrigin === 'outbound') {
    earningRows.push({
      actor_id: sellerId,
      actor_role: 'seller',
      earning_type: 'activation',
      amount: sellerFeeAmount,
      currency: 'USD',
      lead_id: proposal.lead_id,
      proposal_id: activation.proposal_id,
      payment_id: activation.payment_id,
      idempotency_key: `stripe:${session.id}:earning:seller:${sellerId}`,
      notes: `Outbound activation - $${sellerFeeAmount} (seller-selected)`,
    })
  }

  // Developer commission - 50% of base
  if (base > 0) {
    earningRows.push({
      actor_id: developerUserId,
      actor_role: 'developer',
      earning_type: 'activation',
      amount: parseFloat((base * 0.5).toFixed(2)),
      currency: 'USD',
      lead_id: proposal.lead_id,
      proposal_id: activation.proposal_id,
      payment_id: activation.payment_id,
      idempotency_key: `stripe:${session.id}:earning:developer:${developerUserId ?? 'unassigned'}`,
      notes: developerUserId
        ? `${leadOrigin === 'outbound' ? 'Outbound' : 'Inbound'} activation - 50% of base $${base}`
        : 'Developer not yet assigned - pending resolution',
    })

    // Noon share - 50% of base
    earningRows.push({
      actor_id: null,
      actor_role: 'noon',
      earning_type: 'activation',
      amount: parseFloat((base * 0.5).toFixed(2)),
      currency: 'USD',
      lead_id: proposal.lead_id,
      proposal_id: activation.proposal_id,
      payment_id: activation.payment_id,
      idempotency_key: `stripe:${session.id}:earning:noon`,
      notes: `${leadOrigin === 'outbound' ? 'Outbound' : 'Inbound'} activation - 50% of base $${base}`,
    })
  }

  if (earningRows.length > 0) {
    const { error: earningsError } = await client
      .from('earnings_ledger')
      .upsert(earningRows, { onConflict: 'idempotency_key', ignoreDuplicates: true })
    if (earningsError) throw new Error(`Failed to insert earnings: ${earningsError.message}`)

    // Credit each real actor's pending wallet balance through a transactional RPC.
    const creditedAt = new Date().toISOString()
    for (const row of earningRows) {
      if (!row.actor_id) continue

      await creditWalletBucket(client, {
        profileId: row.actor_id,
        amount: row.amount,
        currency: row.currency,
        entryType: 'earnings_distribution',
        balanceBucket: 'pending',
          referenceType: 'payment',
          referenceId: activation.payment_id,
          metadata: {
            earningType: 'activation',
            actorRole: row.actor_role,
            channel: leadOrigin ?? 'unknown',
            notes: row.notes,
            paymentId: activation.payment_id,
          },
        idempotencyKey: `stripe:${session.id}:wallet:${row.actor_role}:${row.actor_id}`,
        createdAt: creditedAt,
      })
    }
  }

  // Transition seller_fees state potential → confirmed. Idempotent for
  // webhook retries per ADR-007 §rule 11; the service short-circuits if
  // already confirmed for this payment_id. The `if (sellerFeeRow)` gate
  // skips this for inbound proposals (where sellerFeeRow stays null).
  // For outbound, sellerFeeRow is guaranteed non-null by the throw above.
  // Failures here are logged but do not fail the webhook: payment and
  // earnings are already processed at this point, and the activity log is
  // a secondary audit record.
  if (sellerFeeRow) {
    try {
      await confirmSellerFee(client, {
        proposalId: activation.proposal_id,
        paymentId: activation.payment_id,
      })
    } catch (error) {
      logger.error('Failed to transition seller_fees state to confirmed', {
        ...errorToLogContext(error),
        proposalId: activation.proposal_id,
        paymentId: activation.payment_id,
        sellerFeeId: sellerFeeRow.id,
        priorState: sellerFeeRow.state,
      })
    }
  }

  // Award points.
  if (sellerId) {
    await client.from('points_ledger').upsert({
      actor_id: sellerId,
      event_type: 'payment_received',
      points: 50,
      reference_id: activation.payment_id,
      idempotency_key: `stripe:${session.id}:points:payment_received:${sellerId}`,
      notes: `Pago confirmado - $${activationAmount} USD`,
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
  }
}

async function handleAccountUpdated(
  client: SupabaseAdminClient,
  account: Stripe.Account,
) {
  const profileId = account.metadata?.noon_profile_id
  if (!profileId) return

  const status = account.charges_enabled ? 'active' : account.details_submitted ? 'restricted' : 'pending'
  await client
    .from('user_profiles')
    .update({ stripe_connect_status: status })
    .eq('stripe_connect_account_id', account.id)

}

async function handleTransferPaid(
  client: SupabaseAdminClient,
  transfer: Stripe.Transfer,
) {
  const payoutId = transfer.metadata?.noon_payout_id ?? null
  const { error } = await client.rpc('complete_wallet_payout', {
    p_external_reference: transfer.id,
    p_payout_id: payoutId,
  })

  if (error) {
    throw new Error(`Failed to complete payout: ${error.message}`)
  }
}

async function handleTransferReversed(
  client: SupabaseAdminClient,
  transfer: Stripe.Transfer,
) {
  const payoutId = transfer.metadata?.noon_payout_id ?? null
  const { error } = await client.rpc('reverse_wallet_payout_by_transfer', {
    p_external_reference: transfer.id,
    p_payout_id: payoutId,
  })

  if (error) {
    throw new Error(`Failed to reverse payout: ${error.message}`)
  }
}

async function handlePaymentIntentFailed(
  client: SupabaseAdminClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  await client
    .from('payments')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id)
}

async function handleChargeRefunded(
  client: SupabaseAdminClient,
  charge: Stripe.Charge,
) {
  const paymentIntentId = charge.payment_intent as string
  if (!paymentIntentId) return

  // Load payment row first so we have the full context for downstream
  // reversal (seller_fees, earnings_ledger).
  const { data: payment } = await client
    .from('payments')
    .select('id, project_id, proposal_id, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (!payment) {
    logger.warn('stripe.charge_refunded.payment_not_found', {
      paymentIntentId,
      chargeId: charge.id,
    })
    return
  }

  // 1. Mark payment refunded (idempotent — repeats just rewrite the timestamp)
  await client
    .from('payments')
    .update({ status: 'refunded', refunded_at: new Date().toISOString() })
    .eq('id', payment.id)

  // 2. Pause related project (existing behavior)
  if (payment.project_id) {
    await client
      .from('projects')
      .update({ payment_activated: false, status: 'backlog' })
      .eq('id', payment.project_id)
  }

  // 3. Cancel seller_fees row if present (B3 state machine reversal).
  //    Uses cancelSellerFee service which is idempotent (returns early if
  //    already cancelled) and enforces ADR-007 §Hard rule 3 (forbids
  //    auto-cancel from paid_out) + Hard rule 4 (rejects pending_payout
  //    pending future implementation). Either of those guards will throw,
  //    which we catch and log — refund payment + project reversal stay
  //    committed, and the operator gets an actionable error to escalate.
  const sellerFee = await getSellerFeeByPaymentId(client, payment.id)
  if (sellerFee && sellerFee.state !== 'cancelled') {
    try {
      await cancelSellerFee(client, {
        sellerFeeId: sellerFee.id,
        reason: `refund:${charge.id}`,
        actorProfileId: null,
      })
    } catch (error) {
      logger.error('stripe.charge_refunded.seller_fee_cancel_failed', {
        ...errorToLogContext(error),
        sellerFeeId: sellerFee.id,
        priorState: sellerFee.state,
        paymentId: payment.id,
        chargeId: charge.id,
      })
    }
  }

  // 4. Reverse earnings_ledger entries by marking them status='cancelled'.
  //    The original DB-level CHECK constraint forbids negative amounts on
  //    earnings_ledger (earnings_ledger_amount_check), so we cannot insert
  //    mirror rows. Using the existing 'cancelled' enum value is the
  //    semantically correct reversal — it matches how seller_fees handles
  //    refund-driven cancellation and keeps amounts positive. The update
  //    is idempotent: rows already cancelled (e.g., from a previous
  //    invocation of this handler) are filtered out via .neq('status',
  //    'cancelled'), so Stripe webhook retries do not double-process.
  //
  //    Notes column captures the refund linkage for audit (charge id +
  //    timestamp). The original credited_at timestamp stays untouched —
  //    we only flip status and append a refund-note.
  const { error: cancellationError } = await client
    .from('earnings_ledger')
    .update({
      status: 'cancelled',
      notes: `Cancelled by refund (charge ${charge.id})`,
    })
    .eq('payment_id', payment.id)
    .neq('status', 'cancelled')

  if (cancellationError) {
    throw new Error(
      `Failed to cancel earnings_ledger rows on refund: ${cancellationError.message}`
    )
  }

  // Wallet credit reversal (debiting `pending` bucket) is intentionally
  // out of scope of this iteration — it requires a `debit_wallet_bucket`
  // RPC that doesn't exist yet. Seller's `pending` balance retains the
  // original credit; no financial harm because `pending` is not
  // withdrawable until admin consolidates to `available_to_withdraw`.
  // Tracked as follow-up; admin can manually adjust if needed.
}

export async function POST(request: Request) {
  const requestId = getRequestId(request)
  let client: SupabaseAdminClient | null = null
  let event: Stripe.Event | null = null

  try {
    await assertRateLimit(request, {
      namespace: 'stripe-webhook',
      limit: 600,
      windowMs: 60_000,
    })

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

    if (!webhookSecret) {
      return jsonWithRequestId({ error: 'Webhook secret not configured' }, { status: 500 }, requestId)
    }

    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return jsonWithRequestId({ error: 'Missing stripe-signature header' }, { status: 400 }, requestId)
    }

    const stripe = getStripeClient()

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch {
      return jsonWithRequestId({ error: 'Invalid webhook signature' }, { status: 400 }, requestId)
    }

    client = await createSupabaseAdminClient()
    const ledger = await beginStripeWebhookEvent(client, event)

    if (!ledger.shouldProcess) {
      logger.info('stripe.webhook.duplicate_ignored', {
        requestId,
        eventId: event.id,
        eventType: event.type,
      })

      return jsonWithRequestId({ received: true, duplicate: true }, undefined, requestId)
    }

    const eventType = event.type as string

    try {
      switch (eventType) {
        case 'checkout.session.completed':
          await handleCheckoutSessionCompleted(
            client,
            event.data.object as Stripe.Checkout.Session,
            event.created,
          )
          break
        case 'payment_intent.payment_failed':
          await handlePaymentIntentFailed(client, event.data.object as Stripe.PaymentIntent)
          break
        case 'charge.refunded':
          await handleChargeRefunded(client, event.data.object as Stripe.Charge)
          break
        case 'account.updated':
          await handleAccountUpdated(client, event.data.object as Stripe.Account)
          break
        case 'transfer.paid':
          await handleTransferPaid(client, event.data.object as Stripe.Transfer)
          break
        case 'transfer.reversed':
          await handleTransferReversed(client, event.data.object as Stripe.Transfer)
          break
      }

      await markStripeWebhookEventProcessed(client, event.id)
      logger.info('stripe.webhook.processed', {
        requestId,
        eventId: event.id,
        eventType,
      })
    } catch (error) {
      await markStripeWebhookEventFailed(client, event.id, error)
      throw error
    }
  } catch (error) {
    logger.error('stripe.webhook.failed', {
      requestId,
      eventId: event?.id ?? null,
      eventType: event?.type ?? null,
      ...errorToLogContext(error),
    })
    return toErrorResponse(error, { requestId })
  }

  return jsonWithRequestId({ received: true }, undefined, requestId)
}
