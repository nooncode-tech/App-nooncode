# ADR-006: Migration prefix collisions — preferred rename, conditional execution, CI-guard convention

**Status:** Accepted (decision); reconciliation required (Branch B / Option B2: additive convention permanent — see §Reconciliation required)
**Date:** 2026-05-10 (decision); 2026-05-11 (reconciliation amendment)
**Deciders:** Engineering team

---

## Context

Four migration prefix pairs collide in `supabase/migrations/`. Each prefix is reused by two unrelated phases:

- `0024_phase_3a_monetary_wallet_foundation.sql` vs `0024_phase_5a_prototype_settings_admin_write.sql`
- `0025_phase_3a_bridge_wallet_compatibility.sql` vs `0025_phase_3a_leads_geo_location.sql`
- `0026_phase_3b_earnings_backend.sql` vs `0026_phase_9a_stripe_payments.sql`
- `0027_phase_10a_commissions.sql` vs `0027_phase_3_proposal_lifecycle.sql`

Apply order between the two members of each pair is currently dependent on filename sort (Supabase CLI applies migrations in lexical order). This is fragile: a future rename, a different filesystem with case-insensitive sort, or a contributor unaware of the convention can silently flip apply order and corrupt schema state.

The collision was catalogued as audit finding **F-04 (Critical)** in `docs/audits/v3-phase-0-audit.md` §3 row F-04, with full reconciliation in §4.5, listed as Pre-Phase blocker PR0b in §5.1 and §6, and gated as user question §7 Q3.

A CI guard already exists at `scripts/check-migrations.mjs`. It hard-codes a `KNOWN_COLLISION_FILES` set containing exactly these 8 filenames and rejects any **new** migration whose prefix duplicates an existing one outside that grandfathered set. The guard runs on every push and PR to `develop` / `master` (see `.github/workflows/ci.yml`).

The current highest-prefix migration is `0042_phase_17b_wallet_maxwell_rpc_hardening.sql`.

---

## Decision

Rename the 4 collided pairs (the 8 listed files) to fresh prefixes starting at `0043` and ascending in temporal apply order — **only if** the remote `supabase_migrations.schema_migrations` ledger has not already registered those filenames. Verbatim from the product owner: *"Si no pasa nada ni rompe nada, renombremos las 4 colisiones"*.

Until that ledger check can be performed, **execution is deferred**. The CI guard at `scripts/check-migrations.mjs` is **formalized by this ADR as the project's migration-prefix convention**: no new prefix collisions are allowed; the existing 8 are grandfathered until the rename ships.

---

## Rationale

- Renaming restores monotonic prefixes and eliminates filename-sort fragility. After the rename, apply order matches numerical order, which is what every Supabase tutorial and runbook assumes.
- Fresh prefixes (`0043+`) preserve historical apply order without overlapping any applied or future migration. They sit cleanly above the current highest prefix (`0042`).
- The conditional ("no rompe nada") protects against breaking environments where Supabase has already recorded a migration row keyed by the current filename — a local rename in that case desynchronizes the ledger and breaks `supabase db push` (the CLI matches local files against ledger rows by name; a renamed file is treated as "new", and the original entry becomes orphaned).
- Formalizing the CI guard as the convention closes the door on new collisions while the rename is pending, preventing the problem from getting worse during the deferred window.

---

## Conditions / Execution rule

This section is required to capture the conditional nature of the decision.

### Hard precondition

Before any rename is performed, the remote `supabase_migrations.schema_migrations` ledger must be queried in **every** environment that has ever run `supabase db push` (local developer machines, staging, production), and confirmed to **not** contain the 8 colliding filenames as registered rows. If even one environment has a registered row for any of these filenames, the rename for that file is **blocked** in that environment until a separate migration-history reconciliation is designed.

### Ledger verified — 2026-05-11

The remote `supabase_migrations.schema_migrations` ledger on project `pdotsdahsrnnsoroxbfe` was queried via Supabase MCP (`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`). The ledger returned 37 rows.

**Finding on the 8 colliding filenames**: 4 of the 8 are registered in the ledger. The `version` column for these rows is a timestamp (CLI was switched mid-history from numeric prefix to timestamp convention), and the colliding filename's suffix lives in the `name` column. Per the original decision rule, suffix-match in `name` counts as registration:

| Local file | Ledger row (`version`, `name`) |
|---|---|
| `0024_phase_3a_monetary_wallet_foundation.sql` | `20260420042745`, `phase_3a_monetary_wallet_foundation` |
| `0025_phase_3a_bridge_wallet_compatibility.sql` | `20260420043817`, `phase_3a_bridge_wallet_compatibility` |
| `0026_phase_3b_earnings_backend.sql` | `20260420044531`, `0026_phase_3b_earnings_backend` |
| `0027_phase_3_proposal_lifecycle.sql` | `20260420055459`, `0027_phase_3_proposal_lifecycle` |

The other 4 colliding files (`0024_phase_5a_prototype_settings_admin_write.sql`, `0025_phase_3a_leads_geo_location.sql`, `0026_phase_9a_stripe_payments.sql`, `0027_phase_10a_commissions.sql`) do not appear in the ledger under any matching name.

Because at least one of the 8 filenames is registered, the rename branch (A) is unsafe in the spec's literal sense: renaming any of the 4 registered files locally would cause `supabase db push` to treat the new prefix as a new migration and attempt to re-apply, corrupting the ledger or failing on already-existing objects. **The branch decision is therefore B (no rename, reconciliation).**

---

## Reconciliation required

### Branch decision: B (Option B2 — additive convention permanent)

Among the three Branch B options surfaced by the Analysis spec (`specs/fase-0-b4-adr-006-execution.md` §"Branch B — reconciliation playbook"), **Option B2** is adopted:

- **B1 (ledger rewrite)** rejected: would require service-role SQL mutation against the production migration ledger. Irrecoverable on partial failure. Not justified by the residual benefit of monotonic prefixes when the schema is already coherent.
- **B2 (additive convention permanent)** adopted: the 4 historical collisions are accepted as a permanent fact of the migration history. `KNOWN_COLLISION_FILES` in `scripts/check-migrations.mjs` stays populated as a hard frozen set. No new collisions are allowed (the CI guard already enforces this for any prefix not in the grandfathered set).
- **B3 (defer to dedicated reconciliation iteration)** rejected: leaves the Active risk open indefinitely with no concrete trigger. B2 closes it honestly.

Under B2:

- `supabase/migrations/` is unchanged. No file renames.
- `scripts/check-migrations.mjs` is unchanged. The grandfathered set stays as a permanent allowlist.
- The Active risk for migration prefix collisions in `docs/context/project.context.core.md` is **downgraded** from "execution pending" to "permanent convention; no new collisions allowed". It is not removed entirely because the prefix duplication remains visible in `ls supabase/migrations/` and future contributors need to know it is intentional.

### Wider schema↔ledger desync (out-of-scope finding)

The ledger verification surfaced a finding **larger than the original 8-file scope**: the migration ledger on `pdotsdahsrnnsoroxbfe` is materially incomplete relative to the local `supabase/migrations/` directory. This finding is recorded here because it shares root cause with ADR-006, but it is **not closed by this ADR** — a follow-up iteration is required.

**Local files absent from the ledger** (verified via `mcp__plugin_supabase_supabase__execute_sql` 2026-05-11):

```
0023_phase_8a_project_conversion_status_activity
0024_phase_5a_prototype_settings_admin_write
0025_phase_3a_leads_geo_location
0026_phase_9a_stripe_payments
0027_phase_10a_commissions
0028_phase_9b_payments_insert_policy
0029_phase_10b_withdrawal_requests
0030_phase_11a_points_ledger
0031_phase_12a_notification_preferences
0032_phase_13a_client_portal
0033_phase_5b_v0_generation_columns
0034_phase_14a_website_inbound_integration
0035_phase_14b_request_changes_review_action
0041_phase_17a_stripe_webhook_event_ledger
0042_phase_17b_wallet_maxwell_rpc_hardening
```

**Ledger rows without a matching local file** (likely applied via dashboard SQL editor or sourced from a sister repo sharing the same Supabase project):

```
phase_4b_payment_columns         (version 20260420063335)
phase_5_stripe_connect           (version 20260420082147)
phase_7_client_workspace         (version 20260420083605)
phase_7b_resolve_token_update    (version 20260420083650)
phase_8_lead_whatsapp            (version 20260420084120)
phase_11_lead_auto_followup      (version 20260421032316)
```

**Schema state verification** (via `mcp__plugin_supabase_supabase__list_tables` on schema `public`): the public schema contains every table the 15 ledger-missing migrations create (`stripe_webhook_events`, `withdrawal_requests`, `points_ledger`, `wallet_accounts`, `earnings_ledger`, `maxwell_search_runs`, `client_access_tokens`, `website_inbound_links`, etc.). The schema is therefore **applied and coherent** — only the ledger metadata is incomplete.

**Operational impact**: running `supabase db push` against `pdotsdahsrnnsoroxbfe` would currently attempt to re-apply 15 migrations and fail on already-existing objects. Production migrations are presumably being applied manually (dashboard SQL editor or direct `psql`); this ADR does not change that pattern but flags it as a hidden landmine for any future contributor who assumes `supabase db push` is safe.

**Follow-up iteration required**: a dedicated reconciliation iteration must scope (a) whether to backfill the 15 missing rows into the ledger using `supabase migration repair` or equivalent SQL, (b) what to do with the 6 ledger rows that have no local file (delete? leave? source from sister repo and import?), and (c) restore `supabase db push` as a safe operation. That iteration is not gated by this ADR but must precede any future bulk migration deploy via CLI. Spec filename when authored: `specs/fase-0-b4b-ledger-reconciliation.md`.

### Atomic CI-guard update

Under Branch B / Option B2, the CI guard `scripts/check-migrations.mjs` is **not edited**. The grandfathered allowlist becomes permanent and is the source-of-truth for the historical convention. New collisions are still rejected.

### When executed (historical — superseded by §Reconciliation required)

The original execution plan called for renames in **temporal apply order**, mapped to ascending fresh prefixes starting at `0043`. The 8 files would have mapped to prefixes `0043` through `0050`. This plan is retained as historical context but is superseded by the Branch B reconciliation above and is no longer the operational path.

---

## Consequences

- The CI guard at `scripts/check-migrations.mjs` is **formalized permanently** by this ADR as the project's migration-prefix convention. The 8 grandfathered filenames are accepted as a permanent historical fact. No new prefix collisions are allowed under any circumstances.
- Every new migration must use the next available prefix above the highest currently-present prefix (`0042` as of this date) and must not reuse any historical prefix.
- Prefix monotonicity is a hard rule going forward: no manual rewinds, no inserting a new file into the middle of the sequence, no reusing a retired prefix.
- The decision intentionally does **not** rewrite the remote ledger. Local file rename was the preferred outcome but is unsafe given the ledger registered 4 of the 8 colliding filenames. Renaming is foreclosed; the convention is the resolution.
- The Active risk on `project.context.core.md` for migration prefix collisions is **downgraded** to "permanent convention; no new collisions allowed" but remains documented so future contributors recognize the duplicated prefixes are intentional.
- A separate wider finding (ledger missing 15 local migrations + 6 orphan ledger rows) is recorded in §Reconciliation required and gates a follow-up iteration before any future `supabase db push` against the production project.

---

## Cross-references

- Audit: `docs/audits/v3-phase-0-audit.md` §3 row F-04, §4.5 (full reconciliation), §5.1 (Pre-Phase blocker), §6 PR0b (recommended phase ordering), §7 Q3 (gating question).
- CI guard source: `scripts/check-migrations.mjs` (`KNOWN_COLLISION_FILES` set is the grandfathering point).
- CI workflow: `.github/workflows/ci.yml` (the `Migration prefix check` job that runs the guard).
- Context: `docs/context/project.context.core.md` Active risk line for migration prefix collisions (now anchored to this ADR).
- Sister ADR: `docs/adrs/ADR-005-maxwell-modules-shared-brand.md` (other Pre-Phase decision).
- Current highest-prefix migration: `supabase/migrations/0042_phase_17b_wallet_maxwell_rpc_hardening.sql`.
