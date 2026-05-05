import { encodeCursor } from './cursor'
import type { CursorPayload } from './cursor'

export type OffsetMeta = {
  page: number
  limit: number
  total: number
  pageCount: number
}

export type CursorMeta = {
  nextCursor: string | null
  limit: number
}

export type OffsetResponse<T> = {
  data: T[]
  meta: OffsetMeta
}

export type CursorResponse<T> = {
  data: T[]
  meta: CursorMeta
}

export function buildOffsetResponse<T>(
  rows: T[],
  opts: { page: number; limit: number; total: number }
): OffsetResponse<T> {
  const { page, limit, total } = opts
  const pageCount = total === 0 ? 0 : Math.ceil(total / limit)
  return {
    data: rows,
    meta: { page, limit, total, pageCount },
  }
}

export function buildCursorResponse<T>(
  rows: T[],
  opts: { limit: number; getCursor: (item: T) => CursorPayload }
): CursorResponse<T> {
  const { limit, getCursor } = opts
  if (rows.length > limit) {
    const data = rows.slice(0, limit)
    const nextCursor = encodeCursor(getCursor(data[limit - 1]))
    return { data, meta: { nextCursor, limit } }
  }
  return { data: rows, meta: { nextCursor: null, limit } }
}
