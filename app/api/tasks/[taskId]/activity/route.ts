import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getTaskById } from '@/lib/server/tasks/repository'
import {
  createTaskActivity,
  listTaskActivities,
} from '@/lib/server/tasks/activity-repository'
import {
  mapCreateTaskNoteInputToInsert,
  mapTaskActivityRowToWire,
} from '@/lib/server/tasks/activity-mappers'
import { createTaskNoteSchema } from '@/lib/server/tasks/activity-schema'
import { cursorPaginationSchema } from '@/lib/server/pagination/schema'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'

const routeParamsSchema = z.object({
  taskId: z.string().uuid(),
})

const allowedTaskRoles = ['admin', 'pm', 'developer'] as const

function taskNotFoundResponse() {
  return NextResponse.json(
    {
      error: 'Task not found.',
      code: 'NOT_FOUND',
    },
    { status: 404 }
  )
}

function forbiddenTaskActivityResponse(message: string) {
  return NextResponse.json(
    {
      error: message,
      code: 'FORBIDDEN',
    },
    { status: 403 }
  )
}

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const principal = await requireRole(allowedTaskRoles)
    const { taskId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const task = await getTaskById(client, taskId)

    if (!task) {
      return taskNotFoundResponse()
    }

    if (
      principal.role === 'developer'
      && (!principal.profile.legacy_mock_id || task.assigned_legacy_user_id !== principal.profile.legacy_mock_id)
    ) {
      return forbiddenTaskActivityResponse('Developers can only view activity for tasks assigned to them.')
    }

    const { searchParams } = new URL(request.url)
    const pagination = cursorPaginationSchema.parse({
      cursor: searchParams.get('cursor') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    })

    const cursorPayload = pagination.cursor ? decodeCursor(pagination.cursor) : null

    const rows = await listTaskActivities(client, taskId, {
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

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const principal = await requireRole(allowedTaskRoles)
    const { taskId } = routeParamsSchema.parse(await context.params)
    const payload = createTaskNoteSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const task = await getTaskById(client, taskId)

    if (!task) {
      return taskNotFoundResponse()
    }

    if (
      principal.role === 'developer'
      && (!principal.profile.legacy_mock_id || task.assigned_legacy_user_id !== principal.profile.legacy_mock_id)
    ) {
      return forbiddenTaskActivityResponse('Developers can only add notes to tasks assigned to them.')
    }

    const activity = await createTaskActivity(
      client,
      mapCreateTaskNoteInputToInsert(payload, taskId, principal.userId)
    )

    return NextResponse.json(
      {
        data: mapTaskActivityRowToWire(activity),
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
