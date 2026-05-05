import { z } from 'zod'

export const listWalletEntriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

export type ListWalletEntriesQuery = z.infer<typeof listWalletEntriesQuerySchema>
