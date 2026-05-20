# B26 — Security review (schema_migrations gating endpoint health)

**Date:** 2026-05-20
**Iteration:** B26 — schema_migrations drift gating endpoint health
**Reviewer role:** system-security (mandatory LITE gate per chain: analysis → architecture → backend → testing → security → infra → docs → validator)
**Depth:** LITE — proportional review for an admin-gated, read-only, internal health endpoint with no mutation, no new env var, no new secret, no new public surface, no PII.
**Verdict:** **GATE-OPEN. No CRITICAL or HIGH findings.** Two LOW findings recorded for transparency; one MEDIUM-leaning future-iteration pre-authorization captured for the deferred R5 GRANT-migration path.

## Scope

The review covers the changes introduced by B26:

- New route `app/api/admin/migrations-health/route.ts` (GET only, admin-gated).
- New orchestrator `lib/server/migrations/ledger-adapter.ts` (filesystem read + cross-schema SELECT + defensive error subclasses).
- New pure classifier `lib/server/migrations/health.ts` (no I/O).
- New shared SoT module `lib/server/migrations/known-exceptions.mjs` (imported by both the CI script and the route adapter).
- Refactor of `scripts/check-migrations.mjs` (one import; CI behavior byte-for-byte unchanged per testing review).
- `next.config.mjs` addition of `outputFileTracingIncludes` for `supabase/migrations/**/*.sql` on the new route.

Out of scope:

- Pre-existing admin endpoints, auth helpers, Supabase client wrappers (referenced for parity only).
- The CI script's pre-existing collision-detection logic (untouched by B26 beyond the single import change).
- Operator-driven R5 / R6 preview-deploy smoke (system-infra responsibility per ADR-017 §D5 and testing review §R5/R6 checklist).
- NoonWeb side (this endpoint is App-internal; no cross-repo coupling).

## Reference

- Spec `specs/fase-2-c-b26-schema-migrations-gating-endpoint-health.md` §Risks R1-R7 + §Success Criterion item 7 (security gate condition: zero CRITICAL, zero HIGH).
- ADR-017 §D1 (allowlist SoT), §D2 (response shape + status mapping), §D3 (auth posture), §D4 (type-safety), §D5 (bundling + defensive guard), §D7 (no cross-repo contract surface).
- Testing review (`docs/validations/B26 testing review 2026-05-20.md`) — F-3 confirms defensive `ApiError` wiring by code reading.
- Reference admin route `app/api/admin/earnings/consolidate/route.ts` for posture parity.
- B15 security review (`docs/validations/B15 security review 2026-05-20.md`) for structure parity and the canonical service-role posture verdict.

## Threat-model verifications (S1-S12)

### S1 — Auth gate enforcement

**Surface:** any caller of `GET /api/admin/migrations-health` who lacks an admin session.

**Verification (by code reading):**
- `app/api/admin/migrations-health/route.ts:43-55` exports **only** a `GET` handler. No `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, or `HEAD` handler exists. Next.js App Router responds to unsupported methods with `405 Method Not Allowed` by default — no accidental open verb.
- The first statement inside the `try` block is `await requireRole(['admin'])` (line 45). The adapter call is line 47-48; the response build is line 49-51. There is **no** code path before the `requireRole` check that touches the filesystem, the Supabase client, or the response body.
- `requireRole(['admin'])` in `lib/server/auth/guards.ts:105-119` chains through `requirePrincipal()` → `requireSession()` → `assertAuthEnabled()`. Failure modes:
  - No session → `AuthGuardError('UNAUTHENTICATED', …, 401)`.
  - No profile → `AuthGuardError('PROFILE_NOT_FOUND', …, 403)`.
  - Inactive profile → `AuthGuardError('INACTIVE_PROFILE', …, 403)`.
  - Wrong role → `AuthGuardError('FORBIDDEN', …, 403)`.
  - Auth disabled → `AuthGuardError('AUTH_DISABLED', …, 503)`.
- All five errors are caught at `route.ts:52-54` and routed through `toErrorResponse`, which matches the `error instanceof AuthGuardError` branch (`lib/server/api/errors.ts:57-65`) and returns the appropriate status with a `{ error, code }` body. No body leak before auth.
- The Next.js App Router does **not** invoke the GET handler for OPTIONS preflight; CORS preflight returns a stock response without entering the route module. No data leak via preflight.
- The route is co-located under `app/api/admin/**`, matching the canonical pattern in `app/api/admin/earnings/consolidate/route.ts` (which uses the identical `requireRole(['admin'])` + `try/catch + toErrorResponse` shape).

**Verdict:** **LOW.** Gate posture matches the canonical admin endpoint. No bypass path identified.

### S2 — Information leak via the response body

**Surface:** the 200 body exposes:
- Internal migration filenames (e.g., `0050_phase_19d_debit_wallet_for_refund_rpc.sql`) — reveals product architecture phases.
- The 4 grandfathered collision filenames (ADR-006 §Option B2) and the 6 expected orphan ledger names (ADR-014 §Orphans).
- The total count of rows in `supabase_migrations.schema_migrations`.
- The structure (`version`, `name`) of the Supabase-managed ledger.

**Verification:**
- The repository is currently public per `project.context.core.md` Operating rules (line 308). The same migration filenames are already visible at `github.com/nooncode-org/App-nooncode/tree/develop/supabase/migrations`. Exposing them inside an admin-gated body adds no public-internet leak surface.
- The two ADR-anchored exception sets (`KNOWN_COLLISION_FILES`, `EXPECTED_ORPHAN_LEDGER_NAMES`) are already documented in ADR-006 and ADR-014 (also in the public repo).
- The endpoint is gated by `requireRole(['admin'])`. An admin session-holder has, by construction, access to the Supabase Dashboard via the project's RBAC outside of this endpoint — they can SELECT from `supabase_migrations.schema_migrations` directly without going through this route. The endpoint provides no privilege escalation: admin → admin-equivalent data.
- An attacker who has already compromised an admin session can read this body, but the same compromised session can also read the Supabase Dashboard, every ledger table, customer PII via the wallet endpoints, payment records, and so on. The migration filename list is the least-valuable trophy in that scenario.

**Verdict:** **LOW.** Documented as acceptable per spec §Success Criterion item 7 ("info-leak severity of (b) anonymous-rate-limited is explicitly accepted as LOW given the repo is currently public"). The admin gate makes the surface strictly narrower than the rate-limited variant that the spec already pre-accepted.

### S3 — SQL injection vectors

**Surface:** the cross-schema SELECT against `supabase_migrations.schema_migrations`.

**Verification (by code reading `lib/server/migrations/ledger-adapter.ts:139-149`):**
- The query is built via the supabase-js fluent API:
  ```ts
  await (client as unknown as SupabaseClient)
    .schema('supabase_migrations' as never)
    .from('schema_migrations')
    .select('version, name')
  ```
- The `.schema(...)`, `.from(...)`, and `.select(...)` arguments are **string literals** in source — they are not constructed from request input, headers, search params, body, or any caller-controlled value.
- No `.eq(col, val)`, no `.in(col, vals)`, no `.filter(...)`, no `.rpc(...)` is used. There is no value-binding surface at all; the query is parameter-less.
- The route handler (`route.ts:43-55`) does not parse the request body, headers, or query string before invoking the adapter. The GET handler takes no parameters.

**Verdict:** **LOW.** Zero user-input-to-SQL path exists. Standard supabase-js posture (same as the B15 ledger handlers per `B15 security review §S8`).

### S4 — Filesystem traversal

**Surface:** the `readdir` call in `readMigrationFiles()`.

**Verification (by code reading `lib/server/migrations/ledger-adapter.ts:98-123`):**
- Constants at module scope:
  ```ts
  const MIGRATIONS_DIR_REL = join('supabase', 'migrations')
  const SQL_EXTENSION = '.sql'
  ```
- Inside `readMigrationFiles()`:
  ```ts
  const dir = join(process.cwd(), MIGRATIONS_DIR_REL)
  let entries: string[]
  try { entries = await readdir(dir) } catch { throw new MigrationsBundleConfigError() }
  ```
- `process.cwd()` is **not** request-controlled (it is the Node process working directory at start, controlled by Vercel's runtime). `MIGRATIONS_DIR_REL` is a hard-coded literal. The composed path is fully static across calls.
- No request input (header, body, query, path segment) flows into the `readdir` argument.
- The result is filtered by exact-suffix `.endsWith('.sql')` — no glob, no regex over caller input.
- The filenames returned by `readdir` are scoped to the immediate `supabase/migrations/` directory (no `recursive: true` flag). Symlink traversal out of the directory is not possible because the filesystem state is bundle-controlled at deploy time (Vercel's read-only function FS), not operator-mutable at runtime.

**Verdict:** **LOW.** Hard-coded path, no caller input. No traversal vector.

### S5 — Service-role key handling

**Surface:** the route uses `createSupabaseAdminClient()` which holds `SUPABASE_SERVICE_ROLE_KEY` per `lib/env.ts:getPhase1AAdminEnv()`.

**Verification (by code reading):**
- `lib/server/supabase/admin.ts:7-17` — the service-role key is passed to `createClient(...)` and stored in the Supabase client's internal config. It is **never** returned from any of the three reviewed modules: not in response bodies, not in error messages, not in log lines.
- `MigrationsLedgerReadError` (`ledger-adapter.ts:87-96`) constructs its message as ``` `Could not read the schema migrations ledger: ${cause}` ``` where `cause` is `error.message` from the Supabase client (`ledger-adapter.ts:144-146`). Supabase-js's `PostgrestError.message` carries Postgres-level error text (e.g., `permission denied for schema supabase_migrations`, `42501`, syntax-error messages). It does **not** carry the connection string, the service-role JWT, or the API URL — `@supabase/supabase-js` never includes those in error responses. Reviewed against the canonical Stripe/website ledger handlers (`lib/server/website/webhook-events.ts`) which embed identical `error.message` strings.
- `MigrationsBundleConfigError` (`ledger-adapter.ts:66-77`) has a hard-coded message string with no interpolated values.
- `toErrorResponse` (`lib/server/api/errors.ts:67-75`) serializes only `error.message` and `error.code`. No stack traces, no client internals, no env values.
- The route handler (`route.ts:52-54`) does not `console.log` or telemeter anything from the error before passing to `toErrorResponse`.

**Verdict:** **LOW.** Service-role key is confined to the client constructor. No leakage path from route, adapter, or error subclasses to the response body or any log line.

### S6 — Error message leakage

**Surface:** per testing review finding F-3, `MigrationsLedgerReadError(error.message)` embeds Supabase's raw error string into the 500 body, and `MigrationsBundleConfigError` exposes an explicit hint about `next.config.mjs` to the caller.

**Verification:**
- `MIGRATIONS_BUNDLE_MISSING` body contains the literal hint `"Check next.config.mjs outputFileTracingIncludes."` (`ledger-adapter.ts:71-73`). This is configuration metadata, not a credential. An attacker who can reach this 500 has already passed the admin gate; informing them which config file is misconfigured does not expand their capability — they already have admin-level access to the codebase via GitHub (public repo) or Dashboard.
- `MIGRATIONS_READ_FAILED` body interpolates the Supabase error message. In the R5 failure mode (the most plausible 500), this string is ``Could not read the schema migrations ledger: permission denied for schema supabase_migrations`` or similar Postgres text. This reveals:
  - The schema name `supabase_migrations` (Supabase-public knowledge; documented in their CLI docs).
  - The presence of the `schema_migrations` table (Supabase-public).
  - The Postgres error code semantics (Postgres-public).
- None of the above is sensitive. Crucially, the admin gate has already filtered who can see these strings.

**Verdict:** **LOW.** Both error paths leak only public-knowledge configuration/schema metadata. The admin gate makes the disclosure equivalent to what the same admin can read from the Supabase Dashboard.

### S7 — Rate-limit / DoS vector

**Surface:** every call performs (a) filesystem `readdir` of ~55 entries and (b) one cross-schema SELECT returning ~53 rows.

**Verification:**
- No project-level Next.js middleware exists (`middleware.{ts,js,mjs}` not present at project root). The route is **not** behind a global rate-limit gate.
- The route does not opt into the per-route `@upstash/ratelimit` infrastructure (no import of `Ratelimit`, no `Upstash` reference in `app/api/admin/migrations-health/` per grep).
- Cost per call: one `readdir` over a directory of ~55 small entries (< 1ms on any deploy target) plus one indexed Supabase SELECT returning ~53 rows (typical p95 < 100ms cold, < 30ms warm).
- The endpoint is gated by `requireRole(['admin'])`. An admin attacker hammering this endpoint can also hammer every other admin endpoint (which mostly mutate state) — this endpoint is read-only and the cheapest of them.
- Maximum sustainable abuse vector: an authenticated admin loops `GET /api/admin/migrations-health`. Even at 100 req/s, the per-call cost is bounded by Supabase's per-project rate limit (which is the global ceiling, not endpoint-specific) and Vercel function timeout. No write amplification, no fan-out to external services.

**Verdict:** **LOW.** Admin-only + read-only + cheap-per-call. Future iteration (the pre-authorized internal-token follow-up per ADR-017 §D3) should consider per-route rate limiting at the point a non-admin consumer is introduced; not material today.

### S8 — `outputFileTracingIncludes` side effects

**Surface:** `next.config.mjs:54-56` ships every `.sql` file under `supabase/migrations/` into the function bundle for the route.

**Verification:**
- Bundle size impact: 55 `.sql` files at typical 1-10KB each ≈ < 500KB added to the route's serverless function bundle. Far below Vercel's 50MB unzipped limit.
- The trace-include is **scoped to a single route key** (`'/api/admin/migrations-health'`). It does **not** bloat the bundles of other routes (Stripe webhook, website webhook, dashboard pages, etc.).
- Embedded-secret spot-check of the 55 migration files: ran a content search for `password\s*=`, `api_key\s*=`, `secret\s*=`, `sk_live`, `sk_test`, `whsec_`, `postgres://`, and bearer-token literals across `supabase/migrations/`. **Zero hits for any credential pattern.** All matches were SQL transaction starts (`begin;`), PL/pgSQL block opens (`begin … end;`), and benign `GRANT … TO service_role` statements (which are role names, not secrets). The migration content is exclusively schema DDL + RLS policies + GRANTs.
- The `.sql` files in the bundle are present as static assets, not executed. They are only read by `readdir`-then-filename comparison; their **bodies** are never read, parsed, or transmitted in the response.

**Verdict:** **LOW.** Bundle size growth is negligible. No embedded credentials in migration content. No exfiltration path (file bodies are not read).

### S9 — Shared allowlist module privilege

**Surface:** `lib/server/migrations/known-exceptions.mjs` is now imported by both the CI script (`scripts/check-migrations.mjs`) and the runtime adapter (`lib/server/migrations/ledger-adapter.ts`).

**Verification:**
- The module exports two `new Set([...])` constants. No functions, no side effects, no environment access, no Supabase client, no `fs` import. Module load is pure data construction.
- `.mjs` extension is intentional (per ADR-017 §D1) to keep the CI script compile-step-free. The `.mjs` is plain ESM; Node ESM resolution handles cross-extension imports from `.ts` natively in Next.js's module graph.
- The constant content (8 filenames + 6 ledger names) is already published in ADR-006 §Option B2 and ADR-014 §Orphans, both of which live in the public repo. No new disclosure.
- The module is imported via the `@/lib/...` alias (`ledger-adapter.ts:31-34`) in the route's transitive dependency graph. Standard Next.js bundling resolves it normally.

**Verdict:** **LOW.** Pure-data ESM module; no new attack surface introduced by the shared-SoT design.

### S10 — Cross-repo coordination

**Surface:** could NoonWeb (the public-website repo) accidentally call this endpoint?

**Verification:**
- The endpoint lives under `/api/admin/**`, which by convention in this repo is gated to internal operators (per `app/api/admin/earnings/consolidate/route.ts` and sister routes).
- `docs/integrations/cross-repo-webhook-v1.md` defines only the inbound `/api/integrations/website/...` and outbound `proposal-review-decision` surfaces. The migrations-health route is **not** listed there; no NoonWeb-side contract references it.
- Even if NoonWeb attempted to call this endpoint, it would need a valid admin session cookie. NoonWeb runs in a different origin under a different Supabase project and does not have admin-level sessions in App-nooncode. The call would fail at the `requireRole(['admin'])` gate.
- ADR-017 §D7 explicitly classifies this endpoint as "internal-only and operational" with no cross-repo consumer.

**Verdict:** **LOW.** No cross-repo coupling, intentionally.

### S11 — Defense-in-depth posture (defensive empty-bundle guard)

**Surface:** the `MigrationsBundleConfigError` defensive guard for the case where `outputFileTracingIncludes` is misconfigured and `readdir` returns zero `.sql` entries.

**Verification (by code reading `ledger-adapter.ts:105-123`):**
- The guard fires on two paths:
  1. `readdir` itself throws (ENOENT, permission error) — caught at line 110-116 and mapped to `MigrationsBundleConfigError`.
  2. `readdir` succeeds but the `.sql`-filtered list is empty — line 119-121 throws the same error.
- Both paths reach `route.ts:52-54` → `toErrorResponse` → 500 with `code: 'MIGRATIONS_BUNDLE_MISSING'`.
- This **prevents** the silent false-positive failure mode where a misconfigured bundle would otherwise cause the endpoint to report all 53 ledger rows as `unexpected_drift_orphans` (since no disk file would match any ledger row), driving `synced=false` and triggering deploy gates on a bug in the endpoint rather than real drift.
- From a security perspective, this is a **safety improvement**: a silent false-positive could be exploited by an attacker who knows the bundle is misconfigured to mask real drift behind the noise. The loud-fail-on-empty design makes the misconfig visible.

**Verdict:** **LOW.** The defensive pattern strengthens posture, not weakens it. Aligned with the spec's success criterion 7 expectation that drift surfacing remains trustworthy.

### S12 — Deferred R5 GRANT-migration pre-authorization

**Surface:** the first preview-deploy hit will empirically confirm whether the service-role client has SELECT permission on `supabase_migrations.schema_migrations`. If R5 fires (`42501` permission error), a GRANT migration is required.

**Verification:**
- The iteration's chain treats R5 as deferred to system-infra's preview smoke (per ADR-017 §D5 and testing review §R5 checklist). If the smoke fails, the iteration escalates to FULL and a GRANT migration enters scope.
- A GRANT migration that exposes a Supabase-internal schema to the `service_role` role is **not** a routine no-risk change. It touches the privilege boundary between the application's service role and a Supabase-managed schema.
- **Pre-authorization from security:** if the R5 GRANT materializes, it MUST go through:
  1. A standalone iteration spec.
  2. A standalone migration file (numbered per ADR-006 convention).
  3. A standalone system-security review of the GRANT scope (which roles, which schemas, which table privileges).
  4. A migration-side check that the GRANT is reversible (`REVOKE` companion documented in the iteration's rollback plan).
- The deferred verification path **cannot** bypass security review. This pre-authorization is recorded here so it cannot be lost between iterations.

**Verdict:** **MEDIUM-leaning, conditional on R5 materializing.** Not a finding in B26 (no GRANT is being shipped), but recorded as a binding constraint on the deferred-iteration scope.

## Findings

| ID | Severity | Type | Affected Area | Owner | Description | Impact | Evidence | Fix Status | Recommended Reroute |
|---|---|---|---|---|---|---|---|---|---|
| B26-SEC-F1 | LOW | logging / error exposure | `lib/server/migrations/ledger-adapter.ts` `MigrationsLedgerReadError` | system-backend (future) | The 500 body for `MIGRATIONS_READ_FAILED` interpolates raw Supabase error text. Acceptable today given the admin gate; if D3's pre-authorized internal-token posture is ever activated (broader consumer base), reconsider sanitizing the message to a generic "ledger read failed; check server logs" while logging the verbose text server-side. | Disclosure of Postgres-level error semantics (schema name, error code) to whatever role can pass the gate. With admin gate: equivalent to Dashboard access. With future token: potentially broader. | `ledger-adapter.ts:87-96`, `route.ts:52-54`, `errors.ts:67-75`. | Open (informational; no action required for admin-gated B26). | None — note flagged forward for the D3 internal-token follow-up iteration. |
| B26-SEC-F2 | LOW | rate-limit / DoS posture | `app/api/admin/migrations-health/route.ts` | system-infra (future) | Endpoint is admin-only but not behind a per-route rate-limit. Authenticated-admin-driven DoS is bounded by Supabase's per-project ceiling and Vercel's function timeout, but no in-app guard exists. | Authenticated admin can saturate the cross-schema SELECT at high concurrency. Cost: cheap reads only. | No `Ratelimit` import in route or adapter; no project-level `middleware.ts`. | Open (acceptable for B26 LITE; revisit when a non-admin consumer is introduced per ADR-017 §D3 follow-up). | None for B26. The R5 / D3 follow-up iteration should consider per-route rate limiting when the consumer base widens. |
| B26-SEC-F3 | MEDIUM (CONDITIONAL — does NOT apply to B26 as shipped) | privilege boundary | future GRANT migration if R5 fires | future iteration owner | If preview smoke reveals the service-role lacks SELECT on `supabase_migrations.schema_migrations`, the deferred GRANT migration MUST receive standalone security review of grant scope, reversibility, and role boundary. | Privilege grant to Supabase-managed schema is non-routine. | ADR-017 §Risk register row R5; testing review §R5 checklist. | Pre-authorized as a hard constraint on the deferred iteration. Cannot be bypassed. | Forces a future iteration to include a system-security review step on the GRANT scope. |

**Carry-forward acknowledgments (no severity, already covered by architecture/testing):**

- R5 (cross-schema SELECT may require policy surgery) — deferred to system-infra preview smoke; **conditional** B26-SEC-F3 binds that follow-up to a security review.
- R6 (Vercel bundle exclusion) — `outputFileTracingIncludes` + `MigrationsBundleConfigError` mitigation in place; defensive guard verified by testing F-3.
- F-1 / F-2 from testing review (steady-state count drift + route handler not unit-tested) — informational and coverage-debt; both LITE-acceptable and security-neutral.

## Conditions for passing the security gate

Per spec §Success Criterion item 7 ("zero CRITICAL and zero HIGH findings; MEDIUM explicitly accepted or addressed in-iteration"):

- ✅ Zero CRITICAL findings.
- ✅ Zero HIGH findings.
- ✅ Auth gate enforced via canonical `requireRole(['admin'])` pattern (S1).
- ✅ Service-role key confined to the client constructor; no leakage path to response or logs (S5).
- ✅ No SQL injection vector (parameterless cross-schema SELECT, no user input) (S3).
- ✅ No filesystem traversal vector (hard-coded path, no caller input) (S4).
- ✅ No new public surface, no new env var, no new secret introduced (S10).
- ✅ Defensive empty-bundle guard prevents silent false-positive drift (S11).
- ✅ Information leak via response body is admin-equivalent to Dashboard access (S2, S6).
- ✅ Migration files (now bundled into the function for this route) contain no embedded credentials (S8).
- ✅ The conditional R5 GRANT-migration pre-authorization (S12 / F3) is recorded as a binding constraint on the deferred iteration.

**Gate verdict:** **GATE-OPEN.** system-infra may proceed.

## Production-readiness judgment

The endpoint as shipped is **production-ready from a security posture standpoint**:

- Auth gate identical to the existing admin-route convention.
- Service-role posture identical to existing webhook ledger handlers (B15, Stripe).
- No new env var, no new secret, no new public surface, no PII touched.
- Defensive error paths surface infrastructure failures as loud 500s with structured codes rather than as silent false-positive drift.
- Bundle-inclusion of migration `.sql` files verified to carry no embedded credentials.

The R5 / R6 preview-deploy smoke (system-infra responsibility) is the remaining empirical validation. From a security standpoint:

- If R5 fires (permission denied) → loud 500 with `MIGRATIONS_READ_FAILED`. The endpoint fails closed, not open. No drift report can be trusted until R5 closes. **Security-safe failure mode.**
- If R6 fires (empty bundle) → loud 500 with `MIGRATIONS_BUNDLE_MISSING`. Same closed-fail posture. **Security-safe failure mode.**

Neither preview-smoke failure mode introduces a security risk; both fail closed.

## Security debt recorded

| Item | Severity | Scope | Recommended next action |
|---|---|---|---|
| B26-SEC-F1 — Supabase error text in 500 body | LOW | `MigrationsLedgerReadError` only | Revisit if D3 internal-token follow-up activates (broader consumer base). Today the admin gate makes the disclosure benign. |
| B26-SEC-F2 — No per-route rate-limit | LOW | `GET /api/admin/migrations-health` | Revisit when ADR-017 §D3 internal-token follow-up materializes a non-admin consumer. Per-route Ratelimit at that point is mandatory, not optional. |
| B26-SEC-F3 — Future GRANT migration on R5 | MEDIUM-conditional | Deferred R5 iteration (not B26) | Hard pre-authorization: the deferred GRANT migration MUST receive standalone security review of grant scope and reversibility before merge. |

## Handoff to system-infra

Items system-infra should focus on for its proportional review:

1. **R5 preview-deploy verification** — first hit to `/api/admin/migrations-health` against a Vercel preview with an admin session. Expected: 200 with `data.synced === true`, `summary.filesystem_count === 55`, `summary.ledger_count === 53`. If 500 with `code: 'MIGRATIONS_READ_FAILED'` + `permission denied for schema supabase_migrations`: escalate to FULL per ADR-017 §Risk register row R5, and the follow-up GRANT iteration MUST loop back through system-security per B26-SEC-F3.
2. **R6 preview-deploy verification** — confirm `summary.filesystem_count === 55` on the first preview hit. If `filesystem_count === 0` and 500 with `code: 'MIGRATIONS_BUNDLE_MISSING'`: fix `next.config.mjs` (likely `outputFileTracingIncludes` location under Next 16) and re-verify. The defensive guard catches the misconfig loudly — no security exposure from this failure mode.
3. **Bundle-size sanity check** — confirm the route's serverless function bundle stays under Vercel's 50MB unzipped limit after `outputFileTracingIncludes` activates. Expected addition: < 500KB.
4. **Negative-auth smoke** — hit the endpoint without an admin session (anon session and non-admin session). Expected: 401 / 403 respectively, both with `error` + `code` body shape per `toErrorResponse`. No body leak before auth (verified here by code reading; infra confirms empirically).
5. **No new env var to provision** — confirmed; B26 uses existing `SUPABASE_SERVICE_ROLE_KEY`.

Test debt items infra should be aware of (NOT blocking the infra gate):
- Route handler not unit-tested (testing F-2, intentional per LITE methodology).
- R5 and R6 are infra-side operator verifications by design (ADR-017 §D5).
- Steady-state count drift (51 vs 55) is informational and belongs to system-docs (testing F-1).

**Security gate: GATE-OPEN. Handoff to system-infra is unblocked.**
