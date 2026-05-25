# B16 GDPR Art. 15/17 — manual integration test procedure

**Iteration:** fase-3-b16-gdpr-art-15-17
**Owner:** Pedro (noondevelop@gmail.com)
**Date:** 2026-05-21
**Status:** Manual procedure — local Supabase unavailable in this environment (Docker not present); run against a dev/staging Supabase project at operator discretion. **NEVER run against production** (`pdotsdahsrnnsoroxbfe`).

## Why this is a manual procedure, not an automated test

The B16 backend deliverables ship behind a hard guard chain (sentinel migration, destructive env var, interactive typed confirmation, export-artefact prerequisite). The unit test suite covers:

- All 8 architecture decisions (sentinel UUID, auth-side delete ordering, RESTRICT FK anonymization, transactional safety relaxation).
- Every helper function (`assertSentinelExists`, `planErase`, `eraseUserData`, `exportUserData`, `resolveProfileIdByEmail`).
- The load-bearing **failure-injection safeguard**: if any ANONYMIZE step errors, `auth.admin.deleteUser()` is NOT invoked (`tests/server/gdpr/erase.test.ts` — "eraseUserData does NOT invoke auth.admin.deleteUser if any ANONYMIZE step fails").

What unit tests cannot cover:

- Real Postgres FK behavior (the cascade `auth.users → user_profiles → CASCADE-FK children`).
- The actual schema shape of `auth.users` in the live Supabase project (drift since GoTrue v2.x).
- The real `supabase.auth.admin.deleteUser()` API call.

This document is the operator's step-by-step procedure for those.

---

## Prerequisites

1. A dev or staging Supabase project (NOT prod). Project reference in `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. `tsx` available (`npx tsx --version`).
3. Working directory: project root.
4. A test profile email you can recreate (suggested: `pedro_test_user@noon.invalid`).
5. Read-only confirmation that you are NOT pointed at production:
   ```
   grep NEXT_PUBLIC_SUPABASE_URL .env.local
   ```
   The URL must NOT contain `pdotsdahsrnnsoroxbfe`.

---

## Step 1 — Apply migration 0057

In the Supabase Dashboard SQL editor (dev/staging project):

```sql
-- Paste the full contents of:
-- supabase/migrations/0057_phase_22a_gdpr_sentinel_profile.sql
```

Verify the sentinel exists:

```sql
select id, email from auth.users
  where id = '00000000-0000-0000-0000-000000000000';
-- Expect: 1 row, email = 'deleted-user@noon.invalid'

select id, email, role, is_active, legacy_mock_id from public.user_profiles
  where id = '00000000-0000-0000-0000-000000000000';
-- Expect: 1 row, role='developer', is_active=false, legacy_mock_id='gdpr-sentinel'
```

If either query returns 0 rows, the migration is broken — STOP. Re-read ADR-019 §D4 binding (verify the live `auth.users` column shape; Supabase may have added a NOT NULL column without a default).

---

## Step 2 — Seed a synthetic test profile across the inventory

The test profile must have at least one row referencing it from every inventoried table that supports it (some tables require chained references — e.g., `wallet_ledger_entries` requires a `wallet_accounts` row first).

Use the existing seed scripts where possible:

```bash
SUPABASE_URL="<dev-url>" \
SUPABASE_SERVICE_ROLE_KEY="<dev-key>" \
npx tsx scripts/seed-phase-1a-users.ts
```

For tables not covered by the seed script, insert manually via Supabase SQL editor. Suggested test rows for full inventory coverage:

```sql
-- Replace <TEST_PROFILE_ID> with the actual user_profiles.id of pedro_test_user@noon.invalid.

-- ANONYMIZE-in-place ledger anchors
insert into wallet_accounts (profile_id, balance_cents)
  values ('<TEST_PROFILE_ID>', 0);
insert into wallet_ledger_entries (profile_id, entry_type, amount_cents, metadata)
  values ('<TEST_PROFILE_ID>', 'CREDIT', 1000, jsonb_build_object('test', 'pii-marker'));
insert into earnings_ledger (actor_id, amount_cents, kind)
  values ('<TEST_PROFILE_ID>', 500, 'commission');
-- ... continue for payouts, seller_fees, withdrawal_requests, points_ledger, point_redemptions

-- ANONYMIZE-in-place commercial entities (RESTRICT FKs)
insert into leads (created_by, name, email, status)
  values ('<TEST_PROFILE_ID>', 'Test Lead', 'lead@example.com', 'new');
insert into lead_proposals (created_by, lead_id, body)
  values ('<TEST_PROFILE_ID>', '<LEAD_ID>', 'test proposal body');
insert into tasks (created_by, title, status)
  values ('<TEST_PROFILE_ID>', 'Test Task', 'open');
insert into projects (created_by, name, status)
  values ('<TEST_PROFILE_ID>', 'Test Project', 'active');

-- CASCADE-delete (personal data)
insert into user_notifications (profile_id, message)
  values ('<TEST_PROFILE_ID>', 'test notification');
insert into payout_methods (profile_id, kind, details)
  values ('<TEST_PROFILE_ID>', 'bank', jsonb_build_object('iban', 'TEST'));
```

Verify the seed:

```sql
select 'leads' as t, count(*) from leads where created_by = '<TEST_PROFILE_ID>'
union all
select 'wallet_ledger_entries', count(*) from wallet_ledger_entries where profile_id = '<TEST_PROFILE_ID>'
union all
select 'tasks', count(*) from tasks where created_by = '<TEST_PROFILE_ID>'
union all
select 'projects', count(*) from projects where created_by = '<TEST_PROFILE_ID>';
-- Expect: every row >= 1
```

---

## Step 3 — Run the Art. 15 export

```bash
mkdir -p /tmp/gdpr-test
npx tsx scripts/gdpr/export-user-data.ts \
  --email pedro_test_user@noon.invalid \
  --output /tmp/gdpr-test/test-export.json \
  --ticket "B16-INTEGRATION-TEST"
```

Expected stdout: `Exported <N> rows across 26 tables to /tmp/gdpr-test/test-export.json.`

Verify the artefact:

```bash
jq '.gdpr_export_metadata' /tmp/gdpr-test/test-export.json
# Expect: schema_version=1.0.0, profile_id=<TEST_PROFILE_ID>, ticket_ref=B16-INTEGRATION-TEST

jq '.tables | keys | length' /tmp/gdpr-test/test-export.json
# Expect: 26 (every inventory table covered)

jq '.tables.wallet_ledger_entries | length' /tmp/gdpr-test/test-export.json
# Expect: >= 1
```

If any seeded table returns 0 in the artefact → BUG. The inventory and the seed do not agree; escalate to Architecture.

---

## Step 4 — Run the Art. 17 dry-run

```bash
npx tsx scripts/gdpr/erase-user-data.ts \
  --email pedro_test_user@noon.invalid \
  --export-artefact /tmp/gdpr-test/test-export.json \
  --reason "B16 integration test dry-run"
```

Expected stdout:

```
GDPR erase plan for <TEST_PROFILE_ID> (pedro_test_user@noon.invalid) — DRY-RUN
--------------------------------------------------------------------------------
  wallet_ledger_entries                ANONYMIZE-in-place        1 rows → ANONYMIZED-to-sentinel
  earnings_ledger                      ANONYMIZE-in-place        1 rows → ANONYMIZED-to-sentinel
  ... (one line per inventory table)
  user_profiles                        CASCADE-delete            1 rows → DELETED

No mutations performed. Pass --execute to apply.
```

Confirm the plan matches your seed (every seeded table shows the expected row count).

Re-run the seed-confirmation SQL from Step 2 — counts must be unchanged (dry-run is read-only).

---

## Step 5 — Run the Art. 17 live erasure

```bash
I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1 \
npx tsx scripts/gdpr/erase-user-data.ts \
  --email pedro_test_user@noon.invalid \
  --export-artefact /tmp/gdpr-test/test-export.json \
  --reason "B16 integration test live erase" \
  --execute
```

The script prints the resolved target + email + full_name and prompts:

```
Type the email or profile-id EXACTLY (case-sensitive) to confirm:
```

Type `pedro_test_user@noon.invalid` and press Enter.

Expected stdout:

```
GDPR erase verification for <TEST_PROFILE_ID> — DONE
--------------------------------------------------------------------------------
  wallet_ledger_entries                affected=1     remaining=0 sentinel=1
  earnings_ledger                      affected=1     remaining=0 sentinel=1
  ...
auth.users deleted: true
```

Verify post-state:

```sql
-- ANONYMIZE rows now reference sentinel
select count(*) from wallet_ledger_entries where profile_id = '00000000-0000-0000-0000-000000000000';
-- Expect: count >= 1 (your seeded row, now anonymized)

select count(*) from wallet_ledger_entries where profile_id = '<TEST_PROFILE_ID>';
-- Expect: 0

select count(*) from leads where created_by = '00000000-0000-0000-0000-000000000000';
-- Expect: count >= 1

-- CASCADE rows are gone
select count(*) from user_notifications where profile_id = '<TEST_PROFILE_ID>';
-- Expect: 0 (cascade fired)
select count(*) from payout_methods where profile_id = '<TEST_PROFILE_ID>';
-- Expect: 0

-- auth.users is gone
select count(*) from auth.users where email = 'pedro_test_user@noon.invalid';
-- Expect: 0

-- user_profiles is gone (cascaded from auth.users)
select count(*) from public.user_profiles where id = '<TEST_PROFILE_ID>';
-- Expect: 0
```

If any of these queries returns the wrong count → BUG. Capture the divergence and escalate.

---

## Step 6 — Failure-injection round-trip (load-bearing safeguard)

Goal: verify Backend's transactional-relaxation safeguard. If any ANONYMIZE step fails mid-run, `auth.admin.deleteUser` must NOT fire.

### Setup

1. Re-create the test profile (`pedro_test_user@noon.invalid`) per Step 2.
2. Re-run Step 3 to produce a new export artefact (the previous one is stale).

### Inject failure via RLS

The simplest reliable failure injector is a transient revoke of UPDATE permission on one ANONYMIZE table. Choose the third inventory table (per the unit test's choice, for symmetry):

```sql
-- Find the third ANONYMIZE table from lib/server/gdpr/inventory.ts.
-- Current order: wallet_ledger_entries, earnings_ledger, payouts, seller_fees, ...
-- Pick `payouts`.

revoke update on table payouts from service_role;
-- This causes the .update().eq().select() call to error with a permission failure.
```

### Run the erase

```bash
I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1 \
npx tsx scripts/gdpr/erase-user-data.ts \
  --email pedro_test_user@noon.invalid \
  --export-artefact /tmp/gdpr-test/test-export-2.json \
  --reason "B16 failure-injection test" \
  --execute
```

Confirm the prompt with the email.

### Expected outcomes (the safeguard)

The script should exit with code 3 (`Supabase query failure during anonymization`) and print:

```
[gdpr-erase] Erase failed: GDPR erase step "anonymize" failed on table "payouts": permission denied for table payouts
```

Verify the safeguard:

```sql
-- (a) auth.users row STILL EXISTS (auth-delete was NOT invoked)
select count(*) from auth.users where email = 'pedro_test_user@noon.invalid';
-- Expect: 1

-- (b) Prior ANONYMIZE tables (wallet_ledger_entries, earnings_ledger) DID anonymize
select count(*) from wallet_ledger_entries where profile_id = '00000000-0000-0000-0000-000000000000';
-- Expect: count >= the row we seeded
select count(*) from earnings_ledger where actor_id = '00000000-0000-0000-0000-000000000000';
-- Expect: count >= the row we seeded

-- (c) Failing table is UNCHANGED — rows still reference the original profile-id
select count(*) from payouts where profile_id = '<TEST_PROFILE_ID>';
-- Expect: count >= 1
select count(*) from payouts where profile_id = '00000000-0000-0000-0000-000000000000';
-- Expect: 0 (no rows touched on the failing table)
```

If any of (a)/(b)/(c) is wrong, the safeguard is broken — STOP and escalate to Architecture + Backend.

### Recovery: confirm idempotent re-run

Restore the permission and re-run the erase:

```sql
grant update on table payouts to service_role;
```

```bash
I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1 \
npx tsx scripts/gdpr/erase-user-data.ts \
  --email pedro_test_user@noon.invalid \
  --export-artefact /tmp/gdpr-test/test-export-2.json \
  --reason "B16 failure-injection recovery" \
  --execute
```

The re-run should:
- Find the test profile (Step a confirmed it still exists).
- Re-anonymize the tables that already had sentinel (UPDATE with `eq(col, originalId)` finds 0 rows; the UPDATE is a no-op — affected=0; this is acceptable).
- Anonymize the previously failed table (`payouts`) — now affected >= 1.
- Run auth.admin.deleteUser → succeeds.
- Verification passes.

Confirm the final post-state per Step 5's verification queries.

---

## Step 7 — Cleanup

```sql
-- The sentinel-anonymized rows are now permanent (cannot identify the original user).
-- Optionally truncate the test rows if the dev project should stay clean:
delete from wallet_ledger_entries where metadata @> jsonb_build_object('test', 'pii-marker');
delete from leads where name = 'Test Lead';
delete from tasks where title = 'Test Task';
delete from projects where name = 'Test Project';
-- ... etc
```

The sentinel `user_profiles` + `auth.users` rows stay (they are durable per ADR-019 §D1).

---

## Pass/fail criteria

The integration is PASS if every numbered step above produced the expected output AND the failure-injection round-trip confirmed the safeguard holds (a/b/c all verified).

The integration is FAIL if:

- Step 3 export omits any inventory table that was seeded.
- Step 5 leaves any row referencing the original profile-id on an ANONYMIZE table.
- Step 5 leaves any CASCADE-delete row referencing the original profile-id.
- Step 5 leaves `auth.users` row present.
- Step 6 fires `auth.admin.deleteUser` despite the mid-erase failure.
- Step 6 leaves the failing table in an inconsistent state (e.g., partial UPDATE) — this would indicate that supabase-js's individual UPDATE is not atomic, which would invalidate Backend's mitigation.

---

## What this procedure does NOT cover

- **Stripe / Binance external provider records.** Operator escalates separately per the runbook.
- **Backup snapshots.** Supabase PITR is out of scope; standard retention defense applies.
- **NoonWeb-side client PII.** B14 (NoonWeb) owns; runbook documents the cross-repo handoff.
- **RLS-bound surfaces that list sentinel rows.** Future system-frontend review checks any UI surface that joins `user_profiles` without filtering `is_active`. Out of B16 scope.

---

## References

- `specs/fase-3-b16-gdpr-art-15-17.md` — analysis spec + Architecture Decisions appendix.
- `docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md` — §D1, §D2, §D3, §D4, §D7.
- `lib/server/gdpr/{sentinel,inventory,export,erase}.ts` — implementation.
- `scripts/gdpr/{export-user-data,erase-user-data}.ts` — CLI wrappers.
- `tests/server/gdpr/{sentinel,inventory,export,erase}.test.ts` — unit coverage (53 tests).
- `supabase/migrations/0057_phase_22a_gdpr_sentinel_profile.sql` — sentinel bootstrap.
