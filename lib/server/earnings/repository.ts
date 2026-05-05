import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { WalletAccountRow, WalletLedgerEntryRowWithActor } from '@/lib/server/wallet/types'
import type { CursorPayload } from '@/lib/server/pagination/cursor'

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
  opts: { cursor: CursorPayload | null; limit: number } = { cursor: null, limit: 100 },
): Promise<WalletLedgerEntryRowWithActor[]> {
  let query = client
    .from('wallet_ledger_entries' as never)
    .select(`
      id, profile_id, amount, currency, entry_type, balance_bucket,
      status, reference_type, reference_id, actor_profile_id, metadata, created_at,
      actor_profile:user_profiles!wallet_ledger_entries_actor_profile_id_fkey(full_name)
    `)
    .eq('profile_id', profileId)
    .eq('entry_type', 'earnings_distribution')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit + 1)

  if (opts.cursor) {
    query = (query as ReturnType<typeof query.lt>).or(
      `created_at.lt.${opts.cursor.createdAt},and(created_at.eq.${opts.cursor.createdAt},id.lt.${opts.cursor.id})`
    )
  }

  const { data, error } = await query

  if (error) throw new Error(`Failed to list earnings history: ${error.message}`)

  return (data ?? []) as unknown as WalletLedgerEntryRowWithActor[]
}

export async function listAllEarningsHistory(
  client: DatabaseClient,
  opts: { cursor: CursorPayload | null; limit: number } = { cursor: null, limit: 100 },
): Promise<WalletLedgerEntryRowWithActor[]> {
  let query = client
    .from('wallet_ledger_entries' as never)
    .select(`
      id, profile_id, amount, currency, entry_type, balance_bucket,
      status, reference_type, reference_id, actor_profile_id, metadata, created_at,
      actor_profile:user_profiles!wallet_ledger_entries_actor_profile_id_fkey(full_name)
    `)
    .eq('entry_type', 'earnings_distribution')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit + 1)

  if (opts.cursor) {
    query = (query as ReturnType<typeof query.lt>).or(
      `created_at.lt.${opts.cursor.createdAt},and(created_at.eq.${opts.cursor.createdAt},id.lt.${opts.cursor.id})`
    )
  }

  const { data, error } = await query

  if (error) throw new Error(`Failed to list all earnings history: ${error.message}`)

  return (data ?? []) as unknown as WalletLedgerEntryRowWithActor[]
}
