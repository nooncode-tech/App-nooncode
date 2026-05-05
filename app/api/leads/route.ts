import { NextResponse } from 'next/server'
import { createLeadSchema } from '@/lib/server/leads/schema'
import { mapCreateLeadInputToInsert, mapLeadRowToWire } from '@/lib/server/leads/mappers'
import { createLead, listLeads } from '@/lib/server/leads/repository'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import type { DatabaseClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { offsetPaginationSchema } from '@/lib/server/pagination/schema'
import { buildOffsetResponse } from '@/lib/server/pagination/envelope'
import type { LeadRowWithProfiles } from '@/lib/server/leads/types'
import type { AppRole } from '@/lib/server/profiles/types'

const allowedLeadRoles = ['admin', 'sales_manager', 'sales'] as const

// ---------------------------------------------------------------------------
// Testable handler factory
// ---------------------------------------------------------------------------

type GetHandlerDeps = {
  requireRole: (roles: readonly AppRole[]) => Promise<unknown>
  listLeads: (client: DatabaseClient, pagination: { page: number; limit: number }) => Promise<{ rows: unknown[]; total: number }>
  createSupabaseServerClient: () => Promise<DatabaseClient>
  mapRow?: (row: unknown) => unknown
}

export function createGetLeadsHandler(deps: GetHandlerDeps) {
  return async function GET(request: Request) {
    try {
      await deps.requireRole(allowedLeadRoles)

      const { searchParams } = new URL(request.url)
      const query = offsetPaginationSchema.parse({
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
      })

      const client = await deps.createSupabaseServerClient()
      const { rows, total } = await deps.listLeads(client, query)

      const mapRow = deps.mapRow ?? ((r: unknown) => r)
      const result = buildOffsetResponse(rows.map(mapRow), {
        page: query.page,
        limit: query.limit,
        total,
      })

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

// ---------------------------------------------------------------------------
// Next.js route exports
// ---------------------------------------------------------------------------

export const GET = createGetLeadsHandler({
  requireRole,
  listLeads,
  createSupabaseServerClient,
  mapRow: (row) => mapLeadRowToWire(row as LeadRowWithProfiles),
})

export async function POST(request: Request) {
  try {
    const principal = await requireRole(allowedLeadRoles)
    const payload = createLeadSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const lead = await createLead(client, mapCreateLeadInputToInsert(payload, principal.userId))

    return NextResponse.json(
      {
        data: mapLeadRowToWire(lead),
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
