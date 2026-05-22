# ADR-020: Dashboard summary aggregates endpoint — RLS posture, SQL parity for `deriveProjectDisplayStatus`, wire shape, cache TTL, and invalidation policy

**Status:** Accepted
**Date:** 2026-05-22
**Deciders:** Architecture (Claude Opus 4.7 · 1M context); operator validates downstream.
**Supersedes:** None
**Related:** spec `specs/fase-3-r3-lazy-load-with-aggregates.md` (Analysis output, 2026-05-22), `docs/contracts/dashboard-summary.md` (this ADR's sibling contract), ADR-017 (operational endpoint shape precedent), `docs/runbooks/frontend-redesign-playbook.md` (high-risk file inventory — `lib/data-context.tsx`), `docs/api-auth-matrix.md` (auth-guard convention).

---

## Context

`DataProvider` (`lib/data-context.tsx` lines 640-760) eager-loads `leads` page 1, **all** projects up to server cap 100, and **all** tasks up to server cap 100 on every authenticated mount. The dashboard home (`app/dashboard/page.tsx:33-37`) then computes 12 KPIs + 3 client-derived counters entirely client-side via `selectDashboardSummary(leads, projects, tasks)` in `lib/dashboard-selectors.ts:484-523`. The KPIs are only correct as long as the entire dataset fits within the eager-load page-size. At pilot volume the assumption already silently caps at 100 projects / 100 tasks; at sub-pilot volume past 100 entities of either kind the KPIs lie.

Analysis (the spec) scopes the structural rewrite: a new `GET /api/dashboard/summary` returning SQL-aggregated counts and sums, plus `DataProvider` stops eager-loading lists, plus each list page lazy-loads its own slice. Analysis routed 5 open questions and 4 gates to architecture before backend implementation begins:

- **Q1** — hook location (`DataProvider` vs separate provider).
- **Q2** — `overdueFollowUps` wire shape (count-only vs count + preview).
- **Q3** — client cache TTL.
- **Q4** — invalidation mechanism after the 15 enumerated mutation surfaces.
- **Q5** — SQL composition strategy (single CTE vs fan-out).
- **Gate 1 (R7)** — validate the assumption that existing RLS policies on `leads` / `projects` / `tasks` scope the aggregate correctly per role.
- **Gate 2 (R1)** — produce SQL that faithfully reproduces `deriveProjectDisplayStatus` (`lib/projects/progress.ts:19-46`) for the delivery counters, or escalate to the operator.
- **Gate 3** — decide Q4 with justification.
- **Gate 4** — decide Q2 with justification.

This ADR closes all 5 questions and all 4 gates in one pass.

---

## Decision

### D1 — RLS aggregate assumption is VALID with explicit `payment_activated` application filter (Gate 1, R7)

**Signed:** §8 Assumption 1 holds. The SQL aggregate runs as the authenticated principal via `createSupabaseServerClient()` (the existing pattern; see `app/api/leads/route.ts:38`, `app/api/projects/route.ts:22`). PostgREST executes the query under the session's `auth.uid()`, and the row-level policies on the three tables filter the underlying row sets before `COUNT(*) / SUM()` aggregates fire. Aggregates over zero rows return `0` and `null` respectively in PostgreSQL — both are well-defined and match the JS reference's filter+reduce-on-empty semantics (length 0, reduce-with-initial-0).

**Per-table RLS verification snapshot (migrations 0002, 0005, 0006, 0009):**

| Table | Policy | `admin` | `sales_manager` | `sales` | `pm` | `developer` |
|---|---|---|---|---|---|---|
| `leads` SELECT | `leads_select_sales_scope` | all | all | own (`assigned_to = auth.uid()` OR `created_by = auth.uid()`) | denied (no `pm` branch) | denied (no `developer` branch) |
| `projects` SELECT | `projects_select_mixed_scope` | all | all | only own-lineage (created_by = auth.uid() OR via `source_lead_id` ownership) | all | all |
| `tasks` SELECT | `tasks_select_delivery_scope` (after 0009 fix) | all | denied (no `sales_manager` branch) | denied (no `sales` branch) | all | only `assigned_legacy_user_id = viewer.legacy_mock_id` |

**Critical consequences for the summary endpoint:**

1. `sales_manager` reading the delivery section: tasks policy denies `sales_manager`. The endpoint MUST either (a) omit `delivery.*` from `sales_manager`'s payload, or (b) accept that the aggregate returns 0 for all task counters. Decision: **(a) — the endpoint role-scopes the response payload server-side** (see D6 response shape). `sales_manager` sees the sales section and the project counters (RLS allows project SELECT) but not task-derived counters. The wire field `delivery.actionableTasks` / `delivery.pendingTasks` / `delivery.inProgressTasks` / `delivery.reviewTasks` are `null` for `sales_manager`. The frontend renders `delivery.*` only when the corresponding field is non-null.

2. `developer` reading the delivery section: developer sees only own tasks via `assigned_legacy_user_id` join. Project SELECT allows all, but the task-driven `deriveProjectDisplayStatus` per-project subquery (D2) will see only the developer's own tasks under the project, which means a project visible to developer with no tasks assigned to them will revert to `persistedStatus` — different from what `admin`/`pm` sees for the same project. This is **the existing client-side behavior**: today, `DataProvider` also fetches tasks under the developer's RLS, and `selectDashboardSummary` computes from that narrower set. Parity is preserved by NOT adding a service-layer override.

3. `sales` reading the sales section: same scoping as today (`/api/leads` already returns only own leads under this RLS). Parity is preserved.

**Application-layer filter that RLS does NOT enforce:**

The `payment_activated = true` filter on `projects` (`lib/server/projects/repository.ts:83`) is an application convention, not an RLS policy. The summary endpoint MUST replicate this filter inline in every aggregate that touches `projects`. Backend's pre-merge verification: for the same tenant, `/api/dashboard/summary` returned `delivery.activeProjects` value MUST equal `(GET /api/projects?page=1&limit=100).data` count filtered by `deriveProjectDisplayStatus === 'in_progress'`. The parity test suite (per spec §3.6) verifies this.

**Risk Q7 retired:** RLS is sufficient. No new service-layer role filter is added.

**Why this is safe:**

- The existing list endpoints (`/api/leads`, `/api/projects`, `/api/tasks`) already run their SELECT queries under the same RLS, and KPI parity (the spec's success criterion §14) requires the summary to match `selectDashboardSummary` over whatever rows those list endpoints return. By running the aggregate under the same RLS, the summary matches by construction.
- No new `GRANT` / `REVOKE` is added. No new policy is added.

### D2 — SQL parity for `deriveProjectDisplayStatus` via CTE with task-status booleans (Gate 2, R1)

**Signed:** Option (a) — reproduce the JS rule in SQL. No operator escalation needed. The JS function (`lib/projects/progress.ts:19-46`) has 7 branches over `(persistedStatus, tasks[].status)`; all branches are expressible as a `CASE` over three booleans computed per project: `has_any_tasks`, `all_tasks_done`, `any_review`, `any_in_progress_or_done`. The booleans are computed with `EXISTS` / `NOT EXISTS` / `bool_and` subqueries against `tasks` filtered by `project_id`.

**The exact JS contract (re-anchored from `lib/projects/progress.ts:19-46`):**

```text
1. if tasks.length === 0           → persistedStatus
2. if persistedStatus = 'completed' → 'completed'
3. if persistedStatus = 'delivered' AND every task is done → 'delivered'
4. if any task = 'review'          → 'review'
5. if any task = 'in_progress' OR 'done' → 'in_progress'
6. if persistedStatus IN ('review', 'delivered') → persistedStatus
7. else                            → 'backlog'
```

The branches are ordered; later branches are evaluated only if earlier branches do not match. The SQL `CASE` mirrors the order verbatim.

**SQL — per-project display-status CTE (the parity body Backend uses verbatim, modulo identifier sugar):**

```sql
WITH project_task_facts AS (
  SELECT
    p.id              AS project_id,
    p.status          AS persisted_status,
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.project_id = p.id)                            AS has_any_tasks,
    NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.project_id = p.id AND t.status <> 'done') AS all_tasks_done,
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.project_id = p.id AND t.status = 'review')    AS any_review,
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.project_id = p.id AND t.status IN ('in_progress', 'done')) AS any_in_progress_or_done
  FROM public.projects p
  WHERE p.payment_activated = true
),
project_display_status AS (
  SELECT
    project_id,
    CASE
      -- Branch 1: no tasks at all → use persisted status as-is
      WHEN NOT has_any_tasks
        THEN persisted_status
      -- Branch 2: persisted 'completed' is sticky regardless of tasks
      WHEN persisted_status = 'completed'
        THEN 'completed'::public.project_status
      -- Branch 3: persisted 'delivered' AND every task done → delivered
      WHEN persisted_status = 'delivered' AND all_tasks_done
        THEN 'delivered'::public.project_status
      -- Branch 4: any task in review → review
      WHEN any_review
        THEN 'review'::public.project_status
      -- Branch 5: any task in_progress OR done → in_progress
      WHEN any_in_progress_or_done
        THEN 'in_progress'::public.project_status
      -- Branch 6: fallback to persisted only when it is review or delivered
      WHEN persisted_status IN ('review', 'delivered')
        THEN persisted_status
      -- Branch 7: otherwise backlog
      ELSE 'backlog'::public.project_status
    END AS display_status
  FROM project_task_facts
)
SELECT
  count(*) FILTER (WHERE display_status = 'in_progress') AS active_projects,
  count(*) FILTER (WHERE display_status = 'review')     AS projects_in_review,
  count(*) FILTER (WHERE display_status = 'completed')  AS completed_projects
FROM project_display_status;
```

**Branch-by-branch parity proof (Backend uses this as the test matrix):**

| JS condition | SQL condition | Notes |
|---|---|---|
| `tasks.length === 0` | `NOT has_any_tasks` | `EXISTS` over `project_id` join. |
| `persistedStatus === 'completed'` | `persisted_status = 'completed'` | Direct enum compare. |
| `persistedStatus === 'delivered' AND tasks.every(t => t.status === 'done')` | `persisted_status = 'delivered' AND all_tasks_done` | `all_tasks_done` is `NOT EXISTS (... AND status <> 'done')` — `bool_and` would return `true` on empty too, which would lie when combined with branch 1; the `NOT EXISTS (status <> 'done')` form is `true` for empty (vacuously true) **but branch 1 catches `NOT has_any_tasks` earlier**, so the empty case never reaches branch 3. |
| `tasks.some(t => t.status === 'review')` | `any_review` | `EXISTS`. |
| `tasks.some(t => t.status IN ('in_progress', 'done'))` | `any_in_progress_or_done` | `EXISTS`. |
| `persistedStatus IN ('review', 'delivered')` | `persisted_status IN ('review', 'delivered')` | Direct. |
| else `'backlog'` | `ELSE 'backlog'` | Default. |

**Empty-tasks edge case (R6-relevant):** branch 1 (`NOT has_any_tasks → persisted_status`) MUST evaluate before branch 3. The CTE's `CASE` is ordered top-to-bottom; SQL `CASE` short-circuits in declaration order. Verified by the parity test suite with fixtures: a project with `persisted_status = 'delivered'` AND zero tasks must return `'delivered'`, which branch 1 produces. A project with `persisted_status = 'delivered'` AND 5 tasks all `done` must return `'delivered'`, which branch 3 produces. A project with `persisted_status = 'delivered'` AND 5 tasks where 1 is `in_progress` must return `'in_progress'` (branch 5), not `'delivered'`.

**Critical role-aware caveat (`developer`):** because `tasks` SELECT RLS limits developer to own-assigned tasks, the per-project task subqueries see only the developer's own tasks. A project with 5 tasks total, 1 assigned to developer in `done`, 4 assigned to others in `in_progress`, will:
- For `admin`/`pm`: branch 5 → `in_progress` (because any task is `in_progress`).
- For `developer`: branch 5 → `in_progress` (because the developer's own task is `done`, which is in the `in_progress_or_done` set).
The two readings agree in this case. A project with 5 tasks, 1 done by developer, 4 in `review` by others, will:
- For `admin`/`pm`: branch 4 → `review`.
- For `developer`: branch 5 → `in_progress`.
This divergence is **the existing behavior** (today's client-side computation already shows developer a different summary because their `taskBoardTasks` is RLS-scoped). Parity is preserved by NOT correcting it server-side; this is an Architecture-acknowledged characteristic of the role-scoped view.

### D3 — Single CTE-based composition for all KPIs (Q5)

**Signed:** Single SQL statement using CTEs that combine project task facts (D2) with lead aggregates and task aggregates. One round-trip per `GET /api/dashboard/summary`. PostgREST RPC or `client.rpc('get_dashboard_summary')` — backend choice documented in D6.

**Why single CTE over fan-out (3-5 parallel queries):**

- **Pool pressure**: pilot is 4-person; even at 10× scale, one connection per request beats 5. Vercel serverless cold starts already amplify pool churn.
- **Snapshot consistency**: a single statement sees a single MVCC snapshot. Fan-out can see a lead pipeline that is `pre-mutation` for one query and `post-mutation` for another, producing a self-inconsistent payload (e.g., `wonLeads` incremented but `openLeads` not yet decremented).
- **Error handling**: one try/catch path. Fan-out requires partial-result handling (what does the endpoint return if leads succeed but projects fail?).
- **Query plan**: PG's planner can share scan cost across CTEs. Indexes already present (`idx_leads_status`, `idx_projects_status`, `idx_tasks_project_id`, `idx_tasks_status`) make each aggregate sub-ms at pilot volume.
- **Code shape**: one `lib/server/dashboard/summary-repository.ts` function returning one typed object. Mirrors `lib/server/projects/repository.ts:listProjects` shape.

**Composition sketch (Backend refines):**

```sql
WITH project_task_facts AS (...),    -- per D2
project_display_status AS (...),      -- per D2
lead_facts AS (
  SELECT
    count(*) FILTER (WHERE status NOT IN ('won','lost')) AS open_leads,
    count(*) FILTER (WHERE status = 'won')               AS won_leads,
    coalesce(sum(value) FILTER (WHERE status NOT IN ('won','lost')), 0) AS pipeline_value,
    coalesce(sum(value) FILTER (WHERE status = 'won'),            0) AS total_revenue,
    count(*) FILTER (WHERE status IN ('won','lost'))     AS closed_leads,
    count(*) FILTER (WHERE
      next_follow_up_at IS NOT NULL
      AND next_follow_up_at < now()
      AND status NOT IN ('won','lost')
    )                                                    AS overdue_follow_ups,
    jsonb_object_agg(status, status_count) AS leads_by_status
  FROM public.leads,
       lateral (SELECT count(*) AS status_count) lat
  GROUP BY ()  -- single-row aggregate
),
-- The above leads_by_status sketch is illustrative; backend uses a sub-CTE that
-- groups by status, then aggregates to jsonb to avoid the cross-join trap.
leads_by_status AS (
  SELECT jsonb_object_agg(status::text, count) AS payload
  FROM (
    SELECT status, count(*)::int AS count
    FROM public.leads
    GROUP BY status
  ) sub
),
task_facts AS (
  SELECT
    count(*) FILTER (WHERE status = 'todo')        AS pending_tasks,
    count(*) FILTER (WHERE status = 'in_progress') AS in_progress_tasks,
    count(*) FILTER (WHERE status = 'review')      AS review_tasks
  FROM public.tasks
)
SELECT
  -- Sales section
  lf.open_leads,
  lf.won_leads,
  lf.pipeline_value,
  lf.total_revenue,
  -- Sales extras
  lf.closed_leads,                        -- consumer derives conversion_rate
  lf.overdue_follow_ups,
  lbs.payload AS leads_by_status,
  -- Delivery section (projects)
  count(pds.project_id) FILTER (WHERE pds.display_status = 'in_progress') AS active_projects,
  count(pds.project_id) FILTER (WHERE pds.display_status = 'review')      AS projects_in_review,
  count(pds.project_id) FILTER (WHERE pds.display_status = 'completed')   AS completed_projects,
  -- Delivery section (tasks)
  tf.pending_tasks,
  tf.in_progress_tasks,
  tf.review_tasks
FROM lead_facts lf
CROSS JOIN leads_by_status lbs
CROSS JOIN project_display_status pds
CROSS JOIN task_facts tf
GROUP BY lf.open_leads, lf.won_leads, lf.pipeline_value, lf.total_revenue,
         lf.closed_leads, lf.overdue_follow_ups, lbs.payload,
         tf.pending_tasks, tf.in_progress_tasks, tf.review_tasks;
```

**Backend implementation note:** the above is a sketch — the cross-joins as written would over-count. Backend rewrites as **separate `SELECT INTO` scalars then a single final-row `SELECT`**, OR uses a PL/pgSQL function returning a composite row, OR uses Supabase RPC `get_dashboard_summary()` returning JSON. Decision deferred to Backend; the contract is: **one round trip, one snapshot, all 13 numeric fields plus the `leads_by_status` JSON object computed inside Postgres**. The CTE skeleton in D2 (`project_task_facts` + `project_display_status`) is non-negotiable; the outer composition can vary.

**Conversion rate derivation:** the endpoint returns `closed_leads` and `won_leads` as raw integers; the consumer derives `conversionRate = won_leads === 0 && closed_leads === 0 ? null : round(won_leads / closed_leads * 100)`. Server-side derivation would force a `null` representation across the wire that adds shape complexity; client-side derivation is one line and matches the JS reference exactly.

### D4 — `overdueFollowUps` is count-only on the wire (Q2, Gate 4)

**Signed:** `overdueFollowUps: number` — a single integer count.

**Justification:**

- The dashboard home (`app/dashboard/page.tsx:234-241`) renders only the count. No row preview is shown.
- The current JS computation reads a full list only because it has the full list already in memory (eager-load by-product). Removing the eager-load removes the source.
- Adding a `preview` array adds wire weight (each row carries `id`, `name`, `nextFollowUpAt` minimum — and any consumer would also want `assignedTo` for UX). That's per-row PII transit on a high-frequency endpoint with no consumer.
- The follow-up card already deep-links to `/dashboard/leads`, which has its own overdue-filtered view (the leads list page can paginate the overdue rows independently). The card has a clear escape hatch.

**Reversibility:** if a future operator iteration adds a "top 3 overdue" surface on the dashboard, the contract adds an optional `overdueFollowUpsPreview: LeadPreview[]` field. The current `overdueFollowUps: number` field stays as the count. Forward-compatible.

**Wire field name:** `overdueFollowUps` (camelCase, matching the dashboard home's existing variable name and the JS reference's naming style). NOT `overdue_follow_ups` on the wire — that snake_case form is the internal SQL alias only.

### D5 — Client cache TTL: 60s stale-while-revalidate (Q3)

**Signed:** the provider caches the summary in memory with a 60-second freshness window. On `useDashboardSummary()` access:

- If cached value is < 60s old → return cached, no fetch.
- If cached value is ≥ 60s old → return cached immediately AND fire a background refetch (stale-while-revalidate).
- If no cached value → fetch and return loading state.

**Justification:**

- Dashboard KPIs are not real-time. A 60s ceiling matches the "consciously rough" tolerance for internal-team dashboards.
- Navigation patterns: user lands on `/dashboard`, opens `/dashboard/leads`, returns to `/dashboard` within seconds. Without TTL, every return refetches. With SWR, the return is instant and the next refetch happens in the background.
- The pilot has 4 users; the endpoint cost is irrelevant in absolute terms. The TTL exists for UX (no flash of loading state), not for cost.
- Invalidation events (D6) override the TTL: a mutation that affects KPIs marks the cache stale immediately, regardless of TTL.

**Storage**: in-memory only. No `localStorage` / `sessionStorage` / Service Worker / IndexedDB. The cache lives on the `DataProvider` instance and dies with the page navigation. This is consistent with how `DataProvider` already holds `leads`, `projects`, `tasks` in memory.

**No server-side caching** is added: no Redis, no CDN, no `Cache-Control` headers beyond `no-store` (the current convention for authenticated endpoints in this codebase). The response is per-principal and varies per role; CDN caching would require a vary header on the auth cookie, which is more failure-modes than benefit at pilot scale.

### D6 — Invalidation mechanism: refetch on mutate, debounced 250ms (Q4, Gate 3)

**Signed:** after any of the 15 mutation surfaces enumerated in the spec §3.5 succeeds, the provider calls `refreshDashboardSummary({ force: true })`. Calls within a 250ms window collapse to one fetch (debounce).

**The 15 mutation surfaces (the contract Backend wires into provider):**

Sales (8):
- `addLead`, `updateLead` (when `status` or `value` or `nextFollowUpAt` changes), `deleteLead`, `updateLeadStatus`, `claimLead`, `releaseLeadAsNoResponse`, `addLeadProposal`, `updateLeadProposalStatus`, `createProjectFromProposal`.

Projects (3):
- `addProject` (mock-only), `updateProject` (when `status` changes), `deleteProject` (mock-only), `updateProjectStatus`.

Tasks (4):
- `addTask`, `updateTask` (when `status` changes), `deleteTask` (mock-only), `updateTaskStatus`.

Total: 8 + 4 + 3 = 15 wires. The spec lists 15; the breakdown above sums to 15 inclusive of mock-only handlers that share invalidation hooks (they're idempotent no-ops in supabase mode).

**Why refetch-on-mutate over alternatives:**

| Mechanism | Pro | Con | Verdict |
|---|---|---|---|
| **Refetch on mutate** (chosen) | Simple; impossible to drift from server truth; no JS reimplementation of SQL logic | One extra GET per mutation | Chosen |
| Optimistic patch + reconcile | No GET in the happy path | Requires re-implementing the JS reference (`selectDashboardSummary` + `deriveProjectDisplayStatus`) on the client — exactly what R1 says we MUST NOT do (KPI parity drift is high-severity) | Rejected |
| Polling (e.g., 30s) | No mutation wires needed | Wastes load; stale-on-mutate; user sees lagged numbers | Rejected |
| SWR (stale-while-revalidate without mutate triggers) | Simple | Stale immediately after mutate; user sees old numbers until next focus event | Rejected |
| Hybrid (optimistic + reconcile) | Best UX | Highest implementation risk; doubles the parity test matrix | Rejected for this iteration; reconsider after volume |
| Realtime push (Supabase channels) | Live updates | Requires infra (channels enabled, subscription per surface, fanout), out of spec §4 | Rejected (spec out-of-scope) |

**Why 250ms debounce:**

- The kanban drag-drop in `/dashboard/pipeline` fires a sequence of `updateLeadStatus` calls if a user re-orders multiple cards quickly. Without debounce, each fires an independent summary refetch.
- 250ms is shorter than human-perceptible latency on a mutation echo, so the user does not experience the debounce as a delay.
- The debounce key is the provider instance (one debounce timer per provider). The debounced refetch sees the latest mutation's result because the server is the source of truth — the local mutation handlers have already settled their HTTP responses before the debounced refetch fires.

**Out-of-band mutations explicitly NOT wired (spec §3.5):**

- `POST /api/integrations/website/payment-confirmed` (flips `projects.payment_activated`).
- `POST /api/inbound/pm-queue/[proposalId]/review-webhook`.

The dashboard sees the new state on next provider mount or after the TTL window expires and the SWR refetch fires. Documented as R5 stale-window in the spec. NOT addressed in this iteration. Future iteration may add a Supabase realtime channel or polling probe; pre-authorized but not built.

**`updateLead` invalidation trigger refinement:**

The spec lists `updateLead` "when status or value changes". This ADR extends the trigger to include **`nextFollowUpAt` changes**, because `overdueFollowUps` depends on `next_follow_up_at`. Without this trigger, a user could update a follow-up date and see a stale overdue count for 60s (until TTL expires). The check is local: provider compares pre-mutation and post-mutation lead state; invalidate iff any of `status`, `value`, `nextFollowUpAt` differs.

### D7 — Hook location: inside `DataProvider` (Q1)

**Signed:** the dashboard summary lives on `DataProvider`. A new method `refreshDashboardSummary({ force?: boolean })` and three new state fields are added: `dashboardSummary: DashboardSummary | null`, `isDashboardSummaryLoading: boolean`, `dashboardSummaryError: Error | null`. A new exported hook `useDashboardSummary()` is co-located in `lib/data-context.tsx` (or in a sibling file that imports from it) and returns `{ summary, isLoading, error, refresh }`.

**Justification:**

- The 15 mutation surfaces already live on `DataProvider`. Wiring invalidation requires direct access to mutation handlers. A separate `DashboardSummaryProvider` would require either event-bus coupling or prop-drilling the refresh callback through every mutation surface — both increase coupling versus a single provider.
- Sidebar badges are explicitly NOT consumers of the summary (spec §3.7, §10 R4). The `notifications` badge already lives on its own `/api/notifications` call. No second provider is justified by separation of concerns.
- Operator memory: "Agent usage proportional to scope" — reuse the existing provider rather than introduce a new one for a single page (dashboard home).
- The high-risk file warning (R3) is about adding/changing fields on the provider — that's unavoidable either way; concentrating the change inside one file is easier to review than splitting it across two providers.

**Cleanup affordance:** the summary state is reset to `null` on auth change (sign-out / sign-in), consistent with how `leads` / `projects` / `tasks` are reset today.

### D8 — Module boundaries and file plan

**New files (Backend):**

- `app/api/dashboard/summary/route.ts` — Next.js route handler. Declares `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. Calls `requireRole(['admin', 'sales_manager', 'sales', 'pm', 'developer'])` (all five app roles), invokes the service, returns `NextResponse.json({ data })`. Errors via `toErrorResponse`.
- `lib/server/dashboard/summary-repository.ts` — owns the SQL execution. Exports `readDashboardSummary(client: DatabaseClient): Promise<DashboardSummaryRow>`. Runs the single CTE-based query (D2 + D3). No role logic.
- `lib/server/dashboard/summary-service.ts` — owns role-scoped payload assembly. Exports `getDashboardSummary(client, principal): Promise<DashboardSummaryResponse>`. Calls the repository, applies the `sales_manager`-omits-task-section rule (D1 consequence 1), maps SQL row to wire shape.
- `lib/server/dashboard/serialization.ts` — wire types: `DashboardSummaryResponse`, `DashboardSummarySalesSection`, `DashboardSummaryDeliverySection`, `LeadsByStatus` map type. Plus the corresponding mappers if Architecture decides the SQL row shape differs from the wire shape (likely: SQL uses snake_case, wire uses camelCase).

**New files (Frontend):**

- No new files. The hook lives on `DataProvider` (D7). The wire types are imported from `lib/server/dashboard/serialization.ts` (the wire shape is the same on both sides).

**Modified files:**

- `lib/data-context.tsx` — add summary state, `refreshDashboardSummary`, wire 15 mutation surfaces to call refresh, remove the leads/projects/tasks eager-load from the login `useEffect` (lines 668-716). Mock-mode eager seeding preserved.
- `app/dashboard/page.tsx` — replace `selectDashboardSummary(leads, projectBoardProjects, taskBoardTasks)` with `useDashboardSummary()` in `supabase` mode. Keep `selectDashboardSummary(...)` consumption in `mock` mode (the mock path stays JS-side, the spec confirms).
- `app/dashboard/leads/page.tsx`, `app/dashboard/pipeline/page.tsx`, `app/dashboard/projects/page.tsx`, `app/dashboard/tasks/page.tsx`, `app/dashboard/reports/page.tsx` — add page-mount `useEffect` to trigger `loadLeads(1)` / `refreshProjects()` / `refreshTasks()` if the corresponding provider state is empty AND `authMode === 'supabase'`.

**Responsibility split (locked):**

| Concern | Owner | Not owned by |
|---|---|---|
| SQL composition (CTE shape, `payment_activated` filter, `display_status` derivation) | `lib/server/dashboard/summary-repository.ts` | Not the route handler |
| Role-scoped response assembly (omit `delivery.*` for `sales_manager` when task RLS denies) | `lib/server/dashboard/summary-service.ts` | Not the repository, not the route handler |
| Auth gate (`requireRole`) | `app/api/dashboard/summary/route.ts` | Not the service — the service assumes the principal is already authorized |
| Wire type definitions | `lib/server/dashboard/serialization.ts` | Not `lib/types.ts` (kept local to the dashboard surface; consumers import from the serialization module) |
| Cache + invalidation (TTL, debounce, 15 mutation triggers) | `lib/data-context.tsx` (provider) | Not the hook (`useDashboardSummary` only reads provider state), not the route handler |
| KPI consumer rendering (header, sections, conversionRate calc) | `app/dashboard/page.tsx` | Not the provider — provider exposes numbers, page composes them |
| Per-page lazy loads (`loadLeads(1)`, `refreshProjects()`, `refreshTasks()` on mount) | Each consuming page's `useEffect` | Not the provider (the provider exposes the methods but no longer auto-calls them) |
| Mock-mode parity | Preserved by `lib/dashboard-selectors.ts:selectDashboardSummary` (unchanged) | Not the new endpoint (mock doesn't hit it) |

### D9 — Auth posture and HTTP semantics

The endpoint reuses the canonical pattern from `app/api/leads/route.ts:14`:

```ts
const allowedSummaryRoles = ['admin', 'sales_manager', 'sales', 'pm', 'developer'] as const
```

All five app roles can read the summary. Section visibility (which fields are non-null) is role-derived inside `summary-service.ts` (D8):

- `admin`, `sales_manager`: sales section populated + project counters populated + task counters **`null` for `sales_manager`** (RLS denies tasks SELECT for `sales_manager`).
- `sales`: sales section populated; delivery section's project counters populated for projects on leads the seller owns; task counters **`null`** (RLS denies).
- `pm`, `developer`: delivery section populated; sales section populated **per current `canAccessSales(role)` logic** — `pm`/`developer` see empty sales section today (the dashboard hides the sales cards for them). The summary endpoint still returns sales counters (they aggregate over what RLS shows, which is zero rows for delivery-only roles → counts are 0). The frontend's `canAccessSales(role)` gate decides whether to render them.

**Status mapping:**

| Status | Trigger |
|---|---|
| `200` | Success |
| `401` | No session (via `requireRole` → `AuthGuardError(401)` → `toErrorResponse`) |
| `403` | Session exists but principal is not in the 5 allowed roles (no current consumer hits this; pre-authorized for future role additions) |
| `500` | Repository / service error |

**Response shape (the canonical wire contract):**

```jsonc
{
  "data": {
    "sales": {
      "openLeads": 42,
      "wonLeads": 7,
      "pipelineValue": 125000,
      "totalRevenue": 38000,
      "closedLeads": 11,           // for conversionRate derivation by consumer
      "overdueFollowUps": 3,
      "leadsByStatus": {
        "new": 5, "contacted": 8, "qualified": 6, "proposal": 4,
        "negotiation": 3, "won": 7, "lost": 4
      }
    },
    "delivery": {
      "activeProjects": 12,
      "projectsInReview": 3,
      "completedProjects": 18,
      "pendingTasks": 24,          // null if RLS denies task SELECT (sales_manager / sales)
      "inProgressTasks": 8,        // null when pendingTasks is null
      "reviewTasks": 5,            // null when pendingTasks is null
      "actionableTasks": 32        // pendingTasks + inProgressTasks; null when null
    },
    "checkedAt": "2026-05-22T14:30:00.000Z"
  }
}
```

**Field definitions and JS reference parity:**

| Field | Source | JS reference |
|---|---|---|
| `sales.openLeads` | `count(*) WHERE status NOT IN ('won','lost')` | `lib/dashboard-selectors.ts:490` |
| `sales.wonLeads` | `count(*) WHERE status = 'won'` | `:491` |
| `sales.pipelineValue` | `sum(value) WHERE status NOT IN ('won','lost')` | `:495-497` |
| `sales.totalRevenue` | `sum(value) WHERE status = 'won'` | `:492-494` |
| `sales.closedLeads` | `count(*) WHERE status IN ('won','lost')` | `app/dashboard/page.tsx:64` |
| `sales.overdueFollowUps` | `count(*) WHERE next_follow_up_at < now() AND status NOT IN ('won','lost')` | `app/dashboard/page.tsx:69-79` |
| `sales.leadsByStatus` | `jsonb_object_agg(status, count) GROUP BY status` | `app/dashboard/page.tsx:81-109` |
| `delivery.activeProjects` | `count FILTER (display_status='in_progress')` per D2 | `lib/dashboard-selectors.ts:507-509` |
| `delivery.projectsInReview` | `count FILTER (display_status='review')` per D2 | `:510-512` |
| `delivery.completedProjects` | `count FILTER (display_status='completed')` per D2 | `:513-515` |
| `delivery.pendingTasks` | `count(*) WHERE status='todo'` | `:500` |
| `delivery.inProgressTasks` | `count(*) WHERE status='in_progress'` | `:501` |
| `delivery.reviewTasks` | `count(*) WHERE status='review'` | `:502` |
| `delivery.actionableTasks` | `pendingTasks + inProgressTasks` (server-computed for convenience) | `:519` |

**`checkedAt`:** server-side `now()::text` ISO timestamp. Lets the client detect "the cache holds a 30s-old read" without computing relative time itself; also surfaces in dev tools for debugging.

**`null` vs missing:** when RLS denies a section (task counters for `sales_manager`/`sales`), the wire returns `null` for the affected fields. The frontend renders `delivery.pendingTasks ?? '—'` or skips the card. NOT omitted from the JSON — explicit `null` is honest and the type signature stays stable.

### D10 — Contract surface location

This endpoint serves an internal consumer (the dashboard home in this codebase). The wire contract lives in two places:

1. **`docs/contracts/dashboard-summary.md`** (sibling of this ADR) — the skeleton contract following the `docs/contracts/` convention (entity, lifecycle, role visibility, inputs/triggers, outputs/consumers, cross-refs). No SQL, no route paths.
2. **This ADR §D9** — the full wire shape, status codes, role-scoping rules, parity references.

NoonWeb-side cross-repo contract: **unchanged**. The summary endpoint is App-internal. No entry in `docs/integrations/cross-repo-webhook-v1.md` is needed.

---

## Rationale

### Why a single combined ADR vs five separate ADRs

The five questions and four gates resolve together because each closure depends on the others:

- D1 (RLS posture) decides what the wire payload can carry per role (D9).
- D2 (SQL parity) decides the CTE shape that D3 composes.
- D3 (composition) decides the round-trip count that D5 (cache) hedges against.
- D4 (`overdueFollowUps` shape) sits inside the wire payload defined by D9.
- D6 (invalidation) wires into the mutation surfaces defined by the provider boundary set in D7.
- D7 (hook location) is bounded by the file inventory in D8.

Splitting across five ADRs forces readers to chase cross-references for a single endpoint. The cost of one combined ADR (this file) is one moderately long document; the cost of splitting is five short documents that always need to be read together. Precedent: ADR-017 used the same combined pattern for the migrations-health endpoint.

### Why FULL depth (vs LITE)

Analysis declared depth FULL. This ADR honors that:

- Contracts are non-trivial (15 mutation surfaces, 5 roles, 13 fields, 7-branch SQL parity rule).
- Data model implications exist (`payment_activated` filter parity, RLS posture, role-scoped null fields).
- Cross-cutting concerns (cache, invalidation, hook location) interact and could fail in invisible ways if decided independently.

LITE would have under-specified the role-scoped null handling (D1 consequence 1) and the debounce trigger (D6), both of which are easy to get wrong silently.

### Why no new env vars / no new migration

The endpoint reuses existing RLS, existing tables, existing indexes, existing `createSupabaseServerClient()`, existing `requireRole()`. The `payment_activated` filter is already in `lib/server/projects/repository.ts:83`. No `GRANT`, no `REVOKE`, no new policy. The Infra route in the spec is correctly skipped.

### Why future extensibility is named but not built

Three future extensions are pre-authorized:

1. **Realtime push** for out-of-band mutations (Stripe `payment_confirmed`, PM webhook). Mechanism: Supabase Realtime channel on `projects` and `leads`, provider subscribes and calls `refreshDashboardSummary({ force: true })` on relevant events. Out of scope (spec §4). Pre-authorized: the provider-side refresh method is already the integration point.
2. **`overdueFollowUpsPreview: LeadPreview[]`** field for a dashboard "top 3 overdue" surface. Mechanism: extend the SQL to add a `lateral` subquery returning the 3 most-overdue rows; extend the wire type to include the optional field. The `overdueFollowUps: number` field stays as the count.
3. **Per-role summary caching at edge** (CDN with `Cache-Control: private, max-age=30`). Mechanism: emit cache headers from the route handler. Out of scope at pilot scale; pre-authorized as a single-line addition when load justifies it.

Each is named so the next session has a starting point. None changes this iteration's contract.

---

## Consequences

### Operating

- A single `GET /api/dashboard/summary` per dashboard mount (plus background SWR refetch every 60s when the dashboard is foregrounded). Old behavior: 3 eager fetches (leads + projects + tasks) per mount + per-page navigation. Net reduction in cold-start request count at dashboard mount.
- KPI parity is provable test-by-test (one SQL row vs one JS computation over the same fixtures). The parity test suite is the regression guard.
- The 60s TTL means a user who keeps the dashboard tab open sees auto-refreshing numbers without action.
- `sales_manager` no longer sees task counters (they were always wrong for `sales_manager` because the eager-loaded `taskBoardTasks` returns zero rows under RLS, producing `0` everywhere — visually indistinguishable from "no work yet"). The honest behavior is to surface `null`/`—`, which this iteration introduces.

### Schema

- No migration. No new column, no new policy, no new index. The endpoint composes over existing schema.

### Bundle size

- New server-side files (~3 small files) add < 10KB to the function bundle.
- Frontend: the dashboard page replaces the `selectDashboardSummary` import with `useDashboardSummary`. Net bundle-size change: roughly zero (both are TypeScript modules).

### Audit and observability

- Console error in the route handler on repository failure → standard `toErrorResponse` 500 with no PII leak.
- No new structured logs added in this iteration. If the endpoint becomes hot, Architecture revisits adding `console.info` at debug breadcrumbs (out of scope here).

### Reversibility

- The endpoint is fully reversible at the code level: revert the PRs.
- The provider refactor is **partially reversible** — once the eager-load is removed and per-page lazy loads are wired, reverting the provider alone would break pages that now depend on their own loading. Reverting must include the page-level reverts. The fused chunk 2 (per the spec's chunking decision §13) reflects this.
- The summary endpoint as an additive change (chunk 1) is fully reversible without touching the provider.

### Risk register

| Risk | Mitigation | Status |
|---|---|---|
| R1 — KPI parity drift | D2 (CTE matches JS branch order verbatim) + parity test suite at non-trivial volume (spec §3.6 R6 fixture rule) | Mitigated by design; verified by tests |
| R2 — Invalidation gaps | D6 (15 enumerated mutation surfaces + provider-level test for each) | Mitigated by enumeration |
| R3 — `lib/data-context.tsx` high-risk file | D7 (concentrate the change in one file) + spec's 2-chunk plan (additive endpoint first, behavior change second) | Mitigated by chunking |
| R4 — Hidden provider consumers | Spec §10 R4 enumerated all consumers; sidebar confirmed safe (no `useData()`) | Closed by spec |
| R5 — Out-of-band mutation stale window | D6 (acknowledged, no live push); D5 (60s SWR mitigates) | Acknowledged, not closed |
| R6 — Fixture volume insufficient | Spec §10 R6 fixture rule (≥10 leads / ≥5 projects / ≥10 tasks); D2 parity test matrix uses these | Mitigated by test plan |
| R7 — RLS assumption invalid | D1 (verified against migrations 0002/0005/0006/0009; no service-layer override needed) | **Closed** |
| R8 — `sales_manager` task RLS gap (new, surfaced by D1 analysis) | D1 + D9 (return `null` for task counters when RLS denies; frontend renders `—`) | Mitigated by design |
| R9 — `developer` role sees role-scoped `display_status` divergent from `admin`/`pm` view of same project | D2 (acknowledged characteristic; mirrors current JS behavior) | Acknowledged, not a regression |

R5 is the only risk still open at iteration close; the operator and the spec both accept it.

---

## References

- `specs/fase-3-r3-lazy-load-with-aggregates.md` — Analysis output (this ADR's input).
- `docs/contracts/dashboard-summary.md` — sibling skeleton contract.
- `lib/dashboard-selectors.ts:484-523` — JS reference for parity (`selectDashboardSummary`).
- `lib/projects/progress.ts:19-46` — JS reference for `deriveProjectDisplayStatus` (D2 contract).
- `lib/server/projects/repository.ts:83` — `payment_activated = true` filter parity anchor (D1).
- `lib/data-context.tsx:640-760` — eager-load `useEffect` removed by D8 modification.
- `lib/data-context.tsx:835-1748` — the 15 mutation handlers wired by D6.
- `app/dashboard/page.tsx:33-37` — current `selectDashboardSummary(...)` consumption, replaced by D8 modification.
- `app/api/leads/route.ts:14` — `requireRole(['admin','sales_manager','sales'])` pattern reused by D9.
- `app/api/projects/route.ts:10` — pagination + role-guard pattern.
- `app/api/tasks/route.ts:12` — same.
- `supabase/migrations/0002_phase_2a_leads.sql:58-149` — leads RLS verified by D1.
- `supabase/migrations/0005_phase_2d_projects.sql:84-158` — projects RLS verified by D1.
- `supabase/migrations/0006_phase_2e_tasks.sql:48-115` + `supabase/migrations/0009_phase_2g_tasks_rls_recursion_fix.sql` — tasks RLS verified by D1.
- `docs/api-auth-matrix.md` — auth pattern catalogue (5 mechanisms; D9 uses mechanism 1).
- `docs/runbooks/frontend-redesign-playbook.md` — R3 high-risk file warning honored by D7.
- `docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md` — combined-ADR precedent.
