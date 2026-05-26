import crypto from 'node:crypto'

import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import {
  receiveWebsitePrototypeDecision,
  scheduleAcceptedPrototypeDecisionSideEffects,
  websitePrototypeDecisionPayloadSchema,
} from '@/lib/server/website-integration'
import {
  readSignedWebsiteJsonWithRawBody,
  WebsiteWebhookError,
} from '@/lib/server/website-webhook-auth'
import {
  composePrototypeDecisionReplayResponseFromLedger,
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

/**
 * Inbound prototype-decision webhook (NoonWeb → App).
 *
 * Symmetry-pair with `inbound-proposal` and `payment-confirmed`. See:
 *   - ADR-023 (wire contract; D1-D9 immutable)
 *   - ADR-025 (impl firm-ups; D1 replay-path, D2 Gate B, D3 bundling)
 *   - docs/integrations/cross-repo-webhook-v1.md §5
 *   - specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    await assertRateLimit(request, {
      namespace: 'website-prototype-decision',
      limit: 120,
      windowMs: 60_000,
    })

    const { payload, bodyText, signatureHeader, timestamp } =
      await readSignedWebsiteJsonWithRawBody(request, websitePrototypeDecisionPayloadSchema)

    // Ledger-disabled fallback path (kept for parity with sibling routes;
    // ADR-016 D9 kill-switch). In this mode there is no replay protection
    // beyond the application-level UNIQUE index on
    // `prototype_decisions(prototype_workspace_id)`.
    if (!websiteWebhookLedgerEnabled()) {
      const result = await receiveWebsitePrototypeDecision(payload, null)

      if (result.decision === 'accepted') {
        scheduleAcceptedPrototypeDecisionSideEffects({
          adminClient: createSupabaseAdminClient(),
          decisionId: result.decisionId,
          prototypeWorkspaceId: result.prototypeWorkspaceId,
          leadId: result.leadId,
          sellerProfileId: result.sellerProfileId,
        })
      }

      logger.info('website.prototype_decision.received', {
        requestId,
        prototypeWorkspaceId: result.prototypeWorkspaceId,
        decisionId: result.decisionId,
        decision: result.decision,
        draftPropuestaQueued: result.draftPropuestaQueued,
        ledger: 'disabled',
      })

      return jsonWithRequestId(
        {
          data: {
            idempotent: false,
            decisionId: result.decisionId,
            prototypeWorkspaceId: result.prototypeWorkspaceId,
            leadId: result.leadId,
            decision: result.decision,
            decidedAt: result.decidedAt,
            draftPropuestaQueued: result.draftPropuestaQueued,
          },
        },
        { status: 201 },
        requestId,
      )
    }

    const signatureHash = sha256Hex(`${timestamp}.${bodyText}`)
    const payloadHash = sha256Hex(bodyText)
    const adminClient = createSupabaseAdminClient()

    const ledger = await recordWebsiteWebhookEvent(adminClient, {
      endpoint: 'prototype-decision',
      signatureHeader,
      signatureHash,
      payloadHash,
      requestId,
    })

    if (!ledger.shouldProcess) {
      const replay = await composePrototypeDecisionReplayResponseFromLedger(adminClient, ledger)
      if (replay) {
        logger.info('website.prototype_decision.replayed', {
          requestId,
          prototypeWorkspaceId: replay.prototypeWorkspaceId,
          decisionId: replay.decisionId,
          decision: replay.decision,
          ledgerEventId: ledger.eventId,
          ledgerAttemptCount: ledger.attemptCount,
        })
        return jsonWithRequestId({ data: replay }, { status: 200 }, requestId)
      }
      // Replay-path null fallback per ADR-025 D1: the ledger says "processed"
      // but the FK-join could not reconstruct the wire shape. Surface a 500
      // rather than re-running side effects (avoiding double-charge of the
      // Maxwell draft side effect).
      logger.warn('website.prototype_decision.replay_reconstruction_unavailable', {
        requestId,
        ledgerEventId: ledger.eventId,
        ledgerAttemptCount: ledger.attemptCount,
      })
      return jsonWithRequestId(
        {
          error: 'Internal server error processing prototype decision.',
          code: 'PROTOTYPE_DECISION_PERSIST_FAILED',
        },
        { status: 500 },
        requestId,
      )
    }

    try {
      const result = await receiveWebsitePrototypeDecision(payload, ledger.eventId, adminClient)
      await markWebsiteWebhookEventProcessed(adminClient, ledger.eventId, {
        externalSessionId: null,
        externalProposalId: null,
        externalPaymentId: null,
        linkId: null,
      })

      if (result.decision === 'accepted') {
        scheduleAcceptedPrototypeDecisionSideEffects({
          adminClient,
          decisionId: result.decisionId,
          prototypeWorkspaceId: result.prototypeWorkspaceId,
          leadId: result.leadId,
          sellerProfileId: result.sellerProfileId,
        })
      }

      logger.info('website.prototype_decision.received', {
        requestId,
        prototypeWorkspaceId: result.prototypeWorkspaceId,
        decisionId: result.decisionId,
        decision: result.decision,
        draftPropuestaQueued: result.draftPropuestaQueued,
        ledgerEventId: ledger.eventId,
        ledgerAttemptCount: ledger.attemptCount,
      })

      return jsonWithRequestId(
        {
          data: {
            idempotent: false,
            decisionId: result.decisionId,
            prototypeWorkspaceId: result.prototypeWorkspaceId,
            leadId: result.leadId,
            decision: result.decision,
            decidedAt: result.decidedAt,
            draftPropuestaQueued: result.draftPropuestaQueued,
          },
        },
        { status: 201 },
        requestId,
      )
    } catch (innerError) {
      await markWebsiteWebhookEventFailed(adminClient, ledger.eventId, innerError)
      throw innerError
    }
  } catch (error) {
    if (error instanceof WebsiteWebhookError) {
      logger.warn('website.prototype_decision.rejected', {
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

    logger.warn('website.prototype_decision.failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return toErrorResponse(error, { requestId })
  }
}
