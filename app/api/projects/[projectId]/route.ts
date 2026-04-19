import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { updateProjectSchema } from '@/lib/server/projects/schema'
import {
  getProjectById,
  updateProjectById,
} from '@/lib/server/projects/repository'
import {
  mapProjectRowToWire,
  mapUpdateProjectInputToUpdate,
} from '@/lib/server/projects/mappers'

const routeParamsSchema = z.object({
  projectId: z.string().uuid(),
})

const allowedProjectUpdateRoles = ['admin', 'pm'] as const

function projectNotFoundResponse() {
  return NextResponse.json(
    {
      error: 'Project not found.',
      code: 'NOT_FOUND',
    },
    { status: 404 }
  )
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    await requireRole(allowedProjectUpdateRoles)

    const { projectId } = routeParamsSchema.parse(await context.params)
    const payload = updateProjectSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const project = await getProjectById(client, projectId)

    if (!project) {
      return projectNotFoundResponse()
    }

    const updatedProject = await updateProjectById(
      client,
      projectId,
      mapUpdateProjectInputToUpdate(payload)
    )

    return NextResponse.json({
      data: mapProjectRowToWire(updatedProject),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
