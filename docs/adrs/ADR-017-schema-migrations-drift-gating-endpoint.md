# ADR-017: schema_migrations drift gating endpoint — auth posture, response shape, allowlist source of truth, and bundling strategy

**Status:** Accepted (§R5 closed 2026-05-20 by ADR-018)
**Date:** 2026-05-20
**Deciders:** Engineering team
**Supersedes:** None
**Amended by:** ADR-018 (closes §R5 — `list_schema_migrations` RPC replaces cross-schema SELECT).
**Related:** ADR-006 (migration prefix convention — §Option B2 grandfathered set), ADR-014 (migration ledger reconciliation — §Orphans expected set), ADR-018 (R5 resolution), spec `specs/fase-2-c-b26-schema-migrations-gating-endpoint-health.md`, spec `specs/fase-2-c-b26-r5-followup-rpc-migration.md`.

---

## Context

ADR-014 reconciled the production ledger on `pdotsdahsrnnsoroxbfe` to 52 rows on 2026-05-17, and the subsequent B15 / 0051 manual-apply path on 2026-05-20 brought it to 53. The current operating model still permits drift to re-accumulate silently: migrations applied via the Supabase Dashboard SQL Editor require a manual `INSERT` into `supabase_migrations.schema_migrations`, and the operator can forget that step. The next time `supabase db push` runs from a clean checkout, the CLI re-attempts already-applied migrations and aborts — exactly the failure mode ADR-014 closed.

A passive health surface that compares filesystem state against ledger state — classifying the diff against the two ADR-anchored exception sets (4 grandfathered prefix collisions per ADR-006 §Option B2; 6 expected orphans per ADR-014 §Orphans) — catches the divergence **before** the next push attempt. The endpoint is consumed by an operator today and, in a future iteration, by a deploy gate, cron probe, or oncall dashboard.

Analysis surfaced four open decisions and one material technical risk that architecture must close before backend implementation can start:

1. **Q1** — where do the two known-exception sets live (allowlist source of truth)?
2. **Q2** — what does the endpoint return on the wire (response shape + HTTP status semantics)?
3. **Q3** — who is allowed to call the endpoint (auth posture)?
4. **Q4** — how does the cross-schema SELECT against `supabase_migrations.schema_migrations` get typed?
5. **R6** — how does the function bundle on Vercel include the `supabase/migrations/` directory at runtime?

---

## Decision

### D1 — Allowlist source of truth (Q1)

A new shared module is created at `lib/server/migrations/known-exceptions.mjs`. It is plain ESM (`.mjs`) — not TypeScript — and exports two frozen sets:

- `KNOWN_COLLISION_FILES` — the 8 filenames currently hard-coded in `scripts/check-migrations.mjs` (4 grandfathered-without-ledger-row + their 4 ledger-registered partners).
- `EXPECTED_ORPHAN_LEDGER_NAMES` — the 6 ledger `name` values from ADR-014 §Orphans (`phase_4b_payment_columns`, `phase_5_stripe_connect`, `phase_7_client_workspace`, `phase_7b_resolve_token_update`, `phase_8_lead_whatsapp`, `phase_11_lead_auto_followup`).

Both sets carry leading JSDoc comments anchored to the source ADR and a stability note ("do not edit without amending the cited ADR").

Type information is provided via JSDoc (`@type {ReadonlySet<string>}`) — no `.d.mts` companion needed because the TypeScript adapter imports the constants as `ReadonlySet<string>` via JSDoc inference and Next.js's default Node-ESM resolution.

`scripts/check-migrations.mjs` is refactored to `import { KNOWN_COLLISION_FILES } from '../lib/server/migrations/known-exceptions.mjs'`. The script's CI behavior remains byte-for-byte unchanged.

**Why `.mjs` and not `.ts`:**
- The CI script is `.mjs` and runs under bare `node` without any compilation step. Importing a `.ts` file would require `tsx` / build output, which adds a build dependency to a CI guard whose entire value is being dependency-free.
- TypeScript code can import `.mjs` natively in Next.js (Node ESM resolution handles `.mjs` extensions explicitly). No `allowJs`, no transform.
- One file, one source of truth, zero build steps. The cleanest interop.

**Why not (a) import from `scripts/check-migrations.mjs`:**
- The script is a CLI with side effects at module scope (it runs the diff and calls `process.exit`). Importing it from a route handler would execute the CLI at module load.
- The script does not currently export `EXPECTED_ORPHAN_LEDGER_NAMES`. Adding a new export to the script is required either way; doing so cleanly means extracting the constants to a shared module.

**Why not (b) duplicate the constants:**
- R1 (allowlist divergence) is High over a 6-month window with two sources of truth. ADR-006 / ADR-014 are the contract anchors; the code should have exactly one place to drift from them.

### D2 — Response shape and HTTP status semantics (Q2)

The endpoint returns the following JSON shape:

```jsonc
// 200 OK — synced (including known exceptions present)
{
  "data": {
    "synced": true,
    "summary": {
      "filesystem_count": 55,
      "ledger_count": 53,
      "grandfathered_collisions_count": 4,
      "expected_orphans_count": 6,
      "unexpected_drift_count": 0
    },
    "missing_in_ledger": [],
    "unexpected_drift_orphans": [],
    "grandfathered_collisions": [
      "0024_phase_5a_prototype_settings_admin_write.sql",
      "0025_phase_3a_leads_geo_location.sql",
      "0026_phase_9a_stripe_payments.sql",
      "0027_phase_10a_commissions.sql"
    ],
    "expected_orphans": [
      "phase_4b_payment_columns",
      "phase_5_stripe_connect",
      "phase_7_client_workspace",
      "phase_7b_resolve_token_update",
      "phase_8_lead_whatsapp",
      "phase_11_lead_auto_followup"
    ],
    "checked_at": "2026-05-20T00:00:00.000Z"
  }
}
```

```jsonc
// 503 Service Unavailable — unexpected drift
{
  "data": {
    "synced": false,
    "summary": { /* same shape; unexpected_drift_count > 0 */ },
    "missing_in_ledger": ["0052_phase_21a_example.sql"],
    "unexpected_drift_orphans": ["phase_unknown_legacy"],
    "grandfathered_collisions": [/* 4 items */],
    "expected_orphans": [/* 6 items */],
    "checked_at": "2026-05-20T00:00:00.000Z"
  }
}
```

```jsonc
// 500 Internal Server Error — could not determine drift state
{
  "error": "Could not determine migration drift state.",
  "code": "MIGRATIONS_READ_FAILED" | "MIGRATIONS_BUNDLE_MISSING" | "INTERNAL_ERROR"
}
```

**Field definitions:**

| Field | Type | Meaning |
|---|---|---|
| `data.synced` | `boolean` | `true` iff `summary.unexpected_drift_count === 0`. Primary deploy-gate signal. |
| `data.summary.filesystem_count` | `number` | Count of `*.sql` files under `supabase/migrations/`. |
| `data.summary.ledger_count` | `number` | Count of rows in `supabase_migrations.schema_migrations`. |
| `data.summary.grandfathered_collisions_count` | `number` | Disk files in `KNOWN_COLLISION_FILES` that are intentionally absent from the ledger (the 4 per ADR-006 §B2). Expected: 4 in steady state. |
| `data.summary.expected_orphans_count` | `number` | Ledger rows in `EXPECTED_ORPHAN_LEDGER_NAMES` with no matching disk file. Expected: 6 in steady state. |
| `data.summary.unexpected_drift_count` | `number` | `missing_in_ledger.length + unexpected_drift_orphans.length`. Drives `synced`. |
| `data.missing_in_ledger` | `string[]` | Disk files (full filename incl. `.sql`) with no ledger row AND not in `KNOWN_COLLISION_FILES`. |
| `data.unexpected_drift_orphans` | `string[]` | Ledger `name` values with no matching disk file AND not in `EXPECTED_ORPHAN_LEDGER_NAMES`. |
| `data.grandfathered_collisions` | `string[]` | The 4 grandfathered filenames currently present on disk. Sorted lexically. |
| `data.expected_orphans` | `string[]` | The 6 expected orphan `name` values currently present in the ledger. Sorted lexically. |
| `data.checked_at` | `string` (ISO 8601 UTC) | Timestamp of the diff computation. |
| `error` / `code` | `string` / `string` | Present only on 5xx. `code` is the structured error tag. |

**Naming note:** `unexpected_orphan_in_ledger` from the analysis spec is renamed to `unexpected_drift_orphans` for symmetry with `unexpected_drift_count`. Backend wires the renamed field; consumers see only the final name.

**HTTP status mapping (locked):**

| Status | Trigger | `synced` | Use case |
|---|---|---|---|
| `200` | `unexpected_drift_count === 0` | `true` | Probe receives a green signal even when known exceptions exist. |
| `503` | `unexpected_drift_count > 0` | `false` | Deploy gate / cron probe blocks the pipeline. Body still parseable for diagnostic. |
| `500` | `readdir` failure, ledger SELECT failure, or `MigrationsBundleConfigError` thrown by the runtime defensive guard | n/a | System cannot determine drift state. Distinct from `503` because the answer is unknown, not "drift exists". |
| `401` / `403` | Auth failure (see D3) | n/a | Standard `requireRole` mapping via `toErrorResponse`. |

**Why 503 not 409 for drift:** Deploy-gate / probe consumers typically interpret 5xx as "do not promote" without parsing the body. 409 conveys "client conflict", which is semantically wrong here — drift is a server-side state. 503 is the consumer-friendly choice that pairs with the body when diagnostic detail is needed.

**Why `synced` is server-computed:** Single source of truth. The boolean is the deploy-gate primary signal; deriving it client-side would invite consumers to compute it differently from `summary.unexpected_drift_count`.

**Deferred to follow-up:** git SHA / disk-state identifier in the response. Not needed in this iteration. If a future consumer needs to detect "endpoint sees a stale bundle", that consumer can pass an `If-Match: <sha>` header and the endpoint can echo it in `data.bundle_sha`. Not designed now.

### D3 — Auth posture (Q3)

The endpoint is gated by `requireRole(['admin'])` — admin-only via session principal. Reuses the canonical pattern from `app/api/admin/earnings/consolidate/route.ts`.

**Consequences:**
- 401 if the caller has no session, 403 if the caller has a session but is not `admin` (per `requireRole` semantics in `lib/server/auth/guards.ts`).
- A CI deploy-pipeline pre-push probe cannot call this endpoint today. That use case is **explicitly out of scope** for B26. The endpoint ships as operator-driven only.

**Documented follow-up (B27 or later):** if a CI / cron / external-probe consumer materializes, the natural follow-up is the internal-token posture (`x-noon-internal-token` header validated against a new env var, constant-time compare). That follow-up:
- Introduces one env var (`NOON_INTERNAL_MIGRATIONS_HEALTH_TOKEN` — name reserved here for forward consistency).
- Requires Infra co-sign for Vercel production + preview scoping.
- Lives **alongside** the admin gate (either-or, not replacement): admin session passes OR valid token header passes.

This ADR pre-authorizes that follow-up without scoping it. B26 ships admin-only.

**Why not (b) anonymous-rate-limited:** the repo is currently public per Operating rules — the migration name list is already public information. The rate-limit-only posture would not leak new data, but it would introduce a new public endpoint surface that future security review may want to retract. Removing a public endpoint is harder than adding one. Admin-only is reversible toward (c) without breaking any current consumer.

**Why not (c) internal-token now:** introduces a new env var and a shared-secret rotation burden today, with no consumer to justify the cost. Defer until a consumer needs it.

### D4 — Type safety for `supabase_migrations.schema_migrations` (Q4)

The cross-schema SELECT uses an **inline typed cast** with a `SchemaMigrationsRow` interface co-located in the ledger adapter file.

```ts
// lib/server/migrations/ledger-adapter.ts
export interface SchemaMigrationsRow {
  version: string  // 4-digit prefix ('0023') OR 14-digit timestamp ('20260420063335')
  name: string     // suffix-without-prefix (e.g. 'phase_8a_project_conversion_status_activity')
}

// Usage:
const { data, error } = await (client as unknown as SupabaseClient)
  .schema('supabase_migrations')
  .from('schema_migrations')
  .select('version, name') as { data: SchemaMigrationsRow[] | null, error: PostgrestError | null }
```

**Why not (a) 5th override block in `database.types.ts`:** the file already carries 4 manual override blocks (`seller_fees`, `prototype_workspaces`, `lead_proposals`, `website_webhook_events`). Each new block raises the cost of the eventual clean regen. A 2-column read against a Supabase-managed schema does not earn that cost.

**Why not (c) `any` + zod:** verbose for a 2-column read. The row shape is stable (Supabase-managed schema; the CLI itself depends on it not changing). Runtime validation here adds bytes without preventing a realistic failure mode.

**Acceptable risk:** if Supabase ever changes the row shape of `supabase_migrations.schema_migrations`, the cast silently lies until the diff function dereferences a missing field and the response becomes incoherent. Mitigation: the type interface lives next to the only consumer, with a comment pinning the row format to ADR-014's verification snapshot. Any future Supabase shape change surfaces as a test failure once we attempt to upgrade `@supabase/supabase-js`.

### D5 — Vercel bundle inclusion strategy (R6)

`next.config.mjs` is updated to add `outputFileTracingIncludes` declaring `supabase/migrations/**/*.sql` as a dependency of the route `app/api/admin/migrations-health/route.ts`. PLUS a defensive runtime guard inside the adapter: if `readdir` returns 0 entries, the adapter throws `MigrationsBundleConfigError` and the route maps it to `500` with `code: 'MIGRATIONS_BUNDLE_MISSING'`.

**Why both (`outputFileTracingIncludes` + defensive guard):**
- `outputFileTracingIncludes` is the standard Next.js mechanism for bundling non-code assets into serverless functions. Without it, Vercel's automatic file-tracing infers code dependencies only and excludes `supabase/`. With it, all `.sql` files under `supabase/migrations/` are copied into the function bundle at build time.
- The defensive guard is a safety net: if a future config refactor accidentally removes the `outputFileTracingIncludes` entry, or if a contributor copies the route to a new path without copying the config, `readdir` silently returns `[]` and the endpoint would classify all 51 disk files as `missing_in_ledger` — exactly the false-positive R6 warned about. Throwing on empty filesystem turns silent misconfig into a loud 500 with a specific error code.
- The combination preserves LITE depth: no build-time codegen step, no `prebuild` script, no JSON-import dance. One config change + one defensive throw.

**Why not (ii) build-time codegen:** writing a `prebuild` script that emits `lib/server/migrations/filesystem-snapshot.json` adds a build step and a generated artifact under source control. It would solve R6 cleanly but introduces (a) a new git-tracked generated file (or a `.gitignore` entry plus a CI invariant), (b) a `prebuild` lifecycle hook in `package.json`, (c) a contributor pattern where touching `supabase/migrations/` requires regenerating the snapshot. LITE escalates toward FULL.

**Why not (i) `outputFileTracingIncludes` alone:** no safety net against the silent-misconfig failure mode. R6's whole point is that the failure is silent.

**Backend verification step:** before merging to develop, backend deploys a preview, hits `/api/admin/migrations-health` with an admin session, and confirms the response carries `summary.filesystem_count === 55` (the actual current disk count; the 51 figure in earlier drafts was a model number that did not account for the 4 grandfathered collision files). If `filesystem_count === 0`, the bundling is misconfigured and the defensive guard fires with a 500 + `MIGRATIONS_BUNDLE_MISSING` — backend fixes the `next.config.mjs` entry and re-verifies.

### D6 — Module boundaries

The iteration creates exactly four new files and modifies two:

**New:**
- `app/api/admin/migrations-health/route.ts` — route handler. Declares `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. Calls `requireRole(['admin'])`, invokes the adapter, maps the classified result to the response shape + status code, routes errors through `toErrorResponse`.
- `lib/server/migrations/health.ts` — exports the **pure diff function** `diffMigrations(files: string[], rows: SchemaMigrationsRow[], grandfathered: ReadonlySet<string>, expectedOrphans: ReadonlySet<string>): MigrationsDiffResult`. No I/O, no Supabase, no `node:fs`. Trivially unit-testable.
- `lib/server/migrations/ledger-adapter.ts` — orchestrator. Exports `readMigrationsHealth(client: SupabaseClient): Promise<MigrationsHealthResponse>`. Performs the `readdir`, the cross-schema SELECT (with the `SchemaMigrationsRow` interface co-located here), invokes `diffMigrations`, and assembles the response. Defines and throws `MigrationsBundleConfigError` and `MigrationsLedgerReadError`.
- `lib/server/migrations/known-exceptions.mjs` — the shared module per D1.

**Modified:**
- `scripts/check-migrations.mjs` — replace the inline `KNOWN_COLLISION_FILES` constant with `import { KNOWN_COLLISION_FILES } from '../lib/server/migrations/known-exceptions.mjs'`. Otherwise unchanged. CI behavior byte-for-byte identical.
- `next.config.mjs` — add `experimental.outputFileTracingIncludes` (or top-level `outputFileTracingIncludes` per Next 16 location — backend confirms via Next docs) keying the route path to `['./supabase/migrations/**/*.sql']`.

**New test file:**
- `tests/server/migrations/health.test.ts` — unit tests against the pure `diffMigrations` function. Covers all 7 edge cases from the spec's "Included" list.

**Responsibility split (locked):**

| Concern | Owner module | Not owned by |
|---|---|---|
| Reading the filesystem | `lib/server/migrations/ledger-adapter.ts` (calls `readdir`) | Not the route, not the diff function |
| Reading the ledger | `lib/server/migrations/ledger-adapter.ts` (uses admin client) | Not the route, not the diff function |
| Classifying the diff | `lib/server/migrations/health.ts` (pure function) | Not the adapter, not the route |
| Auth gate | `app/api/admin/migrations-health/route.ts` (`requireRole`) | Not the adapter — the adapter assumes its caller already authorized |
| HTTP status mapping | `app/api/admin/migrations-health/route.ts` | Not the adapter |
| The two known-exception sets | `lib/server/migrations/known-exceptions.mjs` | Not duplicated anywhere; imported by adapter and by `scripts/check-migrations.mjs` |
| Type for `schema_migrations` row | `lib/server/migrations/ledger-adapter.ts` (local `SchemaMigrationsRow`) | Not `database.types.ts` |
| Bundling `supabase/migrations/` into the function | `next.config.mjs` (`outputFileTracingIncludes`) | Not codegen, not import-as-JSON |
| Defensive empty-bundle guard | `lib/server/migrations/ledger-adapter.ts` (throws `MigrationsBundleConfigError`) | Not the route, not the diff function |

### D7 — Contract surface location

This endpoint is **internal-only and operational**. It is not in `docs/integrations/cross-repo-webhook-v1.md`, it has no NoonWeb-side consumer, and it does not appear in `docs/contracts/`. The response shape contract lives in **this ADR** (D2) and in the route's leading comment (which references this ADR by id). When a future consumer materializes (cron, dashboard, deploy gate), that iteration may promote the shape to a `docs/contracts/` file or leave it pinned to ADR-017. No promotion required now.

### D8 — Filename-to-ledger-version join key (R7 mitigation)

The pure diff function joins on `(filename_without_extension, ledger.name)` — NOT on `(prefix, version)`. This is the only join key stable across both `version` formats in the current ledger (4-digit prefix for post-CLI rows, 14-digit timestamp for pre-CLI rows per ADR-014).

**Procedure:**
- For each disk file `XXXX_<slug>.sql`, extract `<slug>` (strip 4-digit prefix and `.sql` extension).
- For each ledger row, use `name` as-is (already prefix-less per ADR-014's reconciliation INSERT convention).
- Match on `<slug> === name`.

The `KNOWN_COLLISION_FILES` set keys on **full filename including prefix and extension** (consistent with the current `scripts/check-migrations.mjs` convention). The `EXPECTED_ORPHAN_LEDGER_NAMES` set keys on **bare name** (no prefix, no extension), consistent with the ledger row format.

This is documented in JSDoc on `diffMigrations` and in the leading comment of `known-exceptions.mjs`.

---

## Rationale

### Why a combined ADR (vs three separate ADRs)

Each decision (Q1-Q4, R6) reinforces the others: the auth posture (D3) bounds who can hit the endpoint that returns the shape (D2) computed by the function in the modules (D6) typed by D4, with allowlist data from D1 and bundle inclusion per D5. Splitting them into 5 ADRs would force readers to chase cross-references for a single operational endpoint. The cost of one combined ADR is one moderately long document; the cost of five separate ADRs is five short documents that always need to be read together.

### Why LITE was preserved

The decision space was bounded enough to close in one architecture pass:
- No new env var, no new migration, no new contract document, no NoonWeb coordination.
- The one technical risk (R6) was closeable by a Next.js standard pattern (`outputFileTracingIncludes`) + a defensive throw. No build-step escalation needed.
- The Q1 interop concern collapsed when `.mjs` was chosen for the shared module — Node ESM resolution handles cross-extension imports natively.

LITE remains the right depth.

### Why future extensibility is documented but not built

Three future use cases were considered and intentionally deferred:
1. **CI deploy-gate probe.** Requires the internal-token posture (D3's documented follow-up). Not built — no consumer today.
2. **Cron probe.** Requires either admin-impersonation token or the internal-token posture. Same follow-up as (1).
3. **Oncall dashboard.** Requires a UI route consuming this endpoint. No frontend skill in this chain — that work is a follow-up.

Each is named here so the next session knows where to pick up. None changes the current iteration's contract.

---

## Consequences

### Operating

- Operators can now hit `GET /api/admin/migrations-health` (admin session) to confirm ledger sync before initiating any `supabase db push` or before merging a PR that adds a migration.
- The endpoint surfaces drift but does not remediate. Remediation continues to follow ADR-014's playbook (apply via MCP if fresh; Dashboard SQL Editor + manual ledger row insert otherwise).
- The 4 grandfathered + 6 expected orphan exceptions are immutable inputs from ADR-006 / ADR-014. Any future amendment to those sets requires an ADR amendment AND editing `lib/server/migrations/known-exceptions.mjs`.

### CI guard unchanged

`scripts/check-migrations.mjs` produces the same output as before. The internal refactor (constant → import) is invisible to CI. A test of this assertion is the unmodified CI job in `.github/workflows/ci.yml`.

### Type-system cost

The 5th override block on `database.types.ts` is **not** added. The "clean regen + reconcile override blocks" follow-up still has 4 blocks pending, not 5. The `SchemaMigrationsRow` interface lives locally to `ledger-adapter.ts` and is removed when the endpoint is removed.

### Bundle size

`outputFileTracingIncludes` for `supabase/migrations/**/*.sql` adds 51 `.sql` files (each ~1-10KB) into the function bundle. Total addition: < 500KB. Negligible vs Vercel function bundle limits.

### Future internal-token follow-up pre-authorized

When (not if) a CI / cron / external-probe consumer needs this endpoint, the implementation pattern is pre-decided in D3:
- New env var `NOON_INTERNAL_MIGRATIONS_HEALTH_TOKEN` in production + preview Vercel scopes (Infra co-sign).
- New header validator helper in `lib/server/migrations/auth.ts` (or reused if a sibling endpoint needs the same pattern).
- The route accepts EITHER admin session OR valid token. No replacement of the admin gate.
- That iteration files its own ADR or amends this one — architecture decides at the time.

### Risk register

| Risk | Mitigation | Status |
|---|---|---|
| R1 (allowlist divergence) | Single source in `known-exceptions.mjs` (D1) | Closed |
| R2 (response shape lock-in) | Locked in D2 with named fields + status mapping | Closed |
| R3 (auth posture mismatch) | Admin-only now; internal-token pre-authorized for follow-up (D3) | Closed for B26 scope |
| R4 (type safety hole) | Inline `SchemaMigrationsRow` interface (D4) | Closed |
| R5 (cross-schema SELECT requires policy surgery) | Materialized as PostgREST `Invalid schema: supabase_migrations` (not `42501`). Resolved via Path B — `public.list_schema_migrations()` SECURITY DEFINER RPC with EXECUTE granted only to `service_role`. See ADR-018. | **Closed — see ADR-018** (2026-05-20) |
| R6 (Vercel bundle exclusion) | `outputFileTracingIncludes` + defensive `MigrationsBundleConfigError` (D5) | Closed |
| R7 (filename/version join key) | Join on `(slug, name)` not `(prefix, version)` (D8) | Closed |

R5 closed on 2026-05-20 via ADR-018. The production failure mode was a PostgREST `db-schemas` exposure restriction (`Invalid schema: supabase_migrations`), not the anticipated `42501` permission denied. The user elected Path B (SECURITY DEFINER RPC in `public`) over Path A (operational schema exposure). ADR-018 records the decision, the SECURITY DEFINER hardening posture, the GRANT scope, and the REVOKE+DROP rollback companion. The B26-SEC-F3 binding from `docs/validations/B26 security review 2026-05-20.md` §S12 is satisfied by the ADR-018 iteration.

---

## References

- `specs/fase-2-c-b26-schema-migrations-gating-endpoint-health.md` — analysis spec (this ADR's input).
- `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` — §Option B2, source of `KNOWN_COLLISION_FILES`.
- `docs/adrs/ADR-014-migration-ledger-reconciliation.md` — §Orphans, source of `EXPECTED_ORPHAN_LEDGER_NAMES`; 53-row reconciled baseline.
- `scripts/check-migrations.mjs` — existing CI guard; refactored to import from `known-exceptions.mjs`.
- `app/api/admin/earnings/consolidate/route.ts` — reference shape for admin-gated route.
- `lib/server/auth/guards.ts` — `requireRole(['admin'])` canonical pattern.
- `lib/server/supabase/admin.ts` — `createSupabaseAdminClient()`.
- `lib/server/api/errors.ts` — `toErrorResponse` and `AuthGuardError` mapping.
- `next.config.mjs` — gets the `outputFileTracingIncludes` entry per D5.
- Next.js `outputFileTracingIncludes` documentation — https://nextjs.org/docs/app/api-reference/next-config-js/output (backend confirms exact location under Next 16).
