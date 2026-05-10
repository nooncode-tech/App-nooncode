# ADR-006: Migration prefix collisions — preferred rename, conditional execution, CI-guard convention

**Status:** Accepted (decision); execution deferred pending ledger verification
**Date:** 2026-05-10
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

### Currently BLOCKED

As of this ADR's date (2026-05-10), execution is blocked on Supabase access:

- Supabase MCP OAuth flow was paused mid-session and not completed.
- No `.env.local` Supabase admin token (PAT) is available.
- The Supabase CLI is not linked to the remote project (`supabase/.temp/` does not contain a `project-ref` file).

Until any one of those access paths is restored, the rename cannot be safely executed. This ADR captures the **decision**; execution is **deferred**.

### When executed

Renames must be applied in **temporal apply order** — i.e., the order in which the migrations were originally authored and applied — mapped to ascending fresh prefixes starting at `0043`. The 8 files map to prefixes `0043` through `0050` (or whatever range starts above the highest prefix at execution time).

The temporal order itself must be confirmed against the ledger (which records the actual apply timestamp), not inferred from the current filename suffix.

### Atomic CI-guard update

When the rename ships, `scripts/check-migrations.mjs` `KNOWN_COLLISION_FILES` must be **emptied** (or the grandfathering logic removed entirely) **in the same commit** as the file renames. Leaving the grandfathered set in place after the rename would mask any future regression. Conversely, clearing it before the rename ships would cause CI to immediately reject the still-colliding files.

---

## Consequences

- The CI guard at `scripts/check-migrations.mjs` is **formalized** by this ADR as the project's migration-prefix convention. No new prefix collisions are allowed under any circumstances. The existing 8 files are grandfathered until rename ships.
- Until the rename ships, every new migration must use the next available prefix above `0042` and must not reuse any historical prefix.
- Once renamed, future contributors should treat prefix monotonicity as a hard rule: no manual rewinds, no inserting a new file into the middle of the sequence, no reusing a retired prefix.
- The decision intentionally does **not** rewrite history on remote. Local file rename is only safe when the remote ledger never saw those filenames — that is the entire point of the precondition.
- The Active risk on `project.context.core.md` for migration prefix collisions remains **active** until the rename ships and the CI guard's grandfathered allowlist is cleared in the same commit. The decision is documented; the structural problem is not yet resolved.

---

## Cross-references

- Audit: `docs/audits/v3-phase-0-audit.md` §3 row F-04, §4.5 (full reconciliation), §5.1 (Pre-Phase blocker), §6 PR0b (recommended phase ordering), §7 Q3 (gating question).
- CI guard source: `scripts/check-migrations.mjs` (`KNOWN_COLLISION_FILES` set is the grandfathering point).
- CI workflow: `.github/workflows/ci.yml` (the `Migration prefix check` job that runs the guard).
- Context: `docs/context/project.context.core.md` Active risk line for migration prefix collisions (now anchored to this ADR).
- Sister ADR: `docs/adrs/ADR-005-maxwell-modules-shared-brand.md` (other Pre-Phase decision).
- Current highest-prefix migration: `supabase/migrations/0042_phase_17b_wallet_maxwell_rpc_hardening.sql`.
