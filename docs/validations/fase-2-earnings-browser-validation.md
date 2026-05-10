# FASE 2 — Earnings reales (browser validation runbook)

**Date:** 2026-05-10
**Branch:** `feature/fase-2-earnings-browser-validation`
**Validator:** Pedro (browser) + Claude (server log monitoring + verification)
**Goal:** Move FASE 2 from `Partial` to `Closed in runtime` in `docs/context/project.context.core.md` by exercising the full earnings flow against the real linked Supabase project (`pdotsdahsrnnsoroxbfe`) in Development scope.

## What's being validated

| Surface | Contract |
|---|---|
| `GET /api/earnings` | Returns 4-bucket summary from `wallet_accounts` + history filtered to `earnings_distribution` ledger entries |
| `POST /api/admin/earnings/credit` | Admin/PM credits manual earnings to recipient's `pending` bucket via service-role bypass of RLS |
| `POST /api/admin/earnings/consolidate` | Admin/PM moves recipient's balance from `pending` → `available_to_withdraw` |
| `/dashboard/settings` tab `Ganancias` | Admin-only form in `supabase` mode; calls credit + consolidate endpoints |
| `/dashboard/earnings` | Recipient sees real summary + ledger + withdrawal_requests |

## Prerequisites

- [x] `.env.local` populated via `vercel env pull --environment=development` (11 keys including Supabase URL/anon/service-role)
- [x] `NOON_ENABLE_SUPABASE_AUTH="true"` in `.env.local` (verified)
- [x] Branch `feature/fase-2-earnings-browser-validation` created from develop
- [x] No code changes pending (only `.gitignore` from Vercel link + this runbook)
- [x] `corepack pnpm@9 install --frozen-lockfile` clean
- [x] Dev server `corepack pnpm@9 run dev` running on `http://localhost:3000` (Next 16.2.3 + Turbopack, ready)

## Test scenario

Admin (`admin@noon.app`) credits **$5.00 USD** to `juan@noon.app`'s pending bucket with note `validation test 2026-05-10 fase-2`, then consolidates it. Validate UI and DB both reflect every step honestly.

## Pre-flight baseline (Step 0 — visual, you do)

Internal API routes require a session cookie, so curl-from-Claude doesn't work cleanly. Capture the baseline **visually** before the admin flow starts.

- **You do:** Open `http://localhost:3000/`. Login as `juan@noon.app`. Sidebar → `Ganancias`. Note these numbers + the date of the most recent history entry.

```text
juan@noon.app baseline:
  Pendiente:                $___
  Disponible para retiro:   $___
  Total ganado (or label):  $___
  Última entrada history:   ___ (date / note)
```

- **Then:** Logout juan. Continue to Step 1 below.

> Comparing the same UI surface before and after makes deltas in Steps 5 and 8 unambiguous.

## Steps

### Step 1 — Login as admin

- **You do:** Login as `admin@noon.app`.
- **Verify:** Lands on `/dashboard` without redirect loop. Header user dropdown shows admin name.

### Step 2 — Navigate to Settings → Ganancias

- **You do:** Sidebar → `Configuración` → tab `Ganancias` (only visible in supabase mode for admin role).
- **Verify:** Tab appears. Form has: user dropdown, monto input, nota input, Acreditar button.

### Step 3 — Credit $5.00 to juan@noon.app

- **You do:**
  - User dropdown: select `juan@noon.app` (or whatever label the form shows for that account)
  - Monto: `5.00`
  - Nota: `validation test 2026-05-10 fase-2`
  - Click `Acreditar`
- **Verify:**
  - Toast or inline confirmation appears (no error)
  - Form clears or shows the new entry
- **Claude monitors:** server log shows `POST /api/admin/earnings/credit 200`. No 500/403/RLS errors.

### Step 4 — Logout admin, login as juan

- **You do:** User menu → Logout. Re-login as `juan@noon.app`.
- **Verify:** Lands on `/dashboard`. No errors.

### Step 5 — Verify pending in /dashboard/earnings

- **You do:** Sidebar → `Ganancias`. Look at the summary cards.
- **Verify:**
  - `Pendiente` shows `+$5.00` over the Step 0 baseline
  - History/ledger has new row with note `validation test 2026-05-10 fase-2`, type `Distribución` (or similar — exact label per UI), date today
  - `Disponible para retiro` is unchanged from baseline (consolidation hasn't happened yet)

### Step 6 — Logout juan, login admin

- **You do:** User menu → Logout. Re-login as `admin@noon.app`.

### Step 7 — Consolidate juan's pending balance

- **You do:** Settings → Ganancias → consolidate action for `juan@noon.app` (button or per-user UI — exact placement to be confirmed when you see it).
- **Verify:** Confirmation appears. No error.
- **Claude monitors:** `POST /api/admin/earnings/consolidate 200`.

### Step 8 — Verify consolidated state as juan

- **You do:** Logout admin. Login `juan@noon.app`. Sidebar → `Ganancias`.
- **Verify:**
  - `Pendiente` returns to its Step 0 baseline value (the $5.00 moved out)
  - `Disponible para retiro` shows `+$5.00` over Step 0 baseline
  - History has a new row for the consolidate event (or original credit row updated state — depends on backend impl)

## Restore

After validation passes (or fails), Claude will:
- Read post-validation state from the runbook's logged numbers
- Document `wallet_ledger_entries` rows added, with their note `validation test 2026-05-10 fase-2`

**Two restore options:**

**Option A** — If a reverse credit endpoint exists, debit $5.00 back from juan's `available_to_withdraw` to bring net delta to $0. Document both entries.

**Option B** — Accept the $5.00 ledger entries as durable validation evidence with a clear note. Document them in this file and in the runtime evidence line added to `project.context.core.md`. Cost: $5.00 of fictional earned wallet sitting in juan's account in dev. Acceptable.

We'll pick A or B based on what the API surface allows. Default = B if A doesn't exist (safer than authoring a workaround endpoint just for restore).

## Closure criteria

FASE 2 moves to `Closed in runtime` only if **all** the following are true:

- [ ] Step 3 returned 200 and created a `wallet_ledger_entries` row for juan with type `earnings_distribution` (or repo's equivalent) and the validation note
- [ ] Step 5 UI showed the credited amount under `Pendiente` and the row in history
- [ ] Step 7 returned 200 and shifted juan's wallet balance from `pending` to `available_to_withdraw`
- [ ] Step 8 UI showed the consolidated state honestly
- [ ] Restore (A or B) executed and documented
- [ ] No 500/403/RLS errors in dev server log during the validation window
- [ ] No collateral damage to other users (no accidental credits to admin or other accounts)

## Failure modes to watch

| Symptom | Likely cause | Action |
|---|---|---|
| Login redirect loop | Supabase env not loaded or `NOON_ENABLE_SUPABASE_AUTH` not `true` | Restart dev server after fixing `.env.local`; verify auth flag |
| `Ganancias` tab missing | Not in supabase mode, or admin role not detected | Verify `user_profiles.role = 'admin'` for the logged-in user |
| `POST /api/admin/earnings/credit` returns 403 | RLS policy issue on `wallet_accounts` or `wallet_ledger_entries`; service-role client misconfigured | Check `lib/server/earnings/admin.ts` is using `createSupabaseAdminClient()` not regular client |
| `POST /api/admin/earnings/credit` returns 500 | DB error (FK violation, NULL constraint, enum mismatch) | Read server log; check migration 0026 + ensure recipient has `wallet_accounts` row (might need `ensure_monetary_wallet` first) |
| Pending shows $0.00 in Step 5 | Wrong recipient selected, or summary not refreshing | Hard reload page; re-verify recipient ID |
| Consolidate doesn't move balance | Consolidate endpoint may require specific bucket logic | Check server log + API response body |
| Stripe-related errors | Stripe live keys mismatch (Vercel pulled test keys, repo expects different format) | Should not happen for FASE 2 (no Stripe calls); flag if it does |

## After validation

If all green:
1. Claude appends a runtime evidence line to `docs/context/project.context.core.md` matching existing format (same shape as the FASE 1 / FASE 2 entries already in lines 292–293), referencing this validation date and the actors used.
2. Claude flips the `Partial: FASE 2` line in the same file to `Closed in runtime: FASE 2 — ...`.
3. Commit + push + PR for: this runbook + `.gitignore` Vercel addition + context.core.md updates.
4. Wait for user merge authorization (no auto-merge rule).

If something fails:
1. Document the failure inline in this file under a new "Findings" section.
2. Decide: small bug (fix in same branch?) or escalation (separate branch / new iteration)?
3. FASE 2 stays `Partial` until the underlying bug is fixed.

## Findings (filled in as the validation proceeds)

### F-V01 — Radix Select empty value blocks admin Ganancias form (fixed in branch)

- **Detected:** Step 2 (loading admin Settings → Ganancias).
- **Symptom:** Browser threw `Uncaught Error: A <Select.Item /> must have a value prop that is not an empty string`.
- **Root cause:** `app/dashboard/settings/page.tsx:804` had `<SelectItem value="">Sin canal</SelectItem>` for the Canal dropdown placeholder option. Radix UI prohibits empty-string values because the empty string is reserved to represent "no selection" / placeholder state.
- **Fix:** Introduced sentinel `'none'` to represent the no-channel choice:
  - Line 76: `useState` typed `'inbound' | 'outbound' | 'none'` initial `'none'` (was `''`)
  - Line 142: submit translates `creditChannel === 'none' ? null : creditChannel` (was `creditChannel || null`)
  - Line 804: `<SelectItem value="none">Sin canal</SelectItem>` (was `value=""`)
- **Behavior preserved:** API still receives `null` when no channel is selected; semantics unchanged.
- **Defensive scan:** grep across repo for `SelectItem value="..."` with empty value → no other matches. This was the only instance.
- **Validation impact:** Unblocks Step 3. Re-render the page in the browser to pick up the HMR.

## Notes

- All work runs against the **real linked Supabase project** in **Development** scope. There is no isolated test database. Be careful with the recipient identity — `juan@noon.app` is a real seeded user; validation noise will persist in the real DB.
- The dev server log (Claude's window) is authoritative for what the backend actually did. The browser UI is authoritative for what the recipient/admin user actually sees.
- If anything looks wrong before clicking, stop and ask. We can pause at any step.
- Login password for both users is in `.env.local` under `NOON_SEED_DEFAULT_PASSWORD`. Open the file or ask Claude to read it for you.
