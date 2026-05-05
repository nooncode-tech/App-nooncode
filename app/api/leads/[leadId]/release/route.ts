import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import {
  ConflictApiError,
  NotFoundApiError,
  toErrorResponse,
} from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { mapLeadRowToWire } from '@/lib/server/leads/mappers'
import {
  getLeadById,
  releaseLeadAsNoResponseById,
} from '@/lib/server/leads/repository'

const routeParamsSchema = z.object({
  leadId: z.string().uuid(),
})

const allowedLeadRoles = ['admin', 'sales_manager', 'sales'] as const

export async function POST(
  _request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    await requireRole(allowedLeadRoles)

    const { leadId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const lead = await getLeadById(client, leadId)

    if (!lead) {
      throw new NotFoundApiError('Lead not found.')
    }

    if (lead.assignment_status !== 'proposal_locked') {
      throw new ConflictApiError('Only proposal-locked leads can be released as no response.')
    }

    const releasedLead = await releaseLeadAsNoResponseById(client, leadId)

    return NextResponse.json({
      data: mapLeadRowToWire(releasedLead),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
