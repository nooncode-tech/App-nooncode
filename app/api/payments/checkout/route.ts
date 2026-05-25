import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { ApiError, ConflictApiError, NotFoundApiError } from '@/lib/server/api/errors'
import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { createCheckoutSession } from '@/lib/server/stripe/service'
import { getLeadById } from '@/lib/server/leads/repository'
import { getLeadProposalById } from '@/lib/server/leads/proposal-repository'
import { assertSalesLeadOwnership } from '@/lib/server/leads/permissions'

const bodySchema = z.object({
  proposalId: z.string().uuid(),
}).passthrough()

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    await assertRateLimit(request, {
      namespace: 'payments-checkout',
      limit: 20,
      windowMs: 60_000,
    })

    const principal = await requireRole(['admin', 'sales_manager', 'sales', 'pm'])
    const body = bodySchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const adminClient = createSupabaseAdminClient()

    const proposal = await getLeadProposalById(client, body.proposalId)
    if (!proposal) {
      throw new NotFoundApiError('Proposal not found.')
    }

    const lead = await getLeadById(client, proposal.lead_id)
    if (!lead) {
      throw new NotFoundApiError('Lead not found.')
    }

    assertSalesLeadOwnership(principal, lead)

    if (lead.lead_origin === 'inbound') {
      throw new ConflictApiError(
        'Inbound payment links are created by the website after PM approval.',
        'INBOUND_PAYMENT_LINK_OWNED_BY_WEBSITE'
      )
    }

    if (proposal.review_status !== 'approved') {
      throw new ApiError(
        'PROPOSAL_REQUIRES_PM_APPROVAL',
        'Proposal must be approved by PM before payment.',
        422
      )
    }

    if (!['sent', 'accepted', 'handoff_ready'].includes(proposal.status)) {
      throw new ApiError(
        'PROPOSAL_NOT_READY_FOR_PAYMENT',
        'Proposal must be sent before payment.',
        422
      )
    }

    if (proposal.amount <= 0) {
      throw new ApiError(
        'PROPOSAL_AMOUNT_MUST_BE_POSITIVE',
        'Proposal amount must be greater than zero.',
        422
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.headers.get('origin') ?? 'http://localhost:3000'

    const { url, paymentId, checkoutSessionId, expiresAt } = await createCheckoutSession(
      adminClient,
      principal,
      {
        proposalId: proposal.id,
        leadId: lead.id,
        amount: Number(proposal.amount),
        currency: proposal.currency,
        clientName: lead.company ?? lead.name,
        clientEmail: lead.email || null,
        proposalTitle: proposal.title,
      },
      appUrl,
    )

    return jsonWithRequestId(
      { data: { url, paymentId, checkoutSessionId, expiresAt } },
      undefined,
      requestId,
    )
  } catch (error) {
    return toErrorResponse(error, { requestId })
  }
}
