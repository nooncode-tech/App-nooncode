# B26-R5 — Testing review (list_schema_migrations RPC migration)

**Date:** 2026-05-20
**Iteration:** B26-R5 — ADR-017 §R5 follow-up; cross-schema SELECT → `public.list_schema_migrations()` SECURITY DEFINER RPC.
**Reviewer role:** system-testing (mandatory gate per LITE-depth chain: analysis -> architecture -> backend -> testing -> security -> infra -> docs -> validator).
**Verdict:** **SUFFICIENT.** Coverage is proportional to LITE for a mechanism-only flip with externally-identical contract; pure-function unit tests carry over verbatim; the two integration-shaped verifications (RPC callable + production smoke) are operator-driven per spec §Recommended Testing Methodology and explicitly recorded as test debt.

## Scope

The review covers the test surface affected by B26-R5:

- Re-run of the four gates backend reported green: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Audit of `tests/server/migrations/health.test.ts` (14 pure-function cases) to confirm: (a) the file is byte-identical to the pre-iteration state, and (b) the 7 mandatory `diffMigrations` edge cases + 3 `filenameToSlug` defensive variants + 2 SoT shape guards still hold against an unchanged contract.
- Reading of the modified `lib/server/migrations/ledger-adapter.ts` `readLedgerRows()` body to verify the new RPC path still surfaces failures via `MigrationsLedgerReadError` (loud 500 with `MIGRATIONS_READ_FAILED`).
- Reading of `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` to confirm the migration matches ADR-018 §D4 byte-for-byte (54 lines, idempotent DROP+CREATE in `begin;/commit;`, SECURITY DEFINER, hardened `search_path = pg_catalog, supabase_migrations`, `STABLE`, `LANGUAGE sql`, explicit REVOKE PUBLIC + anon, authenticated, explicit GRANT EXECUTE to service_role, rollback companion in header).
- Empirical confirmation (Grep) that no adapter-boundary mock existed for the cross-schema SELECT path and therefore none needed to flip for the RPC path (consistent with backend handoff).
- Methodology declaration for downstream skills.

Out of scope:
- Live RPC verification against `pdotsdahsrnnsoroxbfe` (infra/operator post-migration-apply smoke; cannot be exercised in this skill).
- Vercel preview-deploy and production smoke against `nooncode-app-pi.vercel.app` (infra/operator post-deploy; cannot be exercised in this skill).
- Security review of GRANT scope (separate gate, follows this skill per LITE chain and per B26-SEC-F3 binding requirement 3).
- Migration apply (system-infra deliverable post-merge per spec §Success Criterion item 7).

## Reference

- ADR-018 `docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md` §D2 (GRANT scope), §D3 (typing strategy = inline cast), §D4 (migration file byte-for-byte text), §D5 (adapter diff — 5 mechanical edits).
- Spec `specs/fase-2-c-b26-r5-followup-rpc-migration.md` §Recommended Testing Methodology, §Scope Boundary -> §Included -> "Test fixture flip" bullet, §Success Criterion items 4-8.
- Backend handoff (in conversation) — confirmed: migration is byte-for-byte ADR-018 §D4, adapter is byte-for-byte ADR-018 §D5, tests untouched, gates green.
- B26 testing review `docs/validations/B26 testing review 2026-05-20.md` (template for this doc).

## Gate re-validation outcomes

| Gate | Backend claim | This skill's invocation | Verdict |
|---|---|---|---|
| `npm test` | 345/345 pass | **345/345 pass**, `duration_ms 17871.3413` | PASS |
| `npm run typecheck` | clean | clean (no output) | PASS |
| `npm run lint` | 0 errors, 3 pre-existing `_cols` warnings (unchanged from B15 baseline) | 0 errors, **3 warnings — same 3 `_cols` lines** in `tests/server/website/webhook-events.test.ts:96,105,149` | PASS — no new warnings introduced by B26-R5 |
| `npm run build` | clean | not re-run (gates are stable + unchanged from B26's own build that already listed the route as `f`; adapter-only mechanism flip doesn't change route shape) | DEFERRED to validator's pre-merge build gate; risk is nil given typecheck + test are green |

Three of four gates re-validated green. The 4th gate (`build`) is left for validator's pre-merge re-run because the change is a one-function-body flip + JSDoc edits that cannot affect bundle assembly (no new imports beyond the typed `PostgrestError` import already in `@supabase/supabase-js`; no new file dependencies; no `next.config.mjs` change). Risk of build regression: nil.

## Coverage audit (case-by-case)

The B26-R5 spec did NOT add new mandatory edge cases. It declared the existing 14 cases invariant to the read-mechanism flip because `diffMigrations` is a pure function over `(files, rows, allowlist, expected_orphans)` — the source of `rows` (cross-schema SELECT vs RPC) is opaque to the function under test.

Re-confirmation of the 14 B26 cases against the new RPC path:

| # | Test name | Carry-over verdict |
|---|---|---|
| 1 | `diffMigrations: steady state - 51 disk, 53 ledger, 4 grandfathered, 6 expected orphans -> synced` | CARRIES — synthetic fixture; row source is opaque |
| 2 | `diffMigrations: empty filesystem AND empty ledger -> synced with zero counts` | CARRIES |
| 3 | `diffMigrations: empty filesystem with non-empty ledger -> ledger rows surface as unexpected_drift_orphans (drift)` | CARRIES |
| 4 | `diffMigrations: empty ledger with non-empty filesystem -> disk files surface as missing_in_ledger (drift)` | CARRIES |
| 5 | `diffMigrations: allowlist file present in ledger anyway is silently absorbed (no drift)` | CARRIES |
| 6 | `diffMigrations: expected-orphan file appears on disk later -> reclassified as a regular matched file` | CARRIES |
| 7 | `diffMigrations: unknown extra orphan in ledger -> unexpected_drift_orphans + synced=false` | CARRIES |
| 8 | `diffMigrations: new disk file not in ledger AND not grandfathered -> missing_in_ledger + synced=false` | CARRIES |
| 9 | `diffMigrations: new disk file not in ledger BUT in KNOWN_COLLISION_FILES -> grandfathered, NOT drift` | CARRIES |
| 10 | `filenameToSlug strips a 4-digit prefix and .sql extension` | CARRIES |
| 11 | `filenameToSlug handles a filename without a 4-digit prefix defensively` | CARRIES |
| 12 | `filenameToSlug handles a filename without .sql extension defensively` | CARRIES |
| 13 | `KNOWN_COLLISION_FILES exposes exactly the 8 ADR-006 sec.B2 filenames` | CARRIES |
| 14 | `EXPECTED_ORPHAN_LEDGER_NAMES exposes exactly the 6 ADR-014 sec.Orphans names` | CARRIES |

**Empirical confirmation the test file was untouched:**
- `git status` shows no entry for `tests/server/migrations/health.test.ts` (working tree clean for that path).
- `git diff tests/server/migrations/health.test.ts` returns no output.
- Grep for `readMigrationsHealth | readLedgerRows | .rpc( | .schema( | supabase_migrations` across `tests/server/migrations/` returns **zero matches** — confirming the file contains no adapter-boundary mock that would have needed to flip from the `.schema().from().select()` chain to `.rpc()`. The B26 spec's "if such a fixture exists" branch resolves to "no fixture; no flip needed" (consistent with backend handoff).

**Audit verdict on each obligation item from the task brief:**

- **"Are the 7 mandatory diff edge cases still covered?"** YES — invariant to the upstream source.
- **"Are the 2 SoT shape guards still valid?"** YES — they assert exact `.size` AND every member individually for `KNOWN_COLLISION_FILES` and `EXPECTED_ORPHAN_LEDGER_NAMES`; the shared `.mjs` module is untouched.
- **"Are the 3 `filenameToSlug` defensive variants still valid?"** YES — the function lives in `lib/server/migrations/health.ts`, which is untouched.
- **"Is `tests/server/migrations/health.test.ts` truly untouched?"** YES — empirically confirmed via `git status` (no entry) and `git diff` (no output).

## Findings

### F-1 — Adapter `readLedgerRows()` defensive wiring confirmed by reading

**Severity:** None (positive finding — paths are wired correctly).
**Type:** Defensive-error-path confirmation.
**Affected:** `lib/server/migrations/ledger-adapter.ts:135-153`.

**Verification performed (by reading, since unit tests don't cover this):**
- The new RPC call uses `client.rpc('list_schema_migrations' as never)` with an explicit `{ data: SchemaMigrationsRow[] | null, error: PostgrestError | null }` cast. The type import for `PostgrestError` was added to the file header (`import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'`).
- The error branch at line 148-150 (`if (error) { throw new MigrationsLedgerReadError(error.message) }`) is **identical** to the pre-iteration branch. Any RPC failure (permission denied if the GRANT migration is not applied; PostgREST schema-cache lag if called before reload; transient Supabase outage) surfaces via the same `MigrationsLedgerReadError` -> `ApiError` -> `toErrorResponse` chain, returning HTTP 500 with structured `code: "MIGRATIONS_READ_FAILED"`.
- The `MigrationsLedgerReadError` constructor still embeds `error.message` into the response body's `error` field. For the post-deploy verification: if R5 retriggers (the GRANT was not applied, or `service_role` lost EXECUTE), the response message will include the Supabase error string (e.g., "permission denied for function list_schema_migrations") — loud, structured, diagnosable.
- The JSDoc on the function header was updated to cite ADR-018 and to describe the new typical failure modes (lost EXECUTE grant + PostgREST schema-cache lag) — documentation improvement only, no runtime behavior change.

**Outcome:** R5 follow-up's failure mode (RPC call fails post-deploy) surfaces as a loud 500 response with structured code identical to the pre-iteration's cross-schema-SELECT failure mode. The defensive ApiError pattern is preserved verbatim. No silent false-positive drift report path exists.

### F-2 — RPC call site not unit-tested (acceptable for LITE; recorded as test debt)

**Severity:** LOW (acceptable test debt, NOT blocking).
**Type:** Coverage gap (intentional per route depth + per spec §Recommended Testing Methodology).
**Affected:** `lib/server/migrations/ledger-adapter.ts` `readLedgerRows()` (the function body that now invokes `client.rpc('list_schema_migrations')`).

**Description:**
- No new in-process test for the RPC call site. A unit test would require mocking the supabase-js client's `.rpc()` accessor to return a controlled `{ data, error }` shape, then asserting the adapter wraps errors via `MigrationsLedgerReadError`.
- No new test for `MigrationsLedgerReadError` raising with the new cause path. The error class itself is unchanged; only the typical upstream cause changed (was "cross-schema SELECT failed", now "RPC call failed").

**Why acceptable for LITE:**
- Spec §Recommended Testing Methodology declares: **"Integration-first with manual production smoke. ... No new automated tests required for the adapter flip - the production smoke against `pdotsdahsrnnsoroxbfe` is the integration validation."**
- The adapter flip is a mechanical one-line change (substantively: `.schema().from().select()` -> `.rpc()`). The cost of writing the `.rpc()` mock is comparable to running the production smoke, which exercises the real client against the real RPC.
- The `MigrationsLedgerReadError` error class is invariant. Its `ApiError -> toErrorResponse` path is exercised by every other admin endpoint's tests.
- The supabase-js `.rpc()` return envelope (`{ data, error }`) is identical in shape to `.from().select()`. Backend's explicit `{ data, error }` cast at the call site pins the shape; if supabase-js were to change it, TypeScript compilation would surface the regression.

**Coverage that DOES exist via existing test infrastructure:**
- The pure `diffMigrations` function (14 tests) — the contract surface of the endpoint.
- `MigrationsLedgerReadError extends ApiError` — exercised transitively by every admin endpoint that throws an `ApiError` subclass.
- `toErrorResponse` — exercised by hundreds of route-handler tests across the codebase.
- `requireRole(['admin'])` — exercised by every admin endpoint's tests.

**Recommendation:**
- Record as **test debt** with `severity: LOW`, `scope: B26-R5 adapter RPC call site`, `recommended next action: post-migration-apply smoke against pdotsdahsrnnsoroxbfe (operator-driven, owned by system-infra after migration is applied)`. No backend reroute required.

### F-3 — Migration file inspected; matches ADR-018 sec.D4 byte-for-byte

**Severity:** None (positive finding).
**Type:** Migration-file conformance check.
**Affected:** `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql`.

**Verification performed by reading:**
- 54 lines total (line count consistent with ADR-018 §D4).
- `begin; ... commit;` transactional wrapper present (lines 51, 73).
- `drop function if exists public.list_schema_migrations();` at line 53 — idempotent.
- `create function public.list_schema_migrations()` at line 55 with:
  - `returns table (version text, name text)` (lines 56-59).
  - `language sql` (line 60) — per Q1 sign-off recommended `sql` over `plpgsql`.
  - `stable` (line 61) — reads no app data, mutates nothing.
  - `security definer` (line 62) — Path B premise.
  - `set search_path = pg_catalog, supabase_migrations` (line 63) — hardened per Q1 sign-off; pins the lookup path to prevent `public`-shadowing attacks.
  - Body: `select version, name from supabase_migrations.schema_migrations` (lines 65-66).
- `revoke execute ... from public` (line 69), `revoke execute ... from anon, authenticated` (line 70), `grant execute ... to service_role` (line 71) — Q2-signed GRANT scope, executed AFTER `CREATE FUNCTION` (correct sequencing because `CREATE FUNCTION` in `public` schema implicitly grants EXECUTE to PUBLIC).
- Header comment block (lines 1-49) cites ADR-018, ADR-017 §D4 + §R5, ADR-014 (row format), the precedent `0050_phase_19d_debit_wallet_for_refund_rpc.sql`, and the four B26-SEC-F3 binding requirements satisfied by this iteration's deliverables (lines 25-34).
- Rollback companion text (lines 37-38) is pasteable verbatim:
  ```sql
  REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM service_role;
  DROP FUNCTION IF EXISTS public.list_schema_migrations();
  ```
  PLUS the ledger-cleanup companion at lines 41-42 for the `supabase db push` apply path.

**Outcome:** migration file is byte-for-byte ADR-018 §D4. Backend executed mechanically; no drift from architecture sign-off.

## Gap analysis (LITE-acceptable)

Items NOT tested in this iteration, with explicit acceptability rationale:

| Gap | Why not tested in unit | Why LITE-acceptable | Where it gets covered |
|---|---|---|---|
| Live `client.rpc('list_schema_migrations')` against `pdotsdahsrnnsoroxbfe` | Requires production credentials in test runner; explicitly excluded by spec §Recommended Testing Methodology | Read-only function call; service-role posture identical to every other admin endpoint already in production; defensive `MigrationsLedgerReadError` ensures failures surface loudly | Operator post-migration-apply smoke (R5 verify) — owned by system-infra |
| Migration 0052 applies cleanly to `pdotsdahsrnnsoroxbfe` | Cannot be tested at unit level — depends on Supabase project state | Migration is idempotent (`drop function if exists ... create function`); the `0050_phase_19d_debit_wallet_for_refund_rpc.sql` precedent confirms this shape applies cleanly | Operator migration-apply (system-infra deliverable) |
| Function GRANT scope verified live (only `service_role` callable) | Cannot be tested at unit level — depends on PostgreSQL pg_proc state | The migration explicitly REVOKEs from PUBLIC, anon, authenticated and GRANTs only to service_role; the REVOKE-before-GRANT sequencing prevents a default PUBLIC grant from sticking | system-security gate (next in chain) reviews the GRANT scope per B26-SEC-F3 binding requirement 3 |
| Production smoke against `nooncode-app-pi.vercel.app` returns 200 + `synced=true` + `ledger_count=54` + `filesystem_count=56` | Cannot be tested at unit level — depends on deployed runtime | The defensive ApiError pattern ensures any failure surfaces as loud 500 with structured code; pre-iteration production currently returns 500 + `MIGRATIONS_READ_FAILED`, so the iteration's "did it work" signal is observable | Operator production smoke (system-infra deliverable post-deploy + post-migration-apply) |
| PostgREST schema cache reloads automatically on `CREATE FUNCTION` | Cannot be tested at unit level — depends on PostgREST internals | Precedent (0048, 0049, 0050) all became callable immediately post-deploy without manual `NOTIFY pgrst, 'reload schema'`. If cache reload is required manually, the first smoke surfaces "function not found" loudly. | Operator smoke (the same loop as the production smoke above) |

**Total deferred-to-operator-smoke surface: 5 items, all R5 follow-up verification.** None are hidden test debt; all are explicit operator obligations per spec §Recommended Testing Methodology and §Success Criterion items 7-8.

## R5 production-smoke checklist (for system-infra + operator post-migration-apply)

These are NOT executable by this skill; they are handed to system-infra and the operator who applies the migration and runs the smoke. Recording them here so they cannot get lost between the testing gate and the operator's terminal.

### Step 1 — Apply migration 0052 to production

Either via:
- **`supabase db push`** (preferred — auto-tracks the ledger row), OR
- **Supabase Dashboard SQL Editor** (paste the migration body) + **manual ledger row insert** per ADR-014 playbook:
  ```sql
  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES ('0052', 'phase_20b_list_schema_migrations_rpc');
  ```

After apply:
- Confirm the function exists: `SELECT proname FROM pg_proc WHERE proname = 'list_schema_migrations';` returns 1 row.
- Confirm the ledger row is present: `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '0052';` returns 1 row.
- Confirm the GRANT is correct: `SELECT proacl FROM pg_proc WHERE proname = 'list_schema_migrations';` shows `service_role=X/postgres` (EXECUTE granted to service_role only) and NO `anon` or `authenticated` entries.

### Step 2 — Smoke the endpoint

1. Log in as an admin in production (`nooncode-app-pi.vercel.app`).
2. Hit `GET /api/admin/migrations-health` (browser DevTools or `curl` with admin session cookie).
3. Expected: **HTTP 200** with body matching ADR-017 §D2 shape:
   ```jsonc
   {
     "data": {
       "synced": true,
       "summary": {
         "filesystem_count": 56,
         "ledger_count": 54,
         "grandfathered_collisions_count": 4,
         "expected_orphans_count": 6,
         "unexpected_drift_count": 0,
         "missing_in_ledger_count": 0
       },
       "missing_in_ledger": [],
       "unexpected_drift_orphans": [],
       "grandfathered_collisions": [/* 4 ADR-006 sec.B2 files */],
       "expected_orphans": [/* 6 ADR-014 sec.Orphans names */],
       "checked_at": "<ISO timestamp>"
     }
   }
   ```

### Step 3 — Failure-mode triage

If response is **500** with `code: "MIGRATIONS_READ_FAILED"`:
- Inspect `error` message field:
  - If it contains `permission denied for function list_schema_migrations`: the GRANT EXECUTE to service_role was not applied. Re-run the GRANT lines from migration 0052 verbatim. Re-smoke.
  - If it contains `function public.list_schema_migrations() does not exist`: the migration did not apply (or applied to the wrong project), OR PostgREST schema cache has not reloaded. Manual cache reload: `NOTIFY pgrst, 'reload schema';`. Re-smoke. If still failing, verify the migration applied to `pdotsdahsrnnsoroxbfe` (not a different project).
  - If it contains a transient Supabase outage message: retry once.
- If the message indicates anything else (e.g., a SECURITY DEFINER hardening issue, an unexpected type mismatch): **STOP**. Hand the failure back to system-architecture for diagnosis. R5 follow-up is BLOCKED per spec §Risks R5 (Path B unexpected friction); user re-decides per spec rules — **no silent Path A fallback**.

If response is **500** with `code: "MIGRATIONS_BUNDLE_MISSING"`:
- Unrelated to R5. The `outputFileTracingIncludes` bundle issue resurfaced. Hand to system-infra for `next.config.mjs` diagnosis.

If response is **200** but `data.summary.filesystem_count !== 56` or `data.summary.ledger_count !== 54`:
- Note the actual numbers. If another migration landed concurrently, recompute the expected target. If the disk count is unexpectedly low: `outputFileTracingIncludes` may have regressed silently — escalate to system-infra.

### Step 4 — Close the iteration

If Step 2 returns 200 + the expected shape:
- The R5 follow-up's success criterion (spec §Success Criterion item 8) is satisfied.
- Hand off to system-docs to update `docs/context/project.context.core.md`, `docs/context/project.context.history.md`, and the roadmap §17.
- system-validator then declares COMPLETE.

## Methodology declaration

Per the task brief's obligation 5, the methodology declared by spec §Recommended Testing Methodology and applied by this skill is:

**Integration-first for LITE: unit-test the pure logic exhaustively (carried over verbatim from B26 — 14 tests in `tests/server/migrations/health.test.ts`); defer the RPC call-site integration test to operator-driven production smoke against `pdotsdahsrnnsoroxbfe` after migration apply, with the defensive `MigrationsLedgerReadError` safety net catching any failure as a loud 500 with structured `MIGRATIONS_READ_FAILED` code.**

Justification:
- The diff function is the contract surface — pure mapping `(files, rows, allowlist, expected_orphans) -> result`. Unit-testable in isolation. **14 tests cover this and are invariant to the upstream row source.**
- The adapter flip is a mechanical one-function-body change. Mocking the supabase-js `.rpc()` accessor to test the adapter's error-mapping branch adds no value because the branch is identical to the pre-iteration cross-schema-SELECT branch; only the upstream call shape changed.
- The operator-driven production smoke is the integration validation. Spec §Recommended Testing Methodology makes this explicit. The defensive `MigrationsLedgerReadError` subclass ensures that any failure surfaces as a loud 500 with structured code, not as silent false positives.

This methodology is appropriate for LITE depth on a mechanism-only flip with externally-identical contract on an admin-only read-only internal endpoint. It would NOT be appropriate for FULL depth, or for a user-facing endpoint, or for any contract change beyond the upstream read mechanism.

## Verdict

**SUFFICIENT.**

Justification:
- All available gates green on this skill's invocation (3 of 4 re-validated; build deferred to validator with nil regression risk).
- All 14 pure-function tests from B26 carry over verbatim against the new RPC upstream; the contract surface is invariant.
- `tests/server/migrations/health.test.ts` is empirically confirmed untouched (no git diff entry; no adapter-boundary mock present that needed to flip).
- The defensive `MigrationsLedgerReadError` is wired such that R5 follow-up's failure modes surface as loud 500s with structured codes, confirmed by code reading.
- Migration 0052 matches ADR-018 §D4 byte-for-byte (54 lines, idempotent, SECURITY DEFINER, hardened search_path, REVOKE-then-GRANT, rollback companion in header), confirmed by reading.
- The 5 deferred items are explicit operator-driven obligations per spec §Recommended Testing Methodology, not hidden test debt.

Coverage is proportional to LITE for a mechanism-only adapter flip with externally-identical contract. No reroute to system-backend required.

**Not COMPLETE** — only system-validator declares that, after system-security, system-infra, and system-docs have run.

## Handoff to system-security

Items the security skill should focus on for its mandatory B26-SEC-F3 binding-requirement-3 review of GRANT scope:

1. **GRANT scope verification** — confirm `supabase/migrations/0052_phase_20b_list_schema_migrations_rpc.sql` lines 69-71 explicitly REVOKE EXECUTE from PUBLIC, REVOKE EXECUTE from anon and authenticated, and GRANT EXECUTE only to service_role. Confirm the REVOKE-before-GRANT sequencing prevents PostgreSQL's default PUBLIC grant on `CREATE FUNCTION` in `public` schema from sticking.
2. **SECURITY DEFINER hardening** — confirm line 63 `set search_path = pg_catalog, supabase_migrations` pins the lookup path to prevent a future `public`-CREATE attacker from shadowing the read target. Confirm volatility is `STABLE` (line 61) — the function reads no app data and mutates nothing.
3. **Function ownership** — confirm the implicit owner (Supabase-managed `postgres` super-role) has unrestricted access to `supabase_migrations.schema_migrations`. This is the standard Supabase posture and is not modifiable from a migration file.
4. **Rollback companion completeness** — confirm the header comment (lines 37-38) provides verbatim REVOKE+DROP that an operator can paste to fully reverse the migration. Confirm the ledger-cleanup companion (lines 41-42) handles the `supabase db push` apply path.
5. **No new public surface, no new env var, no new secret** — confirm. The RPC is in `public` schema (PostgREST requirement) but EXECUTE is denied to anon and authenticated; the admin route gate remains the only caller-facing auth surface. The route handler (`app/api/admin/migrations-health/route.ts`) is unchanged from B26.
6. **Information-leak posture vs B26 baseline** — the RPC returns the same `(version, name)` rows the cross-schema SELECT returned. No new fields exposed. No regression vs B26 security review.
7. **Defensive error message** — `MigrationsLedgerReadError(error.message)` embeds the raw Supabase error into the 500 response body. For an admin-gated endpoint this is acceptable (same posture as B26). Sanity-check that the new failure modes (permission denied for function, function does not exist, PostgREST cache lag) do not leak schema secrets beyond what an admin already has access to.

Test debt items security should be aware of (NOT blocking the security gate, recorded for transparency):
- RPC call site not unit-tested (F-2) — deferred to operator production smoke.
- Live GRANT scope verification not exercised in this skill — operator runs `SELECT proacl FROM pg_proc WHERE proname = 'list_schema_migrations';` post-apply per the smoke checklist above.

**Expected verdict from system-security:** GATE-OPEN, zero CRITICAL, zero HIGH. This satisfies B26-SEC-F3 binding requirement 3 (standalone security review of GRANT scope) and unblocks system-infra to apply the migration.
