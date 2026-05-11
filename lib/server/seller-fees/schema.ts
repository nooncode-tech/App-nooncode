// Zod schemas for service-layer inputs to the seller-fee state machine.
// Used by lib/server/seller-fees/service.ts (Chunk 2b) and the API handlers
// that route into it (Chunk 3 — proposal creation, webhook handler).

import { z } from 'zod'
import { SELLER_FEE_AMOUNTS } from '@/lib/server/seller-fees/types'

const uuidSchema = z.string().uuid()

const allowedAmountSchema = z.union([
  z.literal(SELLER_FEE_AMOUNTS[0]),
  z.literal(SELLER_FEE_AMOUNTS[1]),
  z.literal(SELLER_FEE_AMOUNTS[2]),
])

// Input for createSellerFee: seller selects the fee at outbound proposal
// generation. Per ADR-007 §Hard rule 7, the amount is constrained at the DB
// layer too; this schema is the application-layer defense-in-depth.
export const createSellerFeeInputSchema = z.object({
  proposalId: uuidSchema,
  leadId: uuidSchema,
  sellerProfileId: uuidSchema,
  amount: allowedAmountSchema,
  formulaContextSnapshot: z.record(z.string(), z.unknown()).optional(),
})

export type CreateSellerFeeInput = z.infer<typeof createSellerFeeInputSchema>

// Input for confirmSellerFee: fired by the Stripe webhook on activation
// payment confirmation. Idempotency is enforced by checking the current
// state of the seller_fees row inside the service layer.
export const confirmSellerFeeInputSchema = z.object({
  proposalId: uuidSchema,
  paymentId: uuidSchema,
})

export type ConfirmSellerFeeInput = z.infer<typeof confirmSellerFeeInputSchema>

// Input for markPendingPayout: fired by the service layer when the seller's
// confirmed earning enters the payout queue.
export const markPendingPayoutInputSchema = z.object({
  sellerFeeId: uuidSchema,
  payoutId: uuidSchema,
})

export type MarkPendingPayoutInput = z.infer<typeof markPendingPayoutInputSchema>

// Input for markPaidOut: fired when the payout transaction settles.
export const markPaidOutInputSchema = z.object({
  sellerFeeId: uuidSchema,
})

export type MarkPaidOutInput = z.infer<typeof markPaidOutInputSchema>

// Input for cancelSellerFee: fired by proposal cancellation, refund handling,
// or PM/Admin intervention. Per ADR-007 §Hard rule 3, cancellation from
// paid_out is forbidden by the state machine — service layer rejects it.
export const cancelSellerFeeInputSchema = z.object({
  sellerFeeId: uuidSchema,
  reason: z.string().min(1).max(500),
  actorProfileId: uuidSchema.nullable(),
})

export type CancelSellerFeeInput = z.infer<typeof cancelSellerFeeInputSchema>
