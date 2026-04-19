import type { SupabaseClient } from '@supabase/supabase-js'

export async function createWithdrawalRequest(
  client: SupabaseClient,
  actorId: string,
  amount: number,
  currency: string,
  notes: string | null,
) {
  const { data, error } = await client
    .from('withdrawal_requests')
    .insert({ actor_id: actorId, amount, currency, notes })
    .select('id, amount, currency, status, requested_at')
    .single()

  if (error) throw new Error(`Failed to create withdrawal request: ${error.message}`)
  return data
}

export async function listWithdrawalRequestsForActor(
  client: SupabaseClient,
  actorId: string,
) {
  const { data, error } = await client
    .from('withdrawal_requests')
    .select('id, amount, currency, status, notes, requested_at, processed_at')
    .eq('actor_id', actorId)
    .order('requested_at', { ascending: false })

  if (error) throw new Error(`Failed to list withdrawal requests: ${error.message}`)
  return data ?? []
}

export async function getPendingWithdrawableBalance(
  client: SupabaseClient,
  actorId: string,
): Promise<number> {
  const { data, error } = await client
    .from('earnings_ledger')
    .select('amount')
    .eq('actor_id', actorId)
    .eq('status', 'credited')

  if (error) throw new Error(`Failed to get withdrawable balance: ${error.message}`)
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0)
}
