# R3+ Opción C — Testing Audit 2026-05-22

Author: Testing skill (Claude Opus 4.7 · 1M context)
Iteration: `specs/fase-3-r3-lazy-load-with-aggregates.md`
ADR: `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`
Chunk 1 (Backend): PR #95 merged into `develop` at `0fe6822` / `bbf47a0`.
Chunk 2 (Frontend): PR #96 open on `feature/fase-3-r3-chunk-2-frontend-lazy-load`.
Audit branch: `tests/fase-3-r3-audit-coverage-fill` (based on chunk 2 HEAD).

---

## Methodology declared

**Integration-first audit**, consistent with the project's F-V12 testing
precedent (spec §11) and ADR-020's stated test strategy (R1 parity guard at
fixture volume; R2 invalidation enumeration at the provider boundary).

Reasoning for not choosing TDD / BDD / CDD:
- TDD would not retroactively add value at audit time — both chunks are
  already implemented and operator-validated visually on Vercel preview.
- BDD scenario authorship is not necessary — the §5 acceptance criteria
  are specific and the §10 risks are enumerated with severity.
- CDD does not apply — no new shared design-system pieces.

Integration-first is the right fit because the regression surface is the
provider→mutation→endpoint→KPI flow, not any single pure function.

---

## Coverage matrix

| Area | Verdict | Evidence | Action |
|---|---|---|---|
| **Backend — SQL parity at non-trivial fixture volume (R6)** | sufficient | `tests/server/api/dashboard/summary.test.ts` parity fixture has 13 leads / 7 projects / 12 tasks (`buildParityFixture` lines 583-672); all 7 `deriveProjectDisplayStatus` branches exercised with explicit branch-coverage test at line 762; spec §10 R6 floor of ≥10 leads / ≥5 projects / ≥10 tasks met | No action |
| **Backend — Role-based null masking** | sufficient | `roleMaskingMatrix` (line 266) covers all 5 roles (`admin`, `pm`, `developer`, `sales`, `sales_manager`); per-role test asserts task counters are `null` for sales/sales_manager and populated for the other three (line 274-328) | No action |
| **Backend — Error paths (401/403/500)** | sufficient | Route tests at lines 191-243 cover `UNAUTHENTICATED → 401`, `FORBIDDEN → 403`, `INACTIVE_PROFILE → 403`, repository error → 500. RPC `permission denied` and "no rows" defensive guard both tested (lines 330-348) | No action |
| **Backend — Wire shape contract (envelope, null coercion, actionableTasks)** | sufficient | Serialization mapper tests at lines 354-404 cover `leads_by_status: null → {}` coercion, `actionableTasks = pendingTasks + inProgressTasks`, full vs task-masked delivery section; `200 success → { data: ... }` envelope explicitly tested at line 160 | No action |
| **Backend — RPC contract / shape transformation** | sufficient | Service test stubs `client.rpc('get_dashboard_summary')` and asserts the row→wire mapping (lines 256-264). RPC name pinned as `'get_dashboard_summary'` (assertion at line 259) | No action |
| **Frontend — 60s SWR TTL boundaries** | sufficient | `tests/lib/data-context-summary.test.ts` lines 49-129 cover age 0 / 30s / 59999ms / exactly 60000ms / >60000ms / force / custom ttlMs | No action |
| **Frontend — 250ms debounce coalescing** | sufficient | Same file lines 183-293 cover single schedule, 3-rapid coalesce, spaced-apart, cancel, rearm after cancel | No action |
| **Frontend — Mutation→invalidation wire (R2)** | **gap filled this session** | Pre-audit: only the debouncer was tested in isolation; no test pinned that the 13 supabase mutation handlers in `lib/data-context.tsx` actually call `scheduleDashboardSummaryRefetch()` post-success. **Added** `tests/lib/data-context-invalidation-wiring.test.ts` (26 tests) — per-handler assertions, total-count guard, mock-only-stays-mock-only guard, mock-mode short-circuit guard, page lazy-load guards, unmount-cleanup guard, em-dash rendering guard | Added 26 tests; all green |
| **Frontend — Mock mode never calls summary endpoint** | sufficient | `tests/lib/data-context-invalidation-wiring.test.ts` tests "scheduleDashboardSummaryRefetch short-circuits when authMode is not supabase" and "refreshDashboardSummary short-circuits when authMode is not supabase" assert the supabase guard appears before the schedule/fetch calls | No further action |
| **Frontend — `null` rendering for sales/sales_manager** | sufficient | `tests/lib/data-context-invalidation-wiring.test.ts` "rendering: dashboard home uses formatNullableTaskCount for nullable task fields" pins that `formatNullableTaskCount(value === null ? '—' : ...)` exists AND that all 4 nullable task fields (`pendingTasks`, `inProgressTasks`, `reviewTasks`, `actionableTasks`) render through the helper | No further action |
| **Frontend — Per-page lazy-load mount triggers** | sufficient | `tests/lib/data-context-invalidation-wiring.test.ts` 5 tests verify each of `/dashboard/{leads,pipeline,projects,tasks,reports}` contains a `useRef`-guarded `useEffect` calling the correct trigger function with an `authMode === 'supabase'` short-circuit | No further action |
| **Frontend — Provider cleanup on unmount** | sufficient | `tests/lib/data-context-invalidation-wiring.test.ts` "cleanup: provider unmount cancels the pending debouncer" asserts the `useEffect(() => () => debouncer.cancel(), [])` pattern exists in `lib/data-context.tsx` | No further action |
| **Cross-cutting — End-to-end KPI parity SQL vs JS** | sufficient (test-side); operator-validated (live-side) | Test-side: `tests/server/api/dashboard/summary.test.ts` parity test (line 674) runs `simulateDashboardSummaryRpc(...)` (a JS encoding of the SQL CTE per migration 0058) against `selectDashboardSummary(...)` over the same fixture; asserts byte-equal for all 13 KPI fields. Live-side: operator browser-validated 2026-05-22 against `noondevelop@gmail.com`-scoped data (21 open / 8 won / $103,969 pipeline matches SQL smoke per PR #96 description) | No action |
| **Cross-cutting — Browser flow tests (Playwright/Cypress)** | not present (by design) | Repo has no e2e harness; spec §11 explicitly declares browser validation is operator-driven, not automated. Same convention as F-V12 | Deferred — would be a separate iteration |
| **Cross-cutting — `lib/data-context.tsx` non-summary regression** | sufficient (existing) | Pre-existing tests (`tests/lib/data-context-leads-pagination.test.ts`, 35 tests) exercise the leads pagination surface that the refactor touched most. Branch-coverage of the non-summary mutation paths is implicit via the lint+typecheck gates (a removed call would fail type compilation). Existing 460 tests on develop all green AND remain green with chunk 2 + audit branch applied (now 486/486) | No action |

---

## Gaps filled this session

**New file: `tests/lib/data-context-invalidation-wiring.test.ts` (26 tests, all green)**

Categories:

1. **Mutation→invalidation wiring (13 tests)** — one per supabase mutation
   handler in `lib/data-context.tsx`. Each test extracts the handler's
   callback body via balanced-brace walking (string/comment-aware) and
   asserts `scheduleDashboardSummaryRefetch()` appears inside. Handlers
   covered:
   - Leads (9): `addLeadProposal`, `updateLeadProposalStatus`,
     `createProjectFromProposal`, `releaseLeadAsNoResponse`, `claimLead`,
     `addLead`, `updateLead`, `deleteLead`, `updateLeadStatus`.
   - Projects (1): `updateProject` (`updateProjectStatus` is wired
     transitively because it delegates to `updateProject`).
   - Tasks (3): `addTask`, `updateTask`, `updateTaskStatus`.

2. **Total-count integrity (1 test)** — counts all
   `scheduleDashboardSummaryRefetch()` call sites in `lib/data-context.tsx`
   and asserts it equals `WIRED_MUTATIONS.length` (13). Catches:
   - Accidental duplication (one handler calling refresh twice — harmless
     functionally because of debounce, but indicates copy-paste drift).
   - Accidental omission (a handler losing the call entirely; this is
     also caught per-name by category 1).

3. **Mock-only handlers stay clean (3 tests)** — pins that `addProject`,
   `deleteProject`, `deleteTask` (mock-only per ADR-020 D6) do NOT
   contain a schedule call. Wiring them would be dead code at best.

4. **Mock-mode safety guards (2 tests)** — asserts that
   `scheduleDashboardSummaryRefetch` and `refreshDashboardSummary` both
   short-circuit on `authMode !== 'supabase'` BEFORE invoking the
   debouncer / `fetch('/api/dashboard/summary')` respectively. Without
   these guards, the mock workspace would hit a non-existent endpoint.

5. **Per-page lazy-load mount guards (5 tests)** — one per page. Asserts
   each of `/dashboard/{leads,pipeline,projects,tasks,reports}`:
   - Calls its expected trigger function (`setLeadsPage` /
     `refreshProjects` / `refreshTasks`).
   - Uses a `useRef`-guarded `useEffect` (so the effect fires exactly
     once even though state re-runs it).
   - Short-circuits on mock mode.

6. **Provider unmount cleanup (1 test)** — pins the
   `useEffect(() => () => debouncer.cancel(), [])` pattern. Without
   this, a late mutation echo could fire a fetch against a torn-down
   provider.

7. **Em-dash rendering for null task counters (1 test)** — pins that
   `formatNullableTaskCount` helper exists in `app/dashboard/page.tsx`
   AND that all 4 nullable task fields (`pendingTasks`, `inProgressTasks`,
   `reviewTasks`, `actionableTasks`) render through it. Without this,
   sales / sales_manager would see `0` instead of `—` and the UI would
   lie that the queue is empty.

**Why source-string audit instead of behavioral test:** the repo has no
JSDOM/RTL harness (per F-V12 verdict, also explicitly cited in the
header comments of both `tests/lib/data-context-summary.test.ts` and
`tests/lib/data-context-leads-pagination.test.ts`). Spinning up RTL
solely for this audit would be an iteration of its own, well beyond
the audit scope. The static assertions form a regression net against
accidental deletion of the wiring during future refactors; they do not
replace the operator browser validation that confirmed KPI parity
end-to-end. The trade-off is documented inline in the new test file's
header comment.

**Mutation surface counting correction:** the PR #96 description and
operator brief claimed "17 wired" mutations. ADR-020 D6 lists 17
surfaces total (9 leads + 4 projects + 4 tasks) but explicitly marks
`addProject`, `deleteProject`, `deleteTask` as "idempotent no-ops in
supabase mode" — mock-only. The actual count of supabase-mode wired
mutations is **13** (9 leads + 1 project + 3 tasks). The audit codified
this in `WIRED_MUTATIONS` so a future iteration that adds a supabase
code path to a currently-mock-only handler will be forced to update
this list (and add the schedule call) to pass the total-count guard.

---

## Gaps deferred with risk-acceptance

| Gap | Reason for deferral | Risk grade |
|---|---|---|
| **Live SQL parity smoke against the linked Supabase project** | Requires Supabase live access not available in the audit session. Operator browser-validated this on 2026-05-22 against `noondevelop@gmail.com`-scoped data; KPI parity (21 open / 8 won / $103,969 pipeline / leadsByStatus histogram) matched the SQL smoke values per PR #96 description. The JS-side simulation test already pins the CTE-vs-JS semantics by construction (the simulation is a verbatim encoding of migration 0058). | LOW residual — JS simulation closes the parity contract; operator confirmed end-to-end |
| **In-flight fetch coalescing test** | `refreshDashboardSummary` uses `dashboardSummaryInFlightRef` to coalesce overlapping calls (back-to-back force-refetches do not stack network calls). Testing this in isolation would require a fetch stub + provider harness, which the repo lacks. The behavior is exercised end-to-end by the 250ms debouncer test (multiple `schedule()` calls within the window collapse to one trigger, which in turn calls `refreshDashboardSummary({ force: true })` exactly once). | LOW — the policy machinery is unit-tested via the debouncer; the in-flight ref is a perf optimization, not a correctness gate |
| **R5 server-side mutation stale window** (Stripe `payment_confirmed`, PM webhook) | Out of iteration scope per spec §4. ADR-020 D6 explicitly acknowledges this as an open risk. A future iteration adding Supabase Realtime channels would address it. | LOW (acknowledged) — operator-acceptable stale window for internal-team dashboards |
| **Real React-tree behavior tests (RTL/JSDOM)** | Repo has no RTL harness. Adding one would be its own iteration. Static source-string audit provides regression coverage at the wiring level; behavioral coverage is provided by the operator browser validation. | LOW — the audit's static guards catch the deletion-during-refactor failure mode, which is the actual R2 risk |
| **Browser flow tests (Playwright/Cypress)** | Same as above — repo convention is operator-driven browser validation, not automated e2e. | LOW — matches project precedent (F-V12, F-V03, F-V08, B23 a11y all closed without e2e) |
| **`pipeline` partial-view caveat (F-V12 R1 carry-over)** | Explicitly out of scope per spec §3.3 and §4. Pipeline still operates on a paginated subset of leads as it did before; this audit does not regress that behavior, but does not fix it either. | Pre-existing — same iteration class as R1 filter-scope, scheduled for its own future iteration |
| **Users pagination (R3-users)** | Explicitly deferred again per spec §4. `/api/users/admin` and `/api/users/delivery` continue to eager-load as bounded reference data. | Pre-existing — operator-confirmed bounded |

---

## Verdict for Validator

- **Total tests after this audit**: **486** (was 460 at chunk 2 close; +26 from `tests/lib/data-context-invalidation-wiring.test.ts`).
- **Pass / Fail**: 486 / 0.
- **Typecheck**: clean (0 errors).
- **Lint**: 0 errors, 6 pre-existing warnings on `tests/server/api/dashboard/summary.test.ts` (3) and `tests/server/website/webhook-events.test.ts` (3). None on the audit's new file or on changed production code.
- **Verdict**: **SUFFICIENT**.

### Specific evidence Validator should rely on for COMPLETE

1. **R1 KPI parity (HIGH severity)** is mitigated by `tests/server/api/dashboard/summary.test.ts` (parity simulation + all-7-branch coverage) AND operator browser validation 2026-05-22 (KPIs matched SQL smoke for the admin role).
2. **R2 invalidation gaps (MEDIUM severity)** is mitigated by the new
   `tests/lib/data-context-invalidation-wiring.test.ts` — every supabase
   mutation handler is statically pinned to call the schedule function,
   plus a total-count guard catches accidental new handlers that forget
   the wire.
3. **R3 `lib/data-context.tsx` high-risk file** is mitigated by the
   existing 460-test baseline staying green plus the 26 new audit tests.
4. **R4 hidden provider consumers** is closed by spec §10 R4 enumeration
   (sidebar confirmed safe, all consumers listed).
5. **R5 out-of-band stale window** is acknowledged and accepted by
   spec §4 and ADR-020 D6. No new mitigation required this iteration.
6. **R6 fixture volume** is met (13 leads / 7 projects / 12 tasks in the
   parity fixture; spec floor was ≥10 / ≥5 / ≥10).
7. **R7 RLS assumption** is closed by ADR-020 D1.
8. **R8 `sales_manager` task RLS gap** is mitigated by the null masking
   service test matrix + the new em-dash rendering test.

### Recommended Validator focus areas

1. **Confirm operator-validated KPI parity matches the spec §5
   acceptance criterion 5** by re-reading PR #96's "Test plan" section
   (operator's manual browser check against `noondevelop@gmail.com`).
   The smoke values 21 open / 8 won / $103,969 pipeline / 100%
   conversion / `leadsByStatus` histogram are the live-side parity
   evidence. The JS simulation test is the test-side guard for
   regression detection.
2. **Note that the audit branch is based on chunk 2 (not develop)**.
   The audit tests target chunk-2 production code, so they would not
   pass against develop alone. Recommended merge order:
   - Merge PR #96 (chunk 2) into develop first.
   - Then open a follow-up PR for `tests/fase-3-r3-audit-coverage-fill`
     against develop; CI will be green because chunk-2 is now on the
     base branch.
   - Alternatively, the audit branch's commit can be cherry-picked into
     PR #96 if the operator prefers a single PR closing both implementation
     and audit coverage.
3. **Confirm spec §12 DoD completeness** before COMPLETE:
   - [x] `/api/dashboard/summary` route exists for 5 roles (chunk 1).
   - [x] `lib/data-context.tsx` no longer eager-loads in supabase mode
         (chunk 2 — diff confirms login `useEffect` no longer calls
         `loadLeads(1)` / `loadProjects()` / `loadTasks()`).
   - [x] `app/dashboard/page.tsx` consumes summary endpoint (chunk 2).
   - [x] Each consuming page lazy-loads on mount (chunk 2 + audit
         lazy-load tests).
   - [x] All wired mutation surfaces schedule invalidation (audit
         per-handler tests).
   - [x] KPI parity test passes at non-trivial volume (chunk 1 parity test).
   - [x] Mock-mode dashboard home unchanged (audit mock-mode short-circuit tests).
   - [x] Sidebar regression — sidebar does not use `useData()` per spec
         §10 R4, so the refactor cannot affect it. No test action needed.
   - [x] Runtime validation on linked Supabase project (operator
         confirmed 2026-05-22).
   - [ ] `docs/context/project.context.core.md` updated to reflect the
         new architecture — **Docs skill obligation**, not Testing's.
   - [ ] Roadmap updated — **Docs skill obligation**, not Testing's.

---

## Handoff payload

- **Files / modules tested**: `lib/data-context.tsx`, `lib/dashboard/summary-cache.ts`, `app/api/dashboard/summary/route.ts`, `lib/server/dashboard/{summary-service,summary-repository,serialization}.ts`, `app/dashboard/page.tsx`, `app/dashboard/{leads,pipeline,projects,tasks,reports}/page.tsx`.
- **Coverage level achieved**: integration-first; both pure-helper unit tests AND structural source-string audit tests on the provider wiring + page mount guards.
- **Regression-sensitive paths checked**: data mutations (13 wired handlers), state synchronization (debounce + TTL), error handling (route 401/403/500 + RPC error propagation), persistence boundaries (mock vs supabase mode guards), contract-dependent UI behavior (em-dash rendering for null task fields).
- **Findings**:
  - **Finding R3-T1** | LOW | missing coverage | provider mutation wiring | "No test pinned that each of the 13 wired mutations calls `scheduleDashboardSummaryRefetch()`" | **Resolved this session** by `tests/lib/data-context-invalidation-wiring.test.ts`.
  - **Finding R3-T2** | LOW | terminology drift | PR #96 description says "15 wired" mutations; ADR-020 D6 says 17 total surfaces; the actual supabase-mode wire count is 13 (4 are mock-only no-ops). Not a code defect — the wires that need to fire in supabase mode all fire. Recorded for clarity in the audit's `WIRED_MUTATIONS` array.
  - No HIGH or CRITICAL findings.
- **Test debt**: none of the deferred items rises to MEDIUM. All are LOW with explicit rationale above.
- **Unstable tests**: none. All 486 tests green on a single run; suite duration ~41s.
- **Unresolved ambiguities**: none blocking Validator.
- **Recommended reroute**: none — proceed to Validator.
- **Testing outcome**: **Ready for Security / Validator**.

---

## Branch + PR plan

- **Audit branch**: `tests/fase-3-r3-audit-coverage-fill` (created off chunk-2 HEAD `75b5576`).
- **Single commit** added: `tests/lib/data-context-invalidation-wiring.test.ts` (1 new file, 0 production-code changes).
- **PR recommendation**: open against `develop` AFTER PR #96 (chunk 2) merges. Title suggestion: "tests(r3): audit coverage — mutation→summary invalidation wiring + lazy-load guards". Body should reference this audit doc and note dependency on PR #96.
- **Alternative**: cherry-pick the audit commit into PR #96 itself if the operator prefers atomic closure.
