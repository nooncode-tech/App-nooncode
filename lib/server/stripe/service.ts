import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from './client'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'

export async function getOrCreateStripeCustomer(
  client: SupabaseClient,
  leadId: string,
  clientName: string,
  clientEmail: string | null,
): Promise<string> {
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

  await client.from('stripe_customers').insert({
    lead_id: leadId,
    stripe_customer_id: customer.id,
    email: clientEmail,
    name: clientName,
  })

  return customer.id
}

export async function createCheckoutSession(
  client: SupabaseClient,
  principal: AuthenticatedPrincipal,
  params: {
    proposalId: string
    leadId: string
    projectId: string | null
    amount: number
    currency: string
    clientName: string
    clientEmail: string | null
    proposalTitle: string
  },
  appUrl: string,
): Promise<{ url: string; paymentId: string }> {
  const stripeCustomerId = await getOrCreateStripeCustomer(
    client,
    params.leadId,
    params.clientName,
    params.clientEmail,
  )

  const amountInCents = Math.round(params.amount * 100)

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
    success_url: `${appUrl}/dashboard/leads?leadId=${params.leadId}&payment=success`,
    cancel_url: `${appUrl}/dashboard/leads?leadId=${params.leadId}&payment=cancelled`,
    metadata: {
      noon_proposal_id: params.proposalId,
      noon_lead_id: params.leadId,
      noon_project_id: params.projectId ?? '',
      noon_actor_id: principal.profile.id,
    },
  })

  const { data: payment, error } = await client
    .from('payments')
    .insert({
      proposal_id: params.proposalId,
      project_id: params.projectId,
      stripe_customer_id: stripeCustomerId,
      stripe_checkout_session_id: session.id,
      payment_type: 'full_project',
      amount: params.amount,
      currency: params.currency,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !payment) {
    throw new Error('Failed to create payment record')
  }

  return { url: session.url!, paymentId: payment.id }
}
