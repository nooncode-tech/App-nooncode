# B26 + R5 follow-up — Production smoke evidence

**Date**: 2026-05-20
**Endpoint**: `GET /api/admin/migrations-health`
**Deployment**: `dpl_BYZoR85Tzvjdk1xvtcXWv1mPZv8f` (production, alias `nooncode-app-pi.vercel.app`)
**Commit**: `04a7f26` (PR #70 merge of `feature/fase-2-c-b26-r5-followup-rpc-migration`)
**Authority chain**: ADR-017 (B26 endpoint) + ADR-018 (R5 follow-up via SECURITY DEFINER RPC) + ADR-014 (ledger reconciliation convention)

## Verdict

**EMPIRICALLY CLOSED**. The endpoint is functionally operative in production after a 2-row data-state fix in `supabase_migrations.schema_migrations` (documented as **G16** in `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` §16).

## Step 1 — Anonymous probe (deploy reachability)

```
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "https://nooncode-app-pi.vercel.app/api/admin/migrations-health"
→ HTTP 401
→ {"error":"An active session is required.","code":"UNAUTHENTICATED"}
```

Confirms the route is deployed (would be `404` if the deploy were pre-B26) and the admin auth gate works (would be `200` if auth were absent).

## Step 2 — Admin smoke, first run (drift detected)

Admin session in browser, navigated to `/api/admin/migrations-health` → response (verbatim):

```json
{
  "data": {
    "synced": false,
    "summary": {
      "filesystem_count": 56,
      "ledger_count": 58,
      "grandfathered_collisions_count": 6,
      "expected_orphans_count": 6,
      "unexpected_drift_count": 2,
      "missing_in_ledger_count": 0
    },
    "missing_in_ledger": [],
    "unexpected_drift_orphans": [
      "0026_phase_3b_earnings_backend",
      "0027_phase_3_proposal_lifecycle"
    ],
    "grandfathered_collisions": [
      "0024_phase_5a_prototype_settings_admin_write.sql",
      "0025_phase_3a_leads_geo_location.sql",
      "0026_phase_3b_earnings_backend.sql",
      "0026_phase_9a_stripe_payments.sql",
      "0027_phase_10a_commissions.sql",
      "0027_phase_3_proposal_lifecycle.sql"
    ],
    "expected_orphans": [
      "phase_11_lead_auto_followup",
      "phase_4b_payment_columns",
      "phase_5_stripe_connect",
      "phase_7_client_workspace",
      "phase_7b_resolve_token_update",
      "phase_8_lead_whatsapp"
    ],
    "checked_at": "2026-05-20T19:58:16.382Z"
  }
}
```

## Step 3 — Diagnosis

The 2 entries in `unexpected_drift_orphans` correspond to ledger rows whose `name` column was inserted with the 4-digit prefix prepended (`0026_phase_3b_earnings_backend`, `0027_phase_3_proposal_lifecycle`) instead of the bare slug convention documented in ADR-014 §Convención + ADR-017 §D8 join key. The disk files exist (they appear in `grandfathered_collisions`) and their slugs (`phase_3b_earnings_backend`, `phase_3_proposal_lifecycle`) do match the bare-name convention — but because the ledger rows carry the prefix in `name`, the bare-on-bare join in `diffMigrations` (`lib/server/migrations/health.ts` lines 118-128) fails for those 2 rows, surfacing them as drift.

Root cause: G7 backfill (ADR-014, 2026-05-17) inserted 15 missing rows into the ledger; 2 of them used a different insertion mechanism (`supabase db push`-style, with 14-digit timestamp in `version` and prefix-prepended `name`) instead of the canonical bare-name convention used for the other 13. This was undetected until the B26 endpoint shipped and surfaced it loudly. The endpoint behaved exactly as designed — it detected real data-state drift that had been latent since 2026-05-17.

Diagnostic query result (2026-05-20):

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name IN ('0026_phase_3b_earnings_backend', '0027_phase_3_proposal_lifecycle');
```

| version | name |
|---|---|
| `20260420055459` | `0027_phase_3_proposal_lifecycle` |
| `20260420044531` | `0026_phase_3b_earnings_backend` |

Both rows had 14-digit timestamps in `version` (the `supabase db push` default), consistent with the hypothesis that they entered the ledger through a different path than the 4-digit-prefix backfill.

## Step 4 — Fix applied (Dashboard SQL Editor, `pdotsdahsrnnsoroxbfe`)

```sql
UPDATE supabase_migrations.schema_migrations
SET name = 'phase_3b_earnings_backend'
WHERE name = '0026_phase_3b_earnings_backend';

UPDATE supabase_migrations.schema_migrations
SET name = 'phase_3_proposal_lifecycle'
WHERE name = '0027_phase_3_proposal_lifecycle';
```

Post-fix verification:

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name IN ('phase_3b_earnings_backend', 'phase_3_proposal_lifecycle')
ORDER BY name;
```

| version | name |
|---|---|
| `20260420044531` | `phase_3b_earnings_backend` |
| `20260420055459` | `phase_3_proposal_lifecycle` |

Both rows now follow the ADR-014 convention. `version` left as 14-digit timestamp (ADR-014 permits either 4-digit prefix or 14-digit timestamp; `name` is the join key, not `version`).

## Step 5 — Admin smoke, post-fix (DoD #8 satisfied)

```json
{
  "data": {
    "synced": true,
    "summary": {
      "filesystem_count": 56,
      "ledger_count": 58,
      "grandfathered_collisions_count": 4,
      "expected_orphans_count": 6,
      "unexpected_drift_count": 0,
      "missing_in_ledger_count": 0
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
      "phase_11_lead_auto_followup",
      "phase_4b_payment_columns",
      "phase_5_stripe_connect",
      "phase_7_client_workspace",
      "phase_7b_resolve_token_update",
      "phase_8_lead_whatsapp"
    ],
    "checked_at": "2026-05-20T20:08:58.598Z"
  }
}
```

All DoD #8 acceptance criteria satisfied:

- `status: 200` ✓
- `data.synced: true` ✓
- `data.summary.ledger_count: 58` ✓ (matches B26-R5 architecture math: 52 disk-tracked + 6 expected_orphans)
- `data.summary.filesystem_count: 56` ✓
- `data.summary.unexpected_drift_count: 0` ✓
- `grandfathered_collisions` now reduced from 6 to 4 (the 2 prefixed-name disk files now match the corrected bare-name ledger rows, leaving only the 4 truly-not-in-ledger entries per ADR-006 §Option B2)

## Closures effected by this smoke

1. **B26 + R5 follow-up: empirically operative in prod** (was nominally shipped pre-smoke; the R5 follow-up RPC indirection is now confirmed working end-to-end).
2. **B26-SEC-F3 binding**: confirmed RESOLVED at runtime — admin-gated endpoint, structured response, no anon access leakage (the 401 anonymous probe verified the gate).
3. **ADR-017 §R5**: empirically closed (was nominally closed by ADR-018; the smoke confirms the RPC pattern delivers the data the adapter expects).
4. **G16 (data-state inconsistency in ledger from G7 backfill)**: discovered + diagnosed + fixed in the same session.

## FASE 2 Bloque C status

3/4 closed (B14 ✓ 2026-05-15, B15 ✓ 2026-05-20, B26 ✓ 2026-05-20 empirically). Remaining: **F-V12 leads pagination** (~4-6h).

## References

- `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` §16 G16 + §17 closure snapshot
- `docs/adrs/ADR-014-migration-ledger-reconciliation.md` §Convención (the violated convention that surfaced as G16)
- `docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md` §D8 (the join key contract)
- `docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md` (the RPC indirection that made this smoke possible)
- `lib/server/migrations/health.ts` `diffMigrations` (the pure function whose behavior surfaced G16)
- `lib/server/migrations/known-exceptions.mjs` `KNOWN_COLLISION_FILES` + `EXPECTED_ORPHAN_LEDGER_NAMES` (the two whitelist sets used by the diff)
