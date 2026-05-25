# ADR-022: Stripe Connect dormant during pilot — payouts operate manually until reactivation trigger fires

**Status:** Accepted
**Date:** 2026-05-23
**Deciders:** Pedro (Engineering owner)
**Supersedes:** None
**Related:** ADR-008 (commercial scope: internal pilot), ADR-009 (bridge wallet freeze), PR #103 (Stripe Connect error surfacing — diagnostic improvement that revealed root cause)

---

## Context

The repository contains a complete Stripe Connect Express implementation for paying collaborators (sellers + admin) their accrued earnings:

- `lib/server/stripe/connect.ts` — account create, onboarding link, account details, transfer
- `app/api/connect/{onboard,status}/route.ts` — onboarding initiation and status read
- `app/api/payouts/initiate/route.ts` — admin-driven payout that reserves wallet balance and calls `stripe.transfers.create` to move money from platform balance to the connected account
- `app/api/webhooks/stripe/route.ts` — already subscribed to Connect lifecycle events: `account.updated`, `transfer.paid`, `transfer.reversed`
- `user_profiles.stripe_connect_account_id` + `stripe_connect_status` columns
- UI in `/dashboard/earnings` with the "Configurar cuenta" card

PR #103 (2026-05-23) added explicit Stripe error surfacing on `/api/connect/onboard`, which revealed the actual failure when a seller clicked "Configurar cuenta" in production:

> Stripe: You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.

This is not a code defect. The Stripe platform account has never been enrolled for Connect. Enrollment is a one-time Stripe Dashboard action that obligates the platform to ongoing Connect compliance: dispute response on connected accounts, AML/KYC oversight, support to connected account holders, Connect Services Agreement acceptance.

The pilot operates with 4 internal collaborators per ADR-008. Manual external payouts (admin sends money via bank transfer / Wise / PayPal / other rail and records the reference in `payouts.external_reference`) are operationally tractable at this scale (~1 payout/seller/month). The compliance and operational overhead of being a Stripe Connect platform is disproportionate to the value at current volume.

The seller-side withdrawal request flow (`POST /api/earnings/withdraw`) already creates a `withdrawal_request` row without involving Stripe, so the seller UX does not require Connect to function. The admin-side processing (`POST /api/payouts/initiate`) is the only step that today demands Connect be active (gate at line 37-42: rejects with HTTP 422 if `stripe_connect_status !== 'active'`).

---

## Decision

**Stripe Connect remains implemented in code but dormant in product. Payouts to collaborators operate manually until a documented reactivation trigger fires.**

Concretely:

1. **The "Configurar cuenta" card in `/dashboard/earnings` is hidden.** Collaborators do not see a button that would surface the platform-enrollment error. The UI is gated behind a single `STRIPE_CONNECT_ENABLED` constant in the earnings page (set to `false`). The `loadConnectStatus()` call is also gated so the dormant `/api/connect/status` endpoint is not pinged on page mount.

2. **The backend code stays intact** (`lib/server/stripe/connect.ts`, `app/api/connect/*`, `app/api/payouts/initiate`). It is dormant, not deleted. Reactivation is a constant flip plus the Stripe Dashboard enrollment described below — not a re-implementation.

3. **Admin processes payouts manually until reactivation.** When a seller files a `withdrawal_request`, the admin reviews the balance, sends money externally (bank transfer / Wise / PayPal / crypto / other), and reconciles in the internal ledger. The mechanics of the reconciliation step are deferred — this ADR does not prescribe a UI for manual reconciliation. When the admin needs to process a payout, options are (in increasing order of operational maturity):
   - Direct SQL update of `payouts` row with `external_reference` and timestamps (acceptable for pilot volume)
   - Future iteration adds a `method: 'manual'` branch to `/api/payouts/initiate` + admin form (scoped if/when needed; not blocking today)

4. **The two Stripe Connect columns (`user_profiles.stripe_connect_account_id`, `stripe_connect_status`) stay in the DB schema.** They are unused while Connect is dormant. They are not removed because (a) the columns are nullable / default `'none'`, so they cost nothing; (b) removing and re-adding them later would create unnecessary migration churn; (c) preserving them preserves the option to reactivate without schema work.

5. **Outstanding schema-drift gap acknowledged:** the two columns exist in the remote DB (verified 2026-05-23 via Supabase MCP) but **no migration file** in `supabase/migrations/` adds them. This violates ADR-014 ledger discipline. It is recorded here as known drift, not fixed in this iteration — the cleanest fix is an idempotent backfill migration (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`) that gets bundled with the reactivation iteration when Connect is turned on.

---

## Rationale

### Why dormant, not deleted

- **Reversibility cost is asymmetric.** Activating dormant code is a constant flip plus Stripe Dashboard enrollment (~1 day total work). Re-implementing from scratch is several days plus the risk of regressing payout-side bugs already solved (idempotency on transfers, reservation/release on failure, webhook lifecycle, status sync).
- **The decision is operational, not architectural.** Connect being right or wrong for this product is a function of seller volume and geography, both of which will become evident over the pilot. Deleting the code commits to "Connect is wrong for us" — a stronger claim than the evidence supports today.

### Why manual is acceptable at pilot scale

- 4 collaborators × ~1 payout/month = ~4 manual operations/month. Each takes 5-15 minutes of admin time including reconciliation. Total: under 1 hour/month.
- Manual rails (bank transfer, Wise, PayPal, crypto) cover any geography without Connect Express limitations.
- No platform-compliance burden: the platform is not on the hook for AML on the seller side, dispute handling on connected accounts, KYC document review, or Connect Services Agreement obligations.

### Why not gate via env var

`STRIPE_CONNECT_ENABLED` could be an env var rather than a hardcoded constant. The constant was chosen because (a) the dormant state is intentional and lasting, not configurable per environment; (b) a hardcoded `false` with a clear ADR reference is more self-documenting than an env var with the same default; (c) an env var introduces drift risk (someone flips it in one environment without doing the Stripe Dashboard work). When reactivation happens, the constant is flipped in one PR alongside the migration backfill and any other reactivation work — atomic intent.

---

## Reactivation triggers

This ADR must be revisited and Connect reactivated when **any** of the following becomes true:

1. **Seller count crosses ~10 active collaborators** processing monthly payouts. At that volume, manual payout admin work crosses ~3 hours/month and the operational savings of automation start to exceed the compliance overhead.
2. **External clients become visible to the payouts flow.** ADR-008 internal-only scope is the anchor for "manual is fine". If the product surfaces payout status to external clients (e.g., invoices, statement downloads), automation becomes a UX gate.
3. **A specific collaborator geography is being entered that requires Connect-grade compliance** (e.g., US sellers triggering 1099 reporting; EU sellers triggering specific data-handling rules).
4. **The roadmap explicitly schedules Connect activation** as part of a payout-system overhaul. Today the roadmap (`D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md`) does not block on this.

When any trigger fires, the reactivation iteration scope is:

1. Sign up the platform in Stripe Dashboard for Connect (live mode + optionally test mode); accept Connect Services Agreement; complete platform profile (statement descriptor, branding, support contact).
2. Backfill migration `00XX_phase_YYz_user_profiles_stripe_connect.sql` adding the two columns idempotently (ADR-014 ledger reconciliation).
3. Flip `STRIPE_CONNECT_ENABLED` to `true` in `app/dashboard/earnings/page.tsx`.
4. Add `stripe.accounts.createLoginLink` endpoint + UI button so collaborators can access their Express Dashboard.
5. Test e2e in Stripe test mode: create test seller, complete test onboarding, fire test transfer, verify webhook lifecycle.
6. Surface ToS extension to collaborators incorporating Stripe Connected Account Agreement (legal copy).

Estimated reactivation work: ~1 day of code + Dashboard configuration + variable compliance copy review.

---

## Consequences

### What this enables

- The pilot can operate cleanly without confusing collaborators with a broken "Configurar cuenta" button.
- The Connect code path is preserved as a deliberate option for the future, with its preconditions documented in one place.
- Schema drift on the two Connect columns is acknowledged and bounded — fixed at reactivation time, not by piecemeal patches.

### What this forbids

- **No new feature work lands on the Connect code path while it is dormant.** The dormant code is frozen. Bug fixes only if a security issue surfaces. New work on payouts during the dormant window should be on manual reconciliation paths, not Connect.
- **No silent re-enablement.** Flipping `STRIPE_CONNECT_ENABLED` requires doing the full reactivation iteration (Stripe Dashboard enrollment + backfill migration + Express login link + e2e test + ToS extension). A code-only flip without the Stripe Dashboard work would re-introduce the same production error PR #103 surfaced.

### Active risks created or updated

- **Active risk:** until reactivation, admin must process every collaborator payout manually. Admin time burden grows linearly with seller count and payout frequency. Mitigation: monitor at each pilot review whether the manual time is becoming friction.
- **Active risk:** schema drift on `user_profiles.{stripe_connect_account_id, stripe_connect_status}` (no migration file). Mitigation: documented here; backfill scheduled with reactivation iteration.
- **Closed:** confusion from the broken "Configurar cuenta" button (closed by hiding the UI).

---

## Lifecycle

- **Author:** Pedro (operator), drafted by system-docs
- **Supersedes:** nothing
- **Superseded by:** nothing
- **Amendments:** none
