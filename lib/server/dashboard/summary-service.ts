/**
 * Service layer for the dashboard summary endpoint. Owns the role-aware
 * payload assembly: applies the task-counter null masking for principals
 * whose RLS denies task SELECT (`sales`, `sales_manager`).
 *
 * The repository reads the raw aggregate row; the service decides the
 * wire shape. The route handler stays thin and only handles transport.
 *
 * @see docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md §D1, §D8, §D9
 */

import type { DatabaseClient } from '@/lib/server/supabase/server'
import type { AppRole, AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import {
  mapSummaryRowToSalesSection,
  mapSummaryRowToDeliverySectionFull,
  mapSummaryRowToDeliverySectionTaskMasked,
  type DashboardSummaryResponse,
  type DashboardSummaryRow,
} from '@/lib/server/dashboard/serialization'
import { readDashboardSummary } from '@/lib/server/dashboard/summary-repository'

/**
 * The roles whose RLS denies `SELECT` on `public.tasks`. Aggregates
 * targeted at the `tasks` table return zero for these principals, which
 * is visually indistinguishable from "no work yet". Per ADR-020 §D1
 * consequence 1 and §D9, we mask the task counters to `null` on the
 * wire so the consumer renders an honest placeholder ("—") instead of
 * a misleading zero.
 *
 * Project counters are NOT masked because all five roles have SELECT
 * on `projects` under existing RLS (migrations 0005 / 0019).
 */
const TASK_RLS_DENIED_ROLES: readonly AppRole[] = [
  'sales',
  'sales_manager',
] as const

function shouldMaskTaskCounters(role: AppRole): boolean {
  return TASK_RLS_DENIED_ROLES.includes(role)
}

/**
 * Read the role-scoped dashboard summary for the authenticated
 * principal. Assumes the route handler has already authorized the
 * principal (`requireRole(['admin','sales_manager','sales','pm','developer'])`).
 *
 * The aggregate values come from the RPC under the principal's RLS;
 * the service applies the role-aware null masking on top.
 *
 * Returns the wire shape (camelCase, with `null` for task counters
 * under `sales` / `sales_manager`).
 */
export async function getDashboardSummary(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal
): Promise<DashboardSummaryResponse> {
  const row: DashboardSummaryRow = await readDashboardSummary(client)

  const sales = mapSummaryRowToSalesSection(row)
  const delivery = shouldMaskTaskCounters(principal.role)
    ? mapSummaryRowToDeliverySectionTaskMasked(row)
    : mapSummaryRowToDeliverySectionFull(row)

  return {
    sales,
    delivery,
    checkedAt: row.checked_at,
  }
}
