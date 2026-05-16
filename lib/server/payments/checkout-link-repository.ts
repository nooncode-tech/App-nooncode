import type { SupabaseClient } from '@supabase/supabase-js'

export interface ActiveCheckoutLinkRow {
  proposalId: string
  url: string
  sessionId: string
  expiresAt: string
}

/**
 * Returns the most recent pending payment per proposal id that has a
 * persisted Stripe Checkout URL. Used by the proposal read enrichment so
 * `components/lead-detail.tsx` can render the four-state UI (none / active /
 * expired / paid) without an extra Stripe API round-trip on mount.
 *
 * Pending rows that pre-date migration 0045 still have a null URL — those
 * rows are excluded here and the UI falls back to the "Crear link de pago"
 * branch, which re-runs `createCheckoutSession` (idempotent against the
 * still-open Stripe session) and back-fills the columns on first click.
 */
export async function listActiveCheckoutLinksByProposalIds(
  client: SupabaseClient,
  proposalIds: readonly string[],
): Promise<Map<string, ActiveCheckoutLinkRow>> {
  const result = new Map<string, ActiveCheckoutLinkRow>()
  if (proposalIds.length === 0) {
    return result
  }

  const { data, error } = await client
    .from('payments')
    .select('proposal_id, stripe_checkout_session_id, stripe_checkout_url, stripe_checkout_expires_at, created_at')
    .in('proposal_id', proposalIds as string[])
    .eq('status', 'pending')
    .not('stripe_checkout_url', 'is', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load active checkout links: ${error.message}`)
  }

  for (const row of data ?? []) {
    const proposalId = row.proposal_id as string | null
    const url = row.stripe_checkout_url as string | null
    const sessionId = row.stripe_checkout_session_id as string | null
    const expiresAt = row.stripe_checkout_expires_at as string | null

    if (!proposalId || !url || !sessionId || !expiresAt) {
      continue
    }
    if (result.has(proposalId)) {
      continue
    }

    result.set(proposalId, {
      proposalId,
      url,
      sessionId,
      expiresAt,
    })
  }

  return result
}
