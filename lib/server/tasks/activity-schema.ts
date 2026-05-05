import { z } from 'zod'

export const createTaskNoteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
})

export type CreateTaskNoteInput = z.infer<typeof createTaskNoteSchema>
