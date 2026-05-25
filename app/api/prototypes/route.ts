import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { listPrototypeWorkspacesQuerySchema } from '@/lib/server/prototypes/schema'
import { listVisiblePrototypeWorkspaces } from '@/lib/server/prototypes/service'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'

const allowedPrototypeRoles = ['admin', 'sales_manager', 'sales', 'pm'] as const

export async function GET(request: Request) {
  try {
    const principal = await requireRole(allowedPrototypeRoles)
    const url = new URL(request.url)
    const query = listPrototypeWorkspacesQuerySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      leadId: url.searchParams.get('leadId') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    })
    const cursorPayload = query.cursor ? decodeCursor(query.cursor) : null
    const client = await createSupabaseServerClient()
    const result = await listVisiblePrototypeWorkspaces(client, principal, {
      ...query,
      cursor: cursorPayload,
    })

    return NextResponse.json(
      buildCursorResponse(result.items, {
        limit: query.limit,
        getCursor: (item) => ({ createdAt: (item as unknown as { updatedAt: string }).updatedAt, id: (item as unknown as { id: string }).id }),
      })
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
