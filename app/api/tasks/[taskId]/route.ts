import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { updateTaskSchema } from '@/lib/server/tasks/schema'
import { mapTaskRowToWire, mapUpdateTaskInputToUpdate } from '@/lib/server/tasks/mappers'
import { getTaskById, updateTaskById } from '@/lib/server/tasks/repository'

const routeParamsSchema = z.object({
  taskId: z.string().uuid(),
})

const allowedTaskRoles = ['admin', 'pm', 'developer'] as const
const developerAllowedFields = ['status', 'actualHours'] as const

function taskNotFoundResponse() {
  return NextResponse.json(
    {
      error: 'Task not found.',
      code: 'NOT_FOUND',
    },
    { status: 404 }
  )
}

function forbiddenTaskUpdateResponse(message: string) {
  return NextResponse.json(
    {
      error: message,
      code: 'FORBIDDEN',
    },
    { status: 403 }
  )
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const principal = await requireRole(allowedTaskRoles)
    const { taskId } = routeParamsSchema.parse(await context.params)
    const payload = updateTaskSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const task = await getTaskById(client, taskId)

    if (!task) {
      return taskNotFoundResponse()
    }

    if (principal.role === 'developer') {
      if (!principal.profile.legacy_mock_id || task.assigned_legacy_user_id !== principal.profile.legacy_mock_id) {
        return forbiddenTaskUpdateResponse('Developers can only update tasks assigned to them.')
      }

      const touchedFields = Object.keys(payload)
      const includesRestrictedField = touchedFields.some(
        (field) => !developerAllowedFields.includes(field as (typeof developerAllowedFields)[number])
      )

      if (includesRestrictedField) {
        return forbiddenTaskUpdateResponse('Developers can only update task status or logged hours.')
      }
    }

    const updatedTask = await updateTaskById(
      client,
      taskId,
      mapUpdateTaskInputToUpdate(payload)
    )

    return NextResponse.json({
      data: mapTaskRowToWire(updatedTask),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
