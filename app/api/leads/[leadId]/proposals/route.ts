import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import type { DatabaseClient } from '@/lib/server/supabase/server'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { getLeadById } from '@/lib/server/leads/repository'
import { listLeadActivities } from '@/lib/server/leads/activity-repository'
import {
  createLeadProposal,
  listLeadProposals,
} from '@/lib/server/leads/proposal-repository'
import { findProposalLinkedProjectFromActivities } from '@/lib/server/leads/proposal-lineage'
import { listProjectsByProposalIds } from '@/lib/server/projects/repository'
import {
  listActiveCheckoutLinksByProposalIds,
  type ActiveCheckoutLinkRow,
} from '@/lib/server/payments/checkout-link-repository'
import {
  mapCreateLeadProposalInputToInsert,
  mapLeadProposalRowToWire,
} from '@/lib/server/leads/proposal-mappers'
import { createLeadProposalSchema } from '@/lib/server/leads/proposal-schema'
import { assertProposalAmountCoversSellerFee } from '@/lib/server/leads/proposal-amount-validation'
import { createSellerFee } from '@/lib/server/seller-fees/service'
import type { SellerFeeAmount } from '@/lib/server/seller-fees/types'
import { cursorPaginationSchema } from '@/lib/server/pagination/schema'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'
import type { AppRole } from '@/lib/server/profiles/types'
import type { CursorPayload } from '@/lib/server/pagination/cursor'

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

// ---------------------------------------------------------------------------
// Testable handler factory
// ---------------------------------------------------------------------------

type GetHandlerDeps = {
  requireRole: (roles: readonly AppRole[]) => Promise<unknown>
  getLeadById: (client: DatabaseClient, leadId: string) => Promise<unknown>
  listLeadProposals: (
    client: DatabaseClient,
    leadId: string,
    opts: { cursor: CursorPayload | null; limit: number }
  ) => Promise<unknown[]>
  listProjectsByProposalIds: (client: DatabaseClient, ids: string[]) => Promise<unknown[]>
  listLeadActivities: (client: DatabaseClient, leadId: string) => Promise<unknown[]>
  listActiveCheckoutLinksByProposalIds: (
    client: DatabaseClient,
    ids: readonly string[]
  ) => Promise<Map<string, ActiveCheckoutLinkRow>>
  createSupabaseServerClient: () => Promise<DatabaseClient>
}

export function createGetLeadProposalsHandler(deps: GetHandlerDeps) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ leadId: string }> }
  ) {
    try {
      await deps.requireRole(allowedLeadRoles)

      const { leadId } = routeParamsSchema.parse(await context.params)
      const { searchParams } = new URL(request.url)
      const pagination = cursorPaginationSchema.parse({
        cursor: searchParams.get('cursor') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
      })

      const cursor = pagination.cursor ? decodeCursor(pagination.cursor) : null

      const client = await deps.createSupabaseServerClient()
      const lead = await deps.getLeadById(client, leadId)

      if (!lead) {
        return leadNotFoundResponse()
      }

      const rawProposals = await deps.listLeadProposals(client, leadId, {
        cursor,
        limit: pagination.limit,
      })

      const proposals = rawProposals as Parameters<typeof mapLeadProposalRowToWire>[0][]
      const proposalIds = proposals.map((proposal) => proposal.id)
      const projects = (await deps.listProjectsByProposalIds(client, proposalIds)) as {
        source_proposal_id?: string | null
        id: string
        name: string
        status: string
        created_at: string
      }[]
      const projectByProposalId = new Map(
        projects
          .filter((project) => project.source_proposal_id)
          .map((project) => [project.source_proposal_id as string, project])
      )
      const leadActivities = await deps.listLeadActivities(client, leadId)
      const activeCheckoutLinkByProposalId = await deps.listActiveCheckoutLinksByProposalIds(
        client,
        proposalIds,
      )

      const envelope = buildCursorResponse(proposals, {
        limit: pagination.limit,
        getCursor: (p) => ({ createdAt: p.created_at, id: p.id }),
      })

      return NextResponse.json({
        data: envelope.data.map((proposal) =>
          mapLeadProposalRowToWire(
            proposal,
            (projectByProposalId.get(proposal.id) as Parameters<typeof mapLeadProposalRowToWire>[1]) ??
              findProposalLinkedProjectFromActivities(
                leadActivities as Parameters<typeof findProposalLinkedProjectFromActivities>[0],
                proposal.id
              ),
            activeCheckoutLinkByProposalId.get(proposal.id) ?? null,
          )
        ),
        meta: envelope.meta,
      })
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  return createGetLeadProposalsHandler({
    requireRole,
    getLeadById,
    listLeadProposals,
    listProjectsByProposalIds,
    listLeadActivities,
    listActiveCheckoutLinksByProposalIds,
    createSupabaseServerClient,
  })(request, context)
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

    assertProposalAmountCoversSellerFee(lead.lead_origin, payload)

    const proposal = await createLeadProposal(
      client,
      mapCreateLeadProposalInputToInsert(payload, leadId, principal.userId)
    )

    // For outbound proposals, persist the seller_fees row with the chosen
    // amount (per ADR-007 §rule 1). Defaults to 100 for backwards compat
    // with callers that pre-date the UI selector (Chunk 4 introduces it).
    // The webhook will read this persisted value to compute the earnings
    // split in Chunk 3b; until 3b ships, the webhook still hard-codes 100
    // — and because the default here is also 100, the behavior is identical
    // during the transition window.
    if (lead.lead_origin === 'outbound') {
      const sellerProfileId = lead.assigned_to ?? lead.created_by
      if (sellerProfileId) {
        const adminClient = createSupabaseAdminClient()
        const amount: SellerFeeAmount = (payload.sellerFeeAmount ?? 100) as SellerFeeAmount
        await createSellerFee(adminClient, {
          proposalId: proposal.id,
          leadId,
          sellerProfileId,
          amount,
        })
      }
      // If neither assigned_to nor created_by is set (unexpected for an
      // outbound lead), we skip seller_fees creation. The webhook fallback
      // in 3b will continue to use the hard-coded $100 for this proposal.
    }

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
