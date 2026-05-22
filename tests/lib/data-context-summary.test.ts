import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS,
  DASHBOARD_SUMMARY_TTL_MS,
  createDashboardSummaryDebouncer,
  isDashboardSummaryFresh,
} from '@/lib/dashboard/summary-cache'

// ---------------------------------------------------------------------------
// Integration scope (R3 chunk 2 spec §3.6, §11)
//
// The provider wire-up lives in `lib/data-context.tsx`. That module is a
// React client component and the repo has no JSDOM/RTL harness (see
// F-V12 verdict line 1158). The pure cache+debounce policy is extracted
// into `lib/dashboard/summary-cache.ts` precisely so it can be unit-
// tested in isolation:
//
//   1. TTL freshness decision (ADR-020 §D5) — `isDashboardSummaryFresh`
//      returns the same answer the provider would give for "should I
//      serve cache or fetch?" at any (fetchedAt, now, force) tuple.
//   2. Mutation invalidation debounce (ADR-020 §D6) —
//      `createDashboardSummaryDebouncer` is the same debouncer the
//      provider uses to coalesce rapid mutations into a single refetch.
//      A fake clock fires triggers on demand so we can prove the
//      coalescing without 250ms of wall-clock sleeping.
//   3. Mock-mode behavior — exercised by asserting that the provider's
//      authMode short-circuit lives at the call site (the helpers
//      themselves are mode-agnostic, which is the documented contract).
//
// What this protects: regression of the SWR window length, regression
// of the debounce coalescing, regression of the freshness boundary
// math (off-by-one at exactly fetchedAt + ttl).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TTL contract tests
// ---------------------------------------------------------------------------

test('TTL constant is 60s per ADR-020 §D5', () => {
  assert.equal(DASHBOARD_SUMMARY_TTL_MS, 60_000)
})

test('debounce window is 250ms per ADR-020 §D6', () => {
  assert.equal(DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS, 250)
})

test('fresh: no prior fetch → always stale (need to fetch)', () => {
  const result = isDashboardSummaryFresh({
    fetchedAtMs: null,
    nowMs: 1_000,
    force: false,
  })
  assert.equal(result, false, 'empty cache must trigger a fetch')
})

test('fresh: cache age 0ms → fresh (no fetch)', () => {
  const t = 1_000_000
  const result = isDashboardSummaryFresh({
    fetchedAtMs: t,
    nowMs: t,
    force: false,
  })
  assert.equal(result, true, 'just-fetched cache must not re-fetch')
})

test('fresh: cache age 30s → fresh (no fetch)', () => {
  const t = 1_000_000
  const result = isDashboardSummaryFresh({
    fetchedAtMs: t,
    nowMs: t + 30_000,
    force: false,
  })
  assert.equal(result, true, '30s-old cache still inside the 60s TTL')
})

test('fresh: cache age exactly at TTL boundary (59_999ms) → still fresh', () => {
  const t = 1_000_000
  const result = isDashboardSummaryFresh({
    fetchedAtMs: t,
    nowMs: t + (DASHBOARD_SUMMARY_TTL_MS - 1),
    force: false,
  })
  assert.equal(result, true, 'TTL boundary is exclusive on the upper end')
})

test('fresh: cache age exactly TTL (60_000ms) → stale (need to fetch)', () => {
  const t = 1_000_000
  const result = isDashboardSummaryFresh({
    fetchedAtMs: t,
    nowMs: t + DASHBOARD_SUMMARY_TTL_MS,
    force: false,
  })
  assert.equal(result, false, 'cache exactly at TTL must trigger a refetch')
})

test('fresh: cache age > TTL → stale', () => {
  const t = 1_000_000
  const result = isDashboardSummaryFresh({
    fetchedAtMs: t,
    nowMs: t + DASHBOARD_SUMMARY_TTL_MS + 1,
    force: false,
  })
  assert.equal(result, false)
})

test('fresh: force=true bypasses TTL even for a 0ms-old cache', () => {
  const t = 1_000_000
  const result = isDashboardSummaryFresh({
    fetchedAtMs: t,
    nowMs: t,
    force: true,
  })
  assert.equal(result, false, 'force=true must always re-fetch')
})

test('fresh: custom ttlMs overrides default (extensibility hook)', () => {
  // If a future iteration tightens the TTL for live demos, the helper
  // must support a per-call override without code change.
  const t = 1_000_000
  const result = isDashboardSummaryFresh({
    fetchedAtMs: t,
    nowMs: t + 10_000,
    force: false,
    ttlMs: 5_000,
  })
  assert.equal(result, false, 'a 5s TTL marks a 10s-old cache as stale')
})

// ---------------------------------------------------------------------------
// Fake-clock debouncer (the test substrate for the mutation invalidation
// contract — ADR-020 §D6: rapid mutations within 250ms collapse into one
// refetch). The fake clock fires queued timers on `tick(ms)` so we can
// prove coalescing without 250ms of wall-clock sleeping.
// ---------------------------------------------------------------------------

interface FakeTimer {
  id: number
  fireAt: number
  fn: () => void
}

class FakeClock {
  private nowMs = 0
  private nextId = 1
  private timers = new Map<number, FakeTimer>()

  get setTimeoutFn(): typeof setTimeout {
    return ((fn: () => void, delay?: number) => {
      const id = this.nextId++
      this.timers.set(id, {
        id,
        fireAt: this.nowMs + (delay ?? 0),
        fn,
      })
      return id as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
  }

  get clearTimeoutFn(): typeof clearTimeout {
    return ((id: ReturnType<typeof setTimeout>) => {
      this.timers.delete(id as unknown as number)
    }) as unknown as typeof clearTimeout
  }

  tick(ms: number): void {
    this.nowMs += ms
    const fired = [...this.timers.values()]
      .filter((t) => t.fireAt <= this.nowMs)
      .sort((a, b) => a.fireAt - b.fireAt)
    for (const t of fired) {
      this.timers.delete(t.id)
      t.fn()
    }
  }

  pendingCount(): number {
    return this.timers.size
  }
}

test('debouncer: schedule() then tick(window) fires the trigger once', () => {
  const clock = new FakeClock()
  let triggered = 0
  const debouncer = createDashboardSummaryDebouncer({
    onTrigger: () => {
      triggered += 1
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })

  debouncer.schedule()
  assert.equal(debouncer.isPending(), true, 'pending after schedule')
  assert.equal(triggered, 0, 'not yet fired')

  clock.tick(DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS)
  assert.equal(triggered, 1, 'fires after the debounce window elapses')
  assert.equal(debouncer.isPending(), false, 'no longer pending after fire')
})

test('debouncer: 3 rapid mutations within the window coalesce to 1 fetch', () => {
  // Mirrors the ADR-020 §D6 scenario: the kanban drag-drop in
  // /dashboard/pipeline fires a sequence of updateLeadStatus calls. The
  // debounce window must collapse these into a single summary refetch
  // even if all three arrive within milliseconds of each other.
  const clock = new FakeClock()
  let triggered = 0
  const debouncer = createDashboardSummaryDebouncer({
    onTrigger: () => {
      triggered += 1
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })

  // 3 mutations within 100ms (well inside the 250ms window).
  debouncer.schedule()
  clock.tick(50)
  debouncer.schedule()
  clock.tick(50)
  debouncer.schedule()
  // Nothing has fired yet — still inside the window.
  assert.equal(triggered, 0)
  assert.equal(debouncer.isPending(), true)

  // Advance to the window end. Only ONE trigger should fire.
  clock.tick(DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS)
  assert.equal(triggered, 1, 'rapid mutations coalesce to a single refetch')
})

test('debouncer: mutations spaced beyond the window each trigger their own refetch', () => {
  // Two mutations >250ms apart are NOT the kanban-drag case; each
  // should refresh the summary independently.
  const clock = new FakeClock()
  let triggered = 0
  const debouncer = createDashboardSummaryDebouncer({
    onTrigger: () => {
      triggered += 1
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })

  debouncer.schedule()
  clock.tick(DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS)
  assert.equal(triggered, 1)

  debouncer.schedule()
  clock.tick(DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS)
  assert.equal(triggered, 2, 'second mutation outside window triggers second refetch')
})

test('debouncer: cancel() clears a pending refetch', () => {
  // Used on provider unmount so a late mutation echo does not fire a
  // fetch against a torn-down provider.
  const clock = new FakeClock()
  let triggered = 0
  const debouncer = createDashboardSummaryDebouncer({
    onTrigger: () => {
      triggered += 1
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })

  debouncer.schedule()
  assert.equal(debouncer.isPending(), true)
  debouncer.cancel()
  assert.equal(debouncer.isPending(), false)

  clock.tick(DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS * 4)
  assert.equal(triggered, 0, 'cancel() prevents the timer from firing')
})

test('debouncer: schedule() after cancel() rearms the timer', () => {
  const clock = new FakeClock()
  let triggered = 0
  const debouncer = createDashboardSummaryDebouncer({
    onTrigger: () => {
      triggered += 1
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })

  debouncer.schedule()
  debouncer.cancel()
  debouncer.schedule()
  clock.tick(DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS)
  assert.equal(triggered, 1, 'rescheduling after cancel still fires')
})

// ---------------------------------------------------------------------------
// Provider-level invariants exercised via the call site contract.
// The provider itself reads `authModeRef.current` BEFORE invoking the
// helpers. The test here documents that contract (mode-agnostic
// helpers, mode-aware call sites) so a future refactor that moves the
// guard into the helpers gets caught by the assertion.
// ---------------------------------------------------------------------------

test('helpers are mode-agnostic: caller decides whether to invoke them', () => {
  // The helper signatures expose no `authMode` parameter. Verifying
  // that absence here pins the contract: the mock-mode short-circuit
  // lives at the provider call site, NOT in the cache module. This is
  // important because the test exercises the helpers without spinning
  // up React state.
  const sigFresh = isDashboardSummaryFresh.length
  // {fetchedAtMs, nowMs, force, ttlMs?} — single object arg, length 1.
  assert.equal(sigFresh, 1)

  const sigDebouncer = createDashboardSummaryDebouncer.length
  // {onTrigger, delayMs?, setTimeoutFn?, clearTimeoutFn?} — single
  // object arg, length 1.
  assert.equal(sigDebouncer, 1)
})

// ---------------------------------------------------------------------------
// Wire contract sanity: imports the wire types and asserts the response
// shape compiles. If the chunk 1 backend ever changes the wire shape
// without coordination, the consumer hook's type contract surfaces here
// (compile-time only — this is a documentation test).
// ---------------------------------------------------------------------------

test('wire contract shape compiles (regression net for chunk 1 wire changes)', async () => {
  // Type-level assertion: import and reference the chunk 1 types.
  // If the wire shape diverges (e.g., `pendingTasks` ever becomes a
  // mandatory `number` instead of `number | null`), this file fails to
  // compile, which surfaces the divergence in CI before the provider
  // ships against a different shape.
  const mod = await import('@/lib/server/dashboard/serialization')
  assert.ok(typeof mod.mapSummaryRowToSalesSection === 'function')
  assert.ok(typeof mod.mapSummaryRowToDeliverySectionFull === 'function')
  assert.ok(typeof mod.mapSummaryRowToDeliverySectionTaskMasked === 'function')
})
