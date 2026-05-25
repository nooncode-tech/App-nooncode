/**
 * Single-call repository wrapper around the dashboard summary RPC.
 *
 * The RPC `public.get_dashboard_summary()` is defined in migration
 * `supabase/migrations/0058_phase_22b_dashboard_summary_rpc.sql`. It
 * runs `SECURITY INVOKER` so the existing row-level policies on
 * `leads`, `projects`, and `tasks` scope the aggregate to the calling
 * principal's visible rows. One RPC invocation = one MVCC snapshot =
 * one HTTP round-trip from the route handler to Postgres.
 *
 * @see docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md §D2, §D3
 */

import type { DatabaseClient } from '@/lib/server/supabase/server'
import type { DashboardSummaryRow } from '@/lib/server/dashboard/serialization'

/**
 * Read the principal's dashboard summary aggregate row.
 *
 * Returns the raw snake_case row from the RPC. Conversion to the wire
 * shape (camelCase, null masking for task counters) is the service
 * layer's responsibility.
 *
 * Throws on transport / RPC failures. The route handler converts the
 * thrown error into a 500 via `toErrorResponse`. The RPC itself is
 * idempotent and side-effect-free, so retry is safe.
 */
export async function readDashboardSummary(
  client: DatabaseClient
): Promise<DashboardSummaryRow> {
  const { data, error } = await client.rpc('get_dashboard_summary')

  if (error) {
    throw new Error(`Failed to read dashboard summary: ${error.message}`)
  }

  if (!data || data.length === 0) {
    throw new Error(
      'Dashboard summary RPC returned no rows. The aggregate function should always return exactly one row.'
    )
  }

  // The RPC is composed of cross-joined single-row CTEs so it always
  // returns exactly one row. Defensively pick the first.
  //
  // Generated types surface `leads_by_status` as the broad `Json` type
  // (jsonb column). The runtime contract — `jsonb_object_agg(status,
  // count)` over the `leads` table — narrows it to `Record<string,
  // number> | null`. The boundary cast captures that runtime-known
  // narrowing; the service layer / mapper rely on the narrow type.
  return data[0] as DashboardSummaryRow
}
