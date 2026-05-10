# Browser validation — 2026-05-10 (FASE 2 earnings)

**Branch:** `feature/fase-2-earnings-browser-validation`
**Validator:** Pedro (browser) + Claude (server log + script)
**Goal:** Move FASE 2 from `Partial` to `Closed in runtime` in `docs/context/project.context.core.md`.
**Linked runbook:** `docs/validations/fase-2-earnings-browser-validation.md`

## Setup performed today

| Item | Detail |
|---|---|
| Vercel CLI | Installed globally (`npm i -g vercel`); browser OAuth completed for `nooncode-tech` org |
| Vercel link | Project linked: `noons-projects-749dcf47/nooncode-app` (`prj_pcymuQmGPfOewVwQwKeGJM2rVX5u`) |
| `.env.local` | Pulled from Development scope (11 keys: Supabase URL/anon/service-role, Stripe test, OpenAI, V0, Maxwell auth flag, seed password, Stripe publishable + webhook secret + secret) |
| `.gitignore` | Vercel CLI added `.env*.local` (redundant with existing `.env*` line, harmless) |
| Dev server | Next 16.2.3 + Turbopack on `localhost:3000`, `.env.local` loaded |

## Validation chronology

### Step 0 — Baseline (visual, juan@noon.app)

Captured by Pedro in browser. Numbers not transcribed — used as visual reference for delta comparison in subsequent steps.

### Step 1–3 — Admin credit ($5.00 to juan)

Pedro logged out juan, logged in admin, navigated Settings → Ganancias.

**Blocker hit at Step 2 (page render):** `Uncaught Error: A <Select.Item /> must have a value prop that is not an empty string`. See F-V01 below.

After F-V01 fix applied + page reload: form submitted successfully.

**Server evidence:**

```text
POST /api/admin/earnings/credit 201 in 4.7s (next.js: 2.0s, application-code: 2.6s)
```

### Step 4–5 — Juan verifies credited pending (UI)

Logout admin → login juan → `/dashboard/earnings`. Pedro confirmed `Pendiente` showed `+$5.00` over baseline; new history entry visible with note `validation test 2026-05-10 fase-2`.

### Step 6 — Re-login admin

Done. Confirmed via dev log (`/api/users/admin 200`, `/api/projects 200`, `/api/tasks 200` — all role-honest reads succeeded).

### Step 7 — Consolidate (BLOCKER → workaround applied)

Pedro could not find a consolidate UI in Settings → Ganancias. Confirmed by code search: see F-V02 below.

**Workaround:** option B from the in-session decision matrix. One-shot tsx script imports `consolidateEarnings()` from `lib/server/earnings/admin.ts` (the same function the API route calls) and runs it against the linked Supabase project using the service-role client. This validates the **business logic + DB writes** end-to-end. The HTTP layer (zod schema + `requireRole(['admin'])`) is **not exercised** by the script; both are shared infrastructure already validated by other routes in production traffic.

**Script:** `scripts/consolidate-earnings-validation.ts`

**Script execution result (2026-05-10):**

```text
target: juan@noon.app  (ff0ecbc0-7baa-4650-b93e-0bb952ee00e2)
actor:  admin@noon.app (dae88316-6eea-4997-bc50-a71cbec25c3d)
before: pending=$5.00  available_to_withdraw=$0.00
after:  pending=$0.00  available_to_withdraw=$5.00
delta:  pending=-5.00  available_to_withdraw=+5.00
✓ consolidated $5 pending → available_to_withdraw for juan@noon.app
```

DB writes confirmed by the round-trip read of `wallet_accounts` immediately after `consolidateEarnings()` returned. The function also inserted a new `wallet_ledger_entries` row (`entry_type=earnings_distribution`, `balance_bucket=available_to_withdraw`, `reference_type=consolidation`, `metadata.consolidatedFrom=pending`).

### Step 8 — Juan verifies consolidated state (UI ✅)

Pedro logged in as juan, opened `/dashboard/earnings`, confirmed in browser: `Pendiente` returned to baseline ($0.00), `Disponible para retiro` shows `+$5.00` over baseline, history reflects the consolidation row. Pedro's confirmation: "Sí, cambió todo".

Server log evidence during this step: `GET /dashboard/earnings 200`, `GET /api/earnings 200`, `GET /api/earnings/withdraw 200`, `GET /api/connect/status 200`. The 403s on `/api/projects` and `/api/tasks` during juan's `/dashboard` load are expected role-honest behavior for sales role and are documented as normal in `project.context.core.md` operating rules.

## Findings

### F-V01 — Radix Select empty value blocks admin Ganancias form (FIXED in branch)

- **Detected:** Step 2 (page render of admin Settings → Ganancias).
- **Symptom:** Browser threw `Uncaught Error: A <Select.Item /> must have a value prop that is not an empty string`.
- **Root cause:** `app/dashboard/settings/page.tsx:804` had `<SelectItem value="">Sin canal</SelectItem>`. Radix UI prohibits empty-string values because `""` is reserved to represent "no selection".
- **Fix (3 lines):**
  - L76: `useState<'inbound' | 'outbound' | 'none'>('none')` (was `<'inbound' | 'outbound' | ''>('')`)
  - L142: `channel: creditChannel === 'none' ? null : creditChannel` (was `creditChannel || null`)
  - L804: `<SelectItem value="none">Sin canal</SelectItem>` (was `value=""`)
- **Behavior preserved:** API still receives `null` when no channel is selected.
- **Defensive scan:** repo-wide grep for `SelectItem value=""` → no other instances.

### F-V02 — Consolidate UI missing in /dashboard/settings (DOCUMENTED, not fixed in this branch)

- **Detected:** Step 7. Pedro could not find a button to move pending → available_to_withdraw.
- **Root cause:** `app/api/admin/earnings/consolidate/route.ts` exists and is correctly wired (zod schema + `requireRole(['admin'])` + calls `consolidateEarnings()`), but **no UI surface in the repo calls it**. Verified by grep across `app/` and `components/` — only the route file mentions consolidation. The Settings → Ganancias form is credit-only.
- **Impact:** FASE 2 cannot be fully validated through the UI today. The endpoint is real and functional (proven by today's script workaround), but the admin has no way to trigger it without manual API access.
- **Severity:** High for FASE 2 closure; Medium overall (workaround exists; functional gap, not a security/data risk).
- **Action:** **deferred until v3 reshape**. `docs/product/master-spec-v3.md` sec. 24.4 introduces a new earnings bucket state machine (`Potential / Confirmed / Pending payout / Paid out / Cancelled`) that does not map onto the current `pending → available_to_withdraw` semantics. Pending FASE 3 (in roadmap) further automates credit from proposal `paid/won`, so the manual admin credit + consolidate flow becomes a fallback rather than the primary path. Building UI on the current model would be replaced twice within the v3 reshape — premature investment. Hold the gap open in Active risks; reabordar como parte del rediseño v3 cuando los nuevos estados estén definidos.
- **Workaround for now:** `scripts/consolidate-earnings-validation.ts` (or any direct service-role call to `consolidateEarnings()`).

## Files changed in this branch

| File | Change |
|---|---|
| `.gitignore` | Vercel CLI added `.env*.local` |
| `app/dashboard/settings/page.tsx` | F-V01 fix (3 lines) |
| `docs/validations/fase-2-earnings-browser-validation.md` | New — runbook (procedure) |
| `docs/validations/Browser validation 10-05-2026.md` | New — this session record |
| `scripts/consolidate-earnings-validation.ts` | New — one-shot script for Step 7 workaround |
| `docs/context/project.context.core.md` | Will be updated after Step 8 verifies — flip `Partial: FASE 2` to `Closed in runtime: FASE 2` and add F-V02 to Active risks |

## Closure decision

FASE 2 will be marked `Closed in runtime` if:

- [x] Step 3 returned 201 and persisted the credit (verified in dev log)
- [x] Step 5 UI showed `+$5.00` Pendiente as juan (verified in browser by Pedro)
- [x] Script in Step 7 returned success and DB shows pending → available_to_withdraw movement (juan: pending $5 → $0, available_to_withdraw $0 → $5)
- [x] Step 8 UI as juan showed the consolidated state honestly (Pedro confirmed in browser)

**FASE 2 closes** — all four checks passed. F-V02 (missing consolidate UI) goes to Active risks in `project.context.core.md` as a known gap with a clear fix path. The runbook + script + this session record stay in `docs/validations/` as reusable artifacts for future similar validations.

## Restore decision

Per runbook section "Restore" — going with **Option B** (accept the validation noise). Net effect on juan's wallet after the full validation: `+$5.00` in `available_to_withdraw`, two ledger entries with notes pointing to today's date and "validation test 2026-05-10 fase-2" / "consolidatedFrom: pending". Cost: $5 of fictional earned wallet sitting in juan's dev account. Acceptable.
