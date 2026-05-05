import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import {
  receiveWebsiteInboundProposal,
  websiteInboundProposalPayloadSchema,
} from '@/lib/server/website-integration'
import { readSignedWebsiteJson, WebsiteWebhookError } from '@/lib/server/website-webhook-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    assertRateLimit(request, {
      namespace: 'website-inbound-proposal',
      limit: 120,
      windowMs: 60_000,
    })

    const payload = await readSignedWebsiteJson(request, websiteInboundProposalPayloadSchema)
    const result = await receiveWebsiteInboundProposal(payload)

    logger.info('website.inbound_proposal.received', {
      requestId,
      externalSessionId: payload.external_session_id,
      externalProposalId: payload.external_proposal_id,
      idempotent: result.idempotent,
    })

    return jsonWithRequestId({ data: result }, { status: result.idempotent ? 200 : 201 }, requestId)
  } catch (error) {
    if (error instanceof WebsiteWebhookError) {
      logger.warn('website.inbound_proposal.rejected', {
        requestId,
        status: error.status,
        ...errorToLogContext(error),
      })
      return jsonWithRequestId(
        { error: error.message, code: 'WEBSITE_WEBHOOK_AUTH_FAILED' },
        { status: error.status },
        requestId
      )
    }

    logger.warn('website.inbound_proposal.failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return toErrorResponse(error, { requestId })
  }
}
