import assert from 'node:assert/strict'
import test from 'node:test'
import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { cursorPaginationSchema } from '@/lib/server/pagination/schema'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'
import type { CursorPayload } from '@/lib/server/pagination/cursor'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import type { UpdateFeedItemWire } from '@/lib/updates/serialization'
import type { UpdateFeedDomain } from '@/lib/types'

// ---------------------------------------------------------------------------
// Handler factory (injects dependencies)
// ---------------------------------------------------------------------------

type RequirePrincipalFn = () => Promise<AuthenticatedPrincipal>
type CreateClientFn = () => Promise<unknown>
type ListUpdatesFn = (
  client: unknown,
  principal: AuthenticatedPrincipal,
  opts: { cursor: CursorPayload | null; limit: number }
) => Promise<{ items: UpdateFeedItemWire[]; domains: UpdateFeedDomain[] }>

function makeGETUpdatesHandler(deps: {
  requirePrincipal: RequirePrincipalFn
  createSupabaseServerClient: CreateClientFn
  listVisibleUpdates: ListUpdatesFn
}) {
  return async function GET(request: Request) {
    try {
      const principal = await deps.requirePrincipal()
      const url = new URL(request.url)
      const query = cursorPaginationSchema.parse({
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit: url.searchParams.get('limit') ?? undefined,
      })
      const cursorPayload = query.cursor ? decodeCursor(query.cursor) : null
      const client = await deps.createSupabaseServerClient()
      const result = await deps.listVisibleUpdates(client, principal, {
        cursor: cursorPayload,
        limit: query.limit,
      })

      const envelope = buildCursorResponse(result.items, {
        limit: query.limit,
        getCursor: (item) => ({ createdAt: item.createdAt, id: item.id }),
      })

      return NextResponse.json({
        data: envelope.data,
        meta: {
          domains: result.domains,
          limit: envelope.meta.limit,
          nextCursor: envelope.meta.nextCursor,
        },
      })
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUpdate(i: number): UpdateFeedItemWire {
  return {
    id: `update-${i}`,
    domain: 'sales',
    sourceKind: 'lead_activity',
    eventType: 'note_added',
    actorName: 'Alice',
    title: `Update ${i}`,
    description: '',
    entityLabel: `Lead ${i}`,
    href: `/dashboard/leads/${i}`,
    createdAt: `2026-05-0${i}T10:00:00Z`,
  }
}

function makeUrl(params: Record<string, string> = {}) {
  const url = new URL('https://app.test/api/updates')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

const fakePrincipal = {
  profile: { id: 'profile-1' },
  role: 'admin',
} as unknown as AuthenticatedPrincipal

const fakeClient = {}
const createClientStub: CreateClientFn = async () => fakeClient
const allowedPrincipal: RequirePrincipalFn = async () => fakePrincipal

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('existing ?limit param still works', async () => {
  const items = Array.from({ length: 5 }, (_, i) => makeUpdate(i + 1))
  const listStub: ListUpdatesFn = async () => ({ items, domains: ['sales', 'delivery'] })

  const GET = makeGETUpdatesHandler({
    requirePrincipal: allowedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleUpdates: listStub,
  })

  const res = await GET(makeUrl({ limit: '20' }))
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.meta.limit, 20)
  assert.ok(Array.isArray(body.data))
})

test('?cursor accepted and passed through to service', async () => {
  const items = Array.from({ length: 3 }, (_, i) => makeUpdate(i + 1))
  let capturedOpts: { cursor: CursorPayload | null; limit: number } | null = null

  const listStub: ListUpdatesFn = async (_client, _principal, opts) => {
    capturedOpts = opts
    return { items, domains: ['sales'] }
  }

  const GET = makeGETUpdatesHandler({
    requirePrincipal: allowedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleUpdates: listStub,
  })

  const { encodeCursor } = await import('@/lib/server/pagination/cursor')
  const validCursor = encodeCursor({ createdAt: '2026-05-01T10:00:00Z', id: 'update-1' })

  const res = await GET(makeUrl({ cursor: validCursor }))
  assert.equal(res.status, 200)
  assert.notEqual(capturedOpts, null)
  assert.notEqual(capturedOpts!.cursor, null)
  assert.equal(capturedOpts!.cursor!.id, 'update-1')
})

test('meta.domains preserved in response', async () => {
  const items = Array.from({ length: 11 }, (_, i) => makeUpdate(i + 1))
  const listStub: ListUpdatesFn = async () => ({
    items,
    // domains comes from visibility set, independent of pagination
    domains: ['sales', 'delivery'],
  })

  const GET = makeGETUpdatesHandler({
    requirePrincipal: allowedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleUpdates: listStub,
  })

  const res = await GET(makeUrl({ limit: '5' }))
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.deepEqual(body.meta.domains, ['sales', 'delivery'])
  // Only 5 items returned (sliced), but domains remain complete
  assert.equal(body.data.length, 5)
  assert.equal(typeof body.meta.nextCursor, 'string')
})

test('malformed cursor → first page returned, status 200 (never 400)', async () => {
  const items = Array.from({ length: 3 }, (_, i) => makeUpdate(i + 1))
  let capturedOpts: { cursor: CursorPayload | null; limit: number } | null = null

  const listStub: ListUpdatesFn = async (_client, _principal, opts) => {
    capturedOpts = opts
    return { items, domains: ['sales'] }
  }

  const GET = makeGETUpdatesHandler({
    requirePrincipal: allowedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleUpdates: listStub,
  })

  const res = await GET(makeUrl({ cursor: 'not-valid-base64-json!!' }))
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(capturedOpts!.cursor, null)
  assert.equal(body.data.length, 3)
})
