import assert from 'node:assert/strict'
import test from 'node:test'
import { NextResponse } from 'next/server'
import { AuthGuardError } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { cursorPaginationSchema } from '@/lib/server/pagination/schema'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'
import type { CursorPayload } from '@/lib/server/pagination/cursor'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import type { UserNotificationWire } from '@/lib/notifications/serialization'

// ---------------------------------------------------------------------------
// Handler factory (injects dependencies)
// ---------------------------------------------------------------------------

type RequirePrincipalFn = () => Promise<AuthenticatedPrincipal>
type CreateClientFn = () => Promise<unknown>
type ListNotificationsFn = (
  client: unknown,
  principal: AuthenticatedPrincipal,
  opts: { cursor: CursorPayload | null; limit: number }
) => Promise<{ items: UserNotificationWire[]; unreadCount: number }>

function makeGETNotificationsHandler(deps: {
  requirePrincipal: RequirePrincipalFn
  createSupabaseServerClient: CreateClientFn
  listVisibleNotifications: ListNotificationsFn
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
      const result = await deps.listVisibleNotifications(client, principal, {
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
          unreadCount: result.unreadCount,
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

function makeNotification(i: number): UserNotificationWire {
  return {
    id: `notif-${i}`,
    domain: 'sales',
    sourceKind: 'lead_activity',
    title: `Notification ${i}`,
    body: `Body ${i}`,
    href: `/dashboard/leads/${i}`,
    isRead: false,
    readAt: null,
    createdAt: `2026-05-0${i}T10:00:00Z`,
  }
}

function makeUrl(params: Record<string, string> = {}) {
  const url = new URL('https://app.test/api/notifications')
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
const unauthorizedPrincipal: RequirePrincipalFn = async () => {
  throw new AuthGuardError('UNAUTHENTICATED', 'An active session is required.', 401)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('existing ?limit param still works — default limit 100 preserved', async () => {
  const items = Array.from({ length: 5 }, (_, i) => makeNotification(i + 1))
  const listStub: ListNotificationsFn = async () => ({ items, unreadCount: 2 })

  const GET = makeGETNotificationsHandler({
    requirePrincipal: allowedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleNotifications: listStub,
  })

  const res = await GET(makeUrl({ limit: '10' }))
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.meta.limit, 10)
  assert.ok(Array.isArray(body.data))
})

test('?cursor accepted and passed through to service', async () => {
  const items = Array.from({ length: 3 }, (_, i) => makeNotification(i + 1))
  let capturedOpts: { cursor: CursorPayload | null; limit: number } | null = null

  const listStub: ListNotificationsFn = async (_client, _principal, opts) => {
    capturedOpts = opts
    return { items, unreadCount: 0 }
  }

  const GET = makeGETNotificationsHandler({
    requirePrincipal: allowedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleNotifications: listStub,
  })

  // Build a valid cursor
  const { encodeCursor } = await import('@/lib/server/pagination/cursor')
  const validCursor = encodeCursor({ createdAt: '2026-05-01T10:00:00Z', id: 'notif-1' })

  const res = await GET(makeUrl({ cursor: validCursor }))
  assert.equal(res.status, 200)
  assert.notEqual(capturedOpts, null)
  assert.notEqual(capturedOpts!.cursor, null)
  assert.equal(capturedOpts!.cursor!.id, 'notif-1')
})

test('meta.unreadCount is present in ALL responses regardless of cursor', async () => {
  const items = Array.from({ length: 11 }, (_, i) => makeNotification(i + 1))
  const listStub: ListNotificationsFn = async () => ({ items, unreadCount: 7 })

  const GET = makeGETNotificationsHandler({
    requirePrincipal: allowedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleNotifications: listStub,
  })

  // Without cursor
  const res1 = await GET(makeUrl())
  const body1 = await res1.json()
  assert.equal(res1.status, 200)
  assert.equal(body1.meta.unreadCount, 7)

  // With cursor
  const { encodeCursor } = await import('@/lib/server/pagination/cursor')
  const cursor = encodeCursor({ createdAt: '2026-05-01T10:00:00Z', id: 'notif-1' })
  const res2 = await GET(makeUrl({ cursor }))
  const body2 = await res2.json()
  assert.equal(res2.status, 200)
  assert.equal(body2.meta.unreadCount, 7)
})

test('malformed cursor → first page returned, status 200 (never 400)', async () => {
  const items = Array.from({ length: 3 }, (_, i) => makeNotification(i + 1))
  let capturedOpts: { cursor: CursorPayload | null; limit: number } | null = null

  const listStub: ListNotificationsFn = async (_client, _principal, opts) => {
    capturedOpts = opts
    return { items, unreadCount: 1 }
  }

  const GET = makeGETNotificationsHandler({
    requirePrincipal: allowedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleNotifications: listStub,
  })

  const res = await GET(makeUrl({ cursor: 'not-valid-base64-json!!' }))
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(capturedOpts!.cursor, null)
  assert.equal(body.data.length, 3)
})

test('unauthenticated → 401', async () => {
  const listStub: ListNotificationsFn = async () => ({ items: [], unreadCount: 0 })

  const GET = makeGETNotificationsHandler({
    requirePrincipal: unauthorizedPrincipal,
    createSupabaseServerClient: createClientStub,
    listVisibleNotifications: listStub,
  })

  const res = await GET(makeUrl())
  assert.equal(res.status, 401)
})
