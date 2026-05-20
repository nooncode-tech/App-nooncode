// Data-access layer for seller_fees. Pure CRUD against Supabase; no business
// logic, no state-machine decisions — those live in service.ts (Chunk 2b).
//
// All callers should pass an admin-privileged client (service_role). RLS
// policies on seller_fees deny INSERT/UPDATE/DELETE to authenticated users
// per ADR-007 §Hard rule 2; service_role bypasses RLS.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/server/supabase/database.types'
import type {
  SellerFeeInsert,
  SellerFeeRow,
  SellerFeeState,
} from '@/lib/server/seller-fees/types'

type DatabaseClient = SupabaseClient<Database>

const sellerFeeSelect = `
  id,
  proposal_id,
  lead_id,
  seller_profile_id,
  amount,
  currency,
  state,
  payment_id,
  payout_id,
  cancellation_reason,
  formula_context_snapshot,
  selected_at,
  confirmed_at,
  pending_payout_at,
  paid_out_at,
  cancelled_at,
  created_at,
  updated_at
`

export async function insertSellerFee(
  client: DatabaseClient,
  payload: SellerFeeInsert
): Promise<SellerFeeRow> {
  const { data, error } = await client
    .from('seller_fees')
    .insert({
      proposal_id: payload.proposal_id,
      lead_id: payload.lead_id,
      seller_profile_id: payload.seller_profile_id,
      amount: payload.amount,
      currency: payload.currency ?? 'USD',
      formula_context_snapshot: (payload.formula_context_snapshot ?? {}) as Json,
    })
    .select(sellerFeeSelect)
    .single()

  if (error || !data) {
    throw new Error(
      `Failed to insert seller_fees row: ${error?.message ?? 'No row returned.'}`
    )
  }

  return data
}

export async function getSellerFeeById(
  client: DatabaseClient,
  sellerFeeId: string
): Promise<SellerFeeRow | null> {
  const { data, error } = await client
    .from('seller_fees')
    .select(sellerFeeSelect)
    .eq('id', sellerFeeId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load seller_fees row: ${error.message}`)
  }

  return data ?? null
}

export async function getSellerFeeByProposalId(
  client: DatabaseClient,
  proposalId: string
): Promise<SellerFeeRow | null> {
  const { data, error } = await client
    .from('seller_fees')
    .select(sellerFeeSelect)
    .eq('proposal_id', proposalId)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to load seller_fees row by proposal: ${error.message}`
    )
  }

  return data ?? null
}

// Used by the Stripe webhook handler in Chunk 3 to look up the seller fee
// for a given payment when transitioning to Confirmed and for idempotency
// when the webhook retries.
export async function getSellerFeeByPaymentId(
  client: DatabaseClient,
  paymentId: string
): Promise<SellerFeeRow | null> {
  const { data, error } = await client
    .from('seller_fees')
    .select(sellerFeeSelect)
    .eq('payment_id', paymentId)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to load seller_fees row by payment: ${error.message}`
    )
  }

  return data ?? null
}

// Low-level state transition write. Service layer is responsible for:
// - validating the FROM state allows the transition (state machine rules)
// - filling the correct timestamp column for the new state
// - logging the activity row (see activity.ts)
// - idempotency (caller short-circuits if row is already in target state)
//
// This function just persists the change. It does not check legality.
export interface UpdateSellerFeeStatePatch {
  state: SellerFeeState
  payment_id?: string
  payout_id?: string
  cancellation_reason?: string
  confirmed_at?: string
  pending_payout_at?: string
  paid_out_at?: string
  cancelled_at?: string
}

export async function updateSellerFeeState(
  client: DatabaseClient,
  sellerFeeId: string,
  patch: UpdateSellerFeeStatePatch
): Promise<SellerFeeRow> {
  const { data, error } = await client
    .from('seller_fees')
    .update(patch)
    .eq('id', sellerFeeId)
    .select(sellerFeeSelect)
    .single()

  if (error || !data) {
    throw new Error(
      `Failed to update seller_fees state: ${error?.message ?? 'No row returned.'}`
    )
  }

  return data
}
