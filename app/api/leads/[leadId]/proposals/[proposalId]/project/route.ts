import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { getLeadById } from '@/lib/server/leads/repository'
import { getLeadProposalById } from '@/lib/server/leads/proposal-repository'
import {
  createProject,
  getProjectByProposalId,
  getProjectById,
} from '@/lib/server/projects/repository'
import {
  mapLeadAndProposalToProjectInsert,
  mapProjectRowToWire,
} from '@/lib/server/projects/mappers'
import { linkVisibleLeadPrototypeWorkspaceToProject } from '@/lib/server/prototypes/service'

const routeParamsSchema = z.object({
  leadId: z.string().uuid(),
  proposalId: z.string().uuid(),
})

const allowedProjectCreateRoles = ['admin', 'sales_manager', 'sales', 'pm'] as const

function notFoundResponse(message: string) {
  return NextResponse.json(
    {
      error: message,
      code: 'NOT_FOUND',
    },
    { status: 404 }
  )
}

function conflictResponse(message: string) {
  return NextResponse.json(
    {
      error: message,
      code: 'CONFLICT',
    },
    { status: 409 }
  )
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ leadId: string; proposalId: string }> }
) {
  try {
    const principal = await requireRole(allowedProjectCreateRoles)
    const { leadId, proposalId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()

    const lead = await getLeadById(client, leadId)

    if (!lead) {
      return notFoundResponse('Lead not found.')
    }

    const proposal = await getLeadProposalById(client, proposalId)

    if (!proposal || proposal.lead_id !== leadId) {
      return notFoundResponse('Proposal not found.')
    }

    if (proposal.status !== 'handoff_ready') {
      return conflictResponse('Only handoff-ready proposals can be converted into projects.')
    }

    const existingProject = await getProjectByProposalId(client, proposalId)

    if (existingProject) {
      await linkVisibleLeadPrototypeWorkspaceToProject(client, leadId, existingProject.id)
      const reloadedProject = await getProjectById(client, existingProject.id)

      return NextResponse.json({
        data: mapProjectRowToWire(reloadedProject ?? existingProject),
        meta: {
          created: false,
        },
      })
    }

    const project = await createProject(
      client,
      mapLeadAndProposalToProjectInsert(lead, proposal, principal.userId)
    )
    await linkVisibleLeadPrototypeWorkspaceToProject(client, leadId, project.id)
    const reloadedProject = await getProjectById(client, project.id)

    return NextResponse.json(
      {
        data: mapProjectRowToWire(reloadedProject ?? project),
        meta: {
          created: true,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
