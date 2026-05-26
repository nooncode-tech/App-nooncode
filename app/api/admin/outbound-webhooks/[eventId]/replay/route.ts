import { NextResponse } from 'next/server'
import { z } from 'zod'

import { toErrorResponse } from '@/lib/server/api/errors'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { requireRole } from '@/lib/server/auth/guards'
import { driveAdminOutboundReplay } from '@/lib/server/website-integration'

// Admin-only replay endpoint for the outbound `proposal_review_decision`
// ledger (ADR-027 D7 / D11). The route is authz-strict:
//   - `requireRole(['admin'])` — no PM / sales_manager / developer.
//   - service-role bypass is NOT a valid path; the cron handler is the
//     only service-role context for this domain.
//
// The replay state machine is owned by `driveAdminOutboundReplay`. This
// handler is a thin authz + JSON wrapper.
//
// Identity argument: `eventId` is the LEDGER ROW UUID (D11), NOT the
// proposal id. Operators query the ledger by `external_proposal_id` to
// locate the row, then POST against this endpoint with the row's `id`.
//
// GET / PUT / DELETE / PATCH all return 405 (POST-only).

const routeParamsSchema = z.object({
  eventId: z.string().uuid(),
})

export async function POST(
  _request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    await requireRole(['admin'])
    const { eventId } = routeParamsSchema.parse(await context.params)

    const outcome = await driveAdminOutboundReplay(eventId)

    switch (outcome.kind) {
      case 'not_found':
        logger.info('admin.outbound_webhook_replay.not_found', { eventId })
        return NextResponse.json(
          { error: 'event_not_found', eventId },
          { status: 404 },
        )
      case 'noop_delivered':
        logger.info('admin.outbound_webhook_replay.noop_delivered', {
          eventId: outcome.eventId,
          externalProposalId: outcome.externalProposalId,
          decision: outcome.decision,
        })
        return NextResponse.json(
          {
            idempotent: true,
            noop: true,
            eventId: outcome.eventId,
            deliveredAt: outcome.deliveredAt,
            externalProposalId: outcome.externalProposalId,
            decision: outcome.decision,
          },
          { status: 200 },
        )
      case 'noop_replayed':
        logger.info('admin.outbound_webhook_replay.noop_replayed', {
          eventId: outcome.eventId,
          replayedByEventId: outcome.replayedByEventId,
        })
        return NextResponse.json(
          {
            idempotent: true,
            noop: true,
            eventId: outcome.eventId,
            replayedByEventId: outcome.replayedByEventId,
            externalProposalId: outcome.externalProposalId,
            decision: outcome.decision,
          },
          { status: 200 },
        )
      case 'conflict_pending':
        logger.info('admin.outbound_webhook_replay.conflict_pending', {
          eventId: outcome.eventId,
          nextRetryAt: outcome.nextRetryAt,
        })
        return NextResponse.json(
          {
            error: 'event_in_pending_state',
            eventId: outcome.eventId,
            nextRetryAt: outcome.nextRetryAt,
          },
          { status: 409 },
        )
      case 'replayed': {
        // The spawn + drive succeeded (note: `status: 'failed'` here means
        // the new ledger row landed in dead_letter, which is itself a
        // valid replay outcome — the replay surface returns 200 because
        // the OPERATION succeeded; the OUTCOME is reported in the body).
        logger.info('admin.outbound_webhook_replay.replayed', {
          sourceEventId: outcome.sourceEventId,
          newEventId: outcome.newEventId,
          status: outcome.status,
        })
        return NextResponse.json(
          {
            idempotent: false,
            replayed: true,
            sourceEventId: outcome.sourceEventId,
            newEventId: outcome.newEventId,
            status: outcome.status,
            httpStatus: outcome.httpStatus,
            error: outcome.errorMessage,
            externalProposalId: outcome.externalProposalId,
            decision: outcome.decision,
          },
          { status: 200 },
        )
      }
    }
  } catch (error) {
    logger.error('admin.outbound_webhook_replay.failed', errorToLogContext(error))
    return toErrorResponse(error)
  }
}

export async function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 })
}
