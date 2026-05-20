// Domain types for the seller_fees entity introduced in migrations
// 0043_phase_18a_seller_fees.sql and 0044_phase_18b_seller_fees_rls.sql.
// `SellerFeeRow` is now a re-export of the generated Supabase row shape; the
// hand-written interface was retired once `lib/server/supabase/database.types.ts`
// included the table block (commit 210feca, 2026-05-17). The `SellerFeeState`
// and `SellerFeeAmount` types remain locally defined because they document the
// state machine (ADR-007) and pricing tiers (ADR-008) beyond what the raw enum
// expresses.

import type { Database } from '@/lib/server/supabase/database.types'

export type SellerFeeState =
  | 'potential'
  | 'confirmed'
  | 'pending_payout'
  | 'paid_out'
  | 'cancelled'

export type SellerFeeAmount = 100 | 300 | 500

export const SELLER_FEE_AMOUNTS = [100, 300, 500] as const satisfies readonly SellerFeeAmount[]

export type SellerFeeRow = Database['public']['Tables']['seller_fees']['Row']

export interface SellerFeeInsert {
  proposal_id: string
  lead_id: string
  seller_profile_id: string
  amount: SellerFeeAmount
  currency?: string
  formula_context_snapshot?: Record<string, unknown>
}

// Mapping from state to the lead_activity_type enum value that records the
// transition INTO that state. The string values must match the enum values
// added in 0043_phase_18a_seller_fees.sql.
export const SELLER_FEE_TRANSITION_ACTIVITY = {
  potential: 'seller_fee_selected',
  confirmed: 'seller_fee_confirmed',
  pending_payout: 'seller_fee_pending_payout',
  paid_out: 'seller_fee_paid_out',
  cancelled: 'seller_fee_cancelled',
} as const satisfies Record<SellerFeeState, string>

export type SellerFeeTransitionActivityType =
  (typeof SELLER_FEE_TRANSITION_ACTIVITY)[SellerFeeState]

// Re-export the LeadActivityInsert type so callers don't need to import from
// two paths.
export type LeadActivityInsert =
  Database['public']['Tables']['lead_activities']['Insert']
