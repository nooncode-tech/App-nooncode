import { NextResponse } from 'next/server'
import { z } from 'zod'

import { toErrorResponse } from '@/lib/server/api/errors'
import { requireRole } from '@/lib/server/auth/guards'
import { getLeadProposalById } from '@/lib/server/leads/proposal-repository'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { sendProposalReviewDecisionToWebsite } from '@/lib/server/website-integration'

const paramsSchema = z.object({ proposalId: z.string().uuid() })
const actionByReviewStatus = {
  approved: 'approve',
  rejected: 'reject',
  changes_requested: 'request_changes',
  cancelled: 'cancel',
} as const

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  context: { params: Promise<unknown> }
) {
  try {
    const principal = await requireRole(['admin', 'pm'])
    const { proposalId } = paramsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const proposal = await getLeadProposalById(client, proposalId)

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found.', code: 'NOT_FOUND' }, { status: 404 })
    }

    const action = actionByReviewStatus[proposal.review_status as keyof typeof actionByReviewStatus]
    if (!action) {
      return NextResponse.json(
        {
          error: 'Proposal review status cannot be sent to the website.',
          code: 'REVIEW_DECISION_NOT_READY',
        },
        { status: 409 }
      )
    }

    const result = await sendProposalReviewDecisionToWebsite(proposalId, action, {
      id: principal.userId,
      email: principal.email,
      role: principal.role,
    })

    if (result.status === 'not_ready') {
      return NextResponse.json(
        { error: result.reason, code: 'REVIEW_DECISION_NOT_READY', meta: result },
        { status: 409 }
      )
    }

    return NextResponse.json({ data: result })
  } catch (error) {
    return toErrorResponse(error)
  }
}
