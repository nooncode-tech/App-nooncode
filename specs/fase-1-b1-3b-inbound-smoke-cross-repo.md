# spec.md — fase-1-b1-3b-inbound-smoke-cross-repo

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-18
- Session ID: fase-1-b1-3b-inbound-smoke-cross-repo
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec). Downstream chain confirmed by router: system-infra (cross-repo pre-flight confirmation) → system-security (HMAC surface + evidence-capture review) → Execution Gate (operator + NoonWeb dev run the smoke) → system-testing (structure evidence + verdicts) → system-docs (context.core + roadmap update) → system-validator (COMPLETE / PARTIAL / BLOCKED).
- Router mode: Infra-Deploy (variante validation release readiness).
- Depth: Full.

### OBJECTIVE
- What must be achieved in this session: produce the authoritative spec for the **inbound cross-repo smoke** that exercises the website → App webhook path (`inbound-proposal` + `payment-confirmed`) plus the round-trip App → website outbound `proposal-review-decision` against the v1 contract documented in `docs/integrations/cross-repo-webhook-v1.md`. Spec only — no infra, no security, no smoke execution in this session. The output is the input artifact for system-infra to pick up.
- Why this work matters now: B1.3a closed 2026-05-17 with the outbound flow validated end-to-end ($1 real, Scenarios 1-8 PASS). B1.3b is the **last external gate before B1.5 pilot sign-off** — without it, the inbound flow (which is the path real Maxwell-driven clients will take in production) remains unverified against live infra. NoonWeb dev availability is confirmed for today (2026-05-18), and the cross-repo pre-flight (HMAC secret shared, outbound webhook URL configured, repo flipped PUBLIC temporarily, fresh Production deploy Ready) is already in place. Missing this window pushes B1.5 further out.

### CONTEXT USED
- `project.context.core.md` reviewed: yes (Active risks block, Closed-in-runtime B1.3a + B1.4 + G11 + Webhook integration entries, Operating rules for HMAC + ADR-010 amendment + inbound payment ownership).
- `project.context.full.md` reviewed: no — this iteration validates the existing v1 contract against live infra; it does not change contracts, architecture, or persistence.
- `project.context.history.md` reviewed: partial (B1.3a closure 2026-05-17, B1.4 closure 2026-05-17, G11 fix 2026-05-17 — the three most recent FASE 1 events that condition this iteration).
- Reason `full` was included if applicable: not required.
- Reason `history` was included if applicable: B1.3a is the analogue iteration on the outbound side and its closure document (`docs/validations/B1.3a outbound smoke 2026-05-16.md`) is the structural template for the validation doc system-testing will produce. The G11 fix is load-bearing because it is what made the latest develop HEAD reach Production (the deploy that includes the inbound integration handlers).

### ROUTER DECISION
- Why this mode is correct: Infra-Deploy variante validation release-readiness fits because (a) no new code is written in this iteration — the affected files were merged previously and have been Ready in Production since B1.3a closure; (b) the work is operational verification against external services (NoonWeb webhook endpoints, Stripe-irrelevant for inbound v1, Supabase live state); (c) the smoke is cross-repo coordinated, not internal-only; (d) the success criterion is runtime behavior in production observed by the operator and the NoonWeb dev together, not a code merge.
- Why this depth is correct: Full because (a) this is the FIRST live exercise of inbound v1 across both repos against the same shared HMAC secret in production; (b) the smoke involves test money flowing through NoonWeb-owned Stripe Checkout (per ADR-010), which means an explicit cleanup/reversal plan is required; (c) failure modes affect three different surfaces (App receiver, App outbound sender, NoonWeb receiver) and a Lite spec would not safely scope the negative paths.
- Why this skill is the right active skill now: nothing else can route until (a) the scenarios are mapped against the contract, (b) the oracle per scenario is explicit, (c) the cleanup plan and the test-data marker are agreed, (d) the divergence-to-contract findings detected during code review are surfaced as OPEN QUESTIONS, and (e) the closure criteria from the router are enumerated. system-infra cannot start without those.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules" (all exercised, none modified in this iteration).
- Contracts or architecture inputs available:
  - `docs/integrations/cross-repo-webhook-v1.md` — v1 wire contract (§2 auth, §3 inbound-proposal, §4 payment-confirmed, §5 proposal-review-decision, §6 error shape, §7 rate limits, §8 idempotency model, §13 open issues including v2-deferred replay nonce store).
  - `docs/adrs/ADR-010-client-portal-lives-in-noonweb.md` (status `Accepted (amended 2026-05-14)`) — defines inbound payment ownership = NoonWeb; ADR-010 amendment 2026-05-14 is the legal basis for the operator-driven outbound exception only, **inbound stays NoonWeb-owned**.
  - `specs/fase-1-b1-stripe-live-cutover.md` — parent iteration. B1.3a closed the outbound half; B1.3b closes the inbound half. The roadmap §6 B1.3 item is split per this spec into B1.3a (closed) + B1.3b (this iteration).
- Relevant handoffs received from router:
  - 9 closure criteria (mapped 1:1 in `## Success Criterion` below — no inventions).
  - 7 explicit inputs the spec must cover (scenario mapping, test-data decision real vs test, oracle per scenario, cleanup/reflip, who-executes-what, evidence capture redaction, COMPLETE/PARTIAL/BLOCKED criteria).
  - Pre-flight evidence already executed (Path G PR #65 deployed, `NOON_WEBSITE_WEBHOOK_SECRET` set, `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` set + 401-tested, repo flipped PUBLIC temporal, deploy Ready) — system-infra will confirm officially.
- External dependencies or environment assumptions:
  - NoonWeb dev is available and willing to fire signed inbound webhook requests from the NoonWeb side, AND to observe NoonWeb-side receipt of the outbound `proposal-review-decision` callback.
  - The shared HMAC secret in `NOON_WEBSITE_WEBHOOK_SECRET` is byte-identical on both App-side Vercel Production env and NoonWeb-side env (per contract §2.4 / §10).
  - `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL = https://noon-main.vercel.app/api/integrations/noon-app/proposal-review-decision` — already configured in App-side Vercel Production env, confirmed to respond 401 to unsigned.
  - App-side Production alias `https://nooncode-app-pi.vercel.app` is publicly reachable (G11 fix 2026-05-17 + repo flipped PUBLIC temporarily 2026-05-18 to allow Vercel to redeploy without org access friction; **deferred re-flip to PRIVATE captured in tasks**).
  - Supabase project `pdotsdahsrnnsoroxbfe` (live) is the data store for evidence verification; queries will be executed by Pedro via Dashboard SQL Editor (Supabase MCP not loaded in the session).

### RISK SNAPSHOT
- Known risks before starting: see "## Risks" below for the full classified register.
- Known blockers before starting: none verified. The cross-repo pre-flight is done. NoonWeb dev availability is confirmed for the smoke window.
- Known assumptions before starting:
  - The HMAC secret on both sides matches byte-for-byte. If it diverged silently after the last rotation, every request fails 401 and the smoke stalls at Scenario 1.
  - The App-side handlers in Production (deploy with PR #65 Path G merged) match the v1 contract as documented. Any drift between code and contract registered in this spec under OPEN QUESTIONS — the smoke surfaces drift but does not by itself fix it.
  - The test data path uses test mode Stripe Checkout on NoonWeb (per scope decision in §Open Questions Q1 — decided as **test mode**). Real money is NOT used in this iteration; reversal endpoint Path D (`/api/admin/payments/[id]/refund`) does not need to be invoked because there is no live charge to refund.
  - PM review action in App is logged in as `admin@noon.app` (used as PM-proxy in B1.3a; no real `pm` role user exists in prod). The action triggers `sendProposalReviewDecisionToWebsite` which fires the App → Web outbound; that is the App-side responsibility of the round-trip.

### CONTINUITY NOTES
- Previous session relevant to this one: B1.3a closure 2026-05-17 validated the outbound half (PM-side initiated, App receives Stripe webhook, App activates). B1.3b inverts the direction: NoonWeb initiates, App receives the integration webhook directly (no Stripe webhook involved for inbound — Stripe ownership stays NoonWeb-side per ADR-010). B1.4 cutover runbook closure 2026-05-17 includes the failure-mode catalogue that system-testing will reuse to triage if a scenario fails. G11 fix 2026-05-17 is what made Production run develop HEAD instead of stale `5eba6e9` from 2026-05-14 — without G11 resolved, the App-side handlers would not be the version this contract describes.
- Expected next skill after this session if all goes well: system-infra confirms pre-flight officially (HMAC secret presence + outbound URL configured + deploy Ready + receiver endpoints reachable). The remainder of the chain is router-prescribed.

---

## Task Summary

Validate the v1 cross-repo webhook contract (`docs/integrations/cross-repo-webhook-v1.md`) end-to-end against live infrastructure for the **inbound direction (NoonWeb → App)** plus the **outbound round-trip (App → NoonWeb) for `proposal-review-decision`**. The smoke is a coordinated cross-repo execution between Pedro (App side) and the NoonWeb dev (Web side) on 2026-05-18, using test-mode Stripe Checkout on the NoonWeb side so no real money moves through the system. Negative-path scenarios (HMAC failure, stale timestamp, missing signature, replay idempotency) are also covered so the contract's auth surface is exercised end-to-end, not just the happy path.

The smoke does not modify any code. The deploy currently Ready in Production (post-G11 fix 2026-05-17, post-PR #65 Path G merge) is the artifact under test. The deliverable of this iteration is the **evidence document** that system-testing will produce, capturing PASS/FAIL/DEFERRED per scenario plus any contract-vs-code divergences observed, plus the **context/roadmap updates** that system-docs will land after the evidence is locked.

---

## Scope Boundary

### Included
- **Scenario 0 — Pre-flight evidence capture.** Operator (Pedro) confirms baseline state in App-side DB before the smoke begins:
  - `website_inbound_links` row count baseline (expected zero rows matching the test markers).
  - `leads` row count baseline for the test customer email.
  - Stripe `stripe_webhook_events` baseline (not strictly relevant for inbound v1 path because Stripe Checkout on inbound is NoonWeb-side, but useful to confirm no unrelated noise during the smoke window).
  - Vercel deploy status confirmation (develop HEAD = `f3626d9`, Production = Ready).
  - `curl` against both App receiver endpoints with no signature → expect 401 (sanity that the rate-limiter + signature guard fire correctly).
  - `curl` against the NoonWeb receiver endpoint with no signature → expect 401 (cross-repo sanity — already confirmed pre-flight, capture as part of the evidence).
- **Scenario 1 — `inbound-proposal` happy path (Web → App, §3 of the contract).** NoonWeb dev fires a signed `POST https://nooncode-app-pi.vercel.app/api/integrations/website/inbound-proposal` with a fresh `external_session_id` / `external_proposal_id` / `customer.email` containing the test marker (see "## Test Data Markers" below).
  - **Oracle:** HTTP 201 response; response body contains `idempotent: false`, `linkId`, `leadId`, `proposalId`, `status: 'proposal_pending_review'`; new row in `website_inbound_links` with the matching external ids and `current_status='proposal_pending_review'`; new row in `leads` with the test marker email; new row in `lead_proposals` with `review_status='pending_review'`, `status='sent'`, `payment_status=NULL`.
  - **Vercel logs:** one `website.inbound_proposal.received` info entry with `idempotent: false`; zero `website.inbound_proposal.rejected` / `website.inbound_proposal.failed` entries for the same `requestId`.
- **Scenario 2 — `inbound-proposal` idempotent retry (Web → App, §3.3).** NoonWeb dev re-sends the exact same payload (same `external_session_id`, same `external_proposal_id`) within the smoke window.
  - **Oracle:** HTTP 200 response (not 201); response body contains `idempotent: true` and the same `linkId` / `leadId` / `proposalId` as Scenario 1; **no new rows** in `website_inbound_links`, `leads`, or `lead_proposals`; the existing rows have `inbound_payload` snapshot updated (per §3.3 "behavior change" — if state is `proposal_pending_review`, lead/proposal records are updated; this is acceptable as long as no extra rows are created).
  - **Vercel logs:** one `website.inbound_proposal.received` info entry with `idempotent: true`.
- **Scenario 3 — `inbound-proposal` negative paths (§2 / §6 / §8 of the contract).** NoonWeb dev fires three separate malformed requests, one per sub-scenario:
  - **3a.** Missing `x-noon-signature` header. **Oracle:** HTTP 401 with code `WEBSITE_WEBHOOK_AUTH_FAILED`, body `error: 'Missing webhook signature.'`; one `website.inbound_proposal.rejected` warn entry with `status: 401` in Vercel logs.
  - **3b.** Valid signature header **but signature value tampered** (e.g., `sha256=deadbeef...`). **Oracle:** HTTP 401 with code `WEBSITE_WEBHOOK_AUTH_FAILED`, body `error: 'Invalid webhook signature.'`; one `website.inbound_proposal.rejected` warn entry.
  - **3c.** Valid signature against a stale timestamp (older than 5 minutes — per `MAX_CLOCK_SKEW_SECONDS = 300` in `lib/server/website-webhook-auth.ts`). **Oracle:** HTTP 401 with code `WEBSITE_WEBHOOK_AUTH_FAILED`, body `error: 'Webhook timestamp is outside the allowed window.'`; one `website.inbound_proposal.rejected` warn entry.
- **Scenario 4 — App-side PM review action triggers App → Web outbound (§5 of the contract).** Pedro logs into `https://nooncode-app-pi.vercel.app` as `admin@noon.app` (PM-proxy, same as B1.3a Scenario 3), opens `/dashboard/pm-queue`, locates the lead/proposal created in Scenario 1, clicks **Approve**.
  - **Oracle (App-side state):** `lead_proposals.review_status='approved'`, `reviewer_id` populated, `reviewed_at` populated; `website_inbound_links` row updated to `current_status='review_webhook_sent'`, `review_webhook_status='sent'`, `review_webhook_attempted_at` populated, `review_webhook_sent_at` populated, `review_webhook_error=NULL`.
  - **Oracle (App-side logs):** the `POST /api/proposals/{id}/review` route returns 200; `lib/server/website-integration.ts` `sendProposalReviewDecisionToWebsite` fires `POST` to `https://noon-main.vercel.app/api/integrations/noon-app/proposal-review-decision` with the signed payload per §5.2.
  - **Oracle (NoonWeb-side, confirmed by NoonWeb dev):** the NoonWeb receiver logs the inbound request with `event: 'proposal_review_decision'`, `decision: 'approved'`, matching `external_session_id` / `external_proposal_id`; HTTP 2xx response returned.
- **Scenario 5 — `payment-confirmed` happy path (Web → App, §4 of the contract).** NoonWeb dev simulates the test-mode Stripe Checkout success on the NoonWeb side (or fires the webhook directly with a test `external_payment_id` per the contract §4.2 schema — the smoke does not require an actual Stripe test charge on NoonWeb side, only a signed payload from NoonWeb to App that matches the contract). The `external_session_id` and `external_proposal_id` match Scenario 1 (so this confirms the same proposal that PM approved in Scenario 4).
  - **Oracle (HTTP):** 201 response; body contains `idempotent: false`, `linkId`, `leadId`, `proposalId`, `projectId`, `status: 'project_activated'`.
  - **Oracle (DB):** `website_inbound_links` row updated to `current_status='project_activated'`, `external_payment_id` populated, `payment_confirmed_at` populated, `project_id` populated; `lead_proposals.payment_status='succeeded'`, `paid_at` populated; new row in `payments` with the matching `external_payment_id`, `status='succeeded'` (inbound payment recording per §4); new row in `projects` with `source_proposal_id` = the proposal id, `payment_activated=true`, `status` per activation contract.
  - **Wallet/earnings caveat (registered as OPEN QUESTION Q4):** the inbound path's behavior for `wallet_ledger_entries` and `seller_fees` is not as clear-cut as outbound — `lead_origin='inbound'` proposals do not have a `seller_fees` row by the B3 contract, and earnings credit for inbound is a separate FASE 3 lifecycle topic. The oracle here is **the absence** of `seller_fees` row for this proposal (because it is inbound) and **no `wallet_ledger_entries` rows referencing this proposal** unless inbound activation now does credit (which is not what the current handler does per code review). If activation surprises us with wallet writes, that is itself a finding and is captured.
- **Scenario 6 — `payment-confirmed` idempotent retry (§4.3).** NoonWeb dev re-sends the exact same payload (same `external_session_id`, `external_proposal_id`, `external_payment_id`).
  - **Oracle:** HTTP 200 (not 201); body contains `idempotent: true`, same `linkId` / `leadId` / `proposalId` / `projectId`; no new rows in `payments` / `projects` / `website_inbound_links`; no duplicate ledger entries anywhere.
- **Scenario 7 — `payment-confirmed` activation precondition (§4.4).** NoonWeb dev fires a `payment-confirmed` request for a **second** proposal that has **not** been PM-approved (still in `proposal_pending_review`).
  - **Oracle:** HTTP 409 with code `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL`, response body matches §6 error shape; the corresponding `lead_proposals` row is **not** transitioned to `payment_status='succeeded'`; no `payments` or `projects` row created.
  - **Setup:** Scenario 7 requires NoonWeb to first fire a second `inbound-proposal` (a new `external_session_id` distinct from Scenario 1) so there is a pending-review proposal to attempt the premature payment against. This counts as a sub-step of Scenario 7, not a separate scenario.
- **Scenario 8 — Evidence capture + post-smoke cleanup.** All evidence captured into `docs/validations/B1.3b inbound smoke 2026-05-18.md` (file name follows B1.3a precedent, naming convention: `B1.3b inbound smoke <YYYY-MM-DD>.md`). Cleanup tasks tracked:
  - Re-flip repo from PUBLIC to PRIVATE (deferred — captured in tasks #6 already).
  - DB cleanup decision recorded (test rows under the test markers can be left for traceability, OR deleted per the operator's call — option recorded in the evidence doc).
  - HMAC secret rotation NOT triggered by this smoke (rotation cadence is yearly per contract §2.4; smoke does not constitute a compromise event).

### Excluded
- **Real money flow.** The contract for `payment-confirmed` accepts a signed payload from NoonWeb regardless of whether real money moved on NoonWeb side; the smoke uses test mode markers. If at any point a real Stripe Live charge is required to exercise the path, this iteration STOPS and re-routes through Architecture for a real-money inbound design separate from this spec.
- **Reversal / refund path (Path D, `/api/admin/payments/[id]/refund`).** No charge is made, so no reversal is needed. Path D would only be exercised if Scenario 5 used real-mode Stripe — which is excluded above.
- **Step 7 from B1.3a (seller withdraw via Stripe Connect transfer).** Still blocked by the same constraint as B1.3a — no seller has `stripe_connect_account_id` populated. This is **not part of B1.3b** scope; it remains a follow-up to a future Connect-onboarding iteration.
- **Code changes.** No edit to any handler, route, or library is permitted in this iteration. Findings of contract-vs-code divergence are surfaced as OPEN QUESTIONS for a follow-up iteration, not patched here.
- **Migration changes.** None expected. If a scenario surfaces a missing schema element, the smoke STOPS and reroutes through Audit / Recovery.
- **Sentry / observability instrumentation.** Out of scope per ADR-009 / PR #30 deferral. Evidence comes from `vercel logs` + Supabase SQL Editor + the NoonWeb dev's logs from their side.
- **Webhook event ledger / nonce store for the website-side webhooks (audit B15, §13 of the contract).** v2-deferred per contract §9. The smoke validates v1 idempotency semantics (which rely on external-id stability) — not the v2 replay-nonce model.
- **Version header enforcement (§9 of the contract).** v2-deferred. No header is sent or expected in v1 traffic.
- **NoonWeb-side outbound retry queue (audit B9).** Not in scope of App-side validation. If the smoke surfaces NoonWeb retry behavior, it is logged on the NoonWeb side, not in this evidence.
- **`docs/integrations/cross-repo-webhook-v1.md` contract modifications.** If the smoke surfaces ambiguity, it is recorded as an OPEN QUESTION here; contract amendments happen in a separate cross-repo iteration with simultaneous PRs per §14 (Change control).
- **Updating the B1 parent spec (`specs/fase-1-b1-stripe-live-cutover.md`).** Per CLAUDE.md spec lifecycle rule, specs are not edited after iteration close. B1.3b is its own spec; the relationship to B1 is referenced from this spec only.

---

## Affected Files / Modules

### Files exercised in the smoke (read-only verification — NOT modified)
- `app/api/integrations/website/inbound-proposal/route.ts` — App-side receiver for `inbound-proposal`. Exercised in Scenarios 1, 2, 3, 7 (setup).
- `app/api/integrations/website/payment-confirmed/route.ts` — App-side receiver for `payment-confirmed`. Exercised in Scenarios 5, 6, 7.
- `lib/server/website-integration.ts` — schemas (`websiteInboundProposalPayloadSchema`, `websitePaymentConfirmedPayloadSchema`), handlers (`receiveWebsiteInboundProposal`, `receiveWebsitePaymentConfirmed`), and outbound sender (`sendProposalReviewDecisionToWebsite`). Indirectly exercised by all scenarios.
- `lib/server/website-webhook-auth.ts` — HMAC verify (`verifyWebsiteWebhookSignature`, `readSignedWebsiteJson`) and outbound sign (`signWebsitePayload`). Exercised by every scenario including the three 3a/3b/3c negative paths.
- `app/api/proposals/[proposalId]/review/route.ts` — App-side PM review action. Exercised in Scenario 4. Calls `recordInboundReviewOutcome` + `sendProposalReviewDecisionToWebsite`.
- `app/dashboard/pm-queue/page.tsx` (UI surface used in Scenario 4 to approve from the browser, not the API directly — same flow as B1.3a Scenario 3 but for inbound).
- `lib/server/payments/activation.ts::activatePaidProposal` — invoked indirectly via `receiveWebsitePaymentConfirmed` in Scenario 5. Verifies project activation row creation.

### Files NOT exercised in the smoke (explicitly out of scope)
- `app/api/webhooks/stripe/route.ts` — the Stripe webhook is **not** part of the inbound v1 path (per ADR-010, NoonWeb owns the Stripe Checkout for inbound clients; App receives the result via `payment-confirmed`, not via Stripe webhook). Confirmed in code: `payment-confirmed` handler does not call any Stripe SDK.
- `lib/server/stripe/webhook-events.ts` — Stripe webhook ledger irrelevant for inbound.
- `lib/server/seller-fees/*` — seller fees are an outbound construct per B3; inbound proposals do not have a `seller_fees` row.

### Database surfaces queried for evidence (read-only, via Supabase Dashboard SQL Editor)
- `public.website_inbound_links` — primary idempotency table. Verified at every scenario boundary.
- `public.leads` — lead rows created from inbound. Verified at Scenarios 1, 2, 7 setup.
- `public.lead_proposals` — proposal rows created + state-transitioned. Verified at every scenario.
- `public.payments` — payment row created on `payment-confirmed`. Verified at Scenarios 5, 6, 7.
- `public.projects` — project row created on activation. Verified at Scenarios 5, 6.
- `public.user_profiles` — to look up `admin@noon.app` profile id for the reviewer record (Scenario 4 evidence).

### External systems touched
- Vercel Dashboard / `vercel logs` CLI (operator-side): inspect Production logs for `website.inbound_proposal.*` and `website.payment_confirmed.*` entries during the smoke window.
- Supabase Dashboard SQL Editor (operator-side): execute oracle queries listed above.
- NoonWeb side (`noon-main.vercel.app` + the NoonWeb dev's own observability): the dev fires the signed requests from their side and observes their own receiver logs for the App → Web `proposal-review-decision` round-trip.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `NOON_WEBSITE_WEBHOOK_SECRET` in App-side Vercel Production env | infra | Set 2026-05-18 (pre-flight) | All 6 happy + idempotent scenarios fail 401 from the start; the smoke cannot begin. | Pedro (App ops) |
| `NOON_WEBSITE_WEBHOOK_SECRET` in NoonWeb-side Vercel Production env (same value) | infra | Reported set by NoonWeb dev; not directly verifiable from App side | App→Web outbound (Scenario 4 NoonWeb side) fails 401; the NoonWeb dev cannot generate valid signatures for App receiver scenarios. | NoonWeb dev |
| `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL = https://noon-main.vercel.app/api/integrations/noon-app/proposal-review-decision` in App-side Vercel Production env | infra | Set 2026-05-18 (pre-flight), 401-tested with unsigned curl | Scenario 4 outbound silently skipped (the App handler treats empty URL as "skipped" per `lib/server/website-integration.ts:633-647`); evidence shows `review_webhook_status='skipped'` instead of `'sent'`. | Pedro (App ops) |
| App Production deploy at develop HEAD `f3626d9` (PR #65 Path G merged + G11 fix applied) | infra | Verified Ready 2026-05-18 (pre-flight) | If Production runs an older deploy that pre-dates the inbound integration handlers, every scenario fails. | Pedro (App ops) — system-infra to confirm officially |
| App Production alias `nooncode-app-pi.vercel.app` publicly reachable (no Deployment Protection on this alias) | infra | Verified pre-flight via `curl` returning the app's 401 body (rate-limiter passed + signature guard fired) | NoonWeb dev's signed POST is bounced before signature verification. | Pedro (App ops) |
| NoonWeb dev available 2026-05-18 with signed-request tooling | external | Confirmed by Pedro pre-spec | Smoke stalls. Documented contingency in B1 parent spec §B1.3 "if NoonWeb dev is blocked": run a manual outbound-only seed. That contingency does NOT close B1.3b — only B1.3a-equivalent partial coverage. | NoonWeb dev |
| Supabase Dashboard SQL Editor access for `pdotsdahsrnnsoroxbfe` | data | Verified (Pedro has admin access) | Cannot verify oracles; smoke evidence reduces to logs-only and is not authoritative. | Pedro |
| Supabase MCP (would let Claude run oracle queries directly) | data | NOT loaded in this session per operator note | None — queries are executed by Pedro and pasted into the evidence doc. | Pedro |
| Active admin or PM profile in `user_profiles` for the inbound actor attribution (`resolveIntegrationActorId` in `lib/server/website-integration.ts:155`) | data | Verified (admin@noon.app exists, is_active=true) | Scenario 1 fails with HTTP 503 `INTEGRATION_ACTOR_NOT_FOUND` per contract §3.5. | Pedro (data) |
| Repo flipped PUBLIC temporarily on GitHub | infra | Confirmed (deferred re-flip captured in task #6) | Not load-bearing for the smoke itself (Vercel auto-build does not depend on repo visibility once the deploy is Ready); load-bearing only if a hot-fix rebuild is needed mid-smoke. | Pedro |
| `cross-repo-webhook-v1.md` v1 contract document | contract | Stable, last edit verified | Without the contract, oracles in this spec are arbitrary. The contract is the authoritative reference for every "Oracle" line in scenarios. | Both repos |

---

## Test Data Markers

Test rows MUST be identifiable post-smoke without ambiguity, so cleanup or evidence retrieval cannot accidentally hit production-real data (no production-real inbound rows exist yet — B1.3b is the first inbound — but the discipline matters for the precedent).

- **Test customer email:** `b13b.smoke@nooncode.com` (analogue of B1.3a's `qa.smoke@nooncode.com`).
- **Test customer name:** `B1.3b Smoke Test`.
- **Test customer company:** `B1.3b Test Co`.
- **`external_session_id` markers:** `sess_b13b_smoke_<n>` where `<n>` distinguishes Scenario 1's session vs Scenario 7's setup session (e.g., `sess_b13b_smoke_001` for the happy-path proposal, `sess_b13b_smoke_002` for the premature-payment proposal).
- **`external_proposal_id` markers:** `prop_b13b_smoke_<n>` matching the same numbering.
- **`external_payment_id` markers (Scenarios 5, 6, 7):** `pay_b13b_smoke_<n>` matching the same numbering.
- **Proposal title/body:** prefixed with `B1.3b Smoke — ` for human visibility in the App UI when Pedro approves in Scenario 4.

NoonWeb dev should coordinate to use these markers exactly, so DB queries on the App side can filter cleanly:
```sql
select * from public.website_inbound_links
where external_session_id like 'sess_b13b_smoke_%'
order by created_at desc;
```

---

## Assumptions

- The HMAC secret on both sides of the wire is byte-identical. The smoke will surface a divergence immediately at Scenario 1 (all NoonWeb→App signed requests fail 401) if it is not.
- The deploy currently Ready in Production matches develop HEAD `f3626d9` and includes PR #65 Path G (refund wallet reversal RPC) — this is not exercised by inbound v1 directly but confirms the deploy is current with develop.
- `admin@noon.app` is a valid principal for the PM review action in `/dashboard/pm-queue` (verified in B1.3a Scenario 3: admin acts as PM-proxy because no `pm` role user exists in prod).
- Rate limits (120 req/min per namespace per IP, per contract §7) are not exhausted by the smoke. The smoke does ~10 requests total across all scenarios, far under the limit.
- The NoonWeb-side receiver at `https://noon-main.vercel.app/api/integrations/noon-app/proposal-review-decision` is functionally identical to the contract §5 spec and will return HTTP 2xx on a correctly signed `proposal_review_decision` payload. If it returns non-2xx, App-side state correctly records `review_webhook_status='failed'` and the smoke is partial on Scenario 4.
- The App's `receiveWebsitePaymentConfirmed` handler in production matches the contract §4 spec including the §4.4 precondition (rejects with 409 `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL` when the proposal is not yet approved). Code review in `lib/server/website-integration.ts` for this iteration did not deep-dive into the activation precondition path; the smoke will validate it via Scenario 7.

---

## Open Questions

These items do not block bounded progress (the smoke can run end-to-end without them resolved), but they MUST be tracked because they affect downstream skills' interpretation of evidence.

### Q1 — Test mode vs Real mode for `payment-confirmed`?
**Decision recorded here: test mode.** The contract §4 accepts a signed `payment-confirmed` payload from NoonWeb regardless of whether a real Stripe charge backed it. For the smoke, NoonWeb dev fires a signed payload with a test `external_payment_id` (e.g., `pay_b13b_smoke_001`) — no real money moves. This avoids needing Path D reversal post-smoke and avoids the operator-without-Stripe-Dashboard-access issue that DEFERRED Scenario 9 in B1.3a. If at any point the smoke needs to verify real-money inbound path behavior, that is a SEPARATE iteration after B1.5.

### Q2 — Contract §2.3 "MUST reject 401 if timestamp missing" vs code allowing missing timestamp
**Divergence detected during code review.** `lib/server/website-webhook-auth.ts:30-32`:
```ts
function assertRecentTimestamp(timestamp: string | null) {
  if (!timestamp) return
  ...
}
```
The function early-returns when timestamp is null, meaning a request with `x-noon-signature` present **but no `x-noon-timestamp` header** is currently allowed if the signature matches `bodyText` alone (the `signedPayload` in `verifyWebsiteWebhookSignature:65` becomes just `bodyText` when timestamp is null). Contract §2.3 step 2 explicitly states "Verify `x-noon-timestamp` is within ±5 minutes" — implicit requirement that the header MUST be present.

**Impact on smoke:** Scenario 3 covers missing-signature and stale-timestamp explicitly. **It does not currently cover "missing timestamp header but valid signature against raw body"** — and the code would currently accept that. **Decision for this iteration:** add Scenario 3d **OPTIONAL** to surface this divergence in evidence. If NoonWeb dev's tooling is configured for a signed-with-timestamp model only, 3d can be skipped without blocking COMPLETE. The divergence itself is registered as a follow-up — either the contract needs to clarify "MUST reject if timestamp missing" explicitly and the code patched accordingly, OR the contract is amended to allow timestamp-less signatures (not recommended, as it removes replay-window protection for the `bodyText`-only signature).

### Q3 — Idempotency of duplicate `external_session_id` with **different** payloads (§3.3 "behavior change")
The contract §3.3 says: "if the existing link is in `proposal_pending_review` or `proposal_changes_requested` state, the lead and proposal records are updated with the new snapshot." Scenario 2 uses the **same payload** for the idempotent retry. Whether the smoke should also exercise **same external_session_id with a different proposal body/amount** to verify the snapshot-update behavior is open.

**Decision for this iteration:** out of scope. The smoke validates the v1 contract idempotency at the level of "same payload retry returns 200 same ids." The "snapshot-update on state-matched retry" behavior is a refinement that does not affect the success criterion. If the smoke runs faster than expected, the operator MAY exercise it manually as a stretch goal and record the outcome under "Observations" in the evidence doc — but it is not required for COMPLETE.

### Q4 — Inbound wallet/earnings behavior in `activatePaidProposal`
The contract §4 does not specify whether inbound activation should credit any wallet or earnings ledger. The B3 seller-fees state machine explicitly excludes inbound (no `seller_fees` row created for inbound proposals). The FASE 3 earnings lifecycle (per `project.context.core.md` Active risks) is not yet implemented. The current code in `lib/server/payments/activation.ts::activatePaidProposal` is shared between outbound and inbound paths (per the file's role in B1.3a Scenario 7), but in B1.3a the smoke had `lead_origin='outbound'`, so the wallet/earnings path was exercised under outbound semantics.

**Open:** what should `wallet_ledger_entries` and `earnings_ledger` look like after Scenario 5 completes for an `lead_origin='inbound'` proposal? The expected answer per ADR-010 / B3 contract is **zero rows in `seller_fees`** and **zero rows in `wallet_ledger_entries` / `earnings_ledger` referencing this proposal** (because inbound earnings are owned by a future FASE 3 lifecycle, not by activation). The smoke RECORDS the actual behavior — if rows are created, that is itself a finding registered for follow-up. If no rows are created, that is the expected v1 behavior and is captured as the oracle.

This Q4 is the most likely place for the smoke to surface a real divergence; system-testing and system-docs will need to be prepared to record it.

### Q5 — How to confirm NoonWeb-side receipt of Scenario 4 outbound without direct NoonWeb log access?
The App-side oracle (`review_webhook_status='sent'`, response HTTP 2xx recorded) is necessary but not sufficient — a 2xx from NoonWeb proves the request reached NoonWeb and NoonWeb returned an OK, but does not prove NoonWeb actually processed it correctly into their client portal state.

**Decision:** NoonWeb dev provides verbal/log confirmation during the smoke window. If NoonWeb dev cannot share log access in the moment, App-side evidence stands as the only oracle, and the NoonWeb-side correctness is reported by the NoonWeb dev's word. This is acceptable for v1 because it is the cross-repo trust model in production today.

### Q6 — Rate-limiter behavior under the smoke (1 IP, ~10 requests)
The two App-side inbound endpoints have a 120 req/min limit per namespace per IP (contract §7, code `lib/server/api/rate-limit.ts`). The smoke fires far fewer than 120 requests, so no 429 is expected from NoonWeb's side. **No scenario explicitly exercises the 429 path.** If desired, that could be a stretch goal — but it is not required for COMPLETE per the router's 9 closure criteria.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| HMAC secret diverges between repos | Low | High | High | Scenario 1 fails immediately; smoke stops; operator + NoonWeb dev re-verify the `NOON_WEBSITE_WEBHOOK_SECRET` value on both sides character-by-character. No data corruption possible (handler rejects 401 before parsing). |
| NoonWeb dev unavailable mid-smoke | Medium | Medium | Medium | Smoke is partial; scenarios already executed remain valid evidence; the iteration closes PARTIAL with explicit list of unrun scenarios; B1.5 sign-off remains blocked until B1.3b reconvenes. |
| Production deploy stale / not matching develop HEAD | Low | High | High | system-infra pre-flight confirmation step explicitly validates `curl https://nooncode-app-pi.vercel.app/api/webhooks/stripe` headers + a known-shape response unique to the develop HEAD code. Already verified in pre-flight 2026-05-18. |
| `admin@noon.app` not active or PM-queue UI broken | Low | Medium | Medium | Direct API call `POST /api/proposals/{id}/review` with `action: 'approve'` is the documented fallback (used in B1.3a Scenario 3 fallback SQL). |
| Test data pollution of production DB | Low (Low impact because the rows are markered) | Low | Low | Test markers (`b13b.smoke@nooncode.com`, `sess_b13b_smoke_*`) make the rows identifiable; cleanup optional per the operator's call. Evidence doc captures the row ids so they can be deleted later if desired. |
| Contract-vs-code divergence on receiver (e.g., Q2 timestamp issue) surfaces during the smoke | Medium | Medium | Medium | Surfaced findings are registered in the evidence doc as Observations + OPEN QUESTIONS; system-docs lands them in `project.context.core.md` Active risks; a follow-up iteration patches either contract or code. The smoke does not fix divergences — that is the next iteration. |
| Repo accidentally stays PUBLIC post-smoke | Low | Medium | Medium | Task #6 already tracks the re-flip explicitly; system-validator checks task #6 status as part of the COMPLETE gate (or accepts PARTIAL if re-flip is deferred to a follow-up). |
| Rate-limiter wrongly fires during normal smoke pacing | Very Low | Low | Low | 10 requests vs 120 req/min cap is two orders of magnitude under. Skip mitigation. |
| Activation creates unexpected wallet/earnings rows for inbound (Q4) | Medium | Low (smoke just records, does not corrupt) | Low | Evidence doc records the actual behavior; system-docs registers as Observation; follow-up iteration scopes the FASE 3 inbound earnings lifecycle as a separate spec. |
| `paid_at` reflects `session.created` instead of actual payment time (B1.3a Observation #1 carried forward) | Medium | Low | Low | Already registered as a known follow-up from B1.3a closure; if it manifests in inbound too, that is consistent and adds urgency to the fix, not blocking B1.3b. |
| NoonWeb-side dev fires a malformed payload that surfaces a real bug in the receiver | Medium | Medium | Medium | The negative-path scenarios (3a/3b/3c) are designed to surface receiver bugs deliberately. Unexpected bugs in happy-path scenarios are captured as findings; the smoke pauses and the operator + NoonWeb dev triage. |
| Evidence capture leaks secrets (e.g., HMAC secret value, internal user emails beyond the test marker) | Low | High | High | Evidence doc is a `docs/validations/*.md` file in a public repo; secrets are NEVER pasted (only headers, statuses, ids). The HMAC secret value is never quoted — only its presence in env. system-security reviews the evidence-capture structure before the smoke runs. |

---

## Chunking Decision

**Single iteration, not chunked.** The 8 scenarios are tightly coupled (Scenario 5 depends on Scenario 4 which depends on Scenario 1; Scenario 6 depends on Scenario 5; Scenario 7 has its own setup but uses the same infra and the same smoke window). Splitting them across iterations would force re-running cross-repo coordination twice, which costs more than it saves. The 8 scenarios in one window is the smallest correct unit.

The downstream skill chain (Infra → Security → Execution Gate → Testing → Docs → Validator) is sequential and follows the router's prescription. Each downstream skill is its own session bounded by its own scope; system-analysis (this spec) is the input artifact for all of them.

---

## Recommended Testing Methodology

**Integration-first (cross-repo).** Justification: the unit-level HMAC sign/verify is already covered by `tests/server/website-webhook-auth.test.ts` and `tests/server/website-integration.test.ts` (the 231/231 test suite from B1.4 closure). What B1.3b validates is **integration against live infra across two repos** — there is no isolated unit to TDD/BDD against here, and any CDD-style "contract-as-test" would simply re-derive the v1 contract document. The methodology is "execute against production according to the contract; capture observed behavior; verdict per scenario." This matches the B1.3a precedent exactly.

---

## Recommended Route Depth

**Full.** Justified above in `### ROUTER DECISION`. Lite would skip the negative-path scenarios and the activation-precondition scenario, which are essential to validate the contract's auth + state-machine guards, not just the happy path.

---

## Success Criterion

B1.3b is **COMPLETE** when **all 9** of the following hold (mapped from the router's prescribed closure criteria; no inventions):

1. **Scenario 1 PASS** — `inbound-proposal` happy path returns 201, creates the expected rows in `website_inbound_links` + `leads` + `lead_proposals`, and the response body matches §3.4 of the contract.
2. **Scenario 2 PASS** — `inbound-proposal` idempotent retry returns 200 with `idempotent: true` and no new rows created (snapshot update on existing rows is acceptable per §3.3).
3. **Scenario 3 PASS** — all three negative-path sub-scenarios (3a missing signature, 3b tampered signature, 3c stale timestamp) return 401 with `WEBSITE_WEBHOOK_AUTH_FAILED` per §6 error shape. (Scenario 3d "missing timestamp" is OPTIONAL per Q2.)
4. **Scenario 4 PASS** — App-side PM review action transitions the proposal to `approved`, App-side outbound state records `review_webhook_status='sent'`, and the NoonWeb dev confirms receipt of the signed `proposal_review_decision` payload on their side per §5.
5. **Scenario 5 PASS** — `payment-confirmed` happy path returns 201, creates `payments` + `projects` rows, transitions `lead_proposals.payment_status='succeeded'`, and the response body matches §4.5. Wallet/earnings behavior for inbound is RECORDED per Q4 (whatever it is, it is captured as the oracle going forward).
6. **Scenario 6 PASS** — `payment-confirmed` idempotent retry returns 200 with `idempotent: true` and no duplicate rows anywhere per §4.3.
7. **Scenario 7 PASS** — `payment-confirmed` against a non-approved proposal returns 409 with `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL` per §4.4, and no payment/project row is created.
8. **Evidence captured** — `docs/validations/B1.3b inbound smoke 2026-05-18.md` exists with per-scenario verdicts (PASS/FAIL/DEFERRED), verbatim SQL outputs as oracles, Vercel log excerpts (redacted of any secret values), and NoonWeb dev's confirmation note for Scenario 4. Findings and Observations registered (especially any divergence under Q2 or Q4).
9. **`project.context.core.md` updated** — Closed-in-runtime block adds a B1.3b entry mirroring the structure of the B1.3a closure entry; Active risks updated if Q2 or Q4 surfaced a real divergence; roadmap §6 B1 status moved to "B1.3b closed; remaining: B1.5 pilot sign-off."

If any of (1)-(7) is FAIL: B1.3b is **BLOCKED**. The smoke stops, the failure is triaged, and a follow-up iteration is opened to fix the underlying issue before the smoke is re-attempted.

If a scenario is DEFERRED for an operational reason (e.g., NoonWeb dev becomes unavailable mid-window): B1.3b is **PARTIAL**. The unrun scenarios are explicitly listed; B1.5 pilot sign-off remains blocked on completing the remainder.

If all 7 scenarios PASS but evidence (criterion 8) or context update (criterion 9) is missing: B1.3b is **PARTIAL** until the documentation lands. system-validator does not return COMPLETE without 8 and 9.

---

## Definition of Done

- All 9 success criteria above satisfied.
- Repo re-flipped to PRIVATE (task #6) before validator gate, OR explicitly deferred with an updated risk entry in `project.context.core.md` Active risks.
- No code, no migration, and no contract document modified in this iteration. Any divergences are tracked as follow-ups.
- system-validator returns COMPLETE.

---

## Notes for downstream skills

### For system-infra (next in chain)
Confirm the 5 infrastructure dependencies in the table above are all satisfied. Specifically verify, in this order:
1. `NOON_WEBSITE_WEBHOOK_SECRET` present in App-side Vercel Production env (presence, not value).
2. `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` present + reachable via `curl -X POST ... -H "content-type: application/json" -d '{}'` returning 401 (unsigned rejection — sanity that the NoonWeb side validates per §2).
3. Production deploy = develop HEAD `f3626d9`, Ready, accepting traffic — verify via `curl -X POST https://nooncode-app-pi.vercel.app/api/integrations/website/inbound-proposal` returning 401 from the App's HMAC guard (not a 4xx/5xx from Vercel Deployment Protection).
4. `admin@noon.app` is `is_active=true` in `user_profiles` (single SQL row check).
5. Rate-limiter pre-flight: confirm Upstash Redis still serving via the pre-existing B14 verification mechanism (no specific action; verify last `rate_limit.upstash.fallback` warn log was N hours ago, not seconds).

### For system-security (after infra)
Review the evidence-capture structure in `docs/validations/B1.3b inbound smoke 2026-05-18.md` for **secret hygiene** before the smoke runs. Specifically:
- No HMAC secret value pasted (only env-var presence).
- No internal user emails beyond the test markers (`admin@noon.app` is acceptable to surface as the reviewer because it is operationally documented in B1.3a evidence already; no other emails).
- No Stripe live keys or webhook secrets (Stripe is irrelevant for inbound v1; no risk surface).
- No `requestId` values that would leak internal log structure unless redacted per the existing logger convention.

Also verify the HMAC implementation review against contract §2:
- Timing-safe equals in use (`crypto.timingSafeEqual` per `lib/server/website-webhook-auth.ts:44-53`). ✓ already confirmed at code review.
- Raw body read before JSON parse (per `readSignedWebsiteJson:77`). ✓ confirmed.
- Q2 timestamp-missing divergence: flag as security follow-up, severity Medium (limited risk because the smoke does not exploit it; full-impact analysis is a separate task).

### For system-testing (after Execution Gate)
Structure the evidence doc using the B1.3a precedent (`docs/validations/B1.3a outbound smoke 2026-05-16.md`):
- Top metadata block (Iteration, Spec ref, Scope, Environment).
- Pre-flight evidence section.
- Per-scenario "Steps + Verification SQL + Result + Verdict" repeated for each of the 8 scenarios.
- Summary table at the bottom.
- Observations + follow-ups section.
- Closure block dated 2026-05-18 with per-criterion (1-9) mapping to scenarios.

### For system-docs (after testing)
- Append a single Closed-in-runtime entry to `project.context.core.md` (do NOT include R-codes / Sprint numbers / plan-IDs per the user's MEMORY rule).
- Append Active risks entries for any divergences surfaced (Q2 and/or Q4 if they materialize).
- Append a session note to `project.context.history.md`.
- Update `C:\Users\pbu50\Desktop\Noon App\roadmap\NoonApp Roadmap.md` §6 + §11 + §17 to reflect B1.3b closure (per the user's MEMORY rule to keep roadmap in sync, while keeping context.core.md free of plan IDs).

### For system-validator (final gate)
- Verify 9 success criteria satisfied.
- Verify scope match (no surprises beyond `## Scope Boundary §Included`).
- Verify conflict-free outputs from infra / security / testing / docs.
- Verify `project.context.core.md` is updated.
- Verify task #6 (re-flip PRIVATE) status — accept either DONE or explicit DEFER with risk register entry.

---

## Reference: closure criteria from the router (verbatim mapping)

The router prescribed 9 closure criteria; this spec maps them 1:1 to the success criteria above. For audit trail:

| Router criterion (paraphrased from handoff) | Spec criterion # |
|---|---|
| inbound-proposal §3 happy path | 1 |
| inbound-proposal §3 idempotent retry | 2 |
| inbound-proposal §2 / §6 / §8 negative paths | 3 |
| App-side PM review triggers outbound App→Web §5 | 4 |
| payment-confirmed §4 happy path | 5 |
| payment-confirmed §4 idempotent retry | 6 |
| payment-confirmed §4.4 activation precondition | 7 |
| Evidence captured into `docs/validations/B1.3b inbound smoke 2026-05-18.md` | 8 |
| `project.context.core.md` updated | 9 |

No criterion is invented in this spec.
