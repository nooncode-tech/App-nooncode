import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getLeadById } from '@/lib/server/leads/repository'
import {
  createLeadActivity,
  listLeadActivities,
} from '@/lib/server/leads/activity-repository'
import {
  mapCreateLeadNoteInputToInsert,
  mapLeadActivityRowToWire,
} from '@/lib/server/leads/activity-mappers'
import { createLeadNoteSchema } from '@/lib/server/leads/activity-schema'

const routeParamsSchema = z.object({
  leadId: z.string().uuid(),
})

const allowedLeadRoles = ['admin', 'sales_manager', 'sales'] as const

function leadNotFoundResponse() {
  return NextResponse.json(
    {
      error: 'Lead not found.',
      code: 'NOT_FOUND',
    },
    { status: 404 }
  )
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    await requireRole(allowedLeadRoles)

    const { leadId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const lead = await getLeadById(client, leadId)

    if (!lead) {
      return leadNotFoundResponse()
    }

    const activities = await listLeadActivities(client, leadId)

    return NextResponse.json({
      data: activities.map(mapLeadActivityRowToWire),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    const principal = await requireRole(allowedLeadRoles)
    const { leadId } = routeParamsSchema.parse(await context.params)
    const payload = createLeadNoteSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const lead = await getLeadById(client, leadId)

    if (!lead) {
      return leadNotFoundResponse()
    }

    const activity = await createLeadActivity(
      client,
      mapCreateLeadNoteInputToInsert(payload, leadId, principal.userId)
    )

    return NextResponse.json(
      {
        data: mapLeadActivityRowToWire(activity),
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
