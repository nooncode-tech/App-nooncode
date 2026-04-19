import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createTaskSchema } from '@/lib/server/tasks/schema'
import { mapCreateTaskInputToInsert, mapTaskRowToWire } from '@/lib/server/tasks/mappers'
import { createTask, listTasks } from '@/lib/server/tasks/repository'
import { getProjectById } from '@/lib/server/projects/repository'

const allowedTaskRoles = ['admin', 'pm', 'developer'] as const
const allowedTaskCreateRoles = ['admin', 'pm'] as const

function projectNotFoundResponse() {
  return NextResponse.json(
    {
      error: 'Project not found.',
      code: 'NOT_FOUND',
    },
    { status: 404 }
  )
}

export async function GET() {
  try {
    await requireRole(allowedTaskRoles)

    const client = await createSupabaseServerClient()
    const tasks = await listTasks(client)

    return NextResponse.json({
      data: tasks.map(mapTaskRowToWire),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireRole(allowedTaskCreateRoles)
    const payload = createTaskSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const project = await getProjectById(client, payload.projectId)

    if (!project) {
      return projectNotFoundResponse()
    }

    const task = await createTask(
      client,
      mapCreateTaskInputToInsert(payload, principal.userId)
    )

    return NextResponse.json(
      {
        data: mapTaskRowToWire(task),
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
