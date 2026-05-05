import assert from 'node:assert/strict'
import test from 'node:test'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { decodeCursor, encodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'
import { toErrorResponse } from '@/lib/server/api/errors'
import type { CursorPayload } from '@/lib/server/pagination/cursor'

// ---------------------------------------------------------------------------
// Local schema (same as the one used in the route — max 200, default 100)
// ---------------------------------------------------------------------------

const earningsHistorySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

type Principal = { userId: string; role: string }
type GetPrincipalFn = () => Promise<Principal | null>
type CreateClientFn = () => Promise<unknown>
type ListEarningsFn = (
  client: unknown,
  profileId: string,
  opts: { cursor: CursorPayload | null; limit: number }
) => Promise<EarningsRow[]>
type ListAllEarningsFn = (
  client: unknown,
  opts: { cursor: CursorPayload | null; limit: number }
) => Promise<EarningsRow[]>

interface EarningsRow {
  id: string
  created_at: string
  [key: string]: unknown
}

function makeGETHandler(deps: {
  getCurrentPrincipal: GetPrincipalFn
  createSupabaseServerClient: CreateClientFn
  listEarningsHistory: ListEarningsFn
  listAllEarningsHistory: ListAllEarningsFn
}) {
  return async function GET(request: Request) {
    try {
      const principal = await deps.getCurrentPrincipal()

      if (!principal) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { searchParams } = new URL(request.url)
      const parsed = earningsHistorySchema.parse({
        cursor: searchParams.get('cursor') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
      })

      const cursorPayload = parsed.cursor ? decodeCursor(parsed.cursor) : null
      const isAdmin = principal.role === 'admin' || principal.role === 'pm'
      const client = await deps.createSupabaseServerClient()

      const rows = isAdmin
        ? await deps.listAllEarningsHistory(client, { cursor: cursorPayload, limit: parsed.limit })
        : await deps.listEarningsHistory(client, principal.userId, {
            cursor: cursorPayload,
            limit: parsed.limit,
          })

      return NextResponse.json(
        buildCursorResponse(rows, {
          limit: parsed.limit,
          getCursor: (item) => ({ createdAt: item.created_at, id: item.id }),
        })
      )
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(i: number): EarningsRow {
  return {
    id: `entry-${i}`,
    created_at: `2026-05-0${i}T10:00:00Z`,
    amount: 100 * i,
  }
}

function makeUrl(params: Record<string, string> = {}) {
  const url = new URL('https://app.test/api/earnings/history')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

const fakeClient = {}
const createClientStub: CreateClientFn = async () => fakeClient
const adminPrincipal: GetPrincipalFn = async () => ({ userId: 'admin-1', role: 'admin' })
const userPrincipal: GetPrincipalFn = async () => ({ userId: 'user-1', role: 'sales' })
const noSession: GetPrincipalFn = async () => null

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('default limit is 100', async () => {
  let capturedLimit: number | undefined
  const listStub: ListEarningsFn = async (_client, _profileId, opts) => {
    capturedLimit = opts.limit
    return []
  }

  const GET = makeGETHandler({
    getCurrentPrincipal: userPrincipal,
    createSupabaseServerClient: createClientStub,
    listEarningsHistory: listStub,
    listAllEarningsHistory: async () => [],
  })

  const res = await GET(makeUrl())
  assert.equal(res.status, 200)
  assert.equal(capturedLimit, 100)
})

test('limit cap is 200 (not 100)', async () => {
  let capturedLimit: number | undefined
  const listStub: ListEarningsFn = async (_client, _profileId, opts) => {
    capturedLimit = opts.limit
    return []
  }

  const GET = makeGETHandler({
    getCurrentPrincipal: userPrincipal,
    createSupabaseServerClient: createClientStub,
    listEarningsHistory: listStub,
    listAllEarningsHistory: async () => [],
  })

  // Request 200 — should be accepted
  const res = await GET(makeUrl({ limit: '200' }))
  assert.equal(res.status, 200)
  assert.equal(capturedLimit, 200)

  // Request 201 — should be clamped/rejected by Zod (results in 400 or 422)
  const res2 = await GET(makeUrl({ limit: '201' }))
  assert.notEqual(res2.status, 200)
})

test('?cursor accepted and passed through to repository', async () => {
  const expectedCursor: CursorPayload = { createdAt: '2026-05-01T10:00:00Z', id: 'entry-1' }
  const encoded = encodeCursor(expectedCursor)

  let receivedCursor: CursorPayload | null | undefined
  const listStub: ListEarningsFn = async (_client, _profileId, opts) => {
    receivedCursor = opts.cursor
    return []
  }

  const GET = makeGETHandler({
    getCurrentPrincipal: userPrincipal,
    createSupabaseServerClient: createClientStub,
    listEarningsHistory: listStub,
    listAllEarningsHistory: async () => [],
  })

  const res = await GET(makeUrl({ cursor: encoded }))
  assert.equal(res.status, 200)
  assert.deepEqual(receivedCursor, expectedCursor)
})

test('malformed cursor → first page (cursor null), status 200', async () => {
  let receivedCursor: CursorPayload | null | undefined
  const listStub: ListEarningsFn = async (_client, _profileId, opts) => {
    receivedCursor = opts.cursor
    return []
  }

  const GET = makeGETHandler({
    getCurrentPrincipal: userPrincipal,
    createSupabaseServerClient: createClientStub,
    listEarningsHistory: listStub,
    listAllEarningsHistory: async () => [],
  })

  const res = await GET(makeUrl({ cursor: 'not-valid!!!' }))
  assert.equal(res.status, 200)
  assert.equal(receivedCursor, null)
})

test('admin path calls listAllEarningsHistory (returns all users earnings)', async () => {
  let calledAll = false
  let calledUser = false

  const listUserStub: ListEarningsFn = async () => {
    calledUser = true
    return []
  }
  const listAllStub: ListAllEarningsFn = async () => {
    calledAll = true
    return []
  }

  const GET = makeGETHandler({
    getCurrentPrincipal: adminPrincipal,
    createSupabaseServerClient: createClientStub,
    listEarningsHistory: listUserStub,
    listAllEarningsHistory: listAllStub,
  })

  await GET(makeUrl())
  assert.ok(calledAll, 'listAllEarningsHistory should have been called')
  assert.ok(!calledUser, 'listEarningsHistory should NOT have been called')
})

test('non-admin scopes to userId — listEarningsHistory receives correct profileId', async () => {
  let receivedProfileId: string | undefined

  const listStub: ListEarningsFn = async (_client, profileId) => {
    receivedProfileId = profileId
    return []
  }

  const GET = makeGETHandler({
    getCurrentPrincipal: userPrincipal,
    createSupabaseServerClient: createClientStub,
    listEarningsHistory: listStub,
    listAllEarningsHistory: async () => [],
  })

  await GET(makeUrl())
  assert.equal(receivedProfileId, 'user-1')
})
