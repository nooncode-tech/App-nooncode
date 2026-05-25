# spec.md — fase-2-c-b26-r5-followup-rpc-migration

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-20
- Session ID: `fase-2-c-b26-r5-followup-rpc-migration`
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec). Downstream chain prescribed by router: system-architecture → system-backend → system-testing → system-security → system-infra → system-docs → system-validator. Skipped per router: system-refactor (mechanical adapter+test flip; no debt-prone code emerges), system-audit (no recovery — repo state is fully understood post-B26 merge), system-frontend (no UI; pure JSON endpoint mechanism flip).
- Router mode: Hybrid LITE — Backend-primary + Infra co-sign + system-security mandatory per B26-SEC-F3 pre-authorization (binding constraint from `docs/validations/B26 security review 2026-05-20.md` §S12).
- Depth: **LITE**. Justified because (a) the response shape of `/api/admin/migrations-health` does not change (externally identical); (b) only the underlying read mechanism flips from cross-schema SELECT to RPC call; (c) one new migration (single SECURITY DEFINER function, idempotent CREATE/DROP), one one-line adapter swap, one test fixture flip; (d) no new env var, no contract change, no NoonWeb-side coupling, no UI surface. LITE holds unless architecture's Q1-Q3 resolution surfaces unexpected coupling (escalation path documented in Risks R3).

### OBJECTIVE
- Resolve ADR-017 §R5 ("cross-schema SELECT requires policy surgery") by migrating the migration-health endpoint's ledger read from a direct cross-schema SELECT against `supabase_migrations.schema_migrations` to a `public.list_schema_migrations()` SECURITY DEFINER RPC. The actual failure mode observed in production post-merge was not the anticipated `42501` permission-denied but a PostgREST `db-schemas` exposure restriction (the `supabase_migrations` schema is not in PostgREST's exposed-schemas list, so the supabase-js `.schema('supabase_migrations').from(...)` accessor is rejected before it reaches Postgres permission checks). The user chose **Path B** (RPC SECURITY DEFINER) over Path A (operational schema exposure via Supabase Dashboard) explicitly.
- The motivating evidence is the post-merge R5 verify against production: `GET https://nooncode-app-pi.vercel.app/api/admin/migrations-health` → `500 {"error":"Could not read the schema migrations ledger: Invalid schema: supabase_migrations","code":"MIGRATIONS_READ_FAILED"}`. The defensive `MigrationsLedgerReadError` fired correctly — loud 500, structured error code, no silent false-positive drift. The B26 architecture's defensive ApiError pattern worked as designed; this iteration closes the underlying gap so the endpoint returns 200 + `synced=true` against production.
- The output is the input artifact for system-architecture, which signs Q1 (SECURITY DEFINER hardening posture), Q2 (GRANT scope + REVOKE companion), Q3 (typing strategy for `client.rpc()` return), files ADR-018 (or amends ADR-017 §R5 in-place — architecture decides), and flips ADR-017 §R5 status from "Open until backend smoke confirms" to "Closed — resolved via list_schema_migrations RPC, see ADR-018".

### CONTEXT USED
- `project.context.core.md`: yes — confirmed Operating rules entries documenting the B26 endpoint and the post-merge R5 verify failure. The endpoint behavior is externally documented as "admin-only, 200 when synced, 503 when drift, 500 when reads fail". This iteration preserves all three contracts; only the underlying read mechanism flips.
- `project.context.full.md`: not loaded — LITE depth, mechanism-only flip, no cross-cutting architecture change. Architecture may load it if Q1 (DEFINER hardening) or Q3 (typing strategy) reveal unexpected coupling.
- `project.context.history.md`: not loaded — the relevant history (B26 merge via PR #69, post-merge R5 verify, user's Path B election) is captured in this spec's §Context.
- Reason `full` was excluded: redundant for the bounded scope; the architecture inputs needed (ApiError patterns, supabase-js typing, SECURITY DEFINER conventions) are already documented in B26 artifacts and ADR-017 §D4.
- Reason `history` was excluded: the material continuity is one PR (#69) and one production smoke result; both are captured verbatim in this spec.

### ROUTER DECISION
- Mode: Hybrid LITE — Backend + Infra + Security mandatory per B26-SEC-F3.
- Depth: LITE. Justified above and reinforced by: no schema change beyond one new function, no env var, no wire-contract change, no UI, no observability surface beyond the existing endpoint's defensive errors, no NoonWeb coupling.
- Chain: router (closed) → analysis (now) → architecture → backend → testing → security → infra → docs → validator. Skipped: refactor, audit, frontend.
- Why analysis is the active skill now: nothing downstream can start until (a) the three OPEN questions are surfaced with bounded options so architecture has a closed decision set; (b) the scope boundary is hard enough that backend cannot drift into rewriting the adapter, refactoring `database.types.ts`, or modifying the response shape; (c) the success criterion is observable (post-deploy smoke against production must return 200 + `synced=true` + `ledger_count=54` + `filesystem_count=56`); (d) the B26-SEC-F3 four binding requirements are mapped explicitly to deliverables in this iteration so security review has unambiguous gating criteria.
- Reroute already known at start: no. The chain is single-PR, sequential, no chunking. Escalation paths are documented in Risks (R3 — typing strategy may surface a `database.types.ts` regen need; R4 — DEFINER + search_path hardening may surface other surfaces needing the same treatment).

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules" below.
- Contracts or architecture inputs available:
  - `lib/server/migrations/ledger-adapter.ts` lines 134-149 — current `readLedgerRows()` implementation using `client.schema('supabase_migrations' as never).from('schema_migrations').select('version, name')`. This is the single line that flips to `client.rpc('list_schema_migrations')`.
  - `lib/server/migrations/ledger-adapter.ts` lines 45-50 — `SchemaMigrationsRow` interface (`{ version: string, name: string }`). This interface SHAPE is preserved regardless of Q3 outcome; only the typing strategy at the call site flips.
  - `lib/server/migrations/ledger-adapter.ts` lines 87-96 — `MigrationsLedgerReadError`. Untouched; the existing defensive error handling already covers RPC failure modes (the supabase-js client returns the same `{ data, error }` shape for `.rpc()` as for `.from().select()`).
  - `tests/server/migrations/health.test.ts` — the seven `diffMigrations` edge cases (lines 75-313) are pure-function tests untouched by this iteration. Only the adapter-boundary mock fixture (if any exists currently — see Affected Files §Modified for grounding) flips from mocking `.schema().from().select()` chain to mocking `.rpc()`.
  - ADR-017 §D4 — type-safety decision for `supabase_migrations.schema_migrations`. The current implementation is "inline cast at the call site"; Q3 decides whether the RPC return follows the same strategy.
  - ADR-017 §Risk Register R5 (line 318) — current status "Open until backend smoke confirms". This iteration closes R5 with the resolution path "see ADR-018" (or "amended in-place" — architecture decides).
  - `docs/validations/B26 security review 2026-05-20.md` §S12 — B26-SEC-F3 four binding requirements (standalone iteration spec, standalone migration file, standalone security review, REVOKE+DROP rollback companion). All four are satisfied by this iteration's deliverables (mapped explicitly in §Definition of Done).
  - `supabase/migrations/0050_phase_19d_debit_wallet_for_refund_rpc.sql` — closest reference shape for a SECURITY DEFINER function migration with `GRANT EXECUTE` + `REVOKE` companions. Architecture may cite this as the convention precedent.
- Relevant handoffs received from router:
  - 3 explicit OPEN questions (Q1-Q3) — see "## Open Questions" below.
  - 6 explicit Excluded items that must not creep in (see "### Excluded" below).
  - 12-item Definition of Done (router-locked) — mirrored in §Definition of Done.
  - B26-SEC-F3 four binding requirements with explicit citation paths.
  - Constraint: do not modify the migration file, adapter, tests, or any docs in this skill; spec only.
- External dependencies or environment assumptions:
  - The Supabase project `pdotsdahsrnnsoroxbfe` exposes `public, graphql_public, storage` via PostgREST's `db-schemas` config (the observed failure mode). The new RPC will live in `public`, which PostgREST already exposes — no operational schema exposure change needed.
  - `service_role` has `EXECUTE` permission on functions it owns in `public` by Supabase default, but the migration will GRANT explicitly to be defense-in-depth + idempotent.
  - The supabase-js client's `.rpc()` accessor returns `{ data, error }` with the same error envelope as `.from().select()`. The existing `MigrationsLedgerReadError` defensive wrap continues to work without modification.
  - The PostgREST schema cache reload is automatic on `CREATE FUNCTION` — no operator-driven `NOTIFY pgrst, 'reload schema'` needed. This is confirmed by the precedent of `0048_phase_19b_consolidate_earnings_rpc.sql` and `0049_phase_19c_consolidate_earnings_idempotency_guard.sql`, both of which were callable via `.rpc()` immediately post-deploy without manual cache reload.

### RISK SNAPSHOT
- Known risks before starting: see "## Risks" below (R1-R5).
- Known blockers before starting: none. The Path B election is made by the user; the SECURITY DEFINER pattern is well-precedented in this codebase (0048, 0049, 0050); the test fixture flip is mechanical.
- Known assumptions before starting:
  - The `supabase_migrations.schema_migrations` table row format remains `(version text, name text)` as documented in ADR-017 §D4 and ADR-014. The RPC's `RETURNS setof (version text, name text)` declaration pins this.
  - The Supabase project's `service_role` continues to be the only role that needs ledger read access. Future consumers (deferred internal-token follow-up per ADR-017 §D3) would require an additional GRANT — explicitly out of scope per spec §Excluded.
  - The current 55 disk files + 1 new (this iteration's 0052) = 56 disk files post-merge. Ledger count: current 53 + 1 (this iteration's 0052 inserted as part of `supabase db push`) = 54 ledger rows post-merge. The smoke target `summary.ledger_count=54` and `summary.filesystem_count=56` mirrors this.

### CONTINUITY NOTES
- Previous session relevant: B26 merge via PR #69 (2026-05-20). The endpoint, the adapter, the pure diff function, the `MigrationsBundleConfigError` defensive guard, and `outputFileTracingIncludes` all shipped and are in production. The R5 verify on production triggered the defensive `MIGRATIONS_READ_FAILED` 500 — exactly the failure mode the defensive design anticipated. This iteration completes the loop opened by R5.
- Expected next skill after this session if all goes well: system-architecture closes Q1-Q3, files ADR-018 (or amends ADR-017 §R5), flips ADR-017 §R5 status to "Closed", and hands off to system-backend with: signed SECURITY DEFINER posture, signed GRANT scope + REVOKE companion text, signed typing strategy for `client.rpc()` return.

---

## Task Summary

Ship `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` defining `public.list_schema_migrations()` as a SECURITY DEFINER function returning `setof (version text, name text)` from `supabase_migrations.schema_migrations`. Flip the B26 adapter (`lib/server/migrations/ledger-adapter.ts` `readLedgerRows()`) from the direct cross-schema SELECT to `client.rpc('list_schema_migrations')`. Flip the adapter-boundary test fixture in `tests/server/migrations/health.test.ts` (if such a fixture exists; the seven pure-function `diffMigrations` tests stay untouched). File ADR-018 (or amend ADR-017 §R5 in-place per architecture's call) recording the resolution. Run system-security review of the GRANT scope (mandatory per B26-SEC-F3). Update `docs/context/project.context.core.md` to record the underlying-mechanism flip (response shape externally unchanged). Update `docs/context/project.context.history.md` session note. Update roadmap §17 latest snapshot reflecting R5 closure.

**Externally:** the endpoint behavior of `GET /api/admin/migrations-health` is unchanged. Admin session still required. Response shape identical (`data.synced`, `data.summary.*`, `data.missing_in_ledger`, `data.unexpected_drift_orphans`, `data.grandfathered_collisions`, `data.expected_orphans`, `data.checked_at`). HTTP status mapping identical (200 synced, 503 drift, 500 read failure). The only externally observable difference: production now returns 200 instead of 500.

**Internally:** the SELECT path is replaced by an RPC call. The adapter's defensive `MigrationsLedgerReadError` continues to wrap any RPC failure with the same `MIGRATIONS_READ_FAILED` code. The B26 architecture's defensive ApiError pattern is preserved verbatim.

---

## Scope Boundary

### Included

- **New migration** `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql`:
  - Defines `public.list_schema_migrations()` as a SECURITY DEFINER function.
  - Returns `setof (version text, name text)` populated from `SELECT version, name FROM supabase_migrations.schema_migrations`.
  - Idempotent: `DROP FUNCTION IF EXISTS public.list_schema_migrations();` before `CREATE FUNCTION`.
  - `GRANT EXECUTE ON FUNCTION public.list_schema_migrations() TO service_role;`
  - `REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM PUBLIC;`
  - `REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM anon, authenticated;`
  - Hardened search_path inside function body (`SET search_path = pg_catalog, supabase_migrations` or equivalent — Q1 signs the exact pin).
  - `STABLE` volatility marker (reads no app data, no state mutation).
  - `LANGUAGE sql` or `LANGUAGE plpgsql` — Q1 signs; analysis recommends `sql` because the body is one SELECT.
  - Header comment block citing ADR-017 §R5, ADR-018 (when filed), the four B26-SEC-F3 binding requirements, and a verbatim **REVOKE+DROP rollback companion** in pasteable form.

- **Adapter modification** `lib/server/migrations/ledger-adapter.ts`:
  - `readLedgerRows()` body changes from:
    ```ts
    const { data, error } = await (client as unknown as SupabaseClient)
      .schema('supabase_migrations' as never)
      .from('schema_migrations')
      .select('version, name')
    ```
    to:
    ```ts
    const { data, error } = await client.rpc('list_schema_migrations')
    ```
    (modulo Q3's chosen typing strategy — see Open Questions).
  - The function header comment block referencing ADR-017 §D4 is updated to cite ADR-018 (or amended ADR-017 §R5) as the new source-of-truth for the read mechanism.
  - The `SchemaMigrationsRow` interface (lines 45-50) shape is unchanged. If Q3 selects (b) `Database['public']['Functions']` augmentation, the interface either becomes redundant (delete) or stays as a documentation type (keep). Architecture decides.
  - `MigrationsLedgerReadError` (lines 87-96) is untouched — it already wraps any error returned from supabase-js, RPC or otherwise. The doc comment may be updated to reflect that the error now wraps RPC failures (not cross-schema SELECT failures) as a documentation improvement, but the runtime behavior does not change.
  - The defensive try/catch posture is unchanged. The 500 + `MIGRATIONS_READ_FAILED` failure mode is preserved (now wrapping RPC errors instead of SELECT errors).

- **Test fixture flip** `tests/server/migrations/health.test.ts`:
  - The pure `diffMigrations` and `filenameToSlug` unit tests (lines 75-313) are unchanged. Seven edge-case tests preserved verbatim.
  - If the test file currently contains an adapter-boundary mock that fakes the supabase-js client's `.schema().from().select()` chain, the mock flips to faking `.rpc()`. Analysis notes: a grep of the file at write time shows ONLY pure-function tests (no `readMigrationsHealth` adapter test, no Supabase client mock). If that holds at architecture time, this bullet reduces to "no test fixture flip required, only the adapter's call site changes". Architecture confirms by re-reading the test file. If an adapter-level test does exist, it flips; if not, no test change is required beyond the seven pure-function tests being re-run to confirm they still pass.
  - Re-running the test suite locally must show all tests pass (no regression in the pure-function logic).

- **ADR-018** (architecture decides between two formats):
  - **Option (i):** Standalone ADR file `docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md` recording the Path B election, the SECURITY DEFINER hardening rationale, the GRANT scope decision, and the REVOKE companion. ADR-017 §R5 status flipped to "Closed — see ADR-018".
  - **Option (ii):** In-place amendment of ADR-017 §R5 with a 2026-05-20 dated note describing the resolution, the migration filename, and the REVOKE companion. No new ADR file.
  - Architecture signs which option. Analysis recommends (i) because the rationale is non-trivial (Path A vs Path B trade-off, SECURITY DEFINER hardening, GRANT scope) and a standalone ADR is cleaner to reference from future audits than a buried amendment.

- **Closure documentation:**
  - `docs/context/project.context.core.md` — Operating rules entry updated to reflect that the migration-health endpoint's underlying read mechanism is now `list_schema_migrations()` RPC (externally unchanged behavior; admin-gated; defensive 500 on RPC failure with `MIGRATIONS_READ_FAILED`). **No B-codes, R-codes, Sprint IDs, or plan-IDs per MEMORY rule.**
  - `docs/context/project.context.history.md` — Session note appended documenting B26 merge → post-merge R5 verify → Path B election → this iteration's deliverables. **No B-codes, R-codes, Sprint IDs, or plan-IDs per MEMORY rule.**
  - Roadmap §17 latest snapshot updated to reflect R5 closure (path: `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` per MEMORY rule).

- **system-security review** filed at `docs/validations/B26-R5 security review 2026-05-20.md` (or sibling name — architecture may rename if it clashes with the existing `B26 security review 2026-05-20.md`). Verdict must be **GATE-OPEN**, zero CRITICAL, zero HIGH. This satisfies B26-SEC-F3 binding requirement 3 (standalone security review of GRANT scope).

- **Production smoke after deploy:**
  - Apply migration `0052` to `pdotsdahsrnnsoroxbfe` via `supabase db push` (or Dashboard SQL Editor + manual ledger insert per ADR-014 playbook — operator's choice; backend documents which path used).
  - Confirm ledger row `('0052', 'phase_20b_list_schema_migrations_rpc')` is present.
  - Hit `GET https://nooncode-app-pi.vercel.app/api/admin/migrations-health` with admin session.
  - Expected: 200 + `data.synced=true` + `summary.ledger_count=54` + `summary.filesystem_count=56` + `summary.grandfathered_collisions_count=4` + `summary.expected_orphans_count=6` + `summary.unexpected_drift_count=0`.
  - If smoke fails: do not close iteration. Diagnose, fix, re-smoke.

### Excluded

- **No clean regeneration of `lib/server/supabase/database.types.ts`.** The 4 manual override blocks (seller_fees, prototype_workspaces, lead_proposals, website_webhook_events) carry over from B15 + B26. If Q3 selects option (b) (`Database['public']['Functions']` augmentation), the override surface grows by ONE function entry, not by a regen. If Q3 selects option (a) (inline cast), `database.types.ts` is not touched. **A full clean regen is explicitly deferred to a future iteration.**
- **No NoonWeb-side change.** The endpoint is App-internal. No cross-repo contract surface exists for `/api/admin/migrations-health` (per B26 security review §S10).
- **No new env var.** No new secret. No new public surface. The RPC is in `public` schema but `EXECUTE` is REVOKED from PUBLIC, anon, authenticated, and GRANTED only to `service_role`. The admin gate on the route remains the only caller-facing auth surface.
- **No response shape change** for `/api/admin/migrations-health`. Externally identical. Consumers (future deploy gate, cron probe, dashboard) see no difference.
- **No Path A fallback.** The user chose Path B explicitly. Architecture does NOT entertain "expose `supabase_migrations` schema via Supabase Dashboard `db-schemas` config" as a recoverable option even if Path B encounters friction. If Path B fails empirically, this iteration is BLOCKED and the user re-decides — Path A is not silently substituted.
- **No new public surface.** The RPC name (`list_schema_migrations`) is in `public` schema (Supabase requires RPC functions to be in PostgREST-exposed schemas), but EXECUTE is denied to anon and authenticated. The function is callable only by `service_role`. The admin route gate remains the canonical caller.
- **No remediation logic change.** The endpoint continues to surface drift; the operator continues to remediate per ADR-014 playbook. No automated drift remediation in this iteration.
- **No observability addition.** No new log lines, no new metrics, no new traces. The defensive 500 + `MIGRATIONS_READ_FAILED` continues to surface failures loudly via the existing `toErrorResponse` path.
- **No internal-token consumer path.** The pre-authorized internal-token follow-up per ADR-017 §D3 remains pre-authorized for a future iteration. Not in scope here.
- **No rate-limit addition.** B26-SEC-F2 (LOW finding: no per-route rate-limit) remains accepted as LOW. The admin gate is the only access control.
- **No B-code, R-code, Sprint ID, or plan-ID references in `docs/context/*.md`** per MEMORY rule. The spec filename retains the iteration id; durable docs do not.
- **No chunking.** Single PR, single iteration, single deploy.

---

## Affected Files / Modules

### New files

- `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` — the SECURITY DEFINER function migration. **Contents finalized by architecture's Q1 + Q2 sign-off; backend writes; security reviews; infra applies via `supabase db push`.**
- `docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md` — standalone ADR documenting the Path B election + SECURITY DEFINER hardening + GRANT scope. **Conditional on architecture's choice between (i) standalone ADR-018 and (ii) in-place amendment of ADR-017 §R5.**
- `docs/validations/B26-R5 security review 2026-05-20.md` — standalone security review of the GRANT scope. **Mandatory per B26-SEC-F3 binding requirement 3.** Verdict must be GATE-OPEN, zero CRITICAL, zero HIGH.

### Modified files

- `lib/server/migrations/ledger-adapter.ts` — `readLedgerRows()` function body flipped from `.schema().from().select()` to `.rpc()`. Function header doc comment updated to cite ADR-018 (or amended ADR-017 §R5). `SchemaMigrationsRow` interface either preserved (Q3 option a) or supplemented with `Database['public']['Functions']` augmentation (Q3 option b). `MigrationsLedgerReadError` doc comment updated to reflect RPC failure mode (cosmetic).
- `tests/server/migrations/health.test.ts` — if an adapter-boundary mock exists, flipped from `.schema().from().select()` chain to `.rpc()`. **Pre-confirmed by analysis: the file at spec write time contains only pure-function tests; no adapter mock present.** Architecture re-confirms; if confirmation holds, no test change beyond re-running the suite.
- `docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md` — §R5 status flipped from "Open until backend smoke confirms" to "Closed — see ADR-018" (or "Closed — see in-place amendment dated 2026-05-20"). Architecture signs the exact wording.
- `docs/context/project.context.core.md` — Operating rules entry updated to reflect the underlying-mechanism flip. No B-codes, R-codes, Sprint IDs per MEMORY rule.
- `docs/context/project.context.history.md` — Session note appended. No B-codes, R-codes, Sprint IDs per MEMORY rule.
- `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` §17 — latest snapshot updated to reflect R5 closure (per MEMORY rule on roadmap sync).
- `lib/server/supabase/database.types.ts` — **conditional on Q3 outcome.** If Q3 selects option (b), one additive entry under `Database['public']['Functions']`. If Q3 selects option (a), file untouched.

### Files exercised but NOT modified

- `app/api/admin/migrations-health/route.ts` — the route handler. Untouched. Continues to call `readMigrationsHealth(adminClient)`. The adapter's external contract is preserved verbatim.
- `lib/server/migrations/health.ts` — the pure `diffMigrations` and `filenameToSlug` functions. Untouched.
- `lib/server/migrations/known-exceptions.mjs` — the shared SoT for `KNOWN_COLLISION_FILES` and `EXPECTED_ORPHAN_LEDGER_NAMES`. Untouched.
- `lib/server/auth/guards.ts` `requireRole(['admin'])` — admin gate. Untouched.
- `lib/server/supabase/admin.ts` `createSupabaseAdminClient()` — service-role client. Untouched.
- `lib/server/api/errors.ts` `ApiError`, `toErrorResponse` — error envelope. Untouched. The defensive 500 + `MIGRATIONS_READ_FAILED` path continues to work without modification.
- `scripts/check-migrations.mjs` — the CI script. Untouched.
- `next.config.mjs` — the `outputFileTracingIncludes` for the route's `.sql` bundle. Untouched.

### External systems touched

- Production Supabase project `pdotsdahsrnnsoroxbfe`:
  - Migration `0052` applied. New function `public.list_schema_migrations()` exists.
  - Ledger row `('0052', 'phase_20b_list_schema_migrations_rpc')` present.
  - PostgREST schema cache automatically reloaded post-migration (no operator action).
- Production Vercel deployment at `nooncode-app-pi.vercel.app`:
  - Redeployed with the adapter change.
  - First admin-session smoke must return 200.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `service_role` continues to be the default Supabase service-role identity used by `createSupabaseAdminClient()` | internal | Verified by every existing admin endpoint in production | If the role identity changed silently, the GRANT EXECUTE in migration 0052 would target the wrong role and RPC calls would fail with permission denied | Pre-existing, no action |
| supabase-js `.rpc()` accessor returns `{ data, error }` matching the existing `MigrationsLedgerReadError` wrap pattern | contract | Verified by inspecting supabase-js typings (PostgrestSingleResponse) and by precedent (0048, 0049 RPCs are consumed via `.rpc()` elsewhere in the codebase) | If the return envelope differs, the adapter's destructuring breaks at runtime | Pre-existing, no action |
| PostgREST automatically reloads schema cache on `CREATE FUNCTION` in an exposed schema (`public`) | infra | Verified by precedent (0048, 0049, 0050 all became callable immediately post-deploy) | If cache reload is required manually, the first post-deploy smoke would return "function not found" and operator must run `NOTIFY pgrst, 'reload schema'` | Backend tests on preview deploy first |
| `supabase_migrations.schema_migrations` row format `(version text, name text)` remains stable | contract / data | Pinned to ADR-017 §D4 and ADR-014 verification snapshot | If Supabase changes the row format (extremely unlikely; the Supabase CLI itself depends on it), the RPC's `RETURNS setof (version text, name text)` declaration produces a type mismatch error at function execution | Architecture pins via comment in migration 0052; future Supabase CLI upgrades surface incompatibility as a test failure |
| SECURITY DEFINER + hardened search_path pattern is the canonical Supabase recommendation | infra / security | Documented in Supabase's own docs and PostgreSQL's SECURITY DEFINER hardening guidance | If search_path is not pinned, a future schema-injection attacker who can create objects in `public` could shadow `supabase_migrations` and exfiltrate data | Architecture signs the exact `SET search_path = ...` clause in Q1; security reviews |
| `pdotsdahsrnnsoroxbfe` ledger has 53 rows pre-this-iteration; will have 54 rows post-deploy | data | Confirmed via current production state (B15 closed at 53) + this iteration's 0052 adds row 54 | Smoke target depends on this number being exact | Pre-existing, no action |
| Disk migration file count: 55 pre-this-iteration; 56 post-this-iteration | data | Confirmed via `ls supabase/migrations/ \| wc -l` at spec write time (55 files including 0051) | Smoke target `summary.filesystem_count=56` depends on no other concurrent migration landing | Backend confirms at preview deploy time; if another migration lands concurrently, count is recomputed |

---

## Risks

| # | Risk | Probability | Impact | Severity | Mitigation | Owner question |
|---|---|---|---|---|---|---|
| R1 | **SECURITY DEFINER without search_path pin** — a future attacker with `CREATE` rights on `public` shadows `supabase_migrations` and exfiltrates or corrupts the function's read. This is the canonical SECURITY DEFINER footgun documented by PostgreSQL and Supabase. | Low (requires another vulnerability for the attacker to gain `CREATE ON public`) | High (full SECURITY DEFINER exploit) | Medium | Hardened `SET search_path` clause inside function body, pinned to `pg_catalog, supabase_migrations`. Q1 signs the exact clause. Security review verifies. | Q1 |
| R2 | **GRANT scope leak** — accidentally granting EXECUTE to `anon` or `authenticated` would expose the ledger row list to unauthenticated callers via the supabase-js anon-key client. The list reveals product architecture phase names; severity is bounded by the public repo (B26 security review §S2) but still a posture regression. | Low (explicit REVOKE prevents this; failure mode is misconfiguration) | Medium (info-leak posture regression from admin-only to anon) | Medium | Explicit REVOKE EXECUTE FROM PUBLIC, anon, authenticated **before** GRANT EXECUTE TO service_role. Security review verifies grant scope. B26-SEC-F3 binding requirement 3 enforces this verification. | Q2 |
| R3 | **Typing strategy escalation** — if Q3 selects (b) `Database['public']['Functions']` augmentation, the manual-override surface in `database.types.ts` grows from 4 blocks to 4 blocks + 1 function entry. Probability of escalation: low if architecture follows analysis's recommendation (option a, consistent with ADR-017 §D4). If Q3 selects (b), the clean-regen-debt future iteration absorbs the new entry. | Low | Low | Low | Architecture signs Q3 with the ADR-017 §D4 deferral precedent explicit. Analysis recommends (a) for consistency. | Q3 |
| R4 | **Migration apply path uncertainty** — `0052` can be applied via `supabase db push` (CLI auto-tracks ledger row) OR via Dashboard SQL Editor + manual ledger row insert (per ADR-014 playbook). The first path is preferred; the second is the documented fallback. If the operator uses the second path and forgets the manual insert, the endpoint will subsequently report `0052` as `missing_in_ledger`. | Low-Medium (mirrors the B15 / 0051 manual-apply hazard that motivated B26 in the first place) | Medium (false-positive drift on the very endpoint this iteration is supposed to close) | Medium | Backend documents the apply path used at deploy time in the testing review. If Dashboard path is used, the manual ledger insert is verified before the production smoke. | Backend / Infra |
| R5 | **Path B unexpected friction** — Path B (SECURITY DEFINER RPC) is well-precedented in this codebase (0048, 0049, 0050) but operates against a Supabase-managed schema (`supabase_migrations`). If Supabase has any undocumented restriction on SECURITY DEFINER functions reading from `supabase_migrations` (e.g., the schema is in a restricted catalog), the migration applies but the RPC errors at call time. | Low (no documented restriction; precedent is for functions reading from `public`, not `supabase_migrations`, but standard Postgres permission rules apply) | High (Path B fails; iteration is BLOCKED until either Path A is reconsidered or a different resolution is found) | Medium | Backend tests the migration on a Vercel preview deploy first. If RPC returns an error, defensive `MigrationsLedgerReadError` surfaces it as a structured 500. The user is informed and re-decides — no silent fallback. | Backend (preview smoke); architecture pre-authorizes the BLOCKED outcome if R5 fires |

**Note on B26-SEC-F3 scope:** B26's S12 (the conditional MEDIUM finding) is **realized** by this iteration. The four binding requirements are satisfied as follows:

1. **Standalone iteration spec** → this file (`specs/fase-2-c-b26-r5-followup-rpc-migration.md`).
2. **Standalone migration file** → `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql`.
3. **Standalone security review of GRANT scope** → `docs/validations/B26-R5 security review 2026-05-20.md` (or architecture-signed equivalent path).
4. **Reversible REVOKE+DROP companion** → migration `0052` header comment block (pasteable rollback) AND §Rollback section of this spec.

---

## Open Questions

These questions block ARCHITECTURE, not analysis. Analysis cannot answer them without signing technical decisions that belong to architecture.

### Q1 — SECURITY DEFINER vs SECURITY INVOKER + hardening posture

**Default expectation:** SECURITY DEFINER. Path B's whole premise is bounding privilege to one function instead of granting schema-level access. SECURITY INVOKER would still require the calling role (`service_role`) to have direct schema privileges on `supabase_migrations.schema_migrations`, which defeats the iteration premise.

**Architecture must sign:**
- **DEFINER vs INVOKER**: DEFINER (almost certainly).
- **search_path pin**: `SET search_path = pg_catalog, supabase_migrations` (or equivalent — architecture signs the exact list). This is the canonical SECURITY DEFINER hardening to prevent search_path injection.
- **Volatility marker**: `STABLE` (function reads no app data and does not mutate state; `IMMUTABLE` is too strong because the underlying table can change; `VOLATILE` is too weak because the function is idempotent within a transaction).
- **Language**: `LANGUAGE sql` (analysis recommends; the body is one SELECT) OR `LANGUAGE plpgsql` (acceptable but heavier). Analysis recommends `sql` for simplicity.
- **Function ownership**: the function is owned by the role that executes the migration (`postgres` in Supabase-managed projects). DEFINER runs as the owner — confirm that `postgres` has SELECT on `supabase_migrations.schema_migrations`. Pre-confirmed by analysis: `postgres` is the Supabase super-role and has unrestricted access to all schemas including `supabase_migrations`.

**Recommendation from analysis:** DEFINER + `SET search_path = pg_catalog, supabase_migrations` + `STABLE` + `LANGUAGE sql`. Architecture signs the exact clauses.

### Q2 — GRANT scope + REVOKE companion text

**Default expectation:**
```sql
REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_schema_migrations() TO service_role;
```

**REVOKE+DROP rollback companion** (to be embedded in migration 0052's header comment):
```sql
-- Rollback:
REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM service_role;
DROP FUNCTION IF EXISTS public.list_schema_migrations();
```

**Architecture confirms or refines.** Specifically:
- Should the GRANT include any additional role (e.g., `postgres` for operator manual-call convenience)? Analysis recommends **no** — `postgres` already has implicit access; explicit grant adds noise.
- Should the REVOKE FROM PUBLIC come before or after the function CREATE? In PostgreSQL, EXECUTE is granted to PUBLIC by default on `CREATE FUNCTION` in `public` schema. The REVOKE FROM PUBLIC must run **after** CREATE to be effective. Migration sequence: CREATE → REVOKE FROM PUBLIC → REVOKE FROM anon, authenticated → GRANT TO service_role.

**Recommendation from analysis:** the three-line REVOKE+GRANT block above, exactly as written, with the rollback companion in the header comment. Architecture signs.

### Q3 — Typing strategy for `client.rpc('list_schema_migrations')` return

Three options:

- **(a) Inline cast** (preferred under ADR-017 §D4 deferral precedent): keep `SchemaMigrationsRow` interface co-located in `ledger-adapter.ts`. Cast the RPC call:
  ```ts
  const { data, error } = await client.rpc('list_schema_migrations') as unknown as {
    data: SchemaMigrationsRow[] | null
    error: PostgrestError | null
  }
  ```
  Pros: consistent with ADR-017 §D4 (the existing 4-override-block deferral); zero change to `database.types.ts`; type interface lives next to consumer; easy to delete if endpoint ever retires. Cons: same as ADR-017 §D4 noted — the cast silently lies if Supabase shape changes (very low probability for this stable Supabase-managed schema).

- **(b) `Database['public']['Functions']` augmentation** in `database.types.ts`:
  ```ts
  list_schema_migrations: {
    Args: Record<string, never>
    Returns: { version: string; name: string }[]
  }
  ```
  Pros: type-honest; supabase-js's `.rpc()` autocomplete works; future RPC additions follow the same pattern. Cons: increases the clean-regen surface (4 tables + 1 function); contradicts the ADR-017 §D4 deferral principle. Note: the user's prompt cites "ADR-017 §D9" — there is no §D9 in ADR-017; §D4 is the type-safety decision the prompt refers to.

- **(c) Pragma cast `as any`** — last resort. Analysis does not recommend.

**Recommendation from analysis:** **(a) inline cast**, consistent with ADR-017 §D4 deferral. The `SchemaMigrationsRow` interface stays in `ledger-adapter.ts`. The manual-override surface in `database.types.ts` stays at 4 blocks. Architecture signs.

---

## Assumptions

- The `supabase_migrations.schema_migrations` row format is `(version text, name text)` per ADR-014 verification snapshot and ADR-017 §D4. The RPC's `RETURNS setof (version text, name text)` pins this. If Supabase changes the row format, the migration's function definition must be updated; until then, the format is stable.
- The Supabase project `pdotsdahsrnnsoroxbfe` uses the default PostgREST configuration with `public, graphql_public, storage` exposed via `db-schemas`. This is the observed failure mode for the cross-schema SELECT and the premise for choosing Path B.
- The `service_role` role identity used by `createSupabaseAdminClient()` is the canonical Supabase service-role (`service_role`). Any future change to this identity (e.g., a custom role) would require updating the GRANT in migration 0052.
- The Supabase CLI auto-tracks the ledger row for migration 0052 when applied via `supabase db push`. If the migration is applied via Dashboard SQL Editor (the ADR-014 fallback path), the operator must manually insert the ledger row — analogous to the B15 / 0051 manual-apply path.
- The migration count at smoke time will be `filesystem_count=56` and `ledger_count=54`, derived from current state (55 + 1 = 56; 53 + 1 = 54). If another migration lands concurrently before this iteration's deploy, the smoke target counts are recomputed accordingly.
- The seven `diffMigrations` edge-case tests in `tests/server/migrations/health.test.ts` remain valid against the new RPC-sourced ledger rows. The pure function's contract is invariant to the source of the row data; only the adapter's read mechanism changes.
- Vercel's redeploy of `nooncode-app-pi.vercel.app` will pick up the adapter change after the PR merges to `develop` and the CI deploys. No manual redeploy required.

---

## Chunking Decision

**Single iteration, not chunked.** All five deliverables (migration, adapter flip, test fixture flip, ADR-018, closure docs) are tightly coupled:
- The migration without the adapter flip is dead code (function exists, nothing calls it).
- The adapter flip without the migration is broken code (RPC does not exist at runtime).
- The test fixture flip is mechanical and concurrent with the adapter flip.
- ADR-018 / amendment to ADR-017 §R5 must land alongside the implementation (validator gates on it).
- Closure docs (core.md, history.md, roadmap) must reflect the closed iteration when validator returns COMPLETE.

Estimated effort: ~2-3h total:
- 30min: architecture closes Q1-Q3 + drafts ADR-018.
- 45min: backend writes migration + flips adapter + verifies tests pass locally.
- 30min: testing review reads the change + confirms pure-function tests still pass + confirms adapter mock flip (if needed).
- 20min: security review of GRANT scope (B26-SEC-F3 binding 3).
- 20min: infra applies migration to `pdotsdahsrnnsoroxbfe` + production smoke.
- 20min: docs (core.md, history.md, roadmap, ADR-017 §R5 status flip).
- 15min: validator close-out.

If during architecture R5 materializes (Path B fails on preview deploy with an undocumented Supabase restriction), iteration is BLOCKED. The user re-decides Path A vs alternative resolution; no silent fallback.

---

## Recommended Testing Methodology

**Unit-first against the pure `diffMigrations` function (already in place); plus a one-shot integration smoke against `pdotsdahsrnnsoroxbfe` after deploy.** No new automated tests required.

Justification:
- The pure `diffMigrations` function and its seven edge-case tests are invariant to the read mechanism; they remain valid.
- The adapter flip is a mechanical one-line change. A unit test of the adapter would require mocking the supabase-js client's `.rpc()` accessor; the cost of writing the mock is comparable to the cost of the production smoke, which exercises the real client against the real RPC.
- The production smoke is the integration-shaped validation: hit the endpoint with admin session post-deploy, confirm 200 + `synced=true` + `ledger_count=54` + `filesystem_count=56`. This is a one-shot operator check, captured in the validator's close-out evidence.
- TDD-strict not required — the change is a mechanism flip, not a new behavior.
- BDD inappropriate — no new behavioral scenario.
- CDD inappropriate — no user-visible behavior change.

If the test file currently contains an adapter-boundary mock (analysis pre-confirmed: it does not), the mock flips with the adapter and is re-run as part of `npm test`.

---

## Recommended Route Depth

**LITE.** Justified above. Escalation paths:
- If Q3 selects (b) `Database['public']['Functions']` augmentation AND the augmentation surfaces a broader type regen need, depth escalates to FULL with rationale.
- If R5 materializes (Path B fails empirically on preview), iteration is BLOCKED and the user re-decides — depth does not change; iteration outcome does.
- If architecture's Q1 hardening posture surfaces other SECURITY DEFINER functions in the codebase needing the same treatment, that is a follow-up iteration, not an in-scope escalation here.

---

## Success Criterion

This iteration is **COMPLETE** when **all 12** of the following hold (Definition of Done, router-locked, mirrored from binding inputs):

1. **Spec exists** at `specs/fase-2-c-b26-r5-followup-rpc-migration.md` (this deliverable).
2. **ADR-018 shipped** (or ADR-017 §R5 amended in-place per architecture's call). ADR-017 §R5 status flipped from "Open until backend smoke confirms" to "Closed — see ADR-018" (or "Closed — see in-place amendment dated 2026-05-20").
3. **Migration 0052 exists** at `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` with:
   - SECURITY DEFINER.
   - Hardened search_path (Q1-signed).
   - GRANT EXECUTE to `service_role`.
   - Explicit REVOKE EXECUTE FROM PUBLIC, anon, authenticated.
   - Idempotent `DROP FUNCTION IF EXISTS` before `CREATE FUNCTION`.
   - Header comment with verbatim REVOKE+DROP rollback companion (Q2-signed).
4. **Adapter calls `client.rpc('list_schema_migrations')`** — `lib/server/migrations/ledger-adapter.ts` `readLedgerRows()` updated; cross-schema SELECT removed; typing strategy per Q3 sign-off.
5. **Test fixture flipped** (or confirmed not present); all tests pass locally (`npm test` exit 0).
6. **Security review filed** at `docs/validations/B26-R5 security review 2026-05-20.md` (or architecture-signed equivalent path) with GATE-OPEN verdict, zero CRITICAL, zero HIGH. Satisfies B26-SEC-F3 binding requirement 3.
7. **Migration applied** to `pdotsdahsrnnsoroxbfe` (via `supabase db push` or Dashboard fallback per ADR-014 playbook); ledger row `('0052', 'phase_20b_list_schema_migrations_rpc')` present.
8. **Production smoke passes**: `GET https://nooncode-app-pi.vercel.app/api/admin/migrations-health` with admin session returns:
   - HTTP 200.
   - `data.synced === true`.
   - `data.summary.ledger_count === 54`.
   - `data.summary.filesystem_count === 56`.
   - `data.summary.grandfathered_collisions_count === 4`.
   - `data.summary.expected_orphans_count === 6`.
   - `data.summary.unexpected_drift_count === 0`.
9. **`docs/context/project.context.core.md` updated** — Operating rules entry reflecting the underlying-mechanism flip. No B-codes, R-codes, Sprint IDs per MEMORY rule.
10. **`docs/context/project.context.history.md` updated** — session note appended. No B-codes, R-codes, Sprint IDs per MEMORY rule.
11. **Roadmap §17 updated** — `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` latest snapshot reflects R5 closure per MEMORY rule.
12. **Validator returns COMPLETE**.

**Failure modes that block COMPLETE:**
- If criterion 6 surfaces an unresolved CRITICAL or HIGH finding: iteration is **BLOCKED**. Finding is triaged and either fixed in-iteration or explicitly deferred with a risk register entry; validator does not return COMPLETE.
- If criterion 7 fails (Path B unexpected friction; RPC not callable post-deploy): iteration is **BLOCKED**. User re-decides Path A vs alternative resolution. No silent fallback.
- If criteria 1-8 pass but 9-11 are missing: iteration is **PARTIAL** until documentation lands.

---

## Definition of Done

All 12 success criteria above satisfied. Specifically the four B26-SEC-F3 binding requirements:

1. ✅ Standalone iteration spec → criterion 1.
2. ✅ Standalone migration file → criterion 3.
3. ✅ Standalone security review of GRANT scope → criterion 6.
4. ✅ Reversible REVOKE+DROP companion → criterion 3 (header comment) + §Rollback section below.

---

## Rollback

If migration 0052 must be reverted post-deploy (e.g., R5 materializes, or an unforeseen Supabase restriction surfaces):

**SQL rollback (run as `postgres` or via Dashboard SQL Editor):**
```sql
REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM service_role;
DROP FUNCTION IF EXISTS public.list_schema_migrations();
```

**Application rollback:**
- Revert the adapter change in `lib/server/migrations/ledger-adapter.ts` `readLedgerRows()` back to the cross-schema SELECT (`git revert <commit-sha>` or manual edit).
- The endpoint will return to the pre-iteration state: 500 + `MIGRATIONS_READ_FAILED` on production. The defensive ApiError pattern continues to surface failures loudly.
- ADR-017 §R5 status flips back to "Open".
- ADR-018 (if filed) is marked Superseded with a 2026-MM-DD note explaining the rollback.

**Ledger cleanup:**
- If migration was applied via `supabase db push`, the ledger row `('0052', 'phase_20b_list_schema_migrations_rpc')` must be deleted manually via:
  ```sql
  DELETE FROM supabase_migrations.schema_migrations WHERE version = '0052' AND name = 'phase_20b_list_schema_migrations_rpc';
  ```
- This restores the ledger to 53 rows.

**Rollback verification:**
- Hit `GET /api/admin/migrations-health` with admin session. Expected: 500 + `MIGRATIONS_READ_FAILED` (the pre-iteration production state).
- Confirm `public.list_schema_migrations` no longer exists: `SELECT proname FROM pg_proc WHERE proname = 'list_schema_migrations';` returns 0 rows.

---

## Handoff to system-architecture

system-architecture is the next active skill. Inputs already on disk (this spec). Required outputs from architecture before system-backend can start:

1. **Q1 signed** — SECURITY DEFINER vs INVOKER (expected DEFINER) + exact `SET search_path = ...` clause + volatility marker (`STABLE`) + language (`sql` or `plpgsql`) + function ownership confirmation.
2. **Q2 signed** — GRANT scope (expected: REVOKE FROM PUBLIC + REVOKE FROM anon, authenticated + GRANT TO service_role) + REVOKE+DROP rollback companion exact text for migration 0052 header.
3. **Q3 signed** — typing strategy for `client.rpc('list_schema_migrations')` return (expected: option (a) inline cast, consistent with ADR-017 §D4 deferral) + decision on whether to keep the `SchemaMigrationsRow` interface in `ledger-adapter.ts`.
4. **ADR-018 vs in-place amendment of ADR-017 §R5** — architecture chooses which format. Analysis recommends standalone ADR-018.
5. **R5 escalation pre-authorization** — architecture confirms that if Path B fails on preview deploy (R5 materializes), the iteration is BLOCKED and the user re-decides; no silent Path A substitution.
6. **Migration 0052 file content** drafted by architecture in the ADR (or in a code block within the architecture handoff) so backend writes verbatim. The migration is small enough (~20 lines) that this is a low-cost handoff that prevents drift between ADR rationale and migration text.

When architecture is done: hand off to system-backend with the migration file contents, the adapter change diff (one-line flip), the typing strategy decision, and the doc-comment update text for the adapter's `readLedgerRows()` function.

---

## Recommended testing methodology (handoff field)

**Integration-first with manual production smoke.** The existing pure-function unit tests (`diffMigrations` × 7 edge cases, `filenameToSlug` × 3 cases) remain valid and must pass post-change. No new automated tests required for the adapter flip — the production smoke against `pdotsdahsrnnsoroxbfe` is the integration validation.

---

## Lifecycle

- Status: **Draft** (pending architecture sign on Q1-Q3 + ADR-018 vs amendment decision).
- Moves to **Approved** when architecture closes Q1-Q3 and files ADR-018 (or amends ADR-017 §R5).
- Moves to **Implemented** when validator returns COMPLETE.
- No superseding spec planned.
