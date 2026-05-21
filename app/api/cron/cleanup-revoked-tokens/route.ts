import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'

// Vercel Cron handler — daily cleanup of soft-revoked client_access_tokens
// whose revoked_at is older than the retention window (default 90 days).
//
// Hard-deletes preserve operational data hygiene: the revoke audit row
// is useful for ~3 months (the window in which a revoke might be
// disputed or investigated), but indefinite retention would bloat the
// table over time.
//
// The revoke audit is preserved indirectly through the
// `client_activity_log` (if any) plus the rotation lineage links
// (`rotated_to_token_id`). For longer-term audit retention bump the
// `CLIENT_TOKEN_REVOKED_RETENTION_DAYS` env override.
//
// Auth: same pattern as /api/cron/consolidate-earnings.
//
// Dry run: `?dryRun=true` enumerates eligible token ids without
// deleting.

const CRON_SECRET = process.env.CRON_SECRET
const DEFAULT_RETENTION_DAYS = 90

function isCronAuthorized(request: Request): boolean {
  const auth = request.headers.get('authorization')
  if (!CRON_SECRET) return false
  return auth === `Bearer ${CRON_SECRET}`
}

function resolveRetentionDays(): number {
  const raw = process.env.CLIENT_TOKEN_REVOKED_RETENTION_DAYS
  if (!raw || !raw.trim()) return DEFAULT_RETENTION_DAYS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RETENTION_DAYS
  return parsed
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
    const retentionDays = resolveRetentionDays()

    const client = createSupabaseAdminClient()
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

    if (dryRun) {
      const { data, error } = await client
        .from('client_access_tokens')
        .select('id, revoked_at')
        .not('revoked_at' as never, 'is', null)
        .lt('revoked_at' as never, cutoff)

      if (error) {
        throw new Error(`Failed to enumerate revoked tokens: ${error.message}`)
      }

      const tokenIds = ((data ?? []) as unknown as Array<{ id: string }>).map((row) => row.id)
      logger.info('cron.cleanup_revoked_tokens.dry_run', {
        retentionDays,
        cutoff,
        eligibleCount: tokenIds.length,
      })

      return NextResponse.json({
        dryRun: true,
        retentionDays,
        cutoff,
        eligibleCount: tokenIds.length,
        tokenIds,
      })
    }

    const { data: deleted, error: deleteError } = await client
      .from('client_access_tokens')
      .delete()
      .not('revoked_at' as never, 'is', null)
      .lt('revoked_at' as never, cutoff)
      .select('id')

    if (deleteError) {
      throw new Error(`Failed to delete revoked tokens: ${deleteError.message}`)
    }

    const deletedCount = (deleted ?? []).length

    logger.info('cron.cleanup_revoked_tokens.done', {
      retentionDays,
      cutoff,
      deletedCount,
    })

    return NextResponse.json({
      dryRun: false,
      retentionDays,
      cutoff,
      deletedCount,
    })
  } catch (error) {
    logger.error('cron.cleanup_revoked_tokens.failed', errorToLogContext(error))
    return toErrorResponse(error)
  }
}
