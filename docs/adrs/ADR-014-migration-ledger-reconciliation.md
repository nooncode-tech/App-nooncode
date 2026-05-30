# ADR-014: Migration ledger reconciliation — backfill 15 missing rows, leave grandfathered collisions + orphans as-is

**Status:** Accepted
**Date:** 2026-05-17
**Deciders:** Engineering team
**Supersedes:** None
**Related:** ADR-006 (migration prefix convention and rename — §Option B2), roadmap §16 G7.

---

## Context

Roadmap §16 G7 (logged 2026-05-11) recorded a wider-than-expected schema↔ledger desync on the production Supabase project `pdotsdahsrnnsoroxbfe`. Beyond the 8 prefix collisions ADR-006 dealt with, the ledger `supabase_migrations.schema_migrations` was missing **15 local migrations** that had been applied physically (their objects exist in the schema), and **6 orphan rows** existed in the ledger without a matching local file.

The original ADR-006 §Reconciliation required block prescribed an iteration named `fase-0-b4b-ledger-reconciliation` for this work. That iteration was deferred until 2026-05-14 when the gap materialized in production: the F-V03 validation surfaced HTTP 500 from `/api/wallet` because the `0042_phase_17b_wallet_maxwell_rpc_hardening.sql` migration had never been applied to remote (its RPCs `ensure_user_wallet_for_profile` / `ensure_monetary_wallet_for_profile` simply did not exist as functions in the DB despite the local file). The migration was applied out-of-band via `mcp__plugin_supabase_supabase__apply_migration`, but the wider desync was acknowledged to remain open.

Between 2026-05-14 and 2026-05-17 four additional migrations were applied OOB via Supabase Dashboard SQL Editor (MCP auth had expired and renewal was operator-side):
- `0044_phase_18b_seller_fees_rls.sql` (B3 closure)
- `0045_phase_18c_payment_checkout_link_persistence.sql` (F-V08)
- `0046_phase_18d_prototype_demo_chat_urls.sql` (F-V06)
- `0047_phase_19a_proposal_pricing_context.sql` (ADR-013)

This brought the total missing-from-ledger count to **19** by the time G7 reconciliation was scheduled today. The decision to schedule G7 before Path C (FASE 3 lifecycle) was driven by the certainty that Path C would add another migration; doing G7 first means Path C's migration can be applied through a sync flow rather than adding to the gap.

---

## Decision

The ledger is reconciled by **backfilling 15 of the 19 missing rows** with their 4-digit prefix as `version`. The remaining 4 are **grandfathered collisions** intentionally left out of the ledger per ADR-006 §Option B2 ("additive convention permanent"). The 6 orphan rows are **left in the ledger** because the underlying schema objects exist and removing them would risk a `supabase db push` re-applying nonexistent files.

Specifically:

### Reconciled (15 backfilled into ledger, 2026-05-17)

```
0023 phase_8a_project_conversion_status_activity
0028 phase_9b_payments_insert_policy
0029 phase_10b_withdrawal_requests
0030 phase_11a_points_ledger
0031 phase_12a_notification_preferences
0032 phase_13a_client_portal
0033 phase_5b_v0_generation_columns
0034 phase_14a_website_inbound_integration
0035 phase_14b_request_changes_review_action
0041 phase_17a_stripe_webhook_event_ledger
0043 phase_18a_seller_fees
0044 phase_18b_seller_fees_rls
0045 phase_18c_payment_checkout_link_persistence
0046 phase_18d_prototype_demo_chat_urls
0047 phase_19a_proposal_pricing_context
```

INSERT executed via Dashboard SQL Editor on 2026-05-17 against `supabase_migrations.schema_migrations`. The `version` column receives the 4-digit prefix as a string (consistent with rows 0001–0022 and 0036–0040 that were originally inserted by `supabase db push` with the same format).

### Grandfathered (4 collisions intentionally NOT registered)

```
0024_phase_5a_prototype_settings_admin_write   (collides with 0024_phase_3a_monetary_wallet_foundation, which IS in ledger)
0025_phase_3a_leads_geo_location               (collides with 0025_phase_3a_bridge_wallet_compatibility, which IS in ledger)
0026_phase_9a_stripe_payments                  (collides with 0026_phase_3b_earnings_backend, which IS in ledger)
0027_phase_10a_commissions                     (collides with 0027_phase_3_proposal_lifecycle, which IS in ledger)
```

These 4 files remain in `supabase/migrations/` (their schema objects are applied) but **do not have a row in the ledger**. Per ADR-006 §Option B2, they are "permanent grandfathered collisions" and the convention is to keep them out of the ledger to avoid resolving the prefix ambiguity at write time. The CI guard `scripts/check-migrations.mjs` continues to allowlist the 8 collision filenames as `KNOWN_COLLISION_FILES`; no new collisions are accepted.

### Orphans (6 rows in ledger without local file, left as-is)

```
20260420063335 phase_4b_payment_columns
20260420082147 phase_5_stripe_connect
20260420083605 phase_7_client_workspace
20260420083650 phase_7b_resolve_token_update
20260420084120 phase_8_lead_whatsapp
20260421032316 phase_11_lead_auto_followup
```

Timestamps 2026-04-20 to 2026-04-21 predate the App-nooncode filesystem migration check-in. These rows likely originate from a previous dev branch or the sister repo `noon-web-main` that applied SQL directly to the Supabase project via Dashboard SQL Editor. The underlying schema objects exist (verified through ongoing operation; e.g., `payments.stripe_*` columns and `client_workspace` tables are used by code paths today). Removing the ledger rows would risk:

1. A future `supabase db push` from a clean checkout might infer these are net-new migrations to author (they would have no local file to push) — false alarm.
2. Any reconciliation tool that compares ledger vs filesystem would surface them as a gap requiring author input — operator burden for no functional benefit.

Keeping them in the ledger as historical record is the lowest-risk choice. No placeholder files are created locally because (a) `supabase db push` ignores files whose ledger row already exists, and (b) creating 6 empty `.sql` files would clutter the filesystem with semantically meaningless entries.

### Deferred follow-ups (not blocking G7 closure)

- **Regenerate `database.types.ts`** — requires MCP `generate_typescript_types` or local `npx supabase gen types typescript --project-id pdotsdahsrnnsoroxbfe`. Blocked today by MCP unauthorized (the access token expired and renewal is operator-side). The current manual overrides on `database.types.ts` (for B3 `seller_fees`, F-V06 `prototype_workspaces`, 0047 `lead_proposals`) keep typecheck/lint/build green and can be removed when the regen runs. Tracked in roadmap §16 as G7 follow-up.
- **Drift reconciliation** — `UpdateFeedEventType` enum vs `lead_activity_type` post-0043; `payment activation` `string|null` vs `string|undefined`. Only materializes when the full regen runs. Depends on the regen above.
- **Smoke test of `supabase db push`** — the next real migration (probably Path C / FASE 3 lifecycle) is the natural smoke test. Creating a dummy migration just for verification adds noise.

---

## Rationale

### Why backfill instead of leaving the gap

`supabase db push` (the CLI tool) reconciles the local `supabase/migrations/` against the remote ledger by inserting any local file whose prefix is **not** in the ledger. With 19 missing rows, a `supabase db push` from a clean checkout would attempt to re-apply 15 migrations whose objects already exist — every one would fail with "relation already exists" or similar errors. The push would error out and abort, leaving the CLI workflow unusable.

Backfilling those 15 rows restores `supabase db push` to a working state. The CLI sees the ledger has every file accounted for (except the grandfathered 4) and exits cleanly when there is nothing new to apply. New migrations placed in `supabase/migrations/0048+` will be pushed normally.

### Why the grandfathered 4 stay out

ADR-006 §Option B2 explicitly accepted the prefix collisions as a "permanent convention; no new collisions allowed." Adding the 4 grandfathered ones to the ledger would require fabricating a tie-breaking representation (suffix on version, prefix in name, synthetic timestamp, etc.), and any choice would either:

1. Force `supabase db push` to error out when it computes the ledger key from the filename and finds a conflict (the prefix `0024` would map to two rows).
2. Diverge from the natural CLI ledger key convention (filename prefix → version), creating a separate code path for collision rows that future maintainers would need to understand.

Both are worse than keeping the 4 files in `supabase/migrations/` as filesystem artifacts that `scripts/check-migrations.mjs` allowlists but the ledger does not see. Anyone running `supabase db push` from a clean checkout would have those 4 attempt to apply against existing objects and fail — same failure mode as before, but **only** for those 4. The remediation is documented (see runbook update below): on a clean checkout, manually skip those 4 from the push by either temporarily moving them out of the directory or by writing a custom apply script.

In practice, `supabase db push` from a clean checkout is a rare operation; the typical flow is `mcp__supabase__apply_migration` for the single migration being added. The grandfathered 4 are a known cost of ADR-006 Option B2 that the team accepted at the time.

### Why orphans stay in the ledger

Three alternatives were evaluated:

1. **Delete the 6 orphan rows.** If `supabase db push` is later run from a clean checkout, the CLI computes ledger keys from filename prefixes and would not find these — no harm done. **BUT**, any reconciliation tool (custom or external) that compares ledger vs filesystem would surface them as "files missing locally" and prompt the operator to author them. With the schema already containing the objects these orphans were meant to create, this is a never-ending false alarm.
2. **Create placeholder `.sql` files locally.** Each orphan gets a corresponding `supabase/migrations/2026XXXXXXXX_*.sql` file containing only a comment `-- empty placeholder, schema applied via Dashboard pre-2026-04`. Tradeoff: 6 commits of clutter for one-time peace of mind. Not justified.
3. **Leave them.** Lowest-effort, captures the historical truth ("these were applied"), and never produces a false alarm because the ledger row signals "applied" and `supabase db push` skips them. **Chosen.**

### Why deferred items are deferred

- **Regen `database.types.ts`** is not blocking any feature today. The manual overrides have a clear lineage (each labeled with the migration that caused them and the date) and can be unwound in one PR when MCP auth returns. Holding G7 closure on this would create an artificial bottleneck.
- **Drift reconciliation** depends on the regen output, so by transitivity it's deferred.
- **Smoke test of `supabase db push`** would require a dummy migration. The next real migration (Path C / FASE 3 lifecycle) serves the same verification purpose without code-shaped waste.

---

## Consequences

### CLI workflow restored

`supabase db push` from a clean checkout will skip every reconciled migration (52 rows in ledger match the corresponding local files, with the exception of the 4 grandfathered collisions and the 6 orphans). The remaining surface that could trip the CLI is exactly:

- The 4 grandfathered collisions — failures expected and accepted per ADR-006 §Option B2.
- New migrations placed in `supabase/migrations/0048+` — these would be applied successfully and the ledger updated by the CLI itself, matching the new convention.

### MCP auth dependence reduced

`mcp__supabase__apply_migration` remains the preferred path for applying new migrations because it (a) executes the SQL transactionally and (b) inserts the ledger row in the same transaction. When MCP auth is unavailable, the fallback is:

1. Apply the SQL via Dashboard SQL Editor.
2. INSERT the ledger row manually: `insert into supabase_migrations.schema_migrations (version, name) values ('<prefix>', '<name-without-prefix>');`

This is now documented in the runbook §X.

### `database.types.ts` keeps manual overrides until follow-up

Three manual override blocks remain in `lib/server/supabase/database.types.ts`:

1. `seller_fees` table type (from B3, 2026-05-11).
2. `prototype_workspaces.demo_url` + `chat_url` columns (from F-V06, 2026-05-17).
3. `lead_proposals.project_type` + `complexity` columns (from 0047, 2026-05-17).

These keep typecheck/build green. When MCP auth returns or the operator runs `npx supabase gen types typescript`, the regen output should match the union of these overrides, and the override blocks can be deleted in one commit. Until then, **new migrations that add columns also require a new manual override** on `database.types.ts`. This is acknowledged operational debt.

### Convention for future migrations

1. **Author** the migration file in `supabase/migrations/0048+_<phase>_<slug>.sql`.
2. **Apply** via MCP (`apply_migration`) if auth is fresh. Else apply via Dashboard SQL Editor AND insert the ledger row manually with the 4-digit prefix.
3. **Verify** the ledger row exists: `select version, name from supabase_migrations.schema_migrations where version = '0048';`
4. **Update** `database.types.ts` — preferred regen via `npx supabase gen types`; fallback manual override block with a comment referencing the migration number and the date.
5. **CI guard** `scripts/check-migrations.mjs` continues to reject new prefix collisions.

### Risk register

| Risk | Mitigation |
|---|---|
| `supabase db push` from clean checkout still fails on the 4 grandfathered collisions | Document the workaround in the runbook (temporarily move grandfathered files out of the directory before the push, or use `apply_migration` per-file) |
| MCP auth expiring becomes the dominant operational friction | Document the Dashboard + manual ledger INSERT fallback in the runbook |
| Future operator forgets to insert the manual ledger row when applying via Dashboard | The runbook reminds; over time the gap would resurface. Mitigation: every iteration that touches schema reviews the ledger in its closure docs |

---

## Addendum — 2026-05-30: 7th expected orphan + drift re-reconciliation

A full ledger↔filesystem↔object reconciliation on 2026-05-30 (prompted by two unapplied migrations surfacing as production 500s) closed a fresh gap and recorded one new expected orphan.

**Unapplied migrations found and applied OOB via `apply_migration`:**

- `0065_phase_23a_prototype_seller_brief` — column `prototype_workspaces.seller_brief` was missing entirely (no ledger row, no object). Its absence threw `column ... does not exist` on every `getPrototypeWorkspaceByLeadId` call, 500-ing the lead-detail prototype card AND aborting `ensureWebsiteInboundPrototypeWorkspace` (inbound prototype linkage). One inbound lead's workspace was backfilled from the stored payload.
- `0064_lead_value_on_proposal_approval` — the function/trigger did **not** exist in the DB **even though a ledger row `version='0064'` was present**. This is the same failure mode this ADR's Risk register named ("operator forgets to insert the ledger row" — here inverted: the row existed without the object). **Lesson: a ledger row is not proof the SQL ran. The drift classifier (`diffMigrations`) matches ledger-row names only and is blind to this case — recent/risky migrations must be object-verified (`pg_proc` / `pg_trigger` / `information_schema.columns` / `pg_indexes` / `pg_constraint`), not just ledger-checked.**

**New expected orphan (7th):**

```
20260526204409 phase_3r5_outbound_webhook_events_alerted_at
```

The `alerted_at` column on `outbound_webhook_events` was applied 2026-05-26 as its own ledger row, then folded into the single `0062_phase_3r5_outbound_webhook_events.sql` file (the column lives inline at `0062:43`). The applied column has no separate disk file, so its ledger row is a genuine orphan — added to `EXPECTED_ORPHAN_LEDGER_NAMES` (now 7 names) under the same rationale as the original six. No placeholder file is created (per §Rationale "Why orphans stay in the ledger").

Post-reconciliation, all 67 repo migrations are present in prod (0059–0065 object-verified; older confirmed via active features). Two harmless bookkeeping residues remain: a duplicate `lead_value_on_proposal_approval` ledger row (`0064` + the 2026-05-30 timestamp apply), and the new orphan above.

## References

- `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` — original collision treatment + Option B2 adoption
- Roadmap §16 G7 entry (2026-05-11) — original gap report and 2026-05-14 materialization note
- `supabase_migrations.schema_migrations` snapshot 2026-05-17 — 37 rows pre-backfill; 52 rows post-backfill
- `scripts/check-migrations.mjs` — CI guard with the 8-file collision allowlist
- `lib/server/supabase/database.types.ts` — current manual overrides; canonical regen pending
- `specs/fase-0-b4-adr-006-execution.md` — Branch B / Option B2 decision execution record
