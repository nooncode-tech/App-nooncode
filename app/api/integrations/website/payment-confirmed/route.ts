import crypto from 'node:crypto'

import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import {
  receiveWebsitePaymentConfirmed,
  websitePaymentConfirmedPayloadSchema,
} from '@/lib/server/website-integration'
import {
  readSignedWebsiteJsonWithRawBody,
  WebsiteWebhookError,
} from '@/lib/server/website-webhook-auth'
import {
  composeReplayResponseFromLedger,
  markWebsiteWebhookEventFailed,
  markWebsiteWebhookEventProcessed,
  recordWebsiteWebhookEvent,
  websiteWebhookLedgerEnabled,
} from '@/lib/server/website/webhook-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    await assertRateLimit(request, {
      namespace: 'website-payment-confirmed',
      limit: 120,
      windowMs: 60_000,
    })

    const { payload, bodyText, signatureHeader, timestamp } =
      await readSignedWebsiteJsonWithRawBody(request, websitePaymentConfirmedPayloadSchema)

    if (!websiteWebhookLedgerEnabled()) {
      const result = await receiveWebsitePaymentConfirmed(payload)
      logger.info('website.payment_confirmed.received', {
        requestId,
        externalSessionId: payload.external_session_id,
        externalProposalId: payload.external_proposal_id,
        externalPaymentId: payload.external_payment_id,
        idempotent: result.idempotent,
        ledger: 'disabled',
      })
      return jsonWithRequestId(
        { data: result },
        { status: result.idempotent ? 200 : 201 },
        requestId,
      )
    }

    const signatureHash = sha256Hex(`${timestamp}.${bodyText}`)
    const payloadHash = sha256Hex(bodyText)
    const adminClient = createSupabaseAdminClient()

    const ledger = await recordWebsiteWebhookEvent(adminClient, {
      endpoint: 'payment-confirmed',
      signatureHeader,
      signatureHash,
      payloadHash,
      requestId,
    })

    if (!ledger.shouldProcess) {
      const replay = await composeReplayResponseFromLedger(adminClient, ledger)
      if (replay) {
        logger.info('website.payment_confirmed.replayed', {
          requestId,
          externalSessionId: payload.external_session_id,
          externalProposalId: payload.external_proposal_id,
          externalPaymentId: payload.external_payment_id,
          ledgerEventId: ledger.eventId,
          ledgerAttemptCount: ledger.attemptCount,
        })
        return jsonWithRequestId({ data: replay }, { status: 200 }, requestId)
      }
    }

    try {
      const result = await receiveWebsitePaymentConfirmed(payload)
      await markWebsiteWebhookEventProcessed(adminClient, ledger.eventId, {
        externalSessionId: payload.external_session_id,
        externalProposalId: payload.external_proposal_id,
        externalPaymentId: payload.external_payment_id,
        linkId: result.linkId,
      })

      logger.info('website.payment_confirmed.received', {
        requestId,
        externalSessionId: payload.external_session_id,
        externalProposalId: payload.external_proposal_id,
        externalPaymentId: payload.external_payment_id,
        idempotent: result.idempotent,
        ledgerEventId: ledger.eventId,
        ledgerAttemptCount: ledger.attemptCount,
      })

      return jsonWithRequestId(
        { data: result },
        { status: result.idempotent ? 200 : 201 },
        requestId,
      )
    } catch (innerError) {
      await markWebsiteWebhookEventFailed(adminClient, ledger.eventId, innerError)
      throw innerError
    }
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
