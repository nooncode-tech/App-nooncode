import assert from 'node:assert/strict'
import test from 'node:test'
import { listTasks } from '@/lib/server/tasks/repository'

// Minimal Supabase query-builder mock that tracks .range() calls
function makeClient(overrides: { data?: unknown; count?: number | null; error?: unknown } = {}) {
  const calls: { range?: [number, number] } = {}

  const builder: Record<string, unknown> = {}

  builder.from = () => builder
  builder.select = () => builder
  builder.order = () => builder
  builder.range = (from: number, to: number) => {
    calls.range = [from, to]
    return builder
  }
  // Make the builder thenable so `await client.from(...).select(...).range(...)` resolves
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(builder as any)[Symbol.toStringTag] = 'Promise'
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({
      data: overrides.data ?? [],
      count: overrides.count ?? 0,
      error: overrides.error ?? null,
    })

  return { client: builder as unknown, calls }
}

test('listTasks page=1 limit=10 calls .range(0, 9)', async () => {
  const { client, calls } = makeClient({ data: [], count: 0 })
  await listTasks(client as never, { page: 1, limit: 10 })
  assert.deepEqual(calls.range, [0, 9])
})

test('listTasks page=2 limit=10 calls .range(10, 19)', async () => {
  const { client, calls } = makeClient({ data: [], count: 0 })
  await listTasks(client as never, { page: 2, limit: 10 })
  assert.deepEqual(calls.range, [10, 19])
})

test('listTasks returns { rows, total } where total comes from count', async () => {
  const fakeRows = [{ id: 'task-1' }, { id: 'task-2' }]
  const { client } = makeClient({ data: fakeRows, count: 42 })
  const result = await listTasks(client as never, { page: 1, limit: 10 })
  assert.deepEqual(result.rows, fakeRows)
  assert.equal(result.total, 42)
})

test('listTasks returns { rows: [], total: 0 } when data/count are null', async () => {
  const { client } = makeClient({ data: null, count: null })
  const result = await listTasks(client as never, { page: 1, limit: 10 })
  assert.deepEqual(result.rows, [])
  assert.equal(result.total, 0)
})
