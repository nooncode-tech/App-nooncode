import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { listPrototypeWorkspacesQuerySchema } from '@/lib/server/prototypes/schema'
import { listVisiblePrototypeWorkspaces } from '@/lib/server/prototypes/service'

const allowedPrototypeRoles = ['admin', 'sales_manager', 'sales'] as const

export async function GET(request: Request) {
  try {
    const principal = await requireRole(allowedPrototypeRoles)
    const url = new URL(request.url)
    const query = listPrototypeWorkspacesQuerySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      leadId: url.searchParams.get('leadId') ?? undefined,
    })
    const client = await createSupabaseServerClient()
    const result = await listVisiblePrototypeWorkspaces(client, principal, query)

    return NextResponse.json({
      data: result.items,
      meta: {
        limit: query.limit,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
