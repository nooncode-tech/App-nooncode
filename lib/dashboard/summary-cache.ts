/**
 * Pure helpers for the client-side dashboard-summary cache and
 * mutation-invalidation debouncer.
 *
 * Lives outside `lib/data-context.tsx` so it is unit-testable in
 * isolation (the provider is a React client component and the repo has
 * no JSDOM/RTL harness — see `tests/lib/data-context-leads-pagination.test.ts`
 * for the same convention).
 *
 * @see docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md
 *      §D5 (60s stale-while-revalidate TTL)
 *      §D6 (refetch-on-mutate, debounced 250ms)
 */

/**
 * Stale-while-revalidate freshness window for the dashboard summary
 * cache. Reads younger than this are served from memory without a
 * network fetch unless the caller forces a refresh. Mutation
 * invalidation bypasses the TTL.
 */
export const DASHBOARD_SUMMARY_TTL_MS = 60_000

/**
 * Coalescing window for mutation-triggered refetches. Calls within
 * this window collapse to a single fetch. Shorter than human-
 * perceptible latency on a mutation echo (250ms ≈ the threshold below
 * which a UI feels instant), so the debounce does not feel like UI lag.
 */
export const DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS = 250

/**
 * Returns `true` when the cached payload is fresh enough to serve
 * without re-fetching. Returns `false` when the cache is empty, stale,
 * or the caller explicitly forced a refresh.
 *
 * - `fetchedAtMs`: timestamp of the most recent successful fetch
 *   (Date.now()). `null` when no successful fetch has happened yet.
 * - `nowMs`: the current moment. Injected for test determinism.
 * - `force`: when `true`, the function always returns `false` (the
 *   caller wants a fresh read regardless of TTL).
 * - `ttlMs`: defaults to `DASHBOARD_SUMMARY_TTL_MS`; configurable so
 *   tests can exercise boundary conditions without waiting 60 seconds.
 *
 * Contract: a payload exactly at `fetchedAt + ttlMs` is treated as
 * still fresh (`<` comparison). One millisecond later it becomes
 * stale. This matches the existing JS reference convention for
 * inclusive freshness windows.
 */
export function isDashboardSummaryFresh(args: {
  fetchedAtMs: number | null
  nowMs: number
  force: boolean
  ttlMs?: number
}): boolean {
  if (args.force) {
    return false
  }
  if (args.fetchedAtMs === null) {
    return false
  }
  const ttl = args.ttlMs ?? DASHBOARD_SUMMARY_TTL_MS
  return args.nowMs - args.fetchedAtMs < ttl
}

/**
 * Minimal debouncer surface for mutation-triggered refetches.
 *
 * The provider uses a `setTimeout` ref keyed on the provider instance;
 * each call clears the previous timer and schedules a new one. The
 * pure logic here is "what timer is set after N calls within the
 * window?" — encapsulated so the provider stays focused on React
 * state and the policy is exercised in tests.
 */
export interface DashboardSummaryDebouncer {
  /**
   * Schedule a refetch. If a previous schedule has not yet fired, it
   * is cancelled and replaced. The latest call wins.
   */
  schedule(): void
  /**
   * Cancel any pending refetch (e.g., on provider unmount).
   */
  cancel(): void
  /**
   * Whether a refetch is currently scheduled (test affordance).
   */
  isPending(): boolean
}

/**
 * Create a debouncer instance for the dashboard-summary mutation
 * invalidation flow. Injects a `setTimeout` / `clearTimeout` pair so
 * tests can substitute a synchronous fake clock.
 *
 * - `onTrigger`: callback invoked after `delayMs` has elapsed without
 *   another `schedule()` call resetting the timer.
 * - `delayMs`: defaults to `DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS`.
 * - `setTimeoutFn` / `clearTimeoutFn`: injected timer hooks. Defaults
 *   to the global `setTimeout` / `clearTimeout`. The provider passes
 *   the globals; tests pass a fake clock that fires on demand.
 */
export function createDashboardSummaryDebouncer(args: {
  onTrigger: () => void
  delayMs?: number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}): DashboardSummaryDebouncer {
  const delay = args.delayMs ?? DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS
  const scheduleFn = args.setTimeoutFn ?? setTimeout
  const cancelFn = args.clearTimeoutFn ?? clearTimeout

  let timerId: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (timerId !== null) {
      cancelFn(timerId)
      timerId = null
    }
  }

  return {
    schedule() {
      cancel()
      timerId = scheduleFn(() => {
        timerId = null
        args.onTrigger()
      }, delay)
    },
    cancel,
    isPending() {
      return timerId !== null
    },
  }
}
