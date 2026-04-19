import { z } from 'zod'

export const createLeadNoteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
})

export type CreateLeadNoteInput = z.infer<typeof createLeadNoteSchema>
