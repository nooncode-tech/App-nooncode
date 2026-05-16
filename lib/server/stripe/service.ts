import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripeClient } from './client'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import { ApiError, ConflictApiError } from '@/lib/server/api/errors'

export async function getOrCreateStripeCustomer(
  client: SupabaseClient,
  leadId: string,
  clientName: string,
  clientEmail: string | null,
): Promise<string> {
  const stripe = getStripeClient()
  const { data: existing } = await client
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('lead_id', leadId)
    .maybeSingle()

  if (existing?.stripe_customer_id) return existing.stripe_customer_id

  const customer = await stripe.customers.create({
    name: clientName,
    email: clientEmail ?? undefined,
    metadata: { noon_lead_id: leadId },
  })

  const { error } = await client.from('stripe_customers').insert({
    lead_id: leadId,
    stripe_customer_id: customer.id,
    email: clientEmail,
    name: clientName,
  })

  if (error) {
    const { data: racedCustomer } = await client
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('lead_id', leadId)
      .maybeSingle()

    if (racedCustomer?.stripe_customer_id) return racedCustomer.stripe_customer_id

    throw new Error(`Failed to store Stripe customer: ${error.message}`)
  }

  return customer.id
}

export async function createCheckoutSession(
  client: SupabaseClient,
  principal: AuthenticatedPrincipal,
  params: {
    proposalId: string
    leadId: string
    amount: number
    currency: string
    clientName: string
    clientEmail: string | null
    proposalTitle: string
  },
  appUrl: string,
): Promise<{ url: string; paymentId: string; checkoutSessionId: string; expiresAt: string }> {
  const stripe = getStripeClient()
  const stripeCustomerId = await getOrCreateStripeCustomer(
    client,
    params.leadId,
    params.clientName,
    params.clientEmail,
  )

  const amountInCents = Math.round(params.amount * 100)

  const { data: existingSucceeded, error: succeededLookupError } = await client
    .from('payments')
    .select('id')
    .eq('proposal_id', params.proposalId)
    .eq('status', 'succeeded')
    .maybeSingle()

  if (succeededLookupError) {
    throw new Error(`Failed to verify payment state: ${succeededLookupError.message}`)
  }

  if (existingSucceeded) {
    throw new ConflictApiError('This proposal has already been paid.', 'PROPOSAL_ALREADY_PAID')
  }

  const { data: existingPending, error: pendingLookupError } = await client
    .from('payments')
    .select('id, stripe_checkout_session_id, stripe_checkout_url, stripe_checkout_expires_at')
    .eq('proposal_id', params.proposalId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (pendingLookupError) {
    throw new Error(`Failed to verify pending payment state: ${pendingLookupError.message}`)
  }

  if (existingPending?.stripe_checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(existingPending.stripe_checkout_session_id)

    if (session.status === 'open' && session.url) {
      const expiresAtIso = session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : existingPending.stripe_checkout_expires_at ?? null

      // Backfill legacy rows that have a session id but no persisted URL/expiry
      // the first time the operator clicks the button on them.
      if (
        !existingPending.stripe_checkout_url ||
        !existingPending.stripe_checkout_expires_at
      ) {
        await client
          .from('payments')
          .update({
            stripe_checkout_url: session.url,
            stripe_checkout_expires_at: expiresAtIso,
          })
          .eq('id', existingPending.id)
      }

      if (!expiresAtIso) {
        throw new Error('Stripe did not return an expiration for the reused checkout session.')
      }

      return {
        url: session.url,
        paymentId: existingPending.id,
        checkoutSessionId: session.id,
        expiresAt: expiresAtIso,
      }
    }

    await client
      .from('payments')
      .update({
        status: 'failed',
        metadata: {
          checkoutSessionStatus: session.status,
          replacedByNewCheckout: true,
        },
      })
      .eq('id', existingPending.id)
  }

  const paymentId = existingPending?.stripe_checkout_session_id
    ? null
    : existingPending?.id ?? null

  let pendingPaymentId = paymentId

  if (!pendingPaymentId) {
    const { data: payment, error: paymentError } = await client
      .from('payments')
      .insert({
        proposal_id: params.proposalId,
        project_id: null,
        stripe_customer_id: stripeCustomerId,
        payment_type: 'full_project',
        amount: params.amount,
        currency: params.currency,
        status: 'pending',
        metadata: {
          source: 'outbound',
          actorProfileId: principal.profile.id,
          actorRole: principal.role,
        },
      })
      .select('id')
      .single()

    if (paymentError || !payment) {
      throw new Error(`Failed to create payment record: ${paymentError?.message ?? 'No payment returned.'}`)
    }

    pendingPaymentId = payment.id
  }

  if (!pendingPaymentId) {
    throw new ApiError('PAYMENT_RECORD_NOT_READY', 'Payment record could not be prepared.', 500)
  }

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: params.currency.toLowerCase(),
          product_data: {
            name: params.proposalTitle,
            metadata: { noon_proposal_id: params.proposalId },
          },
          unit_amount: amountInCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: `${appUrl}/payment/success?paymentId=${pendingPaymentId}`,
    cancel_url: `${appUrl}/payment/cancel?paymentId=${pendingPaymentId}`,
    metadata: {
      noon_payment_id: pendingPaymentId,
      noon_proposal_id: params.proposalId,
      noon_lead_id: params.leadId,
      noon_actor_id: principal.profile.id,
      noon_source: 'outbound',
    },
  }, {
    idempotencyKey: `checkout:${pendingPaymentId}`,
  })

  const expiresAtIso = session.expires_at
    ? new Date(session.expires_at * 1000).toISOString()
    : null

  const { error } = await client
    .from('payments')
    .update({
      stripe_checkout_session_id: session.id,
      stripe_checkout_url: session.url,
      stripe_checkout_expires_at: expiresAtIso,
      metadata: {
        source: 'outbound',
        actorProfileId: principal.profile.id,
        actorRole: principal.role,
        checkoutSessionId: session.id,
        checkoutCreatedAt: new Date().toISOString(),
      },
    })
    .eq('id', pendingPaymentId)

  if (error) {
    try {
      await stripe.checkout.sessions.expire(session.id)
    } catch {
      // Stripe may reject expiration if the session already changed state.
    }

    throw new Error(`Failed to attach checkout session to payment: ${error.message}`)
  }

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL.')
  }

  if (!expiresAtIso) {
    throw new Error('Stripe did not return an expiration for the checkout session.')
  }

  return {
    url: session.url,
    paymentId: pendingPaymentId,
    checkoutSessionId: session.id,
    expiresAt: expiresAtIso,
  }
}
