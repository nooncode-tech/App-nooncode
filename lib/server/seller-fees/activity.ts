// Activity logging helper for seller-fee state transitions.
// Writes rows into the existing lead_activities table using the new
// lead_activity_type enum values added in 0043_phase_18a_seller_fees.sql
// (seller_fee_selected / _confirmed / _pending_payout / _paid_out / _cancelled).
//
// Per ADR-007 §Hard rule 5 (reuse lead_activities; no new activity surface).
//
// Idempotency note: the service layer is responsible for short-circuiting
// duplicate transitions (e.g., webhook retries calling confirmSellerFee on
// an already-confirmed row). This helper just writes; it does not deduplicate.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  SellerFeeRow,
  SellerFeeState,
  SellerFeeTransitionActivityType,
} from '@/lib/server/seller-fees/types'
import { SELLER_FEE_TRANSITION_ACTIVITY } from '@/lib/server/seller-fees/types'

type DatabaseClient = SupabaseClient<Database>

export interface SellerFeeTransitionEvent {
  sellerFee: SellerFeeRow
  priorState: SellerFeeState
  newState: SellerFeeState
  actorProfileId: string | null
  noteBody?: string
  extraMetadata?: Record<string, unknown>
}

function defaultNoteBody(event: SellerFeeTransitionEvent): string {
  const amountFormatted = `$${Number(event.sellerFee.amount).toFixed(0)}`
  switch (event.newState) {
    case 'potential':
      return `Seller fee ${amountFormatted} selected on proposal.`
    case 'confirmed':
      return `Seller fee ${amountFormatted} confirmed by client payment.`
    case 'pending_payout':
      return `Seller fee ${amountFormatted} queued for payout.`
    case 'paid_out':
      return `Seller fee ${amountFormatted} paid out to seller.`
    case 'cancelled':
      return `Seller fee ${amountFormatted} cancelled.`
  }
}

function buildMetadata(event: SellerFeeTransitionEvent): Record<string, unknown> {
  return {
    seller_fee_id: event.sellerFee.id,
    proposal_id: event.sellerFee.proposal_id,
    seller_profile_id: event.sellerFee.seller_profile_id,
    amount: event.sellerFee.amount,
    currency: event.sellerFee.currency,
    prior_state: event.priorState,
    new_state: event.newState,
    payment_id: event.sellerFee.payment_id,
    payout_id: event.sellerFee.payout_id,
    cancellation_reason: event.sellerFee.cancellation_reason,
    ...(event.extraMetadata ?? {}),
  }
}

export function activityTypeForTransition(
  newState: SellerFeeState
): SellerFeeTransitionActivityType {
  return SELLER_FEE_TRANSITION_ACTIVITY[newState]
}

export async function logSellerFeeTransition(
  client: DatabaseClient,
  event: SellerFeeTransitionEvent
): Promise<{ id: string }> {
  const activityType = activityTypeForTransition(event.newState)
  // Cast required for two reasons until database.types.ts is regenerated:
  // (a) lead_activity_type enum lacks the seller_fee_* values added in 0043,
  // (b) metadata is typed as Json which does not accept Record<string, unknown>
  //     directly. The Insert type is satisfied at runtime; this cast keeps
  //     the cast scoped to the insert call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertPayload: any = {
    lead_id: event.sellerFee.lead_id,
    activity_type: activityType,
    actor_profile_id: event.actorProfileId,
    note_body: event.noteBody ?? defaultNoteBody(event),
    metadata: buildMetadata(event),
  }

  const { data, error } = await client
    .from('lead_activities')
    .insert(insertPayload)
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(
      `Failed to log seller_fee activity: ${error?.message ?? 'No activity returned.'}`
    )
  }

  return data
}
