import crypto from 'node:crypto'

import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import {
  receiveWebsitePrototypeShare,
  websitePrototypeSharePayloadSchema,
} from '@/lib/server/website-integration'
import {
  readSignedWebsiteJsonWithRawBody,
  WebsiteWebhookError,
} from '@/lib/server/website-webhook-auth'
import {
  composePrototypeShareReplayResponseFromLedger,
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

function sha256Truncated(input: string): string {
  return sha256Hex(input).slice(0, 16)
}

/**
 * Inbound prototype-share webhook (NoonWeb -> App).
 *
 * Symmetry-pair with `inbound-proposal`, `payment-confirmed`, and
 * `prototype-decision`. See:
 *   - ADR-028 (wire contract; D1-D16 + Q-piedra-1..5 + Q-pedro-1..6 resolutions)
 *   - docs/integrations/cross-repo-webhook-v1.md §5A
 *   - Migration: supabase/migrations/0063_phase_23a_prototype_share_endpoint.sql
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    await assertRateLimit(request, {
      namespace: 'website-prototype-share',
      limit: 120,
      windowMs: 60_000,
    })

    const { payload, bodyText, signatureHeader, timestamp } =
      await readSignedWebsiteJsonWithRawBody(
        request,
        websitePrototypeSharePayloadSchema,
      )

    // Ledger-disabled fallback per ADR-016 D9 kill-switch. Application-level
    // dedup on (external_session_id, v0_chat_id) remains the safety net.
    if (!websiteWebhookLedgerEnabled()) {
      const result = await receiveWebsitePrototypeShare(payload, null)

      logger.info('website.prototype_share.received', {
        requestId,
        prototypeWorkspaceId: result.prototypeWorkspaceId,
        leadId: result.leadId,
        shareTokenHash: sha256Truncated(result.shareToken),
        idempotent: result.idempotent,
        supersededCount: result.supersededWorkspaceIds.length,
        ledger: 'disabled',
      })

      return jsonWithRequestId(
        {
          data: {
            idempotent: result.idempotent,
            share_token: result.shareToken,
            prototype_workspace_id: result.prototypeWorkspaceId,
            lead_id: result.leadId,
            version_number: result.versionNumber,
            issued_at: result.issuedAt,
            superseded_workspace_ids: result.supersededWorkspaceIds,
          },
        },
        { status: result.idempotent ? 200 : 201 },
        requestId,
      )
    }

    const signatureHash = sha256Hex(`${timestamp}.${bodyText}`)
    const payloadHash = sha256Hex(bodyText)
    const adminClient = createSupabaseAdminClient()

    const ledger = await recordWebsiteWebhookEvent(adminClient, {
      endpoint: 'prototype-share',
      signatureHeader,
      signatureHash,
      payloadHash,
      requestId,
    })

    if (!ledger.shouldProcess) {
      const replay = await composePrototypeShareReplayResponseFromLedger(
        adminClient,
        ledger,
      )
      if (replay) {
        logger.info('website.prototype_share.replayed', {
          requestId,
          prototypeWorkspaceId: replay.prototypeWorkspaceId,
          leadId: replay.leadId,
          shareTokenHash: sha256Truncated(replay.shareToken),
          ledgerEventId: ledger.eventId,
          ledgerAttemptCount: ledger.attemptCount,
        })
        return jsonWithRequestId(
          {
            data: {
              idempotent: true,
              share_token: replay.shareToken,
              prototype_workspace_id: replay.prototypeWorkspaceId,
              lead_id: replay.leadId,
              version_number: replay.versionNumber,
              issued_at: replay.issuedAt,
              superseded_workspace_ids: replay.supersededWorkspaceIds,
            },
          },
          { status: 200 },
          requestId,
        )
      }
      // Defensive: ledger says processed but FK-join failed. Application-
      // level dedup on (external_session_id, v0_chat_id) is the safety net —
      // re-running the handler is safe because the dedup will hit and
      // return idempotent: true without double-inserting.
      logger.warn('website.prototype_share.replay_reconstruction_unavailable', {
        requestId,
        ledgerEventId: ledger.eventId,
        ledgerAttemptCount: ledger.attemptCount,
      })
    }

    try {
      const result = await receiveWebsitePrototypeShare(
        payload,
        ledger.eventId,
        adminClient,
      )
      await markWebsiteWebhookEventProcessed(adminClient, ledger.eventId, {
        externalSessionId: payload.external_session_id,
        externalProposalId: null,
        externalPaymentId: null,
        linkId: null,
      })

      logger.info('website.prototype_share.received', {
        requestId,
        prototypeWorkspaceId: result.prototypeWorkspaceId,
        leadId: result.leadId,
        shareTokenHash: sha256Truncated(result.shareToken),
        idempotent: result.idempotent,
        supersededCount: result.supersededWorkspaceIds.length,
        ledgerEventId: ledger.eventId,
        ledgerAttemptCount: ledger.attemptCount,
      })

      return jsonWithRequestId(
        {
          data: {
            idempotent: result.idempotent,
            share_token: result.shareToken,
            prototype_workspace_id: result.prototypeWorkspaceId,
            lead_id: result.leadId,
            version_number: result.versionNumber,
            issued_at: result.issuedAt,
            superseded_workspace_ids: result.supersededWorkspaceIds,
          },
        },
        { status: result.idempotent ? 200 : 201 },
        requestId,
      )
    } catch (innerError) {
      await markWebsiteWebhookEventFailed(adminClient, ledger.eventId, innerError)
      throw innerError
    }
  } catch (error) {
    if (error instanceof WebsiteWebhookError) {
      logger.warn('website.prototype_share.rejected', {
        requestId,
        status: error.status,
        ...errorToLogContext(error),
      })
      return jsonWithRequestId(
        { error: error.message, code: 'WEBSITE_WEBHOOK_AUTH_FAILED' },
        { status: error.status },
        requestId,
      )
    }

    logger.warn('website.prototype_share.failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return toErrorResponse(error, { requestId })
  }
}
