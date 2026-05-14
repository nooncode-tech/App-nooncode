# F-V03 — Dashboard wallet real reads (browser validation)

**Date:** 2026-05-13 (Scenario 1 blocked) → 2026-05-14 (unblocked + all scenarios PASS)
**Branch validated:** `develop` post PRs #38 (spec) + #39 (implementation), plus an out-of-band Supabase migration applied via MCP on 2026-05-14 to land the previously-unregistered `0042_phase_17b_wallet_maxwell_rpc_hardening.sql` (see "Validation prerequisite resolved out-of-band" below).
**Validator:** Pedro (browser) + Claude (file edit / orchestration)
**Goal:** Confirm in the local dev runtime that the dashboard header balance chip + sidebar user-dropdown balance now derive from a real `/api/wallet` read in `supabase` mode, replacing the previous fake "Balance: no disponible" copy that contradicted the real wallet at `/dashboard/earnings` and `/dashboard/credits`. Verify the four state transitions (mock / loaded / loading / error) and confirm rewards/points stay honest unavailable as designed.

## What's being validated

| Surface | Contract |
|---|---|
| `lib/wallet/context.tsx` `WalletProvider` | Mounted in `app/dashboard/layout.tsx`. Fetches `/api/wallet?limit=5` once on supabase + user mount. Shares the snapshot across dashboard subtree via React Context. |
| `lib/dashboard-selectors.ts` `selectPersonalStatsAvailability` | Accepts `WalletContextValue` as optional 3rd arg. Renders `Cargando…`, real `$<n>`, or `No se pudo cargar` per state. Mock branch unchanged. |
| `app/dashboard/page.tsx` header chip | Renders the selector's `balanceValueLabel` + `balanceDescription` in supabase. |
| `components/app-sidebar.tsx` user-menu dropdown | Renders `sidebarBalanceLabel`. Both surfaces consume the same context (no double fetch). |
| Rewards / points labels in supabase | Stay as honest unavailable across all wallet states. Per `project.context.core.md` line ~384 operating rule. |

## Out of scope for this validation

- Pixel-perfect snapshots / visual regression tooling.
- Rewards/points wiring — explicitly deferred to F-V03b when rewards is productized.
- Production `/api/wallet` behavior under load (covered by B14's separate prod verification once Upstash is provisioned).
- Multi-user simultaneous testing.
- Mobile viewport rendering (covered by general FASE 3 a11y / mobile pass per roadmap §7).

## Validation prerequisite resolved out-of-band (2026-05-14)

First attempt at Scenario 1 on 2026-05-13 failed with a 500 from `/api/wallet`. Root-cause investigation via Supabase MCP confirmed two RPCs the admin client path depends on were missing from `pdotsdahsrnnsoroxbfe`:

- `public.ensure_user_wallet_for_profile(p_profile_id uuid)`
- `public.ensure_monetary_wallet_for_profile(p_profile_id uuid)`

Both are defined in the local file `supabase/migrations/0042_phase_17b_wallet_maxwell_rpc_hardening.sql` but the migration was never registered in `supabase_migrations.schema_migrations` on the remote project — one of the 15 unregistered local migrations that constitute risk **G7** (schema↔ledger desync). The remote project only had the no-arg sibling RPCs `ensure_current_user_wallet()` and `ensure_monetary_wallet()`, which derive the profile from `auth.uid()` and therefore cannot serve the admin (`service_role`) client path used by `getVisibleWallet`.

**Action taken on 2026-05-14:** Migration `0042_phase_17b_wallet_maxwell_rpc_hardening.sql` was applied verbatim to `pdotsdahsrnnsoroxbfe` via `mcp__plugin_supabase_supabase__apply_migration` with name `phase_17b_wallet_maxwell_rpc_hardening`. The migration is fully idempotent (`create or replace function`), creates the two missing RPCs, hardens grants on three sibling RPCs that already existed, and changes no table state. Verification query confirmed both new RPCs now return the expected `user_wallets` / `wallet_accounts` row types from `service_role`. After this apply, Scenario 1 passed on first hard reload.

This is documented as the materialization of risk G7 against F-V03 and bumps the priority of the dedicated reconciliation iteration `fase-0-b4b-ledger-reconciliation` from "no fixed date" to "scheduled before next code-level migration push to remote".

## Prerequisites

- [x] `.env.local` configured with `NOON_ENABLE_SUPABASE_AUTH="true"` + Supabase URL/anon/service-role keys for `pdotsdahsrnnsoroxbfe`
- [x] `develop` synced post PR #39 (`git pull --ff-only origin develop`) → HEAD `6de3c3c`
- [x] Dev server running: `npm run dev` on `http://localhost:3000` (Next.js 16.2.6 + Turbopack)
- [x] At least one seeded supabase user available with non-zero wallet balance — used `juan@noon.app` (profile_id `ff0ecbc0-7baa-4650-b93e-0bb952ee00e2`, `available_to_spend=0.00 + available_to_withdraw=5.00 = $5`)
- [x] Migration `0042` confirmed live on `pdotsdahsrnnsoroxbfe` (see "Validation prerequisite resolved out-of-band")

## Test scenarios

Five scenarios, one per success-criterion item in `specs/fase-1-f-v03-dashboard-wallet-real-reads.md` §Success Criterion #9, plus the optional rewards/points regression Scenario 6.

---

### Scenario 1 — Supabase user sees real `Balance: $<n>` in header + sidebar

- **What to do:**
  1. Log in as a supabase user with known wallet balance (`juan@noon.app`).
  2. Land on `/dashboard`.
  3. Inspect:
     - The "Balance" tile in the dashboard header / earnings KPI card.
     - The user dropdown in the sidebar.
- **Expected:**
  - Both surfaces show the same `$<n>` USD value.
  - The number equals `availableToSpend + availableToWithdraw` from `/api/wallet`.
- **Evidence:**
  - User logged in: `juan@noon.app` (profile_id `ff0ecbc0-7baa-4650-b93e-0bb952ee00e2`)
  - Wallet snapshot via MCP `execute_sql` against `wallet_accounts`: `available_to_spend=0.00`, `available_to_withdraw=5.00`, `pending=0.00`, `locked=0.00`, `currency=USD` → expected display: `$5`
  - Dashboard header chip observed: real `$5` value (not "No se pudo cargar", not "no disponible")
  - Sidebar dropdown observed: `Balance: $5`
  - Match between the two: yes
  - Screenshot reference: operator-confirmed visually; no screenshot stored
- **Result:** **PASS**

---

### Scenario 2 — Shared context: navigating between dashboard routes does not re-fetch

- **What to do:**
  1. Logged in as `juan@noon.app`.
  2. Open Network tab in DevTools, filter by `wallet`.
  3. Land on `/dashboard`. Exactly ONE request to `/api/wallet?limit=5` expected.
  4. Navigate to `/dashboard/leads`, `/dashboard/projects`, `/dashboard/reports`.
  5. Verify NO additional `/api/wallet?limit=5` requests fire.
  6. Verify the sidebar balance stays consistent.
- **Evidence:**
  - Number of `/api/wallet?limit=5` requests during the navigation: 1
  - Sidebar label across the 4 routes: consistent (stayed at `Balance: $5`, no flash)
  - Screenshot of Network tab filtered: operator-confirmed visually; no screenshot stored
- **Result:** **PASS**

---

### Scenario 3 — Forced fetch error (DevTools network blocking) → "No se pudo cargar"

- **What to do:**
  1. Logged in as `juan@noon.app`.
  2. DevTools → Network → block URL pattern `*/api/wallet*`.
  3. Hard reload `/dashboard`.
  4. Observe header chip + sidebar dropdown.
- **Evidence:**
  - URL pattern blocked: `*/api/wallet*`
  - Dashboard chip observed: `No se pudo cargar` (description copy reflects the new HTTP-status-aware error message landed in the closure fold of `lib/wallet/context.tsx`)
  - Sidebar dropdown observed: `Balance: no se pudo cargar`
  - Earnings action label observed: `Reintentar`
  - Console errors captured: fetch rejection visible (expected)
  - Unblock confirmed afterward: yes
  - Screenshot reference: operator-confirmed visually; no screenshot stored
- **Result:** **PASS**

---

### Scenario 4 — Brief loading state ("Cargando…") visible during fetch

- **What to do:**
  1. Logged in as `juan@noon.app`.
  2. DevTools → Network → throttle to "Slow 3G".
  3. Hard reload `/dashboard`.
  4. Observe header chip + sidebar dropdown DURING the slow fetch.
  5. Restore throttling afterward.
- **Evidence:**
  - Throttling setting used: Slow 3G
  - Loading state captured to naked eye: yes — chip rendered `Cargando…` and sidebar `Balance: cargando…` before transitioning to `$5`
  - React DevTools confirmation needed: no (visible by eye)
  - Throttling restored: yes
  - Screenshot reference: operator-confirmed visually; no screenshot stored
- **Result:** **PASS**

---

### Scenario 5 — Mock mode dashboard still works (no regression)

- **What to do:** (skipped — see note)
- **Evidence:**
  - Mode switch used: SKIPPED
- **Result:** **SKIPPED**

> Skipped because `tests/lib/dashboard-selectors.test.ts` already covers the mock-mode regression net (test name: `mock mode: balance + points come from user.balance / user.points (regression net)`). That test would fail if the mock branch broke. Running a second dev server with `NOON_ENABLE_SUPABASE_AUTH=false` for visual confirmation was judged not worth the time for a regression already covered by a deterministic unit test.

---

### Scenario 6 (bonus) — Rewards / points stay honest unavailable

- **What to do:**
  1. Logged in as `juan@noon.app` with wallet loaded.
  2. Inspect the rewards/points section in the dashboard header AND the sidebar dropdown.
- **Evidence:**
  - Dashboard points chip observed: matches expected `Sin programa real` / `Puntos y recompensas todavía no están conectados al runtime real.`
  - Sidebar points label observed: matches expected `Puntos: sin fuente real`
  - Rewards title observed (on `/dashboard/rewards` or rewards card): matches expected `Rewards no conectadas` / `Canje no disponible`
- **Result:** **PASS**

---

## Summary

| Scenario | Result |
|---|---|
| 1 — real `$<n>` in header + sidebar | PASS |
| 2 — shared context, no double-fetch | PASS |
| 3 — forced error → "no se pudo cargar" | PASS |
| 4 — loading state visible | PASS |
| 5 — mock mode regression | SKIPPED (unit test covers it) |
| 6 — rewards/points honest unavailable | PASS |

**Final verdict:** **COMPLETE**

## Observations and notes

- **Bug discovered and resolved during validation.** First attempt at Scenario 1 on 2026-05-13 hit a 500 from `/api/wallet`. F-V03 frontend behaved exactly as designed (rendered `Balance: No se pudo cargar` instead of silently lying with `no disponible`), surfacing a real database-layer defect that had been hidden behind the previous fake copy. The defect was the missing migration `0042` on the remote, materialized risk G7. Applied via MCP `apply_migration` on 2026-05-14, validation re-ran cleanly. This is operator-in-the-loop working as intended — the system told us when something was broken instead of lying well.

- **Retry-on-error fix folded into closure.** During investigation a transient bug in `lib/wallet/context.tsx` was found: after a fetch failure, `lastFetchKey.current` was not cleared, so the provider locked into error state until a hard reload. Fix: clear `lastFetchKey.current = null` in the `.catch` block so the next mount can retry. Also improved the error message to include the HTTP status code (`No se pudo cargar la wallet (HTTP ${response.status}).`). Five-line change folded into this closure rather than shipped as a separate PR.

- **No regression risk introduced by the out-of-band migration apply.** Migration 0042 is purely additive (two new RPC definitions + grant hardening on existing functions that already exist and are in use). It does not touch any table, does not alter any existing function body, and does not change any RLS policy. Verification queries before/after confirm only the expected delta.

## Post-validation cleanup checklist

- [x] DevTools network blocking removed (Scenario 3)
- [x] DevTools throttling restored to "No throttling" (Scenario 4)
- [x] Mock-mode dev server stopped if used (Scenario 5) — n/a, skipped
- [x] No residual modified files in repo beyond intended closure edits
- [x] Dev server can be stopped once this document is committed.

## What lands after this document is filled

1. This validation doc + the `lib/wallet/context.tsx` retry fix + context/roadmap doc updates go in a single closure PR against `develop`.
2. After CI green, user merges manually (memory rule: no auto-merge).
3. `project.context.core.md` updated with the F-V03 Closed-in-runtime entry + a new operating rule preventing regression of the dashboard balance chip.
4. `project.context.history.md` updated with a Session note for F-V03 including the G7 materialization detail.
5. Roadmap §17 snapshot rewritten for 2026-05-14 closing.
