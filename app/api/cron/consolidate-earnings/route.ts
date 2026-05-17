import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { consolidateEarningsForPayment } from '@/lib/server/earnings/consolidation-service'

// Vercel Cron handler: daily at 30 6 * * * (per vercel.json). Atomically
// consolidates earnings for every payment whose paid_at is older than the
// cooling period AND whose associated seller_fees row is still in
// `confirmed` state. Per ADR-015, each payment is processed by the
// `consolidate_payment_earnings` RPC which is itself transactional + row-
// locked, so cron retries / overlapping invocations cannot double-credit.
//
// Auth: same pattern as /api/leads/auto-followup. Vercel Cron is
// configured to send `Authorization: Bearer ${CRON_SECRET}` when invoking
// the route. Calls without the bearer (or with the wrong value) are
// rejected 401.
//
// Dry run: `?dryRun=true` enumerates eligible payments and returns their
// ids + count without invoking the RPC. Useful for diagnosis without
// mutation.

const CRON_SECRET = process.env.CRON_SECRET
const DEFAULT_COOLING_DAYS = 7

function isCronAuthorized(request: Request): boolean {
  const auth = request.headers.get('authorization')
  if (!CRON_SECRET) return false
  return auth === `Bearer ${CRON_SECRET}`
}

function resolveCoolingDays(): number {
  const raw = process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS
  if (!raw || !raw.trim()) return DEFAULT_COOLING_DAYS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_COOLING_DAYS
  return parsed
}

interface ConsolidationOutcome {
  paymentId: string
  status: 'consolidated' | 'noop' | 'error'
  actorsConsolidated?: number
  amountConsolidated?: number
  priorState?: string
  newState?: string
  error?: string
}

export async function POST(request: Request) {
  return handleCronRequest(request)
}

// Vercel Cron sends GET requests; support both methods so manual
// invocation via curl is straightforward.
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
    const coolingDays = resolveCoolingDays()

    const client = await createSupabaseAdminClient()
    const cutoff = new Date(Date.now() - coolingDays * 24 * 60 * 60 * 1000).toISOString()

    // Eligibility query: payments with paid_at <= cutoff whose associated
    // seller_fees row is still in `confirmed` state. The RPC re-validates
    // the state under a row lock, so a stale read here only causes a
    // no-op when the RPC sees a state other than `confirmed`.
    const { data: eligible, error: queryError } = await client
      .from('seller_fees')
      .select('payment_id, payments!inner(id, paid_at, status)')
      .eq('state', 'confirmed')
      .not('payment_id', 'is', null)
      .lte('payments.paid_at', cutoff)
      .eq('payments.status', 'succeeded')

    if (queryError) {
      throw new Error(`Failed to enumerate eligible payments: ${queryError.message}`)
    }

    const paymentIds = (eligible ?? [])
      .map((row: { payment_id: string | null }) => row.payment_id)
      .filter((id): id is string => Boolean(id))

    if (dryRun) {
      logger.info('cron.consolidate_earnings.dry_run', {
        coolingDays,
        eligibleCount: paymentIds.length,
        cutoff,
      })
      return NextResponse.json({
        dryRun: true,
        coolingDays,
        cutoff,
        eligibleCount: paymentIds.length,
        paymentIds,
      })
    }

    const outcomes: ConsolidationOutcome[] = []
    let consolidatedCount = 0
    let noopCount = 0
    let errorCount = 0

    for (const paymentId of paymentIds) {
      try {
        const result = await consolidateEarningsForPayment(client, {
          paymentId,
          actorProfileId: null,
        })

        if (result.priorState === 'confirmed' && result.newState === 'pending_payout') {
          consolidatedCount += 1
          outcomes.push({
            paymentId,
            status: 'consolidated',
            actorsConsolidated: result.actorsConsolidated,
            amountConsolidated: result.amountConsolidated,
            priorState: result.priorState,
            newState: result.newState,
          })
        } else {
          // Race: between the eligibility query and the RPC lock another
          // path (refund handler, manual admin call) flipped the state.
          // Idempotent no-op is the correct outcome.
          noopCount += 1
          outcomes.push({
            paymentId,
            status: 'noop',
            priorState: result.priorState,
            newState: result.newState,
          })
        }
      } catch (error) {
        errorCount += 1
        outcomes.push({
          paymentId,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        logger.error('cron.consolidate_earnings.payment_failed', {
          paymentId,
          ...errorToLogContext(error),
        })
      }
    }

    logger.info('cron.consolidate_earnings.done', {
      coolingDays,
      cutoff,
      eligibleCount: paymentIds.length,
      consolidatedCount,
      noopCount,
      errorCount,
    })

    return NextResponse.json({
      dryRun: false,
      coolingDays,
      cutoff,
      eligibleCount: paymentIds.length,
      consolidatedCount,
      noopCount,
      errorCount,
      outcomes,
    })
  } catch (error) {
    logger.error('cron.consolidate_earnings.failed', errorToLogContext(error))
    return toErrorResponse(error)
  }
}
