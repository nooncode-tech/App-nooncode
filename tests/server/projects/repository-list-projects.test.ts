import assert from 'node:assert/strict'
import test from 'node:test'
import { listProjects } from '@/lib/server/projects/repository'

// Minimal Supabase query builder mock
function makeClient(opts: { data: unknown[] | null; count: number | null; error?: unknown }) {
  let _rangeFrom: number | undefined
  let _rangeTo: number | undefined
  let callCount = 0

  function makeBuilder(isPrototype: boolean) {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.order = () => b
    b.in = () => b
    b.maybeSingle = () => Promise.resolve({ data: null, error: null })
    b.range = (from: number, to: number) => {
      if (!isPrototype) {
        _rangeFrom = from
        _rangeTo = to
      }
      return b
    }
    b.then = (resolve: (v: unknown) => void) => {
      if (isPrototype) {
        resolve({ data: [], count: null, error: null })
      } else {
        resolve({ data: opts.data, count: opts.count, error: opts.error ?? null })
      }
    }
    return b
  }

  return {
    from: () => {
      callCount++
      return makeBuilder(callCount > 1)
    },
    getRangeArgs() {
      return [_rangeFrom, _rangeTo]
    },
  }
}

test('listProjects page=1, limit=10 calls .range(0, 9)', async () => {
  const client = makeClient({ data: [], count: 0 })
  await listProjects(client as never, { page: 1, limit: 10 })
  assert.deepEqual(client.getRangeArgs(), [0, 9])
})

test('listProjects page=2, limit=10 calls .range(10, 19)', async () => {
  const client = makeClient({ data: [], count: 0 })
  await listProjects(client as never, { page: 2, limit: 10 })
  assert.deepEqual(client.getRangeArgs(), [10, 19])
})

test('listProjects returns { rows, total } where total comes from count', async () => {
  const fakeRow = { id: 'p1' }
  const client = makeClient({ data: [fakeRow], count: 42 })
  const result = await listProjects(client as never, { page: 1, limit: 10 })
  assert.equal(result.total, 42)
  assert.equal(result.rows.length, 1)
})

test('listProjects returns { rows: [], total: 0 } when data/count are null', async () => {
  const client = makeClient({ data: null, count: null })
  const result = await listProjects(client as never, { page: 1, limit: 10 })
  assert.equal(result.total, 0)
  assert.deepEqual(result.rows, [])
})
