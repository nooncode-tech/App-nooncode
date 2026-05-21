import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'

// Vercel Cron handler — daily check for projects that have been alive
// for >5 business days (≈7 calendar days) in `backlog` or `in_progress`
// status WITHOUT a developer assigned. Each breached project enqueues a
// `project_sla_breach` notification to every active admin profile.
//
// Notifications are idempotent through the
// (profile_id, source_kind, source_event_id) unique constraint on
// public.user_notifications — re-runs of the cron will not duplicate.
//
// `source_event_id` = project.id, so a single project breaches at most
// once per admin recipient (across all cron runs). Re-assignment of a
// developer does NOT auto-clear the notification; admins mark it read
// from /dashboard/notifications.
//
// Auth: same pattern as /api/cron/consolidate-earnings.
//
// Dry run: `?dryRun=true` enumerates breached projects + admin
// recipients without enqueueing.

const CRON_SECRET = process.env.CRON_SECRET
const DEFAULT_BREACH_THRESHOLD_DAYS = 7 // ≈ 5 business days

function isCronAuthorized(request: Request): boolean {
  const auth = request.headers.get('authorization')
  if (!CRON_SECRET) return false
  return auth === `Bearer ${CRON_SECRET}`
}

function resolveBreachThresholdDays(): number {
  const raw = process.env.PROJECT_SLA_BREACH_THRESHOLD_DAYS
  if (!raw || !raw.trim()) return DEFAULT_BREACH_THRESHOLD_DAYS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BREACH_THRESHOLD_DAYS
  return parsed
}

interface BreachOutcome {
  projectId: string
  projectName: string
  enqueuedToProfiles: string[]
  status: 'enqueued' | 'no-admins' | 'error'
  error?: string
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
    const thresholdDays = resolveBreachThresholdDays()

    const client = createSupabaseAdminClient()
    const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000).toISOString()

    // Eligible projects: active status + no developer assigned + created
    // before the cutoff. `array_length(arr, 1)` returns NULL for empty
    // arrays in Postgres, so the `team_legacy_user_ids = '{}'` check
    // is the simplest portable predicate.
    const { data: breached, error: queryError } = await client
      .from('projects')
      .select('id, name, status, team_legacy_user_ids, created_at')
      .in('status', ['backlog', 'in_progress'])
      .filter('team_legacy_user_ids', 'eq', '{}')
      .lt('created_at', cutoff)

    if (queryError) {
      throw new Error(`Failed to enumerate breached projects: ${queryError.message}`)
    }

    const breachedRows = breached ?? []

    // Active admin profiles to notify. Cached once for the whole run.
    const { data: admins, error: adminError } = await client
      .from('user_profiles')
      .select('id')
      .eq('role', 'admin')
      .eq('is_active', true)

    if (adminError) {
      throw new Error(`Failed to enumerate admin profiles: ${adminError.message}`)
    }

    const adminIds = (admins ?? []).map((row) => row.id)

    if (dryRun) {
      logger.info('cron.project_sla_breach.dry_run', {
        thresholdDays,
        cutoff,
        breachedCount: breachedRows.length,
        adminCount: adminIds.length,
      })
      return NextResponse.json({
        dryRun: true,
        thresholdDays,
        cutoff,
        breachedCount: breachedRows.length,
        adminCount: adminIds.length,
        breachedProjectIds: breachedRows.map((row) => row.id),
        adminProfileIds: adminIds,
      })
    }

    const outcomes: BreachOutcome[] = []
    let enqueuedCount = 0
    let noAdminCount = 0
    let errorCount = 0

    for (const project of breachedRows) {
      if (adminIds.length === 0) {
        noAdminCount += 1
        outcomes.push({
          projectId: project.id,
          projectName: project.name,
          enqueuedToProfiles: [],
          status: 'no-admins',
        })
        continue
      }

      try {
        for (const adminId of adminIds) {
          const { error: rpcError } = await client.rpc('enqueue_user_notification', {
            target_profile_id: adminId,
            next_source_kind: 'project_sla_breach',
            next_source_event_id: project.id,
            next_domain: 'delivery',
            next_title: `Proyecto sin developer asignado >${thresholdDays}d`,
            next_body: `${project.name} sigue en estado ${project.status} sin developer asignado desde ${project.created_at}.`,
            next_href: `/dashboard/projects?projectId=${project.id}`,
          })

          if (rpcError) {
            throw new Error(`enqueue_user_notification failed: ${rpcError.message}`)
          }
        }
        enqueuedCount += 1
        outcomes.push({
          projectId: project.id,
          projectName: project.name,
          enqueuedToProfiles: adminIds,
          status: 'enqueued',
        })
      } catch (error) {
        errorCount += 1
        outcomes.push({
          projectId: project.id,
          projectName: project.name,
          enqueuedToProfiles: [],
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
        logger.error('cron.project_sla_breach.project_failed', {
          projectId: project.id,
          ...errorToLogContext(error),
        })
      }
    }

    logger.info('cron.project_sla_breach.done', {
      thresholdDays,
      cutoff,
      breachedCount: breachedRows.length,
      adminCount: adminIds.length,
      enqueuedCount,
      noAdminCount,
      errorCount,
    })

    return NextResponse.json({
      dryRun: false,
      thresholdDays,
      cutoff,
      breachedCount: breachedRows.length,
      adminCount: adminIds.length,
      enqueuedCount,
      noAdminCount,
      errorCount,
      outcomes,
    })
  } catch (error) {
    logger.error('cron.project_sla_breach.failed', errorToLogContext(error))
    return toErrorResponse(error)
  }
}
