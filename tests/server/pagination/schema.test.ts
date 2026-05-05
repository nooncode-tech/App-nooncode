import assert from 'node:assert/strict'
import test from 'node:test'
import { offsetPaginationSchema, cursorPaginationSchema } from '@/lib/server/pagination/schema'

test('offsetPaginationSchema: defaults to page=1, limit=100', () => {
  const result = offsetPaginationSchema.parse({})
  assert.deepEqual(result, { page: 1, limit: 100 })
})

test('offsetPaginationSchema: accepts explicit page and limit', () => {
  const result = offsetPaginationSchema.parse({ page: 3, limit: 25 })
  assert.deepEqual(result, { page: 3, limit: 25 })
})

test('offsetPaginationSchema: rejects page=0', () => {
  assert.throws(() => offsetPaginationSchema.parse({ page: 0 }))
})

test('offsetPaginationSchema: rejects page=-1', () => {
  assert.throws(() => offsetPaginationSchema.parse({ page: -1 }))
})

test('offsetPaginationSchema: rejects limit=0', () => {
  assert.throws(() => offsetPaginationSchema.parse({ limit: 0 }))
})

test('offsetPaginationSchema: clamps limit=101 to 100', () => {
  const result = offsetPaginationSchema.parse({ limit: 101 })
  assert.equal(result.limit, 100)
})

test('offsetPaginationSchema: coerces string "2" to number 2', () => {
  const result = offsetPaginationSchema.parse({ page: '2', limit: '50' })
  assert.deepEqual(result, { page: 2, limit: 50 })
})

test('cursorPaginationSchema: defaults to limit=100, cursor=undefined', () => {
  const result = cursorPaginationSchema.parse({})
  assert.strictEqual(result.limit, 100)
  assert.strictEqual(result.cursor, undefined)
})

test('cursorPaginationSchema: accepts cursor string', () => {
  const result = cursorPaginationSchema.parse({ cursor: 'sometoken', limit: 50 })
  assert.deepEqual(result, { cursor: 'sometoken', limit: 50 })
})
