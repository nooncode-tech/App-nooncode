/**
 * Wire shape, server-side row shape, and mappers for the dashboard summary
 * endpoint. Owns the camelCase wire contract consumed by the dashboard
 * home and the role-aware null masking applied at service-layer time.
 *
 * The repository surfaces a snake_case row that mirrors the RPC return
 * columns; the mapper converts it into the camelCase wire shape; the
 * service decides per-role whether to mask the task counters.
 *
 * @see docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md §D8, §D9
 * @see docs/contracts/dashboard-summary.md (conceptual entity + role-visibility matrix)
 */

/**
 * The raw RPC row returned by `public.get_dashboard_summary()`.
 *
 * - Counts arrive from Postgres as `bigint` which Supabase serializes to
 *   JavaScript `number` (safe within `Number.MAX_SAFE_INTEGER` for our
 *   pilot/early scale; if a deployment ever crosses 2^53 leads we have
 *   bigger problems than this type).
 * - Sums arrive as `numeric`; Supabase serializes them to JavaScript
 *   `number` (configured precision is 12,2 across the wallet/lead value
 *   columns — safe within `number`).
 * - `leads_by_status` is `jsonb`; PostgREST deserializes it to a JSON
 *   object on the client side. The RPC emits `null` when there are zero
 *   leads (jsonb_object_agg over empty input); the mapper coerces that
 *   to `{}` so the wire stays an object.
 * - `checked_at` is `timestamptz`; PostgREST serializes it to an ISO
 *   string.
 */
export interface DashboardSummaryRow {
  open_leads: number
  won_leads: number
  pipeline_value: number
  total_revenue: number
  closed_leads: number
  overdue_follow_ups: number
  leads_by_status: Record<string, number> | null
  active_projects: number
  projects_in_review: number
  completed_projects: number
  pending_tasks: number
  in_progress_tasks: number
  review_tasks: number
  checked_at: string
}

/**
 * The sales section of the dashboard summary on the wire.
 *
 * `leadsByStatus` is always an object (never null) — per ADR-020 §D10
 * open issue #2 the empty histogram is coerced to `{}` server-side so
 * consumers never branch on `null`.
 */
export interface DashboardSummarySalesSection {
  openLeads: number
  wonLeads: number
  pipelineValue: number
  totalRevenue: number
  closedLeads: number
  overdueFollowUps: number
  leadsByStatus: Record<string, number>
}

/**
 * The delivery section of the dashboard summary on the wire.
 *
 * Task fields are `null` when the principal's RLS denies SELECT on
 * `tasks` (the `sales` and `sales_manager` roles per ADR-020 §D1
 * consequence 1). `actionableTasks` mirrors the masking: it is the
 * sum of `pendingTasks` and `inProgressTasks` when both are present,
 * else `null`.
 *
 * Project counters are always non-null (even at zero) because all five
 * roles have SELECT on `projects` under existing RLS.
 */
export interface DashboardSummaryDeliverySection {
  activeProjects: number
  projectsInReview: number
  completedProjects: number
  pendingTasks: number | null
  inProgressTasks: number | null
  reviewTasks: number | null
  actionableTasks: number | null
}

/**
 * The full dashboard summary payload as returned by
 * `GET /api/dashboard/summary` inside the standard `{ data: ... }`
 * envelope.
 *
 * `checkedAt` is an ISO timestamp from the server's `now()` at
 * transaction start. Consumers MAY display it for operator tooling but
 * MUST NOT use it for cache decisions (cache TTL lives on the
 * consumer side per ADR-020 §D5).
 */
export interface DashboardSummaryResponse {
  sales: DashboardSummarySalesSection
  delivery: DashboardSummaryDeliverySection
  checkedAt: string
}

/**
 * Convert a raw RPC row into the wire-shape sales section.
 *
 * Coerces `leads_by_status: null` to `{}` per ADR-020 §D10 (the wire
 * shape is an object, never null).
 */
export function mapSummaryRowToSalesSection(
  row: DashboardSummaryRow
): DashboardSummarySalesSection {
  return {
    openLeads: row.open_leads,
    wonLeads: row.won_leads,
    pipelineValue: row.pipeline_value,
    totalRevenue: row.total_revenue,
    closedLeads: row.closed_leads,
    overdueFollowUps: row.overdue_follow_ups,
    leadsByStatus: row.leads_by_status ?? {},
  }
}

/**
 * Convert a raw RPC row into the wire-shape delivery section with full
 * task counters (no role masking applied — the service layer decides
 * whether to mask).
 *
 * `actionableTasks` is `pendingTasks + inProgressTasks`.
 */
export function mapSummaryRowToDeliverySectionFull(
  row: DashboardSummaryRow
): DashboardSummaryDeliverySection {
  return {
    activeProjects: row.active_projects,
    projectsInReview: row.projects_in_review,
    completedProjects: row.completed_projects,
    pendingTasks: row.pending_tasks,
    inProgressTasks: row.in_progress_tasks,
    reviewTasks: row.review_tasks,
    actionableTasks: row.pending_tasks + row.in_progress_tasks,
  }
}

/**
 * Convert a raw RPC row into the wire-shape delivery section with task
 * counters masked to `null` (for roles whose RLS denies `tasks`
 * SELECT: `sales`, `sales_manager`).
 *
 * Project counters remain populated because all five roles can SELECT
 * `projects`.
 */
export function mapSummaryRowToDeliverySectionTaskMasked(
  row: DashboardSummaryRow
): DashboardSummaryDeliverySection {
  return {
    activeProjects: row.active_projects,
    projectsInReview: row.projects_in_review,
    completedProjects: row.completed_projects,
    pendingTasks: null,
    inProgressTasks: null,
    reviewTasks: null,
    actionableTasks: null,
  }
}
