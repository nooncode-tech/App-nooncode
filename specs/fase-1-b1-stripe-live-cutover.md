# spec.md — fase-1-b1-stripe-live-cutover

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-15
- Session ID: fase-1-b1-stripe-live-cutover
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-infra (B1.1 live keys upload + B1.2 webhook config) → system-testing (B1.2 test event + B1.3 Día 4 smoke) → system-docs (B1.4 runbook) → system-validator (B1.5 pilot sign-off)
- Router mode: Infra-Deploy
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope B1 — Stripe live keys + production cutover — as the last path to FASE 1 close. Plan the full sequence (live keys upload, webhook config, real-money smoke, runbook, pilot sign-off), surface the dependencies between sub-iterations, and capture the pre-flight evidence that confirmed the system is ready for live cobro real. Analysis only in this session; downstream execution is operator-side ops + Claude verification touches.
- Why this work matters now: FASE 1 success criterion (roadmap §5) requires 1 pago real procesado en producción + runbook de rollback testeado + equipo piloto firma que la UX no genera confusion grave. B1 is the only critical-path work that delivers all three. After today, the operational debt outside of B1 is zero (B14 closed 2026-05-15, UX bundle + ADR-010 amendment closed 2026-05-14, F-V03 + B18 closed previously). G7 and the Tier 3 UX items are explicitly recorded as "no bloquean lanzamiento interno" in the roadmap.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: no (no contract changes, no architecture changes, no new entity persistence; cutover work)
- `project.context.history.md` reviewed: partial (session notes for B14 ops 2026-05-15, ADR-010 amendment 2026-05-14, B3 seller-fees state machine 2026-05-12 — the three most recent payment-adjacent iterations)
- Reason `full` was included if applicable: not required — this iteration verifies and operationalizes existing contracts (Stripe webhook, seller-fees state machine, wallet RPCs, payment activation) against the live Stripe environment for the first time. The contracts themselves are unchanged.
- Reason `history` was included if applicable: B3 seller-fees state machine is the most fragile dependency — the webhook reads `seller_fees` rows and throws if missing for outbound proposals. ADR-010 amendment defines which payment flows are permitted (operator-driven outbound only; inbound owned by NoonWeb). B14 ops verified the rate limiter is enforcing cluster-wide before any real Stripe traffic.

### ROUTER DECISION
- Why this mode is correct: Infra-Deploy fits because (a) the work is provisioning + configuring a live external service dependency (Stripe live mode), (b) the live keys are sensitive secrets that must be deployed only to Production scope, (c) the first real cobro is an irreversible operation that involves real money, (d) the success criterion involves runtime behavior in production with real users (pilot team).
- Why this depth is correct: Full because (a) real money moves through the system for the first time — incorrect behavior cannot be undone cleanly, (b) the cutover affects multiple downstream surfaces (project activation, earnings ledger, seller wallet, points ledger, Stripe Connect transfers, seller_fees state machine), (c) cross-repo coordination with NoonWeb is required for the inbound payment path per ADR-010, (d) the rollback playbook itself does not yet exist (B1.4 produces it).
- Why this skill is the right active skill now: nothing else can route until the affected systems inventory, the live-key blast radius decisions (Production scope only, no Preview contamination), the test-event observability plan, and the smoke success criteria are explicit. Infra cannot execute, testing cannot run, validator cannot gate without scope.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules".
- Contracts or architecture inputs available:
  - `docs/adrs/ADR-010-client-portal-lives-in-noonweb.md` (status `Accepted (amended 2026-05-14 — operator-driven outbound Checkout exception)`) — defines what payment flows are permitted in App vs NoonWeb.
  - `docs/adrs/ADR-007-seller-fee-state-machine.md` — defines the `potential → confirmed → pending_payout → paid_out` lifecycle the webhook drives via `confirmSellerFee` on `checkout.session.completed`.
  - `docs/contracts/seller-fee-state-machine.md` — the contract document the webhook handler honors when reading `seller_fees` rows.
  - `app/api/webhooks/stripe/route.ts` — the live target endpoint, handles 6 event types (`checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`, `transfer.paid`, `transfer.reversed`).
  - `docs/tdrs/TDR-002-rate-limiting-distributed.md` — the rate limiter sitting in front of the webhook (limit 600/min for `stripe-webhook` namespace).
- Relevant handoffs received: user picked B1 over (a) G7 reconciliation and (b) Tier 3 UX items on 2026-05-15 because B1 is the only path that advances toward controlled launch (FASE 1 close). Prereqs confirmed in the same session: Stripe Connect platform already onboarded; production alias `nooncode-app-pi.vercel.app` is publicly reachable without Deployment Protection; ~2-3h window available for B1.1 + B1.2; NoonWeb dev coordination still needs scheduling for B1.3.
- External dependencies or environment assumptions: Stripe live mode account is created and verified for the entity that owns the cobro. Stripe Connect is onboarded (verified by user). Live keys are accessible from Stripe Dashboard. The current Vercel project uses the production alias `nooncode-app-pi.vercel.app` (verified reachable via `curl` against `/api/webhooks/stripe` — 405 GET, 400 POST with our app's `Missing stripe-signature header` body, confirming no Deployment Protection on the alias). Vercel auto-deploys not triggering reliably (G11, registered 2026-05-15) — operator workaround validated: manual Redeploy from Deployments tab.

### RISK SNAPSHOT
- Known risks before starting:
  - **First real cobro is irreversible.** Any incorrect logic that processes the payment leaves real money in an unrecoverable state without operator intervention. Mitigation: small importe ($5-$10) for the Día 4 smoke; webhook event ledger idempotency (B14 / migration 0041) already exists so retries don't double-count; Stripe Dashboard remains the source of truth for refunds.
  - **Migration ledger desync (G7).** Verified 2026-05-15: migrations 0041 (stripe_webhook_events), 0043 (seller_fees), 0044 (seller_fees RLS) are **absent from `supabase_migrations.schema_migrations`** on the remote, even though their tables physically exist in `public` schema (verified via `information_schema.tables`). This means the webhook will function (tables are real) but a future `supabase db push` from CLI would try to re-apply them. Mitigation: documented in `core.md` Active risks; `fase-0-b4b-ledger-reconciliation` is the dedicated cleanup iteration; the convention until then is to use the Supabase Dashboard SQL Editor or `mcp__supabase__apply_migration` for any new migration. Does **not block** B1.
  - **Schema drift risk in `stripe_webhook_events` / `seller_fees`.** The tables exist but were applied OOB (not via the standard migration runner). If their column shape differs from what the local migration files describe, the webhook code may fail at runtime. Mitigation: B1.2 test event is the cheapest possible verification — Stripe sends a `payment_intent.succeeded` or `account.updated` from the Dashboard "Send test webhook" button, the webhook handler runs against real schema, any drift surfaces in Vercel logs immediately. Test event failure does not move money; recovery is to fix the schema before sending real card traffic.
  - **Preview scope contamination.** If live keys leak into Preview scope, any PR build creates real Stripe Checkout sessions that charge real money. Mitigation: B1.1 audit step explicitly verifies Preview scope has zero `sk_live_*` / `pk_live_*` values **before** uploading any live keys. B29 audit step in the roadmap is exactly this guard.
  - **Webhook URL goes stale.** Stripe webhooks deliver to a fixed URL; if Vercel's production alias `nooncode-app-pi.vercel.app` changes (project rename, team transfer, etc.), Stripe stops delivering and the operator only sees the gap if they check the Stripe Dashboard Events log. Mitigation: registered as ops landmine; recommend setting up a Stripe webhook delivery alert in Stripe Dashboard (Stripe has built-in failure notifications).
  - **NoonWeb dev unavailability.** B1.3 Día 4 smoke depends on NoonWeb's website inbound flow firing into App PM queue. If the NoonWeb dev cannot ship the test payload or there is a NoonWeb-side bug, the smoke stalls at step 1. Mitigation: B1.2 test event already proves the webhook is healthy end-to-end on App's side; if NoonWeb is the blocker, B1.4 + B1.5 can still proceed with a manually-seeded inbound proposal as a workaround for the smoke (recorded as a contingency below).
  - **Stripe Connect not actually activated.** User confirmed Connect is "conectado", but the spec needs to verify what that means at the API level — Connect onboarding has several states (`pending`, `restricted`, `active`) and only `active` allows `transfer.create`. Mitigation: B1.0 sub-step verifies the Connect state of the test seller via Stripe Dashboard before B1.3 begins; if the seller account is not `active`, transfers are deferred and the smoke can still validate steps 1-6 (payment processing + earnings ledger + admin consolidation).
- Known blockers before starting: none verified. Migrations applied (tables exist), webhook URL reachable, Connect onboarded.
- Known assumptions before starting:
  - The Stripe live account is fully activated and can accept real card charges. (To be verified by the operator in Stripe Dashboard — Pending balance + Activate account state.)
  - The Vercel project `App-nooncode` has the production alias `nooncode-app-pi.vercel.app` pinned (not a deploy-hash URL). Verified by `curl` on 2026-05-15.
  - The Vercel Marketplace Upstash integration continues to inject `KV_REST_API_URL` + `KV_REST_API_TOKEN` and the rate limiter handles either pair (B14 verified 2026-05-15).

### CONTINUITY NOTES
- Previous session relevant to this one: 2026-05-15 closed B14 ops verification + Vercel KV env-detection fallback (PR #43 merged, PR #44 closure docs pending). 2026-05-14 closed ADR-010 amendment which is the legal basis for keeping the operator-driven outbound Checkout in App. 2026-05-12 closed B3 seller-fees state machine which the webhook reads on every `checkout.session.completed`.
- Expected next skill after this session if all goes well: system-infra (operator-side execution of B1.1 + B1.2). Spec authoring is the only Claude-active work in this session; the rest is operator runbook with Claude verification touches between sub-iterations.

---

## Task Summary

Execute the FASE 1 cutover: enable Stripe live mode on production, configure the live webhook endpoint, validate the full payment pipeline end-to-end with a real card (small importe), produce the rollback runbook from the observed live behavior, and obtain pilot team sign-off on the UX. Closes the last critical path to FASE 1 success criterion (roadmap §5).

The work is split into 6 sub-iterations (B1.0 through B1.5) over multiple calendar days. Sub-iterations are sequenced because each one is a precondition for the next: B1.0 confirms the system is ready; B1.1 puts the live keys in place; B1.2 exercises the webhook with no money at risk; B1.3 moves real money for the first time; B1.4 captures rollback discipline from observed behavior; B1.5 humans validate that the UX is honest enough to operate.

---

## Scope Boundary

### Included
- **B1.0** — Pre-flight evidence + this spec. Migration ledger / table existence verified (2026-05-15). Webhook URL reachability confirmed. Stripe Connect status confirmed. Production alias confirmed. Spec authored and merged.
- **B1.1** — B29 audit + live keys upload:
  - Audit current Vercel env vars across Production / Preview / Development scopes to confirm zero `sk_live_*` / `pk_live_*` / `whsec_*` live values are already present where they should not be.
  - Upload 3 Stripe live keys to **Production scope only**: `STRIPE_SECRET_KEY` (`sk_live_...`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_...`), `STRIPE_WEBHOOK_SECRET` (`whsec_...`).
  - Trigger a redeploy of `develop` to pick up the new env at function cold start.
  - **Note**: the roadmap §17 referred to a fourth key `STRIPE_CONNECT_*`. Grep against the codebase finds **zero references** — Stripe Connect operations use the same `STRIPE_SECRET_KEY`. This spec corrects the count to 3 live keys. Roadmap §17 will be updated in the B1 closure.
- **B1.2** — Webhook configuration + test event:
  - Create a new webhook endpoint in Stripe Dashboard **Live mode**, URL `https://nooncode-app-pi.vercel.app/api/webhooks/stripe`.
  - Subscribe to the 6 event types the handler implements: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`, `transfer.paid`, `transfer.reversed`.
  - Copy the live `whsec_*` signing secret into Vercel Production env (this is the key uploaded in B1.1 step 3 above — sequencing note: Stripe shows the signing secret only after the endpoint is created, so the actual sequence is: create endpoint → copy whsec → upload to Vercel → redeploy → test).
  - Send a test event from Stripe Dashboard (`account.updated` is the cheapest because it doesn't touch wallet/earnings code paths, just `handleAccountUpdated`).
  - Verify in Supabase: a row appears in `stripe_webhook_events` with `status='processed'`. Verify in Vercel logs: a `stripe.webhook.processed` log line, zero `stripe.webhook.failed` lines.
  - Schema-drift detection: if the test event surfaces a "column does not exist" or "relation does not exist" error, halt B1 and fix the schema (probably via `mcp__supabase__apply_migration` of the missing migration verbatim) before proceeding to B1.3.
- **B1.3** — Día 4 end-to-end smoke with real card:
  - Coordinate with NoonWeb dev to ship a test payload that fires the website inbound webhook into App PM queue.
  - Execute the 7-step pipeline with a small real importe ($5-$10):
    1. NoonWeb inbound → App PM queue review
    2. PM approves in App → review-decision webhook back to NoonWeb
    3. Client pays via NoonWeb-hosted Stripe Checkout (inbound path = NoonWeb-owned per ADR-010)
    4. Stripe webhook lands at App → `handleCheckoutSessionCompleted` runs → project activates with principal/owner
    5. Earnings credit to seller wallet (manual via `POST /api/admin/earnings/credit` — automatic activation is FASE 3 scope)
    6. Admin consolidates earnings via `scripts/consolidate-earnings-validation.ts` (UI gap F-V02 deferred to v3 sec 24.4 earnings reshape)
    7. Seller sees `available_to_withdraw` in `/dashboard/earnings` + executes withdraw via Stripe Connect transfer
  - Capture screenshots / log excerpts for each step into `docs/validations/B1 cutover smoke 2026-MM-DD.md`.
  - **Contingency**: if NoonWeb dev is blocked, run a manual smoke that seeds an outbound proposal directly in App and exercises steps 4-7 only. Steps 1-3 remain pending. The contingency is acceptable for B1.3 evidence but the full inbound smoke must run before B1.5 sign-off can be claimed.
- **B1.4** — Cutover runbook:
  - New file `docs/runbooks/cutover-pilot.md`. Written **after** B1.3 so the hooks reflect what actually happened in production, not what we expected to happen.
  - Sections: rollback Vercel deploy (revert via Deployments tab); restore Supabase from PITR (Point-In-Time-Recovery) if enabled — verify whether PITR is on for `pdotsdahsrnnsoroxbfe` before claiming this; replay webhook events from the ledger (idempotency guarantees safety, document the SQL or Stripe Dashboard procedure); incident response contact list; failure-mode-to-mitigation mapping (e.g., "Stripe webhook signature mismatch on a real event → check `STRIPE_WEBHOOK_SECRET` in Vercel; do not retry from Stripe Dashboard until secret is verified").
  - Covers audit B27 from the FASE 1 audit list.
- **B1.5** — Pilot team sign-off:
  - 4-person team (1 seller + 1 PM + 1 admin + 1 developer) processes real workflows in production for 1-2 calendar days.
  - Sign-off criterion: "the UX does not create grave operational confusion" — explicit handoff document captures the team's verdict.
  - Operator-in-the-loop is the agreed observability path (Sentry deferred per PR #30). The team is expected to surface and report anomalies as they happen.

### Excluded
- B5 (Sentry / alerting). Deferred per PR #30 and ADR-009. Re-evaluable before external client exposure.
- G7 (broader migration ledger reconciliation). Tracked as `fase-0-b4b-ledger-reconciliation` iteration. Scoped separately; not part of B1.
- F-V02 (admin consolidate UI). Deferred until v3 sec 24.4 earnings reshape defines the final bucket model. Workaround for B1.3 step 6 is `scripts/consolidate-earnings-validation.ts`.
- F-V06 / F-V07 / F-V08 (Tier 3 UX). Explicitly listed in roadmap §17 as "no bloquean lanzamiento interno".
- Stripe Connect onboarding flow improvements. Connect is operationally usable per user confirmation; UX polish around onboarding is FASE 2+ work.
- Custom-domain migration off `*.vercel.app`. The current alias works; switching to a brand domain is a separate ops task.
- Auto-deploy diagnosis (G11). Manual redeploy workaround is validated and acceptable until calmer ops window.
- Multi-region or HA configuration for the Supabase project. Single-region is acceptable for the 4-person pilot.

---

## Affected Files / Modules

### Repo files touched (lightweight, mostly docs)
- `specs/fase-1-b1-stripe-live-cutover.md` (this file — created in B1.0).
- `docs/runbooks/cutover-pilot.md` (created in B1.4).
- `docs/validations/B1 cutover smoke 2026-MM-DD.md` (created in B1.3 with the smoke evidence).
- `docs/context/project.context.core.md` (updated in B1.5 closure with the Closed-in-runtime entry and any operating rule changes that emerge from the smoke).
- `docs/context/project.context.history.md` (B1 session note appended in closure).
- Local NoonApp Roadmap §17 (rewritten in closure — lives outside the repo).

### Repo files exercised but not modified
- `app/api/webhooks/stripe/route.ts` — the live target. Behavior verified, not changed.
- `lib/server/stripe/client.ts` — constructs the live Stripe SDK from `STRIPE_SECRET_KEY`. Picks up the live key automatically once env is set.
- `lib/server/payments/activation.ts` — `activatePaidProposal` invoked from `handleCheckoutSessionCompleted`.
- `lib/server/seller-fees/{repository,service}.ts` — `getSellerFeeByProposalId` + `confirmSellerFee` invoked for outbound proposals.
- `lib/server/stripe/webhook-events.ts` — ledger functions `beginStripeWebhookEvent` / `markStripeWebhookEventProcessed` / `markStripeWebhookEventFailed`.

### External systems touched
- Vercel Dashboard (Settings → Environment Variables; Deployments tab for manual redeploy).
- Stripe Dashboard (Live mode — API keys, Webhooks endpoint, test events, real Charges).
- Supabase Dashboard / SQL Editor (post-smoke evidence queries against `stripe_webhook_events`, `payments`, `earnings_ledger`, `wallet_ledger_entries`).
- Upstash Dashboard (sanity — confirm webhook rate-limit traffic appears).
- NoonWeb repo (cross-repo coordination, B1.3 only — operator schedules with the NoonWeb dev).

---

## Success Criterion

B1 is COMPLETE when **all** of the following hold:

1. Migration ledger / schema state remains consistent (G7 desync not made worse).
2. Stripe live keys are present in Vercel Production scope only; Preview scope contains zero `*_live_*` values.
3. The live webhook endpoint in Stripe Dashboard is configured against `https://nooncode-app-pi.vercel.app/api/webhooks/stripe` and listening for the 6 event types.
4. At least one test event from Stripe Dashboard Live mode lands at the App webhook, returns 200, creates a row in `stripe_webhook_events` with `status='processed'`, and produces a `stripe.webhook.processed` log entry in Vercel.
5. At least one real card charge (importe pequeño, $5-$10) processes end-to-end: Stripe Checkout completes → `checkout.session.completed` webhook fires → project activates → earnings ledger rows created → seller wallet credited → admin consolidates → seller withdraw executes via Stripe Connect transfer → `transfer.paid` webhook fires → wallet state reaches a coherent end position. Evidence captured in `docs/validations/B1 cutover smoke 2026-MM-DD.md`.
6. `docs/runbooks/cutover-pilot.md` exists with rollback / restore / replay / on-call procedures derived from the observed B1.3 behavior.
7. The 4-person pilot team has executed real workflows for 1-2 calendar days and recorded a sign-off statement that "the UX does not create grave operational confusion". Anomalies observed during sign-off are either fixed or recorded as deferred follow-ups with explicit rationale.
8. `project.context.core.md` is updated to reflect: Stripe live activation status, the actual prod URL used, any new operating rules that emerged from the smoke, and B1 closure in the Corrected roadmap status block.

If any of (1)-(7) fails, B1 is PARTIAL or BLOCKED. The iteration does not COMPLETE without an updated `project.context.core.md` (rule 8) — this is the project-wide invariant.

---

## Sub-iteration Sequencing

| Sub-iter | Precondition                        | Owner                  | Reversible? | Notes |
|----------|-------------------------------------|------------------------|-------------|-------|
| B1.0     | none                                | Claude (spec)          | yes         | This session. |
| B1.1     | B1.0 merged                         | Operator (Vercel UI)   | yes — delete env vars + redeploy | No real money risk yet; webhook will reject live events because `STRIPE_WEBHOOK_SECRET` doesn't match until B1.2. |
| B1.2     | B1.1 done + redeploy live           | Operator (Stripe) + Claude (verify) | yes — disable endpoint in Stripe Dashboard | Test event only; no real money. |
| B1.3     | B1.2 green + NoonWeb dev available  | Operator + NoonWeb dev + Claude (monitor) | **partial** — refunds via Stripe Dashboard reverse the cobro but earnings/points ledger entries persist | **First real money.** |
| B1.4     | B1.3 done                           | Claude (write)         | yes — docs only | Captures observed behavior. |
| B1.5     | B1.4 docs in place                  | Pilot team             | yes — flag + extend window | Calendar gate, not engineering gate. |

---

## Pre-flight Evidence (collected 2026-05-15)

Captured here so B1.1 onwards doesn't need to re-verify prereqs.

### Code-level
- `app/api/webhooks/stripe/route.ts` reviewed: webhook handles 6 event types; rate-limit namespace `stripe-webhook` 600/min/IP; uses `STRIPE_WEBHOOK_SECRET` (line 401) and `getStripeClient()` which reads `STRIPE_SECRET_KEY` (`lib/server/stripe/client.ts:8`).
- Grep across the codebase for `STRIPE_CONNECT*`: zero references. The fourth "Stripe Connect key" in roadmap §17 is stale — there is no separate Connect API key, Connect operations use `STRIPE_SECRET_KEY`. **3 live keys total**, not 4.
- Grep across the codebase for `STRIPE_SECRET|STRIPE_WEBHOOK|NEXT_PUBLIC_STRIPE`: confirmed each is referenced from a single canonical location (no duplicate readers, no env-var name typos).

### Remote (Supabase `pdotsdahsrnnsoroxbfe`)
- Query 1 — registered migrations matching `0041%` / `0042%` / `0043%` / `0044%`: **0 rows**. Confirms G7 desync.
- Query 2 — tables existing in `public` schema among `stripe_webhook_events`, `seller_fees`, `payments`, `earnings_ledger`, `wallet_accounts`, `wallet_ledger_entries`, `points_ledger`, `withdrawal_requests`, `payouts`: **9 rows, all present**.
- Verdict: tables exist physically, ledger absent. Webhook can run; future `supabase db push` from CLI is unsafe until `fase-0-b4b-ledger-reconciliation`.

### Vercel production alias
- `curl https://nooncode-app-pi.vercel.app/api/webhooks/stripe` (GET): HTTP 405 (route accepts POST only, route runs correctly).
- `curl -X POST` with no signature: HTTP 400 with body `{"error":"Missing stripe-signature header"}` — this is our app's response from `route.ts:411`, confirming Deployment Protection is **not** active on this alias and the rate-limiter passed.
- Conclusion: Stripe webhooks can POST to this URL without auth bypass.

### Operator confirmations
- Stripe Connect platform onboarded (status to be verified at the seller-account level during B1.3 prep — see Risk Snapshot above).
- Production alias decided: `nooncode-app-pi.vercel.app`. Custom domain migration deferred.
- ~2-3h window available for B1.1 + B1.2 today/this week. NoonWeb dev coordination for B1.3 still to be scheduled.

---

## Out-of-band Steps Operator Must Do (Claude Cannot)

Claude cannot click in Vercel, log into Stripe, send a Dashboard test event, charge a real card, or coordinate with the NoonWeb dev. These remain operator responsibilities. Claude's role across B1.1-B1.3 is to:
- Verify the **before** and **after** state of the database via SQL queries (Supabase Dashboard SQL Editor; user pastes results, or MCP if re-authed).
- Inspect Vercel logs when the operator reports an error.
- Cross-check that the webhook event ledger matches what Stripe Dashboard shows under Events.
- Update docs after each sub-iteration is observed green.

---

## Per-sub-iteration Detail

### B1.1 — Audit + live keys upload

**Operator steps (Vercel Dashboard):**
1. Settings → Environment Variables. Filter the list for keys starting with `STRIPE_` and `NEXT_PUBLIC_STRIPE_`. Confirm:
   - Production scope: no `sk_live_*`, `pk_live_*`, `whsec_*` values currently present. (Today should only have test keys, if any.)
   - Preview scope: same — zero live values. If any are found, this is the B29 finding and must be remediated before adding new live keys.
   - Development scope: ideally none, but if test keys are there they're fine.
2. Add new env vars in **Production scope only**:
   - `STRIPE_SECRET_KEY` = `sk_live_...` from Stripe Dashboard → Developers → API keys → Live mode → Reveal live key.
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` = `pk_live_...` from the same place.
   - **Wait on `STRIPE_WEBHOOK_SECRET`** — that value comes from B1.2 (Stripe shows it only after the webhook endpoint is created). Either upload a placeholder now and update in B1.2, or skip until B1.2 and do a second redeploy.
3. Deployments tab → latest `develop` deployment → `⋯` → Redeploy → uncheck "Use existing Build Cache" → Redeploy. Wait for status Ready.

**Claude verification:**
- Re-run `curl` against `https://nooncode-app-pi.vercel.app/api/webhooks/stripe` POST with no signature; still returns 400 with the app's error. (Production env now has the live STRIPE_SECRET_KEY but webhook still requires signature.)
- Run `npm run validate:env` against a clean shell with no env to confirm the validator does not flag false positives. (Optional; the production env is what matters and is opaque to local tools.)

**Success criteria:**
- Both Stripe live keys present in Production scope. Preview scope unchanged. Redeploy Ready.
- App still serves traffic normally (no 500 storms).
- No accidental Preview-mode Stripe Checkout being created (verify by checking Stripe Dashboard → Events log for unexpected `checkout.session.created` events from Preview hostnames).

**Rollback trigger:**
- If post-redeploy logs show a flood of 500s on `/api/webhooks/stripe` or `/api/payments/checkout`, revert the env vars (delete in Vercel) and redeploy. Live keys are removed; pre-cutover state restored.

### B1.2 — Webhook config + test event

**Operator steps (Stripe Dashboard, Live mode):**
1. Switch the Stripe Dashboard to **Live mode** (top-right toggle).
2. Developers → Webhooks → **Add an endpoint**:
   - Endpoint URL: `https://nooncode-app-pi.vercel.app/api/webhooks/stripe`
   - Description: `NoonApp production webhook`
   - Events to listen for (add each):
     - `checkout.session.completed`
     - `payment_intent.payment_failed`
     - `charge.refunded`
     - `account.updated`
     - `transfer.paid`
     - `transfer.reversed`
   - Create.
3. Click the new endpoint → "Signing secret" → Reveal → copy the `whsec_...` value.
4. Vercel Dashboard → Production env → upload `STRIPE_WEBHOOK_SECRET` = `whsec_...`.
5. Redeploy `develop` (manual, per G11).

**Operator steps (test event):**
6. Back in Stripe Dashboard → Webhooks → the new endpoint → "Send test webhook" → pick `account.updated` (cheapest path through the handler; doesn't touch wallet or payments tables).
7. Confirm Stripe Dashboard shows the delivery as `200 OK`.

**Claude verification (after operator pastes results or via MCP if re-authed):**
- Supabase SQL: `SELECT event_id, event_type, status, attempts, last_failed_message FROM stripe_webhook_events ORDER BY created_at DESC LIMIT 5;` — confirms the test event landed and is `processed`.
- Vercel logs: filter for `stripe.webhook.processed`. Confirm exactly one entry with the test event ID. Confirm zero `stripe.webhook.failed` entries for that event.
- If schema drift surfaced (e.g., `column "last_failed_message" does not exist`), the migration applied OOB used a different shape than the local file. Stop B1 here and reconcile schema via `mcp__supabase__apply_migration` before retrying.

**Success criteria:**
- Test event status = `processed` in the ledger.
- No errors in Vercel logs for the event ID.
- Stripe Dashboard shows `200 OK` for the delivery.

**Rollback trigger:**
- If the test event fails repeatedly with the same error, disable the endpoint in Stripe Dashboard (toggle off, don't delete — preserves the signing secret for later) and investigate.

### B1.3 — Día 4 smoke E2E

**Coordination:**
- Schedule a ~3h window with the NoonWeb dev. Confirm they have test card data and a website inbound payload ready.
- Operator confirms the test seller's Stripe Connect account status is `active` (Stripe Dashboard → Connect → Accounts → search → status column).

**Execution:**
- The 7 numbered steps in Scope §B1.3 above. Each step's expected state changes are captured in `docs/validations/B1 cutover smoke 2026-MM-DD.md` as it runs.

**Per-step evidence to capture:**
1. NoonWeb inbound: a row in App's `inbound_review_queue` (or equivalent — check schema) with `status='pending_review'`.
2. PM approve: review-decision webhook fires from App to NoonWeb (verify in NoonWeb side); App-side activity records the approval.
3. Client pays: Stripe Dashboard → Payments → the new charge in Live mode for $5-$10.
4. Webhook lands: `stripe_webhook_events` has the `checkout.session.completed` row as `processed`; `payments` row has `status='paid'`; project row has `payment_activated=true`.
5. Earnings credit: `earnings_ledger` rows for `seller` + `developer` + `noon`; `wallet_ledger_entries` for each actor; `wallet_accounts.pending` increments for seller and developer.
6. Admin consolidates: run `scripts/consolidate-earnings-validation.ts`; seller's `pending` → `available_to_withdraw`; ledger entry with `reference_type='consolidation'`.
7. Seller withdraws: Stripe Connect transfer fires; `transfer.paid` webhook lands; `wallet_ledger_entries` records the withdrawal; `available_to_withdraw` reaches zero.

**Success criterion:**
- All 7 steps observed; the system reaches a coherent end state; the cobro is real money landed in Noon's Stripe balance net of Stripe fees + Connect transfer.
- Total cobro can be refunded via Stripe Dashboard after the smoke. Earnings ledger entries persist as historical record — that's correct; they represent what really happened.

**Rollback trigger:**
- If money is moved but the App-side state is inconsistent (e.g., webhook fires but project doesn't activate, or earnings are wrong), pause B1.3 immediately. Refund the cobro via Stripe Dashboard. Do not retry B1.3 until the inconsistency is understood and fixed.

### B1.4 — Cutover runbook

Claude writes `docs/runbooks/cutover-pilot.md` after B1.3 completes. Structure:

1. Audience: NoonApp operator + future on-call.
2. Pre-incident state assumptions (Production env, live keys, webhook live, pilot in flight).
3. Rollback procedures:
   - Revert a bad code deploy (Vercel Deployments tab → previous deployment → Promote to Production).
   - Disable Stripe webhook (Dashboard → Webhooks → toggle off) without losing the signing secret.
   - Disable specific payment flow code paths via env var if needed (none currently exist; flag if this becomes needed).
4. Restore procedures:
   - Supabase PITR (Point-In-Time-Recovery) — first verify whether PITR is enabled for `pdotsdahsrnnsoroxbfe`. If not, this section documents the limitation rather than the procedure.
   - Replay webhook events: query `stripe_webhook_events` for events with `status='failed'` and reset them, OR resend from Stripe Dashboard → Events → individual event → Retry. Idempotency keys protect against double-spending.
5. Failure-mode catalogue with observed behavior from B1.3 (e.g., "if the Stripe webhook fails signature verification, expect Stripe Dashboard to retry with backoff; check `STRIPE_WEBHOOK_SECRET` matches the endpoint's signing secret in Stripe").
6. On-call contact list (TBD by operator).
7. Known limitations (Sentry deferred, no alerting beyond Vercel native logs, single-region Supabase, etc.).

### B1.5 — Pilot team sign-off

- 4-person team executes real workflows for 1-2 calendar days.
- Operator collects daily check-ins ("anything weird?"); anomalies feed back into B1.4 runbook or are filed as separate iterations.
- Sign-off document captured at the end of the window with explicit statement that "UX does not create grave operational confusion" + names of the 4 participants + the timeframe + the anomalies observed.

---

## Risks and Mitigations (consolidated)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Schema drift in webhook tables | High | B1.2 test event surfaces it cheap. Halt + reconcile via `mcp__supabase__apply_migration` before B1.3. |
| Preview scope contamination with live keys | High | B1.1 audit step explicit. |
| Webhook URL drift | Medium | Stripe Dashboard alerts on delivery failure; manual ops check during pilot. |
| NoonWeb dev unavailable | Medium | B1.3 contingency: manual outbound seed to exercise steps 4-7; full inbound smoke before B1.5 sign-off. |
| Stripe Connect not really active for test seller | Medium | Verify status before B1.3. Defer step 7 if needed; smoke can validate steps 1-6 standalone. |
| Real cobro made by mistake before B1.2 verification | Low (gated by signing secret mismatch) | Webhook rejects with 400 until matching `STRIPE_WEBHOOK_SECRET` is uploaded. |
| Auto-deploy not triggering (G11) | Low | Manual Redeploy workaround validated 2026-05-15. |
| Upstash free tier exhaustion during pilot | Low | 253 / 500k after B14 smoke; pilot traffic single-digit RPS. |
| First real money lost to a bug | Low | Small importe; refundable via Stripe Dashboard; idempotency protects ledger integrity. |

---

## Notes for Validator

`system-validator` evaluates this iteration at the **B1.5 boundary**, not after each sub-iteration. Intermediate gates (B1.0 spec merge, B1.1 keys uploaded, B1.2 test event green, B1.3 smoke green, B1.4 runbook present) are required precursors. Validator must check:
- All 8 items in Success Criterion above are satisfied.
- `project.context.core.md` is updated to reflect the new live state.
- No PARTIAL or BLOCKED sub-iteration is left silently — each must be explicitly recorded.
- The 4-person team sign-off statement exists in the repo (`docs/validations/` or equivalent).
- Anomalies observed during the smoke or pilot are recorded as either fixed or deferred follow-ups with explicit rationale.

If any sub-iteration is PARTIAL/BLOCKED, B1 is PARTIAL/BLOCKED. Operator + Claude reconvene to resolve before COMPLETE can be claimed.
