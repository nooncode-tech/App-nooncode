// State machine for the seller-fee entity per ADR-007 and contract
// docs/contracts/seller-fee-state-machine.md.
//
// Five transition operations, each:
//   1. Idempotency check on the current state — webhook retries are a no-op.
//   2. Reject invalid transitions with a typed ApiError.
//   3. Write the DB update via the repository.
//   4. Log the transition into lead_activities via the activity helper.
//
// All callers should pass an admin-privileged supabase client (service_role).
// Per ADR-007 §Hard rule 2, RLS denies INSERT/UPDATE/DELETE for authenticated
// users on seller_fees; only service_role mutates the table.
//
// Cancellation rules per ADR-007 §Hard rules 3 + 4:
//   - paid_out → cancelled : FORBIDDEN (PM/Admin exception path, out of scope).
//   - pending_payout → cancelled : DEFERRED (mechanics not yet implemented).
//   - confirmed → cancelled : ALLOWED (refund / dispute before payout).
//   - potential → cancelled : ALLOWED (proposal cancelled, lead released).
//   - cancelled → cancelled : IDEMPOTENT no-op.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import { ApiError, ConflictApiError, NotFoundApiError } from '@/lib/server/api/errors'
import { logSellerFeeTransition } from '@/lib/server/seller-fees/activity'
import {
  getSellerFeeById,
  getSellerFeeByProposalId,
  insertSellerFee,
  updateSellerFeeState,
} from '@/lib/server/seller-fees/repository'
import type {
  CancelSellerFeeInput,
  ConfirmSellerFeeInput,
  CreateSellerFeeInput,
  MarkPaidOutInput,
  MarkPendingPayoutInput,
} from '@/lib/server/seller-fees/schema'
import type { SellerFeeRow, SellerFeeState } from '@/lib/server/seller-fees/types'

type DatabaseClient = SupabaseClient<Database>

// ---------------------------------------------------------------------------
// createSellerFee — initial entry into the state machine (state='potential')
// ---------------------------------------------------------------------------

export async function createSellerFee(
  client: DatabaseClient,
  input: CreateSellerFeeInput
): Promise<SellerFeeRow> {
  const existing = await getSellerFeeByProposalId(client, input.proposalId)
  if (existing) {
    throw new ConflictApiError(
      'A seller fee already exists for this proposal. Create a new proposal version to re-price.',
      'SELLER_FEE_ALREADY_EXISTS'
    )
  }

  const row = await insertSellerFee(client, {
    proposal_id: input.proposalId,
    lead_id: input.leadId,
    seller_profile_id: input.sellerProfileId,
    amount: input.amount,
    formula_context_snapshot: input.formulaContextSnapshot,
  })

  // Activity event for the entry into 'potential'. The activity_type
  // 'seller_fee_selected' carries the "creation" semantic; prior_state and
  // new_state both being 'potential' reflects that the row was created in
  // that state (no transition from a prior state).
  await logSellerFeeTransition(client, {
    sellerFee: row,
    priorState: 'potential',
    newState: 'potential',
    actorProfileId: input.sellerProfileId,
  })

  return row
}

// ---------------------------------------------------------------------------
// confirmSellerFee — potential → confirmed (fired by Stripe webhook)
// ---------------------------------------------------------------------------

export async function confirmSellerFee(
  client: DatabaseClient,
  input: ConfirmSellerFeeInput
): Promise<SellerFeeRow> {
  const row = await getSellerFeeByProposalId(client, input.proposalId)
  if (!row) {
    throw new NotFoundApiError(
      `Seller fee for proposal ${input.proposalId} not found.`,
      'SELLER_FEE_NOT_FOUND'
    )
  }

  // Idempotency: a webhook retry firing confirmSellerFee on an already-
  // confirmed row for the same payment is a no-op (per ADR-007 §rule 11).
  if (row.state === 'confirmed' && row.payment_id === input.paymentId) {
    return row
  }

  // A row already confirmed but for a different payment is an integrity
  // breach — likely a duplicate proposal or webhook routing error.
  if (row.state === 'confirmed' && row.payment_id !== input.paymentId) {
    throw new ConflictApiError(
      `Seller fee already confirmed against a different payment (${row.payment_id}). Refusing to overwrite.`,
      'SELLER_FEE_PAYMENT_CONFLICT'
    )
  }

  if (row.state !== 'potential') {
    throw new ConflictApiError(
      `Seller fee cannot be confirmed from state '${row.state}'. Only 'potential' may transition to 'confirmed'.`,
      'SELLER_FEE_INVALID_TRANSITION'
    )
  }

  const updated = await updateSellerFeeState(client, row.id, {
    state: 'confirmed',
    payment_id: input.paymentId,
    confirmed_at: new Date().toISOString(),
  })

  await logSellerFeeTransition(client, {
    sellerFee: updated,
    priorState: 'potential',
    newState: 'confirmed',
    actorProfileId: null,
  })

  return updated
}

// ---------------------------------------------------------------------------
// markPendingPayout — confirmed → pending_payout
// ---------------------------------------------------------------------------

export async function markPendingPayout(
  client: DatabaseClient,
  input: MarkPendingPayoutInput
): Promise<SellerFeeRow> {
  const row = await loadOrThrow(client, input.sellerFeeId)

  if (row.state === 'pending_payout' && row.payout_id === input.payoutId) {
    return row
  }

  if (row.state !== 'confirmed') {
    throw new ConflictApiError(
      `Seller fee cannot enter pending_payout from state '${row.state}'. Only 'confirmed' may transition.`,
      'SELLER_FEE_INVALID_TRANSITION'
    )
  }

  const updated = await updateSellerFeeState(client, row.id, {
    state: 'pending_payout',
    payout_id: input.payoutId,
    pending_payout_at: new Date().toISOString(),
  })

  await logSellerFeeTransition(client, {
    sellerFee: updated,
    priorState: 'confirmed',
    newState: 'pending_payout',
    actorProfileId: null,
  })

  return updated
}

// ---------------------------------------------------------------------------
// markPaidOut — pending_payout → paid_out
// ---------------------------------------------------------------------------

export async function markPaidOut(
  client: DatabaseClient,
  input: MarkPaidOutInput
): Promise<SellerFeeRow> {
  const row = await loadOrThrow(client, input.sellerFeeId)

  if (row.state === 'paid_out') {
    return row
  }

  if (row.state !== 'pending_payout') {
    throw new ConflictApiError(
      `Seller fee cannot be marked paid_out from state '${row.state}'. Only 'pending_payout' may transition.`,
      'SELLER_FEE_INVALID_TRANSITION'
    )
  }

  const updated = await updateSellerFeeState(client, row.id, {
    state: 'paid_out',
    paid_out_at: new Date().toISOString(),
  })

  await logSellerFeeTransition(client, {
    sellerFee: updated,
    priorState: 'pending_payout',
    newState: 'paid_out',
    actorProfileId: null,
  })

  return updated
}

// ---------------------------------------------------------------------------
// cancelSellerFee — potential|confirmed → cancelled
// ---------------------------------------------------------------------------

export async function cancelSellerFee(
  client: DatabaseClient,
  input: CancelSellerFeeInput
): Promise<SellerFeeRow> {
  const row = await loadOrThrow(client, input.sellerFeeId)

  if (row.state === 'cancelled') {
    return row
  }

  if (row.state === 'paid_out') {
    // Per ADR-007 §Hard rule 3, cancellation from paid_out is forbidden as
    // an automatic transition. Refunds or disputes after payout require a
    // PM/Admin exception path outside the state machine.
    throw new ApiError(
      'SELLER_FEE_CANCEL_FORBIDDEN_FROM_PAID_OUT',
      'Cannot cancel a seller fee that has already been paid out. PM/Admin exception path required for post-payout refunds.',
      409
    )
  }

  if (row.state === 'pending_payout') {
    // Per ADR-007 §Hard rule 4, cancellation from pending_payout is allowed
    // in principle but the queue-mechanics decision is deferred. Current
    // service-layer scope rejects it; a future iteration adds the pull-back.
    throw new ConflictApiError(
      'Cancellation from pending_payout is not yet implemented. Manual escalation required.',
      'SELLER_FEE_CANCEL_FROM_PENDING_NOT_IMPLEMENTED'
    )
  }

  const priorState: SellerFeeState = row.state
  const updated = await updateSellerFeeState(client, row.id, {
    state: 'cancelled',
    cancellation_reason: input.reason,
    cancelled_at: new Date().toISOString(),
  })

  await logSellerFeeTransition(client, {
    sellerFee: updated,
    priorState,
    newState: 'cancelled',
    actorProfileId: input.actorProfileId,
  })

  return updated
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadOrThrow(
  client: DatabaseClient,
  sellerFeeId: string
): Promise<SellerFeeRow> {
  const row = await getSellerFeeById(client, sellerFeeId)
  if (!row) {
    throw new NotFoundApiError(
      `Seller fee ${sellerFeeId} not found.`,
      'SELLER_FEE_NOT_FOUND'
    )
  }
  return row
}
