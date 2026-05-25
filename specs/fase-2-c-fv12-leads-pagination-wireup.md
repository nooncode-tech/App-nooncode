# spec.md — fase-2-c-fv12-leads-pagination-wireup

## Metadata

- Iteration ID: `fase-2-c-fv12-leads-pagination-wireup`
- Date: 2026-05-20
- Author: Pedro (noondevelop@gmail.com)
- Status: **Draft** (moves to Approved once Validator confirms the listed Definition-of-Done gates)
- Router mode: **Bugfix-class feature wire-up**
- Depth: **LITE**
- Roadmap entry closed by this iteration: `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` §6 — F-V12 (frontend wire-up of the existing offset pagination contract for leads).

---

## 1. Business objective

The `/api/leads` endpoint already implements offset pagination (`?page&limit`) and returns the canonical `{ data, meta }` envelope, with full server-side test coverage at `tests/server/api/leads/list-leads-paginated.test.ts`. The dashboard (`/dashboard/leads`) currently consumes the envelope incorrectly: `lib/data-context.tsx:480-486` calls `readApiResponse<LeadWire[]>` and discards `meta`, so the UI silently shows only the first 100 leads (the server default cap, clamped at `lib/server/pagination/schema.ts:10`) and offers no navigation. F-V12 closes the loop by wiring page navigation through the existing contract so a real Supabase tenant with more than 100 leads can browse all of them.

This iteration also closes the documented frontend-pagination scope that TDR-004 (`docs/tdrs/TDR-004-api-pagination.md` line 141: *"Do NOT modify `lib/data-context.tsx` in this change — frontend pagination is a separate scope"*) intentionally deferred from the original backend rollout.

---

## 2. Scope Boundary

### 2.1 Included (in scope)

- **Client-side pagination state** in `lib/data-context.tsx`:
  - Replace the discarded-envelope `loadLeads` (lines 479-486) with a paginated loader that reads `{ data, meta }` from `/api/leads`, stores `leads`, and also stores `leadsPagination` (page, limit, total, pageCount).
  - Expose new context fields: `leadsPagination` (offset meta from envelope) and `setLeadsPage(page: number)` (page navigator). `refreshLeads()` keeps its current zero-arg signature; new explicit page navigation goes through `setLeadsPage`.
  - Preserve full mock-mode parity: when `authMode !== 'supabase'`, the context still returns `mockLeads` and synthesizes a single-page `leadsPagination` envelope (`page=1, limit=mockLeads.length, total=mockLeads.length, pageCount=1`) so the UI's pagination controls render in mock mode without conditional rendering.
  - Preserve existing mutation paths (`addLead`, `updateLead`, `deleteLead`, `updateLeadStatus`, etc.). These continue to splice the local `leads` array; after a mutation, the pagination meta is left as-is (the next `setLeadsPage` or `refreshLeads` reconciles it).

- **API request shape** in `lib/data-context.tsx` `loadLeads`:
  - Send `?page=<n>&limit=<n>` query params. Default `page=1, limit=50` (analysis-recommended client default; smaller than the server's 100 cap, so navigation is meaningful even on small tenants).
  - Read the envelope as `{ data: LeadWire[]; meta: { page; limit; total; pageCount } }` via a typed helper (new `readPaginatedApiResponse` or inline destructure — backend/frontend handler decides at implementation).

- **Pagination controls** in `app/dashboard/leads/page.tsx`:
  - Render a control strip below the leads list (after the existing `LeadCard` map at lines 514-531) with: previous-page button, next-page button, and a "Page X of Y" label.
  - Disable previous on page 1; disable next on `page >= pageCount` (or `total === 0`).
  - Hide controls entirely when `pageCount <= 1` (single-page tenant — no clutter).
  - Show a small "Loading next page..." indicator (spinner inline with the controls) while a page change is in flight. Re-uses the existing `Spinner` from `components/ui/spinner.tsx`.

- **Filter interaction** (client-side filters operate on the CURRENT page only):
  - The existing `selectLeadList(leads, { searchQuery, statusFilter, sortBy, proximityFilter })` (used at `app/dashboard/leads/page.tsx:292-300`) continues to operate over the in-memory `leads` array, which is now the current page's slice (≤50 by default).
  - This is a **known limitation** documented in §6 Risks (R1). Search/filter no longer cross page boundaries by default. Mitigation: the client default `limit=50` is small enough that operators can paginate quickly; if a tenant grows beyond a few pages, the follow-up iteration adds server-side search/filter parameters.

- **Tests** (per §8 methodology):
  - **Integration test (Node test runner, same harness as `tests/server/api/leads/list-leads-paginated.test.ts`):** at least one new test covering the API + client envelope contract — i.e., a test that feeds the `loadLeads`-equivalent code path with a stubbed `fetch` returning the envelope shape, asserts `leads` and `leadsPagination` state update correctly across (a) first page (`page=1`, `total > limit`), (b) last page (`page === pageCount`, `data.length <= limit`), (c) empty result (`total=0`).
  - **Server regression test:** the existing `tests/server/api/leads/list-leads-paginated.test.ts` (5 cases) must continue to pass without modification.
  - No DOM/RTL test required for the pagination control itself (no React Testing Library precedent in the repo for `app/dashboard/leads/page.tsx`); the contract test above is sufficient evidence for Validator. If frontend implementation prefers a component-level test, it must use the existing Node-test harness (no new dev-dep additions in LITE mode).

- **Documentation updates** (per CLAUDE.md completion policy):
  - `docs/context/project.context.core.md` — Operating rules entry reflecting that the leads list is now paginated client-side. No B-codes / R-codes / Sprint IDs / plan-IDs (per MEMORY rule on context docs).
  - Roadmap `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` §6 — F-V12 entry marked closed (per MEMORY rule on roadmap sync).
  - `docs/tdrs/TDR-004-api-pagination.md` — single-line update to the "Anti-patterns" block (line 141) noting that the `lib/data-context.tsx` deferral is now closed by F-V12. Optional; architecture/docs skill decides at close-out.

### 2.2 Excluded (explicitly out of scope)

- **No pagination contract change.** `offsetPaginationSchema`, `buildOffsetResponse`, `OffsetResponse<T>`, `OffsetMeta`, and the envelope shape are untouched. Verified at `lib/server/pagination/schema.ts:3-6` and `lib/server/pagination/envelope.ts:4-9, 26-36`.
- **No cursor-pagination introduction for leads.** Leads are an offset-paginated entity per TDR-004 §Decision; this iteration does not migrate that.
- **No new RPC, no new migration, no `database.types.ts` change.** The four manual override blocks (seller_fees, prototype_workspaces, lead_proposals, website_webhook_events) carry over unchanged.
- **No leads schema change, no new column.** Server `listLeads` (`lib/server/leads/repository.ts:45-66`) is unmodified.
- **No auth change.** `allowedLeadRoles = ['admin', 'sales_manager', 'sales']` (`app/api/leads/route.ts:14`) unchanged.
- **No server-side search / filter / sort parameters.** The existing in-memory `selectLeadList` continues to operate on the current page only. Server-side filtering is a documented follow-up.
- **No infinite-scroll / load-more pattern.** Offset pagination + numbered page controls. (Rationale: TDR-004 §Tradeoffs explicitly selects offset for leads because the dashboard renders a tabular view where `total` and `pageCount` are user-facing.)
- **No URL state for `page`.** The dashboard already uses `useSearchParams` for `leadId` deep-linking; adding `?page=` is **deferred**. Page state lives in the data context, resets on navigation. (Rationale: keeps the spec LITE; URL-state can land as a small follow-up if requested.)
- **No Maxwell-search-result pagination.** Maxwell results (`runMaxwellSearch` at lines 193-238) are a separate code path with no pagination contract today. Unchanged.
- **No projects / tasks / users pagination wire-up.** Each has its own future spec (the projects and tasks API routes already use the envelope; their data-context loaders have the same latent issue — see §6 R3).
- **No NoonWeb-side change.** F-V12 is App-only. The wire contract `/api/leads` is internal to App; NoonWeb does not consume it.
- **No bulk operations across pages.** Existing bulk operations (none on leads today) are out of scope.
- **No chunking.** Single PR.

---

## 3. Affected Files / Modules

### 3.1 Modified

| File | Lines (approximate) | Change |
|---|---|---|
| `lib/data-context.tsx` | 60-128 (`DataContextType` interface) | Add `leadsPagination: OffsetMeta \| null` and `setLeadsPage: (page: number) => Promise<void>` to the context type. |
| `lib/data-context.tsx` | 426-477 (provider state) | Add `leadsPagination` state. Initialize to a single-page meta in mock mode; null in supabase mode until first load. |
| `lib/data-context.tsx` | 479-495 (`loadLeads`, `refreshLeads`) | `loadLeads` accepts `page` parameter (default 1) and `limit` parameter (default 50). Reads `{ data, meta }` envelope. Updates both `leads` and `leadsPagination`. |
| `lib/data-context.tsx` | 559-676 (auth-mode effect) | Mock mode populates `leadsPagination` from `mockLeads.length`. Supabase mode kicks off `loadLeads(1)`. |
| `lib/data-context.tsx` | 1827-1880 (provider value object) | Expose `leadsPagination` and `setLeadsPage` in the context value. |
| `app/dashboard/leads/page.tsx` | 89-91 (`useData` destructure) | Pull `leadsPagination`, `setLeadsPage` from `useData()`. |
| `app/dashboard/leads/page.tsx` | 494-532 (lead list block) | After the list, render `<LeadsPaginationControls>` (or inline JSX, frontend skill decides) bound to `leadsPagination` + `setLeadsPage`. |

### 3.2 New (conditional on frontend skill's preference)

- `components/leads-pagination-controls.tsx` — small dedicated component for the prev/next/page-of-Y control strip. **Optional**; the controls can also be rendered inline in `app/dashboard/leads/page.tsx`. Frontend skill decides at implementation; either is acceptable for Validator.
- `tests/lib/data-context-leads-pagination.test.ts` (or similar path) — the integration test for the loader's envelope handling and page navigation. Path is illustrative; whatever path the testing skill picks must follow the existing `tests/server/...` or `tests/lib/...` convention.

### 3.3 Exercised but NOT modified

- `app/api/leads/route.ts` — handler factory at lines 27-53, default export at line 59. Untouched. The server already returns the envelope.
- `lib/server/pagination/schema.ts`, `cursor.ts`, `envelope.ts` — entire module untouched.
- `lib/server/leads/repository.ts` `listLeads` (lines 45-66) — untouched.
- `lib/leads/serialization.ts` `LeadWire`, `deserializeLead` — untouched. Each lead in the envelope's `data` array is still a `LeadWire`.
- `lib/dashboard-selectors.ts` `selectLeadList`, `selectLeadsSummary` — untouched. They operate on whatever `leads` array the context provides; they don't care that the array is now a page slice.
- `components/lead-card.tsx` — untouched. Renders a single lead independent of pagination.
- `tests/server/api/leads/list-leads-paginated.test.ts` (5 cases) — untouched. Must continue to pass.
- `lib/server/supabase/database.types.ts` — untouched. Four manual override blocks preserved.

### 3.4 External systems touched

- **None.** No Supabase migration, no PostgREST function, no env var, no Vercel build/runtime configuration change. The change is purely in TypeScript/TSX inside the App repo.

---

## 4. Dependencies

| # | Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|---|
| D1 | `offsetPaginationSchema` clamps `limit` ≤100 at `lib/server/pagination/schema.ts:5` | contract | Verified, in production, with test at `tests/server/api/leads/list-leads-paginated.test.ts:73-82` | Client could request arbitrary `limit` and exhaust DB. Mitigation already in place server-side. | Pre-existing, no action |
| D2 | `buildOffsetResponse` always returns `{ data, meta }` shape | contract | Verified at `lib/server/pagination/envelope.ts:26-36` and asserted across all paginated route tests | Client envelope destructure breaks at runtime if shape ever changes. | Pre-existing, no action |
| D3 | `listLeads` orders by `created_at DESC` (`lib/server/leads/repository.ts:55`) | data | Stable, has been in production since B-leads-rls | Pages would not be deterministic if order changed mid-pagination. | Pre-existing, no action |
| D4 | `readApiResponse<T>` (`lib/data-context.tsx:328-344`) silently unwraps `{ data }` and discards `meta` | internal | Verified by reading the helper; this is the root cause of the current bug | The wire-up must NOT use `readApiResponse<LeadWire[]>` for leads anymore — it must read the full envelope. | Frontend skill; one-line refactor or sibling helper |
| D5 | Mock-mode `authMode !== 'supabase'` branch in DataProvider's effect (`lib/data-context.tsx:562-585`) | internal | Verified | If mock-mode population is skipped, the demo flow breaks. Mitigation: spec mandates synthetic single-page meta in mock mode. | Frontend skill |
| D6 | `useSearchParams` + `useRouter` already imported in `app/dashboard/leads/page.tsx` (line 4) | internal | Verified | If URL-state for page is added in scope (it is not in this iteration), this would matter. Currently irrelevant. | N/A |
| D7 | `Spinner` from `components/ui/spinner.tsx` available | internal | Verified (imported at `app/dashboard/leads/page.tsx:51`) | Pagination "loading next page" indicator would need a different visual. | Pre-existing, no action |
| D8 | Node test runner harness (`node:test`, `node:assert/strict`) used across `tests/server/**` and `tests/lib/**` | infra | Verified by precedent (`tests/server/api/leads/list-leads-paginated.test.ts:1-2`) | Adding a new test in the existing harness adds zero dev-deps. | Testing skill |

---

## 5. Assumptions

- A1: The Supabase tenant `pdotsdahsrnnsoroxbfe` may contain more than 100 leads (the server cap). Verifying this is not required for the iteration to close — the contract holds regardless — but the production smoke benefits from a tenant with at least `2 * limit + 1` leads to exercise multi-page navigation. If the production tenant has fewer leads, the smoke uses the empty/single-page boundary only.
- A2: `LeadWire` shape is unchanged. The envelope's `data` array elements are deserialized via the existing `deserializeLead` (`lib/leads/serialization.ts`).
- A3: The `selectLeadList` selector (`lib/dashboard-selectors.ts`) operates correctly on a page-sliced `leads` array. Its in-memory filters (search, status, sort, proximity) produce semantically correct results within the current page; cross-page filtering is a documented limitation (§6 R1), not a bug.
- A4: The dashboard's existing `leadId` deep-link recovery (`app/dashboard/leads/page.tsx:145-164`) continues to function with a paginated `leads` array. If a deep-linked lead is on a different page than the current one, the existing code path will set `selectedLead` to null and `replaceLeadHref(null)`. This is a known limitation (§6 R2); cross-page deep-link recovery is a follow-up.
- A5: Mock data (`mockLeads`) has fewer than 100 entries (verified by inspection in past sessions; if false, the mock-mode synthesis adapts trivially). Mock mode synthesizes a single-page envelope.
- A6: No other consumer of `/api/leads` GET exists in App. Verified by grepping `fetch('/api/leads'` — the only call site is `lib/data-context.tsx:480`. No external repo (NoonWeb) consumes this endpoint.
- A7: The server's default `limit=100` (when client omits the param) remains compatible with the new client behavior: the new client always sends `?limit=50&page=N`, so the server default is effectively unused going forward. If the client omits params (e.g., legacy code path), the server still responds correctly with `limit=100`.

---

## 6. Risks

| # | Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R1 | **Filter scope regression** — search/status/sort/proximity filters now operate on the current page only, not the full dataset. A user searching for a lead on page 3 from page 1 finds nothing. | High (this is the core UX trade-off of offset pagination without server-side filters) | Medium (user confusion; perceived as a bug) | Medium | Documented in §2.2 (Excluded) and surfaced in the close-out notes. Follow-up iteration adds server-side `?search=` / `?status=` / `?sort=` params. **Mitigation in this iteration:** smaller client `limit=50` so multi-page browsing is fast; the "Page X of Y" label makes paging obvious. |
| R2 | **Deep-link `leadId` recovery breaks for off-page leads** — `/dashboard/leads?leadId=abc` where `abc` is on page 2 lands the user on page 1, sees no match, clears the URL. | Medium (depends on lead distribution and how deep-links are used) | Low-Medium | Medium | Documented in §2.2 (Excluded) and §5 A4. Follow-up iteration could fetch-by-id for off-page deep-links. **Mitigation in this iteration:** none beyond docs. Validator should note this limitation in the close-out. |
| R3 | **Latent same-class bug for projects and tasks** — `lib/data-context.tsx` `loadProjects` (lines 501-510) and `loadTasks` (lines 512-521) discard `meta` the same way `loadLeads` does. Projects and tasks routes also return the envelope. These are NOT in scope for F-V12, but a future page-size growth on those entities will surface the same UX regression. | High (latent; not fired yet) | Medium (when fired) | Low (deferred) | **Out of scope for F-V12.** Documented here for future iteration spec. Roadmap §6 may track this as a follow-up. |
| R4 | **Mutation-meta drift** — after `addLead` (line 1183) the local `leads` array grows, but `leadsPagination.total` does not. Same for `deleteLead`. UI displays stale "Page 1 of 3 (45 leads)" even though `leads.length` differs. | Medium (will happen on every mutation) | Low (cosmetic; one-page-load away from accurate) | Low | **Mitigation in scope:** after mutations that change cardinality (`addLead`, `deleteLead`), the context calls `refreshLeads()` for the current page, OR increments/decrements `leadsPagination.total` and recomputes `pageCount`. Frontend skill picks the simpler of the two; recommended: `total++` / `total--` + `pageCount = Math.ceil(total/limit)` (no network round-trip). |
| R5 | **Concurrent insert at page boundary** — TDR-004 §Tradeoffs already documents this: with offset pagination, a row inserted at the head between page-1 and page-2 loads can cause duplicate rows or skipped rows. | Low (single operator at a time on the dashboard) | Low (duplicate or missing row in view; resolved by refresh) | Low | TDR-004 already accepted this. No new mitigation. |
| R6 | **`limit=50` client default differs from server default `100`** — slightly less efficient (more round-trips for the same total), but improves UX (smaller pages, faster navigation). | Low | Low (small perf delta) | Low | Acceptable trade-off. The server cap (100) remains the absolute ceiling. If perf is ever an issue, raise the client default in a one-line change. |
| R7 | **Forgeable cursor / unclamped limit** (router §6 re-route trigger) — **does not apply.** This iteration does not use cursor pagination, and `limit` is server-clamped at `≤100` (verified at `lib/server/pagination/schema.ts:5`). | N/A | N/A | N/A | N/A — confirms router's LITE decision holds. |
| R8 | **RLS gap** (router §6 re-route trigger) — leads RLS is unchanged (no auth/role/policy work in scope). The `listLeads` Supabase query goes through the user-scoped server client (`createSupabaseServerClient`); RLS continues to enforce per-role visibility. | Low | High (if hypothetically broken) | N/A | Confirms LITE decision. Router's "security mandatory" trigger does not fire because no auth surface changes. |

---

## 7. Open Questions (with default answers)

These do not block analysis; defaults are documented so frontend/backend can proceed without round-tripping.

### Q1 — Client default `limit`?

**Default answer: `limit=50`.**

Rationale: server caps at 100. Smaller pages improve navigation responsiveness and make the filter-scope-per-page regression (R1) less painful. If the user reports perf concerns, raise to 100 in a one-line change.

Alternatives: 25 (more clicks, more API calls), 100 (matches server, but fewer pages = less obvious that pagination exists).

Frontend skill may pick a different default at implementation time; document the choice in the close-out.

### Q2 — Inline controls or dedicated component?

**Default answer: inline JSX in `app/dashboard/leads/page.tsx`.**

Rationale: LITE depth; the controls are ~20 lines of JSX bound to `leadsPagination` + `setLeadsPage`. A dedicated `components/leads-pagination-controls.tsx` becomes reusable when projects/tasks/users adopt the same pattern (R3 follow-up), but YAGNI for this iteration.

Frontend skill may extract to a component if it cleans up the file; either is acceptable.

### Q3 — Should `setLeadsPage` debounce / guard against concurrent in-flight requests?

**Default answer: yes, guard but do not debounce.**

Rationale: clicking "next" twice quickly should not fire two overlapping `loadLeads(2)` and `loadLeads(3)` requests in a race. Use a simple `isLeadsLoading` check (already in the context, line 429): if `isLeadsLoading`, ignore the click. Debouncing adds latency without clear benefit since the buttons are pointer-driven, not text-input-driven.

Implementation: `if (isLeadsLoading) return;` at the top of `setLeadsPage`.

### Q4 — Should the URL reflect `?page=N`?

**Default answer: no, deferred.**

Rationale: §2.2 already excludes URL-state. The deep-link recovery for `leadId` (line 109) is a separate concern. Adding `?page=` is a follow-up that costs ~30 lines and benefits a narrow use case (shareable paginated views). Defer.

### Q5 — How to handle `total === 0` (empty tenant)?

**Default answer:** Pagination controls are hidden when `pageCount <= 1` (covers `total=0`, `total=1..limit`, all single-page cases). The existing empty-state Card at `app/dashboard/leads/page.tsx:503-513` already renders the "No se encontraron leads" state and is unaffected.

### Q6 — Mutation-induced cardinality change handling (R4)?

**Default answer:** Optimistic local update: `addLead` does `leadsPagination.total + 1`; `deleteLead` does `leadsPagination.total - 1`; both recompute `pageCount = Math.ceil(total/limit)`. No extra network call. If the page becomes empty after a delete (e.g., deleting the last lead on page 3 of 3), call `setLeadsPage(Math.max(1, page - 1))` to navigate back.

Frontend skill may simplify to "just call `refreshLeads()` after mutations" if the optimistic logic gets messy. Document choice at implementation.

---

## 8. Recommended testing methodology

**Integration-first.**

Justification (per `system-testing` selection rules):

- This is a **wire-up against an existing tested contract**. The contract (server side) is already covered by `tests/server/api/leads/list-leads-paginated.test.ts` (5 cases). New tests must focus on the client-envelope-handling and page-navigation behavior — i.e., integration-shaped behavior at the data-context boundary.
- **TDD-strict not required.** No new business logic emerges; the iteration is mechanical glue between an already-tested API and an already-rendered UI.
- **BDD inappropriate.** No new behavioral scenario at a product-language level; the feature is "leads list is paginated," which is a contract closure, not a behavior introduction.
- **CDD inappropriate.** No new user-visible component contract (the LeadCard, LeadDetail, filters all preserve their existing contracts).

**Test plan (minimum sufficient):**

1. **Contract integration test** (new, ~80 lines, Node test runner): stub global `fetch` for `/api/leads`. Drive the equivalent of `loadLeads` through three boundary cases — first page (`page=1, total=120, limit=50, pageCount=3`), last page (`page=3, data.length=20`), empty result (`total=0, data=[]`). Assert `leads` and `leadsPagination` state shapes.
2. **Page navigation test** (same file or sibling): given a stubbed multi-page response set, call `setLeadsPage(2)` then `setLeadsPage(3)`, assert correct query params sent to fetch and correct state updates.
3. **Server regression**: `tests/server/api/leads/list-leads-paginated.test.ts` 5 cases must remain green.
4. **Mock-mode parity**: an additional ~10-line test verifying that when `authMode !== 'supabase'`, the context exposes a synthetic single-page `leadsPagination` and `setLeadsPage(1)` is a no-op.

**Production smoke (not automated, one-shot at deploy):**

- With ≥51 leads in `pdotsdahsrnnsoroxbfe` (if achievable; if not, the empty/single-page boundary is the only verifiable case), open `/dashboard/leads`, observe page 1 / 2 / 3 navigation, observe `Page X of Y` label updates, observe "next" disabled on last page and "prev" disabled on first page.

---

## 9. Acceptance criteria (testable Validator gates)

Lifted verbatim from router §5 and made concrete:

| # | Criterion | Evidence |
|---|---|---|
| A1 | `/dashboard/leads` renders paginated results using `lib/server/pagination/*` against real Supabase data. | Manual smoke: open `/dashboard/leads` as `admin`, see ≤50 leads + "Page 1 of N" label when tenant has >50 leads. |
| A2 | API `/api/leads` accepts and validates pagination params; returns the module's standard pagination envelope. | Already true (`tests/server/api/leads/list-leads-paginated.test.ts` 5 cases pass). Validator re-runs `npm test`. |
| A3 | UI pagination controls function in both real and mock modes. | (a) Real: click prev/next, observe page change. (b) Mock: with `authMode='mock'`, controls are hidden (pageCount=1) — this counts as "function correctly" for a single-page dataset. |
| A4 | At least one E2E/integration test covers page navigation + boundary (first page, last page, empty result). | The new contract integration test from §8 step 1 + step 2. |
| A5 | `database.types.ts` untouched. | `git diff develop -- lib/server/supabase/database.types.ts` shows no change. G7 override discipline preserved. |
| A6 | `docs/context/project.context.core.md` updated. | New Operating-rules entry mentioning leads pagination (no B/R/Sprint codes per MEMORY rule). |
| A7 | Roadmap §6 F-V12 entry marked closed. | `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` reflects closure per MEMORY rule. |
| A8 | FASE 2 Bloque C marked 4/4 closed in `docs/context/project.context.core.md`. | Per router §5. If Bloque C count was previously 3/4, this iteration closes the fourth. Docs skill verifies the framing. |
| A9 | `npm test` passes (server regression + new client integration). | Validator runs `npm test` and confirms exit 0. |
| A10 | No regression in existing mutation paths (`addLead`, `updateLead`, `deleteLead`, `updateLeadStatus`, `claimLead`, `releaseLeadAsNoResponse`, lead proposal / activity flows). | Manual smoke + `npm test` for any existing mutation tests. |

---

## 10. Re-route triggers (concrete, with file/line citations)

Lifted from router §6, made specific:

| Trigger | Concrete condition | Action |
|---|---|---|
| **Pagination contract insufficient** | If during implementation we discover `OffsetResponse<T>`'s `meta` shape (lines 4-9 of `lib/server/pagination/envelope.ts`) lacks a field the UI needs — e.g., a stable cursor for "jump to specific lead" — escalate to `system-architecture` and consider chunking into 2 PRs. **Analysis pre-check:** `meta` exposes `page, limit, total, pageCount`. These are sufficient for prev/next/Page-X-of-Y. **No escalation expected.** |
| **New RPC or migration needed** | If implementation requires a `count`-only query separate from `listLeads`, or any new SQL function for cross-page search, escalate to `system-architecture` + `system-backend` FULL. **Analysis pre-check:** `listLeads` already does `count: 'exact'` at `lib/server/leads/repository.ts:54`. No new RPC needed. **No escalation expected.** |
| **Limit unclamped / cursor forgeable / RLS gap** | `system-security` becomes mandatory. **Analysis pre-check:** `lib/server/pagination/schema.ts:5` clamps `limit ≤ 100` server-side. No cursor used. RLS unchanged (admin/sales_manager/sales gate at `app/api/leads/route.ts:14`). **Security stays LITE-skip.** |
| **Refactor of `lib/data-context.tsx` exceeds local cleanup** | If the wire-up requires restructuring more than the `loadLeads` / `refreshLeads` / state shape — e.g., factoring leads state into a sub-context — promote to FULL and add `system-refactor` to the chain. **Analysis pre-check:** the change is bounded to ~80 lines in `lib/data-context.tsx` (state add + loader rewrite + value-object expose). **No promotion expected.** Frontend skill must surface a warning if the diff exceeds ~150 lines in this file. |
| **Mock-mode parity nontrivial** | If mock mode requires synthesizing more than a static single-page meta — e.g., paginating `mockLeads` for demo realism — stay LITE but flag PARTIAL risk. **Analysis pre-check:** §2.1 mandates the simplest synthesis (one-page meta covering all mock leads). **No PARTIAL flag expected.** |

---

## 11. Definition of Done

This iteration is **COMPLETE** when:

1. Spec exists (this file).
2. `lib/data-context.tsx` exposes `leadsPagination` + `setLeadsPage` and `loadLeads` correctly reads the envelope.
3. `app/dashboard/leads/page.tsx` renders pagination controls bound to the context.
4. Mock-mode parity preserved: switching `authMode` away from `'supabase'` continues to render the dashboard without error and without controls (single-page).
5. New integration test exists covering first / last / empty boundaries + page navigation.
6. `tests/server/api/leads/list-leads-paginated.test.ts` (5 cases) still passes.
7. `npm test` exits 0.
8. `lib/server/supabase/database.types.ts` untouched.
9. `docs/context/project.context.core.md` updated (no B/R/Sprint codes; per MEMORY rule).
10. Roadmap §6 F-V12 entry marked closed (per MEMORY rule).
11. FASE 2 Bloque C marked 4/4 closed in `docs/context/project.context.core.md`.
12. `system-validator` returns **COMPLETE**.

**PARTIAL conditions:** if 1-8 pass but 9-11 are incomplete, iteration is PARTIAL pending docs.

**BLOCKED conditions:** if implementation reveals any re-route trigger (§10) actually firing, iteration is BLOCKED pending router re-decision.

---

## 12. Chunking decision

**Single iteration. One PR.** Estimated effort: ~2-3h.

- 15min: architecture confirmation (no design needed; analysis already pre-confirmed contract sufficiency).
- 60-90min: frontend (data-context wire-up + page controls + mock-mode parity).
- 30min: testing (new integration test + run suite).
- 15min: docs (context.core + roadmap).
- 15min: validator close-out.

No chunking because: (a) the wire-up is atomic — partial state where the context exposes `setLeadsPage` but the UI does not call it is dead code; (b) the integration test exercises both sides; (c) the change is well below the FULL-promotion threshold.

---

## 13. Success Criterion (single sentence)

A user with the `admin`, `sales_manager`, or `sales` role visiting `/dashboard/leads` in a Supabase tenant with more than 50 leads sees a paginated list of 50 leads at a time with functional prev/next controls and an accurate "Page X of Y" label, while mock-mode users continue to see the same single-page experience as before.

---

## 14. Recommended Route Depth

**LITE.** No re-route trigger fires under analysis pre-checks (§10). Frontend-primary skill chain.

---

## 15. Lifecycle

- **Status:** Draft (pending implementation).
- **Moves to Approved:** when frontend implementation begins (no separate architecture sign-off needed; contract is pre-existing and tested).
- **Moves to Implemented:** when `system-validator` returns COMPLETE.
- **Supersedes:** nothing.
- **Superseded by:** future server-side filter/search/sort iteration (deferred per R1 / §2.2) will reference this spec but does not supersede it.

---

## 16. Handoff to next skill

### Next skill: `system-frontend` (primary).

**Inputs:**
- This spec.
- Pre-existing pagination contract: `lib/server/pagination/{schema,cursor,envelope}.ts`.
- Pre-existing server route: `app/api/leads/route.ts` (untouched).
- Current UI: `app/dashboard/leads/page.tsx` (lines 494-532 are the insertion site for controls).
- Current state owner: `lib/data-context.tsx` (lines 479-486 are the loader to rewrite; lines 60-128 are the type to extend; lines 1827-1880 are the value object to extend).

**Deliverables expected from frontend:**
1. Modified `lib/data-context.tsx` per §3.1.
2. Modified `app/dashboard/leads/page.tsx` per §3.1.
3. (Optional) `components/leads-pagination-controls.tsx` per §3.2 Q2.
4. Diff summary noting which Q1-Q6 defaults were taken (or where they diverged).

**Then handoff to `system-testing`** for the §8 integration test (~80 lines, Node test runner harness).

**Then handoff to `system-docs`** for §11 items 9-11.

**Then handoff to `system-validator`** for §11 item 12.

### Skills skipped and why:

- `system-architecture` — contract pre-confirmed sufficient by analysis pre-checks (§10). No new ADR. If re-route trigger 1 fires at implementation, restart here.
- `system-audit` — repo state is fully understood. `develop` is clean at `3758dcf`. No recovery needed.
- `system-backend` — no server-side change. The route, repository, schema, and envelope are all pre-existing and tested.
- `system-refactor` — change is bounded to the analysis-mapped surface; if it exceeds ~150 lines in `lib/data-context.tsx`, frontend escalates per §10 trigger 4.
- `system-security` — no auth/permission/secrets/input-validation/payment/PII surface changes (§6 R7, R8). Security stays LITE-skip.
- `system-infra` — no deploy / env / build / runtime change. No NoonWeb cross-repo coupling.

---

## Verdict

**READY-FOR-IMPLEMENTATION.**

Rationale:
- Pagination contract is sufficient (offset envelope exposes page/limit/total/pageCount — all four control-renderable fields). Verified at `lib/server/pagination/envelope.ts:4-9`.
- Server side is complete and tested (`tests/server/api/leads/list-leads-paginated.test.ts` 5 cases pass against the handler-factory at `app/api/leads/route.ts:27-53`).
- The defect is purely on the client envelope-consumer (`lib/data-context.tsx:480-486` discards `meta` via `readApiResponse<LeadWire[]>`).
- All router §6 re-route triggers checked against current code and none fire (§10).
- No architecture-class decisions remain. The six open questions have defensible defaults (§7).

**Next handoff: `system-frontend`** to execute §3.1, then chain → `system-testing` → `system-docs` → `system-validator`.
