import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { ApiError, toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getLeadById } from '@/lib/server/leads/repository'
import { assertSalesLeadOwnership } from '@/lib/server/leads/permissions'
import { parseMaxwellFeedbackInput } from '@/lib/server/maxwell/lead-engine'

const routeParamsSchema = z.object({
  leadId: z.string().uuid(),
})

const allowedRoles = ['admin', 'sales_manager', 'sales', 'pm'] as const

export async function POST(
  request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    const principal = await requireRole(allowedRoles)
    const { leadId } = routeParamsSchema.parse(await context.params)
    const input = parseMaxwellFeedbackInput(await request.json())
    const client = await createSupabaseServerClient()
    const lead = await getLeadById(client, leadId)

    if (!lead) {
      throw new ApiError('NOT_FOUND', 'Lead not found.', 404)
    }

    assertSalesLeadOwnership(principal, lead)

    if (lead.source !== 'maxwell') {
      throw new ApiError('NOT_MAXWELL_LEAD', 'Feedback is only available for Maxwell leads.', 422)
    }

    const { data, error } = await client
      .from('maxwell_lead_feedback')
      .insert({
        lead_id: leadId,
        search_run_id: lead.maxwell_search_run_id,
        profile_id: principal.userId,
        rating: input.rating,
        note: input.note?.trim() || null,
      })
      .select('id, rating, note, created_at')
      .single()

    if (error || !data) {
      throw new ApiError(
        'MAXWELL_FEEDBACK_FAILED',
        error?.message ?? 'Could not save Maxwell feedback.',
        500
      )
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
