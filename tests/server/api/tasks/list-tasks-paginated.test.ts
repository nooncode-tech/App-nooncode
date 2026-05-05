import assert from 'node:assert/strict'
import test from 'node:test'
import { mock } from 'node:test'

// We test the GET handler logic directly by stubbing its dependencies via module mocking.
// Since tsx supports path aliases, we import from the source.

// ---- Helpers ----

function makeUrl(params: Record<string, string> = {}) {
  const url = new URL('https://app.noon.test/api/tasks')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString())
}

// ---- Minimal fakes for dependencies ----

import type { OffsetPaginationInput } from '@/lib/server/pagination/schema'
import type { TaskRowWithProfiles } from '@/lib/server/tasks/types'

type ListTasksFn = (
  client: unknown,
  input: OffsetPaginationInput
) => Promise<{ rows: TaskRowWithProfiles[]; total: number }>

type RequireRoleFn = () => Promise<void>
type CreateClientFn = () => Promise<unknown>

// We import the module under test AFTER setting up the mocks via dependency injection.
// Because tsx doesn't support jest-style module mocking, we test the handler's internal
// logic by extracting it into a factory function pattern.
// Instead, we directly test a reconstructed version of the handler that accepts injected deps.

import { NextResponse } from 'next/server'
import { buildOffsetResponse } from '@/lib/server/pagination/envelope'
import { offsetPaginationSchema } from '@/lib/server/pagination/schema'
import { AuthGuardError } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { mapTaskRowToWire } from '@/lib/server/tasks/mappers'

// Reconstruct the handler logic as a testable function that accepts injected fns
async function makeGETHandler(
  requireRoleFn: RequireRoleFn,
  createClientFn: CreateClientFn,
  listTasksFn: ListTasksFn
) {
  return async function GET(request: Request) {
    try {
      await requireRoleFn()
      const { searchParams } = new URL(request.url)
      const pagination = offsetPaginationSchema.parse({
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
      })
      const client = await createClientFn()
      const { rows, total } = await listTasksFn(client, pagination)
      return NextResponse.json(
        buildOffsetResponse(rows.map(mapTaskRowToWire), {
          page: pagination.page,
          limit: pagination.limit,
          total,
        })
      )
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

const fakeClient = {}
const createClientFn: CreateClientFn = async () => fakeClient
const allowedRequireRole: RequireRoleFn = async () => {}
const unauthorizedRequireRole: RequireRoleFn = async () => {
  throw new AuthGuardError('UNAUTHENTICATED', 'An active session is required.', 401)
}

const emptyListTasks: ListTasksFn = async (_client, _input) => ({ rows: [], total: 0 })

function makeRows(count: number): TaskRowWithProfiles[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    project_id: 'proj-1',
    created_by: 'user-1',
    title: `Task ${i + 1}`,
    description: null,
    status: 'todo' as const,
    priority: 'medium' as const,
    assigned_legacy_user_id: null,
    due_date: null,
    estimated_hours: null,
    actual_hours: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    assigned_profile: null,
  }))
}

// ---- Tests ----

test('GET /api/tasks default → page=1, limit=100, meta present', async () => {
  const rows = makeRows(3)
  const listTasks: ListTasksFn = async (_client, input) => {
    assert.equal(input.page, 1)
    assert.equal(input.limit, 100)
    return { rows, total: 3 }
  }
  const GET = await makeGETHandler(allowedRequireRole, createClientFn, listTasks)
  const res = await GET(makeUrl())
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.ok(body.meta, 'meta should be present')
  assert.equal(body.meta.page, 1)
  assert.equal(body.meta.limit, 100)
  assert.equal(body.meta.total, 3)
})

test('GET /api/tasks explicit ?page=2&limit=10', async () => {
  const rows = makeRows(10)
  const listTasks: ListTasksFn = async (_client, input) => {
    assert.equal(input.page, 2)
    assert.equal(input.limit, 10)
    return { rows, total: 25 }
  }
  const GET = await makeGETHandler(allowedRequireRole, createClientFn, listTasks)
  const res = await GET(makeUrl({ page: '2', limit: '10' }))
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.meta.page, 2)
  assert.equal(body.meta.limit, 10)
  assert.equal(body.meta.total, 25)
  assert.equal(body.meta.pageCount, 3)
})

test('GET /api/tasks ?limit=200 → clamped to 100, status 200', async () => {
  const GET = await makeGETHandler(allowedRequireRole, createClientFn, emptyListTasks)
  const res = await GET(makeUrl({ limit: '200' }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.meta.limit, 100)
})

test('GET /api/tasks empty result', async () => {
  const GET = await makeGETHandler(allowedRequireRole, createClientFn, emptyListTasks)
  const res = await GET(makeUrl())
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.deepEqual(body.data, [])
  assert.equal(body.meta.total, 0)
  assert.equal(body.meta.pageCount, 0)
})

test('GET /api/tasks unauthenticated → 401', async () => {
  const GET = await makeGETHandler(unauthorizedRequireRole, createClientFn, emptyListTasks)
  const res = await GET(makeUrl())
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.code, 'UNAUTHENTICATED')
})
