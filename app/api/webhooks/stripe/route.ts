import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/server/stripe/client'
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
  } else {
    console.log('[webhook] no earning rows to insert')
  }

  // ── Award points ────────────────────────────────────────────────────────────
  // Seller gets 50 pts on every confirmed payment (outbound or inbound)
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
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 })
  }

  const client = await createSupabaseAdminClient()

  try {
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
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
