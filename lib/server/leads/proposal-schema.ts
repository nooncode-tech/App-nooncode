import { z } from 'zod'

export const proposalStatusSchema = z.enum([
  'draft',
  'sent',
  'accepted',
  'rejected',
  'handoff_ready',
])

// Outbound proposals carry one of 100 / 300 / 500 USD as the seller fee per
// master spec v3 §24.1. The DB CHECK constraint on seller_fees.amount
// enforces this at the database layer; this schema is the application-side
// defense-in-depth. The field is optional in the schema because inbound
// proposals do not carry a seller fee. The proposal route enforces "required
// for outbound" with a default of 100 for backwards compatibility with
// callers that pre-date the UI selector (Chunk 4).
export const sellerFeeAmountSchema = z.union([
  z.literal(100),
  z.literal(300),
  z.literal(500),
])

// Project type and complexity coordinates of the pricing matrix
// (lib/maxwell/pricing.ts). Required for outbound proposals so the
// server-side validator can revalidate `amount === computePricing(...)
// .activationFinal` per ADR-013. Optional in the schema because (a)
// inbound proposals do not use the matrix, and (b) legacy outbound rows
// pre-ADR-013 may pre-date the requirement. The proposal route enforces
// "required for outbound" at the validation layer.
export const projectTypeSchema = z.enum([
  'landing',
  'ecommerce',
  'webapp',
  'mobile',
  'saas_ai',
])

export const complexitySchema = z.enum(['low', 'medium', 'high'])

export const createLeadProposalSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(12000),
  amount: z.number().min(0).default(0),
  currency: z.string().trim().min(3).max(8).default('USD').transform((value) => value.toUpperCase()),
  status: proposalStatusSchema.default('draft'),
  sellerFeeAmount: sellerFeeAmountSchema.optional(),
  projectType: projectTypeSchema.optional(),
  complexity: complexitySchema.optional(),
})

export const updateLeadProposalSchema = z.object({
  status: proposalStatusSchema,
})

export type CreateLeadProposalInput = z.infer<typeof createLeadProposalSchema>
export type UpdateLeadProposalInput = z.infer<typeof updateLeadProposalSchema>
