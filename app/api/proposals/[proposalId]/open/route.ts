import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { markProposalFirstOpened } from '@/lib/server/leads/proposal-repository'
import { mapLeadProposalRowToWire } from '@/lib/server/leads/proposal-mappers'

const paramsSchema = z.object({ proposalId: z.string().uuid() })

export async function POST(
  request: Request,
  context: { params: Promise<{ proposalId: string }> }
) {
  const requestId = getRequestId(request)

  try {
    assertRateLimit(request, {
      namespace: 'proposal-open',
      limit: 60,
      windowMs: 60_000,
    })

    await requireRole(['admin', 'pm', 'sales_manager', 'sales'])

    const { proposalId } = paramsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()

    const proposal = await markProposalFirstOpened(client, proposalId)

    return jsonWithRequestId({ data: mapLeadProposalRowToWire(proposal) }, undefined, requestId)
  } catch (err) {
    return toErrorResponse(err, { requestId })
  }
}
