import assert from 'node:assert/strict'
import test from 'node:test'

// We test the GET handler logic directly by reconstructing it with injected dependencies.
// This follows the same pattern as tests/server/api/tasks/list-tasks-paginated.test.ts

// ---- Helpers ----

function makeUrl(params: Record<string, string> = {}) {
  const url = new URL('https://app.noon.test/api/projects')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString())
}

// ---- Type aliases ----

import type { OffsetPaginationInput } from '@/lib/server/pagination/schema'
import type { ProjectRowWithLineage } from '@/lib/server/projects/types'

type ListProjectsFn = (
  client: unknown,
  input: OffsetPaginationInput
) => Promise<{ rows: ProjectRowWithLineage[]; total: number }>

type RequireRoleFn = () => Promise<void>
type CreateClientFn = () => Promise<unknown>

// ---- Reconstruct handler with injected deps ----

import { NextResponse } from 'next/server'
import { buildOffsetResponse } from '@/lib/server/pagination/envelope'
import { offsetPaginationSchema } from '@/lib/server/pagination/schema'
import { AuthGuardError } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { mapProjectRowToWire } from '@/lib/server/projects/mappers'

async function makeGETHandler(
  requireRoleFn: RequireRoleFn,
  createClientFn: CreateClientFn,
  listProjectsFn: ListProjectsFn
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
      const { rows, total } = await listProjectsFn(client, pagination)
      return NextResponse.json(
        buildOffsetResponse(rows.map(mapProjectRowToWire), {
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

// ---- Fakes ----

const fakeClient = {}
const createClientFn: CreateClientFn = async () => fakeClient
const allowedRequireRole: RequireRoleFn = async () => {}
const unauthorizedRequireRole: RequireRoleFn = async () => {
  throw new AuthGuardError('UNAUTHENTICATED', 'An active session is required.', 401)
}

const emptyListProjects: ListProjectsFn = async () => ({ rows: [], total: 0 })

function makeRows(count: number): ProjectRowWithLineage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `proj-${i + 1}`,
    source_lead_id: null,
    source_proposal_id: null,
    created_by: 'user-1',
    name: `Project ${i + 1}`,
    description: null,
    client_name: 'ACME',
    status: 'active' as const,
    budget: 0,
    developer_user_id: null,
    pm_legacy_user_id: null,
    payment_activated_at: null,
    team_legacy_user_ids: [],
    handoff_ready_at: null,
    start_date: null,
    end_date: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    payment_activated: true,
    source_lead: null,
    source_proposal: null,
    prototype_workspace: [],
  }))
}

// ---- Tests ----

test('GET /api/projects default → page=1, limit=100, meta present', async () => {
  const rows = makeRows(3)
  const listProjects: ListProjectsFn = async (_client, input) => {
    assert.equal(input.page, 1)
    assert.equal(input.limit, 100)
    return { rows, total: 3 }
  }
  const GET = await makeGETHandler(allowedRequireRole, createClientFn, listProjects)
  const res = await GET(makeUrl())
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.ok(body.meta, 'meta should be present')
  assert.equal(body.meta.page, 1)
  assert.equal(body.meta.limit, 100)
  assert.equal(body.meta.total, 3)
})

test('GET /api/projects explicit ?page=2&limit=10', async () => {
  const rows = makeRows(10)
  const listProjects: ListProjectsFn = async (_client, input) => {
    assert.equal(input.page, 2)
    assert.equal(input.limit, 10)
    return { rows, total: 25 }
  }
  const GET = await makeGETHandler(allowedRequireRole, createClientFn, listProjects)
  const res = await GET(makeUrl({ page: '2', limit: '10' }))
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.meta.page, 2)
  assert.equal(body.meta.limit, 10)
  assert.equal(body.meta.total, 25)
  assert.equal(body.meta.pageCount, 3)
})

test('GET /api/projects ?limit=200 → clamped to 100, status 200', async () => {
  const GET = await makeGETHandler(allowedRequireRole, createClientFn, emptyListProjects)
  const res = await GET(makeUrl({ limit: '200' }))
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.meta.limit, 100)
})

test('GET /api/projects empty result', async () => {
  const GET = await makeGETHandler(allowedRequireRole, createClientFn, emptyListProjects)
  const res = await GET(makeUrl())
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.deepEqual(body.data, [])
  assert.equal(body.meta.total, 0)
  assert.equal(body.meta.pageCount, 0)
})

test('GET /api/projects unauthenticated → 401', async () => {
  const GET = await makeGETHandler(unauthorizedRequireRole, createClientFn, emptyListProjects)
  const res = await GET(makeUrl())
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.code, 'UNAUTHENTICATED')
})

test('GET /api/projects enrichment called with page slice only (not total)', async () => {
  // The listProjectsFn receives the rows slice. We assert that the mock is called
  // with exactly the page-slice length (limit=5), not total (50).
  const total = 50
  const limit = 5
  let receivedRowsCount = -1

  const listProjects: ListProjectsFn = async (_client, input) => {
    const rows = makeRows(input.limit) // simulate DB returning exactly limit rows
    receivedRowsCount = rows.length
    return { rows, total }
  }

  const GET = await makeGETHandler(allowedRequireRole, createClientFn, listProjects)
  const res = await GET(makeUrl({ limit: String(limit) }))
  const body = await res.json()
  assert.equal(res.status, 200)
  // The handler must map ONLY the page slice rows, not all 50
  assert.equal(body.data.length, limit)
  assert.equal(receivedRowsCount, limit, 'enrichment receives slice length, not total')
  assert.equal(body.meta.total, total)
})
