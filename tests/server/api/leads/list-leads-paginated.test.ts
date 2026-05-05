import assert from 'node:assert/strict'
import test from 'node:test'
import { createGetLeadsHandler } from '@/app/api/leads/route'
import { AuthGuardError } from '@/lib/server/auth/guards'
import type { DatabaseClient } from '@/lib/server/supabase/server'

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

type StubPrincipal = { userId: string; role: 'admin' }

function makeHandler({
  rows = [] as unknown[],
  total = 0,
  principal = { userId: 'user-1', role: 'admin' } as StubPrincipal,
  authError = null as Error | null,
} = {}) {
  const requireRoleStub = async () => {
    if (authError) throw authError
    return principal
  }

  const listLeadsStub = async () => ({
    rows,
    total,
  })

  const createClientStub = async () => ({}) as DatabaseClient

  return createGetLeadsHandler({
    requireRole: requireRoleStub,
    listLeads: listLeadsStub,
    createSupabaseServerClient: createClientStub,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('default request (no params) → page=1, limit=100, response has meta fields', async () => {
  const handler = makeHandler({
    rows: [{ id: 'lead-1' }],
    total: 1,
  })

  const request = new Request('https://app.test/api/leads')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.meta.page, 1)
  assert.equal(body.meta.limit, 100)
  assert.equal(body.meta.total, 1)
  assert.equal(body.meta.pageCount, 1)
})

test('explicit ?page=2&limit=10 → meta reflects those values', async () => {
  const handler = makeHandler({ rows: [], total: 25 })

  const request = new Request('https://app.test/api/leads?page=2&limit=10')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.meta.page, 2)
  assert.equal(body.meta.limit, 10)
  assert.equal(body.meta.total, 25)
  assert.equal(body.meta.pageCount, 3)
})

test('?limit=200 exceeds max → clamped to 100, status 200', async () => {
  const handler = makeHandler({ rows: [], total: 0 })

  const request = new Request('https://app.test/api/leads?limit=200')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.meta.limit, 100)
})

test('empty result → { data: [], meta: { page:1, limit:100, total:0, pageCount:0 } }', async () => {
  const handler = makeHandler({ rows: [], total: 0 })

  const request = new Request('https://app.test/api/leads')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body.data, [])
  assert.deepEqual(body.meta, { page: 1, limit: 100, total: 0, pageCount: 0 })
})

test('unauthenticated → 401', async () => {
  const authError = new AuthGuardError('UNAUTHENTICATED', 'An active session is required.', 401)
  const handler = makeHandler({ authError })

  const request = new Request('https://app.test/api/leads')
  const response = await handler(request)

  assert.equal(response.status, 401)
})
