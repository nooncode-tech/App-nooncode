import assert from 'node:assert/strict'
import test from 'node:test'
import type { OffsetPaginationInput } from '@/lib/server/pagination/schema'

// ---------------------------------------------------------------------------
// Chainable Supabase test-double
// ---------------------------------------------------------------------------

type MockResult = { data: unknown[] | null; count: number | null; error: null }

function makeMockClient(result: MockResult) {
  const calls: Record<string, unknown[][]> = {
    select: [],
    order: [],
    range: [],
  }

  const chain = {
    select: (...args: unknown[]) => { calls.select.push(args); return chain },
    order: (...args: unknown[]) => { calls.order.push(args); return chain },
    range: (...args: unknown[]) => { calls.range.push(args); return Promise.resolve(result) },
    _calls: calls,
  }

  const client = {
    from: () => chain,
    _calls: calls,
  }

  return client
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { listLeads } from '@/lib/server/leads/repository'

test('listLeads page=1, limit=10 calls .range(0, 9)', async () => {
  const mockData = [{ id: 'lead-1' }]
  const client = makeMockClient({ data: mockData, count: 1, error: null })

  const pagination: OffsetPaginationInput = { page: 1, limit: 10 }
  await listLeads(client as never, pagination)

  const rangeCalls = client._calls.range
  assert.equal(rangeCalls.length, 1)
  assert.deepEqual(rangeCalls[0], [0, 9])
})

test('listLeads page=2, limit=10 calls .range(10, 19)', async () => {
  const mockData = [{ id: 'lead-2' }]
  const client = makeMockClient({ data: mockData, count: 11, error: null })

  const pagination: OffsetPaginationInput = { page: 2, limit: 10 }
  await listLeads(client as never, pagination)

  const rangeCalls = client._calls.range
  assert.equal(rangeCalls.length, 1)
  assert.deepEqual(rangeCalls[0], [10, 19])
})

test('listLeads returns { rows, total } where total comes from count', async () => {
  const mockData = [{ id: 'lead-1' }, { id: 'lead-2' }]
  const client = makeMockClient({ data: mockData, count: 42, error: null })

  const pagination: OffsetPaginationInput = { page: 1, limit: 10 }
  const result = await listLeads(client as never, pagination)

  assert.equal(result.total, 42)
  assert.deepEqual(result.rows, mockData)
})

test('listLeads returns { rows: [], total: 0 } when data and count are null', async () => {
  const client = makeMockClient({ data: null, count: null, error: null })

  const pagination: OffsetPaginationInput = { page: 1, limit: 10 }
  const result = await listLeads(client as never, pagination)

  assert.deepEqual(result.rows, [])
  assert.equal(result.total, 0)
})
