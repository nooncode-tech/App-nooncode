import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { toErrorResponse } from '@/lib/server/api/errors'
import { getStripeClient } from '@/lib/server/stripe/client'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'

async function handleCheckoutSessionCompleted(
  client: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  session: Stripe.Checkout.Session,
) {
  const proposalId = session.metadata?.noon_proposal_id
  const projectId = session.metadata?.noon_project_id || null

  console.log('[webhook] checkout.session.completed — proposalId:', proposalId, 'sessionId:', session.id)

  if (!proposalId) {
    console.log('[webhook] no proposalId in metadata — skipping')
    return
  }

  const now = new Date().toISOString()

  // Mark payment as succeeded and retrieve its DB id
  const { data: payment } = await client
    .from('payments')
    .update({
      stripe_payment_intent_id: session.payment_intent as string,
      status: 'succeeded',
      paid_at: now,
    })
    .eq('stripe_checkout_session_id', session.id)
    .select('id, amount')
    .maybeSingle()

  console.log('[webhook] payment lookup result:', payment ? `id=${payment.id} amount=${payment.amount}` : 'NULL — no matching payment row')

  // Update proposal payment status
  await client
    .from('lead_proposals')
    .update({ payment_status: 'succeeded', paid_at: now })
    .eq('id', proposalId)

  // Activate project if linked
  if (projectId) {
    await client
      .from('projects')
      .update({
        payment_activated: true,
        payment_activated_at: now,
        status: 'in_progress',
      })
      .eq('id', projectId)
      .eq('payment_activated', false)
  }

  // ── Credit earnings ────────────────────────────────────────────────────────
  if (!payment) {
    console.log('[webhook] payment is null — skipping earnings')
    return
  }

  // Fetch proposal (two separate queries — avoids PostgREST join ambiguity)
  const { data: proposal } = await client
    .from('lead_proposals')
    .select('id, lead_id, amount')
    .eq('id', proposalId)
    .maybeSingle()

  console.log('[webhook] proposal lookup:', proposal ? `found lead_id=${proposal.lead_id}` : 'NOT FOUND')

  if (!proposal) return

  // Fetch lead separately
  const { data: leadRow } = await client
    .from('leads')
    .select('lead_origin, assigned_to, created_by')
    .eq('id', proposal.lead_id)
    .maybeSingle()

  console.log('[webhook] lead lookup:', leadRow ? `origin=${leadRow.lead_origin} assigned=${leadRow.assigned_to}` : 'NULL')

  if (!leadRow) return

  const leadOrigin = leadRow.lead_origin as 'inbound' | 'outbound' | null
  const sellerId = leadRow.assigned_to ?? leadRow.created_by
  const activationAmount = Number(payment.amount)

  console.log('[webhook] lead_origin:', leadOrigin, '| sellerId:', sellerId, '| amount:', activationAmount)

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
    notes: string
  }> = []

  const base = leadOrigin === 'outbound'
    ? Math.max(activationAmount - 100, 0)
    : activationAmount

  // Seller commission — outbound only, $100 fixed
  if (leadOrigin === 'outbound') {
    earningRows.push({
      actor_id: sellerId,
      actor_role: 'seller',
      earning_type: 'activation',
      amount: 100,
      currency: 'USD',
      lead_id: proposal.lead_id,
      proposal_id: proposalId,
      payment_id: payment.id,
      notes: 'Outbound activation — $100 fixed',
    })
  }

  // Developer commission — 50% of base
  if (base > 0) {
    earningRows.push({
      actor_id: developerUserId,
      actor_role: 'developer',
      earning_type: 'activation',
      amount: parseFloat((base * 0.5).toFixed(2)),
      currency: 'USD',
      lead_id: proposal.lead_id,
      proposal_id: proposalId,
      payment_id: payment.id,
      notes: developerUserId
        ? `${leadOrigin === 'outbound' ? 'Outbound' : 'Inbound'} activation — 50% of base $${base}`
        : 'Developer not yet assigned — pending resolution',
    })

    // Noon share — 50% of base
    earningRows.push({
      actor_id: null,
      actor_role: 'noon',
      earning_type: 'activation',
      amount: parseFloat((base * 0.5).toFixed(2)),
      currency: 'USD',
      lead_id: proposal.lead_id,
      proposal_id: proposalId,
      payment_id: payment.id,
      notes: `${leadOrigin === 'outbound' ? 'Outbound' : 'Inbound'} activation — 50% of base $${base}`,
    })
  }

  console.log('[webhook] earningRows to insert:', JSON.stringify(earningRows))

  if (earningRows.length > 0) {
    const { error: earningsError } = await client.from('earnings_ledger').insert(earningRows)
    if (earningsError) throw new Error(`Failed to insert earnings: ${earningsError.message}`)
    console.log('[webhook] earnings inserted successfully')

    // ── Credit monetary wallet (wallet_accounts + wallet_ledger_entries) ──────
    // For each actor with a real user ID, also credit their pending bucket
    const creditedAt = new Date().toISOString()
    for (const row of earningRows) {
      if (!row.actor_id) continue // skip Noon's share

      // Upsert wallet_accounts and increment pending
      await client
        .from('wallet_accounts' as never)
        .upsert({ profile_id: row.actor_id, pending: row.amount }, { onConflict: 'profile_id' })

      // If account already exists, add to pending via update
      await client
        .from('wallet_accounts' as never)
        .update({ pending: row.amount, updated_at: creditedAt } as never)
        .eq('profile_id', row.actor_id)

      await client.from('wallet_ledger_entries' as never).insert({
        profile_id: row.actor_id,
        amount: row.amount,
        currency: row.currency,
        entry_type: 'earnings_distribution',
        balance_bucket: 'pending',
        status: 'confirmed',
        reference_type: 'payment',
        reference_id: payment.id,
        actor_profile_id: null,
        metadata: {
          earningType: 'activation',
          channel: leadOrigin ?? 'unknown',
          notes: row.notes,
          paymentId: payment.id,
        },
        created_at: creditedAt,
      } as never)
    }
    console.log('[webhook] wallet_accounts credited successfully')
  } else {
    console.log('[webhook] no earning rows to insert')
  }

  // ── Award points ────────────────────────────────────────────────────────────
  if (sellerId) {
    await client.from('points_ledger').insert({
      actor_id: sellerId,
      event_type: 'payment_received',
      points: 50,
      reference_id: payment.id,
      notes: `Pago confirmado — $${activationAmount} USD`,
    })
  }
}

async function handleAccountUpdated(
  client: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  account: Stripe.Account,
) {
  const profileId = account.metadata?.noon_profile_id
  if (!profileId) return

  const status = account.charges_enabled ? 'active' : account.details_submitted ? 'restricted' : 'pending'
  await client
    .from('user_profiles' as never)
    .update({ stripe_connect_status: status } as never)
    .eq('stripe_connect_account_id', account.id)

  console.log('[webhook] account.updated — profileId:', profileId, 'status:', status)
}

async function handleTransferPaid(
  client: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  transfer: Stripe.Transfer,
) {
  await client
    .from('payouts' as never)
    .update({ status: 'completed', updated_at: new Date().toISOString() } as never)
    .eq('external_reference', transfer.id)

  // Also mark payout_batch as completed if all payouts in batch are done
  const { data: payout } = await client
    .from('payouts' as never)
    .select('batch_id')
    .eq('external_reference', transfer.id)
    .maybeSingle() as { data: { batch_id: string } | null }

  if (payout?.batch_id) {
    const { data: pending } = await client
      .from('payouts' as never)
      .select('id')
      .eq('batch_id', payout.batch_id)
      .neq('status', 'completed') as { data: { id: string }[] | null }

    if (!pending || pending.length === 0) {
      await client
        .from('payout_batches' as never)
        .update({ status: 'completed', updated_at: new Date().toISOString() } as never)
        .eq('id', payout.batch_id)
    }
  }
}

async function handleTransferReversed(
  client: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  transfer: Stripe.Transfer,
) {
  const now = new Date().toISOString()

  const { data: payoutRow } = await client
    .from('payouts' as never)
    .select('id, profile_id, amount, currency, batch_id')
    .eq('external_reference', transfer.id)
    .maybeSingle() as { data: { id: string; profile_id: string; amount: number; currency: string; batch_id: string } | null }

  if (!payoutRow) return

  await client
    .from('payouts' as never)
    .update({ status: 'failed', updated_at: now } as never)
    .eq('id', payoutRow.id)

  // Re-credit wallet
  await client
    .from('wallet_accounts' as never)
    .update({
      available_to_withdraw: payoutRow.amount,
      updated_at: now,
    } as never)
    .eq('profile_id', payoutRow.profile_id)

  await client.from('wallet_ledger_entries' as never).insert({
    profile_id: payoutRow.profile_id,
    amount: payoutRow.amount,
    currency: payoutRow.currency,
    entry_type: 'payout_reversal',
    balance_bucket: 'available_to_withdraw',
    status: 'confirmed',
    reference_type: 'payout',
    reference_id: payoutRow.id,
    actor_profile_id: null,
    metadata: { transferId: transfer.id },
    created_at: now,
  } as never)

  console.log('[webhook] transfer.reversed — payoutId:', payoutRow.id, 'amount re-credited')
}

async function handlePaymentIntentFailed(
  client: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
  paymentIntent: Stripe.PaymentIntent,
) {
  await client
    .from('payments')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id)
}

async function handleChargeRefunded(
  client: Awaited<ReturnType<typeof createSupabaseAdminClient>>,
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

    switch (event.type) {
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
