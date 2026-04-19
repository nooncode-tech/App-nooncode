import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getLeadById } from '@/lib/server/leads/repository'
import { listLeadActivities } from '@/lib/server/leads/activity-repository'
import {
  createLeadProposal,
  listLeadProposals,
} from '@/lib/server/leads/proposal-repository'
import { findProposalLinkedProjectFromActivities } from '@/lib/server/leads/proposal-lineage'
import { listProjectsByProposalIds } from '@/lib/server/projects/repository'
import {
  mapCreateLeadProposalInputToInsert,
  mapLeadProposalRowToWire,
} from '@/lib/server/leads/proposal-mappers'
import { createLeadProposalSchema } from '@/lib/server/leads/proposal-schema'

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

    const proposals = await listLeadProposals(client, leadId)
    const proposalIds = proposals.map((proposal) => proposal.id)
    const projects = await listProjectsByProposalIds(client, proposalIds)
    const projectByProposalId = new Map(
      projects
        .filter((project) => project.source_proposal_id)
        .map((project) => [project.source_proposal_id as string, project])
    )
    const leadActivities = await listLeadActivities(client, leadId)

    return NextResponse.json({
      data: proposals.map((proposal) =>
        mapLeadProposalRowToWire(
          proposal,
          projectByProposalId.get(proposal.id)
            ?? findProposalLinkedProjectFromActivities(leadActivities, proposal.id)
        )
      ),
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
    const payload = createLeadProposalSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const lead = await getLeadById(client, leadId)

    if (!lead) {
      return leadNotFoundResponse()
    }

    const proposal = await createLeadProposal(
      client,
      mapCreateLeadProposalInputToInsert(payload, leadId, principal.userId)
    )

    return NextResponse.json(
      {
        data: mapLeadProposalRowToWire(proposal),
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
