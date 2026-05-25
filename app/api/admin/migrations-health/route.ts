/**
 * GET /api/admin/migrations-health
 *
 * Read-only health endpoint comparing local `supabase/migrations/*.sql` to
 * the remote `supabase_migrations.schema_migrations` ledger and classifying
 * the diff against the two ADR-anchored exception sets:
 *
 *   - 4 grandfathered prefix collisions per ADR-006 §Option B2
 *   - 6 expected orphans per ADR-014 §Orphans
 *
 * Auth: admin-only via `requireRole(['admin'])`. The CI/cron/external-probe
 * use cases are explicitly deferred — see ADR-017 §D3 for the
 * pre-authorized internal-token follow-up.
 *
 * Status mapping (ADR-017 §D2):
 *   - 200 — `data.synced === true` (zero unexpected drift, known
 *     exceptions allowed).
 *   - 503 — `data.synced === false` (any unexpected drift; body still
 *     carries the diagnostic arrays).
 *   - 500 — could not determine drift state (filesystem missing, ledger
 *     read failed). Distinct from 503 because the answer is unknown.
 *   - 401 / 403 — auth failure routed through `toErrorResponse`.
 *
 * @see docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md
 * @see docs/adrs/ADR-006-migration-prefix-convention-and-rename.md
 * @see docs/adrs/ADR-014-migration-ledger-reconciliation.md
 */

import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/server/api/errors'
import { requireRole } from '@/lib/server/auth/guards'
import { readMigrationsHealth } from '@/lib/server/migrations/ledger-adapter'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'

// `node:fs/promises.readdir` is unavailable under the edge runtime — keep
// this route on the Node.js runtime. The response varies per call (the
// ledger and the filesystem are read live), so force-dynamic prevents any
// route-segment caching.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole(['admin'])

    const client = createSupabaseAdminClient()
    const result = await readMigrationsHealth(client)
    const status = result.data.synced ? 200 : 503

    return NextResponse.json(result, { status })
  } catch (err) {
    return toErrorResponse(err)
  }
}
