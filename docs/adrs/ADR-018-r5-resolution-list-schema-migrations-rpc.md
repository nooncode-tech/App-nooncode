# ADR-018: R5 resolution — `list_schema_migrations` RPC (SECURITY DEFINER) replaces cross-schema SELECT

**Status:** Accepted
**Date:** 2026-05-20
**Deciders:** Engineering team
**Supersedes:** None
**Amends:** ADR-017 §R5 (status flipped from "Open until backend smoke confirms" to "Closed — see ADR-018").
**Related:** ADR-006 (migration prefix convention), ADR-014 (ledger reconciliation playbook), ADR-017 (B26 endpoint, §D4 typing precedent, §R5 risk), spec `specs/fase-2-c-b26-r5-followup-rpc-migration.md`, validation `docs/validations/B26 security review 2026-05-20.md` §S12 / B26-SEC-F3.

---

## Context

B26 shipped the `GET /api/admin/migrations-health` endpoint via PR #69 on 2026-05-20. The adapter reads `supabase_migrations.schema_migrations` through a direct cross-schema SELECT (`client.schema('supabase_migrations').from('schema_migrations').select('version, name')`). The defensive `MigrationsLedgerReadError` wraps any failure as a 500 with `code: 'MIGRATIONS_READ_FAILED'`.

ADR-017 §R5 anticipated this read might require policy surgery if the service-role lost its default SELECT grant on `supabase_migrations`. The actual production failure mode after merge was **not** `42501` permission denied — it was a PostgREST `db-schemas` exposure restriction. The supabase-js `.schema('supabase_migrations')` accessor is rejected by PostgREST before reaching Postgres permission checks because `supabase_migrations` is not in the project's exposed `db-schemas` list (the project exposes `public, graphql_public, storage` by default).

Production smoke against `pdotsdahsrnnsoroxbfe` returned:

```
GET https://nooncode-app-pi.vercel.app/api/admin/migrations-health
→ 500 { "error": "Could not read the schema migrations ledger: Invalid schema: supabase_migrations",
        "code": "MIGRATIONS_READ_FAILED" }
```

The defensive ApiError pattern worked as designed — loud 500, structured code, no silent false-positive drift. R5 materialized in a different shape than predicted but landed inside the same failure envelope.

Two resolution paths were available:

- **Path A — operational schema exposure.** Add `supabase_migrations` to the PostgREST `db-schemas` config via the Supabase Dashboard. Single operational change, no code or migration. Cost: widens the PostgREST exposure surface for an internal Supabase-managed schema, which then becomes anon/authenticated-reachable subject to RLS; defense-in-depth weaker.
- **Path B — SECURITY DEFINER RPC in `public`.** Ship a `public.list_schema_migrations()` function that runs as its owner (`postgres`) and returns `setof (version text, name text)` from `supabase_migrations.schema_migrations`. Privilege surface narrowed to one function, EXECUTE granted only to `service_role`, REVOKE FROM PUBLIC/anon/authenticated. Cost: one new migration + one-line adapter flip.

The user chose **Path B** explicitly. Rationale: Path A widens schema-level exposure for the convenience of one internal endpoint; Path B bounds privilege to one function and is reversible via a single REVOKE+DROP.

This ADR records the Path B election and pins the implementation details so backend writes the migration and adapter without further design discretion. Migration 0052's SQL is reproduced **verbatim** below — backend writes byte-for-byte what appears in this ADR.

---

## Decision

### D1 — Q1 signed: SECURITY DEFINER posture and hardening

| Clause | Signed value | Rationale |
|---|---|---|
| DEFINER vs INVOKER | **SECURITY DEFINER** | Path B's premise is to bound privilege to one function. INVOKER would still require `service_role` to have direct privileges on `supabase_migrations.schema_migrations`, defeating the iteration. |
| `search_path` pin | **`SET search_path = pg_catalog, supabase_migrations`** | Canonical PostgreSQL SECURITY DEFINER hardening. Prevents a future attacker with `CREATE ON public` from shadowing `supabase_migrations.schema_migrations` and intercepting the read. `pg_catalog` first so unqualified built-ins resolve correctly; `supabase_migrations` second so the unqualified `schema_migrations` reference inside the function body resolves to the Supabase-managed table. Crucially, `public` is **not** in the search_path — any attacker-owned object in `public` cannot shadow. |
| Volatility | **`STABLE`** | Function reads no app data and does not mutate state. `IMMUTABLE` is too strong (the underlying table changes over time as new migrations land). `VOLATILE` is too weak — the function is deterministic within a transaction and the planner can cache results. |
| Language | **`LANGUAGE sql`** | The body is a single `SELECT`. `plpgsql` adds an interpreter layer with no benefit here. Precedent: simple read-only RPCs in this codebase favor `sql`; `plpgsql` is reserved for control-flow + DML (see 0048, 0049, 0050 which all use plpgsql because they have control flow and writes). |
| Ownership | **`postgres`** (implicit — migration runs as the role applying it, which on Supabase-managed projects is `postgres`) | DEFINER runs as the owner. `postgres` is the Supabase super-role with unrestricted access to all schemas including `supabase_migrations`. No explicit `ALTER FUNCTION ... OWNER TO` needed; the implicit ownership is correct. |

### D2 — Q2 signed: GRANT scope + REVOKE companion

**In-migration sequence (verbatim, in order):**

```sql
REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.list_schema_migrations() TO service_role;
```

Order rationale: PostgreSQL grants EXECUTE to PUBLIC by default on `CREATE FUNCTION` in any schema. The REVOKE FROM PUBLIC must run **after** CREATE to be effective. The REVOKE FROM anon, authenticated is defense-in-depth in case Supabase ever changes the PUBLIC default for managed projects. GRANT TO service_role is the only EXECUTE grant.

**No additional grants.** `postgres` retains implicit access (it owns the function); adding `GRANT EXECUTE TO postgres` would be noise.

**Rollback companion (verbatim, embedded in migration 0052 header comment):**

```sql
-- Rollback (run as postgres or via Dashboard SQL Editor):
REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM service_role;
DROP FUNCTION IF EXISTS public.list_schema_migrations();
```

Plus ledger cleanup if the migration was tracked via `supabase db push`:

```sql
DELETE FROM supabase_migrations.schema_migrations
 WHERE version = '0052' AND name = 'phase_20b_list_schema_migrations_rpc';
```

### D3 — Q3 signed: typing strategy — (a) inline cast

**Signed: option (a) — inline cast.** Consistent with ADR-017 §D4 (the existing 4-override-block deferral). The `SchemaMigrationsRow` interface stays co-located in `lib/server/migrations/ledger-adapter.ts` and is reused as the asserted return shape of `client.rpc('list_schema_migrations')`.

**Adapter call site (signed):**

```ts
const { data, error } = (await client.rpc('list_schema_migrations' as never)) as {
  data: SchemaMigrationsRow[] | null
  error: PostgrestError | null
}
```

Rationale:

- Consistent with ADR-017 §D4 deferral. The user prompt's prior "§D9" citation was an error — the typing precedent is §D4. Spec corrected this.
- `database.types.ts` manual-override surface stays at **4 blocks** (`seller_fees`, `prototype_workspaces`, `lead_proposals`, `website_webhook_events`). Clean-regen-debt does not grow.
- The `SchemaMigrationsRow` interface (`lib/server/migrations/ledger-adapter.ts` lines 45-50) is reused verbatim; no new interface created. The doc comment is updated to note the interface now types an RPC return rather than a cross-schema SELECT return (cosmetic).
- Acceptable risk identical to ADR-017 §D4: if Supabase ever changes the row shape of `supabase_migrations.schema_migrations`, the cast silently lies. Mitigation also identical — the type lives next to the only consumer and surfaces as a test failure on the next `@supabase/supabase-js` upgrade. The RPC declaration `RETURNS setof (version text, name text)` further pins the contract at the database boundary.

The `as never` cast on the RPC name is the supabase-js convention for invoking functions not declared in `Database['public']['Functions']`. Without it, TypeScript rejects the function name because the generated `Database` type has no entry for `list_schema_migrations`. The `as never` is the precedent supabase-js cast for unknown RPC names; it matches the existing cross-schema accessor pattern (`schema('supabase_migrations' as never)`).

### D4 — Migration 0052 file contents (verbatim — backend writes byte-for-byte)

File path: `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql`

```sql
-- Phase 20b — list_schema_migrations RPC (B26 R5 resolution, Path B)
--
-- Resolves ADR-017 §R5 — the B26 migration-health endpoint's cross-schema
-- SELECT against `supabase_migrations.schema_migrations` fails on production
-- with PostgREST `Invalid schema: supabase_migrations` because that schema
-- is not in the project's exposed `db-schemas` list. Rather than widen the
-- PostgREST exposure surface (Path A), we bound privilege to one SECURITY
-- DEFINER function in `public` (Path B). See ADR-018.
--
-- Function ownership: implicit `postgres` (migration applier on Supabase-
-- managed projects). DEFINER runs as `postgres`, which has unrestricted
-- access to all schemas including `supabase_migrations`. Hardened
-- `search_path = pg_catalog, supabase_migrations` prevents a future
-- `public`-CREATE attacker from shadowing the read target.
--
-- Volatility: STABLE. Reads no app data, mutates nothing. The planner may
-- cache results within a transaction; the underlying ledger table changes
-- only when new migrations land via `supabase db push` or manual INSERT.
--
-- GRANT scope: service_role only. PUBLIC, anon, authenticated explicitly
-- REVOKEd defense-in-depth. The B26 admin route is the only caller-facing
-- gate; the RPC is unreachable for unauthenticated and authenticated
-- session-holders.
--
-- B26-SEC-F3 binding requirements (docs/validations/B26 security review
-- 2026-05-20.md §S12) satisfied by:
--   1. Standalone iteration spec
--      → specs/fase-2-c-b26-r5-followup-rpc-migration.md
--   2. Standalone migration file
--      → this file
--   3. Standalone security review of GRANT scope
--      → docs/validations/B26-R5 security review 2026-05-20.md
--   4. Reversible REVOKE+DROP companion
--      → the Rollback block below (pasteable verbatim)
--
-- Rollback (run as postgres or via Dashboard SQL Editor):
--   REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM service_role;
--   DROP FUNCTION IF EXISTS public.list_schema_migrations();
--
-- Ledger cleanup if migration was tracked via `supabase db push`:
--   DELETE FROM supabase_migrations.schema_migrations
--    WHERE version = '0052' AND name = 'phase_20b_list_schema_migrations_rpc';
--
-- References:
--   - docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md
--   - docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md §D4, §R5
--   - docs/adrs/ADR-014-migration-ledger-reconciliation.md (row format)
--   - supabase/migrations/0050_phase_19d_debit_wallet_for_refund_rpc.sql
--     (precedent shape: SECURITY DEFINER + GRANT EXECUTE + REVOKE)

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

**Notes on the verbatim text:**

- The `begin;` / `commit;` envelope matches the precedent of 0050 and is the Supabase-CLI convention for migrations. Optional but consistent with the repo.
- `drop function if exists public.list_schema_migrations();` runs **inside** the transaction before `create function`. Idempotent: re-applying the migration drops and re-creates cleanly. The empty-arglist `()` is required for the DROP to match the no-argument signature.
- `create function` (not `create or replace function`) is intentional. The DROP+CREATE pair is more honest about replacing the function definition than CREATE OR REPLACE (which would silently keep stale grants from a previous version). 0050 uses CREATE OR REPLACE because it is amending an existing function; this is a new function, so DROP+CREATE.
- `returns table (version text, name text)` pins the row shape at the database boundary. If Supabase ever changes the underlying `supabase_migrations.schema_migrations` row format, the function definition surfaces the mismatch as a runtime error rather than silently propagating bad data.
- The REVOKE FROM PUBLIC line uses lowercase `public` (the role name), not `PUBLIC` keyword-style. Both work in PostgreSQL; lowercase matches the rest of the file's style.
- No `comment on function` — the file-level header comment carries the documentation; an additional `comment on function` would be redundant and harder to maintain in sync.

### D5 — Adapter flip (signed — backend writes one-line change)

File: `lib/server/migrations/ledger-adapter.ts`

The `readLedgerRows` function body changes from:

```ts
async function readLedgerRows(client: SupabaseClient): Promise<SchemaMigrationsRow[]> {
  const { data, error } = await (client as unknown as SupabaseClient)
    .schema('supabase_migrations' as never)
    .from('schema_migrations')
    .select('version, name')

  if (error) {
    throw new MigrationsLedgerReadError(error.message)
  }

  return (data ?? []) as SchemaMigrationsRow[]
}
```

to:

```ts
async function readLedgerRows(client: SupabaseClient): Promise<SchemaMigrationsRow[]> {
  // Path B (ADR-018): `public.list_schema_migrations()` SECURITY DEFINER RPC
  // returns `setof (version text, name text)` from
  // `supabase_migrations.schema_migrations`. The cross-schema accessor was
  // replaced because PostgREST does not expose `supabase_migrations` via
  // `db-schemas` and rejected the prior `.schema('supabase_migrations')`
  // accessor with `Invalid schema: supabase_migrations`. EXECUTE is granted
  // only to `service_role` (ADR-018 §D2).
  const { data, error } = (await client.rpc('list_schema_migrations' as never)) as {
    data: SchemaMigrationsRow[] | null
    error: PostgrestError | null
  }

  if (error) {
    throw new MigrationsLedgerReadError(error.message)
  }

  return (data ?? []) as SchemaMigrationsRow[]
}
```

**Header-comment edits (cosmetic, in the same file):**

- The leading file JSDoc (lines 1-22) keeps the ADR-017 reference and **adds** an ADR-018 reference: `@see docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md` on the line after the existing `@see` reference.
- The JSDoc on `SchemaMigrationsRow` (lines 36-50) is amended: "Row shape returned by `public.list_schema_migrations()` (ADR-018). Pinned to the ADR-014 verification snapshot..." — keeps the ADR-014 + ADR-017 §D4 references and adds ADR-018 as the current source-of-truth.
- The JSDoc on `MigrationsLedgerReadError` (lines 79-86) is amended: the phrase "the cross-schema SELECT against `supabase_migrations.schema_migrations` fails" changes to "the `public.list_schema_migrations()` RPC call fails". Failure modes (a) and (b) listed below the JSDoc remain valid wording — (a) becomes "the service-role lost its EXECUTE grant on `list_schema_migrations` (escalates to a re-grant migration)"; (b) "transient Supabase outage" unchanged.

**Import added:** `import type { PostgrestError } from '@supabase/supabase-js'` (added to the existing `import type { SupabaseClient }` line — same source module).

**Imports removed:** none. The `SchemaMigrationsRow` export stays; the `MigrationsLedgerReadError` and `MigrationsBundleConfigError` exports stay; the `KNOWN_COLLISION_FILES` / `EXPECTED_ORPHAN_LEDGER_NAMES` imports stay.

### D6 — Module boundaries (unchanged from ADR-017 §D6)

No module boundary change. The adapter (`lib/server/migrations/ledger-adapter.ts`) continues to own:
- Filesystem read (unchanged).
- Ledger read (mechanism flips from `.schema().from().select()` to `.rpc()`; responsibility unchanged).
- Defensive error subclasses (untouched).

The pure `diffMigrations` function (`lib/server/migrations/health.ts`) is untouched.
The route (`app/api/admin/migrations-health/route.ts`) is untouched.
The known-exceptions module (`lib/server/migrations/known-exceptions.mjs`) is untouched.
`database.types.ts` is untouched (Q3 = a).

### D7 — Test fixture (signed — confirmation expected, not blocker)

`tests/server/migrations/health.test.ts` is expected to contain only pure-function tests against `diffMigrations` and `filenameToSlug` (seven edge cases). Analysis pre-confirmed no adapter-boundary mock exists. Backend re-confirms at implementation time:

- If confirmation holds → no test change. Re-run `npm test`; expect green.
- If an adapter-boundary mock exists → flip the mock from `.schema().from().select()` to `.rpc()`. Mechanical one-line change.

No new tests required. The production smoke against `pdotsdahsrnnsoroxbfe` is the integration validation (per spec §Recommended Testing Methodology).

---

## Rationale

### Why Path B over Path A

Path A (operational schema exposure via Supabase Dashboard `db-schemas`) was rejected because:

- It widens the PostgREST exposure surface for a Supabase-managed schema with no RLS policies (the `supabase_migrations` schema is not designed for end-user exposure). Once exposed, **all** PostgREST routes can reach it — not just our admin endpoint. Subsequent RLS work would be required to re-bound exposure, which is more work than Path B.
- It is operational config (Dashboard click), not code. Reversibility requires another Dashboard click. Path B's reversibility is two SQL statements in a documented rollback block.
- It does not narrow privilege — the schema becomes broadly reachable via PostgREST subject to RLS. Path B narrows privilege to one function with EXECUTE granted to one role.

Path B is more code (one migration + one adapter flip) but bounds the privilege surface to a single named function with explicit, reversible GRANT scope. The B26 security review (S12) pre-authorized this exact path and bound it to a standalone security review of the GRANT scope (B26-SEC-F3 binding requirement 3).

### Why standalone ADR-018 (vs in-place amendment of ADR-017 §R5)

The decision space is non-trivial: Path A vs Path B trade-off, SECURITY DEFINER hardening clauses, GRANT scope, REVOKE companion, typing strategy. A buried amendment in ADR-017's risk register would be harder to reference from future audits (e.g., "why is `list_schema_migrations` SECURITY DEFINER?"). A standalone ADR is the cleaner long-term reference.

ADR-017 §R5 is flipped to "Closed — see ADR-018" — the cross-reference is one hop.

### Why LITE depth holds

The decision space was bounded:

- Path election was the user's call (Path B), not architecture's. Architecture closed the implementation details.
- SECURITY DEFINER + hardened search_path + REVOKE/GRANT pattern is well-precedented in this codebase (0048, 0049, 0050). No design invention.
- Typing strategy follows ADR-017 §D4 deferral — no new ground.
- Module boundaries unchanged.
- No new env var, no new contract, no NoonWeb coordination, no UI surface, no observability addition.

The four manual-override blocks in `database.types.ts` stay at 4 (Q3 = a). LITE remains the right depth.

### Why `as never` cast on the RPC name

`client.rpc('list_schema_migrations')` without the cast would fail TypeScript because the generated `Database['public']['Functions']` type does not include the new function. Per Q3 = a (inline cast deferral), we do not augment `Database['public']['Functions']`. The `as never` cast is the supabase-js convention for invoking functions not declared in the generated types; it matches the existing `.schema('supabase_migrations' as never)` pattern in the same file. The cast is co-located with the consumer and removed in a future clean-regen iteration.

---

## Consequences

### Operating

- Production `GET /api/admin/migrations-health` returns 200 + `synced=true` after migration 0052 lands and the adapter ships. The endpoint's externally observable contract is unchanged.
- ADR-017 §R5 closes. The remaining `MigrationsLedgerReadError` failure modes are now (a) service_role loses EXECUTE on `list_schema_migrations` (would require a re-grant migration) and (b) transient Supabase outage.
- The privilege surface narrows from "service_role has unrestricted cross-schema SELECT access via supabase-js's `.schema()` accessor" to "service_role can EXECUTE one specific function that itself runs as `postgres` with a hardened search_path". This is a posture improvement, not a regression.
- B26-SEC-F3 binding is satisfied. The conditional MEDIUM-leaning finding from B26 closes upon this iteration's validator pass.

### Type system

- `database.types.ts` is not touched. Manual override surface stays at 4 blocks.
- The `SchemaMigrationsRow` interface in `ledger-adapter.ts` is reused. No new type added.
- The clean-regen-debt iteration eventually picks up: 4 table overrides + 1 RPC name to declare in `Database['public']['Functions']` + the `as never` cast removed. Deferred consistently with §D4.

### Security review

- A standalone security review of the GRANT scope is mandatory before merge (B26-SEC-F3 binding requirement 3). Verdict must be GATE-OPEN, zero CRITICAL, zero HIGH.

### Reversibility

This ADR is reversible. If migration 0052 must be revoked post-deploy:

1. **SQL rollback** (verbatim from the migration's header comment):
   ```sql
   REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM service_role;
   DROP FUNCTION IF EXISTS public.list_schema_migrations();
   ```
2. **Ledger cleanup** if applied via `supabase db push`:
   ```sql
   DELETE FROM supabase_migrations.schema_migrations
    WHERE version = '0052' AND name = 'phase_20b_list_schema_migrations_rpc';
   ```
3. **Application rollback**: revert the adapter change in `lib/server/migrations/ledger-adapter.ts` `readLedgerRows()` back to the cross-schema `.schema().from().select()`. The endpoint returns to the pre-iteration state: 500 + `MIGRATIONS_READ_FAILED` on production.
4. **ADR-017 §R5 status flips back** to "Open until backend smoke confirms".
5. **This ADR (ADR-018)** is marked Superseded with a dated note explaining the rollback. The standalone security review at `docs/validations/B26-R5 security review 2026-05-20.md` carries a closing note pointing to the rollback.

The rollback is documented in the migration's header comment block so any operator running the rollback has the SQL inline without searching this ADR.

### Risk register

| Risk | Mitigation | Status |
|---|---|---|
| R8 (SECURITY DEFINER search_path injection) | `SET search_path = pg_catalog, supabase_migrations` (no `public` in the path). Security review verifies. | Closed |
| R9 (GRANT scope leak to anon / authenticated) | Explicit REVOKE FROM PUBLIC + REVOKE FROM anon, authenticated **before** GRANT TO service_role. Security review verifies. | Closed |
| R10 (Path B undocumented Supabase restriction) | Backend tests on preview deploy first. If RPC errors at call time, defensive `MigrationsLedgerReadError` surfaces as structured 500. User re-decides; no silent Path A substitution. | Open until backend preview smoke confirms |
| R11 (Migration apply path: `supabase db push` vs Dashboard fallback) | Backend documents apply path used at deploy time. If Dashboard path is used, manual ledger row insert verified before production smoke. | Open until apply path chosen at deploy time |

R10 is the only new risk that backend must confirm empirically (analogous to ADR-017's prior R5). If R10 fires, iteration is BLOCKED per spec §Excluded — no silent Path A substitution.

---

## References

- `specs/fase-2-c-b26-r5-followup-rpc-migration.md` — analysis spec (this ADR's input).
- `docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md` — §D4 (typing precedent) + §R5 (closed by this ADR).
- `docs/adrs/ADR-014-migration-ledger-reconciliation.md` — `supabase_migrations.schema_migrations` row format pin + ledger reconciliation playbook.
- `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` — migration filename convention.
- `docs/validations/B26 security review 2026-05-20.md` §S12 / B26-SEC-F3 — four binding requirements satisfied by this iteration.
- `supabase/migrations/0050_phase_19d_debit_wallet_for_refund_rpc.sql` — canonical SECURITY DEFINER + GRANT EXECUTE + REVOKE precedent in this repo.
- `supabase/migrations/0048_phase_19b_consolidate_earnings_rpc.sql` — earlier RPC precedent (`consolidate_payment_earnings`).
- `supabase/migrations/0049_phase_19c_consolidate_earnings_idempotency_guard.sql` — idempotency guard precedent.
- `lib/server/migrations/ledger-adapter.ts` — call site that flips.
- `app/api/admin/migrations-health/route.ts` — route handler (untouched).
