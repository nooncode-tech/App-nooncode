import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import {
  receiveWebsitePaymentConfirmed,
  websitePaymentConfirmedPayloadSchema,
} from '@/lib/server/website-integration'
import { readSignedWebsiteJson, WebsiteWebhookError } from '@/lib/server/website-webhook-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    await assertRateLimit(request, {
      namespace: 'website-payment-confirmed',
      limit: 120,
      windowMs: 60_000,
    })

    const payload = await readSignedWebsiteJson(request, websitePaymentConfirmedPayloadSchema)
    const result = await receiveWebsitePaymentConfirmed(payload)

    logger.info('website.payment_confirmed.received', {
      requestId,
      externalSessionId: payload.external_session_id,
      externalProposalId: payload.external_proposal_id,
      externalPaymentId: payload.external_payment_id,
      idempotent: result.idempotent,
    })

    return jsonWithRequestId({ data: result }, { status: result.idempotent ? 200 : 201 }, requestId)
  } catch (error) {
    if (error instanceof WebsiteWebhookError) {
      logger.warn('website.payment_confirmed.rejected', {
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

    logger.warn('website.payment_confirmed.failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return toErrorResponse(error, { requestId })
  }
}
