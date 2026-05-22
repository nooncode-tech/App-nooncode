# R3+ Opción C — Security Scoped Review 2026-05-22

Reviewer: system-security skill (scoped, screening mode).
Iteration: fase-3-r3-lazy-load-with-aggregates (new `GET /api/dashboard/summary` endpoint + supporting service/repository/serialization + migration `0058_phase_22b_dashboard_summary_rpc.sql` + provider wiring in `lib/data-context.tsx`).
Branch: `feature/fase-3-b23-a11y-execution` (per `git status` at session start; iteration scope reviewed as currently staged on this branch).
Migration apply status: confirmed by operator 2026-05-22 — `pg_proc` returned `is_security_definer=false`; GRANTs exactly `postgres` / `authenticated` / `service_role`; no `anon`; no `PUBLIC`.

---

## Scope declared

### IN-SCOPE
1. Auth gate of `app/api/dashboard/summary/route.ts` — authentication required + role check correct.
2. RLS posture of the RPC `get_dashboard_summary()` — assumption confirmed in ADR-020 §D1 (Gate 1).
3. SQL injection surface — RPC takes no user input.
4. Information disclosure via wire payload — role-scoped null masking implementation.
5. Service-layer role-based masking (`lib/server/dashboard/summary-service.ts`).
6. Migration GRANTs / `SECURITY INVOKER` / `search_path` hardening.
7. Frontend wire-data exposure in `lib/data-context.tsx` (summary-related state + lifecycle).

### OUT-OF-SCOPE (explicit per scope freeze)
- General app auth flows, sessions, password hashing.
- Stripe / payment flows.
- Cross-repo NoonWeb integration.
- Anything not new in this iteration (existing audits stand).
- Penetration testing / DAST.
- Performance / DoS (handled by infra layer; no anomaly observed at pilot scale).

---

## Methodology

Static code review against:
- `D:\Pedro\Proyectos\Noon\App-nooncode\app\api\dashboard\summary\route.ts`
- `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\dashboard\summary-repository.ts`
- `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\dashboard\summary-service.ts`
- `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\dashboard\serialization.ts`
- `D:\Pedro\Proyectos\Noon\App-nooncode\supabase\migrations\0058_phase_22b_dashboard_summary_rpc.sql`
- `D:\Pedro\Proyectos\Noon\App-nooncode\lib\data-context.tsx` (summary-related sections only)

Cross-checked against:
- `D:\Pedro\Proyectos\Noon\App-nooncode\docs\adrs\ADR-020-dashboard-summary-aggregates-and-invalidation.md` (§D1 RLS, §D9 auth posture).
- `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-r3-lazy-load-with-aggregates.md` (§10 R7, R5).
- `D:\Pedro\Proyectos\Noon\App-nooncode\docs\api-auth-matrix.md` (precedent: 36 routes use `requireRole`, mechanism 1).
- `D:\Pedro\Proyectos\Noon\App-nooncode\app\api\leads\route.ts`, `app\api\projects\route.ts`, `app\api\tasks\route.ts` (auth pattern parity).
- `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\auth\guards.ts` (`requireRole` → `requirePrincipal` → profile + `is_active` checks).
- `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\api\errors.ts` (`toErrorResponse` envelope: generic 500, no stack leak).
- `D:\Pedro\Proyectos\Noon\App-nooncode\supabase\migrations\0009_phase_2g_tasks_rls_recursion_fix.sql` (tasks RLS — `sales` / `sales_manager` denied; mask logic in service is consistent).
- `D:\Pedro\Proyectos\Noon\App-nooncode\docs\context\project.context.core.md` Supabase Advisor section (operating rules on REVOKE+GRANT canonical pattern, SECURITY DEFINER vs INVOKER, search_path hardening).

No DAST / no penetration test. No production code changes from this skill — findings only.

---

## Findings (severity-ordered)

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

### LOW
None.

### INFORMATIONAL

#### I-1 — Auth gate enumerates all 5 roles
- **Location:** `app/api/dashboard/summary/route.ts:51-57`.
- **Description:** `allowedSummaryRoles = ['admin','sales_manager','sales','pm','developer']` covers every defined app role. Functionally equivalent to "any authenticated principal with active profile", but explicit. `requireRole` still enforces session existence (401), profile existence (403 `PROFILE_NOT_FOUND`), and `is_active` (403 `INACTIVE_PROFILE`) before role membership is checked.
- **Why explicit-list is the right choice (vs `requirePrincipal`):**
  1. Defense-in-depth: if a future app role is added (e.g. `client_portal`, `finance`), it returns 403 by default until the operator explicitly adds it to this list. Allow-list posture, not implicit-allow.
  2. Auditability: the role inventory is visible in the route file without chasing helpers.
  3. Parity with the canonical pattern from `app/api/leads/route.ts:14` and the 36 routes catalogued in `docs/api-auth-matrix.md`.
- **Status:** Working as intended. No action.

#### I-2 — RLS posture verified end-to-end
- **Location:** `supabase/migrations/0058_phase_22b_dashboard_summary_rpc.sql:78-82` declares `language sql / stable / security invoker / set search_path = public, pg_catalog`. Production `pg_proc` returned `is_security_definer=false` per operator confirmation.
- **Description:** The RPC executes under the calling user's `auth.uid()`. The CTE queries `public.leads`, `public.projects`, `public.tasks` directly; row-level policies on those tables (audited per ADR-020 §D1 table against migrations 0002 / 0005 / 0006 / 0009) filter the row sets before `count(*)` / `sum()` aggregate. The `search_path` is pinned to `public, pg_catalog` to neutralize the Supabase Advisor "function search_path mutable" class of finding (proactive hardening — no advisor warning was outstanding).
- **Why it is safe:**
  - `SECURITY INVOKER` is the project's documented default for any RPC callable by the `authenticated` role unless cross-row state-machine privileges are genuinely required (operating rule in `project.context.core.md` Supabase Advisor section). The aggregate has no privileged-write requirement, so `INVOKER` is correct.
  - The Advisor section explicitly lists "Authenticated SECURITY DEFINER RPCs intentionally callable by authenticated" — this RPC is **not** in that list and **must not be migrated** to DEFINER under the current operating constraint.
  - Aggregates over zero rows return `0` for counts and `null` for sums (the service mapper / RPC body `coalesce`-es sums to `0` and the wire mapper coerces `leads_by_status: null → {}`). Documented behavior, not a leak.
- **Status:** Working as intended.

#### I-3 — Migration GRANTs match defense-in-depth posture
- **Location:** `supabase/migrations/0058_phase_22b_dashboard_summary_rpc.sql:197-199`.
- **Description:** `revoke execute ... from public; revoke execute ... from anon; grant execute ... to authenticated;`. Operator-confirmed production state: GRANTs only `postgres` / `authenticated` / `service_role`; explicitly no `anon`; explicitly no `PUBLIC`. `service_role` retains its implicit bypass-RLS access.
- **Why it is safe:** Matches the REVOKE-from-public-and-anon pattern for `authenticated`-callable RPCs. The `SECURITY INVOKER` mode means even if a hostile anon caller bypassed the GRANT (they cannot, but hypothetically), they would still need a valid `auth.uid()` for RLS to allow any row read.
- **Status:** Working as intended.

#### I-4 — SQL injection surface: none
- **Location:** RPC body, `lib/server/dashboard/summary-repository.ts:47`.
- **Description:** The RPC takes zero parameters. The repository invokes `client.rpc('get_dashboard_summary')` with no arguments. No request input touches SQL. PostgREST URL-encodes the function name and the body is empty. The CTE composes only constant identifiers and literal status strings; user-controlled values never enter the SQL plan.
- **Status:** Not applicable; surface is closed by design.

#### I-5 — Information disclosure via wire payload: bounded
- **Location:** `lib/server/dashboard/summary-service.ts:34-41,54-70`; `lib/server/dashboard/serialization.ts:109-164`.
- **Description:** Three role-class behaviors verified:
  1. **`sales_manager` and `sales`:** task counters (`pendingTasks`, `inProgressTasks`, `reviewTasks`, `actionableTasks`) are forcibly `null` via `mapSummaryRowToDeliverySectionTaskMasked`. Even though the underlying RPC aggregate also returns 0 for these roles (RLS denies tasks SELECT), the service layer applies an honest "I can't tell you" signal rather than a misleading `0`. This is the documented ADR §D1 consequence 1 / §D9 behavior — and the masking is implementation-level redundant with RLS (defense-in-depth: even if a future RLS change accidentally exposed a task row to sales_manager, the service-layer mask would still null the wire field).
  2. **`pm` and `developer`:** leads RLS denies these roles (no `pm` / `developer` branch in `leads_select_sales_scope`). The aggregate returns `0` counts and an empty `leads_by_status`. The frontend's `canAccessSales(role)` gate hides the sales cards entirely for these roles. The wire payload still carries zeroes for shape uniformity. Zero is the absence of rows visible to the principal — not the absence of rows in the database — so no information about other roles' data leaks.
  3. **`developer`:** project counters reflect projects + tasks visible under developer's narrower RLS (own-assigned tasks). The per-project `display_status` derivation can diverge from `admin` / `pm` for the same project — explicitly ADR-acknowledged (§D2, R9) as the existing role-scoped behavior. Not a regression. Not an information disclosure (developer sees less, not more).
- **Status:** Working as intended.

#### I-6 — Error envelope does not leak details
- **Location:** `lib/server/api/errors.ts:54-95`.
- **Description:** Repository / RPC failures bubble up via `await readDashboardSummary(client)` → `throw new Error('Failed to read dashboard summary: <pg msg>')` → `toErrorResponse(error)`. The thrown error message is logged inside `Error.message` but the wire 500 response is the generic envelope `{ error: 'Unexpected server error.', code: 'INTERNAL_ERROR' }`. Auth failures bubble `AuthGuardError` which returns its own message (generic, no PII: "An active session is required.", "A user profile row is required for authenticated access.", "This user profile is inactive.", "The authenticated user does not have the required role.").
- **Status:** Working as intended. No SQL or stack trace leaks on the wire.

#### I-7 — Client-side cache is per-provider, per-session
- **Location:** `lib/data-context.tsx:558-574, 808-836, 864-868`.
- **Description:** `dashboardSummary` state is a React `useState` scoped to the `DataProvider` instance. The provider tree is rebuilt on auth change (the effect at line 807 resets the state to `null` and clears `dashboardSummaryFetchedAtRef` when `authMode !== 'supabase'` and on the supabase-branch entry). Sign-out flows through the same effect because `authMode` re-runs. No `localStorage` / `sessionStorage` / `IndexedDB` / Service Worker / cookie persistence of the summary payload. Cross-user leak surface: closed.
- **Status:** Working as intended.

#### I-8 — Caching headers and route runtime are correct
- **Location:** `app/api/dashboard/summary/route.ts:48-49`; `lib/data-context.tsx:751-754`.
- **Description:** Route declares `runtime = 'nodejs'` (required for the Supabase client) and `dynamic = 'force-dynamic'` (no route-segment caching on Vercel's edge). The client fetch uses `cache: 'no-store'` (no fetch-level cache). Since the payload is per-principal (role-scoped masking, RLS-scoped aggregate), any CDN / edge cache between server and client would risk serving one user's payload to another; the `force-dynamic` + `no-store` posture is the correct mitigation.
- **Status:** Working as intended.

#### I-9 — Rate limit / DoS posture: consistent with read-endpoint precedent
- **Location:** Route handler has no explicit rate-limit middleware; matches `app/api/leads/route.ts`, `app/api/projects/route.ts`, `app/api/tasks/route.ts` which also have none. Rate-limiting in this codebase is reserved for high-risk surfaces (webhooks, payments, refunds, public-token endpoints — 11 routes per the grep).
- **Description:** A malicious authenticated principal could spam the endpoint; the SWR debounce + 60s TTL on the client side (`scheduleDashboardSummaryRefetch` + `isDashboardSummaryFresh`) bounds well-behaved consumption. Server-side, the cost is one RPC = one SQL plan over indexed tables (`idx_leads_status`, `idx_projects_status`, `idx_tasks_project_id`, `idx_tasks_status`) at pilot volume. No new risk surface vs the existing read endpoints.
- **Status:** Working as intended at pilot scale; revisit if the endpoint becomes hot.

#### I-10 — `bigint` → JS `number` conversion is safe at pilot scale
- **Location:** `lib/server/dashboard/serialization.ts:19-29` (header comment).
- **Description:** Postgres `bigint` deserializes to JS `number`; sums use `numeric(12,2)` columns (wallet/lead value precision) which fit comfortably in `number`. Counts safe within `Number.MAX_SAFE_INTEGER = 2^53`. Documented in the serialization header.
- **Status:** Documented limitation. Pilot scale fits in 2^53 by 12+ orders of magnitude. Not a security finding.

#### I-11 — R5 stale-window risk (out-of-band server mutations) is operator-accepted
- **Location:** ADR-020 §D6 third paragraph; spec §10 R5; ADR-020 §Risk register R5.
- **Description:** `POST /api/integrations/website/payment-confirmed` (Stripe → flips `projects.payment_activated`) and `POST /api/inbound/pm-queue/[proposalId]/review-webhook` (PM approval) do not invoke the provider's invalidation hook. The dashboard sees the new state on next provider mount or after the 60s TTL expires. The window is bounded and the data inconsistency is benign (numbers lag, not lie about other roles' data). Operator and ADR both accept this risk for the current iteration; pre-authorized as a future Supabase Realtime channel or polling probe.
- **Status:** Accepted risk; not a security finding for this scope.

---

## Verdict for Validator

**GATE-OPEN** — zero CRITICAL, zero HIGH, zero MEDIUM, zero LOW open findings. The new endpoint:
- Authenticates and authorizes correctly against all five app roles using the documented `requireRole` pattern.
- Runs aggregates under the calling user's RLS via `SECURITY INVOKER` — the operating rule for `authenticated`-callable RPCs is honored.
- Applies defense-in-depth null masking at the service layer for `sales` / `sales_manager` task counters even though RLS would also return zero.
- Takes zero user-controlled input into SQL — injection surface closed by design.
- Uses the canonical `toErrorResponse` envelope — no stack / SQL / PII leak.
- Caches per-provider per-session in client memory only — no cross-user leak.
- Declares `dynamic = 'force-dynamic'` + client `cache: 'no-store'` — no edge / CDN cache poisoning surface.
- Migration `0058_phase_22b_dashboard_summary_rpc.sql` matches the documented Supabase Advisor posture (REVOKE from public + anon, GRANT to authenticated, `SECURITY INVOKER`, `set search_path = public, pg_catalog`). Operator-verified in production.

Security gate does not block iteration COMPLETE.

---

## Pre-authorized future work (not required for this iteration)

Two items were explicitly accepted as risk during scope freeze:

1. **Out-of-band mutation stale window (R5).** Stripe `payment-confirmed` and PM webhook flip aggregate inputs without going through the client. The dashboard's 60s TTL plus mutation-debounced invalidation does not cover these surfaces. Future remediation: Supabase Realtime channel on `projects` / `leads`, provider subscribes and calls `refreshDashboardSummary({ force: true })` on relevant events. Pre-authorized; not built in this iteration.

2. **Leaked-password protection (Supabase Auth setting).** Manual Dashboard → Auth → Password Security → HaveIBeenPwned check. Documented in `docs/context/project.context.core.md` Supabase Advisor section as recommended before any external-client exposure. Not a code change. Re-evaluate at next walkthrough.

Neither item is in this iteration's scope or introduced by this iteration's changes.
