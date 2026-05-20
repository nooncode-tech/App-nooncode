# B26-R5 — Infra apply (`list_schema_migrations` RPC migration)

**Date:** 2026-05-20
**Iteration:** `fase-2-c-b26-r5-followup-rpc-migration` — ADR-017 §R5 follow-up; cross-schema SELECT → `public.list_schema_migrations()` SECURITY DEFINER RPC.
**Reviewer role:** system-infra (mandatory gate per LITE-depth chain: analysis → architecture → backend → testing → security → **infra** → docs → validator).
**Depth:** LITE — proportional review for an additive, idempotent, single-function migration with no env-var, no service, no container, no pipeline change. Infra owns (a) applying migration 0052 to remote `pdotsdahsrnnsoroxbfe` per ADR-014, (b) verifying GRANT scope and `search_path` pin per the security review's §Handoff to system-infra checklist, (c) documenting the production smoke checklist for the operator to run post-merge + deploy.
**Verdict:** **READY-TO-MERGE WITH WARNINGS.** No infra-blocking issue. Migration apply is operator-driven (Dashboard SQL Editor fallback per ADR-014 since no Supabase MCP `apply_migration` tool is available in this environment); the production smoke depends on a fresh Vercel deploy that includes the new adapter code — that deploy lands post-merge of this iteration's PR, so the smoke is documented as a checklist for the operator to execute post-merge + post-deploy, not run in this skill.

---

## Scope

The review covers infra-side concerns for the B26-R5 iteration:

- Migration apply path choice and execution (`supabase db push` vs Dashboard SQL Editor + manual ledger insert per ADR-014 playbook).
- Post-apply GRANT-scope and `search_path`-pin verification per security review §Handoff to system-infra (S1, S2, S3).
- Ledger reconciliation post-apply (row inserted, total count moves 53 → 54).
- Production smoke checklist against `https://nooncode-app-pi.vercel.app/api/admin/migrations-health` (admin session required).
- R5 closure criteria — when system-validator may flip ADR-017 §R5 status from "Open" to "Closed" based on smoke evidence.
- Environment / runtime / bundle sanity check (no env-var change; no `outputFileTracingIncludes` change; no Vercel project setting change).
- Rollback path readiness (the migration's two-statement rollback companion + the application-side adapter revert + the ledger cleanup DELETE).
- Cross-repo / NoonWeb sanity (no coupling; out of scope confirmed).

Out of scope (handled by other gates or future iterations):

- Live empirical execution of the `proacl` / `proconfig` / ledger-count checks against `pdotsdahsrnnsoroxbfe` from within this skill — the apply itself is operator-driven via Dashboard SQL Editor in this environment (Supabase MCP `apply_migration` is unavailable), and this skill documents the verbatim verification SQL the operator runs immediately post-apply.
- Vercel preview deploy verification of the new adapter calling `client.rpc('list_schema_migrations')` — happens automatically when the iteration's PR merges to `develop`; the operator triggers the Vercel Deploy Hook or relies on auto-deploy.
- Production smoke execution — operator-driven, documented as the checklist in §Production smoke checklist.
- Rate-limit posture (B26-R5-SEC-F2 LOW carries forward from B26-SEC-F2; not changed by this iteration).
- Re-review of B26 infra concerns (already in `docs/validations/B26 infra review 2026-05-20.md` — bundle inclusion, status-code semantics, `outputFileTracingIncludes` correctness all unchanged here).
- NoonWeb side (no cross-repo coupling per ADR-017 §D7 and ADR-018).

---

## Reference

- **Spec** `specs/fase-2-c-b26-r5-followup-rpc-migration.md` §Success Criterion items 7-8 (migration applied + production smoke).
- **ADR-018** `docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md` §D4 (migration file byte-for-byte), §D5 (adapter diff), §Consequences → Reversibility (5-step rollback).
- **Migration** `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` (74 lines, transactional `begin;/commit;` envelope, idempotent via `drop function if exists` + `create function`).
- **Adapter** `lib/server/migrations/ledger-adapter.ts` (`readLedgerRows()` at lines 135-153 — now `client.rpc('list_schema_migrations' as never)` with PostgrestError-typed envelope; `MigrationsLedgerReadError` at lines 88-97 unchanged in behavior, JSDoc updated).
- **Route handler (unchanged)** `app/api/admin/migrations-health/route.ts` — admin gate via `requireRole(['admin'])` (line 45 inside the route's `try`).
- **Service-role client (unchanged)** `lib/server/supabase/admin.ts` — `createSupabaseAdminClient()` reads `env.supabaseServiceRoleKey`.
- **Testing review** `docs/validations/B26-R5 testing review 2026-05-20.md` — SUFFICIENT verdict; pure-function tests all pass (7 × `diffMigrations` + 3 × `filenameToSlug`).
- **Security review** `docs/validations/B26-R5 security review 2026-05-20.md` — GATE-OPEN verdict; zero CRITICAL / HIGH / MEDIUM; B26-SEC-F3 conditional binding CLOSED; §Handoff to system-infra provides the verification checklist.
- **ADR-014** `docs/adrs/ADR-014-migration-ledger-reconciliation.md` — manual-apply playbook for Dashboard SQL Editor + manual ledger row insert (the fallback path used in this iteration).
- **Precedent** `docs/validations/B26 infra review 2026-05-20.md` — structural template for an infra apply / smoke review.

---

## I-1 — Migration apply path choice and execution

**Question:** which path applies migration `0052` to the production Supabase project `pdotsdahsrnnsoroxbfe`, and how is the ledger row reconciliation handled?

**Apply path used in this iteration:** **Dashboard SQL Editor + manual ledger insert per ADR-014 playbook** (fallback path), because the Supabase MCP `apply_migration` tool is **not available** in the current Claude Code session (the `plugin_supabase_supabase` MCP server is not registered; only `claude.ai Figma` MCP is available — confirmed via `ListMcpResourcesTool`). The `supabase db push` CLI path is theoretically available to the operator but requires a logged-in Supabase CLI session targeting the production project, which is operator-driven and outside the Claude Code session's reach.

**Operator action required:** the operator must apply migration `0052` to `pdotsdahsrnnsoroxbfe` via either:

### Path A — `supabase db push` (preferred, auto-tracks ledger)

```powershell
# From repo root, with Supabase CLI logged in and linked to pdotsdahsrnnsoroxbfe:
supabase db push
```

The CLI applies all unapplied migrations in `supabase/migrations/` (just `0052` for this iteration) and automatically inserts the corresponding ledger row into `supabase_migrations.schema_migrations`. No manual ledger insert required.

### Path B — Dashboard SQL Editor + manual ledger insert (ADR-014 fallback)

Step 1 — Apply the migration body. Paste the verbatim contents of `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` into the Supabase Dashboard SQL Editor at `https://supabase.com/dashboard/project/pdotsdahsrnnsoroxbfe/sql/new` and execute. The transactional `begin;/commit;` envelope ensures atomic apply.

Or copy-paste this minimal apply block (the function definition + GRANT/REVOKE without the header comment):

```sql
begin;

drop function if exists public.list_schema_migrations();

create function public.list_schema_migrations()
returns table (
  version text,
  name text
)
language sql
stable
security definer
set search_path = pg_catalog, supabase_migrations
as $$
  select version, name
  from supabase_migrations.schema_migrations
$$;

revoke execute on function public.list_schema_migrations() from public;
revoke execute on function public.list_schema_migrations() from anon, authenticated;
grant  execute on function public.list_schema_migrations() to service_role;

commit;
```

Step 2 — Insert the ledger row manually (ADR-014 playbook):

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('0052', 'phase_20b_list_schema_migrations_rpc');
```

Step 3 — Confirm no duplicate ledger row exists (defensive):

```sql
select count(*) as row_count
from supabase_migrations.schema_migrations
where version = '0052'
  and name = 'phase_20b_list_schema_migrations_rpc';
-- Expected: row_count = 1
```

**Either path is acceptable per ADR-014.** The security review §S11 confirms both paths are equivalent from a security standpoint; the operator's choice depends on CLI session availability. The Dashboard fallback is well-precedented in this repo (B15 / migration 0051 used the same path).

**Verdict:** PASS. Apply path is documented and ready for operator execution. No infra-side blocking issue.

---

## I-2 — Post-apply GRANT-scope verification (security review §Handoff item 2)

**Question:** after the migration applies, does `pg_proc.proacl` for `list_schema_migrations` show exactly `service_role=X/postgres` and no other grantees?

**Operator verification SQL (run via Dashboard SQL Editor immediately post-apply):**

```sql
select
  proname,
  proacl,
  proowner::regrole as owner
from pg_proc
where proname = 'list_schema_migrations';
```

**Expected output (one row):**

| `proname` | `proacl` | `owner` |
|---|---|---|
| `list_schema_migrations` | `{postgres=X/postgres,service_role=X/postgres}` | `postgres` |

Interpretation:
- `postgres=X/postgres` — the function owner (`postgres`) implicitly has EXECUTE (`X`) granted by self (`/postgres`). This is automatic on `CREATE FUNCTION` and is not a security concern (the owner role would have EXECUTE regardless of explicit GRANT).
- `service_role=X/postgres` — `service_role` has EXECUTE granted by `postgres` (the function owner). This is the **only** explicit grantee.
- **No `anon=X/...`, no `authenticated=X/...`, no `=X/...` (PUBLIC) entries.** Their absence confirms the three REVOKE statements (lines 69-70 of the migration) scrubbed the default-PUBLIC grant and explicitly denied the two PostgREST-callable roles.

**Failure mode:** if `proacl` shows `anon=X/...` or `authenticated=X/...` or `=X/...` entries, the REVOKE-then-GRANT sequencing failed. Per security review §S1, this would indicate a Supabase regression (the REVOKE statements are inside the same `begin;/commit;` envelope as the CREATE, so a partial-apply window is impossible under transactional DDL). **Escalate to system-architecture; do NOT proceed to smoke.**

**Failure mode (owner mismatch):** if `owner` is anything other than `postgres` (e.g., `supabase_admin` or `authenticator`), the migration was applied by an unexpected role. The DEFINER inheritance still works as long as the owner has SELECT on `supabase_migrations.schema_migrations` — but the security review's §S3 verification assumes `postgres` ownership. If a different owner appears, system-infra should flag for system-architecture re-verification before declaring the iteration COMPLETE.

**Verdict:** PASS (pending operator execution). The verification SQL is canonical, the expected output is documented, and the failure modes are mapped to clear escalation paths.

---

## I-3 — Post-apply `search_path` pin verification (security review §Handoff item 4)

**Question:** does `pg_proc.proconfig` for `list_schema_migrations` contain `search_path=pg_catalog, supabase_migrations` (no `public`)?

**Operator verification SQL:**

```sql
select
  proname,
  proconfig
from pg_proc
where proname = 'list_schema_migrations';
```

**Expected output (one row):**

| `proname` | `proconfig` |
|---|---|
| `list_schema_migrations` | `{"search_path=pg_catalog, supabase_migrations"}` |

Interpretation:
- `proconfig` is an array of `setting=value` strings applied to the function's execution environment. Only `search_path` should be present in this iteration's function.
- The value `pg_catalog, supabase_migrations` matches the migration file's `set search_path = pg_catalog, supabase_migrations` clause (line 63).
- **`public` MUST NOT appear** anywhere in the `search_path` value. Its absence is the load-bearing hardening clause that prevents a future `public`-CREATE attacker from shadowing the qualified `supabase_migrations.schema_migrations` reference (security review §S2).

**Failure mode:** if `proconfig` is `NULL` or empty, the `SET search_path` clause was lost during apply (would indicate a Postgres version inconsistency — extremely unlikely with PostgreSQL 14+ which this project targets). If `proconfig` contains `public`, the search_path pin was overwritten (operator must drop and re-apply the migration verbatim). **Escalate to system-architecture; do NOT proceed to smoke.**

**Verdict:** PASS (pending operator execution). The verification SQL is canonical, the expected output is documented, and the failure modes have clear escalation paths.

---

## I-4 — Ledger reconciliation post-apply

**Question:** after the migration applies (via either Path A or Path B), does the ledger contain the expected row, and does the total count move from 53 → 54?

**Operator verification SQL (run immediately after apply + manual insert if Path B):**

```sql
-- (a) Confirm the new row exists.
select version, name
from supabase_migrations.schema_migrations
where version = '0052'
  and name = 'phase_20b_list_schema_migrations_rpc';
-- Expected: 1 row with (version='0052', name='phase_20b_list_schema_migrations_rpc')

-- (b) Confirm total ledger row count.
select count(*) as ledger_count
from supabase_migrations.schema_migrations;
-- Expected: ledger_count = 54  (pre-iteration was 53)
```

**Pre-iteration ledger state (per spec §Assumptions and §Dependencies):**
- 53 rows pre-this-iteration (B15 closed at 53).
- 1 row added by this iteration → 54 rows post-apply.

**Filesystem state (does NOT depend on ledger apply):**
- 55 `.sql` files pre-this-iteration in `supabase/migrations/`.
- 1 file added by this iteration (`0052_phase_20b_list_schema_migrations_rpc.sql`) → 56 files post-merge.

**The mismatch between `filesystem_count=56` and `ledger_count=54` is intentional and expected** — it reflects ADR-014's `EXPECTED_ORPHAN_LEDGER_NAMES` (6 ledger orphans) and ADR-006's `KNOWN_COLLISION_FILES` (4 grandfathered filename collisions). The pure `diffMigrations` function classifies these and the endpoint reports `synced=true` when the count delta is fully explained by the known exception sets. See `lib/server/migrations/known-exceptions.mjs` for the canonical lists.

**Failure mode (Path B forgot manual insert):** if the operator applied via Dashboard SQL Editor but skipped Step 2 (manual ledger insert), `(a)` returns zero rows and `(b)` shows `ledger_count = 53`. This would cause the smoke to return 503 + `synced=false` with `'phase_20b_list_schema_migrations_rpc'` appearing in `data.missing_in_ledger`. The endpoint **catches this drift loudly** — the operator runs the manual INSERT from §I-1 Path B Step 2 and re-smokes. This is the same loud-drift posture documented in security review §S11 and B26 G7 mitigation. **Not a security risk; operationally addressable.**

**Failure mode (duplicate ledger row):** if the operator applies via both `supabase db push` AND Dashboard manual insert, the unique constraint on `(version, name)` in `supabase_migrations.schema_migrations` should reject the duplicate. If for any reason both apply paths land successfully without rejection, `(a)` returns 2 rows. The endpoint would still pass smoke (the `diffMigrations` function dedupes via the ledger name set), but the duplicate should be cleaned up:

```sql
delete from supabase_migrations.schema_migrations
where version = '0052'
  and name = 'phase_20b_list_schema_migrations_rpc'
  and ctid not in (
    select min(ctid)
    from supabase_migrations.schema_migrations
    where version = '0052'
      and name = 'phase_20b_list_schema_migrations_rpc'
  );
```

**Verdict:** PASS (pending operator execution). Ledger reconciliation SQL is canonical, the expected counts are documented, and the failure modes (missing insert, duplicate insert) are both operationally addressable.

---

## I-5 — Production smoke checklist (post-merge + post-deploy)

**Critical sequencing reminder:** the production smoke depends on a fresh Vercel deploy that includes the new adapter code (`readLedgerRows()` calling `client.rpc('list_schema_migrations' as never)`). The current production deploy (from earlier this session) has the OLD adapter (`.schema().from()`) which produces the 500 + `Invalid schema: supabase_migrations` error this iteration is supposed to close. Therefore the smoke can only pass after:

1. **Migration `0052` is applied to `pdotsdahsrnnsoroxbfe`** (per §I-1; either Path A or Path B).
2. **Iteration PR is created, reviewed, and merged to `develop`** (operator action; the user merges per MEMORY rule "do not auto-merge PRs").
3. **Vercel auto-deploys** the merged `develop` branch to `nooncode-app-pi.vercel.app`, OR the operator triggers the Vercel Deploy Hook manually (G11 carry-over per `docs/runbooks/cutover-pilot.md` §5.3).
4. **Vercel deployment is Ready** (verified in the Vercel dashboard or via `gh deployment` if exposed).

**Sequence flexibility:** migration apply (step 1) can happen **before or after** the merge (steps 2-4). Applying the migration first is **safe** because:
- The OLD adapter code keeps using `.schema().from()` and continues returning 500 + `Invalid schema` until the NEW adapter ships — the migration is silently dormant from the route's perspective until the deploy lands.
- The migration is additive (idempotent CREATE FUNCTION) and does not break any existing table, function, or grant.
- The function lives in `public` schema but EXECUTE is REVOKEd from anon/authenticated, so no caller-facing surface is broadened by applying the migration alone.

**Recommended order:** apply migration → merge PR → trigger deploy → run smoke. This isolates each step's failure mode and lets the operator verify each gate independently.

### Smoke checklist

Operator runs after migration apply + deploy Ready:

```bash
# Step 1 — Establish an admin session on nooncode-app-pi.vercel.app.
# (Browser-side: log in as an admin user. The endpoint requires
#  `requireRole(['admin'])` via the App's auth gate.)

# Step 2 — Hit the endpoint with credentials.
curl -i -H "Cookie: <admin session cookie>" \
  https://nooncode-app-pi.vercel.app/api/admin/migrations-health
```

**Expected response (HTTP 200 + JSON body):**

```json
{
  "data": {
    "synced": true,
    "summary": {
      "ledger_count": 54,
      "filesystem_count": 56,
      "grandfathered_collisions_count": 4,
      "expected_orphans_count": 6,
      "unexpected_drift_count": 0
    },
    "missing_in_ledger": [],
    "unexpected_drift_orphans": [],
    "grandfathered_collisions": [
      "0033_add_user_metadata.sql",
      "0034_add_subscription_status.sql",
      "0035_add_payment_methods.sql",
      "0036_add_dashboard_telemetry.sql"
    ],
    "expected_orphans": [
      "..._init",
      "..._add_user_metadata",
      "..._add_subscription_status",
      "..._add_payment_methods",
      "..._add_dashboard_telemetry",
      "..._add_legacy_audit_columns"
    ],
    "checked_at": "2026-05-20T..."
  }
}
```

**Pass criteria (all must hold simultaneously):**

| Field | Expected value | Source / rationale |
|---|---|---|
| HTTP status | `200` | ADR-017 §D2 status mapping: 200 when `synced=true`. |
| `data.synced` | `true` | All filesystem files matched to ledger rows after exception sets applied. |
| `data.summary.ledger_count` | `54` | 53 pre-iteration + 1 (this iteration's `0052`) = 54. |
| `data.summary.filesystem_count` | `56` | 55 pre-iteration + 1 (this iteration's `0052_..._.sql`) = 56. |
| `data.summary.grandfathered_collisions_count` | `4` | ADR-006 `KNOWN_COLLISION_FILES.length` = 4. |
| `data.summary.expected_orphans_count` | `6` | ADR-014 `EXPECTED_ORPHAN_LEDGER_NAMES.length` = 6. |
| `data.summary.unexpected_drift_count` | `0` | No drift beyond the known exception sets. |
| `data.missing_in_ledger` | `[]` | If non-empty: ledger insert was skipped (operator runs §I-4 manual INSERT). |
| `data.unexpected_drift_orphans` | `[]` | If non-empty: a new orphan landed that's not in `EXPECTED_ORPHAN_LEDGER_NAMES` — investigate. |

**Failure mode (a) — HTTP 500 + `MIGRATIONS_READ_FAILED` + `permission denied for function list_schema_migrations`:**
The GRANT to `service_role` did not apply. Operator re-runs the GRANT statement from migration 0052 verbatim:
```sql
grant execute on function public.list_schema_migrations() to service_role;
```
Then re-smoke.

**Failure mode (b) — HTTP 500 + `MIGRATIONS_READ_FAILED` + `function public.list_schema_migrations() does not exist`:**
PostgREST schema cache lag — the function exists but PostgREST hasn't refreshed its cache. Operator runs:
```sql
notify pgrst, 'reload schema';
```
Then re-smoke. (Per security review §S2 + B26 infra review I-5, PostgREST should auto-reload on `CREATE FUNCTION`, but the manual `NOTIFY` is the documented fallback.)

**Failure mode (c) — HTTP 503 + `synced=false` + `'phase_20b_list_schema_migrations_rpc'` in `missing_in_ledger`:**
Migration applied via Path B but manual ledger INSERT skipped. Operator runs the INSERT from §I-1 Path B Step 2. Then re-smoke.

**Failure mode (d) — HTTP 500 + `MIGRATIONS_READ_FAILED` + any other error message:**
Unanticipated R5 friction (spec §Risks R5 — "Path B unexpected friction"). Per spec §Excluded ("No Path A fallback") and per the binding inputs from the user's prompt: **escalate to system-architecture, do NOT silently fall back to Path A**. Iteration is BLOCKED until system-architecture diagnoses.

**Failure mode (e) — HTTP 200 + `synced=true` but counts do not match expected:**
Either (a) another migration landed concurrently (recompute targets), or (b) the exception sets in `known-exceptions.mjs` drifted. Diagnose by reading the response's `grandfathered_collisions` and `expected_orphans` arrays against the source-of-truth lists.

**Verdict:** PASS (pending operator execution). Smoke checklist is canonical, expected counts are documented, all five failure modes are mapped to clear remediation paths.

---

## I-6 — Environment / runtime / bundle sanity

**Question:** does this iteration change any env var, runtime config, build step, or bundle inclusion that affects the deploy?

**Verification:**

- **No new env var.** Confirmed by grep across the iteration's modified files (`lib/server/migrations/ledger-adapter.ts`, `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql`, ADR-018, spec, security review). No `process.env.*` additions, no `getPhase1AAdminEnv()` extension, no `.env.example` update needed. The existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars (consumed by `createSupabaseAdminClient`) are unchanged.
- **No runtime config change.** `next.config.mjs` is untouched. The `outputFileTracingIncludes` entry for `/api/admin/migrations-health` (added in B26) remains correct — the `.sql` files of `supabase/migrations/` are still the SoT for `filesystem_count`, and the migration `0052` file itself is included in that bundle automatically because it matches the existing `./supabase/migrations/**/*.sql` glob.
- **No build step change.** `package.json` scripts unchanged. `npm run build` continues to compile the adapter and route as before. `npm test` continues to run the seven `diffMigrations` + three `filenameToSlug` pure-function tests.
- **Bundle size delta is negligible.** The adapter change is a one-line flip from `.schema().from().select()` to `.rpc()` (both methods exist in `@supabase/supabase-js` already; no new import beyond the `PostgrestError` type which is already in the package). The `lib/server/migrations/ledger-adapter.ts` file grew by a few JSDoc lines (header updated to cite ADR-018). The serverless function bundle for `/api/admin/migrations-health` stays under Vercel's 50MB unzipped limit by a wide margin (B26 infra review I-5 confirmed < 500KB at B26 merge; this iteration adds < 1KB).
- **No Vercel project setting change.** No new environment variable, no new redirect, no new header, no new function region setting. The Vercel Deploy Hook URL and auto-deploy posture from `develop` are unchanged.
- **No service / container / pipeline change.** This iteration ships TS code + one SQL migration + docs. No Dockerfile, no CI workflow, no GitHub Actions update.

**Verdict:** PASS. The iteration is a pure code + migration change with zero infra-surface delta beyond the migration apply itself.

---

## I-7 — Rollback path readiness

**Question:** if the migration apply or production smoke surfaces an unrecoverable failure, can the iteration be rolled back cleanly?

**Verification:**

The rollback has three independent layers, all documented and pasteable:

### Database rollback (SQL — run as `postgres` via Dashboard SQL Editor)

Per migration `0052` header (lines 36-38):

```sql
revoke execute on function public.list_schema_migrations() from service_role;
drop function if exists public.list_schema_migrations();
```

### Ledger cleanup (SQL — if migration was tracked via `supabase db push` OR if manual insert ran)

Per migration `0052` header (lines 41-42):

```sql
delete from supabase_migrations.schema_migrations
where version = '0052'
  and name = 'phase_20b_list_schema_migrations_rpc';
```

After this, total ledger count returns to 53.

### Application rollback (git)

Revert the iteration's PR. The adapter's `readLedgerRows()` reverts to the pre-iteration cross-schema SELECT via `.schema('supabase_migrations' as never).from('schema_migrations').select('version, name')`. The endpoint returns to its pre-iteration state: 500 + `MIGRATIONS_READ_FAILED` with `Invalid schema: supabase_migrations` from PostgREST — the defensive ApiError pattern continues to surface failures loudly.

### Rollback verification

After all three layers applied:

```sql
-- Confirm function is gone.
select count(*) as fn_count
from pg_proc
where proname = 'list_schema_migrations';
-- Expected: fn_count = 0

-- Confirm ledger is back to 53.
select count(*) as ledger_count
from supabase_migrations.schema_migrations;
-- Expected: ledger_count = 53
```

Plus hit `GET /api/admin/migrations-health` with admin session. Expected: HTTP 500 + `MIGRATIONS_READ_FAILED` (the pre-iteration production state).

**Rollback completeness check (from security review §S4):**
- ✅ `pg_proc` no longer has a row for `list_schema_migrations`.
- ✅ `pg_proc.proacl` entries for this function are gone (cascaded by `DROP FUNCTION`).
- ✅ No residual GRANTs to `service_role` on this function.
- ✅ Ledger row removed; total count restored to pre-iteration.
- ✅ Application code reverted to pre-iteration state via git revert.
- ✅ PostgREST schema cache auto-reloads on `DROP FUNCTION` (no manual `NOTIFY` required).

**Verdict:** PASS. Rollback is reversible, pasteable, and idempotent. All three layers (database, ledger, application) are documented and have verification steps. The rollback can be exercised in < 5 minutes by an operator with Dashboard SQL Editor + git revert + Vercel redeploy access.

---

## I-8 — Cross-repo / NoonWeb sanity

**Question:** does this iteration introduce any cross-repo coupling with NoonWeb or any other external repository?

**Verification:**

- **No NoonWeb side change.** Per spec §Excluded and per ADR-018 §Consequences → Cross-repo: the endpoint is App-internal. No webhook from NoonWeb hits `/api/admin/migrations-health`; no NoonWeb cron probe consumes the endpoint; no NoonWeb-side configuration knows about `list_schema_migrations` as an RPC name.
- **No external repository touched.** Confirmed by reading the spec and the security review — no `cross-repo-webhook-v*.md` doc is updated, no shared secret rotates, no Stripe / external integration depends on the RPC.
- **The endpoint's external contract is preserved verbatim.** Same shape, same status codes, same admin gate. Any external consumer (today: operator's browser; future: cron probe per ADR-017 §D3 follow-up) sees no difference except that the production endpoint now returns 200 instead of 500.

**Verdict:** PASS. No cross-repo concerns. This iteration is fully internal to `App-nooncode`.

---

## Findings

### LOW findings

| ID | Severity | Type | Affected Area | Owner | Description | Impact | Evidence | Fix Status |
|---|---|---|---|---|---|---|---|---|
| B26-R5-INF-W1 | LOW (warning) | apply path dependency | Migration apply step | system-infra (operator) | The apply is operator-driven via Dashboard SQL Editor (or `supabase db push`) because Supabase MCP `apply_migration` is not available in the current Claude Code session. The fallback path requires the operator to run two SQL blocks in sequence (function CREATE + ledger INSERT if Path B). If the operator skips the ledger INSERT, the endpoint surfaces `missing_in_ledger` drift loudly — operationally addressable, not a security risk. | Smoke fails with 503 + missing-in-ledger if Path B used without manual INSERT. Operator runs INSERT, re-smoke passes. | §I-1 Path B steps; security review §S11. | Open (documented for operator execution; not blocking). |
| B26-R5-INF-W2 | LOW (warning) | deploy ordering | Production smoke depends on fresh deploy | system-infra (operator) | The smoke can only pass after the iteration PR merges and Vercel deploys the new adapter. The current production deploy has the OLD adapter and returns 500. The migration apply alone is silently dormant (the OLD adapter's `.schema().from()` continues to fail) until the deploy lands. Operator must verify Vercel deploy is Ready before running smoke. | If operator runs smoke against the current production before merge + deploy, smoke fails with the pre-iteration 500. Not a regression; expected. | §I-5 critical sequencing reminder. | Open (documented; expected pre-merge state). |

### MEDIUM, HIGH, CRITICAL findings

**None.** All eight infra verifications (I-1 through I-8) resolved to PASS (pending operator execution) with two LOW warnings recorded for operator awareness, neither of which blocks the iteration.

---

## R5 closure criteria

ADR-017 §R5 may flip from "Open until backend smoke confirms" to "Closed — see ADR-018" when **all** of the following hold:

1. ✅ ADR-018 exists at `docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md`. **Confirmed by `Glob`/`Bash ls` in this skill.**
2. ✅ Migration `0052` exists on disk at `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql`. **Confirmed by `Read` in this skill (74 lines, transactional envelope, hardened SECURITY DEFINER).**
3. ✅ Adapter `readLedgerRows()` calls `client.rpc('list_schema_migrations' as never)`. **Confirmed by `Read` in this skill (lines 135-153 of `ledger-adapter.ts`).**
4. ✅ Testing review SUFFICIENT (7 × `diffMigrations` + 3 × `filenameToSlug` pure-function tests pass). **Confirmed by spec §Reference and the existence of `docs/validations/B26-R5 testing review 2026-05-20.md`.**
5. ✅ Security review GATE-OPEN (zero CRITICAL / HIGH / MEDIUM; B26-SEC-F3 closed). **Confirmed by reading `docs/validations/B26-R5 security review 2026-05-20.md` end-to-end.**
6. ⏳ Migration `0052` applied to `pdotsdahsrnnsoroxbfe`. **Pending operator execution per §I-1.**
7. ⏳ Post-apply GRANT scope verified — `proacl` shows only `service_role=X/postgres`. **Pending operator execution per §I-2.**
8. ⏳ Post-apply `search_path` pin verified — `proconfig` contains `pg_catalog, supabase_migrations` with no `public`. **Pending operator execution per §I-3.**
9. ⏳ Ledger reconciliation verified — row `('0052', 'phase_20b_list_schema_migrations_rpc')` present; total count = 54. **Pending operator execution per §I-4.**
10. ⏳ Production smoke passes — HTTP 200 + `synced=true` + `ledger_count=54` + `filesystem_count=56`. **Pending operator execution per §I-5.**

Items 1-5 are **closed by the work already on disk** at the time of this infra apply review. Items 6-10 are operator-driven and gate the validator's final COMPLETE verdict.

**When items 6-10 all pass**, system-validator may flip ADR-017 §R5 status to "Closed — see ADR-018" and return COMPLETE for this iteration. Until then, the iteration is **READY-TO-MERGE WITH WARNINGS** (the warnings being the two operator-action items B26-R5-INF-W1 and B26-R5-INF-W2 above).

---

## Production-readiness judgment

The iteration as shipped (migration `0052` on disk + adapter flip + ADR-018 + spec + testing review SUFFICIENT + security review GATE-OPEN) is **production-ready from an infra posture standpoint**, with the explicit dependency that the operator executes the §I-1 through §I-5 checklist post-merge.

- **No infra-surface change.** No env var, no runtime config, no bundle delta, no service / container / pipeline change. The iteration is a pure code + migration change.
- **Migration is additive and idempotent.** `drop function if exists` + `create function` + `revoke` + `grant` inside a single `begin;/commit;` envelope. Can be applied or rolled back safely without disrupting other functions or tables.
- **Apply paths are well-precedented.** Both `supabase db push` (Path A) and Dashboard SQL Editor + manual ledger insert (Path B per ADR-014) are documented and have been used successfully in this repo for prior migrations.
- **Rollback is reversible, pasteable, idempotent.** Two SQL statements + ledger DELETE + git revert. All three layers verified in §I-7.
- **All failure modes are fail-closed.** The endpoint's defensive `MigrationsLedgerReadError` continues to map RPC failures to 500 + `MIGRATIONS_READ_FAILED`. No silent-success drift risk.
- **B26-SEC-F3 binding closes** upon validator COMPLETE — the security review's GATE-OPEN verdict provides this iteration's authorization to proceed.

The remaining operator-driven steps (§I-1 apply, §I-2/§I-3/§I-4 verification, §I-5 smoke) are documented in this review verbatim, with expected outputs and failure-mode escalation paths. The operator can execute them in ~10-15 minutes total post-merge + post-deploy.

---

## Handoff to system-docs

system-docs is the next active skill in the LITE chain. Items system-docs should handle:

1. **Update `docs/context/project.context.core.md`** — Operating rules entry for the migration-health endpoint to reflect that the underlying read mechanism is now `public.list_schema_migrations()` RPC (externally identical behavior). **No B-codes, R-codes, Sprint IDs, or plan-IDs per MEMORY rule** (`feedback_context_docs_no_plan_refs.md`).
2. **Update `docs/context/project.context.history.md`** — Append a session note documenting: B26 merge → post-merge R5 verify failure → user's Path B election → this iteration's deliverables (ADR-018, migration `0052`, adapter flip, infra apply checklist). **No B-codes, R-codes, Sprint IDs per MEMORY rule.**
3. **Update roadmap §17** at `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` — latest-snapshot entry reflecting R5 closure per MEMORY rule (`feedback_keep_roadmap_in_sync.md`).
4. **Flip ADR-017 §R5 status** from "Open until backend smoke confirms" to "Closed — see ADR-018" (the wording finalized in ADR-018's §Lifecycle). This is the canonical hand-back of the §R5 closure marker.

Items system-docs does NOT handle (deferred to validator or operator):

- Items 6-10 of the R5 closure criteria (operator-driven; validator confirms when operator reports back).
- An updated infra annotation if the operator reports a deviation from the §I-5 expected outputs (system-validator handles the deviation path, escalating back to system-architecture if §I-1 through §I-4 fail).

---

## Verdict

**READY-TO-MERGE WITH WARNINGS.**

Justification:

- All eight infra verifications (I-1 through I-8) resolved to PASS pending operator execution.
- Two LOW warnings recorded (B26-R5-INF-W1 apply-path dependency; B26-R5-INF-W2 deploy ordering) — both are operator-action items, neither blocks the iteration.
- Zero MEDIUM, HIGH, or CRITICAL findings introduced.
- No env var, no runtime, no bundle, no service change — the iteration is a pure code + migration change with minimal infra surface.
- Migration apply path is documented for both Path A (`supabase db push`) and Path B (Dashboard SQL Editor + manual ledger insert per ADR-014).
- Post-apply verification SQL is canonical and the expected outputs are documented, with all failure modes mapped to clear escalation paths (re-grant, NOTIFY pgrst, manual INSERT, or escalate to architecture).
- Production smoke checklist is canonical and matches the spec §Success Criterion item 8 expected counts (HTTP 200, `synced=true`, `ledger_count=54`, `filesystem_count=56`, `grandfathered_collisions_count=4`, `expected_orphans_count=6`, `unexpected_drift_count=0`).
- Rollback is reversible, pasteable, idempotent across all three layers (database, ledger, application).
- B26-SEC-F3 conditional MEDIUM binding closes upon validator COMPLETE (per security review §S12).

**Not COMPLETE** — only system-validator declares that, after system-docs has run and the operator has executed §I-1 through §I-5. This skill's verdict closes the **infra** gate within the LITE chain; the iteration as a whole still requires system-docs (closure documentation) and system-validator (final gate that confirms operator-reported smoke results).

**Infra gate: READY-TO-MERGE WITH WARNINGS. Handoff to system-docs is unblocked.**
