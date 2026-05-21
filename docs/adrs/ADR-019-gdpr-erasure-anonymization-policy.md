# ADR-019: GDPR Art. 17 erasure — anonymization sentinel, auth-side root, and `ON DELETE RESTRICT` actor handling

**Status:** Accepted
**Date:** 2026-05-21
**Deciders:** Engineering team
**Supersedes:** None
**Related:** ADR-014 (migration ledger reconciliation), ADR-015 (earnings consolidation atomic RPC), ADR-016 (transport-level webhook ledger pattern — pseudonymous), spec `specs/fase-3-b16-gdpr-art-15-17.md`, validation `docs/validations/B15 security review 2026-05-20.md` §S5.

---

## Context

NoonApp's pilot is live with real collaborator data across 26 `user_profiles`-rooted tables (full inventory: `specs/fase-3-b16-gdpr-art-15-17.md` §Authoritative PII / `profile_id`-linked table inventory). A GDPR Art. 17 request lands the instant the first collaborator asks. B15's security review and the B16 analysis spec identified that an ad-hoc erasure today would have to navigate three structural collisions simultaneously:

1. **Ledger immutability vs erasure.** Five tables carry `not null` actor columns with FKs to `user_profiles` that are load-bearing for financial audit: `wallet_ledger_entries.profile_id`, `seller_fees.seller_profile_id`, `withdrawal_requests.actor_id`, `points_ledger.actor_id`, `payouts.profile_id`. NULL is not a viable replacement — the columns reject it. Either a sentinel value is required or the FK posture must change.

2. **`auth.users` is the natural cascade root.** `user_profiles.id references auth.users(id) on delete cascade` (migration `0001_phase_1a_auth_profiles.sql`). Deleting `auth.users` cascades to `user_profiles`, which then cascades (or restricts) further. But deleting `user_profiles` first leaves the corresponding `auth.users` row orphaned and still able to authenticate until the operator manually disables it via the Supabase Dashboard. There is no in-between safe ordering.

3. **`ON DELETE RESTRICT` actor FKs block the cascade.** `leads.created_by`, `lead_proposals.created_by` (a.k.a. `submitted_by`), `tasks.created_by`, `projects.created_by`, `payouts.profile_id`, `seller_fees.seller_profile_id`, `withdrawal_requests.actor_id`, `points_ledger.actor_id`, `point_redemptions.actor_id`, `prototype_workspaces.requested_by_profile_id` all RESTRICT. A naive delete aborts mid-transaction with a foreign-key violation.

The B16 spec opened 8 questions; this ADR closes the three with long-term structural consequences (sentinel design, auth-side root, RESTRICT actor handling). The other five (export format, dry-run default, operator auth, retention, transactional safety) are signed in the spec's Architecture Decisions appendix because they are runbook/script choices, not durable schema posture.

---

## Decision

### D1 — Sentinel profile UUID + matching `auth.users` row, pre-seeded by migration

**Signed:** Q1 = option (a) — pre-seed a fixed sentinel `user_profiles` row referenced forever for anonymized actor columns.

**Sentinel UUID:** `00000000-0000-0000-0000-000000000000` (all-zeros).

Rationale: this is the lexicographically smallest UUID, easy to spot in dumps and queries (`where profile_id = '00000000-0000-0000-0000-000000000000'`), and impossible to mistake for a real Supabase-generated `gen_random_uuid()` value. The all-zeros UUID is reserved by RFC 4122 §4.1.7 as the "nil UUID" and is not assigned by any UUID-generation algorithm.

**Sentinel row content:**

| Column | Value | Rationale |
|---|---|---|
| `id` | `00000000-0000-0000-0000-000000000000` | The sentinel UUID. |
| `email` | `deleted-user@noon.invalid` | RFC 6761 reserves `.invalid` as guaranteed-unresolvable. Email cannot collide with a real user. |
| `full_name` | `Deleted User` | Human-readable in dashboards. |
| `role` | `developer` | The `public.user_role` enum has no `system` value (see migration 0001). `developer` is chosen because it is the least-privileged role in the existing RLS posture, and the sentinel profile is hard-set `is_active = false` so RLS-bound queries excluding inactive users will hide it from operator surfaces. |
| `is_active` | `false` | Excludes the sentinel from active-user listings, role-based dashboards, and any query that already filters by `is_active`. |
| `legacy_mock_id` | `gdpr-sentinel` | Discoverable by the runbook; not a UUID. |
| `locale`, `timezone` | defaults | No semantic meaning. |
| `last_login_at` | `null` | Never logs in (no `auth.users` password). |

**Critical structural dependency: matching `auth.users` row required.**

Because `user_profiles.id references auth.users(id) on delete cascade`, inserting a `user_profiles` row with `id = '00000000-0000-0000-0000-000000000000'` requires a corresponding `auth.users` row at the same `id`. The migration MUST insert into `auth.users` first, then into `user_profiles`. The `auth.users` row is created with:

- `id = '00000000-0000-0000-0000-000000000000'`
- `email = 'deleted-user@noon.invalid'`
- `encrypted_password = null` (cannot authenticate via password)
- `email_confirmed_at = null` (cannot authenticate)
- `aud = 'authenticated'`, `role = 'authenticated'` (Supabase defaults; harmless)

The sentinel is **never able to sign in** because there is no password and no confirmed email. This is the long-term posture.

**Migration path:** a new migration `0057_phase_22a_gdpr_sentinel_profile.sql` (number subject to whatever's next at backend implementation time) pre-seeds both rows inside a single transaction with `on conflict do nothing` on both inserts (idempotent re-apply). Backend's pre-implementation checklist below pins the exact SQL shape.

**Rejected alternatives:**

- **(b) Drop the FK temporarily and use a sentinel UUID not in `user_profiles`, then restore the FK as `NOT VALID`.** Rejected. `NOT VALID` Postgres FKs are a known footgun: they suppress validation for **existing** rows but enforce for **new** writes. The next ledger write referencing the sentinel UUID would fail. A subsequent `ALTER TABLE ... VALIDATE CONSTRAINT` would re-fail on the orphan sentinel value. This option requires maintaining a permanent `NOT VALID` constraint, which is invisible to schema readers and violates the convention that the schema's FK declarations are honest.
- **(c) Per-erasure-batch random UUID + mapping audit table.** Rejected. Adds a new table whose only purpose is to map sentinel UUIDs back to original profile IDs. That mapping table is itself a PII surface (it associates a deleted user with their post-erasure shadow) and recreates the problem the erasure is meant to solve. Also: each erasure pollutes `user_profiles` with another shadow row over time, which complicates every future query that joins `user_profiles`.

Option (a)'s only cost is one migration that pre-seeds two rows. The structural advantage — every anonymized actor reference points to a real, valid, queryable row with `is_active = false` — is durable for the lifetime of the application.

### D2 — `auth.users` deletion is the canonical erasure root, invoked LAST

**Signed:** Q2 = option (c) — `supabase.auth.admin.deleteUser(profileId)` invoked from the erase script as the final step, AFTER all `public.*` anonymization is complete.

**Ordering rationale:**

If `auth.users` is deleted first, the FK cascade fires immediately and deletes `user_profiles`. Any `public.*` table that the erase script intended to ANONYMIZE-in-place by setting `profile_id = '00000000-0000-0000-0000-000000000000'` would no longer have the source row to read attributes from for the export verification, and any FK with `ON DELETE SET NULL` would have already nulled itself, losing the audit trail of "what user was here before erasure". By deferring `auth.users` deletion to the end, the script has read access to the live `user_profiles` row throughout the anonymization pass, and the cascade fires exactly once at a known transaction boundary.

**Ordering (signed for the erase script):**

1. Read + verify the target `user_profiles` row exists. Refuse if `role = 'admin'` without `--allow-admin`.
2. Verify an export artefact path was provided (operator proves Art. 15 was satisfied first; per spec §Acceptance criteria #5).
3. Anonymize all ANONYMIZE-in-place tables (set `profile_id` / actor columns to sentinel UUID `00000000-0000-0000-0000-000000000000`; redact free-text PII columns; wipe metadata JSONB).
4. Anonymize all OPEN-DECISION tables per D3 below (RESTRICT-FK creators get sentinel anonymization).
5. Explicitly DELETE rows in CASCADE-delete tables that do NOT cascade via `user_profiles` FK chain (some tables have direct CASCADE FK to `user_profiles` and will be deleted by step 6's cascade; others — like `payout_methods` — already have `ON DELETE CASCADE` and only delete when the parent goes).
6. Invoke `supabase.auth.admin.deleteUser(profileId)`. This cascades through `auth.users → user_profiles → (CASCADE-FK children)` in a single Postgres operation governed by the FK declarations.
7. Verify post-state: query each table's count of rows referencing the original profile-id is zero, and count of rows referencing the sentinel is the expected anonymized count.

**Why option (c) over (a) and (b):**

- **(a) `auth.users` deletion as the authoritative root invoked first.** Rejected because the cascade fires before the anonymization step can read source attributes. The script would have to read all source data into memory before deleting, which conflicts with the transactional-safety choice (see spec appendix Q7) and creates a non-trivial window where partial state is in-memory only.
- **(b) Skip auth-side deletion, document as manual operator step.** Rejected because spec §Risks identifies "orphan auth row that can still log in" as a HIGH-severity risk. Manual cleanup is a release-readiness hole. The B15 review explicitly flagged the auth-side gap.

Option (c) is the strict ordering: anonymize first, then delete the root. The cascade does the rest. This is the only ordering that satisfies both the audit trail (ANONYMIZE rows are persistent) and the completeness requirement (no orphan `auth.users`).

### D3 — `ON DELETE RESTRICT` actor FKs are anonymized to the sentinel, never row-deleted

**Signed:** Q8 — anonymize every `ON DELETE RESTRICT` actor column to `00000000-0000-0000-0000-000000000000` before the auth-side delete fires.

**Coverage (every RESTRICT FK to `user_profiles` from the inventory):**

| Table | Column | Pre-erase value | Post-erase value |
|---|---|---|---|
| `leads` | `created_by` | original profile-id | sentinel |
| `lead_proposals` | `submitted_by` (a.k.a. `created_by`) | original profile-id | sentinel |
| `tasks` | `created_by` | original profile-id | sentinel |
| `projects` | `created_by` | original profile-id | sentinel |
| `payouts` | `profile_id` | original profile-id | sentinel |
| `seller_fees` | `seller_profile_id` | original profile-id | sentinel |
| `withdrawal_requests` | `actor_id` | original profile-id | sentinel |
| `points_ledger` | `actor_id` | original profile-id | sentinel |
| `point_redemptions` | `actor_id` | original profile-id | sentinel |
| `prototype_workspaces` | `requested_by_profile_id` | original profile-id | sentinel |

Plus the `not null + RESTRICT` ledger anchors flagged in D1 above (already covered: `wallet_ledger_entries.profile_id`, `seller_fees.seller_profile_id`, `withdrawal_requests.actor_id`, `points_ledger.actor_id`, `payouts.profile_id` — these are both RESTRICT FKs AND not-null, so they MUST be anonymized to the sentinel; NULL is impossible).

**Why anonymize, not row-delete:**

- The lead, proposal, project, task, payout, seller-fee, withdrawal, and points-ledger rows are **commercial / financial artifacts**, not the collaborator's personal property. Erasing the collaborator does not erase the business transaction. GDPR Art. 17(3)(e) explicitly permits retention for "establishment, exercise or defence of legal claims" — financial records and commercial agreements qualify.
- The collaborator-specific PII (their name, email, etc.) lives in `user_profiles`, which IS deleted by the auth-side cascade. The actor-FK column carries an identifier, not PII content; replacing it with the sentinel removes the linkage while preserving the audit shape.
- Row-deletion would require flipping the FK posture from RESTRICT to CASCADE on every one of these tables. That is a load-bearing schema change with downstream RLS / view implications that exceeds the scope of an erasure script.

**Free-text columns that may incidentally contain collaborator name:** `lead_activities.note_body`, `task_activities.note_body`, `project_activities.note_body`. Risk is LOW (per spec inventory). The erase script does NOT scan free text for name-substring redaction; the runbook documents this gap. If a Right-to-Rectification request specifically requires free-text redaction, that is a future iteration.

### D4 — Sentinel bootstrap migration (specified for backend)

Backend writes the migration file (next sequential number; expected `0057` at implementation time, subject to actual sequence). File contents (verbatim, modulo number):

```sql
-- Phase 22a — GDPR sentinel profile (B16 Art. 17 erasure anchor)
--
-- Pre-seeds a fixed `auth.users` + `user_profiles` row pair used as the
-- sentinel target for ANONYMIZE-in-place actor columns during GDPR Art. 17
-- erasure (ADR-019 D1). The sentinel UUID `00000000-0000-0000-0000-
-- 000000000000` is the RFC 4122 nil UUID, guaranteed never to collide with
-- a `gen_random_uuid()` value.
--
-- The `auth.users` row has no password and no confirmed email; it cannot
-- authenticate. The matching `user_profiles` row carries `is_active = false`
-- so it is hidden from active-user queries.
--
-- Idempotent: `on conflict do nothing` on both inserts. Safe to re-apply.
--
-- Rollback (operational, do NOT run unless backing out B16 entirely):
--   DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000';
--   -- cascades to user_profiles by FK
--
-- References:
--   - docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md §D1, §D4
--   - specs/fase-3-b16-gdpr-art-15-17.md

begin;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'deleted-user@noon.invalid',
  null,
  null,
  now(),
  now(),
  jsonb_build_object('provider', 'sentinel', 'providers', jsonb_build_array('sentinel')),
  jsonb_build_object('purpose', 'gdpr-erasure-sentinel'),
  false,
  false,
  false
)
on conflict (id) do nothing;

insert into public.user_profiles (
  id,
  email,
  full_name,
  role,
  is_active,
  legacy_mock_id,
  locale,
  timezone
) values (
  '00000000-0000-0000-0000-000000000000',
  'deleted-user@noon.invalid',
  'Deleted User',
  'developer',
  false,
  'gdpr-sentinel',
  'es-MX',
  'America/Mexico_City'
)
on conflict (id) do nothing;

commit;
```

**Backend pre-implementation verification (D4 binding):**

1. The `auth.users` column list above is the Supabase-managed shape at migration 0001 time. Backend MUST verify against the live `auth.users` schema in the target Supabase project before applying (Supabase has occasionally added columns). If a NOT NULL column without a default has been added since, the INSERT will fail; backend extends the column list with explicit NULL or the column's default value. Document any extension in the migration header comment.
2. The `aud` and `role` text values match Supabase's `authenticated` user defaults. The `is_super_admin` is `false`.
3. The migration is committed BEFORE the erase script ships. The erase script's first action MUST be to verify `select 1 from public.user_profiles where id = '00000000-0000-0000-0000-000000000000'` returns 1; refuse to run otherwise.

### D5 — Module boundaries (signed)

Helpers live under `lib/server/gdpr/`:

- `lib/server/gdpr/inventory.ts` — the table classification data. One exported `const TABLE_INVENTORY` with the per-table verdict + per-column anonymization plan. Pure data; no Supabase client. Backend may keep this as a TypeScript array of typed objects (see contracts below).
- `lib/server/gdpr/export.ts` — the export procedure. One exported function `exportUserData(client, profileId): Promise<ExportArtefact>`. Reads-only; no mutation.
- `lib/server/gdpr/erase.ts` — the erase procedure. One exported function `eraseUserData(client, profileId, opts): Promise<EraseResult>`. Honors `opts.dryRun`.

Both functions accept an already-constructed `SupabaseClient<Database>` (the scripts construct it from env). This keeps the scripts thin and the helpers testable without env coupling.

The scripts (`scripts/gdpr/export-user-data.ts`, `scripts/gdpr/erase-user-data.ts`) own:
- CLI flag parsing.
- Env validation.
- Supabase client construction.
- Output file writing (export) or stdout reporting (erase dry-run / live).
- Process exit codes.

The library (`lib/server/gdpr/*`) owns:
- The table inventory.
- The export read logic.
- The erase mutation logic (per-table SQL, sentinel anonymization, free-text redaction, auth.users deletion call).
- The post-erase verification queries.

Public function signatures pinned in the spec's Architecture Decisions appendix.

---

## Rationale

### Why a real sentinel row, not a sentinel-UUID-without-row

The temptation is to use `00000000-0000-0000-0000-000000000000` as a magic value with no corresponding `user_profiles` row. This fails immediately because the five not-null + RESTRICT FK columns (D1) require referential integrity. The only ways to bypass that integrity are: drop the FK, mark it NOT VALID, or pre-seed the row. The first two are footguns; the third is honest.

### Why the all-zeros UUID

The RFC 4122 nil UUID is the lexicographically lowest and the only UUID guaranteed by spec to never be produced by `gen_random_uuid()`, `uuidv4`, or any other generator. It is impossible to collide. It is also instantly recognizable in dumps, logs, and audit queries.

### Why role = 'developer' for the sentinel

The `public.user_role` enum has 5 values: `admin`, `sales_manager`, `sales`, `pm`, `developer`. None are "system" or "deleted". Adding a 6th enum value would be a schema change with downstream RLS implications (every policy that branches on `role` would need to consider the new value). `developer` is the lowest-privilege existing role in the operating model and, combined with `is_active = false`, the sentinel is effectively invisible to the application's RLS-bound surfaces.

### Why deletion ordering matters

`auth.users` is the natural cascade root, but deleting it first cascades to `user_profiles` immediately. Any anonymization step that depends on reading `user_profiles` attributes (for the export verification or for free-text redaction) loses its source. Anonymizing first, then deleting the root, is the only ordering that gives the script a stable read surface throughout the run.

### Why RESTRICT FKs anonymize instead of flipping cascade

Flipping `leads.created_by` from RESTRICT to CASCADE means deleting a collaborator deletes every lead they ever created. Leads carry CLIENT PII and commercial data that is NOT the collaborator's to erase. The same applies to `tasks`, `projects`, `lead_proposals`. Anonymization preserves the commercial record while removing the personal linkage.

### Why no per-erasure mapping table

Option (c) in Q1 was a per-erasure random UUID with a mapping audit table. The mapping table is a PII surface that contains exactly the kind of data the erasure was meant to remove (it associates a sentinel UUID with the original profile-id, which is itself derivable from the auth-side identifier). It also grows over time, polluting every future query that joins `user_profiles`. The fixed sentinel has none of these problems.

---

## Consequences

### Operating

- Every anonymized row across the inventory references `00000000-0000-0000-0000-000000000000`. Operator queries like `select count(*) from wallet_ledger_entries where profile_id = '00000000-0000-0000-0000-000000000000'` are the canonical post-erase verification.
- The `Deleted User` row appears in any operator query that lists `user_profiles` without filtering `is_active`. Most dashboard surfaces already filter `is_active = true`. Any surface that does not is flagged for system-frontend review (out of B16 scope; tracked as a follow-up risk in the spec).
- The `auth.users` sentinel row is invisible in the Supabase Dashboard's user list because it has `email_confirmed_at = null`. The runbook documents this.

### Schema

- One new migration adds two rows. No new tables, no new columns, no new constraints, no new FKs. The sentinel is purely a data-layer addition.

### Audit trail

- The audit trail for the erased user is: ledger rows still exist, with the actor column pointing to the sentinel. The `created_at` / `updated_at` timestamps, amounts, and references to other entities are all preserved. The user-personal identity is removed.
- Stripe Connect / Binance / other external provider records are NOT touched (spec §Cross-repo impact). The runbook documents the external escalation.

### Reversibility

This ADR is partially reversible:

- The sentinel profile bootstrap migration is reversible by deleting the `auth.users` row (cascades to `user_profiles`). However, once any erasure has run and anonymized actor columns to the sentinel, deleting the sentinel row would FK-violate every anonymized table. After the first production erasure, the sentinel row is effectively permanent.
- The erase script logic is fully reversible at the code level (revert the PR).
- A completed erasure is NOT reversible — that is by GDPR design.

### Risk register

| Risk | Mitigation | Status |
|---|---|---|
| R1 — Sentinel UUID collision with `gen_random_uuid()` | RFC 4122 nil UUID is guaranteed-unreserved by spec | Closed |
| R2 — `Deleted User` row appears in operator dashboards | `is_active = false` excludes from standard filters; runbook documents the row's existence | Closed |
| R3 — `auth.users` migration shape drift (Supabase adds columns) | D4 binds backend to verify live schema before INSERT | Open until backend implementation verifies |
| R4 — Mid-erasure failure leaves partial state | Spec Q7 (single transaction vs chunked) decided in spec appendix; refuse to delete `auth.users` if any anonymization step erred | Closed in spec appendix |
| R5 — Free-text PII not redacted (collaborator name in activity notes) | Acknowledged LOW risk; future iteration if explicit Art. 16 rectification request | Open (deferred) |
| R6 — Sentinel row deletion attempt after first erasure | After first production erasure, sentinel row is FK-anchored across multiple tables; cannot delete. Runbook documents this. | Closed |

R3 is the only risk that requires empirical confirmation at implementation time.

---

## References

- `specs/fase-3-b16-gdpr-art-15-17.md` — analysis spec (this ADR's input).
- `supabase/migrations/0001_phase_1a_auth_profiles.sql` — `user_profiles` shape and `auth.users` FK chain.
- `docs/validations/B15 security review 2026-05-20.md` §S5 — prior GDPR analysis; identified the ledger-immutability question and the auth-side gap.
- `docs/adrs/ADR-014-migration-ledger-reconciliation.md` — migration ledger reconciliation playbook (precedent for operator-run runbooks).
- `docs/adrs/ADR-016-transport-level-webhook-ledger-pattern.md` — confirmed `website_webhook_events` carries no direct PII (used in inventory).
- RFC 4122 §4.1.7 — nil UUID definition.
- RFC 6761 §6.4 — `.invalid` TLD reservation.
