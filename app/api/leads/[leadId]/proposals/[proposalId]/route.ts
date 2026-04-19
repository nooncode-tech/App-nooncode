import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { listLeadActivities } from '@/lib/server/leads/activity-repository'
import { findProposalLinkedProjectFromActivities } from '@/lib/server/leads/proposal-lineage'
import {
  getLeadProposalById,
  updateLeadProposalById,
} from '@/lib/server/leads/proposal-repository'
import { getProjectByProposalId } from '@/lib/server/projects/repository'
import {
  mapLeadProposalRowToWire,
  mapUpdateLeadProposalInputToUpdate,
} from '@/lib/server/leads/proposal-mappers'
import { updateLeadProposalSchema } from '@/lib/server/leads/proposal-schema'

const routeParamsSchema = z.object({
  leadId: z.string().uuid(),
  proposalId: z.string().uuid(),
})

const allowedLeadRoles = ['admin', 'sales_manager', 'sales'] as const

function proposalNotFoundResponse() {
  return NextResponse.json(
    {
      error: 'Proposal not found.',
      code: 'NOT_FOUND',
    },
    { status: 404 }
  )
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ leadId: string; proposalId: string }> }
) {
  try {
    await requireRole(allowedLeadRoles)

    const { leadId, proposalId } = routeParamsSchema.parse(await context.params)
    const payload = updateLeadProposalSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const proposal = await getLeadProposalById(client, proposalId)

    if (!proposal || proposal.lead_id !== leadId) {
      return proposalNotFoundResponse()
    }

    const updatedProposal = await updateLeadProposalById(
      client,
      proposalId,
      mapUpdateLeadProposalInputToUpdate(payload)
    )
    const linkedProject = await getProjectByProposalId(client, proposalId)
    const leadActivities = linkedProject ? [] : await listLeadActivities(client, leadId)

    return NextResponse.json({
      data: mapLeadProposalRowToWire(
        updatedProposal,
        linkedProject ?? findProposalLinkedProjectFromActivities(leadActivities, proposalId)
      ),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
