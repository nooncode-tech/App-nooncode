# B26-R5 — Security review (`list_schema_migrations` RPC migration)

**Date:** 2026-05-20
**Iteration:** `fase-2-c-b26-r5-followup-rpc-migration` — ADR-017 §R5 follow-up; cross-schema SELECT → `public.list_schema_migrations()` SECURITY DEFINER RPC.
**Reviewer role:** system-security (mandatory gate per LITE-depth chain: analysis → architecture → backend → testing → **security** → infra → docs → validator).
**Depth:** LITE — proportional review for an admin-gated, read-only, internal endpoint with no externally observable contract change. Privilege boundary narrows from "service-role cross-schema SELECT via supabase-js `.schema()` accessor" to "service-role EXECUTE on one SECURITY DEFINER function with hardened search_path". This is a posture improvement, not a regression — but the SECURITY DEFINER pattern, the GRANT scope, the function ownership, and the rollback completeness must be verified explicitly to close the B26-SEC-F3 binding requirement 3.
**Verdict:** **GATE-OPEN. Zero CRITICAL, zero HIGH findings. Two LOW findings recorded for transparency; one informational positive finding noting a defense-in-depth improvement over the precedent (0050).** The B26-SEC-F3 MEDIUM-conditional binding from the prior B26 review **closes** upon this iteration's validator pass.

---

## Scope

The review covers the changes introduced by iteration `fase-2-c-b26-r5-followup-rpc-migration`:

- New migration `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` defining `public.list_schema_migrations()` as a SECURITY DEFINER function.
- Modified `lib/server/migrations/ledger-adapter.ts` — `readLedgerRows()` flipped from cross-schema SELECT to `client.rpc('list_schema_migrations')`. JSDoc updated. `PostgrestError` type import added.
- ADR-018 (`docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md`) — design rationale and verbatim implementation pinning.
- Iteration spec (`specs/fase-2-c-b26-r5-followup-rpc-migration.md`).
- Testing review (`docs/validations/B26-R5 testing review 2026-05-20.md`) — accepted as SUFFICIENT input; the 7-item §Handoff to system-security list scopes this review.

Out of scope:

- Live production smoke against `pdotsdahsrnnsoroxbfe` (system-infra responsibility, post-migration apply).
- Vercel preview-deploy and production smoke against `nooncode-app-pi.vercel.app` (system-infra responsibility, post-deploy).
- Re-review of B26 itself (already covered by `docs/validations/B26 security review 2026-05-20.md`; B26-R5 inherits B26's security posture findings for unchanged surfaces — route handler, auth gate, error-envelope path, bundle inclusion).
- NoonWeb side (this endpoint is App-internal; no cross-repo coupling per ADR-017 §D7).
- Re-litigation of the Path A vs Path B trade-off (the user signed Path B per ADR-018; this review accepts that decision and audits the Path B implementation).

---

## Reference

- **Spec** `specs/fase-2-c-b26-r5-followup-rpc-migration.md` §Scope Boundary → §Included (5 deliverables), §Risks R1-R5, §Success Criterion item 6 (security gate: zero CRITICAL, zero HIGH).
- **ADR-018** `docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md` §D1 (SECURITY DEFINER posture + hardening clauses), §D2 (GRANT scope + REVOKE companion text), §D3 (typing strategy), §D4 (migration file byte-for-byte), §D5 (adapter diff), §Consequences → Reversibility (5-step rollback).
- **Migration** `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` (74 lines, header + transactional body).
- **Adapter** `lib/server/migrations/ledger-adapter.ts` (`readLedgerRows()` at lines 135-153; `MigrationsLedgerReadError` at lines 88-97).
- **Route handler (unchanged)** `app/api/admin/migrations-health/route.ts` — admin gate via `requireRole(['admin'])`.
- **Service-role client (unchanged)** `lib/server/supabase/admin.ts` — `createSupabaseAdminClient()`.
- **Testing review** `docs/validations/B26-R5 testing review 2026-05-20.md` — SUFFICIENT verdict; §Handoff to system-security provides the 7-item focus list this review covers.
- **B26 security review (template + binding source)** `docs/validations/B26 security review 2026-05-20.md` §S12 / B26-SEC-F3 (the four binding requirements this iteration must satisfy).
- **Precedent** `supabase/migrations/0050_phase_19d_debit_wallet_for_refund_rpc.sql` — canonical SECURITY DEFINER + GRANT EXECUTE + REVOKE shape in this repo.

### B26-SEC-F3 binding text (verbatim, for closure traceability)

From `docs/validations/B26 security review 2026-05-20.md` §S12 (the deferred R5 GRANT-migration pre-authorization):

> If preview smoke reveals the service-role lacks SELECT on `supabase_migrations.schema_migrations`, the deferred GRANT migration MUST receive standalone security review of grant scope, reversibility, and role boundary. […]
>
> 1. A standalone iteration spec.
> 2. A standalone migration file (numbered per ADR-006 convention).
> 3. A standalone system-security review of the GRANT scope (which roles, which schemas, which table privileges).
> 4. A migration-side check that the GRANT is reversible (`REVOKE` companion documented in the iteration's rollback plan).

This review closes requirement 3.

---

## Threat-model verifications (S1-S12)

### S1 — GRANT scope minimality + REVOKE sequencing

**Surface:** the GRANT/REVOKE block at `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql:69-71`.

**Verification (by code reading):**

```sql
revoke execute on function public.list_schema_migrations() from public;
revoke execute on function public.list_schema_migrations() from anon, authenticated;
grant  execute on function public.list_schema_migrations() to service_role;
```

- **REVOKE-then-GRANT order is load-bearing, not cosmetic.** PostgreSQL grants EXECUTE to `PUBLIC` by default on `CREATE FUNCTION` in any schema (this is a `CREATE FUNCTION` semantics, not a Supabase semantics; confirmed against PostgreSQL 14+ docs and the same pattern in this repo's 0050). The `REVOKE EXECUTE FROM public` line at L69 must run **after** `CREATE FUNCTION` (line 55, inside the same `begin;/commit;` envelope) to be effective. The actual sequence in the file is correct: `create function` (L55-67) → `revoke … from public` (L69) → `revoke … from anon, authenticated` (L70) → `grant … to service_role` (L71). All four statements are inside the single transaction, so no intermediate visibility window exists where a concurrent caller could `EXECUTE` the function with the default PUBLIC grant intact.
- **Defense-in-depth ladder is well-formed.** Three REVOKE targets ordered most-general → most-specific (`PUBLIC` → `anon` → `authenticated`). Granting then to `service_role` last makes the intent unambiguous. Even if a future operator dropped the `REVOKE FROM PUBLIC` line, the explicit `REVOKE FROM anon, authenticated` would still block the two PostgREST-callable roles that matter for the public-internet surface; even if a future operator dropped the `REVOKE FROM anon, authenticated` line, the `REVOKE FROM PUBLIC` would still block default-grant inheritance for those roles. The two REVOKEs are independently sufficient; together they form belt-and-suspenders defense.
- **No race / partial-apply window.** The `begin;`/`commit;` envelope (lines 51, 73) makes the migration a single transaction. PostgreSQL transactional DDL is atomic — either all four statements (CREATE + 3 GRANT/REVOKE) commit or none do. There is no observable intermediate state where the function exists with default-PUBLIC EXECUTE but the REVOKE hasn't fired yet. The B26-SEC-F3 binding's "load-bearing or cosmetic?" question resolves to **load-bearing for correctness of default-grant scrubbing; cosmetic for race-free-ness (the transaction handles that).**
- **`service_role` is the correct grantee.** `createSupabaseAdminClient()` (`lib/server/supabase/admin.ts:7-17`) passes `env.supabaseServiceRoleKey` to `createClient()`. Supabase's standard JWT-based RLS posture maps the service-role JWT to the `service_role` PostgreSQL role at the PostgREST layer. The only caller of `readMigrationsHealth()` is `app/api/admin/migrations-health/route.ts:48`, which uses the admin client. Therefore `service_role` is the exact and only role that needs EXECUTE, confirmed against repo precedent (every other admin RPC in this repo — 0048, 0049, 0050 — grants only to `service_role`). The grantee scope is minimal.
- **No additional grants.** No `GRANT EXECUTE TO postgres` — correct, because `postgres` owns the function (per S3 below) and inherits implicit EXECUTE rights as owner. Adding a redundant explicit grant would be noise.
- **Comparison to precedent (0050).** 0050 omits `REVOKE EXECUTE FROM PUBLIC` (lines 210-212 only revoke from `anon` and `authenticated`). 0052 **goes further** and explicitly revokes from `PUBLIC` as well. This is a posture **improvement** vs the precedent. The justification (per ADR-018 §D2 "Order rationale") is sound — defense-in-depth in case Supabase ever changes the PUBLIC default for managed projects. Recorded as a positive finding (P1 below) so future RPCs adopt the same three-line pattern.

**Verdict:** **LOW.** GRANT scope is minimal (single grantee). REVOKE sequencing is correct (default-PUBLIC scrubbed before service_role granted). Transaction envelope eliminates race window. Posture is stronger than the existing 0050 precedent. **B26-SEC-F3 binding requirement 3 (standalone security review of GRANT scope) — satisfied for the GRANT scope dimension.**

### S2 — SECURITY DEFINER hardening via pinned `search_path`

**Surface:** the `set search_path = pg_catalog, supabase_migrations` clause at `0052_phase_20b_list_schema_migrations_rpc.sql:63`.

**Verification (by code reading + canonical PG hardening rules):**

- **Canonical SECURITY DEFINER hardening pattern applied.** PostgreSQL's documented SECURITY DEFINER footgun (CVE-class search-path injection) requires that the function pin `search_path` to a known-trusted list at definition time using `SET search_path = …` in the function attributes. If `search_path` is not pinned, the caller's session-level `search_path` is in effect when the function body resolves unqualified identifiers; an attacker who can `CREATE` in any schema reachable via the caller's session-level `search_path` can shadow the function's intended schema objects. The fix is to pin `search_path` in the function attribute list, which overrides the session for the duration of the function call. The 0052 migration applies this exact pattern.
- **The pinned list is correct.** Two schemas in order: `pg_catalog, supabase_migrations`. Rationale per ADR-018 §D1:
  - `pg_catalog` first — required so unqualified built-in references (e.g., implicit casts, type constructors, comparison operators) resolve to the trusted Postgres catalog. Conventional first entry for any hardened SECURITY DEFINER function.
  - `supabase_migrations` second — required so the unqualified `schema_migrations` reference in the function body (line 66: `from supabase_migrations.schema_migrations`) is **already** explicit. Wait — actually the function body **does** schema-qualify the reference (`supabase_migrations.schema_migrations`). The `supabase_migrations` entry in `search_path` is therefore belt-and-suspenders defense, not strictly required for the body to resolve. This is **good** posture: even if a future amendment dropped the schema qualifier in the body (e.g., refactored to `select version, name from schema_migrations`), the pinned `search_path` would still resolve correctly. **Defense survives a future amendment-style mistake.**
  - **`public` is deliberately excluded from the search_path.** This is the key hardening clause. If `public` were in the search_path (e.g., the default `public` setting many functions inherit), a future attacker who can `CREATE` a table named `schema_migrations` in `public` could shadow the body's `supabase_migrations.schema_migrations` reference **only if** the body used unqualified naming. Because the body uses qualified naming AND `public` is excluded from search_path, **two independent defenses** would have to be bypassed simultaneously. The qualified body alone defeats shadow attacks; removing `public` from the search_path defeats them again. Strong belt-and-suspenders posture.
- **Could the function body's `supabase_migrations.schema_migrations` reference be shadow-attacked despite the search_path?** No. The reference is fully schema-qualified at line 66. A schema-qualified identifier in PostgreSQL is resolved by schema lookup, not by `search_path` walk. Even if the entire `search_path` were attacker-controlled, the qualified reference would still bind to `supabase_migrations.schema_migrations` (assuming that schema exists and the function owner has access to it — both true under the DEFINER posture). The `search_path` pin is therefore **defense-in-depth for a hypothetical future un-qualification**, not load-bearing for the current body.
- **`STABLE` + `LANGUAGE sql` are correct hardening choices, not just stylistic.**
  - `STABLE`: the function does not mutate state and returns deterministic results within a transaction. This volatility marker enables the query planner to cache the result within a single transaction, reducing repeat-read load on `supabase_migrations.schema_migrations`. `IMMUTABLE` would be too strong (the underlying table changes over time as migrations land). `VOLATILE` would be too weak (would prevent caching and force re-evaluation in subqueries). Per ADR-018 §D1, this is the correct middle ground.
  - `LANGUAGE sql` (not `plpgsql`): the body is a single SELECT. `sql` has a smaller attack surface than `plpgsql` (no PL/pgSQL interpreter, no procedural control flow, no `EXECUTE … USING` dynamic SQL surface, no `RAISE EXCEPTION` chain). The simpler the function body, the smaller the auditable surface. Per ADR-018 §D1, this is the right choice — `plpgsql` is reserved for control-flow + DML (0048, 0049, 0050 all use `plpgsql` because they have writes and control flow; this function has neither).
- **Why `public` is deliberately excluded from search_path — confirmed.** Per ADR-018 §D1: "Crucially, `public` is **not** in the search_path — any attacker-owned object in `public` cannot shadow." This is the explicit threat model. The exclusion is intentional, documented, and consistent with PostgreSQL's recommended SECURITY DEFINER hardening checklist.

**Verdict:** **LOW.** SECURITY DEFINER hardening is canonical and complete. `search_path` is pinned to a minimal trusted list with `public` deliberately excluded. The function body's schema-qualified reference provides a second independent defense. `STABLE` + `LANGUAGE sql` minimize the function's attack surface. **No search-path-injection vector identified.**

### S3 — Function ownership posture

**Surface:** the function's implicit owner is the role that applies the migration (`postgres` super-role on Supabase-managed projects).

**Verification:**

- **No explicit `ALTER FUNCTION … OWNER TO`.** Confirmed by reading the migration file end-to-end (74 lines): no `ALTER FUNCTION` statement anywhere. The function therefore inherits its owner from the applier role.
- **The applier is `postgres` (Supabase super-role).** Migrations applied via `supabase db push` or via Dashboard SQL Editor both execute as the `postgres` role on Supabase-managed projects (this is the standard Supabase posture; `supabase_admin` and other internal roles exist but the SQL Editor and CLI both authenticate as `postgres` by default). `postgres` has unrestricted access to all schemas, including `supabase_migrations`. This is the correct owner for a DEFINER function that needs to read a Supabase-managed schema.
- **DEFINER inheritance is correct.** The function executes with `postgres` privileges, not the caller's privileges (that is the definition of SECURITY DEFINER). When `service_role` calls `list_schema_migrations()`, the function body's `select … from supabase_migrations.schema_migrations` executes as `postgres`, which has SELECT on `supabase_migrations.schema_migrations` by virtue of being a super-role. The caller (`service_role`) does **not** need direct access to `supabase_migrations.schema_migrations` — that is the whole point of Path B over Path A.
- **Could a later operator accidentally change ownership?** Unlikely. The `postgres` role is the only role with `ALTER FUNCTION … OWNER TO` privilege over a function it owns. Any future ownership change would require explicit operator action via SQL Editor or psql; it cannot happen through migration application or routine Supabase operations. If an operator did change ownership to a less-privileged role (e.g., `authenticator`), the function would start failing at call time because the new owner couldn't read `supabase_migrations.schema_migrations` — failing loudly via `MigrationsLedgerReadError`, not silently. Safe-fail posture.
- **Is implicit ownership acceptable?** Yes, per Supabase precedent. 0048, 0049, 0050 all rely on implicit `postgres` ownership for their SECURITY DEFINER functions; none of them explicitly `ALTER FUNCTION … OWNER TO postgres`. The pattern is standard for this repo.
- **Could the function's DEFINER privilege be coerced into doing more than `SELECT version, name`?** No. The body is hardcoded as a single parameter-less SELECT (lines 65-66). There are no input parameters (the function signature is `list_schema_migrations()` with empty arglist). There is no dynamic SQL (`EXECUTE … USING` is plpgsql-only and this function is `LANGUAGE sql`). There is no `WHERE` clause that could be exploited via parameter injection (no parameters). The function is the minimum possible: a fixed query that returns a fixed shape. The function body is **the entire attack surface** for the DEFINER privilege escalation question, and it is two lines long.

**Verdict:** **LOW.** Implicit `postgres` ownership is correct per Supabase precedent. DEFINER inheritance works as designed (caller's `service_role` does not need direct schema access). No ownership-change risk in the routine operational path. **Function ownership posture acceptable.**

### S4 — Rollback companion completeness

**Surface:** the rollback block in the migration header comment at lines 36-38, plus the ledger cleanup at lines 41-42.

**Verification (by code reading):**

```sql
-- Rollback (run as postgres or via Dashboard SQL Editor):
--   REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM service_role;
--   DROP FUNCTION IF EXISTS public.list_schema_migrations();
```

Plus the ledger-cleanup companion at lines 41-42:

```sql
-- Ledger cleanup if migration was tracked via `supabase db push`:
--   DELETE FROM supabase_migrations.schema_migrations
--    WHERE version = '0052' AND name = 'phase_20b_list_schema_migrations_rpc';
```

- **The rollback is truly reversible.** Step 1 (`REVOKE EXECUTE FROM service_role`) removes the only EXECUTE grant. Step 2 (`DROP FUNCTION IF EXISTS`) removes the function definition. After both steps the database state is identical to the pre-migration state for this function:
  - `pg_proc` no longer has a row for `list_schema_migrations`.
  - `pg_proc.proacl` for any related entry is gone (because the function row is gone).
  - No residual GRANTs to `service_role` or anyone else on this function.
  - The `public` schema is unaffected (the function lived in `public` but was the only artifact this migration added to `public`; no other DDL touched `public`).
- **Pasteable verbatim.** The rollback block is in pasteable SQL form (two statements separated by newline + comment marker). An operator can copy lines 37-38 (stripping the `-- ` prefix) and paste into Dashboard SQL Editor directly. This is the same shape as ADR-018 §D2 ("Rollback companion (verbatim, embedded in migration 0052 header comment)").
- **`DROP FUNCTION IF EXISTS` handles the no-op case.** If the rollback is run when the function never existed (e.g., the migration didn't apply, or rollback is run twice), the `IF EXISTS` guard makes it a no-op. The `REVOKE` line would error (no function to revoke from) if the function never existed, but that error is informational, not state-corrupting; the operator would see "function does not exist" and know the rollback is idempotent at the second step. Order of statements is correct: REVOKE first (while function still exists), then DROP. The opposite order (DROP first) would error on REVOKE because the function would no longer exist.
- **Does rollback leave any orphan state?** Three checks:
  1. **Ledger row.** If migration was tracked via `supabase db push`, the ledger inserts a row into `supabase_migrations.schema_migrations`. The rollback header explicitly addresses this at lines 41-42 with a `DELETE` statement. If migration was applied via Dashboard SQL Editor + manual ledger row insert (the ADR-014 playbook), the operator must run the same `DELETE`. Either way, the rollback is **complete** when both the function drop and the ledger delete are run.
  2. **Dangling GRANT.** `DROP FUNCTION` cascades to all `pg_proc.proacl` entries for that function (PostgreSQL handles this implicitly). No orphan `service_role` GRANT can survive a successful DROP.
  3. **Residual schema-cache entries.** PostgREST caches function metadata in its schema cache. `DROP FUNCTION` triggers an event-trigger that causes PostgREST to auto-reload its cache (same mechanism as `CREATE FUNCTION` — confirmed against precedent 0048-0050 which all reload automatically). After the rollback DDL, the next admin-route hit fails with `function public.list_schema_migrations() does not exist` rather than serving stale cached metadata. Loud failure mode, not silent drift.
- **Application-side rollback (per ADR-018 §Consequences → Reversibility):** the adapter must be reverted in code (revert the commit that flipped `.schema().from().select()` → `.rpc()`). After the SQL rollback alone but without the adapter revert, the endpoint would return 500 + `MIGRATIONS_READ_FAILED` because the RPC no longer exists. After both the SQL rollback and the adapter revert, the endpoint returns to its **pre-iteration** state (500 + the original `Invalid schema: supabase_migrations` from PostgREST). The combined application + database rollback restores the exact pre-iteration system state, not a hybrid state.
- **Is the rollback tested or just documented?** Documented only. Per the testing review §Gap analysis, the full deploy/rollback drill is operator-driven and explicitly out of scope for LITE. This is acceptable for an idempotent, single-function rollback whose SQL is two statements long and whose cascade semantics are standard PostgreSQL. **Risk of an untested rollback is bounded by the rollback's simplicity**; the rollback would be high-risk to leave untested if it involved data migration, multi-table cascades, or schema-version coordination. None of those apply here.

**Verdict:** **LOW.** Rollback is reversible, pasteable, idempotent (via `DROP IF EXISTS`), and addresses both the database artifact (function + GRANTs) and the ledger artifact (the schema_migrations row). Documented-not-tested is acceptable for LITE given the rollback's two-statement simplicity. **B26-SEC-F3 binding requirement 4 (reversible REVOKE companion documented) — satisfied.**

### S5 — No new public surface / env var / secret

**Surface:** any new caller-reachable surface, env var, or shared secret introduced by this iteration.

**Verification:**

- **Function lives in `public` schema — required, but EXECUTE is REVOKED from non-service_role callers.** PostgREST's default `db-schemas` config on this project exposes `public, graphql_public, storage`. Putting the function in `public` is **required** (Path B's entire premise is to avoid widening `db-schemas`; if we put the function in `supabase_migrations`, PostgREST wouldn't be able to call it either). But the GRANT scope (S1) ensures that anon and authenticated callers — the only two roles that can reach PostgREST without service-role credentials — cannot EXECUTE the function. An anon caller hitting `POST https://<project>.supabase.co/rest/v1/rpc/list_schema_migrations` will receive a 401 (per PostgREST's standard behavior when EXECUTE is denied). An authenticated session-holder hitting the same URL will likewise receive 401/403 because their JWT maps to the `authenticated` role, which has no EXECUTE grant.
- **The route handler still requires `requireRole(['admin'])`.** Confirmed by reading `app/api/admin/migrations-health/route.ts:43-55` — first statement inside `try` is `await requireRole(['admin'])` (line 45). The adapter call (line 48) only runs after the admin gate passes. No code path bypasses the admin gate. This is unchanged from B26 (covered by B26-SEC-F1 / B26-SEC-S1 verifications which carry forward to this iteration).
- **No new env var.** Confirmed by grep against the iteration's modified files. The new migration uses no env-substituted values; the adapter change uses no env-substituted values. The `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` env vars used by `createSupabaseAdminClient()` are pre-existing (per `lib/env.ts:getPhase1AAdminEnv()`) and unchanged.
- **No new shared secret.** Confirmed. The migration creates a function; functions are not secrets. The GRANT is to a role identity that already exists. The adapter calls an RPC by name; the name is not a secret (`list_schema_migrations` is in `pg_proc` once the migration applies).
- **PostgREST exposes the function via `/rest/v1/rpc/list_schema_migrations` — but EXECUTE is REVOKE'd from anon/authenticated, so non-service_role callers are rejected at the PostgREST/PostgreSQL layer.** The question raised in the brief — "is that route admin-gated upstream of PostgREST OR do anon/authenticated callers get rejected at the GRANT layer?" — answers with: **rejected at the GRANT layer.** PostgREST will accept the call (the function is in an exposed schema), then call into PostgreSQL with the caller's role (anon JWT → anon role; authenticated JWT → authenticated role), then PostgreSQL will reject the EXECUTE because neither role has the grant. The caller sees a 401/403 (depending on the JWT presented). **No App-side gate is required for this PostgREST-layer rejection to work** — it works purely through the PostgreSQL GRANT system. The App-side admin gate is **additional** defense, not the sole defense.
- **Two-layer defense.** This is important to record clearly:
  - **Layer 1 (Database):** The PostgreSQL GRANT scope blocks anon and authenticated. Even if an attacker bypassed the App entirely and hit `/rest/v1/rpc/list_schema_migrations` directly with an anon or authenticated JWT, they'd get 401/403 from PostgREST.
  - **Layer 2 (Application):** The `/api/admin/migrations-health` route requires `requireRole(['admin'])`. Even if a non-admin authenticated user hit the App's route, they'd be rejected before the adapter calls the RPC.
  - Both layers fail closed. Neither layer alone would be a defense-in-depth violation, but both layers together represent canonical Supabase-on-Next defense-in-depth posture.

**Verdict:** **LOW.** No new env var, no new shared secret. The function is reachable via PostgREST by URL but rejected at the GRANT layer for all non-service_role callers; the App's admin gate is additional defense. **The information-disclosure surface from a JWT-only attacker is zero.**

### S6 — Information-leak posture vs B26 baseline

**Surface:** the response body of `GET /api/admin/migrations-health` and the callability surface of the RPC itself.

**Verification:**

- **Response body of `/api/admin/migrations-health`: unchanged.** Same shape, same content, same status codes. The adapter is invariant on the response body — it returns `SchemaMigrationsRow[]` to the orchestrator, which feeds the pure `diffMigrations` function, which produces the response. The source of `SchemaMigrationsRow[]` flipped (cross-schema SELECT → RPC), but the rows themselves are identical because both sources read the same `supabase_migrations.schema_migrations` table. The response body exposes the same migration filenames (e.g., `0050_phase_19d_debit_wallet_for_refund_rpc.sql`), the same grandfathered collisions, the same expected orphans, the same counts. **No new information leak at the route boundary.**
- **Admin-gate acceptability carries forward from B26-SEC-S2.** Per the B26 security review §S2: the repo is currently public; the migration filenames are already visible in GitHub; an admin session-holder has equivalent access via Supabase Dashboard. The disclosure surface for the route body is unchanged from B26 and remains LOW.
- **Does the function itself, by being callable via `/rest/v1/rpc/list_schema_migrations`, broaden the information-leak surface?** Three sub-questions:
  1. **Anon caller hitting `/rest/v1/rpc/list_schema_migrations` directly:** PostgreSQL rejects with `permission denied for function list_schema_migrations` (errcode 42501). PostgREST returns 401/403 with a generic error body. **No information disclosed beyond what an anon caller already sees from any other denied RPC** (e.g., `debit_wallet_for_refund`, `consolidate_payment_earnings`).
  2. **Authenticated caller (non-admin) hitting the same URL:** same posture as anon — 401/403, no data.
  3. **Service-role caller hitting the same URL directly (bypassing the App):** would receive the same data as the App route. But a service-role attacker has already compromised the deployment secrets; they can read every table in the database directly via the JS client. The RPC adds nothing they couldn't already do. **No marginal disclosure from the RPC's existence.**
- **Function enumeration via PostgREST schema cache.** PostgREST exposes the list of available RPC functions to anon callers via the `/rest/v1/` OpenAPI endpoint (in some Supabase configurations). The function name `list_schema_migrations` would appear in that listing. **However:**
  - The function name alone reveals nothing about migration data. It reveals that the project has migrations (true of every Supabase project) and that someone built a custom RPC to list them. Neither is sensitive.
  - The Supabase OpenAPI exposure is a project-level config; this iteration does not change it.
  - Per the function-enumeration check: anyone enumerating function names already sees `debit_wallet_for_refund`, `consolidate_payment_earnings`, and other admin RPCs. Adding `list_schema_migrations` to that list is consistent with existing posture, not a regression.
- **No `pg_catalog` data leaked via the function.** The function returns only `version` and `name` — two metadata columns. It does not return any pg_catalog rows, role names, system table contents, or PostgreSQL internals. The body is hardcoded SELECT; no shape expansion possible without a new migration.

**Verdict:** **LOW.** Response body unchanged; function-existence disclosure is the same posture as every other admin RPC in this repo; non-service_role callers cannot exfiltrate via the function. **No information-leak regression vs B26 baseline.**

### S7 — Defensive error message content for new failure modes

**Surface:** the `MigrationsLedgerReadError` wraps Supabase RPC error messages into the 500 response body (`lib/server/migrations/ledger-adapter.ts:148-150`). New failure modes introduced by this iteration: (a) `service_role` lost EXECUTE GRANT on `list_schema_migrations`, (b) PostgREST schema cache lag.

**Verification (by code reading + Supabase RPC error format):**

- **Adapter error path is unchanged.** Lines 148-150: `if (error) { throw new MigrationsLedgerReadError(error.message) }`. Same destructuring, same wrap, same `MIGRATIONS_READ_FAILED` code. The only change is the **source** of `error.message`: previously a PostgREST schema-rejection (`Invalid schema: supabase_migrations`), now a PostgreSQL function-call error.
- **Failure mode (a) — lost EXECUTE GRANT on service_role.** Supabase RPC returns a PostgrestError with `message: "permission denied for function list_schema_migrations"` (the standard PostgreSQL 42501 message, formatted by PostgREST). This message reveals:
  - The function name `list_schema_migrations` (already visible in the OpenAPI schema; not sensitive).
  - The PostgreSQL errcode semantics ("permission denied" is the universal error class for GRANT failures).
  - **No credentials, no JWT, no connection string, no role-name beyond what's already public.**
- **Failure mode (b) — PostgREST schema cache lag.** Supabase RPC returns `message: "function public.list_schema_migrations() does not exist"` (PostgREST's standard error for a function call where the schema cache has not yet picked up the new function). This message reveals:
  - The function signature `public.list_schema_migrations()` (already public knowledge once the migration is in the repo).
  - The schema cache state (transient operational metadata).
  - **No credentials, no sensitive data.**
- **Failure mode (c — pre-existing) — transient Supabase outage.** Same posture as B26 covered in B26-SEC-F1 (LOW finding). Standard PostgreSQL errcode messages, no secrets.
- **Standard Supabase RPC error envelope.** Supabase-js `PostgrestError` has fields `{ message, details, hint, code }`. The adapter consumes only `error.message`. It does **not** propagate `details` or `hint` (which could contain query-fragment context for some Postgres errors) into the response body. This is conservative posture — `MigrationsLedgerReadError` constructor at `ledger-adapter.ts:88-97` interpolates only `cause` (which is `error.message`) into its own message string. **The adapter does not leak the full error envelope, just the message string.** This carries forward the B26-SEC-F1 acceptability assessment.
- **Admin-gate acceptability.** Per B26-SEC-F1 (LOW finding): the route is admin-gated; any 500 body is seen only by admin session-holders, who already have Dashboard access to the same diagnostic information. The new failure modes (a) and (b) do not exceed the disclosure envelope established by B26.
- **Could the new failure mode reveal secrets?** Three sub-checks:
  1. **JWT in error message?** No. Supabase-js does not embed the caller's JWT in PostgrestError messages. The JWT is in the request `Authorization` header; PostgreSQL never sees it as a string (it's verified at the PostgREST layer and decoded into a role + claims). No JWT leak path.
  2. **Connection string in error message?** No. The Postgres connection string is held by the supabase-js client (passed to `createClient` in `createSupabaseAdminClient`) and never appears in error messages. Confirmed against multiple admin endpoint error paths in this repo (B15, B26 baseline).
  3. **Service-role key in error message?** No. Same posture as above. The service-role key is the JWT secret used to mint the service-role JWT, held by the env config (`getPhase1AAdminEnv()`). Never appears in error messages.

**Verdict:** **LOW.** New failure modes (a) and (b) introduced by the RPC path produce standard PostgreSQL/PostgREST error messages with no credentials, no connection strings, no JWTs. Disclosure envelope is unchanged from B26's admin-gated baseline. The pre-existing B26-SEC-F1 LOW finding on Supabase-error-text exposure carries forward unchanged. **No new finding on error-message content.**

### S8 — DEFINER privilege escalation surface

**Surface:** the function executes with `postgres` privileges (super-role). What can callers coerce it into doing?

**Verification (by code reading the function body):**

- **Function body is hardcoded, parameter-less, and returns a fixed shape.** Lines 65-66:
  ```sql
  select version, name
  from supabase_migrations.schema_migrations
  ```
  - **No input parameters.** Function signature is `list_schema_migrations()` with empty arglist. A caller cannot pass any value to influence the function's behavior. No SQL-injection surface. No filter, no WHERE clause that depends on caller input.
  - **No dynamic SQL.** `LANGUAGE sql` (not `plpgsql`) — there is no `EXECUTE … USING` construct available. The body is static SQL, parsed and prepared at function-creation time.
  - **No `RAISE EXCEPTION` chain.** No conditional logic. The function either returns rows or fails at the SELECT level (which would be wrapped by `MigrationsLedgerReadError`).
- **The function is the minimum possible.** A caller (`service_role`) can do **exactly one thing**: invoke `list_schema_migrations()` and receive a list of `(version text, name text)` rows. They cannot:
  - Pass a parameter to influence which rows are returned.
  - Cause the function to write to any table (no `INSERT`/`UPDATE`/`DELETE` in the body).
  - Cause the function to read any other table beyond `supabase_migrations.schema_migrations` (the body has no `JOIN`, no subquery).
  - Cause the function to read other rows from `supabase_migrations.schema_migrations` beyond the two columns selected (the SELECT projects exactly two columns; the row count is the entire table, which is `supabase_migrations`-public anyway).
- **Could a future amendment widen the function body?** Yes — but a future amendment **is a new migration** which would re-trigger this security review process. ADR-018 is the source-of-truth for this function's definition; any modification would amend ADR-018 (or supersede with a new ADR) and the binding requirements would apply again. The B26-SEC-F3 binding pattern (standalone spec + migration + security review + reversibility) becomes the **precedent** for any future amendment.
- **Return type pinning at the database boundary.** `RETURNS TABLE (version text, name text)` (lines 56-59) pins the row shape at the function definition. If a future amendment changes the function body to return more columns (e.g., adds `executed_at timestamptz`), the return type declaration would have to change too. The two-column shape is enforced by the database, not just by the application's TypeScript cast. This is a **strong** invariant — the adapter's `SchemaMigrationsRow` type would catch a row-shape mismatch as a runtime error (if the function definition got out of sync with the adapter cast). **Database-side type enforcement is the canonical solution.**

**Verdict:** **LOW.** DEFINER privilege escalation surface is the function body, which is two SQL lines with no parameters, no dynamic SQL, no DML, no JOIN, no caller-controllable input. The minimum possible attack surface for a DEFINER function. **Privilege escalation impossible without a new migration that re-enters the security review process.**

### S9 — Cross-schema visibility via the function

**Surface:** the function reads from `supabase_migrations.schema_migrations`, a Supabase-managed schema. Could this leak other `supabase_migrations.<other_table>` data?

**Verification:**

- **The body is hardcoded to `schema_migrations`.** Line 66: `from supabase_migrations.schema_migrations`. Only one table referenced. The function cannot be coerced into reading `supabase_migrations.seed_files` or any other Supabase-managed table because (a) there are no input parameters, (b) `LANGUAGE sql` has no dynamic SQL, (c) the FROM clause is a literal table reference.
- **Could the function be used as a stepping stone to discover other Supabase-internal schemas?** Three sub-checks:
  1. **Schema enumeration via function existence.** A service_role caller can inspect `pg_catalog` directly (they have super-role-adjacent access in Supabase). The existence of `list_schema_migrations` adds nothing they couldn't already see by querying `pg_proc` directly.
  2. **Schema enumeration via PostgREST OpenAPI.** Per S6, the function name appears in PostgREST's OpenAPI schema for anyone querying it. The presence of `list_schema_migrations` in that schema doesn't reveal anything about `supabase_migrations.<other_tables>` — the function name doesn't expose its body. An attacker would have to call the function (which requires service_role grant), and even then they only see the two-column projection.
  3. **Catalog enumeration via function execution.** The function does not return any pg_catalog rows. It returns rows from `supabase_migrations.schema_migrations` only. Cross-catalog enumeration via the function is impossible.
- **No new exposure for non-service_role callers.** anon/authenticated cannot execute the function (S1). Their schema enumeration surface (via PostgREST OpenAPI) is unchanged — they see the same set of public RPCs they saw before this iteration, plus one additional name (`list_schema_migrations`) which they cannot execute.
- **Service_role's schema enumeration surface is unchanged.** A service_role caller could already read `supabase_migrations.schema_migrations` via direct SQL (super-role-adjacent access) — they just couldn't reach it via the supabase-js client's `.schema()` accessor due to PostgREST's `db-schemas` restriction. The RPC routes around the PostgREST `db-schemas` restriction for one specific table, not for the entire schema. **No new schema-enumeration capability granted to anyone.**

**Verdict:** **LOW.** Function body is single-table, single-projection. No cross-schema leakage. No new enumeration capability beyond what callers already had. **Cross-schema visibility surface is unchanged.**

### S10 — Idempotency / replay

**Surface:** the `DROP FUNCTION IF EXISTS` + `CREATE FUNCTION` pair in the migration body.

**Verification (by code reading):**

- **Migration is idempotent for re-application.** Lines 51-73 wrap `drop function if exists … create function … grants` in `begin;/commit;`. Re-running the migration:
  - DROP succeeds (or no-ops via `IF EXISTS`).
  - CREATE re-creates the function (no stale definition; the DROP scrubbed any prior version).
  - REVOKE statements scrub default-PUBLIC grant on the fresh function.
  - GRANT re-applies EXECUTE to service_role.
  - End state is identical regardless of whether the migration applied once or twice.
- **Could re-running the migration corrupt state?** No. The state-mutating operations are all `pg_proc` modifications (function definition + GRANTs). PostgreSQL handles them atomically inside the transaction. There is no data migration, no table mutation, no row count change.
- **Does the rollback handle the case where the function never existed?** Yes, per S4. `DROP FUNCTION IF EXISTS` is a no-op when the function is absent. The REVOKE line would error (no function to revoke from) but the error is informational and the operator can ignore it.
- **Replay risk during migration apply.** If the operator applies the migration twice (e.g., once via `supabase db push`, once via Dashboard SQL Editor for verification), the DROP+CREATE pair makes both applications idempotent. The ledger would show two rows for `('0052', 'phase_20b_list_schema_migrations_rpc')` only if both apply paths inserted ledger rows; per ADR-014 only `supabase db push` auto-inserts, so the operator running the Dashboard fallback would not duplicate the ledger row. **Ledger-replay risk is bounded by operator discipline, not by the migration content.**
- **Idempotency-vs-side-effect window.** During re-application, the brief window between DROP and CREATE (inside the same transaction) is not observable to concurrent callers because PostgreSQL's transactional DDL holds an ACCESS EXCLUSIVE lock on the function during the transaction. Concurrent calls to `list_schema_migrations()` would block until the transaction commits, then see the new definition. **No observable race window.**

**Verdict:** **LOW.** Migration is idempotent and replay-safe. Rollback is replay-safe. No state-corruption surface. **Idempotency posture acceptable.**

### S11 — Migration apply path security

**Surface:** the migration can be applied via `supabase db push` (CLI auto-tracks ledger) OR via Dashboard SQL Editor + manual ledger row insert (per ADR-014 playbook). Could the Dashboard-only path skip the ledger row and create drift?

**Verification:**

- **Apply path documented in migration header comment.** Lines 40-42:
  ```sql
  -- Ledger cleanup if migration was tracked via `supabase db push`:
  --   DELETE FROM supabase_migrations.schema_migrations
  --    WHERE version = '0052' AND name = 'phase_20b_list_schema_migrations_rpc';
  ```
  This addresses rollback for the `supabase db push` path. The forward-apply via Dashboard requires the operator to also `INSERT INTO supabase_migrations.schema_migrations VALUES ('0052', 'phase_20b_list_schema_migrations_rpc')` manually — this is the ADR-014 playbook and is the operator's responsibility, not the migration's.
- **Could a Dashboard-only apply skip the ledger row and create drift?** Yes — this is the documented G7 hazard from B26 / R5 (the same hazard that motivates the migration-health endpoint in the first place). If the operator pastes the migration body in Dashboard SQL Editor and forgets the manual ledger insert, the next call to `/api/admin/migrations-health` will surface `'phase_20b_list_schema_migrations_rpc'` as `missing_in_ledger` — **and** the call will actually succeed (because the RPC now exists in the DB), so the endpoint flips from 500 + `MIGRATIONS_READ_FAILED` to 503 + `synced=false`. The drift report would catch the operator's mistake **loudly**. Defensive design caught the risk.
- **Is this a security risk?** No. The drift report is loud (the operator sees `synced=false` and the diagnostic arrays). The operator runs the manual ledger insert from the ADR-014 playbook and re-smokes. The endpoint flips to 200 + `synced=true`. **The Dashboard-only path's drift hazard is operationally addressable, not a security risk** — no attacker can exploit a missing ledger row.
- **Infra gates the apply path choice.** Per spec §Affected Files → External systems touched and per the testing review §R5 production-smoke checklist, system-infra is responsible for choosing the apply path and verifying ledger consistency before declaring the migration applied. This review acknowledges the choice is infra's, not security's. **Security-side requirement: the manual ledger insert path must not introduce any data-integrity or auth-related vulnerability.** Confirmed — the manual insert is into `supabase_migrations.schema_migrations`, a Supabase-managed audit table; the inserted row contains only `(version, name)` metadata; no PII; no auth tokens; no executable content.

**Verdict:** **LOW.** Apply-path choice is operationally addressable, not a security vulnerability. The B26 endpoint itself catches missing-ledger-row drift loudly. The manual ledger insert (Dashboard fallback) inserts only metadata. **No security finding on apply-path security.**

### S12 — Closure of B26-SEC-F3 binding

**Surface:** the four B26-SEC-F3 binding requirements from `docs/validations/B26 security review 2026-05-20.md` §S12.

**Verification:**

| # | Binding requirement | Satisfied by | Evidence |
|---|---|---|---|
| 1 | **Standalone iteration spec** | `specs/fase-2-c-b26-r5-followup-rpc-migration.md` | Spec exists on disk; 462 lines; lifecycle status `Draft → Implemented` pending validator. Re-confirmed by reading the file in this review. |
| 2 | **Standalone migration file (numbered per ADR-006 convention)** | `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` | 74 lines; ADR-006 4-digit prefix `0052`; bare slug `phase_20b_list_schema_migrations_rpc`. Re-confirmed by reading the file. Sequential next-in-series after 0051 (B15 website webhook ledger). |
| 3 | **Standalone security review of GRANT scope, reversibility, and role boundary** | **This document.** | GRANT scope verified in S1 (LOW). SECURITY DEFINER hardening verified in S2 (LOW). Function ownership verified in S3 (LOW). Reversibility verified in S4 (LOW). Role boundary verified in S5 (LOW) and S9 (LOW). **All three sub-requirements satisfied with LOW findings.** |
| 4 | **Migration-side check that the GRANT is reversible (`REVOKE` companion documented in the iteration's rollback plan)** | Migration header lines 36-42 (`REVOKE EXECUTE FROM service_role; DROP FUNCTION IF EXISTS …; DELETE FROM supabase_migrations.schema_migrations WHERE …`); ADR-018 §Consequences → Reversibility (5-step rollback); spec §Rollback (lines 408-433). | All three sources document the rollback consistently. Re-confirmed by reading each. |

**All four binding requirements satisfied.** B26-SEC-F3 was recorded in the B26 review as MEDIUM-CONDITIONAL ("does NOT apply to B26 as shipped"). The conditional fires upon R5 materializing; R5 materialized post-merge per ADR-018 §Context. This iteration **realizes** the conditional and satisfies all four requirements.

- **Does this iteration close the binding?** Yes. The MEDIUM-conditional finding becomes RESOLVED upon validator's COMPLETE verdict for this iteration. The next iteration would not inherit B26-SEC-F3 unless a new ledger-read-via-RPC scenario emerges.
- **Future R5-like deferrals from B26 are now resolved.** R5 itself is closed via ADR-018 (ADR-017 §R5 status flips from "Open" to "Closed — see ADR-018"). No other B26-conditional findings depend on R5.
- **No new MEDIUM-conditional binding is introduced by this iteration.** This review introduces zero new conditional findings. The two LOW findings recorded below (F-1, F-2) are unconditional and informational only; they do not bind future iterations.

**Verdict:** **LOW (informational closure).** B26-SEC-F3 is fully discharged. The conditional MEDIUM is RESOLVED, not deferred. **No new conditional bindings introduced.**

---

## Findings

### Positive findings (no severity)

#### P1 — Defense-in-depth improvement over precedent (0050)

**Severity:** None (positive finding).
**Type:** GRANT scope posture improvement.
**Affected:** `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql:69`.

**Description:**
Migration 0052 explicitly `REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM PUBLIC` (line 69). The precedent migration 0050 (`debit_wallet_for_refund`) does **not** include this explicit `REVOKE FROM PUBLIC` (it only revokes from `anon` and `authenticated` at lines 210-211). The 0052 pattern is the more defensive posture: it scrubs PostgreSQL's `CREATE FUNCTION` default PUBLIC grant explicitly, even though the explicit `REVOKE FROM anon, authenticated` would handle the canonical PostgREST callers. The added `REVOKE FROM PUBLIC` is belt-and-suspenders defense if Supabase ever changes the PUBLIC default or if a future Postgres major version changes the semantics of inheritance.

**Outcome:** Recommend adopting the 0052 three-line REVOKE pattern (`PUBLIC` + `anon, authenticated` + `service_role` GRANT) as the canonical shape for all future SECURITY DEFINER migrations in this repo. Update the convention reference in ADR-018 §D2 if not already cited.

#### P2 — Two-layer defense (database + application) explicitly documented

**Severity:** None (positive finding).
**Type:** Defense-in-depth posture documentation.
**Affected:** Combination of `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql:69-71` (database layer) + `app/api/admin/migrations-health/route.ts:45` (application layer).

**Description:**
Per S5 verification: the function is reachable via PostgREST at `/rest/v1/rpc/list_schema_migrations` for anyone with a Supabase JWT, but the GRANT scope rejects all anon and authenticated callers at the PostgreSQL layer (independent of the App). The `/api/admin/migrations-health` App route adds a second defense via `requireRole(['admin'])`. **Both layers fail closed.** Neither is sole — both are required for canonical Supabase-on-Next defense-in-depth posture. The B26-R5 iteration preserves this two-layer pattern verbatim.

**Outcome:** No action required. Recorded for clarity that the App-side admin gate is **additional** defense, not the **sole** defense — the database-layer GRANT scope alone would block PostgREST-direct attacks even if the App route were misconfigured.

### LOW findings

| ID | Severity | Type | Affected Area | Owner | Description | Impact | Evidence | Fix Status | Recommended Reroute |
|---|---|---|---|---|---|---|---|---|---|
| B26-R5-SEC-F1 | LOW | error exposure (carryover from B26-SEC-F1) | `lib/server/migrations/ledger-adapter.ts` `MigrationsLedgerReadError` (lines 88-97) | system-backend (future) | The 500 body for `MIGRATIONS_READ_FAILED` interpolates raw Supabase error text. Carried forward from B26-SEC-F1; new failure modes from this iteration (permission denied on the RPC; function-not-found on schema-cache lag) produce standard PostgreSQL/PostgREST messages with no credentials, no JWT, no connection string. Disclosure envelope unchanged from B26's admin-gated baseline. Acceptable today given the admin gate; if ADR-017 §D3 internal-token follow-up activates a broader consumer base, sanitize to a generic message while logging the verbose text server-side. | Disclosure of Postgres-level error semantics (function name, errcode 42501 text) to whatever role can pass the gate. With admin gate: equivalent to Dashboard access. | `lib/server/migrations/ledger-adapter.ts:88-97`, `app/api/admin/migrations-health/route.ts:52-54`. | Open (informational; no action required for this iteration). Carries forward from B26. | None — flagged forward for the ADR-017 §D3 internal-token follow-up iteration. |
| B26-R5-SEC-F2 | LOW | rate-limit / DoS posture (carryover from B26-SEC-F2) | `app/api/admin/migrations-health/route.ts` | system-infra (future) | Endpoint remains admin-only without a per-route rate-limit. The RPC path (`list_schema_migrations`) is cheaper per call than the prior cross-schema SELECT (one function call vs one row-set transfer through PostgREST), so this iteration **reduces** the per-call cost slightly. Authenticated-admin-driven DoS is still bounded by Supabase's per-project ceiling and Vercel's function timeout, but no in-app guard exists. Carries forward unchanged from B26-SEC-F2. | Authenticated admin can saturate the endpoint at high concurrency. Cost: cheaper than B26. | No `Ratelimit` import in route or adapter; no project-level `middleware.ts`. | Open (acceptable for LITE; revisit when ADR-017 §D3 follow-up materializes a non-admin consumer). | None for this iteration. The R5 / D3 follow-up should consider per-route rate limiting when the consumer base widens. |

### MEDIUM, HIGH, CRITICAL findings

**None.**

The S1-S12 threat-model verifications all resolved to LOW or informational. The B26-SEC-F3 MEDIUM-conditional binding from the prior B26 review **closes** upon this iteration's validator pass — see S12. **No new MEDIUM, HIGH, or CRITICAL findings are introduced by this iteration.**

---

## Conditions for passing the security gate

Per spec §Success Criterion item 6 ("zero CRITICAL and zero HIGH findings; MEDIUM explicitly accepted or addressed in-iteration"):

- ✅ Zero CRITICAL findings.
- ✅ Zero HIGH findings.
- ✅ Zero MEDIUM findings.
- ✅ B26-SEC-F3 MEDIUM-conditional binding **closes** (S12); not deferred forward.
- ✅ GRANT scope is minimal (single grantee: `service_role`); REVOKE sequencing scrubs default-PUBLIC before granting (S1).
- ✅ SECURITY DEFINER hardening via pinned `search_path = pg_catalog, supabase_migrations` (no `public` in the path); schema-qualified body provides second independent defense (S2).
- ✅ Function ownership posture acceptable; implicit `postgres` owner per Supabase precedent (S3).
- ✅ Rollback companion documented; reversible; pasteable verbatim from the migration header (S4).
- ✅ No new env var, no new shared secret, no new public surface; two-layer defense preserved (S5).
- ✅ Information-leak posture unchanged from B26 baseline; response body identical; function-existence disclosure consistent with existing admin RPCs (S6).
- ✅ Defensive error message content for new failure modes (permission-denied, function-not-found, schema-cache-lag) carries no credentials and is admin-gate-acceptable (S7).
- ✅ DEFINER privilege escalation surface is the function body — two SQL lines, parameter-less, no dynamic SQL, no DML (S8).
- ✅ Cross-schema visibility limited to one column projection from one table; no enumeration capability added (S9).
- ✅ Idempotency / replay-safety verified (DROP IF EXISTS + CREATE inside `begin;/commit;`) (S10).
- ✅ Apply-path security: Dashboard fallback's drift risk is operationally addressable via the very endpoint this iteration restores; not a security risk (S11).
- ✅ B26-SEC-F3 four binding requirements all satisfied; conditional MEDIUM **resolved** (S12).

**Gate verdict:** **GATE-OPEN.** system-infra may proceed to apply the migration and run the production smoke.

---

## Production-readiness judgment

The iteration as shipped (migration 0052 + adapter flip + ADR-018) is **production-ready from a security posture standpoint**:

- **Privilege boundary narrows vs B26 baseline.** Pre-iteration: service_role had unrestricted cross-schema SELECT via `.schema()` accessor (rejected by PostgREST `db-schemas` but conceptually unrestricted). Post-iteration: service_role can EXECUTE one specific SECURITY DEFINER function with hardened search_path and a single-table, single-projection body. This is a **posture improvement**, not a regression.
- **Two-layer defense preserved.** Database-layer GRANT scope (S1) + Application-layer admin gate (S5/P2). Both fail closed.
- **Defense-in-depth strengthens over precedent.** 0052 explicitly REVOKEs from PUBLIC; 0050 does not. Recommend adopting the 0052 pattern as the canonical shape (P1).
- **No new env var, no new secret, no PII touched.** All env-var and secret surfaces are unchanged from B26.
- **Rollback is reversible and pasteable.** Two SQL statements; idempotent; addresses both database artifact and ledger artifact.
- **B26-SEC-F3 binding closes.** The MEDIUM-conditional from B26 is RESOLVED, not deferred forward.

The system-infra production smoke against `pdotsdahsrnnsoroxbfe` is the remaining empirical validation. From a security standpoint:

- If the RPC call succeeds post-deploy → endpoint returns 200 + `synced=true`. Security posture validated empirically.
- If the RPC call fails with `permission denied for function list_schema_migrations` → the GRANT did not apply; operator re-runs the GRANT statement; security posture is **fail-closed** (the failure is loud via `MigrationsLedgerReadError`).
- If the RPC call fails with `function public.list_schema_migrations() does not exist` → PostgREST schema cache lag; operator runs `NOTIFY pgrst, 'reload schema'` and re-smokes; security posture is **fail-closed**.
- If the RPC call fails with any other message → escalate to system-architecture per spec §Risks R5 (Path B unexpected friction); iteration is **BLOCKED**; no silent Path A fallback.

All failure modes are fail-closed (500 with structured code); none introduce a security risk. The endpoint cannot silently false-positive on success.

---

## Security debt recorded

| Item | Severity | Scope | Recommended next action |
|---|---|---|---|
| B26-R5-SEC-F1 — Supabase error text in 500 body (RPC failure modes) | LOW | `MigrationsLedgerReadError` only | Carries forward from B26-SEC-F1. Revisit if ADR-017 §D3 internal-token follow-up activates (broader consumer base). Today the admin gate makes the disclosure benign. |
| B26-R5-SEC-F2 — No per-route rate-limit | LOW | `GET /api/admin/migrations-health` | Carries forward from B26-SEC-F2. Revisit when ADR-017 §D3 internal-token follow-up materializes a non-admin consumer. Per-route Ratelimit at that point is mandatory, not optional. |
| ~~B26-SEC-F3~~ | RESOLVED | — | The B26 MEDIUM-conditional pre-authorization for the deferred R5 GRANT migration is **closed** by this iteration. No carry-forward. |
| (none) | — | — | No new MEDIUM-conditional bindings introduced. |

---

## B26-SEC-F3 binding closure verdict

**B26-SEC-F3 (MEDIUM-conditional) is CLOSED.** All four binding requirements satisfied:

1. ✅ Standalone iteration spec → `specs/fase-2-c-b26-r5-followup-rpc-migration.md`.
2. ✅ Standalone migration file → `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql`.
3. ✅ Standalone security review of GRANT scope, reversibility, and role boundary → **this document** (S1-S5, S9, S12 verifications).
4. ✅ Reversible REVOKE companion documented → migration 0052 header lines 36-42 (rollback + ledger cleanup) + ADR-018 §Consequences → Reversibility + spec §Rollback.

The B26 security review's S12 conditional finding becomes RESOLVED upon system-validator's COMPLETE verdict for this iteration. **No carry-forward to future iterations.** Future R5-like ledger-read-via-RPC scenarios would require their own standalone security review per the B26-SEC-F3 pattern, but that pattern is **precedent**, not an open binding.

---

## Handoff to system-infra

system-infra is the next active skill in the LITE chain. Items system-infra should focus on for its post-merge migration apply + production smoke:

1. **Migration apply path choice.** Either `supabase db push` (preferred — auto-tracks the ledger row) or Dashboard SQL Editor + manual ledger insert per ADR-014 playbook. Backend / Infra documents the choice at deploy time. **Security note: both paths are equivalent from a security standpoint.** The manual ledger insert is non-sensitive metadata only.
2. **GRANT verification post-apply.** Run `SELECT proacl FROM pg_proc WHERE proname = 'list_schema_migrations';` and confirm the ACL shows `service_role=X/postgres` (EXECUTE granted to service_role only) and **no** `anon=X` or `authenticated=X` entries. If anon or authenticated entries appear, the REVOKE-then-GRANT sequencing failed (would indicate a Supabase regression) — escalate to system-architecture.
3. **Function existence + ownership verification.** Run `SELECT proname, proowner::regrole FROM pg_proc WHERE proname = 'list_schema_migrations';` and confirm exactly one row returns with `proowner = 'postgres'`. If the owner is anything other than `postgres`, the migration applier role was unexpected; the function may still work (DEFINER inherits owner's privileges) but the security review's S3 verification assumes `postgres` ownership.
4. **search_path verification.** Run `SELECT proconfig FROM pg_proc WHERE proname = 'list_schema_migrations';` and confirm `proconfig` contains `search_path=pg_catalog, supabase_migrations`. If `public` appears anywhere in the search_path, the SECURITY DEFINER hardening is compromised — escalate to system-architecture.
5. **Production smoke against `nooncode-app-pi.vercel.app`** per testing review §R5 production-smoke checklist Step 2. Expected: HTTP 200 + `synced=true` + `ledger_count=54` + `filesystem_count=56`. If smoke fails with `permission denied for function list_schema_migrations`, re-run the GRANT lines from migration 0052 verbatim. If smoke fails with `function does not exist`, run `NOTIFY pgrst, 'reload schema'` and re-smoke.
6. **Bundle-size sanity check.** Confirm the route's serverless function bundle stays under Vercel's 50MB unzipped limit; this iteration does not change `outputFileTracingIncludes`, so bundle size delta should be negligible (only the adapter `.ts` file changed; no new imports beyond the typed `PostgrestError` import already in `@supabase/supabase-js`).
7. **Rollback drill (optional, recommended for posture confidence).** On a Vercel preview environment, apply migration 0052, then apply the rollback (`REVOKE EXECUTE FROM service_role; DROP FUNCTION IF EXISTS public.list_schema_migrations();`). Confirm the preview endpoint returns 500 + `MIGRATIONS_READ_FAILED` post-rollback. Re-apply the migration. Confirm the endpoint returns 200 + `synced=true`. **This is not required for COMPLETE**, but exercising the rollback path on preview before relying on it for production rollback confidence is recommended.

Test debt items system-infra should be aware of (NOT blocking the infra gate, recorded for transparency):

- RPC call site not unit-tested (testing F-2) — deferred to production smoke per spec §Recommended Testing Methodology.
- Live GRANT scope verification not exercised in this skill — system-infra runs the `SELECT proacl FROM pg_proc` check above post-apply.
- Rollback not exercised in this skill — system-infra runs the optional preview-rollback drill if desired.

**Security gate: GATE-OPEN. Handoff to system-infra is unblocked.**

---

## Verdict

**GATE-OPEN.**

Justification:

- All 12 threat-model verifications (S1-S12) resolved to LOW severity or informational.
- Two LOW findings recorded (B26-R5-SEC-F1, B26-R5-SEC-F2) — both are carry-forward from B26, neither is introduced by this iteration, neither is blocking.
- Two positive findings recorded (P1 defense-in-depth improvement over precedent; P2 two-layer defense documented).
- B26-SEC-F3 MEDIUM-conditional binding from the prior B26 review **closes** upon this iteration. All four binding requirements satisfied.
- No new CRITICAL, HIGH, or MEDIUM findings introduced.
- Privilege boundary narrows vs B26 baseline (single-function EXECUTE grant + hardened search_path replaces cross-schema accessor).
- Defense-in-depth posture **stronger** than precedent migration 0050 (explicit REVOKE FROM PUBLIC added).
- Two-layer defense (database GRANT scope + App admin gate) preserved.
- Rollback is reversible, pasteable, idempotent, and addresses both database and ledger artifacts.
- All failure modes are fail-closed (loud 500 with structured `MIGRATIONS_READ_FAILED` code); no silent-success drift risk.

**Not COMPLETE** — only system-validator declares that, after system-infra and system-docs have run. This skill's verdict closes the **security** gate within the LITE chain; the iteration as a whole still requires system-infra (production smoke) and system-docs (closure documentation) and system-validator (final gate).

**Production-readiness:** APPROVED from a security posture standpoint. system-infra may apply the migration and run the production smoke.
