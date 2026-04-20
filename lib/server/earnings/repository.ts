import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { WalletAccountRow, WalletLedgerEntryRowWithActor } from '@/lib/server/wallet/types'

type DatabaseClient = SupabaseClient<Database>

export interface EarningsSummary {
  totalEarned: number
  availableToWithdraw: number
  pending: number
  locked: number
}

export async function getEarningsSummary(
  client: DatabaseClient,
  profileId: string,
): Promise<EarningsSummary> {
  const { data, error } = await client
    .from('wallet_accounts' as never)
    .select('available_to_withdraw, pending, locked')
    .eq('profile_id', profileId)
    .maybeSingle()

  if (error) throw new Error(`Failed to get earnings summary: ${error.message}`)

  const row = data as Pick<WalletAccountRow, 'available_to_withdraw' | 'pending' | 'locked'> | null

  const availableToWithdraw = Number(row?.available_to_withdraw ?? 0)
  const pending = Number(row?.pending ?? 0)
  const locked = Number(row?.locked ?? 0)

  return {
    totalEarned: availableToWithdraw + pending + locked,
    availableToWithdraw,
    pending,
    locked,
  }
}

export async function listEarningsHistory(
  client: DatabaseClient,
  profileId: string,
  limit = 50,
): Promise<WalletLedgerEntryRowWithActor[]> {
  const { data, error } = await client
    .from('wallet_ledger_entries' as never)
    .select(`
      id, profile_id, amount, currency, entry_type, balance_bucket,
      status, reference_type, reference_id, actor_profile_id, metadata, created_at,
      actor_profile:user_profiles!wallet_ledger_entries_actor_profile_id_fkey(full_name)
    `)
    .eq('profile_id', profileId)
    .eq('entry_type', 'earnings_distribution')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list earnings history: ${error.message}`)

  return (data ?? []) as unknown as WalletLedgerEntryRowWithActor[]
}

export async function listAllEarningsHistory(
  client: DatabaseClient,
  limit = 100,
): Promise<WalletLedgerEntryRowWithActor[]> {
  const { data, error } = await client
    .from('wallet_ledger_entries' as never)
    .select(`
      id, profile_id, amount, currency, entry_type, balance_bucket,
      status, reference_type, reference_id, actor_profile_id, metadata, created_at,
      actor_profile:user_profiles!wallet_ledger_entries_actor_profile_id_fkey(full_name)
    `)
    .eq('entry_type', 'earnings_distribution')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to list all earnings history: ${error.message}`)

  return (data ?? []) as unknown as WalletLedgerEntryRowWithActor[]
}
