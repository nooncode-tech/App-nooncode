import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  PrototypeCreditSettingsRow,
  RequestLeadPrototypeRpcRow,
  WalletEntryRowWithActor,
  WalletRow,
} from '@/lib/server/wallet/types'

type DatabaseClient = SupabaseClient<Database>

const walletSelect = `
  profile_id,
  free_credits_balance,
  earned_credits_balance,
  created_at,
  updated_at
`

const walletEntrySelect = `
  id,
  profile_id,
  entry_type,
  bucket,
  delta_credits,
  operation_id,
  actor_profile_id,
  lead_id,
  prototype_workspace_id,
  metadata,
  created_at,
  actor_profile:user_profiles!user_wallet_entries_actor_profile_id_fkey(full_name)
`

export async function ensureCurrentUserWallet(client: DatabaseClient): Promise<WalletRow> {
  const { data, error } = await client.rpc('ensure_current_user_wallet')

  if (error || !data) {
    throw new Error(`Failed to ensure wallet: ${error?.message ?? 'No wallet returned.'}`)
  }

  return data as WalletRow
}

export async function getWalletByProfileId(
  client: DatabaseClient,
  profileId: string
): Promise<WalletRow | null> {
  const { data, error } = await client
    .from('user_wallets')
    .select(walletSelect)
    .eq('profile_id', profileId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load wallet: ${error.message}`)
  }

  return (data ?? null) as WalletRow | null
}

export async function listWalletEntries(
  client: DatabaseClient,
  profileId: string,
  limit: number
): Promise<WalletEntryRowWithActor[]> {
  const { data, error } = await client
    .from('user_wallet_entries')
    .select(walletEntrySelect)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to list wallet entries: ${error.message}`)
  }

  return (data ?? []) as WalletEntryRowWithActor[]
}

export async function getPrototypeCreditSettings(
  client: DatabaseClient
): Promise<PrototypeCreditSettingsRow | null> {
  const { data, error } = await client
    .from('prototype_credit_settings')
    .select('singleton_key, request_cost, updated_by_profile_id, created_at, updated_at')
    .eq('singleton_key', true)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load prototype credit settings: ${error.message}`)
  }

  return (data ?? null) as PrototypeCreditSettingsRow | null
}

export async function upsertPrototypeCreditSettings(
  client: DatabaseClient,
  requestCost: number,
  updatedByProfileId: string
): Promise<PrototypeCreditSettingsRow> {
  const { data, error } = await client
    .from('prototype_credit_settings')
    .upsert(
      {
        singleton_key: true,
        request_cost: requestCost,
        updated_by_profile_id: updatedByProfileId,
      },
      { onConflict: 'singleton_key' }
    )
    .select('singleton_key, request_cost, updated_by_profile_id, created_at, updated_at')
    .single()

  if (error || !data) {
    throw new Error(`Failed to save prototype credit settings: ${error?.message ?? 'No data returned.'}`)
  }

  return data as PrototypeCreditSettingsRow
}

export async function requestLeadPrototype(
  client: DatabaseClient,
  leadId: string
): Promise<RequestLeadPrototypeRpcRow> {
  const { data, error } = await client.rpc('request_lead_prototype', {
    target_lead_id: leadId,
  })

  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error(error?.message ?? 'Prototype request did not return a result.')
  }

  return data[0] as RequestLeadPrototypeRpcRow
}

// ── Wallet monetaria (migration 0024) ──────────────────────────────────────

import type {
  WalletAccountRow,
  WalletLedgerEntryRowWithActor,
} from '@/lib/server/wallet/types'

const monetaryLedgerSelect = `
  id,
  profile_id,
  amount,
  currency,
  entry_type,
  balance_bucket,
  status,
  reference_type,
  reference_id,
  actor_profile_id,
  metadata,
  created_at,
  actor_profile:user_profiles!wallet_ledger_entries_actor_profile_id_fkey(full_name)
`

export async function ensureMonetaryWallet(
  client: DatabaseClient
): Promise<WalletAccountRow | null> {
  const { data, error } = await client.rpc('ensure_monetary_wallet')

  if (error) {
    // Si la función no existe aún (migración no aplicada), retornamos null sin romper el flujo
    if (error.code === 'PGRST202' || error.message?.includes('ensure_monetary_wallet')) {
      return null
    }
    throw new Error(`Failed to ensure monetary wallet: ${error.message}`)
  }

  return (data ?? null) as WalletAccountRow | null
}

export async function listMonetaryLedgerEntries(
  client: DatabaseClient,
  profileId: string,
  limit: number
): Promise<WalletLedgerEntryRowWithActor[]> {
  const { data, error } = await client
    .from('wallet_ledger_entries' as never)
    .select(monetaryLedgerSelect)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    // Si la tabla no existe aún, retornar vacío sin romper el flujo
    if (error.code === '42P01') return []
    throw new Error(`Failed to list monetary ledger entries: ${error.message}`)
  }

  return (data ?? []) as WalletLedgerEntryRowWithActor[]
}
