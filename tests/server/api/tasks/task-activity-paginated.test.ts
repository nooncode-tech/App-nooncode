import assert from 'node:assert/strict'
import test from 'node:test'
import { NextResponse } from 'next/server'
import { AuthGuardError } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { cursorPaginationSchema } from '@/lib/server/pagination/schema'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'
import { mapTaskActivityRowToWire } from '@/lib/server/tasks/activity-mappers'
import type { CursorPayload } from '@/lib/server/pagination/cursor'
import type { TaskActivityRowWithActor } from '@/lib/server/tasks/activity-types'

// ---------------------------------------------------------------------------
// Handler factory (injects dependencies)
// ---------------------------------------------------------------------------

type ListTaskActivitiesFn = (
  client: unknown,
  taskId: string,
  opts: { cursor: CursorPayload | null; limit: number }
) => Promise<TaskActivityRowWithActor[]>

type GetTaskByIdFn = (client: unknown, taskId: string) => Promise<{ id: string; assigned_legacy_user_id: string | null } | null>
type RequireRoleFn = () => Promise<{ userId: string; role: string; profile?: { legacy_mock_id?: string | null } }>
type CreateClientFn = () => Promise<unknown>

function makeGETActivityHandler(deps: {
  requireRole: RequireRoleFn
  createSupabaseServerClient: CreateClientFn
  getTaskById: GetTaskByIdFn
  listTaskActivities: ListTaskActivitiesFn
}) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ taskId: string }> }
  ) {
    try {
      await deps.requireRole()
      const { taskId } = await context.params
      const client = await deps.createSupabaseServerClient()
      const task = await deps.getTaskById(client, taskId)

      if (!task) {
        return NextResponse.json({ error: 'Task not found.', code: 'NOT_FOUND' }, { status: 404 })
      }

      const { searchParams } = new URL(request.url)
      const pagination = cursorPaginationSchema.parse({
        cursor: searchParams.get('cursor') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
      })

      const cursorPayload = pagination.cursor ? decodeCursor(pagination.cursor) : null

      const rows = await deps.listTaskActivities(client, taskId, {
        cursor: cursorPayload,
        limit: pagination.limit,
      })

      return NextResponse.json(
        buildCursorResponse(rows.map(mapTaskActivityRowToWire), {
          limit: pagination.limit,
          getCursor: (item) => ({ createdAt: item.createdAt, id: item.id }),
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

function makeRow(i: number): TaskActivityRowWithActor {
  return {
    id: `act-${i}`,
    task_id: 'task-1',
    activity_type: 'note_added',
    actor_profile_id: 'user-1',
    note_body: `Note ${i}`,
    metadata: {},
    created_at: `2026-05-0${i}T10:00:00Z`,
    actor_profile: { full_name: 'Alice', legacy_mock_id: null },
  }
}

function makeUrl(taskId: string, params: Record<string, string> = {}) {
  const url = new URL(`https://app.test/api/tasks/${taskId}/activity`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new Request(url.toString())
}

const fakeClient = {}
const createClientStub: CreateClientFn = async () => fakeClient
const allowedRole: RequireRoleFn = async () => ({ userId: 'user-1', role: 'admin' })
const unauthorizedRole: RequireRoleFn = async () => {
  throw new AuthGuardError('UNAUTHENTICATED', 'An active session is required.', 401)
}
const taskExists: GetTaskByIdFn = async () => ({ id: 'task-1', assigned_legacy_user_id: null })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('first page (no cursor) → data has items, meta.nextCursor is non-null string', async () => {
  const rows = Array.from({ length: 11 }, (_, i) => makeRow(i + 1))
  const listStub: ListTaskActivitiesFn = async () => rows

  const GET = makeGETActivityHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    getTaskById: taskExists,
    listTaskActivities: listStub,
  })

  const res = await GET(makeUrl('task-1', { limit: '10' }), { params: Promise.resolve({ taskId: 'task-1' }) })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.data.length, 10)
  assert.equal(typeof body.meta.nextCursor, 'string')
  assert.ok(body.meta.nextCursor.length > 0)
})

test('valid cursor → next slice returned, no overlap with first page', async () => {
  const firstPageRows = Array.from({ length: 10 }, (_, i) => makeRow(i + 1))
  const secondPageRows = Array.from({ length: 5 }, (_, i) => makeRow(i + 11))

  const listStub: ListTaskActivitiesFn = async (_client, _taskId, opts) => {
    if (opts.cursor === null) return [...firstPageRows, makeRow(11)] // first page has next
    return secondPageRows // second page: exactly 5 (< limit)
  }

  const GET = makeGETActivityHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    getTaskById: taskExists,
    listTaskActivities: listStub,
  })

  const res1 = await GET(makeUrl('task-1', { limit: '10' }), { params: Promise.resolve({ taskId: 'task-1' }) })
  const body1 = await res1.json()
  const nextCursor = body1.meta.nextCursor as string

  const res2 = await GET(makeUrl('task-1', { cursor: nextCursor, limit: '10' }), {
    params: Promise.resolve({ taskId: 'task-1' }),
  })
  const body2 = await res2.json()

  assert.equal(res2.status, 200)
  assert.equal(body2.data.length, 5)
  assert.equal(body2.meta.nextCursor, null)

  const ids1 = new Set(body1.data.map((r: { id: string }) => r.id))
  for (const item of body2.data) {
    assert.ok(!ids1.has(item.id), `Item ${item.id} should not appear in both pages`)
  }
})

test('last page → meta.nextCursor is null', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => makeRow(i + 1))
  const listStub: ListTaskActivitiesFn = async () => rows

  const GET = makeGETActivityHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    getTaskById: taskExists,
    listTaskActivities: listStub,
  })

  const res = await GET(makeUrl('task-1'), { params: Promise.resolve({ taskId: 'task-1' }) })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.meta.nextCursor, null)
})

test('malformed cursor → treated as first page, status 200 (NOT 400)', async () => {
  const rows = Array.from({ length: 3 }, (_, i) => makeRow(i + 1))
  const listStub: ListTaskActivitiesFn = async (_client, _taskId, opts) => {
    assert.equal(opts.cursor, null)
    return rows
  }

  const GET = makeGETActivityHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    getTaskById: taskExists,
    listTaskActivities: listStub,
  })

  const res = await GET(makeUrl('task-1', { cursor: 'not-valid-base64-json!!' }), {
    params: Promise.resolve({ taskId: 'task-1' }),
  })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.data.length, 3)
})

test('empty list → meta.nextCursor null', async () => {
  const listStub: ListTaskActivitiesFn = async () => []

  const GET = makeGETActivityHandler({
    requireRole: allowedRole,
    createSupabaseServerClient: createClientStub,
    getTaskById: taskExists,
    listTaskActivities: listStub,
  })

  const res = await GET(makeUrl('task-1'), { params: Promise.resolve({ taskId: 'task-1' }) })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.deepEqual(body.data, [])
  assert.equal(body.meta.nextCursor, null)
})

test('unauthenticated → 401', async () => {
  const listStub: ListTaskActivitiesFn = async () => []

  const GET = makeGETActivityHandler({
    requireRole: unauthorizedRole,
    createSupabaseServerClient: createClientStub,
    getTaskById: taskExists,
    listTaskActivities: listStub,
  })

  const res = await GET(makeUrl('task-1'), { params: Promise.resolve({ taskId: 'task-1' }) })

  assert.equal(res.status, 401)
})
