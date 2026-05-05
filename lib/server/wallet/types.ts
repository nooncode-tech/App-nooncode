import type { Database } from '@/lib/server/supabase/database.types'

export type WalletRow = Database['public']['Tables']['user_wallets']['Row']
export type WalletEntryRow = Database['public']['Tables']['user_wallet_entries']['Row']
export type PrototypeCreditSettingsRow = Database['public']['Tables']['prototype_credit_settings']['Row']

export interface WalletEntryRowWithActor extends WalletEntryRow {
  actor_profile?: {
    full_name: string | null
  } | null
}

export type RequestLeadPrototypeRpcRow = Database['public']['Functions']['request_lead_prototype']['Returns'][number]

// Tipos monetarios (migration 0024) — definidos manualmente hasta regenerar database.types
export interface WalletAccountRow {
  profile_id: string
  available_to_spend: number
  available_to_withdraw: number
  pending: number
  locked: number
  currency: string
  created_at: string
  updated_at: string
}

export type MonetaryEntryType =
  | 'deposit'
  | 'earnings_distribution'
  | 'service_debit'
  | 'withdrawal_request'
  | 'withdrawal_confirmed'
  | 'manual_adjustment'
  | 'balance_locked'
  | 'balance_unlocked'

export type BalanceBucket = 'available_to_spend' | 'available_to_withdraw' | 'pending' | 'locked'

export interface WalletLedgerEntryRow {
  id: string
  profile_id: string
  amount: number
  currency: string
  entry_type: MonetaryEntryType
  balance_bucket: BalanceBucket
  status: 'confirmed' | 'pending' | 'reversed'
  reference_type: string | null
  reference_id: string | null
  actor_profile_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface WalletLedgerEntryRowWithActor extends WalletLedgerEntryRow {
  actor_profile?: {
    full_name: string | null
  } | null
}
