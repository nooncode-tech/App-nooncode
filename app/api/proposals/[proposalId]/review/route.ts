import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getLeadProposalById } from '@/lib/server/leads/proposal-repository'
import { mapLeadProposalRowToWire } from '@/lib/server/leads/proposal-mappers'

const paramsSchema = z.object({ proposalId: z.string().uuid() })
const bodySchema = z.object({
  action: z.enum(['approve', 'reject', 'cancel']),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ proposalId: string }> }
) {
  try {
    await requireRole(['admin', 'pm'])

    const { proposalId } = paramsSchema.parse(await context.params)
    const { action } = bodySchema.parse(await request.json())
    const client = await createSupabaseServerClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (client.rpc as any)('review_proposal', {
      p_proposal_id: proposalId,
      p_action: action,
    })

    if (error) {
      const msg = error.message ?? ''
      if (msg.includes('PROPOSAL_NOT_FOUND')) {
        return NextResponse.json({ error: 'Proposal not found.', code: 'NOT_FOUND' }, { status: 404 })
      }
      if (msg.includes('FORBIDDEN')) {
        return NextResponse.json({ error: 'Forbidden.', code: 'FORBIDDEN' }, { status: 403 })
      }
      if (msg.includes('PROPOSAL_NOT_REVIEWABLE')) {
        return NextResponse.json({ error: 'Proposal is not in a reviewable state.', code: 'NOT_REVIEWABLE' }, { status: 422 })
      }
      throw new Error(msg)
    }

    // Re-fetch with linked_project join
    const proposal = await getLeadProposalById(client, proposalId)
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found.', code: 'NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json({ data: mapLeadProposalRowToWire(proposal) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
