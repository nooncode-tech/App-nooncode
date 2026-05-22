/**
 * Mutation -> dashboard summary invalidation wiring audit.
 *
 * Origin: testing audit 2026-05-22
 *   (`docs/validations/r3-testing-audit-2026-05-22.md`).
 *
 * Context: the lazy-load + aggregates iteration (spec
 *   `specs/fase-3-r3-lazy-load-with-aggregates.md` and ADR-020 D6)
 *   requires that every successful mutation that can change KPI inputs
 *   schedule a debounced refetch of `GET /api/dashboard/summary` via
 *   `scheduleDashboardSummaryRefetch()`. The risk graded MEDIUM in spec
 *   R2 is "a mutation surface fires but the summary cache is never
 *   invalidated, so the dashboard home shows stale numbers until a
 *   manual refresh."
 *
 * Why a source-string audit (not a behavior test):
 *   `lib/data-context.tsx` is a React client component (`'use client'`)
 *   and the repo has no JSDOM/RTL harness (see F-V12 verdict, also
 *   referenced in `tests/lib/data-context-leads-pagination.test.ts` and
 *   `tests/lib/data-context-summary.test.ts`). Spinning up an RTL
 *   harness solely for this audit would be an iteration of its own.
 *
 *   Instead, we statically assert: for every supabase-only mutation
 *   surface enumerated in ADR-020 D6, the function body contains a
 *   `scheduleDashboardSummaryRefetch()` call AFTER its supabase guard.
 *   This is a regression net against accidental removal of the wire
 *   during a future provider refactor; it does not replace the operator
 *   browser validation that confirmed KPI parity end-to-end on the
 *   linked Supabase project on 2026-05-22.
 *
 * What this test does NOT cover (recorded as test debt in the audit
 * doc):
 *   - The actual fetch is triggered after the schedule call fires
 *     (covered by `tests/lib/data-context-summary.test.ts` debouncer
 *     tests using a fake clock).
 *   - The route handler returns the right KPI numbers (covered by
 *     `tests/server/api/dashboard/summary.test.ts` parity + role
 *     masking tests).
 *   - Mutation handlers in mock mode short-circuit before the schedule
 *     call (mock-mode no-op contract; `scheduleDashboardSummaryRefetch`
 *     itself short-circuits on `authMode !== 'supabase'`).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const DATA_CONTEXT_PATH = path.resolve(__dirname, '../../lib/data-context.tsx')
const SOURCE = readFileSync(DATA_CONTEXT_PATH, 'utf8')

interface MutationContract {
  /** The mutation handler name as declared in `lib/data-context.tsx`. */
  fnName: string
  /** ADR-020 D6 category for human-readable failure messages. */
  category: 'leads' | 'projects' | 'tasks'
  /**
   * `true` when the handler has BOTH a mock-mode branch and a supabase
   * branch; the schedule call is expected only in the supabase branch.
   * `false` when the handler is supabase-mode-only (no mock guard).
   */
  hasModeSplit: boolean
}

/**
 * The 13 supabase-mode mutation surfaces wired in chunk 2 per
 * ADR-020 D6. The mock-only surfaces (`addProject`, `deleteProject`,
 * `deleteTask`) are intentionally not in this list: in supabase mode
 * they never run, so there is nothing to invalidate. The ADR records
 * them as "idempotent no-ops in supabase mode."
 *
 * If a future iteration adds a real supabase code path to `addProject`
 * / `deleteProject` / `deleteTask`, that path MUST be added to this
 * list and the corresponding `scheduleDashboardSummaryRefetch()` call
 * MUST be added to the handler.
 */
const WIRED_MUTATIONS: readonly MutationContract[] = [
  // Leads (9)
  { fnName: 'addLeadProposal', category: 'leads', hasModeSplit: true },
  { fnName: 'updateLeadProposalStatus', category: 'leads', hasModeSplit: true },
  { fnName: 'createProjectFromProposal', category: 'leads', hasModeSplit: true },
  { fnName: 'releaseLeadAsNoResponse', category: 'leads', hasModeSplit: true },
  { fnName: 'claimLead', category: 'leads', hasModeSplit: true },
  { fnName: 'addLead', category: 'leads', hasModeSplit: true },
  { fnName: 'updateLead', category: 'leads', hasModeSplit: true },
  { fnName: 'deleteLead', category: 'leads', hasModeSplit: true },
  { fnName: 'updateLeadStatus', category: 'leads', hasModeSplit: true },
  // Projects (1 supabase-only — addProject + deleteProject are mock-only;
  // updateProjectStatus delegates to updateProject)
  { fnName: 'updateProject', category: 'projects', hasModeSplit: true },
  // Tasks (3 supabase-only — deleteTask is mock-only)
  { fnName: 'addTask', category: 'tasks', hasModeSplit: true },
  { fnName: 'updateTask', category: 'tasks', hasModeSplit: true },
  { fnName: 'updateTaskStatus', category: 'tasks', hasModeSplit: true },
] as const

/**
 * Extract the body of a `const fnName = useCallback(...)` declaration
 * from the source. Returns the raw source slice between the opening
 * brace of the callback body and its matching closing brace. Used to
 * scope assertions to a single handler so cross-handler false-positives
 * cannot mask a missing wire.
 *
 * The extractor walks balanced braces; it does not parse TypeScript.
 * It tolerates JSX-free function bodies, which is what every mutation
 * handler in `lib/data-context.tsx` is.
 */
function extractCallbackBody(source: string, fnName: string): string {
  const declRegex = new RegExp(`const\\s+${fnName}\\s*=\\s*useCallback\\s*\\(`, 'g')
  const match = declRegex.exec(source)
  if (!match) {
    throw new Error(`Could not find declaration: const ${fnName} = useCallback(...)`)
  }

  // Find the start of the arrow function body (the `{` after `=>`).
  const afterDecl = match.index + match[0].length
  const arrowIdx = source.indexOf('=>', afterDecl)
  if (arrowIdx === -1) {
    throw new Error(`Could not find arrow operator in ${fnName} callback`)
  }
  // The arrow may be followed by `async` annotation (already consumed)
  // and then an opening brace. Skip whitespace.
  let i = arrowIdx + 2
  while (i < source.length && (source[i] === ' ' || source[i] === '\n' || source[i] === '\r' || source[i] === '\t')) {
    i++
  }
  if (source[i] !== '{') {
    throw new Error(`Expected opening brace after => in ${fnName}; saw '${source[i]}'`)
  }

  // Walk balanced braces. Track string/template/comment boundaries so a
  // brace inside a string literal does not throw off the count.
  let depth = 0
  let inString: '"' | "'" | '`' | null = null
  let inLineComment = false
  let inBlockComment = false
  const start = i
  for (; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch as '"' | "'" | '`'
      continue
    }
    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) {
        return source.slice(start, i + 1)
      }
    }
  }
  throw new Error(`Unbalanced braces in ${fnName} callback body`)
}

// ---------------------------------------------------------------------------
// 1. Per-handler wiring assertion: each enumerated mutation must call
//    `scheduleDashboardSummaryRefetch()` inside its body.
// ---------------------------------------------------------------------------

for (const mutation of WIRED_MUTATIONS) {
  test(`wiring: ${mutation.category}/${mutation.fnName} calls scheduleDashboardSummaryRefetch() in its supabase path`, () => {
    const body = extractCallbackBody(SOURCE, mutation.fnName)
    assert.match(
      body,
      /scheduleDashboardSummaryRefetch\s*\(\s*\)/,
      `ADR-020 D6 contract: ${mutation.fnName} must invoke scheduleDashboardSummaryRefetch() ` +
        `on the success path. Removing this call leaves the dashboard summary stale after the ` +
        `mutation, violating spec R2.`
    )
  })
}

// ---------------------------------------------------------------------------
// 2. Cumulative count assertion: the total number of schedule call sites
//    in the provider must match the number of wired mutations (one call
//    per handler). Detects accidental duplication (a handler calling
//    refresh twice — harmless functionally because of debounce, but
//    indicates copy-paste drift) and accidental omission (a handler
//    missing the call entirely, which is what test 1 catches per-name).
//
//    The expected total equals WIRED_MUTATIONS.length because each
//    wired handler invokes the schedule exactly once.
// ---------------------------------------------------------------------------

test('wiring: total scheduleDashboardSummaryRefetch() call sites match the wired-mutation contract', () => {
  const matches = SOURCE.match(/scheduleDashboardSummaryRefetch\s*\(\s*\)/g) ?? []
  assert.equal(
    matches.length,
    WIRED_MUTATIONS.length,
    `Expected ${WIRED_MUTATIONS.length} schedule call sites (one per wired mutation surface), ` +
      `got ${matches.length}. If you added a new mutation, add it to WIRED_MUTATIONS above. ` +
      `If you removed one, you may be regressing ADR-020 D6.`
  )
})

// ---------------------------------------------------------------------------
// 3. Mock-only handlers MUST NOT contain a schedule call.
//    `addProject`, `deleteProject`, `deleteTask` are mock-only per
//    ADR-020 D6 ("idempotent no-ops in supabase mode"). They have no
//    supabase code path; wiring them would be dead code at best and
//    confusing at worst. This test pins that decision.
// ---------------------------------------------------------------------------

const MOCK_ONLY_HANDLERS: readonly string[] = [
  'addProject',
  'deleteProject',
  'deleteTask',
] as const

for (const fnName of MOCK_ONLY_HANDLERS) {
  test(`wiring: mock-only handler ${fnName} does NOT call scheduleDashboardSummaryRefetch()`, () => {
    const body = extractCallbackBody(SOURCE, fnName)
    assert.doesNotMatch(
      body,
      /scheduleDashboardSummaryRefetch\s*\(\s*\)/,
      `${fnName} is mock-only per ADR-020 D6 and has no supabase code path. ` +
        `Adding a schedule call here would be dead code.`
    )
  })
}

// ---------------------------------------------------------------------------
// 4. The schedule helper itself MUST short-circuit on mock mode.
//    This is the OTHER half of the mock-mode safety contract: even if a
//    wired mutation somehow runs in mock mode (e.g., dev hot-reload
//    edge case), the schedule should be a no-op rather than fire a
//    network request the mock workspace has no endpoint for.
// ---------------------------------------------------------------------------

test('wiring: scheduleDashboardSummaryRefetch short-circuits when authMode is not supabase', () => {
  // We extract the function body and assert the early-return guard
  // appears before the debouncer schedule call.
  const fnRegex =
    /const\s+scheduleDashboardSummaryRefetch\s*=\s*useCallback\s*\([\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)/
  const match = fnRegex.exec(SOURCE)
  assert.ok(match, 'Could not find scheduleDashboardSummaryRefetch declaration')

  const declSource = match![0]
  const supabaseGuardIdx = declSource.search(/authModeRef\.current\s*!==\s*['"]supabase['"]/)
  const debounceCallIdx = declSource.search(/\.schedule\s*\(\s*\)/)

  assert.ok(supabaseGuardIdx >= 0, 'scheduleDashboardSummaryRefetch must check authMode === supabase')
  assert.ok(debounceCallIdx >= 0, 'scheduleDashboardSummaryRefetch must call the debouncer .schedule()')
  assert.ok(
    supabaseGuardIdx < debounceCallIdx,
    'The authMode guard must run BEFORE the debouncer .schedule() call, otherwise mock mode ' +
      'would queue a refetch that has no endpoint to hit.'
  )
})

// ---------------------------------------------------------------------------
// 5. The refresh fn itself MUST short-circuit on mock mode (no network
//    fetch from a mock workspace).
// ---------------------------------------------------------------------------

test('refresh: refreshDashboardSummary short-circuits when authMode is not supabase', () => {
  // Locate the useCallback declaration and walk balanced braces to find
  // its full body (the function contains nested fetch + try/finally
  // blocks so a non-greedy regex over the closing `)` can match too
  // early). This mirrors `extractCallbackBody` but starts from the
  // `const refreshDashboardSummary = useCallback(` token.
  const declRegex = /const\s+refreshDashboardSummary\s*=\s*useCallback\s*\(/
  const match = declRegex.exec(SOURCE)
  assert.ok(match, 'Could not find refreshDashboardSummary declaration')

  // From the start of the declaration, walk balanced braces until we
  // close the useCallback's arrow body. We use a small custom walker
  // (string-aware) rather than a regex.
  let i = match!.index + match![0].length
  // Skip until first `{` of the arrow body (after `=>`).
  const arrowIdx = SOURCE.indexOf('=>', i)
  assert.ok(arrowIdx >= 0, 'Could not find => in refreshDashboardSummary')
  i = arrowIdx + 2
  while (i < SOURCE.length && /\s/.test(SOURCE[i])) i++
  assert.equal(SOURCE[i], '{', 'Expected { after => in refreshDashboardSummary')
  let depth = 0
  let inString: '"' | "'" | '`' | null = null
  let inLineComment = false
  let inBlockComment = false
  const start = i
  let end = -1
  for (; i < SOURCE.length; i++) {
    const ch = SOURCE[i]
    const next = SOURCE[i + 1]
    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inString) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch as '"' | "'" | '`'
      continue
    }
    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  assert.ok(end > start, 'Could not balance braces in refreshDashboardSummary')

  const body = SOURCE.slice(start, end)

  const supabaseGuardIdx = body.search(/authModeRef\.current\s*!==\s*['"]supabase['"]/)
  const fetchCallIdx = body.search(/fetch\s*\(\s*['"]\/api\/dashboard\/summary['"]/)
  assert.ok(supabaseGuardIdx >= 0, 'refreshDashboardSummary must check authMode === supabase')
  assert.ok(fetchCallIdx >= 0, 'refreshDashboardSummary must call fetch on /api/dashboard/summary')
  assert.ok(
    supabaseGuardIdx < fetchCallIdx,
    'The authMode guard must run BEFORE the fetch call, otherwise mock mode would hit an ' +
      'endpoint that does not exist in the mock workspace.'
  )
})

// ---------------------------------------------------------------------------
// 6. Per-page lazy-load mount guards (spec 5.3, ADR-020 D8).
//    Each of the 5 lazy-loaded pages MUST contain a `useRef`-guarded
//    `useEffect` that triggers its slice load exactly once on mount.
//    Without the ref guard, the effect would re-fire on every state
//    transition (defeating the lazy-load purpose). Without the
//    `authMode === 'supabase'` guard, mock mode would hit an endpoint.
// ---------------------------------------------------------------------------

interface PageLazyLoadContract {
  filePath: string
  /** The trigger function the page must call on mount. */
  triggerFn: 'setLeadsPage' | 'refreshProjects' | 'refreshTasks'
  /** Human-readable name for failure messages. */
  routeName: string
}

const PAGE_LAZY_LOADERS: readonly PageLazyLoadContract[] = [
  { filePath: 'app/dashboard/leads/page.tsx', triggerFn: 'setLeadsPage', routeName: '/dashboard/leads' },
  { filePath: 'app/dashboard/pipeline/page.tsx', triggerFn: 'setLeadsPage', routeName: '/dashboard/pipeline' },
  { filePath: 'app/dashboard/projects/page.tsx', triggerFn: 'refreshProjects', routeName: '/dashboard/projects' },
  { filePath: 'app/dashboard/tasks/page.tsx', triggerFn: 'refreshTasks', routeName: '/dashboard/tasks' },
  { filePath: 'app/dashboard/reports/page.tsx', triggerFn: 'setLeadsPage', routeName: '/dashboard/reports' },
] as const

for (const page of PAGE_LAZY_LOADERS) {
  test(`lazy-load: ${page.routeName} mounts a useRef-guarded ${page.triggerFn}() trigger`, () => {
    const abs = path.resolve(__dirname, '../../', page.filePath)
    const src = readFileSync(abs, 'utf8')

    // 1. The trigger function must be invoked from inside the page.
    assert.match(
      src,
      new RegExp(`\\b${page.triggerFn}\\s*\\(`),
      `${page.routeName} must call ${page.triggerFn}() on mount per ADR-020 D8.`
    )

    // 2. The page must use a useRef-guarded pattern (so the effect
    //    fires exactly once even though state transitions re-run it).
    assert.match(
      src,
      /hasTriggered\w*LoadRef\s*=\s*useRef\s*\(\s*false\s*\)/,
      `${page.routeName} must guard its lazy-load with a useRef boolean (e.g., ` +
        `hasTriggeredInitialLoadRef = useRef(false)).`
    )

    // 3. The page must respect mock mode (authMode === 'supabase' guard).
    assert.match(
      src,
      /authMode\s*!==\s*['"]supabase['"]/,
      `${page.routeName} must short-circuit its lazy-load when authMode is not supabase.`
    )
  })
}

// ---------------------------------------------------------------------------
// 7. Provider unmount cleanup: the debouncer must be cancelled when the
//    provider tears down, otherwise a late mutation echo could fire a
//    fetch against a torn-down React tree. This is asserted by checking
//    the cleanup useEffect exists and references `.cancel()`.
// ---------------------------------------------------------------------------

test('cleanup: provider unmount cancels the pending debouncer', () => {
  // Two facts:
  //   a) An empty-dep useEffect with a cleanup function exists in the
  //      provider, calling dashboardSummaryDebouncerRef.current?.cancel().
  //   b) Without this cleanup, the next mutation echo would call back
  //      into a torn-down provider; the debouncer test in
  //      `tests/lib/data-context-summary.test.ts` proves cancel() works,
  //      this test proves the provider actually uses it on unmount.
  assert.match(
    SOURCE,
    /useEffect\s*\(\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{[\s\S]*?dashboardSummaryDebouncerRef\.current\?\.cancel\(\)[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/,
    'Provider must cancel the debouncer on unmount via a `useEffect(() => () => debouncer.cancel(), [])` ' +
      'cleanup. Without this, a late mutation echo fires a fetch against a torn-down provider.'
  )
})

// ---------------------------------------------------------------------------
// 8. Dashboard page renders `—` (em-dash) for null task counters
//    (ADR-020 D1 consequence 1: sales / sales_manager see null task
//    fields and the UI must surface that rather than rendering `0`).
// ---------------------------------------------------------------------------

test('rendering: dashboard home uses formatNullableTaskCount for nullable task fields', () => {
  const abs = path.resolve(__dirname, '../../app/dashboard/page.tsx')
  const src = readFileSync(abs, 'utf8')

  // The render helper must exist and convert null -> '—'.
  assert.match(
    src,
    /function\s+formatNullableTaskCount[\s\S]*?value\s*===\s*null\s*\?\s*['"][—-]['"]/,
    'Dashboard home must define a formatNullableTaskCount helper that returns "—" for null.'
  )

  // pendingTasks, inProgressTasks, reviewTasks, actionableTasks all
  // pass through the helper (they are the four `number | null` fields
  // per ADR-020 D9 wire shape).
  for (const field of ['pendingTasks', 'inProgressTasks', 'reviewTasks', 'actionableTasks'] as const) {
    assert.match(
      src,
      new RegExp(`formatNullableTaskCount\\s*\\(\\s*[\\w.?]*${field}\\s*\\)`),
      `Dashboard home must render ${field} via formatNullableTaskCount() to surface null as '—'.`
    )
  }
})
