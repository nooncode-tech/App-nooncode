import { z } from 'zod'

export const listUpdatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
