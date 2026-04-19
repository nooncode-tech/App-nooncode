import { z } from 'zod'

export const proposalStatusSchema = z.enum([
  'draft',
  'sent',
  'accepted',
  'rejected',
  'handoff_ready',
])

export const createLeadProposalSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(12000),
  amount: z.number().min(0).default(0),
  currency: z.string().trim().min(3).max(8).default('USD').transform((value) => value.toUpperCase()),
  status: proposalStatusSchema.default('draft'),
})

export const updateLeadProposalSchema = z.object({
  status: proposalStatusSchema,
})

export type CreateLeadProposalInput = z.infer<typeof createLeadProposalSchema>
export type UpdateLeadProposalInput = z.infer<typeof updateLeadProposalSchema>
