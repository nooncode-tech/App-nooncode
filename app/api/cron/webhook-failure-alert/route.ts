import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'

// Vercel Cron handler — daily scan for webhook events that ended in
// `failed` state within the last 24 hours and have NOT been retried
// successfully. Enqueues a `webhook_failure` notification to every
// active admin profile per failed event (idempotent via the
// (profile_id, source_kind, source_event_id) unique constraint).
//
// Watches three ledgers:
//   - public.stripe_webhook_events       (PK: text event_id, e.g.
//     'evt_1TY6tZRC5LvlmWeuMjR5KzXv'). Stripe event_ids are not UUIDs,
//     so the notification's `source_event_id` is derived
//     deterministically from md5(event_id) — same id → same dedup key.
//   - public.website_webhook_events      (PK: uuid id). UUID is used
//     directly as source_event_id.
//   - public.outbound_webhook_events     (PK: uuid id). UUID is used
//     directly as source_event_id. ADR-027 D6 — alerts on rows that
//     reached `dead_letter` within the lookback window and have not yet
//     been notified (`alerted_at IS NULL`).
//
// Idempotency: re-runs do not duplicate notifications. Operators
// mark them read from /dashboard/notifications.
//
// Auth: same pattern as /api/cron/consolidate-earnings.
//
// Dry run: `?dryRun=true` returns the eligible failed event IDs
// without enqueueing.

const CRON_SECRET = process.env.CRON_SECRET
const DEFAULT_LOOKBACK_HOURS = 24

function isCronAuthorized(request: Request): boolean {
  const auth = request.headers.get('authorization')
  if (!CRON_SECRET) return false
  return auth === `Bearer ${CRON_SECRET}`
}

function resolveLookbackHours(): number {
  const raw = process.env.WEBHOOK_FAILURE_LOOKBACK_HOURS
  if (!raw || !raw.trim()) return DEFAULT_LOOKBACK_HOURS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LOOKBACK_HOURS
  return parsed
}

function md5UuidFor(text: string): string {
  const hex = createHash('md5').update(text).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

interface FailureOutcome {
  source: 'stripe' | 'website' | 'outbound'
  identifier: string
  sourceEventId: string
  enqueuedToProfiles: string[]
  status: 'enqueued' | 'no-admins' | 'error'
  error?: string
}

// Untyped boundary: the outbound ledger table was introduced after the last
// `database.types.ts` regen. Constraining the from() target here keeps the
// rest of the file fully typed. ADR-027 D6.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function outboundTable(client: ReturnType<typeof createSupabaseAdminClient>): any {
  return client.from('outbound_webhook_events' as never)
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
    const lookbackHours = resolveLookbackHours()

    const client = createSupabaseAdminClient()
    const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()

    const [stripeRes, websiteRes, outboundRes, adminRes] = await Promise.all([
      client
        .from('stripe_webhook_events')
        .select('event_id, event_type, failed_at, last_error, received_at')
        .eq('status', 'failed')
        .gte('received_at', cutoff),
      client
        .from('website_webhook_events')
        .select('id, endpoint, failed_at, last_error, received_at')
        .eq('status', 'failed')
        .gte('received_at', cutoff),
      // ADR-027 D6 — third ledger scan: outbound dead-letter rows.
      outboundTable(client)
        .select(
          'id, endpoint, external_proposal_id, decision, dead_lettered_at, last_error',
        )
        .eq('status', 'dead_letter')
        .is('alerted_at', null)
        .gte('dead_lettered_at', cutoff),
      client
        .from('user_profiles')
        .select('id')
        .eq('role', 'admin')
        .eq('is_active', true),
    ])

    if (stripeRes.error) {
      throw new Error(`Failed to enumerate stripe failures: ${stripeRes.error.message}`)
    }
    if (websiteRes.error) {
      throw new Error(`Failed to enumerate website failures: ${websiteRes.error.message}`)
    }
    if (outboundRes.error) {
      throw new Error(
        `Failed to enumerate outbound dead-letters: ${outboundRes.error.message}`,
      )
    }
    if (adminRes.error) {
      throw new Error(`Failed to enumerate admin profiles: ${adminRes.error.message}`)
    }

    const stripeFailures = stripeRes.data ?? []
    const websiteFailures = websiteRes.data ?? []
    interface OutboundFailureRow {
      id: string
      endpoint: string
      external_proposal_id: string
      decision: string
      dead_lettered_at: string | null
      last_error: string | null
    }
    const outboundFailures: OutboundFailureRow[] = outboundRes.data ?? []
    const adminIds = (adminRes.data ?? []).map((row) => row.id)

    if (dryRun) {
      logger.info('cron.webhook_failure_alert.dry_run', {
        lookbackHours,
        cutoff,
        stripeFailureCount: stripeFailures.length,
        websiteFailureCount: websiteFailures.length,
        outboundFailureCount: outboundFailures.length,
        adminCount: adminIds.length,
      })
      return NextResponse.json({
        dryRun: true,
        lookbackHours,
        cutoff,
        stripeFailureCount: stripeFailures.length,
        websiteFailureCount: websiteFailures.length,
        outboundFailureCount: outboundFailures.length,
        adminCount: adminIds.length,
        stripeEventIds: stripeFailures.map((row) => row.event_id),
        websiteEventIds: websiteFailures.map((row) => row.id),
        outboundEventIds: outboundFailures.map((row) => row.id),
      })
    }

    const outcomes: FailureOutcome[] = []
    let enqueuedCount = 0
    let noAdminCount = 0
    let errorCount = 0

    async function enqueueOne(
      source: 'stripe' | 'website' | 'outbound',
      identifier: string,
      sourceEventId: string,
      title: string,
      body: string,
      href: string
    ) {
      if (adminIds.length === 0) {
        noAdminCount += 1
        outcomes.push({ source, identifier, sourceEventId, enqueuedToProfiles: [], status: 'no-admins' })
        return
      }
      try {
        for (const adminId of adminIds) {
          const { error: rpcError } = await client.rpc('enqueue_user_notification', {
            target_profile_id: adminId,
            next_source_kind: 'webhook_failure',
            next_source_event_id: sourceEventId,
            next_domain: 'delivery',
            next_title: title,
            next_body: body,
            next_href: href,
          })
          if (rpcError) {
            throw new Error(`enqueue_user_notification failed: ${rpcError.message}`)
          }
        }
        enqueuedCount += 1
        outcomes.push({ source, identifier, sourceEventId, enqueuedToProfiles: adminIds, status: 'enqueued' })
      } catch (error) {
        errorCount += 1
        outcomes.push({
          source,
          identifier,
          sourceEventId,
          enqueuedToProfiles: [],
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        logger.error('cron.webhook_failure_alert.enqueue_failed', {
          source,
          identifier,
          ...errorToLogContext(error),
        })
      }
    }

    for (const row of stripeFailures) {
      const sourceEventId = md5UuidFor(row.event_id)
      const errSummary = (row.last_error ?? '').slice(0, 200)
      await enqueueOne(
        'stripe',
        row.event_id,
        sourceEventId,
        'Stripe webhook fallido',
        `${row.event_type} (${row.event_id}) sigue en estado failed. ${errSummary}`.trim(),
        '/dashboard/settings'
      )
    }

    for (const row of websiteFailures) {
      const errSummary = (row.last_error ?? '').slice(0, 200)
      await enqueueOne(
        'website',
        row.id,
        row.id,
        'Website webhook fallido',
        `${row.endpoint} (${row.id}) sigue en estado failed. ${errSummary}`.trim(),
        '/dashboard/settings'
      )
    }

    // ADR-027 D6 — third loop: outbound dead-letter rows. UUID flows
    // directly to `next_source_event_id` (no md5 hashing needed).
    for (const row of outboundFailures) {
      const errSummary = (row.last_error ?? '').slice(0, 200)
      const beforeEnqueueErrorCount = errorCount
      await enqueueOne(
        'outbound',
        row.id,
        row.id,
        'Outbound webhook fallido',
        `${row.endpoint} (${row.external_proposal_id}/${row.decision}) dead-letter. ${errSummary}`.trim(),
        '/dashboard/settings'
      )
      // Mark the ledger row as alerted so subsequent cron runs skip it
      // (the RPC dedupe already prevents duplicate notifications, but
      // skipping the RPC entirely keeps the cron cheap).
      if (errorCount === beforeEnqueueErrorCount) {
        const { error: markError } = await outboundTable(client)
          .update({ alerted_at: new Date().toISOString() })
          .eq('id', row.id)
        if (markError) {
          logger.error('cron.webhook_failure_alert.outbound_mark_alerted_failed', {
            eventId: row.id,
            ...errorToLogContext(markError),
          })
        }
      }
    }

    logger.info('cron.webhook_failure_alert.done', {
      lookbackHours,
      cutoff,
      stripeFailureCount: stripeFailures.length,
      websiteFailureCount: websiteFailures.length,
      outboundFailureCount: outboundFailures.length,
      adminCount: adminIds.length,
      enqueuedCount,
      noAdminCount,
      errorCount,
    })

    return NextResponse.json({
      dryRun: false,
      lookbackHours,
      cutoff,
      stripeFailureCount: stripeFailures.length,
      websiteFailureCount: websiteFailures.length,
      outboundFailureCount: outboundFailures.length,
      adminCount: adminIds.length,
      enqueuedCount,
      noAdminCount,
      errorCount,
      outcomes,
    })
  } catch (error) {
    logger.error('cron.webhook_failure_alert.failed', errorToLogContext(error))
    return toErrorResponse(error)
  }
}
