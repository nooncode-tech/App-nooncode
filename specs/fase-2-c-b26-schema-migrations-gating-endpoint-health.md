# spec.md — fase-2-c-b26-schema-migrations-gating-endpoint-health

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-20
- Session ID: fase-2-c-b26-schema-migrations-gating-endpoint-health
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec). Downstream chain prescribed by router: system-architecture → system-backend → system-testing → system-security → system-infra → system-docs → system-validator. Skipped per router: system-refactor (no pre-existing code to clean), system-audit (no recovery needed — pattern is well-defined), system-frontend (pure JSON endpoint, no UI).
- Router mode: Hybrid (Backend-primary + Infra co-sign). New, additive, read-only health surface; no migration; no contract; no UI.
- Depth: Lite. Justified because (a) no migration, no env var, no wire-contract surface; (b) the deterministic logic is a pure-function diff that fits in a single helper module; (c) the auth posture and response shape are the only non-obvious decisions, and both can be closed by architecture in a single ADR (ADR-017). Lite is preserved unless architecture discovers that the ledger SELECT requires policy / RLS surgery (escalation path documented in OPEN questions Q4).

### OBJECTIVE
- Define the bounded scope and authoritative inputs for adding a read-only health endpoint that compares the filesystem state of `supabase/migrations/*.sql` against the remote `public.supabase_migrations.schema_migrations` table, classifies the diff against the ADR-006 / ADR-014 known-exception sets, and returns a structured response a deploy gate, oncall dashboard, or cron probe can consume.
- The motivating drift is G7 (2026-05-11): 15 local files missing from the remote ledger + 6 orphan ledger rows + 4 grandfathered prefix collisions; reconciled out-of-band per ADR-014 on 2026-05-17, then re-touched manually on 2026-05-20 when B15 (0051) was applied via Dashboard SQL Editor + manual ledger insert. Drift can re-accumulate silently under the current operating model. The endpoint exists to catch that drift BEFORE the next `supabase db push` is attempted, not during a deploy.
- The output is the input artifact for system-architecture, which signs the four unresolved decisions (allowlist source-of-truth, response shape, auth posture, type-safety strategy for `supabase_migrations.schema_migrations`) and files ADR-017 if the rationale carries non-obvious decisions worth durable record.

### CONTEXT USED
- `project.context.core.md`: yes — confirmed Operating rules entries:
  - "Migration prefix collisions on `0024`, `0025`, `0026`, and `0027`" (line 303) — formalises ADR-006 Option B2 and the `KNOWN_COLLISION_FILES` allowlist.
  - "Schema↔ledger desync on `pdotsdahsrnnsoroxbfe`" (line 304) — formalises the 15 missing rows / 6 orphans / 4 grandfathered finding and the 2026-05-14 F-V03 materialisation that bumped reconciliation priority. After ADR-014 reconciliation 2026-05-17 the ledger sits at 52 rows; after B15 (0051) inserted on 2026-05-20 the ledger sits at 53 rows.
  - `database.types.ts` manual override count (4: `seller_fees`, `prototype_workspaces`, `lead_proposals`, `website_webhook_events` per B15 / ADR-016 D10) — relevant to Q4.
- `project.context.full.md`: not loaded — Lite depth, additive read-only surface, no cross-cutting architecture change. Architecture may load it if Q4 (type safety) or Q3 (auth posture) reveal coupling.
- `project.context.history.md`: not loaded — the relevant history (G7 materialisation 2026-05-14, ADR-014 reconciliation 2026-05-17, B15 closure 2026-05-20) is already captured verbatim in Operating rules and the two ADRs.
- Reason `full` was excluded: redundant for the bounded scope; no cross-cutting decisions to retrieve.
- Reason `history` was excluded: same — material history is already promoted to Operating rules.

### ROUTER DECISION
- Mode: Hybrid Backend-primary + Infra co-sign. Backend builds the helper + route. Infra co-signs because the endpoint is operationally a deploy-gate surface and infra is the natural owner of "what does the deploy pipeline call before pushing migrations".
- Depth: Lite. Justified above and reinforced by: no migration, no env var, no schema change, no wire-contract change with NoonWeb, no UI, no observability infrastructure beyond the endpoint's own response.
- Chain: analysis (now) → architecture → backend → testing → security → infra → docs → validator. Skipped: refactor, audit, frontend.
- Why analysis is the active skill now: nothing downstream can start until (a) the four OPEN questions are surfaced so architecture has a bounded decision set; (b) the boundary is hard enough that backend cannot drift into building a cron, a dashboard, or a cross-repo mirror; (c) the success criterion is observable (smoke against current production must return `synced=true`); (d) the known exception sets are pinned to the ADR sources of truth so the endpoint cannot silently disagree with `scripts/check-migrations.mjs`.
- Reroute already known at start: no. The escalation path to FULL is documented in the Risks register (R5) — if architecture discovers the cross-schema SELECT against `supabase_migrations.schema_migrations` requires policy/RLS surgery, analysis escalates to FULL and adds a migration to the chain.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules" below.
- Contracts or architecture inputs available:
  - `scripts/check-migrations.mjs` — current owner of `KNOWN_COLLISION_FILES` (8 filenames, of which 4 are intentionally absent from ledger per ADR-006 Option B2). The endpoint's classifier MUST agree with this allowlist or it will report grandfathered collisions as drift.
  - `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` — defines the 4 grandfathered files: `0024_phase_5a_prototype_settings_admin_write.sql`, `0025_phase_3a_leads_geo_location.sql`, `0026_phase_9a_stripe_payments.sql`, `0027_phase_10a_commissions.sql`.
  - `docs/adrs/ADR-014-migration-ledger-reconciliation.md` — defines the 6 expected orphan rows (`phase_4b_payment_columns`, `phase_5_stripe_connect`, `phase_7_client_workspace`, `phase_7b_resolve_token_update`, `phase_8_lead_whatsapp`, `phase_11_lead_auto_followup`) and the 52-row reconciled baseline (now 53 post-B15). These rows have no matching local file and per the ADR must NOT be reported as drift.
  - `lib/server/auth/guards.ts` `requireRole(['admin'])` — canonical admin-gate pattern used by `app/api/admin/earnings/consolidate/route.ts` and sister admin endpoints. Available if Q3 selects admin-only.
  - `lib/server/supabase/admin.ts` `createSupabaseAdminClient()` — service-role client; required because `supabase_migrations.schema_migrations` is a non-public schema and the user-scoped (anon-key) client cannot read it.
  - `app/api/admin/earnings/consolidate/route.ts` — reference shape for an admin-gated POST route that uses `requireRole(['admin'])` + `createSupabaseAdminClient()`. The B26 endpoint is GET, but the gate + client pattern transposes cleanly.
- Relevant handoffs received from router:
  - 4 explicit OPEN questions (Q1-Q4) — see "## Open Questions" below.
  - 7 explicit Excluded items that must not creep in (see "### Excluded" below).
  - 5 pre-identified reroute risks (R1-R5), to which analysis adds 2 surfaced during grounding (R6-R7).
  - Constraint: do not modify route files in this skill; spec only.
- External dependencies or environment assumptions:
  - `node:fs/promises.readdir()` is available under `runtime = 'nodejs'`. Both inbound webhook routes already declare `export const runtime = 'nodejs'` (confirmed). The endpoint will inherit the same runtime declaration.
  - `process.cwd()` resolves to the project root on Vercel serverless. The `supabase/migrations/` directory is checked into git and ships with every deploy; however, Vercel does NOT automatically include non-`app/` and non-`pages/` folders in the function bundle. See R6 — analysis flags this as the single most material technical risk in the iteration and forwards it to architecture.
  - Service-role credentials present in the same env (`SUPABASE_SERVICE_ROLE_KEY` per `getPhase1AAdminEnv()`); the same env values already power the Stripe webhook ledger and other admin surfaces.

### RISK SNAPSHOT
- Known risks before starting: see "## Risks" below for the classified register (R1-R5 from router + R6-R7 from analysis grounding).
- Known blockers before starting: none. The two ADR-anchored allowlists are pinned and stable; the service-role client exists; the auth helper exists; the canonical admin-gate pattern is in production.
- Known assumptions before starting:
  - The 4 grandfathered prefix collisions remain intentionally absent from the ledger (ADR-006 Option B2). Any future decision to register them is a separate iteration; until then, the endpoint must classify them as `grandfathered_collisions`, not `missing_in_ledger`.
  - The 6 expected orphans remain intentionally in the ledger (ADR-014 §"Orphans"). Removing them risks `supabase db push` re-applying nonexistent files. Until that policy changes, the endpoint must classify them as `expected_orphans`, not drift.
  - The ledger row format is `(version text, name text)` with `version` carrying either a 4-digit prefix (`'0023'`) or a 14-digit timestamp (`'20260420063335'`) per ADR-014. The classifier must accept both formats and key the join on whichever segment the filename prefix matches.

### CONTINUITY NOTES
- Previous session relevant: B15 closure 2026-05-20 (migration `0051_phase_20a_website_webhook_event_ledger.sql` applied via Dashboard SQL Editor + manual ledger row insert + 4th manual override block in `database.types.ts`). This is the most recent example of the manual-apply path that B26 is designed to catch when it diverges from disk.
- Expected next skill after this session if all goes well: system-architecture closes Q1-Q4, files ADR-017 if warranted, and hands off to system-backend with: signed response shape, signed auth posture, signed allowlist SoT decision (import-from-script vs new shared module vs duplicate constant), signed type-safety strategy for the `supabase_migrations.schema_migrations` read.

---

## Task Summary

Add a read-only health endpoint (route TBD by architecture; placeholder `app/api/admin/migrations-health/route.ts` consistent with the existing admin-gated convention) that:

1. Reads the filesystem state of `supabase/migrations/*.sql` (via `node:fs/promises.readdir` against `process.cwd() + '/supabase/migrations'`).
2. Reads the remote ledger state from `public.supabase_migrations.schema_migrations` via a service-role Supabase client.
3. Compares the two through a pure diff function that consumes both arrays plus the two known-exception sets (4 grandfathered collisions per ADR-006; 6 expected orphans per ADR-014) and returns a classified, structured result.
4. Returns a JSON response whose shape and HTTP status semantics are signed by architecture (Q2), designed for consumption by a future deploy gate / cron probe / oncall dashboard — none of which are built in this iteration.

The endpoint catches G7-class drift (15 missing rows + 6 orphans + 4 grandfathered, materialized in production 2026-05-14) **before** the next `supabase db push` is attempted, instead of discovering it during a deploy. The motivating example today is the B15 / 0051 manual apply path (Dashboard SQL Editor + manual ledger row insert) — easy to miss in a future merge if the operator forgets the manual insert step.

The endpoint does NOT remediate drift; it surfaces it. Remediation is operator-driven, following the ADR-014 playbook (apply via MCP if fresh, otherwise Dashboard SQL Editor + manual ledger row insert).

---

## Scope Boundary

### Included
- **New helper module** (placeholder path; architecture confirms in Q1):
  - A pure-function diff implementation: given `(filesystem_files: string[], ledger_rows: { version: string; name: string }[], grandfathered_collisions: Set<string>, expected_orphans: Set<string>)`, returns the classified result. No I/O; no Supabase client; no `node:fs` dependency. Trivially unit-testable.
  - A thin adapter that wires `readdir`, the admin-client SELECT, and the two allowlists into the pure function and returns the response shape.
- **New route handler** under `app/api/admin/<segment>/route.ts` (exact segment signed in Q1) that:
  - Performs the auth check signed in Q3 (admin-only via `requireRole(['admin'])`, OR internal-token header, OR anonymous-with-rate-limit — Q3 decides).
  - Calls the adapter, returns the structured response.
  - Maps the structured result to an HTTP status code per Q2 (200 when synced including expected exceptions; 503 when unexpected drift exists; 5xx if the underlying reads themselves fail).
  - Declares `runtime = 'nodejs'` (required for `node:fs`) and `dynamic = 'force-dynamic'` (required because the response varies per call).
- **Unit tests** under `tests/server/migrations/health.test.ts` (or sibling path, architecture confirms) covering the pure diff function. Mandatory edge cases:
  - Empty filesystem + empty ledger → synced.
  - Healthy state: 51 disk files (current) − 4 grandfathered + 6 expected orphans = 53 ledger rows expected; classifier returns `synced=true`, `grandfathered_collisions=[…4 files]`, `expected_orphans=[…6 rows]`, no unexpected drift.
  - Allowlist file present in ledger anyway (defensive case — should NOT trigger drift; should be silently absorbed into the "known" bucket because the file exists on disk and the row exists in ledger, regardless of the allowlist intent).
  - Expected-orphan name appears as a local file later (operator authored a placeholder) → should reclassify as "applied locally", NOT remain in `expected_orphans`. Decision: if the local file appears, the row is no longer an orphan and should be matched normally.
  - Unknown extra orphan (a name in ledger that is neither a disk file nor in the expected-orphan set) → real drift, must surface as `unexpected_orphan_in_ledger`.
  - New disk file with no ledger row, and the filename is NOT in `KNOWN_COLLISION_FILES` → real drift, must surface as `missing_in_ledger`.
  - New disk file with no ledger row, BUT the filename IS in `KNOWN_COLLISION_FILES` → grandfathered, must surface as `grandfathered_collisions` and NOT as drift.
- **No integration test against live Supabase** required for Lite. A mocked Supabase client at the adapter boundary is sufficient. The pure function is the contract surface.
- **One ADR (ADR-017) if architecture confirms warranted** — the three decisions (allowlist SoT, response shape, auth posture) each carry non-obvious rationale. A combined ADR is cheaper to maintain than three separate ones; architecture decides scope.

### Excluded
- **No cron wiring.** The endpoint is a passive surface. Whoever runs cron / uptime probes (Vercel Cron, Upstash QStash, external uptime probe) is a future iteration. Architecture may suggest a name for the follow-up but does not scope it here.
- **No dashboard / UI surface.** Pure JSON endpoint. No `app/dashboard/admin/migrations/page.tsx`. No client component. No table render of drift. If a UI is desired later, it consumes this endpoint; that work is a follow-up.
- **No website-side mirror.** This is an App-side health surface only. NoonWeb has its own migration history and is not coupled to this endpoint.
- **No caching of the filesystem read or the ledger query.** If cold-start cost is observed during backend implementation (e.g., > 500ms p95), backend flags it and the operator decides whether to chase it. Caching is a follow-up iteration — adding it now creates an invalidation surface that this iteration is not designed to maintain.
- **No new migration.** No new table, no new column, no RLS change. The endpoint reads existing surfaces only.
- **No new env var.** Uses existing `SUPABASE_SERVICE_ROLE_KEY` via `getPhase1AAdminEnv()`. If Q3 selects the internal-token auth posture, the token env var is a new variable that escalates this iteration's depth — architecture should prefer admin-only or anonymous-rate-limited to avoid the env-var surface.
- **No wire-contract change with NoonWeb.** This endpoint is App-internal and does not exist in `docs/integrations/cross-repo-webhook-v1.md`.
- **No regeneration of `lib/server/supabase/database.types.ts`.** The 4 manual override blocks (seller_fees, prototype_workspaces, lead_proposals, website_webhook_events post-B15) stay as-is. If Q4 selects "5th override block for `supabase_migrations.schema_migrations`", that is a single additive block, not a regen.
- **No behavior change to `scripts/check-migrations.mjs`.** If Q1 selects "shared module" as the allowlist SoT, the script may be refactored to import from the shared module, but its CI behavior must be byte-for-byte unchanged. If Q1 selects "duplicate constant" or "import-from-script" the script is not touched at all.
- **No remediation logic.** The endpoint does NOT attempt to insert missing ledger rows, drop unexpected orphans, or alert. It surfaces drift; the operator remediates per ADR-014.
- **No retention / cleanup of the ledger.** Reading the ledger is read-only. No DELETE, no UPDATE, no UPSERT.
- **No PII concerns.** Migration filenames and ledger row names contain only phase identifiers (`phase_3a_monetary_wallet_foundation`); no customer or seller data. Security review confirms but does not gate on PII surface.
- **No B-code, R-code, Sprint ID, or plan-ID references in `docs/context/*.md`** per MEMORY rule. The spec filename retains the B26 iteration id; the spec body may mention it; durable docs do not.

---

## Affected Files / Modules

### New files
- `app/api/admin/<segment>/route.ts` — route handler. Placeholder segment (`migrations-health` or `schema-migrations-health`); architecture picks the final name in Q1.
- `lib/server/migrations/health.ts` (placeholder) — adapter + diff function. Exports the pure diff (testable in isolation) and the adapter (orchestrates `readdir` + admin-client SELECT + diff invocation). Architecture may rename the path.
- `lib/server/migrations/known-exceptions.ts` (placeholder, conditional on Q1) — if Q1 selects the "shared module" option for the allowlist SoT, this file owns the two constants (`KNOWN_COLLISION_FILES`, `EXPECTED_ORPHAN_LEDGER_NAMES`) and is imported by both `scripts/check-migrations.mjs` and the health endpoint adapter.
- `tests/server/migrations/health.test.ts` (placeholder) — unit tests against the pure diff function. Covers the seven edge cases listed under Included.
- `docs/adrs/ADR-017-schema-migrations-health-endpoint.md` (conditional on architecture's discretion) — combined rationale for the three non-obvious decisions (allowlist SoT, response shape, auth posture). If architecture decides the rationale is shallow enough to live inline in the route's leading comment, ADR-017 is not filed.

### Modified files (conditional)
- `scripts/check-migrations.mjs` — modified ONLY if Q1 selects the "shared module" option AND the import does not break ESM/CJS boundary. The script is currently a top-level-await `node` ESM script (`#!/usr/bin/env node`, `import` syntax). The shared module must be importable from both contexts. Architecture confirms before backend touches.
- `lib/server/supabase/database.types.ts` — modified ONLY if Q4 selects "5th manual override block for `supabase_migrations.schema_migrations`". The alternative options (inline cast at query site, type the SELECT result manually) leave the file untouched.

### Files exercised but NOT modified
- `lib/server/auth/guards.ts` `requireRole(['admin'])` — called by the route handler if Q3 selects admin-only.
- `lib/server/auth/session.ts` `getCurrentPrincipal()` — called transitively by `requireRole`.
- `lib/server/supabase/admin.ts` `createSupabaseAdminClient()` — called by the adapter to read `supabase_migrations.schema_migrations`.
- `lib/env.ts` `getPhase1AAdminEnv()` — called transitively.
- `app/api/admin/earnings/consolidate/route.ts` — reference shape (do not edit).

### External systems touched
- Production Supabase project `pdotsdahsrnnsoroxbfe` via service-role SELECT against `supabase_migrations.schema_migrations`. Read-only; no writes.
- Vercel serverless function bundle: the `supabase/migrations/` directory must be present in the deployed bundle. See R6.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `requireRole(['admin'])` available in `lib/server/auth/guards.ts` | internal | Verified — used by `app/api/admin/earnings/consolidate/route.ts` | If absent, Q3 cannot select admin-only without first implementing the guard | Pre-existing, no action |
| `createSupabaseAdminClient()` available in `lib/server/supabase/admin.ts` | internal | Verified — service-role wrapper exists with proper auth-flag suppression | If absent, ledger SELECT against `supabase_migrations` schema fails (anon key cannot read it) | Pre-existing, no action |
| ADR-006 §Option B2 grandfathered set | contract | 4 filenames pinned in `KNOWN_COLLISION_FILES` (`scripts/check-migrations.mjs` lines 17-26) | If the endpoint disagrees with the script, future contributors hit conflicting signals (CI passes, endpoint fails or vice versa) | Q1 — architecture signs the SoT |
| ADR-014 §Orphans expected set | contract | 6 names listed in ADR-014 §"Orphans"; NOT currently expressed as code | If the endpoint hardcodes the list separately from the ADR, the two drift over time and ADR-014 becomes stale | Q1 — architecture signs the SoT |
| `node:fs/promises.readdir` available under `runtime = 'nodejs'` | infra | Verified — inbound webhook routes already use this runtime | If the route accidentally inherits `runtime = 'edge'`, `node:fs` is unavailable and the endpoint 500s at cold start | Backend |
| `supabase/migrations/` directory present in Vercel function bundle | infra | UNCONFIRMED — see R6 | If absent, `readdir` returns empty array → endpoint reports 51 missing files as drift → false positive on every prod call | Infra co-sign — backend tests deploy preview before docs |
| Service-role read permission on `supabase_migrations.schema_migrations` | contract / data | The schema is a Supabase-managed namespace; the service-role key has full access by default | If Supabase changes the default policy or the service-role grant is revoked, the SELECT fails with 42501 | Pre-existing, no action |
| `pdotsdahsrnnsoroxbfe` ledger has 53 rows post-B15 (2026-05-20) | data | Confirmed via `project.context.core.md` Operating rules + ADR-014 baseline math (52 + 1) | Smoke target: against current production, the endpoint must return `synced=true` with 4 grandfathered + 6 expected orphans surfaced as known exceptions, 0 unexpected drift | Pre-existing, no action |

---

## Risks

The 5 router-prescribed risks (R1-R5) plus 2 surfaced during analysis grounding (R6-R7). Each risk is mapped to a mitigation and the question that closes it (where applicable).

| # | Risk | Probability | Impact | Severity | Mitigation | Owner question |
|---|---|---|---|---|---|---|
| R1 | Allowlist SoT divergence — if the endpoint duplicates the 4-file grandfathered list separately from `scripts/check-migrations.mjs`, future additions to either side drift, recreating a G7-class divergence between CI and the health endpoint | High over a 6-month window if duplicated | Medium (operator confusion, false-positive alerts) | High | Single source of truth for both sets, signed in Q1 | Q1 |
| R2 | Response shape lock-in — once a deploy gate, cron, or dashboard consumes the response, the field names become a de-facto contract; renaming or restructuring later breaks consumers | Medium | Medium | Medium | Architecture signs the wire shape (Q2) with consumer audience explicitly considered (deploy-gate boolean + structured drift arrays) | Q2 |
| R3 | Auth posture mismatch — admin-only blocks CI deploy steps that don't have admin session; anonymous-rate-limited leaks the migration name list publicly; internal-token introduces a new env var and shared-secret rotation burden | High (the choice has real downstream consequences) | Medium-High (depending on which deploy-pipeline use case is intended) | High | Architecture signs Q3 with the deploy-gate use case explicitly in mind. Recommendation from analysis: admin-only initially, with the internal-token option as a documented follow-up if a CI consumer materializes | Q3 |
| R4 | Type safety hole — `supabase_migrations.schema_migrations` is not in the generated `Database` type (verified: zero matches in `database.types.ts`). Without explicit typing, the SELECT result is `any` and silent shape changes go undetected | Medium | Low (the query is trivial, columns are stable) | Low | Architecture picks one of: 5th override block in `database.types.ts`; inline typed cast at query site (`(client as any).schema('supabase_migrations').from('schema_migrations').select(...)`); manual type declaration co-located with the adapter | Q4 |
| R5 | Scope creep to FULL — if architecture discovers the cross-schema SELECT requires policy changes, RLS surgery, or a new GRANT, Lite is no longer adequate and the chain needs to add system-infra earlier + a migration. Probability is low (Supabase service-role has unrestricted schema access by default) but not zero | Low | High (changes the depth, the chain, and the validator gate) | Medium | Analysis pre-authorises an escalation to FULL if architecture surfaces this. Architecture documents the SELECT path in the ADR-017 draft (if filed) and confirms no policy surgery is needed before backend starts | — (architecture escalates if needed) |
| R6 | Vercel bundle exclusion — Next.js / Vercel does NOT auto-include arbitrary top-level directories (like `supabase/`) in serverless function bundles. The function may deploy without the migration files at runtime, so `readdir` returns `[]` and the endpoint reports 51 missing files as drift on every production call. This is the single most material technical risk in the iteration | Medium-High (default Vercel behavior unless mitigated) | High (every prod call returns a false-positive 503) | High | Architecture documents one of three mitigations: (a) explicit `outputFileTracingIncludes` config in `next.config.js` to force `supabase/**` into the bundle; (b) inline the filename list at build time via a code-gen step that reads the directory and emits a TS array; (c) ship the filename list as a JSON artifact loaded via `import` (which Vercel always bundles). Architecture signs the chosen mitigation; backend verifies on a Vercel preview before merging to develop | Architecture must address before backend implementation |
| R7 | Filename-to-ledger-version mapping ambiguity — ledger rows use either a 4-digit prefix (post-CLI-convention) or a 14-digit timestamp (pre-CLI-convention, ADR-014 §Orphans). The classifier must key the join correctly for both formats. If it joins purely on prefix-to-version equality, the 6 expected orphans (timestamp version) will be reported as `unexpected_orphan_in_ledger` because no disk file has a 14-digit prefix | Medium (easy bug to introduce, easy to miss in tests if the fixture only covers 4-digit format) | Medium (false positives on every call) | Medium | Diff function MUST key the join on `(filename_without_extension, ledger.name)` — `name` is the suffix-without-prefix and is the stable identifier across both version formats per ADR-014. Backend codes this defensively; testing covers both formats in fixtures | Backend / Testing |

---

## Open Questions

These questions block ARCHITECTURE, not analysis. Analysis cannot answer them without signing technical decisions that belong to architecture.

### Q1 — Allowlist source-of-truth

Where do the two known-exception sets live?

- (a) **Import from `scripts/check-migrations.mjs`.** The endpoint adapter imports `KNOWN_COLLISION_FILES` from the script. Pros: zero duplication; ADR-006 stays the contract; only one place to update on future ADR amendment. Cons: ESM/CJS interop — the script is currently a top-level-await ESM CLI; importing from server-side TS may require build-time transformation. The script does NOT currently export `EXPECTED_ORPHAN_LEDGER_NAMES` (it doesn't need to for CI), so adding a new export to the script is required either way.
- (b) **Duplicate constants** in the new adapter module. Pros: zero coupling to the script; easy to ship. Cons: R1 materialises within months — any future ADR amendment must edit two places.
- (c) **New shared module** `lib/server/migrations/known-exceptions.ts` exporting both sets. The script is refactored to import from it; the adapter imports from it. Pros: single source of truth; clean dependency direction (CI script imports from `lib/`, not the other way around); pinned to the ADRs via comment headers. Cons: requires confirming the script's ESM `import` statement can resolve a TS source via the Node runtime (likely needs the script to import the compiled `.js` output or a `.mjs` mirror, OR the shared module is written in `.mjs` directly).

**Recommendation from analysis:** (c) with the shared module written as `.ts` in `lib/server/migrations/known-exceptions.ts`, and the CI script either compiled via `tsx` (if already available) or the shared module duplicated AS `.mjs` next to the `.ts` source with a comment binding them. The cleanest path is to write the shared module as `.ts` AND have a generated `.mjs` artifact for the CI script's consumption (build-step transform), OR ship the module as plain `.mjs` in `lib/server/migrations/` and let the TS adapter import from `.mjs` (Next.js supports this with `allowJs` and proper module resolution). **Architecture signs the final shape after confirming the CI script's import path works locally.**

### Q2 — Response shape and HTTP status semantics

What does the endpoint return on the wire?

**Proposed shape:**

```json
{
  "data": {
    "synced": true,
    "summary": {
      "filesystem_count": 51,
      "ledger_count": 53,
      "grandfathered_collisions_count": 4,
      "expected_orphans_count": 6,
      "unexpected_drift_count": 0
    },
    "missing_in_ledger": [],
    "unexpected_orphan_in_ledger": [],
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

**HTTP status semantics:**
- `200 OK` when `synced === true`, including the case where the 4 grandfathered + 6 expected orphans are present (those are EXPECTED, not drift).
- `503 Service Unavailable` when `synced === false` (any unexpected drift). This is the deploy-gate-friendly choice — a probe that reads `503` blocks the deploy without needing to parse JSON.
- `500 Internal Server Error` when the underlying reads themselves fail (e.g., `readdir` throws, ledger SELECT fails). Distinct from `503` because the system cannot determine drift state.

**Open variants for architecture:**
- Should the response use a flatter shape with `drift: { missing: [], orphan: [], grandfathered: [], expected_orphans: [] }` instead of separate top-level arrays?
- Should `synced` be computed from `unexpected_drift_count === 0` server-side, or be derived client-side from the arrays? (Server-side recommended — single source of truth, the boolean is the deploy-gate primary signal.)
- Should the response carry the git SHA or commit-time identifier of the disk state, so consumers can detect "endpoint sees an older bundle than expected"? (Possible, but pushes Lite toward FULL — recommendation: defer to follow-up unless architecture sees real consumer need.)

**Recommendation from analysis:** the proposed shape above with the `synced` boolean as the primary signal and the structured arrays as the diagnostic surface. Architecture signs the final shape.

### Q3 — Auth posture

Three viable options, each with material trade-offs:

- (a) **Admin-only via session principal** (`requireRole(['admin'])`). Pros: zero new surface; reuses canonical pattern; no env var. Cons: CI deploy steps do NOT have admin session — if the intended consumer is a Vercel-pipeline pre-deploy probe, admin-only blocks it. Cron probes (Vercel Cron, Upstash QStash) also typically lack admin session unless wrapped with a service-account login.
- (b) **Anonymous-but-rate-limited** (e.g., 10 calls per minute per IP via the existing `@upstash/ratelimit` infrastructure). Pros: trivial to consume from any pipeline or probe; no auth coordination. Cons: info-leak — the migration name list is exposed publicly (e.g., `phase_5_stripe_connect`, `phase_11_lead_auto_followup`). Severity: LOW (the names already exist in the public `nooncode-org/App-nooncode` repo per Operating rules; no new information is leaked). The rate limit prevents enumeration-as-DoS but does not prevent enumeration-as-information.
- (c) **Internal-token header** (e.g., `x-noon-internal-token: <secret>` validated against `NOON_INTERNAL_MIGRATIONS_HEALTH_TOKEN` env var). Pros: precise — only the deploy pipeline and oncall scripts can call it; no info leak; no admin coordination. Cons: new env var to provision and rotate; new shared-secret surface; couples this iteration to a secret-management policy that today is operator-driven and ad-hoc.

**Recommendation from analysis:** (a) **admin-only** for this iteration, with (c) **internal-token** documented as the natural follow-up if a CI consumer materializes. The repo is currently public per Operating rules (line 308), which makes (b) only marginally worse than (a) in terms of info-leak, but (b) introduces a new public surface — which is harder to remove later than it is to add. (a) is the most conservative choice and aligns with the existing admin-gated convention in `app/api/admin/**`. **Architecture signs.**

### Q4 — Type safety for the `supabase_migrations.schema_migrations` read

`supabase_migrations` is a non-public Supabase-managed schema. The `Database` type in `lib/server/supabase/database.types.ts` (which is `public`-only) does NOT include it. Querying it via the service-role client requires one of:

- (a) **5th manual override block** in `database.types.ts` — declares the `supabase_migrations` schema and the `schema_migrations` table type. Pros: consistent with the existing 4 override blocks; type-safe at the call site. Cons: precedent — another "always manual" entry; manual count goes from 4 to 5 and the cleanup follow-up gets one more block to reconcile.
- (b) **Inline typed cast** at the query site: declare a `SchemaMigrationsRow` interface co-located with the adapter, then cast the SELECT result. Pros: zero impact on `database.types.ts`; type lives next to the only consumer; easy to delete if the endpoint is ever removed. Cons: the cast bypasses the SDK type system — if Supabase changes the row shape, the cast silently lies.
- (c) **`any`-cast with eslint-disable** + manual runtime validation (`zod` schema). Pros: forces explicit runtime validation, which is a defensible posture for a health endpoint that wants to flag schema changes too. Cons: introduces a `zod` schema for a 2-column read, which is verbose.

**Recommendation from analysis:** (b) inline typed cast with a `SchemaMigrationsRow` interface declared in the adapter file. The row shape is stable (`version text, name text`) per ADR-014 and Supabase's own migration tracking; the cost of (a) is not justified for a 2-column read against a Supabase-managed schema. **Architecture signs.**

---

## Assumptions

- The `supabase/migrations/` directory on disk is the authoritative list of intended migrations. Files removed from disk but still in the ledger are either expected orphans (per ADR-014) or true drift; there is no "soft-deleted" intermediate state.
- The ledger's `name` column is the stable join key across both 4-digit-prefix and 14-digit-timestamp `version` formats. This is consistent with how ADR-014's orphan list is keyed.
- The service-role client can read `supabase_migrations.schema_migrations` without additional GRANT or policy changes. This is the Supabase default; if it is not true in `pdotsdahsrnnsoroxbfe` specifically (e.g., the project has custom RLS on the `supabase_migrations` schema), R5 escalates the iteration to FULL.
- Architecture and backend confirm the Vercel bundling mitigation (R6) before backend writes the route handler. The endpoint is useless if it ships without the migration files in the bundle.
- No NoonWeb-side coordination is required. The endpoint is App-internal.

---

## Chunking Decision

**Single iteration, not chunked.** The deliverables (helper module, route handler, unit tests, optional ADR) are tightly coupled — the helper without the route is dead code; the route without tests does not earn validator's COMPLETE; the optional ADR-017 if filed must be filed alongside the implementation, not before or after.

Estimated effort: ~3-5h depending on Q1 (shared-module path requires touching `scripts/check-migrations.mjs` and confirming the ESM/CJS interop) and R6 (Vercel bundling mitigation may add 30-60min of preview testing).

If during architecture R5 materializes (cross-schema SELECT requires policy surgery) OR R6's mitigation forces a `next.config.js` change with non-obvious blast radius, analysis re-routes to **chunked**:
- Chunk A = helper module + unit tests + ADR (no route, no Vercel deploy).
- Chunk B = route handler + Vercel bundling mitigation + preview smoke + production deploy.

That decision belongs to architecture.

---

## Recommended Testing Methodology

**Unit-first against the pure diff function; no integration test against live Supabase required for Lite.** Justification: the diff function is a deterministic mapping of `(files, rows, allowlist, expected_orphans) → classified result` with no I/O. Unit tests at the helper boundary cover all seven edge cases exhaustively. Integration testing against the real ledger would only prove that `createSupabaseAdminClient()` works (already proven by every other admin endpoint in the project) and that `readdir` returns the expected list (proven by any local `ls`). Neither earns the cost of an integration test fixture.

The single integration-shaped validation worth doing is the **production smoke**: after deploy, hit the endpoint once against `pdotsdahsrnnsoroxbfe` and confirm `synced=true`, `summary.filesystem_count=51`, `summary.ledger_count=53`, `summary.grandfathered_collisions_count=4`, `summary.expected_orphans_count=6`, `summary.unexpected_drift_count=0`. This is a one-shot operator check, not an automated test, and lives in the validator's close-out evidence.

TDD-strict not required — the function shape is known from the spec. CDD inappropriate — no user-visible behavior. BDD inappropriate — no behavioral scenarios beyond the unit-test edge cases.

---

## Recommended Route Depth

**Lite.** Justified above. Escalation to Full triggered only by R5 (policy surgery for cross-schema SELECT) or R6 mitigation forcing a non-obvious infra change.

---

## Success Criterion

B26 is **COMPLETE** when **all** of the following hold:

1. The endpoint exists at the architecture-signed path (placeholder `app/api/admin/migrations-health/route.ts`) and is reachable in Production Vercel.
2. The pure diff function exists in the architecture-signed location, exports a single function with the contract `(files, rows, grandfathered, expected_orphans) → classified result`, and has unit tests covering all seven edge cases (empty/empty, healthy state with current production numbers, allowlist file present in ledger, expected-orphan file appears on disk, unknown extra orphan, new disk file not in collisions, new disk file in collisions).
3. The auth posture signed in Q3 is enforced and blocks unauthorized callers with the appropriate status code (401 / 403 for admin-only, 429 for anonymous-rate-limited, 401 for internal-token).
4. The response shape matches the architecture-signed contract from Q2, including the HTTP status mapping (200 synced, 503 drift, 500 read failure).
5. The 4 grandfathered prefix collisions and the 6 expected orphans never trigger `synced=false`. Production smoke against `pdotsdahsrnnsoroxbfe` (53 ledger rows after B15 closed) returns `synced=true` with 4 grandfathered + 6 expected orphans surfaced as known exceptions.
6. The Vercel bundling mitigation (R6) is in place — `readdir` against the deployed function returns the 51 disk filenames currently in `supabase/migrations/`, not an empty array.
7. Security review (system-security) returns zero CRITICAL and zero HIGH findings. The info-leak severity of (b) anonymous-rate-limited (if Q3 selects it) is explicitly accepted as LOW given the repo is currently public. Any MEDIUM findings are explicitly accepted by the user OR addressed in this iteration.
8. ADR-017 filed if architecture confirms warranted; otherwise the rationale lives in the route's leading comment with explicit pointers to ADR-006 §Option B2 and ADR-014 §"Orphans".
9. `docs/context/project.context.core.md` Closed-in-runtime entry added (no B-codes, R-codes, or plan-IDs per MEMORY rule).
10. system-validator returns COMPLETE.

If criterion 7 surfaces an unresolved CRITICAL or HIGH: B26 is **BLOCKED**. The finding is triaged and either fixed in-iteration or explicitly deferred with a risk register entry; validator does not return COMPLETE.

If criteria 1-6 pass but 8-9 are missing: B26 is **PARTIAL** until the documentation lands.

---

## Definition of Done

- All 10 success criteria above satisfied.
- The endpoint, the helper module, and the unit tests are in their architecture-signed locations.
- The Vercel bundling mitigation is verified empirically on a preview deploy before merging to develop, and again on Production after merge.
- The auth posture is enforced and a negative test (unauthorized caller receives the expected status) is captured in the testing skill's evidence.
- Production smoke against `pdotsdahsrnnsoroxbfe` returns the expected `synced=true` shape with the 4 grandfathered + 6 expected orphans surfaced.
- Operating rules in `docs/context/project.context.core.md` carry a new entry documenting the existence of the health endpoint and its auth posture (no B-codes per MEMORY).
- No code, contract document, or migration touched outside the affected files list.
- system-validator returns COMPLETE.

---

## Handoff to system-architecture

system-architecture is the next active skill. Inputs already on disk (this spec). Required outputs from architecture before system-backend can start:

1. **Q1 signed** — allowlist source-of-truth decision (import-from-script / duplicate / shared module) with the chosen module path and ESM/CJS interop strategy if (a) or (c).
2. **Q2 signed** — final response wire shape and HTTP status mapping. Architecture confirms the deploy-gate consumer pattern (boolean primary signal + structured arrays).
3. **Q3 signed** — auth posture (admin-only / anonymous-rate-limited / internal-token) with explicit reasoning recorded in ADR-017 or the route's leading comment.
4. **Q4 signed** — type safety strategy for the `supabase_migrations.schema_migrations` read (5th override block / inline cast / `any` + zod).
5. **R6 mitigation signed** — chosen Vercel bundling strategy (`outputFileTracingIncludes` / build-time codegen / JSON artifact import) with a preview-test plan handed to backend.
6. **R5 confirmed not material** — quick sanity check that the service-role client can SELECT from `supabase_migrations.schema_migrations` on `pdotsdahsrnnsoroxbfe` without policy changes. If it cannot, escalate this iteration to FULL and add system-infra earlier in the chain plus a migration / GRANT step.
7. **ADR-017 filed (or not)** — combined or inline; architecture decides scope.

When architecture is done: hand off to system-backend with the route path, the helper module path, the chosen allowlist SoT, the response shape, the auth posture, the type-safety strategy, and the bundling mitigation plan.

---

## Lifecycle

- Status: **Draft** (pending architecture sign on Q1-Q4 + R5/R6).
- Moves to **Approved** when architecture closes Q1-Q4 and confirms R5/R6.
- Moves to **Implemented** when validator returns COMPLETE.
- No superseding spec planned.
