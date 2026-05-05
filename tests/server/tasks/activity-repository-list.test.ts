import assert from 'node:assert/strict'
import test from 'node:test'
import type { CursorPayload } from '@/lib/server/pagination/cursor'

// ---------------------------------------------------------------------------
// Chainable Supabase test-double
// ---------------------------------------------------------------------------

type MockResult = { data: unknown[] | null; error: null }

function makeMockClient(result: MockResult) {
  const calls: Record<string, unknown[][]> = {
    select: [],
    eq: [],
    order: [],
    limit: [],
    or: [],
  }

  const chain = {
    select: (...args: unknown[]) => { calls.select.push(args); return chain },
    eq: (...args: unknown[]) => { calls.eq.push(args); return chain },
    order: (...args: unknown[]) => { calls.order.push(args); return chain },
    limit: (...args: unknown[]) => { calls.limit.push(args); return Promise.resolve(result) },
    or: (...args: unknown[]) => { calls.or.push(args); return chain },
    _calls: calls,
  }

  return {
    from: (_table: string) => chain,
    _calls: calls,
    _chain: chain,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { listTaskActivities } from '@/lib/server/tasks/activity-repository'

test('listTaskActivities orders by created_at DESC then id DESC', async () => {
  const client = makeMockClient({ data: [], error: null })

  await listTaskActivities(client as never, 'task-1', { cursor: null, limit: 10 })

  const orderCalls = client._calls.order
  assert.ok(orderCalls.length >= 2, 'should call order at least twice')
  assert.deepEqual(orderCalls[0], ['created_at', { ascending: false }])
  assert.deepEqual(orderCalls[1], ['id', { ascending: false }])
})

test('listTaskActivities requests limit+1 rows from Supabase', async () => {
  const client = makeMockClient({ data: [], error: null })

  await listTaskActivities(client as never, 'task-1', { cursor: null, limit: 10 })

  const limitCalls = client._calls.limit
  assert.equal(limitCalls.length, 1)
  assert.equal(limitCalls[0][0], 11)
})

test('listTaskActivities applies composite .or() filter when cursor is non-null', async () => {
  const client = makeMockClient({ data: [], error: null })
  const cursor: CursorPayload = { createdAt: '2026-05-01T10:00:00Z', id: 'abc-123' }

  await listTaskActivities(client as never, 'task-1', { cursor, limit: 10 })

  const orCalls = client._calls.or
  assert.equal(orCalls.length, 1)
  const filterArg = orCalls[0][0] as string
  assert.ok(
    filterArg.includes('created_at.lt.2026-05-01T10:00:00Z'),
    `expected created_at.lt in filter, got: ${filterArg}`
  )
  assert.ok(
    filterArg.includes('and(created_at.eq.2026-05-01T10:00:00Z,id.lt.abc-123)'),
    `expected and(...) clause in filter, got: ${filterArg}`
  )
})

test('listTaskActivities omits .or() when cursor is null', async () => {
  const client = makeMockClient({ data: [], error: null })

  await listTaskActivities(client as never, 'task-1', { cursor: null, limit: 10 })

  assert.equal(client._calls.or.length, 0, 'should NOT call .or() when cursor is null')
})

test('listTaskActivities applies task_id filter', async () => {
  const client = makeMockClient({ data: [], error: null })

  await listTaskActivities(client as never, 'task-xyz', { cursor: null, limit: 10 })

  const eqCalls = client._calls.eq
  const taskIdCall = eqCalls.find((c) => c[0] === 'task_id' && c[1] === 'task-xyz')
  assert.ok(taskIdCall, 'should call .eq("task_id", "task-xyz")')
})
