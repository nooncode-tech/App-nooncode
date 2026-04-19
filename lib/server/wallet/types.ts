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
