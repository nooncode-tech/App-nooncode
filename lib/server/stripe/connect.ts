import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from './client'

export async function getOrCreateConnectAccount(
  client: SupabaseClient,
  profileId: string,
  email: string,
): Promise<string> {
  const { data: profile } = await client
    .from('user_profiles' as never)
    .select('stripe_connect_account_id')
    .eq('id', profileId)
    .maybeSingle() as { data: { stripe_connect_account_id: string | null } | null }

  if (profile?.stripe_connect_account_id) return profile.stripe_connect_account_id

  const account = await stripe.accounts.create({
    type: 'express',
    email,
    capabilities: { transfers: { requested: true } },
    metadata: { noon_profile_id: profileId },
  })

  await client
    .from('user_profiles' as never)
    .update({ stripe_connect_account_id: account.id, stripe_connect_status: 'pending' } as never)
    .eq('id', profileId)

  return account.id
}

export async function createOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: returnUrl,
    refresh_url: refreshUrl,
  })
  return link.url
}

export async function getConnectAccountDetails(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId)
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
    status: account.charges_enabled ? 'active' : account.details_submitted ? 'restricted' : 'pending',
  }
}

export async function createTransfer(
  destinationAccountId: string,
  amountCents: number,
  currency: string,
  metadata: Record<string, string>,
): Promise<string> {
  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: currency.toLowerCase(),
    destination: destinationAccountId,
    metadata,
  })
  return transfer.id
}
