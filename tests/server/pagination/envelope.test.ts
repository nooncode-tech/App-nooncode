import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOffsetResponse, buildCursorResponse } from '@/lib/server/pagination/envelope'
import { encodeCursor, decodeCursor } from '@/lib/server/pagination/cursor'
import type { CursorPayload } from '@/lib/server/pagination/cursor'

type Item = { id: string; createdAt: string }

const makeItems = (count: number): Item[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `item-${i + 1}`,
    createdAt: `2026-05-0${(i % 9) + 1}T00:00:00Z`,
  }))

const getCursor = (item: Item): CursorPayload => ({ createdAt: item.createdAt, id: item.id })

// --- buildOffsetResponse ---

test('buildOffsetResponse: computes pageCount = ceil(47/10) = 5', () => {
  const rows = makeItems(10)
  const result = buildOffsetResponse(rows, { page: 1, limit: 10, total: 47 })
  assert.equal(result.meta.pageCount, 5)
  assert.equal(result.meta.total, 47)
  assert.equal(result.meta.page, 1)
  assert.equal(result.meta.limit, 10)
})

test('buildOffsetResponse: pageCount=0 when total=0', () => {
  const result = buildOffsetResponse([], { page: 1, limit: 10, total: 0 })
  assert.equal(result.meta.pageCount, 0)
  assert.deepEqual(result.data, [])
})

test('buildOffsetResponse: partial last page (23 total, limit=10 → pageCount=3)', () => {
  const rows = makeItems(3)
  const result = buildOffsetResponse(rows, { page: 3, limit: 10, total: 23 })
  assert.equal(result.meta.pageCount, 3)
})

test('buildOffsetResponse: data array equals the input rows', () => {
  const rows = makeItems(5)
  const result = buildOffsetResponse(rows, { page: 1, limit: 10, total: 5 })
  assert.deepEqual(result.data, rows)
})

// --- buildCursorResponse ---

test('buildCursorResponse: when rows.length > limit, trims to limit and sets nextCursor', () => {
  const items = makeItems(11) // limit+1 rows for limit=10
  const result = buildCursorResponse(items, { limit: 10, getCursor })
  assert.equal(result.data.length, 10)
  assert.notEqual(result.meta.nextCursor, null)
})

test('buildCursorResponse: when rows.length <= limit, returns all rows and nextCursor=null', () => {
  const items = makeItems(7)
  const result = buildCursorResponse(items, { limit: 10, getCursor })
  assert.equal(result.data.length, 7)
  assert.equal(result.meta.nextCursor, null)
})

test('buildCursorResponse: empty rows → nextCursor=null', () => {
  const result = buildCursorResponse([], { limit: 10, getCursor })
  assert.deepEqual(result.data, [])
  assert.equal(result.meta.nextCursor, null)
})

test('buildCursorResponse: nextCursor encodes the LAST retained item (not the extra one)', () => {
  const items = makeItems(11) // limit=10, so items[9] is last retained
  const result = buildCursorResponse(items, { limit: 10, getCursor })
  const decoded = decodeCursor(result.meta.nextCursor!)
  assert.deepEqual(decoded, getCursor(items[9]))
})
