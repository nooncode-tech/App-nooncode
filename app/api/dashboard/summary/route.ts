/**
 * GET /api/dashboard/summary
 *
 * Returns the role-scoped, server-aggregated dashboard KPI payload for
 * the authenticated principal. Replaces the client-side
 * `selectDashboardSummary(leads, projects, tasks)` derivation that
 * required eager-loading the full datasets.
 *
 * Auth: any of the five app roles via
 * `requireRole(['admin','sales_manager','sales','pm','developer'])`.
 * Section visibility is RLS-derived: rows are filtered before
 * aggregation by the policies on `leads`, `projects`, `tasks`. Task
 * counters are masked to `null` server-side for `sales` /
 * `sales_manager` (their RLS denies task SELECT). See ADR-020 §D1, §D9.
 *
 * Status mapping:
 *   - 200 — success; body shape `{ data: { sales, delivery, checkedAt } }`.
 *   - 401 — no session (via `requireRole` → `AuthGuardError`).
 *   - 403 — session but principal not in the 5 allowed roles, or the
 *           profile is inactive / missing.
 *   - 500 — repository / service error (RPC failure, transport error).
 *
 * `checkedAt` is the server's transaction-start `now()` (the RPC uses
 * `now()` not `clock_timestamp()` so all 13 aggregate columns + the
 * timestamp reflect one consistent MVCC snapshot).
 *
 * Per ADR-020 §D5, NO server-side caching is added. The 60s
 * stale-while-revalidate window lives on the client-side provider.
 * `dynamic = 'force-dynamic'` prevents any Next route-segment caching
 * on Vercel's edge.
 *
 * @see docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md
 * @see docs/contracts/dashboard-summary.md
 */

import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/server/api/errors'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import type { DatabaseClient } from '@/lib/server/supabase/server'
import { getDashboardSummary } from '@/lib/server/dashboard/summary-service'
import type { AppRole, AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import type { DashboardSummaryResponse } from '@/lib/server/dashboard/serialization'

// The RPC reads live aggregate values; the wire is per-principal and
// must never be cached at the route-segment layer.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const allowedSummaryRoles = [
  'admin',
  'sales_manager',
  'sales',
  'pm',
  'developer',
] as const

// ---------------------------------------------------------------------------
// Testable handler factory
// ---------------------------------------------------------------------------

type GetHandlerDeps = {
  requireRole: (roles: readonly AppRole[]) => Promise<AuthenticatedPrincipal>
  getDashboardSummary: (
    client: DatabaseClient,
    principal: AuthenticatedPrincipal
  ) => Promise<DashboardSummaryResponse>
  createSupabaseServerClient: () => Promise<DatabaseClient>
}

export function createGetDashboardSummaryHandler(deps: GetHandlerDeps) {
  return async function GET() {
    try {
      const principal = await deps.requireRole(allowedSummaryRoles)
      const client = await deps.createSupabaseServerClient()
      const data = await deps.getDashboardSummary(client, principal)

      return NextResponse.json({ data })
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

// ---------------------------------------------------------------------------
// Next.js route export
// ---------------------------------------------------------------------------

export const GET = createGetDashboardSummaryHandler({
  requireRole,
  getDashboardSummary,
  createSupabaseServerClient,
})
