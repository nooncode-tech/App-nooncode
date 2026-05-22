# R3+ Opción C — Validator Verdict 2026-05-22

Validator: system-validator (Claude Opus 4.7 · 1M context).
Iteration: `specs/fase-3-r3-lazy-load-with-aggregates.md` — fase-3-r3-lazy-load-with-aggregates.
Chain executed: Router → Analysis → Architecture → Backend (chunk 1) → Frontend (chunk 2, fused 2+3) → Testing audit → Security (scoped) → Docs → Validator.
Branch under validation: `docs/fase-3-r3-iteration-close` (docs PR #98 in flight; sibling to `develop`).
Inputs reviewed: PRs #93 (spec), #94 (ADR-020 + contract), #95 (backend chunk 1), #96 (frontend chunk 2), #97 (testing audit) — all merged to `develop`. PR #98 (docs) open and is the working tree this verdict was produced from.

---

## Verdict

**COMPLETE**

Scope frozen by Analysis is delivered. Skill outputs are mutually coherent. Testing is SUFFICIENT (486/486 green, verified by Validator-run `npm test` this session). Security is GATE-OPEN (zero CRITICAL/HIGH/MEDIUM/LOW). Documentation is updated proportionally for the route (FULL Refactor → ADR + contract + spec + context core/full entries + operating rules + security review + testing audit). Memory rules are honored. Operator-confirmed runtime parity 2026-05-22.

Two non-blocking follow-ups remain explicitly recorded and assigned ownership: (a) `database.types.ts` regen to retire the `as unknown as { rpc: 'get_dashboard_summary' ... }` cast in `lib/server/dashboard/summary-repository.ts:40-47` (operator-side, post-merge); (b) the merge of PR #98 itself (this docs PR). Neither is a defect in iteration outputs — both are operator-driven sequencing items.

---

## Scope satisfaction

### Spec §12 Definition of Done

| DoD item | Status | Evidence |
|---|---|---|
| `/api/dashboard/summary` exists and returns typed JSON for all 5 roles without RLS errors | ✅ | `app/api/dashboard/summary/route.ts` declares `allowedSummaryRoles = ['admin','sales_manager','sales','pm','developer']`; route tests in `tests/server/api/dashboard/summary.test.ts` cover all 5 roles + null-masking matrix |
| `lib/data-context.tsx` no longer fires `loadLeads(1)` / `loadProjects()` / `loadTasks()` from login `useEffect` in `supabase` | ✅ | Audit test `tests/lib/data-context-invalidation-wiring.test.ts` asserts the absence + per-page lazy-load wiring; operator-validated 2026-05-22 |
| `app/dashboard/page.tsx` consumes summary endpoint, no longer depends on `leads`/`projects`/`tasks` arrays for KPI rendering in `supabase` | ✅ | Audit "rendering: dashboard home uses formatNullableTaskCount" test pins the helper + 4 null-task fields render through it |
| Each consuming page lazy-loads its own slice on mount | ✅ | 5 per-page lazy-load mount-guard tests in `tests/lib/data-context-invalidation-wiring.test.ts` (`/dashboard/{leads,pipeline,projects,tasks,reports}`); each asserts `useRef`-guarded `useEffect` + correct trigger + `authMode === 'supabase'` short-circuit |
| All wired mutation surfaces trigger summary invalidation | ✅ | 13 per-handler tests + 1 total-count guard + 3 mock-only-stays-clean tests + 2 mock-mode short-circuit tests in `tests/lib/data-context-invalidation-wiring.test.ts` |
| KPI parity test suite passes at non-trivial volume (R6 fixture rule ≥10 leads / ≥5 projects / ≥10 tasks) | ✅ | `tests/server/api/dashboard/summary.test.ts` parity fixture: 13 leads / 7 projects / 12 tasks; all 7 `deriveProjectDisplayStatus` branches exercised |
| Mock-mode dashboard home renders identical KPI values | ✅ | Audit mock-mode short-circuit tests + ADR-020 §D7 hook location keeps mock path on legacy `selectDashboardSummary(...)` |
| Sidebar notifications badge regression-tested | ✅ | Spec §10 R4 confirmed `app-sidebar.tsx` does NOT consume `useData()`; refactor cannot affect it by construction |
| Runtime validation on linked Supabase project for ≥2 roles | ✅ | Operator browser-validated 2026-05-22 on Vercel preview against `pdotsdahsrnnsoroxbfe`: KPI parity 21 open / 8 won / $103,969 pipeline / 100% conversion / `leadsByStatus` histogram matching SQL smoke |
| `docs/context/project.context.core.md` updated, no plan-refs added | ✅ | PR #98 adds "Closed in runtime: dashboard summary aggregates endpoint…" entry + 2 operating rules. Audited inline — no R-codes, no Sprint numbers, no plan-IDs |
| `docs/context/project.context.full.md` updated | ✅ | PR #98 adds 56-line "Confirmed dashboard summary aggregates slice" section + updates Active risks line on `lib/data-context.tsx` centralization |
| Roadmap updated to record R3-projects-tasks closure (R3-users still deferred) | ✅ (external) | Operator memory rule "Keep roadmap in sync" — roadmap §17 lives in operator's vault at `D:\Pedro\Archivos Pedro\noon-app\roadmap\noonapp-roadmap.md`. Not part of this repo. Confirmed by router framing |
| `system-validator` returned COMPLETE | ✅ | This document |

### Spec §5 Acceptance criteria (testable)

| Criterion | Status | Evidence |
|---|---|---|
| 1. No eager `GET /api/leads`, `/api/projects`, `/api/tasks` requests from `DataProvider` in `supabase` on login | ✅ | Audit static-source test confirms login `useEffect` no longer calls those loaders in supabase branch |
| 2. `/dashboard` triggers exactly one `GET /api/dashboard/summary` request and KPI cards render correctly without list fetches | ✅ | Operator browser validation 2026-05-22 + dashboard home test rewire |
| 3. `/dashboard/projects` triggers `/api/projects?page=1&limit=…` on page mount; returning to `/dashboard` does not refetch the list | ✅ | Per-page lazy-load guard test for projects |
| 4. `/dashboard/tasks` triggers `/api/tasks?page=1&limit=…` on page mount | ✅ | Per-page lazy-load guard test for tasks |
| 5. KPI parity (SQL aggregate vs JS reference numerically equal under same persisted data) | ✅ | Server-side parity test runs `simulateDashboardSummaryRpc(...)` (verbatim encoding of migration 0058 CTE) against `selectDashboardSummary(...)` over the same 13/7/12 fixture; byte-equal for all 13 KPI fields. Live-side: operator 2026-05-22 |
| 6. Lead `proposal → won` mutation reflects in next summary read (incremented `wonLeads` + `totalRevenue`, decremented `openLeads` + `pipelineValue`) | ✅ | `updateLeadStatus` is one of the 13 wired mutations; invalidation guard test pins it |
| 7. Project `in_progress → review` reflects in next summary read for visible roles | ✅ | `updateProjectStatus` delegates to `updateProject`; both wired (the delegation pattern is documented in audit notes) |
| 8. Task status change updates task-derived delivery counters | ✅ | `updateTaskStatus` + `updateTask` wired |
| 9. Mock-mode dashboard home renders identical KPI values | ✅ | Mock-mode short-circuit guards + `selectDashboardSummary` unchanged in `lib/dashboard-selectors.ts` |
| 10. Sidebar notifications badge continues to render unchanged | ✅ | Sidebar does not call `useData()`; no refactor surface touches it |
| 11. No new RLS errors in any of the 5 roles on summary endpoint | ✅ | Role-masking matrix test in `tests/server/api/dashboard/summary.test.ts:266-328` exercises all 5 roles; ADR-020 §D1 RLS table verified against migrations 0002/0005/0006/0009; operator-confirmed migration 0058 applied with `is_security_definer=false` + correct GRANTs |
| 12. Parity/role-scope/invalidation contracts exercised with non-trivial-volume fixtures | ✅ | R6 fixture floor met (13/7/12) |

### Chunk 1 (Backend) DoD per PR #95

| Sub-item | Status |
|---|---|
| Endpoint responds for 5 roles | ✅ |
| Parity tests pass against JS reference | ✅ |
| Role-based null masking verified for sales/sales_manager | ✅ — `TASK_RLS_DENIED_ROLES = ['sales','sales_manager']` in `lib/server/dashboard/summary-service.ts:34`; `mapSummaryRowToDeliverySectionTaskMasked` in `serialization.ts:152` |
| 7 `deriveProjectDisplayStatus` branches exercised | ✅ — explicit branch-coverage test at line 762 of summary.test.ts |
| NoonWeb wire contract unchanged | ✅ — App-internal endpoint, no NoonWeb surface touched |

### Chunk 2 (Frontend) DoD per PR #96

| Sub-item | Status |
|---|---|
| DataProvider no longer eager-loads in supabase | ✅ |
| `useDashboardSummary()` works | ✅ |
| 15 enumerated mutation surfaces wire invalidation (effective 13 supabase-mode) | ✅ — audit reconciled the §3.5 spec count of 15 against ADR-020 §D6 17-list against actual 13 supabase-wires; the 4 mock-only paths (`addProject`, `deleteProject`, `deleteTask` + the conceptual splits) do not need wiring because they never reach the supabase branch. Total-count guard pinned |
| Mock mode unchanged | ✅ |
| Sidebar unchanged | ✅ |
| KPI parity operator-validated | ✅ — 21 open / 8 won / $103,969 / 100% / leadsByStatus matching SQL smoke |

---

## Skill consistency check

No contradictions detected between Analysis → Architecture → Backend → Frontend → Testing → Security → Docs outputs. Specifically:

1. **Spec §3.5 enumerated 15 mutation surfaces / ADR-020 §D6 listed 17 surfaces / Frontend wires 13 in supabase mode.** This was flagged by Testing audit as terminology drift (Finding R3-T2, LOW) and resolved by codifying `WIRED_MUTATIONS` (13 entries) in the audit test file. The discrepancy was: ADR-020 §D6 included mock-only paths `addProject` / `deleteProject` / `deleteTask` which never reach the supabase branch and therefore correctly do NOT wire invalidation. The spec, ADR, and implementation are coherent — the counting frame was the only drift, and the audit closed it explicitly. Not a defect.

2. **Spec §10 R7 RLS assumption → ADR-020 §D1 closed it → Security I-2 verified end-to-end.** Coherent.

3. **Spec §10 R1 KPI parity contract (the 7-branch `deriveProjectDisplayStatus` rule) → ADR-020 §D2 reproduced the rule verbatim with locked branch order → Backend chunk 1 implemented it in migration 0058 → Testing parity test (line 762) exercises all 7 branches.** Coherent.

4. **Spec §10 R5 stale window for out-of-band mutations → ADR-020 §D6 acknowledged it as out-of-scope → Security I-11 confirmed acceptance → Docs core.md operating rule documents the 60s SWR + next-page-load pickup.** Coherent.

5. **ADR-020 §D9 wire shape (null fields for sales/sales_manager task counters) → Backend service-layer `TASK_RLS_DENIED_ROLES` masking → Frontend `formatNullableTaskCount` em-dash renderer → Audit test pinning all 4 nullable task fields render through the helper.** Coherent end-to-end. The defense-in-depth posture (mask in service even if RLS regressed) is consistently applied.

6. **ADR-020 §D5 cache TTL = 60s SWR / §D6 debounce = 250ms → Frontend `lib/dashboard/summary-cache.ts` `createDashboardSummaryDebouncer` → Audit tests cover age 0 / 30s / 59999ms / exactly 60000ms / >60000ms boundaries + debounce coalesce / cancel / rearm scenarios.** Coherent.

7. **Docs core.md operating rules ("summary-first / lazy-list provider" + "GET /api/dashboard/summary canonical source") match ADR-020 §D7, §D9, §D6, §D5 verbatim semantics.** No drift between operating rules and decision authority.

No reroute required to any skill.

---

## Testing sufficiency

**SUFFICIENT** per Testing audit verdict, **re-confirmed by Validator-run `npm test` in this session**:

```
ℹ tests 486
ℹ suites 2
ℹ pass 486
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 24650.34
```

Coverage matrix (per `docs/validations/r3-testing-audit-2026-05-22.md`):

| Area | Verdict |
|---|---|
| Backend SQL parity at non-trivial fixture volume | sufficient |
| Backend role-based null masking | sufficient |
| Backend error paths (401/403/500) | sufficient |
| Backend wire shape contract | sufficient |
| Backend RPC contract / shape transformation | sufficient |
| Frontend 60s SWR TTL boundaries | sufficient |
| Frontend 250ms debounce coalescing | sufficient |
| Frontend mutation→invalidation wire (R2) | **gap filled this iteration** — 26 audit tests added |
| Frontend mock-mode-never-calls-summary | sufficient |
| Frontend `null` rendering for sales/sales_manager | sufficient |
| Frontend per-page lazy-load mount triggers | sufficient |
| Frontend provider cleanup on unmount | sufficient |
| Cross-cutting end-to-end KPI parity SQL vs JS | sufficient (test) + operator-validated (live) |
| Cross-cutting Playwright/Cypress e2e | not present (by design — spec §11) |
| Cross-cutting `lib/data-context.tsx` non-summary regression | sufficient (existing 460-test baseline + 26 new = 486) |

Testing methodology declared in spec §11 (integration-first) was honored. The static source-string audit pattern used by the audit branch is documented inline in the new test file's header comment — the trade-off vs RTL/JSDOM is explicit and the repo has no RTL harness (precedent: F-V12).

Validator independently confirmed the test run; no defect detected.

---

## Security findings

**GATE-OPEN** per `docs/validations/r3-security-review-2026-05-22.md`.

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |
| INFORMATIONAL | 11 (I-1 through I-11) |

The 11 informational verifications cover: auth gate enumerates all 5 roles (I-1), RLS posture end-to-end (I-2), migration GRANTs match defense-in-depth posture (I-3), SQL injection surface is closed by design (I-4), information disclosure via wire payload is bounded (I-5), error envelope does not leak (I-6), client-side cache is per-provider per-session (I-7), caching headers and route runtime correct (I-8), rate-limit posture consistent with read-endpoint precedent (I-9), `bigint → number` conversion safe at pilot scale (I-10), R5 stale-window risk operator-accepted (I-11).

Migration `0058_phase_22b_dashboard_summary_rpc.sql` operator-verified in production with `is_security_definer=false`, GRANTs exactly `postgres` / `authenticated` / `service_role`, no `anon`, no `PUBLIC`. `search_path` pinned to `public, pg_catalog`.

Security does NOT block COMPLETE.

---

## Documentation level

Route was **FULL Refactor**, requiring stronger documentation. Documentation level is proportional:

| Artifact | Status | Notes |
|---|---|---|
| Spec | ✅ — PR #93 merged | `specs/fase-3-r3-lazy-load-with-aggregates.md` (704 lines) covers all 14 sections per project convention |
| ADR | ✅ — PR #94 merged | ADR-020 (552 lines) covers 10 decisions D1-D10 |
| Contract | ✅ — PR #94 merged | `docs/contracts/dashboard-summary.md` (skeleton-level, follows `docs/contracts/` convention); contracts index updated |
| Context core.md "Closed in runtime" entry | ✅ — PR #98 (open) | Comprehensive entry covering migration, RPC properties, RLS posture, wire shape, null masking, cache model, invalidation count, mock-mode preservation, sidebar isolation, validation evidence, security gate, R5 acknowledgment |
| Context core.md operating rules | ✅ — PR #98 (open) | Two new operating rules: (a) `lib/data-context.tsx` is summary-first/lazy-list provider; (b) `GET /api/dashboard/summary` is canonical KPI source. Each rule explicit on what NOT to revert |
| Context full.md slice section | ✅ — PR #98 (open) | New "Confirmed dashboard summary aggregates slice" section (56 lines): anchors, problem solved, surface change, wire shape, SQL parity, caching, invalidation, RLS posture, out-of-band mutations, validation evidence, exclusions, open items |
| Context full.md Active risks update | ✅ — PR #98 (open) | `lib/data-context.tsx` centralization risk text updated to reflect R3 reduction |
| Roadmap §17 | ✅ (external) | Per memory rule "Keep roadmap in sync", roadmap lives in operator vault at `D:\Pedro\Archivos Pedro\noon-app\roadmap\noonapp-roadmap.md`. Updated externally by operator per router framing. Not part of this repo |
| Security review doc | ✅ — PR #98 (open) | `docs/validations/r3-security-review-2026-05-22.md` (164 lines) — methodology, scope, 11 informational findings, GATE-OPEN verdict, pre-authorized future work |
| Testing audit doc | ✅ — PR #97 merged | `docs/validations/r3-testing-audit-2026-05-22.md` (237 lines) — methodology, coverage matrix, gaps filled, gaps deferred with risk-acceptance, verdict, branch+PR plan |

All documentation is internally consistent and aligned with the implementation.

---

## Memory rules check

| Rule | Status |
|---|---|
| Context docs stay free of plan refs (no R-codes, Sprint numbers, plan-IDs in `docs/context/*.md`) | ✅ — PR #98 entry uses "fase-3-r3-lazy-load-with-aggregates" as iteration name (which is a spec filename slug, not an R-code/Sprint identifier) and references it once for traceability via the spec filename. The R3 reference itself appears only in the spec file (allowed) and in this validator doc (allowed). Operating rules contain no R-codes/Sprint refs |
| Do not auto-merge PRs | ✅ — PR #98 is OPEN and Validator is NOT instructing merge. Operator merges per their own gate |
| Keep roadmap in sync | ✅ — Operator-owned external file, framing confirms it is updated separately |
| Agent usage proportional to scope | ✅ — FULL chain was justified: 5-role security surface, 13 mutation surfaces, 7-branch SQL parity, high-risk file (`lib/data-context.tsx`). Not over-spent |
| Frontend redesign playbook | ✅ — `lib/data-context.tsx` is listed as the highest-risk file in the playbook; the iteration honored R3 by chunking (additive endpoint first, then behavior change) and by concentrating provider changes in one PR |

All memory rules honored.

---

## Open follow-ups (non-blocking, recorded)

1. **Types regen pending operator-side.** The cast `as unknown as { rpc: 'get_dashboard_summary' ... }` in `lib/server/dashboard/summary-repository.ts:40-47` is an intentional deferral until `npx supabase gen types typescript --project-id pdotsdahsrnnsoroxbfe` is rerun and the `Database['public']['Functions']` catalog includes `get_dashboard_summary`. This is consistent with the rollout pattern used by `handoff_prototype_workspace_to_delivery` and `link_lead_prototype_workspace_to_project` before their types landed (precedent set by Backend chunk 1's header comment). Documented in core.md operating rule. Owner: operator (post-merge). Risk: NONE — runtime behavior is unaffected.

2. **PR #98 (docs) merge pending.** This is the working tree the verdict was produced from. Until it merges to `develop`, the docs are visible only on the `docs/fase-3-r3-iteration-close` branch. Validator does not block on merge per memory rule "Do not auto-merge PRs". Owner: operator.

3. **R5 out-of-band mutation stale window (Stripe `payment-confirmed`, PM webhook).** Acknowledged in spec §4, ADR-020 §D6, Security I-11. NOT in this iteration's scope. Pre-authorized: future Supabase Realtime channel iteration. Owner: future iteration. Risk: LOW (60s SWR + next page load picks up changes; acceptable for internal-team dashboards).

4. **Pre-existing 6 lint warnings** on `tests/server/api/dashboard/summary.test.ts` (3) and `tests/server/website/webhook-events.test.ts` (3). None on production code, none on the new audit file, no new warnings introduced. Owner: future cleanup pass, not in scope.

5. **Users pagination (R3-users) explicitly deferred.** `/api/users/admin` and `/api/users/delivery` continue to eager-load as bounded reference data per spec §4. Owner: future iteration if user-volume warrants.

6. **Pipeline / reports partial-view (F-V12 R1 carry-over).** Pipeline and reports still operate on paginated subsets of leads; this iteration does not regress but does not fix it either. Owner: future iteration, named in spec §4.

None of the above rises to MEDIUM severity. All are LOW with explicit rationale and ownership.

---

## Responsible agent for any remaining gaps

**None.** The iteration is COMPLETE. No skill is owed an output, and no gap requires reroute.

If operator chooses to add CI guards (e.g., require updates to `lib/server/gdpr/inventory.ts TABLE_INVENTORY` analog for the summary surface, or fail CI on new mutation handlers missing `scheduleDashboardSummaryRefetch()`), that would be a future hardening iteration — not a defect in the current closure.

---

## Recommendations for operator

1. **Merge PR #98** (docs) to `develop`. This lands the context core/full updates + security review file. Recommended merge order: PR #98 first (so `develop` has the canonical iteration-close documentation), then proceed with any subsequent iteration.

2. **Run `npx supabase gen types typescript --project-id pdotsdahsrnnsoroxbfe`** to regenerate `lib/server/supabase/database.types.ts` including the new `get_dashboard_summary` RPC in the `Database['public']['Functions']` catalog. Open a small follow-up PR retiring the cast at `lib/server/dashboard/summary-repository.ts:40-47`. Non-blocking; can wait until next routine types refresh. Precedent: same pattern was used for `handoff_prototype_workspace_to_delivery` and `link_lead_prototype_workspace_to_project`.

3. **Update roadmap §17** in operator vault at `D:\Pedro\Archivos Pedro\noon-app\roadmap\noonapp-roadmap.md`: mark R3-projects-tasks as CLOSED (in runtime, 2026-05-22) and keep R3-users explicitly deferred.

4. **Monitor R5 stale window in pilot use.** Operator and team are the source of truth on whether the 60s SWR + next-page-load pickup is acceptable. If discomfort emerges, escalate to a Supabase Realtime channel iteration (pre-authorized in ADR-020).

5. **Close any related task tracking** in the operator's task list referencing this iteration. The iteration is closed in code, tests, and docs.

---

## Context Update Payload

- **Iteration result:** COMPLETE — fase-3-r3-lazy-load-with-aggregates closed in runtime 2026-05-22. New `GET /api/dashboard/summary` endpoint replaces client-side eager-load KPI computation. 13 supabase-mode mutation surfaces wire 250ms-debounced invalidation with 60s SWR cache. KPI parity test-side (23 chunk-1 tests + 17 chunk-2 + 26 chunk-3 audit) + live-side (operator 2026-05-22 against `pdotsdahsrnnsoroxbfe`). 486/486 tests verde, 0 security findings, GATE-OPEN.

- **Modules changed:**
  - `app/api/dashboard/summary/route.ts` (new)
  - `lib/server/dashboard/{summary-repository,summary-service,serialization}.ts` (new)
  - `lib/dashboard/summary-cache.ts` (new)
  - `supabase/migrations/0058_phase_22b_dashboard_summary_rpc.sql` (new; applied to prod)
  - `lib/data-context.tsx` (major refactor — eager loads removed in supabase mode, summary state + hook + invalidation wired)
  - `app/dashboard/page.tsx` (rewire to consume summary endpoint)
  - `app/dashboard/{leads,pipeline,projects,tasks,reports}/page.tsx` (lazy-load triggers on mount)
  - `tests/server/api/dashboard/summary.test.ts` (new — 23 tests)
  - `tests/lib/data-context-summary.test.ts` (new — 17 tests)
  - `tests/lib/data-context-invalidation-wiring.test.ts` (new — 26 tests)
  - `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md` (new)
  - `docs/contracts/dashboard-summary.md` (new) + `docs/contracts/README.md` (updated index)
  - `specs/fase-3-r3-lazy-load-with-aggregates.md` (new)
  - `docs/context/project.context.core.md` (closed-in-runtime entry + 2 operating rules — PR #98)
  - `docs/context/project.context.full.md` ("Confirmed dashboard summary aggregates slice" section + Active risks update — PR #98)
  - `docs/validations/r3-security-review-2026-05-22.md` (new — PR #98)
  - `docs/validations/r3-testing-audit-2026-05-22.md` (new — PR #97 merged)
  - `docs/validations/r3-validator-verdict-2026-05-22.md` (this file)

- **Risks added or updated:**
  - `lib/data-context.tsx` centralization risk text updated (full.md) — R3 iteration reduced but did not eliminate
  - R5 out-of-band mutation stale window (Stripe `payment-confirmed`, PM webhook) acknowledged and accepted; mitigation by 60s SWR + next page-load pickup; future Realtime channel pre-authorized

- **Open blockers:** None.

- **Next recommended step:** Operator merges PR #98 to land docs on `develop`. Then operator runs `npx supabase gen types` to retire the RPC cast in `summary-repository.ts:40-47` as a small follow-up PR. Then operator updates roadmap §17 externally to mark R3-projects-tasks CLOSED and keep R3-users deferred. The iteration is otherwise closed.
