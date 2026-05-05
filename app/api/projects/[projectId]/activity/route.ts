import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getProjectById } from '@/lib/server/projects/repository'
import {
  listProjectActivities,
  listTaskActivitiesByProject,
} from '@/lib/server/projects/activity-repository'
import {
  mapProjectActivityRowToVisibleWire,
  mapProjectTaskActivityRowToVisibleWire,
} from '@/lib/server/projects/activity-mappers'

const routeParamsSchema = z.object({
  projectId: z.string().uuid(),
})

const allowedProjectActivityRoles = ['admin', 'sales_manager', 'pm', 'developer'] as const

function projectNotFoundResponse() {
  return NextResponse.json(
    {
      error: 'Project not found.',
      code: 'NOT_FOUND',
    },
    { status: 404 }
  )
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireRole(allowedProjectActivityRoles)

    const { projectId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const project = await getProjectById(client, projectId)

    if (!project) {
      return projectNotFoundResponse()
    }

    const [projectActivities, taskActivities] = await Promise.all([
      listProjectActivities(client, projectId),
      listTaskActivitiesByProject(client, projectId),
    ])

    const data = [
      ...projectActivities.map(mapProjectActivityRowToVisibleWire),
      ...taskActivities.map(mapProjectTaskActivityRowToVisibleWire),
    ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

    return NextResponse.json({ data })
  } catch (error) {
    return toErrorResponse(error)
  }
}
