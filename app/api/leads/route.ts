import { NextResponse } from 'next/server'
import { createLeadSchema } from '@/lib/server/leads/schema'
import { mapCreateLeadInputToInsert, mapLeadRowToWire } from '@/lib/server/leads/mappers'
import { createLead, listLeads } from '@/lib/server/leads/repository'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'

const allowedLeadRoles = ['admin', 'sales_manager', 'sales'] as const

export async function GET() {
  try {
    await requireRole(allowedLeadRoles)

    const client = await createSupabaseServerClient()
    const leads = await listLeads(client)

    return NextResponse.json({
      data: leads.map(mapLeadRowToWire),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

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
