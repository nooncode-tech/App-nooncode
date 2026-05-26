import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/server/api/errors'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { claimOutboundPendingDue } from '@/lib/server/website/outbound-webhook-events'
import { runOutboundWebhookCronSweep } from '@/lib/server/website-integration'

// Vercel Cron handler — once per day at 08:00 UTC (`0 8 * * *`).
// ADR-027 D4 originally specified */5 * * * *; downgraded to daily due to Vercel Hobby plan limit.
// Sweeps `public.outbound_webhook_events` rows in status='pending' whose
// `next_retry_at` is due and drives them through the same dispatcher loop
// the inline path uses. The cron and inline paths SHARE the same
// `max_attempts` budget (per row); the cron does not have its own retry
// allotment.
//
// Auth: same pattern as /api/cron/webhook-failure-alert (B25 closure).
//
// Dry run: `?dryRun=true` returns the candidate ledger row ids + count
// without invoking any outbound fetch.

const CRON_SECRET = process.env.CRON_SECRET
const DEFAULT_BATCH_SIZE = 50

function isCronAuthorized(request: Request): boolean {
  const auth = request.headers.get('authorization')
  if (!CRON_SECRET) return false
  return auth === `Bearer ${CRON_SECRET}`
}

export async function POST(request: Request) {
  return handleCronRequest(request)
}

export async function GET(request: Request) {
  return handleCronRequest(request)
}

async function handleCronRequest(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const dryRun = searchParams.get('dryRun') === 'true'
    const requestedLimit = Number.parseInt(
      searchParams.get('limit') ?? `${DEFAULT_BATCH_SIZE}`,
      10,
    )
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0 && requestedLimit <= DEFAULT_BATCH_SIZE
        ? requestedLimit
        : DEFAULT_BATCH_SIZE

    const client = createSupabaseAdminClient()
    const nowIso = new Date().toISOString()

    if (dryRun) {
      const candidates = await claimOutboundPendingDue(client, { limit, now: nowIso })
      logger.info('cron.outbound_webhook_retry.dry_run', {
        candidateCount: candidates.length,
        limit,
        now: nowIso,
      })
      return NextResponse.json({
        dryRun: true,
        limit,
        now: nowIso,
        candidateCount: candidates.length,
        candidateEventIds: candidates.map((row) => row.eventId),
      })
    }

    const result = await runOutboundWebhookCronSweep({
      client,
      now: () => new Date(),
      limit,
    })

    logger.info('cron.outbound_webhook_retry.done', {
      candidateCount: result.candidateCount,
      deliveredCount: result.delivered.length,
      deadLetteredCount: result.deadLettered.length,
      pendingCount: result.pending.length,
      errorCount: result.errors.length,
    })

    return NextResponse.json({
      dryRun: false,
      now: nowIso,
      limit,
      candidateCount: result.candidateCount,
      deliveredCount: result.delivered.length,
      deadLetteredCount: result.deadLettered.length,
      pendingCount: result.pending.length,
      errorCount: result.errors.length,
      delivered: result.delivered,
      deadLettered: result.deadLettered,
      pending: result.pending,
      errors: result.errors,
    })
  } catch (error) {
    logger.error('cron.outbound_webhook_retry.failed', errorToLogContext(error))
    return toErrorResponse(error)
  }
}
