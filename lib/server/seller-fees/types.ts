// Manual types for the seller_fees entity introduced in migrations
// 0043_phase_18a_seller_fees.sql and 0044_phase_18b_seller_fees_rls.sql.
// Mirrors the convention in lib/server/wallet/types.ts §"Tipos monetarios":
// kept manual until the next regeneration of database.types.ts.

import type { Database } from '@/lib/server/supabase/database.types'

export type SellerFeeState =
  | 'potential'
  | 'confirmed'
  | 'pending_payout'
  | 'paid_out'
  | 'cancelled'

export type SellerFeeAmount = 100 | 300 | 500

export const SELLER_FEE_AMOUNTS = [100, 300, 500] as const satisfies readonly SellerFeeAmount[]

export interface SellerFeeRow {
  id: string
  proposal_id: string
  lead_id: string
  seller_profile_id: string
  amount: number
  currency: string
  state: SellerFeeState
  payment_id: string | null
  payout_id: string | null
  cancellation_reason: string | null
  formula_context_snapshot: Record<string, unknown>
  selected_at: string
  confirmed_at: string | null
  pending_payout_at: string | null
  paid_out_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

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
// two paths. The activity_type cast is required until database.types.ts is
// regenerated to include the new enum values.
export type LeadActivityInsert =
  Database['public']['Tables']['lead_activities']['Insert']
