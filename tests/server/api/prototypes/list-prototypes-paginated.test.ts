import assert from 'node:assert/strict'
import test from 'node:test'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { decodeCursor, encodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'
import { toErrorResponse } from '@/lib/server/api/errors'
import type { CursorPayload } from '@/lib/server/pagination/cursor'

// ---------------------------------------------------------------------------
// Local schema matching the retrofitted route schema
// ---------------------------------------------------------------------------

const listPrototypeWorkspacesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  leadId: z.string().uuid().optional(),
  cursor: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

interface PrototypeRow {
  id: string
  lead_id: string
  updated_at: string
  created_at: string
  [key: string]: unknown
}

type Principal = { userId: string; role: string }
type RequireRoleFn = () => Promise<Principal>
type CreateClientFn = () => Promise<unknown>
type ListPrototypesFn = (
  client: unknown,
  opts: { cursor: CursorPayload | null; limit: number; leadId?: string }
) => Promise<PrototypeRow[]>

function makeGETHandler(deps: {
  requireRole: RequireRoleFn
  createSupabaseServerClient: CreateClientFn
  listPrototypeWorkspaces: ListPrototypesFn
}) {
  return async function GET(request: Request) {
    try {
      await deps.requireRole()
      const url = new URL(request.url)
      const query = listPrototypeWorkspacesQuerySchema.parse({
        limit: url.searchParams.get('limit') ?? undefined,
        leadId: url.searchParams.get('leadId') ?? undefined,
        cursor: url.searchParams.get('cursor') ?? undefined,
      })

      const cursorPayload = query.cursor ? decodeCursor(query.cursor) : null
      const client = await deps.createSupabaseServerClient()

      const rows = await deps.listPrototypeWorkspaces(client, {
        cursor: cursorPayload,
        limit: query.limit,
        leadId: query.leadId,
      })

      return NextResponse.json(
        buildCursorResponse(rows, {
          limit: query.limit,
          getCursor: (item) => ({ createdAt: item.updated_at, id: item.id }),
        })
      )
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUrl(params: Record<string, string> = {}) {
  const url = new URL('https://app.test/api/prototypes')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

const fakeClient = {}
const createClientStub: CreateClientFn = async () => fakeClient
const allowedRole: RequireRoleFn = async () => ({ userId: 'user-1', role: 'admin' })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('existing ?leadId filter still works — forwarded to repository', async () => {
  let capturedLeadId: string | undefined

  const listStub: ListPrototypesFn = async (_client, opts) => {
    capturedLeadId = opts.leadId
    return []
  }

  const GET = makeGETHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    listPrototypeWorkspaces: listStub,
  })

  await GET(makeUrl({ leadId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }))
  assert.equal(capturedLeadId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
})

test('?cursor accepted and passed through to repository', async () => {
  const expectedCursor: CursorPayload = { createdAt: '2026-05-01T10:00:00Z', id: 'proto-1' }
  const encoded = encodeCursor(expectedCursor)

  let receivedCursor: CursorPayload | null | undefined
  const listStub: ListPrototypesFn = async (_client, opts) => {
    receivedCursor = opts.cursor
    return []
  }

  const GET = makeGETHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    listPrototypeWorkspaces: listStub,
  })

  const res = await GET(makeUrl({ cursor: encoded }))
  assert.equal(res.status, 200)
  assert.deepEqual(receivedCursor, expectedCursor)
})

test('default limit is 100', async () => {
  let capturedLimit: number | undefined
  const listStub: ListPrototypesFn = async (_client, opts) => {
    capturedLimit = opts.limit
    return []
  }

  const GET = makeGETHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    listPrototypeWorkspaces: listStub,
  })

  await GET(makeUrl())
  assert.equal(capturedLimit, 100)
})

test('malformed cursor → first page (cursor null), status 200', async () => {
  let receivedCursor: CursorPayload | null | undefined
  const listStub: ListPrototypesFn = async (_client, opts) => {
    receivedCursor = opts.cursor
    return []
  }

  const GET = makeGETHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    listPrototypeWorkspaces: listStub,
  })

  const res = await GET(makeUrl({ cursor: 'not-valid!!!' }))
  assert.equal(res.status, 200)
  assert.equal(receivedCursor, null)
})
