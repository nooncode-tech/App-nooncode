import { z } from 'zod'

export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(100).transform(v => Math.min(v, 100)),
})

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).default(100).transform(v => Math.min(v, 100)),
})

export type OffsetPaginationInput = z.infer<typeof offsetPaginationSchema>
export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>
