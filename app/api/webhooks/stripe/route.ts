import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { toErrorResponse } from '@/lib/server/api/errors'
import { getStripeClient } from '@/lib/server/stripe/client'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import type { Database, Json } from '@/lib/server/supabase/database.types'
import { activatePaidProposal } from '@/lib/server/payments/activation'

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

async function handleCheckoutSessionCompleted(
  client: SupabaseAdminClient,
  session: Stripe.Checkout.Session,
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
    typeof session.created === 'number'
      ? new Date(session.created * 1000).toISOString()
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
    ? Math.max(activationAmount - 100, 0)
    : activationAmount

  // Seller commission - outbound only, $100 fixed
  if (leadOrigin === 'outbound') {
    earningRows.push({
      actor_id: sellerId,
      actor_role: 'seller',
      earning_type: 'activation',
      amount: 100,
      currency: 'USD',
      lead_id: proposal.lead_id,
      proposal_id: activation.proposal_id,
      payment_id: activation.payment_id,
      idempotency_key: `stripe:${session.id}:earning:seller:${sellerId}`,
      notes: 'Outbound activation - $100 fixed',
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
    .from('user_profiles' as never)
    .update({ stripe_connect_status: status } as never)
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

  await client
    .from('payments')
    .update({ status: 'refunded', refunded_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', paymentIntentId)

  // Find and pause related project
  const { data: payment } = await client
    .from('payments')
    .select('project_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (payment?.project_id) {
    await client
      .from('projects')
      .update({ payment_activated: false, status: 'backlog' })
      .eq('id', payment.project_id)
  }
}

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

    if (!webhookSecret) {
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
    }

    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
    }

    const stripe = getStripeClient()
    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
    }

    const client = await createSupabaseAdminClient()

    const eventType = event.type as string

    switch (eventType) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(client, event.data.object as Stripe.Checkout.Session)
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
  } catch (error) {
    return toErrorResponse(error)
  }

  return NextResponse.json({ received: true })
}
