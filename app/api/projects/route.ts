import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { mapProjectRowToWire } from '@/lib/server/projects/mappers'
import { listProjects } from '@/lib/server/projects/repository'

const allowedProjectListRoles = ['admin', 'sales_manager', 'pm', 'developer'] as const

export async function GET() {
  try {
    await requireRole(allowedProjectListRoles)

    const client = await createSupabaseServerClient()
    const projects = await listProjects(client)

    return NextResponse.json({
      data: projects.map(mapProjectRowToWire),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
