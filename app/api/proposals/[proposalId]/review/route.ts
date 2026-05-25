import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getLeadProposalById } from '@/lib/server/leads/proposal-repository'
import { mapLeadProposalRowToWire } from '@/lib/server/leads/proposal-mappers'
import {
  recordInboundReviewOutcome,
  sendProposalReviewDecisionToWebsite,
} from '@/lib/server/website-integration'

const paramsSchema = z.object({ proposalId: z.string().uuid() })
const bodySchema = z.object({
  action: z.enum(['approve', 'reject', 'request_changes', 'cancel']),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ proposalId: string }> }
) {
  const requestId = getRequestId(request)

  try {
    await assertRateLimit(request, {
      namespace: 'proposal-review',
      limit: 30,
      windowMs: 60_000,
    })

    const principal = await requireRole(['admin', 'pm'])

    const { proposalId } = paramsSchema.parse(await context.params)
    const { action } = bodySchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const adminClient = createSupabaseAdminClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client.rpc as any)('review_proposal', {
      p_proposal_id: proposalId,
      p_action: action,
    })

    if (error) {
      const msg = error.message ?? ''
      if (msg.includes('PROPOSAL_NOT_FOUND')) {
        return jsonWithRequestId({ error: 'Proposal not found.', code: 'NOT_FOUND' }, { status: 404 }, requestId)
      }
      if (msg.includes('FORBIDDEN')) {
        return jsonWithRequestId({ error: 'Forbidden.', code: 'FORBIDDEN' }, { status: 403 }, requestId)
      }
      if (msg.includes('PROPOSAL_NOT_REVIEWABLE')) {
        return jsonWithRequestId({ error: 'Proposal is not in a reviewable state.', code: 'NOT_REVIEWABLE' }, { status: 422 }, requestId)
      }
      throw new Error(msg)
    }

    // PM can review via SECURITY DEFINER RPC but may not pass sales-scoped RLS on
    // lead_proposals. Use the admin client for the post-review read + inbound sync.
    const proposal = await getLeadProposalById(adminClient, proposalId)
    if (!proposal) {
      return jsonWithRequestId({ error: 'Proposal not found.', code: 'NOT_FOUND' }, { status: 404 }, requestId)
    }

    const inboundReview = await recordInboundReviewOutcome(proposalId, action)
    const reviewWebhook = await sendProposalReviewDecisionToWebsite(proposalId, action, {
      id: principal.userId,
      email: principal.email,
      role: principal.role,
    })

    return jsonWithRequestId({
      data: mapLeadProposalRowToWire(proposal),
      meta: {
        inboundReview,
        reviewWebhook,
      },
    }, undefined, requestId)
  } catch (err) {
    return toErrorResponse(err, { requestId })
  }
}
