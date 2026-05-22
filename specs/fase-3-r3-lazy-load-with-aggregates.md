# Spec — Fase 3 · R3 · Lazy-load with aggregates

## 1. Metadata

| Field | Value |
|---|---|
| Feature/iteration | `fase-3-r3-lazy-load-with-aggregates` |
| Date | 2026-05-22 |
| Author | Analysis (Claude Opus 4.7 · 1M context) |
| Status | Draft (awaiting Architecture) |
| Router mode | Refactor FULL |
| Depth | Full |
| Skipped routes | Infra (no runtime/deploy/env changes) |
| Branch base | `develop` |
| Cross-repo wire contract | Unchanged — iteration is App-internal; no NoonWeb surface touched |

### Lifecycle / lineage

This spec supersedes the **R3 deferral** declared in the F-V12 closure on
2026-05-20 (roadmap line 188): *"R3 same-class latent bug en projects/tasks/users
deferred explícitamente"*. The R3 deferral was recorded in
`specs/fase-2-c-fv12-leads-pagination-wireup.md` §Risks and roadmap §17 Bloque C
verdict §6 (lines 1163-1166).

R3 specifically named **projects/tasks/users** as the same-class latent surfaces
that still eager-load full sets via `readApiResponse<T>` after F-V12 only
fixed leads. **This spec scopes the structural rewrite for projects and tasks**.
Users (`/api/users/admin`, `/api/users/delivery`) are **explicitly deferred
again** — see §4 Scope-out.

The pre-existing pipeline/reports same-class partial-data behavior on leads
(F-V12 R1 filter-scope) is **NOT in scope** here; this spec only changes the
provider-level eager-load policy, not page-level visible scoping rules.

---

## 2. Business objective

Today, on every authenticated session start, `DataProvider`
(`lib/data-context.tsx` lines 640-760) eager-loads in parallel:
- leads page 1 (`/api/leads?page=1&limit=50` — already paginated since F-V12),
- **all** projects up to server cap 100 (`/api/projects`),
- **all** tasks up to server cap 100 (`/api/tasks`),
- delivery directory (`/api/users/delivery`),
- admin settings directory if `role=admin` (`/api/users/admin`).

The dashboard home (`app/dashboard/page.tsx:33-37`) then derives KPIs
*entirely client-side* from those full collections via
`selectDashboardSummary(leads, projectBoardProjects, taskBoardTasks)` in
`lib/dashboard-selectors.ts:484-523`. This means **the KPIs are only correct as
long as the entire dataset fits within the eager-load page-size**, which does
not scale and is already capped silently at 100 projects / 100 tasks server-side
(`lib/server/pagination/schema.ts`).

Goal: replace the eager-load-everything pattern with (a) a single SQL-side
**aggregate summary endpoint** for dashboard KPIs, and (b) **per-page lazy
loads** for the actual list/board pages, so dashboard load time and correctness
no longer scale with tenant volume.

This is structural cleanliness and pre-volume protection. It does not change
UX, contracts visible to NoonWeb, or auth/permissions.

---

## 3. Scope — IN

### 3.1 New aggregate endpoint

- `GET /api/dashboard/summary` returning a typed JSON payload with sales +
  delivery KPI fields, scoped server-side by current principal role (RLS-aware,
  no client filter required).
- The payload **must produce numerically identical values** to the current
  `selectDashboardSummary(...)` output for the same visible dataset, given:
  - sales role scopes (admin/sales_manager see all, sales sees own),
  - delivery role scopes (admin/pm see all delivery, sales_manager read-only,
    developer sees only assigned),
  - `payment_activated = true` project filter (matches
    `lib/server/projects/repository.ts:83`),
  - JS-side `deriveProjectDisplayStatus(...)` override rules (see §10 Risks R1
    for the parity contract).
- Counts and sums computed with PostgreSQL aggregates, not by streaming rows
  back to the client.

### 3.2 `DataProvider` refactor

- The login-time `useEffect` (`lib/data-context.tsx:640-760`) **stops globally
  loading leads / projects / tasks** in `supabase` mode.
- Mock mode behavior is preserved unchanged (mock loads stay synchronous from
  `lib/mock-data.ts`).
- Delivery directory (`/api/users/delivery`) and admin settings directory
  (`/api/users/admin`) **remain eager-loaded** because they are bounded
  reference data (small, role-stable, already used by sidebar/forms) and they
  are explicitly deferred from R3 scope (§4).
- `DataProvider` exposes a new method to refresh the dashboard summary, and
  invalidates the summary cache when relevant client-side mutations succeed
  (see §3.5 invalidation surfaces).
- `leads`, `projects`, `tasks` and their related arrays remain on the context
  shape but become **empty by default in `supabase` mode** until the consuming
  page lazily loads its own slice. Mock mode keeps eager seeding to preserve
  demo continuity.

### 3.3 Per-page lazy load

Each consuming page becomes responsible for loading its own slice on mount and
using the existing `OffsetMeta` envelope already exposed by `/api/projects` and
`/api/tasks`:

- `/dashboard/leads`: already lazy via `setLeadsPage` since F-V12 — must still
  trigger the initial load itself instead of relying on the provider.
- `/dashboard/pipeline`: gains a page-level lead loader for the kanban view.
  This page already operated on a *paginated subset* of leads (latent F-V12 R1
  bug — see §4 out-of-scope); behavior parity in this iteration is "loads the
  same slice as before" — solving the partial-pipeline-view problem is **not in
  scope here**.
- `/dashboard/projects`: triggers `/api/projects` (paginated) on mount.
- `/dashboard/tasks`: triggers `/api/tasks` (paginated) on mount.
- `/dashboard/reports`: triggers leads + projects + tasks slice on mount
  (subject to the same latent partial-view caveat).
- `/dashboard/settings`: already self-loads `settingsUsers` via
  `refreshSettingsUsers`; unchanged.

### 3.4 Dashboard home rewire

- `app/dashboard/page.tsx` stops consuming `selectDashboardSummary(leads,
  projects, tasks)` and instead reads the new summary endpoint via a new hook
  exposed by `DataProvider` (or a co-located one if Architecture decides
  otherwise).
- Two client-derived counters in `app/dashboard/page.tsx` are explicitly part of
  the parity contract and must be moved into the summary endpoint OR retained
  in JS only after honest justification:
  - `conversionRate` (lines 63-67) — derivable in SQL.
  - `overdueFollowUps` (lines 69-79) — derivable in SQL (`next_follow_up_at <
    now()` AND status not in (`won`,`lost`)). The current code reads a *list*
    of overdue leads; the summary endpoint should return at minimum a `count`
    and Architecture may decide whether to also return ids/preview rows.
  - `leadsByStatus` (lines 81-109) — a histogram needed for the pie chart;
    derivable in SQL as `GROUP BY status`.
- Removal of dashboard home dependency on the full `leads` / `projects` /
  `tasks` arrays is the success criterion (§14).

### 3.5 Invalidation surfaces

After every successful mutation that changes any input to the summary, the
provider must (a) update its local lists if the page that triggered the
mutation needs them, and (b) trigger a summary refresh. Architecture picks the
mechanism (optimistic patch / refetch / SWR / event bus / polling) and justifies
the choice. The mutation surfaces that MUST trigger summary invalidation are
the complete list below; this list is the contract Architecture must wire:

**Leads (sales KPIs)**
- `addLead` (`lib/data-context.tsx:1267`)
- `updateLead` (`:1317`) — when `status` or `value` changes
- `deleteLead` (`:1410`)
- `updateLeadStatus` (`:1477`)
- `claimLead` (`:1208`) — does not change KPI inputs directly today but kept on
  the list because `assignmentStatus` affects future scope filters
- `releaseLeadAsNoResponse` (`:1150`) — same reasoning
- `addLeadProposal` (`:835`) — does not change `Lead.status` directly, but the
  current code calls `await loadLeads()` after `updateLeadProposalStatus`
  (`:1008`); the proposal status change can demote/promote a lead through
  pricing flows (proposal `sent`/`accepted`/`handoff_ready` triggers a `proposal_locked` lead)
- `updateLeadProposalStatus` (`:917`)
- `createProjectFromProposal` (`:1015`) — sets lead to `won` AND creates a project

**Projects (delivery KPIs)**
- `addProject` (mock-only, `:1538`) — invalidation only needed for mock parity
- `updateProject` (`:1549`) — when `status` (and downstream
  `deriveProjectDisplayStatus`) changes
- `deleteProject` (mock-only, `:1610`)
- `updateProjectStatus` (`:1616`)

**Tasks (delivery KPIs)**
- `addTask` (`:1629`) — task creation changes `pendingTasks`
- `updateTask` (`:1675`) — when `status` changes
- `deleteTask` (mock-only, `:1743`)
- `updateTaskStatus` (`:1748`)

**Server-side mutations not initiated from `DataProvider` (out of band)**
- `POST /api/integrations/website/payment-confirmed` — flips
  `projects.payment_activated`. The current `DataProvider` does not learn about
  this. The summary endpoint will pick it up on next read. **Not in scope to
  push a server-side invalidation event in this iteration.** Documented as
  acknowledged stale-window risk (§10 R5).
- `POST /api/inbound/pm-queue/[proposalId]/review-webhook` (PM approval/reject)
  — same characterization.

### 3.6 Tests

- Integration tests for `/api/dashboard/summary` exercising:
  - role scoping (admin/sales_manager/sales/pm/developer/sales_manager-read-only),
  - empty-tenant case,
  - non-trivial-volume case (fixtures with ≥3 leads in each status, ≥5
    projects in mixed statuses with mixed-status tasks, ≥10 tasks).
- Integration tests asserting parity between SQL aggregates and the existing
  JS-side `selectDashboardSummary` over the same in-memory fixtures (i.e., the
  same input data → same KPI values).
- Provider-level tests for the invalidation flow: mutation X triggers summary
  refetch (or optimistic patch + reconcile).
- Per-page lazy-load tests for `/dashboard/projects` and `/dashboard/tasks`:
  page mount triggers fetch; provider does not pre-load.
- Sidebar-badge regression test: `unreadNotifications` continues to render
  from `/api/notifications?limit=1` independently of the refactor.

### 3.7 Docs

- Update `docs/context/project.context.core.md` and `project.context.full.md`
  to reflect that dashboard KPIs read from a summary endpoint and that
  `DataProvider` no longer eager-loads leads/projects/tasks globally.
- No plan-refs (R3, Sprint numbers) in `docs/context/*` per memory rule. The
  R3 reference lives ONLY in this spec.

---

## 4. Scope — OUT (explicitly excluded)

| Item | Reason |
|---|---|
| Users pagination (`/api/users/admin`, `/api/users/delivery`) | Operator-confirmed: bounded reference data, defer until volume is felt in `/dashboard/settings`. R3 same-class deferred for users continues. |
| Pipeline kanban partial-view bug (F-V12 R1) | Pipeline already operates on a paginated subset of leads. Fixing this is the previously-named R1 filter-scope item — its own iteration. |
| Reports partial-view bug | Same as pipeline — F-V12 R1 carry-over. |
| Server-side push for `payment_confirmed` / PM review webhook → live KPI updates | Acknowledged as stale-window (max ~1 page refresh). Pushing real-time invalidation would require infra (channels/SSE/websockets) outside this Refactor scope. |
| Filter scope rewrite (server-side filtering) | Same iteration class as R1 — defer. |
| URL-state deep-link recovery for pagination (F-V12 R2) | Defer. |
| Maxwell-lead-engine fields in summary (e.g., audit counts) | Not requested; the summary endpoint scopes to the existing six sales KPIs + six delivery KPIs + the three dashboard-home extras. |
| Mock-mode behavior changes | Mock seeding is preserved; mock mode still derives KPIs JS-side. The new endpoint is a `supabase`-only path. |
| Rewriting `deriveProjectDisplayStatus` semantics | The SQL aggregate must match the JS rule, NOT redefine it. |
| Settings page (`/dashboard/settings`) refactor | Already self-loads `settingsUsers`. Unchanged. |
| `/dashboard/pm-queue`, `/dashboard/prototypes`, `/dashboard/credits`, `/dashboard/notifications`, `/dashboard/updates`, `/dashboard/earnings`, `/dashboard/rewards`, `/dashboard/web-analysis`, `/dashboard/leads/[…]` server actions, Maxwell routes | None of these consume `leads`/`projects`/`tasks` from `DataProvider` for KPI display. Confirmed by grep of `useData()`. |
| New auth/permission model | Summary endpoint reuses existing role-based RLS; no new GRANT/REVOKE. |
| Caching beyond client memory | No Redis/CDN/edge caching added. |
| Optimistic-UI rewrite of mutation surfaces | Mutation handlers may add invalidation hooks but their optimistic logic is preserved. |

---

## 5. Acceptance criteria (testable)

1. After login, the network panel shows **no eager `GET /api/leads`,
   `/api/projects`, `/api/tasks` requests** from `DataProvider` in `supabase`
   mode. Only `/api/dashboard/summary` (plus directories) is hit at provider
   mount.
2. Visiting `/dashboard` triggers exactly one `GET /api/dashboard/summary`
   request and the KPI cards render correctly without any list fetches.
3. Visiting `/dashboard/projects` triggers `/api/projects?page=1&limit=…` on
   page mount. Returning to `/dashboard` does not refetch the list.
4. Visiting `/dashboard/tasks` triggers `/api/tasks?page=1&limit=…` on page
   mount.
5. KPI parity: for the same persisted tenant data, the JSON returned by
   `/api/dashboard/summary` produces values numerically equal to the values
   `selectDashboardSummary(leads, projects, tasks)` produces today, with the
   delivery counters consuming `deriveProjectDisplayStatus` semantics
   (see §10 R1 for the exact contract).
6. Mutating a lead status from `proposal` to `won` (via PATCH `/api/leads/:id`)
   results in the next dashboard-home render reflecting incremented `wonLeads`
   and `totalRevenue` and decremented `openLeads` / `pipelineValue`.
7. Same for projects: changing a real project's `status` from `in_progress`
   to `review` is reflected in the next summary read for the role that can see
   that project.
8. Same for tasks: changing a real task's status updates the task-derived
   delivery counters.
9. Mock-mode dashboard home renders identical KPI values to the previous
   `selectDashboardSummary` output (no mock regression).
10. Sidebar notifications badge continues to render unchanged.
11. No new RLS errors in any of the 5 roles (`admin`, `sales_manager`, `sales`,
    `pm`, `developer`) when reading the summary endpoint.
12. Per the testing methodology declared in §11, the parity, role-scope, and
    invalidation contracts are exercised with fixtures of non-trivial volume
    (see §10 R6 fixture rule).

---

## 6. Affected files / modules

### Server (Backend)

- `lib/server/dashboard/summary-repository.ts` *(new)* — SQL aggregate queries
  scoped to current principal, returning a typed result.
- `lib/server/dashboard/summary-service.ts` *(new)* — assembles the response
  payload, applies role-aware filtering, delegates to repository.
- `lib/server/dashboard/serialization.ts` *(new)* — wire contract types for
  the summary response.
- `app/api/dashboard/summary/route.ts` *(new)* — Next.js route handler
  exposing `GET /api/dashboard/summary`, guarded by `requireRole(...)` for
  all 5 app roles.
- `lib/server/auth/guards.ts` *(read-only; no edits expected)*.
- `lib/server/pagination/envelope.ts` *(read-only; envelope is not used for
  summary — single-object response)*.
- `supabase/migrations/*` — **no migration expected** unless Architecture
  decides on a DB-side view/function. If added, that becomes an Architecture
  decision recorded in the ADR/spec update.

### Client (Frontend)

- `lib/data-context.tsx` *(major refactor)*:
  - Remove the leads/projects/tasks eager loads from the supabase branch in
    the login `useEffect` (lines 668-716).
  - Keep `loadLeads`/`loadProjects`/`loadTasks` as imperative methods callable
    from pages (their signatures stay identical so per-page consumers can
    invoke them).
  - Add `dashboardSummary`, `isDashboardSummaryLoading`, `dashboardSummaryError`
    state and a `refreshDashboardSummary()` method.
  - Wire summary invalidation into all mutation surfaces listed in §3.5.
  - Preserve mock-mode eager seeding unchanged.
- `lib/dashboard-selectors.ts`:
  - Keep `selectDashboardSummary` for mock mode and as the parity reference for
    tests.
  - Add `selectDashboardSummaryCopy(authMode)` helpers if needed for empty/
    loading/error UI copy.
  - May add `DashboardSummaryWire` deserialization helpers if Architecture
    decides the wire/runtime shapes differ.
- `app/dashboard/page.tsx`:
  - Replace `selectDashboardSummary(leads, projects, tasks)` consumption with
    new summary hook in `supabase` mode.
  - Move `conversionRate`, `overdueFollowUps`, `leadsByStatus` to the summary
    payload (Architecture decides exact shape).
  - Preserve mock-mode behavior.
- `app/dashboard/leads/page.tsx`:
  - Trigger initial `loadLeads(1)` from page mount in `supabase` mode if the
    provider has not yet populated leads.
- `app/dashboard/pipeline/page.tsx`:
  - Same as leads: trigger initial `loadLeads(1)` on mount. Document the
    latent partial-view caveat in inline comments (referencing F-V12 R1
    closure, no new product behavior).
- `app/dashboard/projects/page.tsx`:
  - Trigger `refreshProjects()` on mount in `supabase` mode if
    `persistedProjects` is empty.
- `app/dashboard/tasks/page.tsx`:
  - Trigger task load on mount in `supabase` mode (a new
    `refreshTasks()` method on provider, mirroring `refreshProjects()`).
- `app/dashboard/reports/page.tsx`:
  - Trigger leads + projects + tasks slice loads on mount (subject to caveat).

### Shared / types

- `lib/types.ts` may gain a `DashboardSummary` (canonical client type)
  alongside the existing local interface inside `lib/dashboard-selectors.ts`.

### Components touched (consumers)

- `components/lead-detail.tsx` (uses provider mutations — already covered
  via invalidation hooks; no direct change expected)
- `components/lead-form-dialog.tsx` (same)
- `components/project-form-dialog.tsx` (same)
- `components/task-form-dialog.tsx` (same)
- `components/lead-card.tsx` (read-only consumer; no change)
- `components/app-sidebar.tsx` — **no change** to the data-list dependencies;
  badge logic is independent.

### Tests touched / added

- `tests/api/dashboard-summary.test.ts` *(new)* — role scope + KPI parity
  fixtures.
- `tests/lib/data-context-dashboard-summary.test.ts` *(new)* — provider
  refactor: eager-load removal, mutation→invalidation flow.
- `tests/pages/dashboard-home.test.tsx` *(new or extended)* — dashboard home
  consumes summary endpoint.
- Existing pagination tests (`tests/lib/data-context-leads-pagination.test.ts`)
  — must not regress.

---

## 7. Dependencies

| Dep | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| Supabase PG aggregate execution under RLS for the 5 roles | infra (existing) | Available | If RLS leaks happen, summary lies to lower-privileged roles | Backend |
| `payment_activated` filter parity (`lib/server/projects/repository.ts:83`) | contract | Available | Project counts would diverge from `/api/projects` if the SQL skips this filter | Architecture |
| `deriveProjectDisplayStatus` rules in `lib/projects/progress.ts:19-46` | contract | Available | KPI parity fails if not faithfully reproduced in SQL | Architecture / Backend |
| `selectDashboardSummary` reference in `lib/dashboard-selectors.ts:484-523` | contract | Available | Same as above — this is the JS truth the SQL must match | Frontend |
| Existing `OffsetMeta` envelope (`lib/server/pagination/envelope.ts`) | internal | Available | Per-page lazy loads reuse it; no contract change | Backend |
| `auth-context.tsx` role helpers (`canAccessSales`, `canAccessDelivery`, etc.) | internal | Available | UI guards stay the same | Frontend |
| Mock data (`lib/mock-data.ts`) | internal | Available | Mock mode must keep producing identical KPI values via JS path | Frontend |
| No new env vars / no new migration | infra | N/A | Confirmed; Infra route skipped | — |

---

## 8. Assumptions

1. The existing role-based RLS on `leads`, `projects`, `tasks`,
   `user_profiles` is sufficient to scope a summary endpoint without explicit
   server-side filtering — the SQL aggregate runs as the authenticated
   principal and PG returns only counts/sums over rows visible to that role.
   *(If false, Architecture must add an explicit role-aware service-layer
   filter — recorded as R7.)*
2. `deriveProjectDisplayStatus` is the canonical truth for delivery project
   counters; reproducing it via SQL `EXISTS` subqueries against `tasks` is
   acceptable (see R1 for the exact contract).
3. The "stale window" between server-side mutations (Stripe payment confirmed,
   PM webhook approval) and the next dashboard refresh is acceptable for this
   iteration. Real-time push is out of scope.
4. `/api/dashboard/summary` is a JSON GET; no envelope/meta wrapping (it's a
   single object, not a list). Architecture confirms.
5. The dashboard home does not need a server-rendered initial summary — the
   client hook fetches on mount with a loading state (consistent with current
   behavior of all other dashboard surfaces).
6. The sidebar notifications badge does NOT need to be part of summary; it
   continues to call `/api/notifications?limit=1`.
7. Maxwell-related dashboard counters (if any) are not in scope; only the 6
   sales + 6 delivery + 3 dashboard-home extras (conversionRate,
   overdueFollowUps, leadsByStatus) are.
8. The summary endpoint is read-only and idempotent; safe to call repeatedly.

---

## 9. Open questions (do not block bounded progress)

1. **Where does the dashboard summary hook live?** Inside `DataProvider`
   (consistent with current architecture) or in a separate
   `DashboardSummaryProvider` co-located in the dashboard layout (cleaner
   separation, lower coupling)? **→ Architecture decides.**
2. **Wire-shape of `overdueFollowUps`**: just `{ count }` or also a `preview`
   array of {id, name, nextFollowUpAt} (the current code shows the count and
   uses overdue-state styling on the cards in `/dashboard/leads`)? The current
   dashboard home only renders the count, but the data is read as a list.
   **→ Architecture / Operator decides.** Spec assumes count-only by default
   but accepts a small preview array if Architecture justifies it.
3. **Cache TTL**: Architecture may recommend a 30s/60s client-side cache to
   reduce noise from rapid mutations. **→ Architecture decides.**
4. **Invalidation mechanism**: optimistic local patch vs unconditional refetch
   vs hybrid (optimistic + reconcile after settle). **→ Architecture decides
   with justification.**
5. **Server-side composition**: single SQL statement with CTEs vs separate
   queries fanned in JS service. **→ Backend / Architecture decides.**
6. **`maxwell_*` lead origin filter**: should sales KPIs differentiate
   maxwell-published leads? Operator did not request it; spec excludes. **→
   Closed: out of scope.**

---

## 10. Risks

Format: `probability / impact / severity / mitigation`.

### R1 — KPI parity drift (regression-critical)

- **What**: SQL aggregates produce different counts/sums than current JS
  `selectDashboardSummary` for the same data, especially for delivery counters
  that depend on `deriveProjectDisplayStatus(persistedStatus, tasks[])`.
- **The contract that MUST be reproduced** (from
  `lib/projects/progress.ts:19-46`):
  - If `tasks.length === 0` → use `persistedStatus`.
  - If `persistedStatus === 'completed'` → return `completed`.
  - If `persistedStatus === 'delivered'` AND every task is `done` → return
    `delivered`.
  - If any task is `review` → return `review`.
  - If any task is `in_progress` OR `done` → return `in_progress`.
  - Else if `persistedStatus in {review, delivered}` → return persistedStatus.
  - Else → return `backlog`.
- **Proposed SQL aggregate shape** (Architecture refines):
  - `activeProjects` = COUNT(*) WHERE display_status = 'in_progress',
    where `display_status` is derived per-project via an inline subquery or
    CTE that reproduces the rule above.
  - `projectsInReview` = COUNT(*) WHERE display_status = 'review'.
  - `completedProjects` = COUNT(*) WHERE display_status = 'completed'.
  - `pendingTasks` = COUNT(*) FROM tasks WHERE status = 'todo'.
  - `inProgressTasks` = COUNT(*) FROM tasks WHERE status = 'in_progress'.
  - `reviewTasks` = COUNT(*) FROM tasks WHERE status = 'review'.
  - `openLeads` = COUNT(*) FROM leads WHERE status NOT IN ('won','lost').
  - `wonLeads` = COUNT(*) FROM leads WHERE status = 'won'.
  - `pipelineValue` = SUM(value) WHERE status NOT IN ('won','lost').
  - `totalRevenue` = SUM(value) WHERE status = 'won'.
  - All implicitly scoped by RLS for current principal.
  - Projects also implicitly filtered by `payment_activated = true` to match
    `listProjects` (`lib/server/projects/repository.ts:83`).
- **Severity**: HIGH (silent KPI lies are worse than no KPIs).
- **Probability**: MEDIUM (SQL/JS semantic divergence is the classic gotcha).
- **Impact**: HIGH (sales / delivery leadership sees wrong numbers).
- **Mitigation**: a dedicated parity test suite that feeds the same fixture
  rows into both the JS selector and the SQL endpoint and asserts byte-equal
  KPI values; covered by §3.6 tests; runtime browser validation against
  pre-existing persisted data for at least one role.

### R2 — Invalidation gaps after mutations

- **What**: A mutation listed in §3.5 fires but the summary cache isn't
  invalidated, so the dashboard home shows stale numbers until manual refresh.
- **Severity**: MEDIUM.
- **Probability**: MEDIUM (15 mutation surfaces; easy to miss one).
- **Impact**: MEDIUM (cosmetic until user refreshes).
- **Mitigation**: provider-level test that exercises every mutation in §3.5
  and asserts the summary endpoint is re-read (or local state is patched).

### R3 — `lib/data-context.tsx` is a high-risk file

- **What**: Per `docs/runbooks/frontend-redesign-playbook.md`, this file is
  the project's primary state surface. Any refactor risks cascading regressions
  in leads/projects/tasks/proposals/activity/notes/Maxwell flows.
- **Severity**: HIGH.
- **Probability**: MEDIUM.
- **Impact**: HIGH (could break sales + delivery in one go).
- **Mitigation**: exhaustive testing per §3.6; chunk plan in §13 isolates the
  scaffold (summary endpoint + tests) before touching the provider.

### R4 — Sidebar / badge consumers

- **What**: A consumer outside the enumerated list also reads `leads` /
  `projects` / `tasks` from the provider and breaks silently when those arrays
  are empty by default in `supabase`.
- **Confirmed consumers** (grep of `useData()`):
  - Pages: `dashboard/page.tsx`, `dashboard/leads/page.tsx`,
    `dashboard/pipeline/page.tsx`, `dashboard/projects/page.tsx`,
    `dashboard/tasks/page.tsx`, `dashboard/reports/page.tsx`,
    `dashboard/settings/page.tsx`.
  - Components: `lead-detail.tsx`, `lead-form-dialog.tsx`,
    `project-form-dialog.tsx`, `task-form-dialog.tsx`.
- **app-sidebar.tsx**: does NOT call `useData()`. Sidebar reads only
  `useAuth()`, `useWalletContext()`, and `/api/notifications?limit=1`.
  Confirmed safe.
- **Settings page**: consumes `settingsUsers` / `users` (mock) / `userPoints`,
  not leads/projects/tasks. Safe.
- **Components touched by mutations**: `lead-detail.tsx`,
  `lead-form-dialog.tsx`, `project-form-dialog.tsx`, `task-form-dialog.tsx`
  — they call `addLead` / `updateLead` / `addProject` / `updateProject` /
  `addTask` / `updateTask` from provider. These all stay wired; their
  internal calls are unchanged. They do NOT read `leads`/`projects`/`tasks`
  arrays directly.
- **Reports page** reads `leads`, `projectBoardProjects`, `persistedProjects`,
  `taskBoardTasks`, `persistedTasks` from `useData()`. Must self-load.
- **Severity**: MEDIUM. **Mitigation**: explicit enumeration above, plus
  smoke-test of every dashboard route post-refactor.

### R5 — Server-side mutation stale window

- **What**: Stripe payment-confirmed and PM-webhook approvals change KPI
  inputs without going through the client. The dashboard will show stale
  numbers until the user refreshes.
- **Severity**: LOW.
- **Probability**: HIGH (this is expected behavior).
- **Impact**: LOW (single-page-refresh stale window is acceptable for
  internal-team dashboards).
- **Mitigation**: documented in §4 as out-of-scope; acknowledged in spec.

### R6 — Test fixtures with insufficient volume

- **What**: A test that uses 2 leads and 1 project will not catch parity bugs
  that show up only at volume (e.g., sum-over-many or cardinality issues).
- **Severity**: MEDIUM.
- **Probability**: MEDIUM.
- **Impact**: MEDIUM (false-positive test confidence).
- **Mitigation**: fixture rule — every integration test in §3.6 must seed at
  least 10 leads (spread across statuses), 5 projects (with at least 2 in
  `in_progress` and 1 in `delivered` AND 1 in `completed`, with task fanouts
  that override `deriveProjectDisplayStatus`), and ≥10 tasks (mixed statuses,
  some assigned to roles that the RLS test exercises).

### R7 — RLS assumption invalid

- **What**: §8 Assumption 1 says RLS on leads/projects/tasks scopes the
  aggregate naturally. If a role has `select` policy that returns no rows but
  PG's count aggregate over zero rows still returns 0 (correct), this is fine.
  But if there is any join across tables with a different policy, the
  visibility model may be inconsistent.
- **Severity**: HIGH.
- **Probability**: LOW (the existing list endpoints already work this way).
- **Impact**: HIGH (a sales user could see counts they shouldn't, or
  vice-versa).
- **Mitigation**: Architecture must validate the RLS assumption with concrete
  per-role test cases against the linked Supabase project before Backend
  implementation begins. Recorded as a gate.

---

## 11. Recommended testing methodology

**Integration-first**, consistent with the F-V12 precedent
(`specs/fase-2-c-fv12-leads-pagination-wireup.md` §8) and project test
conventions:

- The system under test is a contract — `GET /api/dashboard/summary` returns
  values that match a JS reference under fixture-controlled inputs. This is
  inherently an integration concern (route handler + SQL aggregates + RLS +
  client consumer), not a unit concern.
- The repo does not have JSDOM/React Testing Library wired (per F-V12 verdict
  line 1158). Page-level "lazy fetch on mount" tests will validate the
  *contract* (provider state transitions, request shape) rather than DOM.
- Parity tests run the JS `selectDashboardSummary` reference and the SQL
  endpoint against the same fixture data and assert byte-equal counts/sums.
- Browser validation is required for at least 2 roles (admin + sales) on the
  linked Supabase project before Validator can return COMPLETE (per project
  closure norms in §F-V12 verdict).

TDD per-function is not justified here — the change is shaped, not novel.
BDD scenario authorship is not necessary — the acceptance criteria in §5 are
specific enough. CDD does not apply — no new shared design-system pieces.

---

## 12. Definition of Done

### Per-iteration DoD (aligns with project §Completion policy + adds
iteration-specific items)

- [ ] `/api/dashboard/summary` route exists and returns typed JSON for all 5
      roles without RLS errors.
- [ ] `lib/data-context.tsx` no longer fires `loadLeads(1)` / `loadProjects()`
      / `loadTasks()` from the login `useEffect` in `supabase` mode.
- [ ] `app/dashboard/page.tsx` consumes the summary endpoint and no longer
      depends on `leads` / `projectBoardProjects` / `taskBoardTasks` arrays
      for KPI rendering in `supabase` mode.
- [ ] Each consuming page (`/dashboard/leads`, `/dashboard/pipeline`,
      `/dashboard/projects`, `/dashboard/tasks`, `/dashboard/reports`) loads
      its own slice on mount.
- [ ] All 15 mutation surfaces enumerated in §3.5 trigger summary
      invalidation (test coverage per §3.6).
- [ ] KPI parity test suite passes (SQL vs JS reference) at non-trivial
      volume (per §10 R6 fixture rule).
- [ ] Mock-mode dashboard home renders identical KPI values as before.
- [ ] Sidebar notifications badge regression-tested.
- [ ] Runtime validation on linked Supabase project for `admin@noon.app` and
      one sales role (`maria@noon.app` or equivalent), captured in
      `docs/context/project.context.core.md`.
- [ ] `docs/context/project.context.core.md` and `project.context.full.md`
      updated to reflect the new architecture, with no plan-refs added per
      memory rule.
- [ ] Roadmap updated to record R3-projects-tasks closure (R3-users still
      deferred).
- [ ] `system-validator` returned COMPLETE.

---

## 13. Chunking decision

### Operator (router) proposal

3 chunks:
- **Chunk 1**: summary endpoint + tests.
- **Chunk 2**: `DataProvider` refactor + dashboard home rewire.
- **Chunk 3**: per-page lazy loads + invalidation policy.

### Analysis decision: **2 chunks, with chunks 2+3 fused**

**Reason**: The router asked Analysis to decide whether chunk 2 (DataProvider
refactor) leaves the app functional if chunk 3 (per-page loads) has not yet
landed. **It does not.** The moment `DataProvider` stops eager-loading
`leads` / `projects` / `tasks`, the following pages would render with empty
state until visited individually for the first time:

- `/dashboard/projects` (currently relies on provider-populated
  `persistedProjects`)
- `/dashboard/tasks` (currently relies on provider-populated `persistedTasks`)
- `/dashboard/pipeline` (currently relies on provider-populated `leads`
  page 1)
- `/dashboard/reports` (currently relies on provider-populated
  `leads` + `projectBoardProjects` + `taskBoardTasks`)

If chunks 2 and 3 land in separate PRs, the codebase on `develop` between
those PRs is broken for those four routes. That violates the project rule
that no PR may leave `develop` in a broken state.

**Therefore**:

| Chunk | Bounded objective | Validation outcome | Gate to next chunk |
|---|---|---|---|
| **Chunk 1** — Summary endpoint + parity tests | `/api/dashboard/summary` exists, role-scoped, returns wire contract. KPI parity tests pass at non-trivial volume against existing list endpoints. `DataProvider` and dashboard home untouched. | Tests green; route reachable; KPI numbers match `selectDashboardSummary` against same fixtures. | Operator + Architecture sign-off on parity test results. |
| **Chunk 2 (fused 2+3)** — Provider refactor + dashboard home rewire + per-page lazy loads + invalidation | `DataProvider` eager-load removed; dashboard home consumes summary; all 5 list pages self-load; all 15 mutation surfaces wire invalidation. | All §5 acceptance criteria pass. Browser validation for ≥2 roles. | Validator COMPLETE → spec moves to Implemented. |

This makes chunk 1 a strict additive change (zero behavioral risk to existing
flows) and concentrates all the behavior-changing risk into a single chunk
where it can be reviewed atomically.

**If Architecture later discovers that chunk 2 can be subdivided safely**
(e.g., per-page lazy load can land first as additive changes, with provider
eager-load removed only at the very end), Architecture may resplit; the
resplitting must be recorded as a dated spec update.

---

## 14. Success criterion

After login on `supabase` mode, the user opens `/dashboard` and sees the
correct, role-scoped sales and delivery KPI values rendered from a single
`GET /api/dashboard/summary` request — without any preceding eager
`GET /api/leads`, `/api/projects`, or `/api/tasks` requests. KPI values for
the same persisted data are numerically equal to the values previously
produced by `selectDashboardSummary(leads, projects, tasks)`.

---

## Handoff payload to Architecture

- **Scope frozen**: §3 IN / §4 OUT.
- **Chunking confirmed**: 2 chunks (chunk 1 additive endpoint + parity tests;
  chunk 2 fused provider+dashboard+per-page+invalidation). Operator may resplit
  chunk 2 if Architecture justifies it.
- **KPIs enumerated**: 6 sales + 6 delivery + 3 dashboard-home extras
  (conversionRate, overdueFollowUps, leadsByStatus). SQL aggregate sketch in
  §10 R1. The `deriveProjectDisplayStatus` rule is the parity contract.
- **Mutations enumerated**: 15 surfaces in §3.5; plus 2 acknowledged
  out-of-band server mutations (Stripe payment-confirmed, PM webhook
  approval) that are documented as stale-window risks (§10 R5).
- **Sidebar consumers enumerated**: `app-sidebar.tsx` does NOT consume
  leads/projects/tasks; only `/api/notifications?limit=1`. Safe. Other
  components: `lead-detail`, `lead-form-dialog`, `project-form-dialog`,
  `task-form-dialog` — all mutation-only, no list-array reads. Pages
  consuming the lists are enumerated in §6.
- **Open questions remaining** (do not block Architecture): §9 items 1-5.
  Architecture decides each with one-line justification recorded in the
  Architecture handoff.
- **Gates Architecture must satisfy before Backend implementation**:
  1. Validate §8 Assumption 1 (RLS scopes the aggregate naturally) against
     the linked Supabase project for the 5 roles (R7).
  2. Confirm the SQL shape for `deriveProjectDisplayStatus` parity (R1).
  3. Decide invalidation mechanism (Q4) with justification.
  4. Decide wire shape of `overdueFollowUps` (Q2).
- **Verdict**: `Ready for system-architecture`.
