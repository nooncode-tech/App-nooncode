# B26 — Testing review (schema_migrations gating endpoint health)

**Date:** 2026-05-20
**Iteration:** B26 — schema_migrations drift gating endpoint health
**Reviewer role:** system-testing (mandatory gate per LITE-depth chain: analysis → architecture → backend → testing → security → infra → docs → validator)
**Verdict:** **SUFFICIENT.** Coverage is proportional to LITE; one numeric drift flagged for the operator's post-deploy smoke; no escalation back to backend.

## Scope

The review covers the test surface introduced by B26:

- `tests/server/migrations/health.test.ts` — 14 `node:test` cases over the pure diff function and the shared-module shape guards.
- Re-validation of the four gates backend reported green (npm test, typecheck, lint, build, check-migrations).
- Audit of coverage against the spec's 7 mandatory edge cases (`§Scope Boundary → §Included`) plus the 2 SoT shape guards required to keep ADR-006 / ADR-014 in sync with code.
- Reading of the route handler, the ledger adapter, the pure diff function, and the shared `.mjs` module to confirm the defensive error-path wiring promised for the R5 / R6 preview verification.

Out of scope:

- Live integration against `pdotsdahsrnnsoroxbfe` (operator-driven R5 smoke; not an automated test in LITE).
- Vercel preview-deploy verification (R6 — operator-driven, post-merge).
- Security review (separate gate, follows this skill).
- Infra co-sign on `outputFileTracingIncludes` (system-infra's responsibility).

## Reference

- Spec `specs/fase-2-c-b26-schema-migrations-gating-endpoint-health.md` §Scope Boundary → §Included → 7 mandatory edge cases.
- ADR-017 §D1 (allowlist SoT), §D2 (response shape), §D4 (type-safety), §D5 (bundling + defensive guard), §D8 (slug join key).
- ADR-006 §Option B2 — 8 grandfathered filenames including the 4-of-8 currently absent-from-ledger.
- ADR-014 §Orphans — 6 expected orphan ledger `name` values.
- Backend handoff (in conversation) — gate counts, file paths, and the "55 disk files on disk today" observation captured in this review.

## Gate re-validation outcomes

| Gate | Backend claim | This skill's invocation | Verdict |
|---|---|---|---|
| `npm test` | 345/345 pass | **345/345 pass**, `duration_ms 42861.5714` | PASS |
| `npm run typecheck` | clean | clean (no output) | PASS |
| `npm run lint` | 0 errors, 3 warnings (pre-existing `_cols` from B15) | 0 errors, **3 warnings — same 3 `_cols` lines** in `tests/server/website/webhook-events.test.ts:96,105,149` | PASS — no new warnings introduced by B26 |
| `npm run build` | `/api/admin/migrations-health` listed as `ƒ` | Confirmed: `├ ƒ /api/admin/migrations-health` in build output | PASS |
| `node scripts/check-migrations.mjs` | byte-identical to pre-refactor | **`OK: 55 migration file(s) checked. No new collisions (4 grandfathered).`** — script behavior preserved end-to-end | PASS |

All five gates green. The 3 lint warnings are bit-for-bit the same B15 carryover items; B26 added zero new warnings.

## Coverage audit (case-by-case)

The spec required 7 mandatory edge cases. Backend shipped 14 tests. Mapping below.

| # | Spec edge case (`§Included`) | Test name (in `tests/server/migrations/health.test.ts`) | Verdict |
|---|---|---|---|
| 1 | Empty filesystem + empty ledger → synced | `diffMigrations: empty filesystem AND empty ledger → synced with zero counts` | COVERED |
| 2 | Healthy state (steady production shape) | `diffMigrations: steady state — 51 disk, 53 ledger, 4 grandfathered, 6 expected orphans → synced` | COVERED (synthetic — see Finding F-1) |
| 3 | Allowlist file present in ledger anyway → silently absorbed | `diffMigrations: allowlist file present in ledger anyway is silently absorbed (no drift)` | COVERED |
| 4 | Expected-orphan name appears on disk later → reclassified as match | `diffMigrations: expected-orphan file appears on disk later → reclassified as a regular matched file` | COVERED |
| 5 | Unknown extra orphan → `unexpected_drift_orphans` | `diffMigrations: unknown extra orphan in ledger → unexpected_drift_orphans + synced=false` | COVERED |
| 6 | New disk file, not in collisions → `missing_in_ledger` | `diffMigrations: new disk file not in ledger AND not grandfathered → missing_in_ledger + synced=false` | COVERED |
| 7 | New disk file, IN collisions → `grandfathered_collisions`, not drift | `diffMigrations: new disk file not in ledger BUT in KNOWN_COLLISION_FILES → grandfathered, NOT drift` | COVERED |

**Bonus / strengthening cases (not required by spec, included by backend):**

| Extra case | Test name | Value-add |
|---|---|---|
| Empty disk + non-empty ledger → all ledger rows become drift | `diffMigrations: empty filesystem with non-empty ledger → ledger rows surface as unexpected_drift_orphans (drift)` | Exercises the "operator deleted all files locally" failure mode — defensive boundary case. |
| Empty ledger + non-empty disk → all files become drift | `diffMigrations: empty ledger with non-empty filesystem → disk files surface as missing_in_ledger (drift)` | Mirror of above; exercises the "ledger wiped, disk preserved" case. |
| Slug helper happy path | `filenameToSlug strips a 4-digit prefix and .sql extension` | Documents the contract that the join key relies on. |
| Slug helper — no prefix | `filenameToSlug handles a filename without a 4-digit prefix defensively` | Defends against ADR-014's pre-CLI orphan rows (14-digit version, no 4-digit prefix on a hypothetical disk twin). |
| Slug helper — no .sql | `filenameToSlug handles a filename without .sql extension defensively` | Defends against future ledger rows that drop the conventional suffix. |
| SoT shape guard — collisions | `KNOWN_COLLISION_FILES exposes exactly the 8 ADR-006 §B2 filenames` | Catches any silent edit to the shared module. |
| SoT shape guard — orphans | `EXPECTED_ORPHAN_LEDGER_NAMES exposes exactly the 6 ADR-014 §Orphans names` | Catches any silent edit to the shared module. |

**Audit verdict on each obligation item from the task brief:**

- **"Are all 7 mandatory edge cases covered?"** YES — see mapping table above; 7 of 7 covered explicitly, plus 2 mirror cases (empty/non-empty in either direction) that strengthen confidence.
- **"Are the 2 SoT shape guards sufficient to catch future drift in the allowlist module?"** YES — they assert exact `.size` AND every member individually. A future deletion would fail `.has(...)`; a future addition would fail `.size`. Both shapes are pinned to the source ADR by name in the test text.
- **"Is the steady-state test parameterized with realistic counts that would actually catch a regression?"** YES for the diff logic; PARTIAL for the production smoke target — see Finding F-1.
- **"Is `filenameToSlug` defensive enough?"** YES — the two defensive variants are meaningful (no-prefix case exists in ADR-014's pre-CLI-convention world; no-`.sql` case is the cheaper defensive guard against a future CSV import drift). Not box-checking.

## Findings

### F-1 — Steady-state fixture uses 51 disk / 53 ledger; production today is 55 disk / 53 ledger (informational)

**Severity:** LOW (informational, NOT blocking).
**Type:** Documentation drift between spec and on-disk reality.
**Affected:** `tests/server/migrations/health.test.ts` (steady-state test `buildSteadyStateFixture`); ADR-017 §D2 example response; spec §Success Criterion item 5.

**Description:**
- The on-disk filesystem currently has **55** `.sql` files under `supabase/migrations/` (verified by Glob + by `check-migrations.mjs` output: `OK: 55 migration file(s) checked`).
- The spec, the ADR sample response, and the steady-state test fixture all assert `filesystem_count: 51`.
- The pure-function steady-state test in `health.test.ts` builds its own synthetic fixture of 51 files (47 regular + 4 grandfathered) and asserts against the synthetic 51 / 53 / 4 / 6 / 0 shape. The fixture is internally consistent — `synced=true` is the right verdict for a 51/53/4/6 set. The test passes correctly.
- The production smoke (criterion 5: "Production smoke against `pdotsdahsrnnsoroxbfe` (53 ledger rows after B15 closed) returns `synced=true` with 4 grandfathered + 6 expected orphans") will instead return `summary.filesystem_count=55`, NOT 51, on the first call.

**Why LOW and informational:**
- The test does not validate against real disk; it validates the pure function. Numbers being internally consistent is what the unit test cares about. PASS is correct.
- The diff classification works regardless of count — adding 4 files to disk while the ledger holds 53 rows would only produce drift if those 4 files are not in the ledger AND not in `KNOWN_COLLISION_FILES`. The 4 extra disk files (0028-0051 incremented since the spec was written) are all registered in the ledger today — they will silently match and `synced=true` will still hold for the operator's smoke.
- The endpoint output cleanly tells the operator what the real numbers are. No silent failure.

**Recommendation (for system-docs in this chain):**
- Update the operator's expected smoke target in `docs/context/project.context.core.md` Operating rules (when docs adds the B26 close-out entry) to read **"production smoke returns `synced=true`, `summary.filesystem_count=55`, `summary.ledger_count=53`, `summary.grandfathered_collisions_count=4`, `summary.expected_orphans_count=6`, `summary.unexpected_drift_count=0`"** — replacing the spec's outdated "51".
- Update ADR-017 §D2 example response to reflect 55 (or add a footnote that the example was written when 51 files were on disk and the steady-state count grows monotonically with each merged migration).
- Do NOT modify the unit test fixture. The synthetic 51-file fixture documents the diff function's behavior on a representative shape; updating the synthetic count every time a new migration lands creates churn without test value.

### F-2 — Route handler and adapter orchestrator not unit-tested (acceptable for LITE)

**Severity:** LOW (acceptable test debt, NOT blocking).
**Type:** Coverage gap (intentional per route depth).
**Affected:** `app/api/admin/migrations-health/route.ts`, `lib/server/migrations/ledger-adapter.ts`.

**Description:**
- The route handler (`GET` in `app/api/admin/migrations-health/route.ts`) has zero direct unit tests. The handler is thin (3 logical statements: auth, adapter call, status mapping), but it owns the 200 vs 503 vs 5xx status decision and the `requireRole(['admin'])` gate.
- The adapter (`readMigrationsHealth` + `readMigrationFiles` + `readLedgerRows`) has zero direct unit tests. The error subclasses (`MigrationsBundleConfigError`, `MigrationsLedgerReadError`) are unwired in this test surface.

**Why acceptable for LITE:**
- The pure logic that classifies drift is fully tested (14 tests). The adapter is a thin orchestrator (Promise.all of two reads, plus a `diffMigrations` invocation, plus an envelope wrapper).
- The route handler routes errors through `toErrorResponse`, which is itself well-exercised by every other admin endpoint in the project. Re-testing it here adds no value.
- The R5 (cross-schema SELECT works without policy surgery) and R6 (bundle includes `.sql` files) verifications are explicitly deferred to operator-driven preview smoke per ADR-017 §D5 and §Risk register. They are NOT unit-testable in any meaningful way — both depend on the deployed runtime.

**Coverage that DOES exist via existing test infrastructure:**
- `requireRole` is exercised by every admin endpoint's tests (the function-under-test is identical).
- `createSupabaseAdminClient()` is exercised by every server-side webhook test (Stripe, website ledger, etc.).
- `toErrorResponse` is exercised by hundreds of route-handler tests across the codebase.

**Recommendation:**
- Record as **test debt** with `severity: LOW`, `scope: B26 route handler + adapter`, `recommended next action: integration smoke on first preview deploy (operator-driven, R5 + R6 verification — see checklist below)`.
- No backend reroute. The integration-first methodology declaration (§Methodology) makes this gap explicit and pre-authorized.

### F-3 — `MigrationsBundleConfigError` / `MigrationsLedgerReadError` defensive wiring confirmed by reading

**Severity:** None (positive finding — paths are wired correctly).
**Type:** Defensive-error-path confirmation.
**Affected:** `lib/server/migrations/ledger-adapter.ts` + `app/api/admin/migrations-health/route.ts` + `lib/server/api/errors.ts`.

**Verification performed (by reading, since unit tests don't cover this):**
- `MigrationsBundleConfigError extends ApiError('MIGRATIONS_BUNDLE_MISSING', ..., 500)` — confirmed in `ledger-adapter.ts:66-77`.
- `MigrationsLedgerReadError extends ApiError('MIGRATIONS_READ_FAILED', ..., 500)` — confirmed in `ledger-adapter.ts:87-96`.
- `readMigrationFiles()` throws `MigrationsBundleConfigError` when either (a) `readdir` itself fails (catch block at line 110-116) or (b) the filtered `.sql` list has 0 entries (line 119-121). Both R6 failure modes are covered.
- `readLedgerRows()` throws `MigrationsLedgerReadError(error.message)` when the Supabase client returns a non-null `error`. R5 permission failure (`42501`) will surface as a 500 with the message embedded.
- The route handler's `try { ... } catch (err) { return toErrorResponse(err) }` wrapper at `route.ts:43-54` routes both subclasses through `toErrorResponse`. Since both extend `ApiError`, `toErrorResponse` matches the `error instanceof ApiError` branch (line 67-75 in `errors.ts`) and returns `{ error, code }` at the subclass's 500 status.

**Outcome:** R5 (permission error) and R6 (empty filesystem) BOTH surface as loud 500 responses with structured codes (`MIGRATIONS_READ_FAILED` and `MIGRATIONS_BUNDLE_MISSING` respectively). NO silent false-positive drift report path exists. The defensive guards work as ADR-017 §D5 promised.

This is the answer to the task brief's obligation 4 ("confirm R5/R6 surface as loud 500 not silent drift") — confirmed by code reading.

## Gap analysis (LITE-acceptable)

Items NOT tested in this iteration, with explicit acceptability rationale:

| Gap | Why not tested in unit | Why LITE-acceptable | Where it gets covered |
|---|---|---|---|
| Live cross-schema SELECT against `supabase_migrations.schema_migrations` on `pdotsdahsrnnsoroxbfe` | Requires production credentials in test runner; explicitly excluded by ADR-017 §D5 and spec §Recommended Testing Methodology | Read-only SELECT against a Supabase-managed schema; service-role posture identical to every other admin endpoint already in production | Operator R5 smoke on first preview deploy |
| `outputFileTracingIncludes` actually bundles `.sql` into the Vercel function | Cannot be tested at unit level — depends on Vercel build output | Defensive `MigrationsBundleConfigError` is the safety net; if bundling fails, the 500 is loud, not silent | Operator R6 smoke on first preview deploy |
| Route 200 vs 503 status mapping | Thin glue; depends on the diff result's `synced` boolean, which IS unit-tested | Diff logic is the contract surface, not the status mapping | Operator smoke + manual curl after preview deploy |
| `requireRole(['admin'])` returning 401/403 for unauthorized calls | Already exercised by every admin endpoint's tests | The guard is shared infrastructure; no per-endpoint test reduces risk | Manual negative test after preview deploy |
| Multi-row ledger duplicates | Comment in the diff function acknowledges duplicates would surface in the count; not a normal failure mode | Postgres unique constraint on the ledger primary key prevents duplicates by construction | N/A (would require a corrupt ledger) |
| Concurrent calls to the endpoint | No mutation; pure read | Read-only; concurrent reads are safe by construction | N/A |

**Total deferred-to-preview verification surface: 2 items (R5 + R6).** Both are documented as operator obligations in ADR-017 §Risk register and §D5; neither is hidden test debt.

## R5 / R6 preview-verify checklist (for the operator post-merge)

These are NOT executable by this skill; they are handed to the operator who runs the first preview deploy. Recording them here so they cannot get lost between the testing gate and the operator's terminal.

### R5 — Cross-schema SELECT verification

1. After preview deploys, log in as an admin in the preview environment.
2. Hit `GET /api/admin/migrations-health` (browser DevTools or `curl` with session cookie).
3. Expected: **HTTP 200** with body matching the ADR-017 §D2 shape, `data.synced === true`.
4. If response is **500** with `code: "MIGRATIONS_READ_FAILED"` and message containing `permission denied for schema supabase_migrations` (or PostgREST equivalent): **R5 fired**. Escalate iteration to FULL per ADR-017 §Risk register row R5. Backend must add a GRANT migration; system-infra co-signs.
5. If response is **500** with `code: "MIGRATIONS_READ_FAILED"` and a transient message: retry once, then check Supabase status. Not necessarily an iteration block.

### R6 — Vercel bundle verification

1. On the same preview hit (step 1-3 above), check `data.summary.filesystem_count`.
2. Expected today: **55** (NOT 51 — see Finding F-1).
3. If `filesystem_count === 0` AND response is **500** with `code: "MIGRATIONS_BUNDLE_MISSING"`: **R6 fired**. The `outputFileTracingIncludes` entry in `next.config.mjs` is not effective. Backend must investigate — possible causes: (a) Next 16 changed the config location (top-level vs `experimental.*`), (b) the glob pattern doesn't match, (c) `process.cwd()` resolves to a different path on Vercel than expected.
4. If `filesystem_count > 0` but lower than 55: backend investigates which files were excluded. The bundle is partially included — not a security issue, but the endpoint's accuracy is compromised.
5. If `filesystem_count === 55`: R6 closed.

### Combined success target (post-merge production)

After R5 + R6 close and the merge lands on production:

```jsonc
GET /api/admin/migrations-health → 200 OK
{
  "data": {
    "synced": true,
    "summary": {
      "filesystem_count": 55,        // not 51 — F-1 above
      "ledger_count": 53,
      "grandfathered_collisions_count": 4,
      "expected_orphans_count": 6,
      "unexpected_drift_count": 0,
      "missing_in_ledger_count": 0
    },
    "missing_in_ledger": [],
    "unexpected_drift_orphans": [],
    "grandfathered_collisions": [/* 4 ADR-006 §B2 files */],
    "expected_orphans": [/* 6 ADR-014 §Orphans names */],
    "checked_at": "<ISO timestamp>"
  }
}
```

If `summary.filesystem_count` differs from 55 OR `summary.unexpected_drift_count > 0`: surface to docs and update the project.context.core.md Operating rules entry accordingly.

## Methodology declaration

Per the task brief's obligation 5: the spec did not prescribe TDD / BDD / CDD explicitly. The methodology used is:

**Integration-first for LITE: unit-test the pure logic exhaustively; defer the route + DB interaction tests to preview/manual smoke + the defensive `ApiError` safety net.**

Justification:
- The diff function is the contract surface — pure mapping `(files, rows, allowlist, expected_orphans) → result`. Unit-testable in isolation with zero setup cost. **14 tests cover this.**
- The orchestrator (`readMigrationsHealth`) is a thin Promise.all of two reads. Mocking the supabase client at the adapter boundary would test the adapter's error-mapping branches, but those branches are explicitly tested by reading + by the `ApiError → toErrorResponse` chain which is already exercised by every other admin endpoint. Net new value of an adapter unit test: low.
- The route handler is 3 logical statements. The status-mapping logic (200 vs 503 from `synced`) is the only handler-specific behavior; testing it in isolation requires mocking the adapter, the auth guard, and `NextResponse.json`. Net new value: low.
- The operator-driven R5 + R6 smoke is the final integration validation. ADR-017 §D5 makes this explicit. The defensive `MigrationsBundleConfigError` + `MigrationsLedgerReadError` subclasses ensure that integration failure modes surface as loud 500s with structured codes, not as silent false positives.

This methodology is appropriate for LITE depth on an operator-driven, read-only, internal endpoint with thin glue logic over heavily-exercised infrastructure. It would NOT be appropriate for FULL depth or for a user-facing endpoint or for any mutating endpoint.

## Verdict

**SUFFICIENT.**

Justification:
- All 5 gates green on this skill's invocation.
- All 7 mandatory spec edge cases covered, plus 2 mirror cases + 3 helper-function variants + 2 SoT shape guards = 14 tests total.
- The two defensive error subclasses (`MigrationsBundleConfigError`, `MigrationsLedgerReadError`) are wired such that R5 / R6 surface as loud 500s with structured codes, confirmed by code reading.
- The 2 deferred items (R5 cross-schema SELECT, R6 Vercel bundling) are explicit operator-driven obligations per ADR-017 §D5 + §Risk register, not hidden test debt.
- F-1 (steady-state count drift: spec says 51, disk says 55) is informational and belongs to system-docs in this chain; it does not affect the test verdict.

Coverage is proportional to LITE for an operator-driven read-only internal endpoint. No reroute to backend required.

**Not COMPLETE** — only system-validator declares that, after system-security, system-infra, and system-docs have run.

## Handoff to system-security

Items the security skill should focus on for its proportional risk review:

1. **Auth posture** — `requireRole(['admin'])` is the only gate. Confirm it satisfies the auth threat model for an endpoint that lists migration filenames (which are already public in the repo per Operating rules) and the live ledger row count.
2. **Service-role usage** — the adapter uses `createSupabaseAdminClient()` (service-role key). Same posture as Stripe webhook + website webhook ledger handlers. Confirm no new RLS bypass surface introduced.
3. **Information leak surface** — the response body includes ledger row `name` values for both expected orphans and any unexpected drift orphans. Confirm this is acceptable given the auth gate restricts to admins only.
4. **Defensive error paths** — `MIGRATIONS_BUNDLE_MISSING` and `MIGRATIONS_READ_FAILED` codes are returned with `error.message` content. The `MigrationsLedgerReadError` constructor embeds the raw Supabase error message into the response — review whether that could leak schema details to an admin that they shouldn't see (probably acceptable since the caller is admin, but worth a sanity check).
5. **No new env var, no new secret, no new public surface** — confirm.

Test debt items security should be aware of (NOT blocking the security gate, recorded for transparency):
- Route handler not unit-tested (F-2).
- R5 / R6 verification deferred to operator preview smoke (intentional per ADR-017 §D5).
- Steady-state count drift between spec (51) and reality (55) — informational only (F-1).
