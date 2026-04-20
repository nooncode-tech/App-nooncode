import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { markProposalFirstOpened } from '@/lib/server/leads/proposal-repository'
import { mapLeadProposalRowToWire } from '@/lib/server/leads/proposal-mappers'

const paramsSchema = z.object({ proposalId: z.string().uuid() })

export async function POST(
  _request: Request,
  context: { params: Promise<{ proposalId: string }> }
) {
  try {
    await requireRole(['admin', 'pm', 'sales_manager', 'sales'])

    const { proposalId } = paramsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()

    const proposal = await markProposalFirstOpened(client, proposalId)

    return NextResponse.json({ data: mapLeadProposalRowToWire(proposal) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
