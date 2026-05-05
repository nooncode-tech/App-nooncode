import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { mapProjectRowToWire } from '@/lib/server/projects/mappers'
import { listProjects } from '@/lib/server/projects/repository'
import { offsetPaginationSchema } from '@/lib/server/pagination/schema'
import { buildOffsetResponse } from '@/lib/server/pagination/envelope'

const allowedProjectListRoles = ['admin', 'sales_manager', 'pm', 'developer'] as const

export async function GET(request: Request) {
  try {
    await requireRole(allowedProjectListRoles)

    const { searchParams } = new URL(request.url)
    const pagination = offsetPaginationSchema.parse({
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    })

    const client = await createSupabaseServerClient()
    const { rows, total } = await listProjects(client, pagination)

    return NextResponse.json(
      buildOffsetResponse(rows.map(mapProjectRowToWire), {
        page: pagination.page,
        limit: pagination.limit,
        total,
      })
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
