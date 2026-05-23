# spec.md — fase-3-r4-inbound-earnings-auto-credit

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-23
- Session ID: fase-3-r4-inbound-earnings-auto-credit
- Developer: Pedro (`noondevelop@gmail.com`)
- Main active skill: `system-analysis` (this spec); downstream `system-architecture → system-backend → system-refactor → system-testing → system-security → system-docs → system-validator`
- Router mode: **Refactor-with-feature-extension** (not Bugfix — the inbound flow never had this logic; we are extending the earnings domain to a new entry-point AND extracting shared logic)
- Depth: FULL

### ARCHITECTURAL CONSTRAINT ANCHOR (load-bearing, do not violate)
- **The client portal lives in NoonWeb (`noon-web-main`), not in App-nooncode.** This decision is firmed in **ADR-010** and reinforced as operating context.
- **All client-facing experience — before and after payment — lives in NoonWeb.** App-nooncode is the internal colaborador workspace.
- **In this iteration**: the client pays in NoonWeb (NoonWeb's Stripe Checkout, NoonWeb's UI). NoonWeb then sends a server-to-server webhook to App (`POST /api/integrations/website/payment-confirmed`, HMAC-signed). App receives the webhook → activates the project → (NEW) auto-credits the developer + noon shares to their internal wallets. **The client never interacts with any App surface; the earnings credited are 100% internal to colaboradores (developer + noon).**
- **No client-visible UI, no client-callable endpoint, no client portal change** is introduced. Any work that would touch a client-facing surface is OUT OF SCOPE by ADR-010, even if technically related to earnings.

### OBJECTIVE
- What must be achieved in this session: produce the bounded spec for the inbound earnings auto-credit iteration. The Stripe webhook handler at `app/api/webhooks/stripe/route.ts:184-279` already auto-credits all earnings shares (seller / developer / noon) post-`activatePaidProposal` for outbound payments — verified E2E in B1.3a smoke 2026-05-17 with $1 USD real. The inbound counterpart `lib/server/website-integration.ts::receiveWebsitePaymentConfirmed` (lines 475-559) only activates the project and **never credits developer or noon shares for inbound payments from NoonWeb**. The two webhooks should behave symmetrically for developer/noon allocation (inbound has no seller fee row by design, so the seller share is correctly absent there). This iteration closes that gap by extracting the allocation+credit logic to a shared service and wiring it into both call sites.
- Why this work matters now: roadmap §6 Bloque A declares "FASE 3 lifecycle propuesta: trigger automatico de earnings al confirmar pago — el cierre natural de FASE 2 ya validada (2-3d)". `docs/context/project.context.core.md` line 366 declares "Pending: FASE 3 — Propuesta con lifecycle". The B1.3b inbound smoke (2026-05-18, 8/10 PASS) shipped the inbound payment path without earnings allocation; any real inbound customer payment from NoonWeb today silently fails to credit developer + noon — operationally a money-allocation bug invisible to UX. This iteration is also the natural pre-requisite for any "external customer exposure" milestone where inbound traffic becomes the primary money path.
- It is NOT a "comprehensive earnings audit". Per operator decision (2026-05-23): minimal scope, close the specific gap, leave `POST /api/admin/earnings/credit` as escape hatch, do not touch refund logic, do not auto-trigger earnings on lead status → won (intentional — system is payment-event-driven per ADR-007).

### CONTEXT USED
- `project.context.core.md` reviewed: yes — line 366 "Pending: FASE 3" + line 367 (B3 seller-fee state machine context) + the FASE 2 earnings closure narrative (line 365).
- `project.context.full.md` reviewed: no — Architecture will read it when designing the contract. Analysis works from the gap discovery (already done) + the operator's minimal-scope decision.
- `project.context.history.md` reviewed: no — no historical decisions are being revisited.
- ADR-007 reviewed: yes — establishes payment-event-driven semantics for `seller_fees` state machine; reinforces the decision to NOT trigger earnings on lead-status-won.
- ADR-010 reviewed: yes — establishes that inbound payments are owned by NoonWeb; the `payment-confirmed` webhook is the canonical inbound entry-point.
- ADR-015 reviewed: yes — refund + consolidation atomic patterns; the new shared service must follow the same idempotency discipline (idempotency-key in `wallet_ledger_entries`).

### ROUTER DECISION
- Why this mode is correct: `Refactor-with-feature-extension`. Router's distinction: Bugfix implies restoring broken behavior; here the inbound flow never had the allocation logic — we are extending the earnings domain to a new entry-point AND extracting shared logic. The success criterion is measured against new contracts (idempotency in inbound, documented inbound allocation policy), not against regression of something previously working.
- Why this depth is correct: FULL. Touches payments + `wallet_accounts` + `earnings_ledger` (sensitive surfaces). Introduces new internal service contract (`creditActivationEarnings`) reused by two call-sites with diverging `base` calculations. Introduces new idempotency-key strategy for inbound — without this, double-credit risk is real under webhook retry. Security is MANDATORY per memory rule (auth/payments/wallet touched).
- Why this skill is the right active skill now: 4 risks pre-identified by router (allocation asymmetry as policy / `developerUserId` nullable / idempotency-key source / points policy) must be either resolved with hard facts or surfaced as Open Questions with defaults before Architecture commits the contract.
- Reroute already known at start: no.

### SCOPE
- In scope: see `## Scope Boundary`.
- Explicitly out of scope: see `## Scope Boundary`.
- Success criterion: see `## Success Criterion`.

### INPUTS
- Files/modules involved: see `## Affected Files / Modules`. Hot spots confirmed by discovery:
  - `app/api/webhooks/stripe/route.ts:184-279` — inline allocation+credit logic to extract (the source of the shared service).
  - `app/api/webhooks/stripe/route.ts:23-56` — `creditWalletBucket` local helper (wraps Postgres RPC `credit_wallet_bucket`); Architecture must decide whether to keep the helper local-and-re-import, move it into the shared service, or have the service take the RPC dependency directly.
  - `lib/server/website-integration.ts:475-559` — `receiveWebsitePaymentConfirmed` to wire (insert `creditActivationEarnings(...)` after the existing `activatePaidProposal` call, before the `website_inbound_links` update).
  - `lib/server/website-integration.ts:66-87` — `websitePaymentConfirmedPayloadSchema` (HARD FACT verified during discovery: `external_payment_id: z.string().trim().min(1)` is REQUIRED — Risk #3 is resolved, no fallback idempotency key needed).
  - `lib/server/payments/activation.ts` — `activatePaidProposal` returns `{ payment_id, proposal_id, lead_id, project_id, activated_now, payment_was_already_succeeded }` (all IDs the new service needs).
- Contracts or architecture inputs available:
  - ADR-007 (seller-fee state machine) — must not be modified; `confirmSellerFee` remains called only from Stripe webhook for outbound.
  - ADR-010 (cross-repo cutoff: inbound owned by NoonWeb) — must not be modified; webhook signature/payload of `payment-confirmed` (NoonWeb side) stays unchanged.
  - ADR-015 (earnings consolidation atomic RPC + refund-after-consolidation gap) — sets the idempotency discipline pattern that this iteration must follow.
- Relevant handoffs received:
  - Router handoff 2026-05-23 (this session): Refactor-with-feature-extension / FULL / single iteration / chain `analysis → architecture → backend → refactor → testing → security → docs → validator` / ADR mandatory (3 packed decisions) / security mandatory / browser live-Stripe smoke deferred to operator post-merge.
  - Operator scope confirmation 2026-05-23: minimal scope (this iteration) + retain admin manual endpoint as escape hatch.
- External dependencies or environment assumptions: none. The Postgres RPC `credit_wallet_bucket` already exists (migration 0050 area). No new migrations expected (Architecture confirms).

### RISK SNAPSHOT
- Known risks before starting: see `## Risks`.
- Known blockers before starting: none.
- Known assumptions before starting: see `## Assumptions`.

### CONTINUITY NOTES
- Previous session relevant to this one:
  - **G21 mobile responsive fix** (PR #100 merged 2026-05-23, PR #101 post-merge sync) — last iteration; closed COMPLETE. Unrelated to this iteration but sets the cadence (this is the next iteration on develop's tail).
  - **B1.3a outbound smoke 2026-05-17** — proved the outbound earnings allocation logic works E2E (the same logic this iteration extracts). The shape of `earningRows` + the `creditWalletBucket` per-row loop + the `confirmSellerFee` call are the verified-working reference.
  - **B1.3b inbound smoke 2026-05-18** — proved the inbound webhook + activation path works, but did NOT verify earnings (8/10 PASS, the missing 2 likely earnings-related — this iteration is the structural fix that would have made them pass).
- Expected next skill after this session if all goes well: `system-architecture` with the handoff payload below. Architecture must produce **ADR-021** (next available — ADR-018/019/020 are taken by R5 resolution / GDPR / dashboard summary) packing 3 decisions: (a) extraction of `creditActivationEarnings` as shared service; (b) idempotency-key strategy for inbound (`website:${external_payment_id}` is the analyst-recommended default, supported by the schema-required guarantee); (c) inbound earnings allocation policy (no seller deduction, no seller share, no points, developer + noon 50/50 over full `activationAmount`).

---

## Task Summary

Extract the inline allocation+credit logic currently embedded in `app/api/webhooks/stripe/route.ts` (the loop at lines 184-279 that builds `earningRows`, upserts `earnings_ledger`, and calls `creditWalletBucket` per actor) into a new shared service `lib/server/earnings/activation-credit.ts`. Refactor the Stripe webhook to consume the shared service (behavior identical — pure mechanical refactor preserving outbound semantics). Then wire the new service into `lib/server/website-integration.ts::receiveWebsitePaymentConfirmed` so inbound payments from NoonWeb auto-credit the same earnings shares developer + noon would receive in outbound (sans seller share, since inbound has no seller_fees row by design and `sellerId=null`).

The iteration is structurally three steps that **must** ship as one PR (router-locked single iteration):

| # | Step | Type | Owner skill |
|---|---|---|---|
| 1 | Create `creditActivationEarnings(...)` service with full contract + unit tests | feature extension | backend |
| 2 | Refactor Stripe webhook to call the service (zero behavior change — diff must be mechanical) | refactor preserving behavior | refactor |
| 3 | Wire `receiveWebsitePaymentConfirmed` to call the service for inbound (with leadOrigin='inbound', sellerFeeAmount=0, sellerId=null) | new behavior | backend |

Testing splits cleanly into regression (Stripe outbound unchanged) and new-behavior (inbound credits developer + noon). Security MANDATORY because new write-path to `earnings_ledger` is exposed from an endpoint that receives external input (HMAC-signed by NoonWeb, but new entry-point into the money domain).

---

## Scope Boundary

### In scope
- **Net-new file `lib/server/earnings/activation-credit.ts`** exporting `creditActivationEarnings(client, params)` with a typed input contract Architecture will define. The contract MUST express:
  - `leadOrigin: 'inbound' | 'outbound'` (drives the `base` calculation: outbound subtracts `sellerFeeAmount`, inbound uses full `activationAmount`).
  - `idempotencyKeyBase: string` (caller provides, must be unique per payment event; outbound passes `stripe:${session.id}`, inbound passes `website:${external_payment_id}`).
  - `sellerId: string | null` — null for inbound, also null-safe for outbound edge cases where a lead has no `assigned_to` and no `created_by`.
  - `developerUserId: string | null` — null when project has no developer assigned (common for inbound at payment time).
  - `sellerFeeAmount: number` — outbound passes the persisted `seller_fees.amount`, inbound passes 0.
  - `activationAmount: number`, `paymentId: string`, `proposalId: string`, `leadId: string`, plus `currency` and `createdAt` for traceability.
- **Refactor `app/api/webhooks/stripe/route.ts:184-279`** to call the new service. The 95-line block becomes a single call. The seller-fee lookup (`getSellerFeeByProposalId`) + the seller-share allocation + the `confirmSellerFee` transition + the points award **stay** in the Stripe webhook handler (they are outbound-specific). Only the developer-share + noon-share + ledger-upsert + wallet-credit loop moves into the service.
- **Wire `lib/server/website-integration.ts::receiveWebsitePaymentConfirmed`** to call the new service. The call site is between the existing `activatePaidProposal(...)` (line 526) and the `website_inbound_links` update (line 539). The new code does NOT change the function's return shape — the caller route handler keeps the existing response contract.
- **Unit tests** for `creditActivationEarnings`: at minimum outbound-with-seller-fee, inbound-with-null-developer, idempotency-key collision rejection.
- **Integration regression** for the Stripe webhook (existing mock-based suite at `tests/server/api/webhooks/stripe-checkout-completed.test.ts`) — must continue to produce identical `earnings_ledger` + `wallet_ledger_entries` shape per call.
- **Integration new-behavior** for the inbound webhook — new test exercising `POST /api/integrations/website/payment-confirmed` with mocked admin client, verifying developer + noon credits land in `wallet_ledger_entries` with the right idempotency-key namespace (`website:...` not `stripe:...`).
- **ADR-021** (Architecture) packing the 3 decisions per router handoff.
- **Docs**: update `project.context.core.md` line 366 (remove "Pending FASE 3" wording), `project.context.full.md` earnings flow section to reflect dual symmetric entry-points, roadmap §6 Bloque A "FASE 3 lifecycle propuesta" item closure (per `feedback_keep_roadmap_in_sync` memory rule).

### Explicitly out of scope (this iteration only)
- **Anything client-facing — UI, route, endpoint, portal surface.** Per ARCHITECTURAL CONSTRAINT ANCHOR + ADR-010: client experience (pre and post payment) lives in NoonWeb. If implementation discovers that closing the gap requires a client-facing change (it does not), the iteration BLOCKS and reroutes to a cross-repo NoonWeb conversation. No `/client/[token]` work, no `/portal/*` work, no new client-callable endpoint, no email-to-client trigger.
- **`app/api/admin/earnings/credit/route.ts`** + `lib/server/earnings/admin.ts::creditEarnings` — the admin manual endpoint **STAYS** as operator-confirmed escape hatch for edge cases (off-Stripe / off-NoonWeb payments, manual adjustments). Not touched.
- **Refund logic** — `debit_wallet_for_refund` RPC + `lib/server/earnings/refund-service.ts` + the Stripe `charge.refunded` handler stay as-is. Refund-then-recredit semantics are an ADR-015 concern, not this iteration.
- **Consolidate cron** — `/api/cron/consolidate-earnings` + `consolidate_payment_earnings` RPC stay as-is. The new service only writes to `pending` bucket; consolidation cron handles `pending → available_to_withdraw` as before.
- **`seller_fees` state machine** — `confirmSellerFee` / `cancelSellerFee` semantics unchanged. The new service does NOT call them (those stay in the Stripe webhook for outbound, by design).
- **Lead/proposal `won` status without payment** — intentionally NOT a trigger. ADR-007 confirms payment-event-driven model; this iteration does NOT introduce a `status=won → earnings` path. Out of scope by operator decision.
- **Cross-repo contracts** — `websitePaymentConfirmedPayloadSchema` shape (the wire contract NoonWeb sends) is NOT modified. Only what App does post-receipt changes.
- **Stripe webhook event ledger** — `stripe_webhook_events` table + `beginStripeWebhookEvent` discipline stays. New inbound credit path does NOT introduce a parallel ledger (it uses the existing `website_webhook_events` for transport-level idempotency per ADR-016 — already in place upstream of `receiveWebsitePaymentConfirmed`).
- **Points policy expansion to inbound** — see Open Question Q4. Default is "no points awarded in inbound" (consistent with current "only seller gets points" rule when `sellerId=null`). If operator wants developer-points-in-inbound, that's a separate iteration.
- **UI changes** — no frontend surface is modified. `/dashboard/earnings` already reads from `wallet_accounts`; once inbound credits land, it will show them automatically.
- **Migration** — no schema change. The new service uses the existing `credit_wallet_bucket` RPC + the existing `earnings_ledger` table.

---

## Acceptance Criteria

Each criterion is verifiable from test output, code review, or post-merge log inspection.

1. **Service exists with documented contract**. `lib/server/earnings/activation-credit.ts` exports `creditActivationEarnings(client, params)`. The input type is exported and documented. The function returns a structured result (Architecture decides shape — at minimum `{ earningsLedgerRowIds: string[], walletLedgerEntryIds: string[] }` or equivalent for testability).
2. **Stripe webhook behavior unchanged**. Existing `tests/server/api/webhooks/stripe-checkout-completed.test.ts` suite passes with zero modifications (no expected-output edits). The diff in `app/api/webhooks/stripe/route.ts` shows the inline allocation+credit loop replaced by a single call to the new service; the seller-share-specific code stays.
3. **Inbound webhook credits developer + noon**. New integration test exercises `POST /api/integrations/website/payment-confirmed` with mocked admin client + a payload that includes `external_payment_id`. After the call, `wallet_ledger_entries` has new rows for the developer (50% of `activationAmount`) and noon (50% of `activationAmount`), both with `entry_type='earnings_distribution'`, `balance_bucket='pending'`, `reference_type='payment'`, and `idempotency_key` starting with `website:`.
4. **No seller credit for inbound**. The same integration test verifies that NO row is inserted for a `seller` actor (because `sellerId=null` in inbound).
5. **Idempotency under retry**. The same integration test calls the inbound webhook twice with the same `external_payment_id`. The second call MUST NOT produce duplicate earnings_ledger or wallet_ledger_entries rows (existing `website_webhook_events` ledger handles the transport-level dedupe; the new service must additionally pass a deterministic `idempotency_key` to `credit_wallet_bucket` so even if the transport ledger is bypassed in some edge case, the wallet RPC's own unique constraint catches it).
6. **`developerUserId=null` boundary**. New integration test exercises the inbound path with a payload whose project has no developer assigned at payment time. Expected: noon share is credited; developer share is either skipped or credited to a sentinel (Architecture decides per Open Question Q2). Whichever policy is chosen, the test asserts it explicitly.
7. **`confirmSellerFee` not called in inbound**. Diff inspection + new integration test confirms `confirmSellerFee` is invoked only when `leadOrigin='outbound'`. No `seller_fees.state` row transitions occur as a side effect of inbound payment.
8. **All existing tests pass**. 487+/487+ (the 487 baseline + any new tests added by this iteration). `npx tsc --noEmit` filtered for in-scope files: 0 errors. `npx eslint` on modified files: 0 issues.
9. **No out-of-scope diff drift**. `git diff` shows changes only in: the new file, the Stripe webhook handler, `lib/server/website-integration.ts`, the new test files. Files in the explicit out-of-scope list (admin endpoint, refund service, consolidate cron, seller-fees service, RPC migrations, UI components, cross-repo schema) untouched.
10. **ADR-021 landed** at `docs/adrs/ADR-021-<slug>.md` covering the 3 decisions (extraction shape, inbound idempotency-key strategy, inbound allocation policy).

---

## Affected Files / Modules

Best-effort map. Backend may discover additional files; if so, MUST justify each addition in the PR description against the out-of-scope list.

| Path | Why | Confidence |
|---|---|---|
| `lib/server/earnings/activation-credit.ts` | NEW — the shared service | High |
| `app/api/webhooks/stripe/route.ts` | Refactor: replace inline loop (lines 184-279) with service call. Keep seller-fee lookup, seller-share row, `confirmSellerFee` call, points award (all outbound-specific). | High |
| `lib/server/website-integration.ts` | Wire `creditActivationEarnings` into `receiveWebsitePaymentConfirmed` (lines 475-559). Need to resolve `developerUserId` from `activation.project_id` before calling the service. | High |
| `tests/server/earnings/activation-credit.test.ts` | NEW — unit tests for the service | High |
| `tests/server/api/webhooks/stripe-checkout-completed.test.ts` | Existing — must continue passing unchanged (regression target) | High |
| `tests/server/api/integrations/website/payment-confirmed.test.ts` | Existing OR NEW — new-behavior integration test for inbound earnings (verify path exists first; if not, create) | Medium |
| `docs/adrs/ADR-021-<slug>.md` | NEW — Architecture deliverable | High |
| `docs/context/project.context.core.md` | Update line 366 ("Pending FASE 3") + add Closed-in-runtime entry | High |
| `docs/context/project.context.full.md` | Update earnings flow section to reflect dual symmetric entry-points | Medium |
| `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` | Close §6 Bloque A "FASE 3 lifecycle propuesta" item (per memory `feedback_keep_roadmap_in_sync`) | High |

**Files explicitly NOT touched** (any change here is a scope violation per router lock):
- `app/api/admin/earnings/credit/route.ts`, `lib/server/earnings/admin.ts`
- `lib/server/earnings/refund-service.ts`, `lib/server/earnings/consolidation-service.ts`
- `lib/server/seller-fees/*`
- `supabase/migrations/**`
- `lib/server/website-integration.ts::websitePaymentConfirmedPayloadSchema` (the wire contract — only the function body of `receiveWebsitePaymentConfirmed` changes)
- `lib/server/website-webhook-auth.ts`, `lib/server/website/webhook-events.ts`
- `app/api/cron/consolidate-earnings/route.ts`
- `app/api/integrations/website/inbound-proposal/route.ts` (inbound proposal — separate from payment-confirmed)
- Any frontend component

---

## Dependencies

| Type | Dependency | Status | Impact if missing | Owner |
|---|---|---|---|---|
| Internal | Postgres RPC `credit_wallet_bucket(p_profile_id, p_amount, p_currency, p_entry_type, p_balance_bucket, p_reference_type, p_reference_id, p_actor_profile_id, p_metadata, p_idempotency_key, p_created_at)` | Present (existing, used by Stripe webhook today) | Iteration cannot proceed | local — locked, no new migration |
| Internal | `earnings_ledger` table with `idempotency_key` unique constraint | Present | Without unique constraint, double-credit risk is real | local — locked, no migration |
| Internal | `wallet_ledger_entries` table with idempotency discipline | Present | Same as above | local — locked |
| Internal | `lib/server/payments/activation.ts::activatePaidProposal` return shape (includes `payment_id`, `proposal_id`, `lead_id`, `project_id`) | Present (verified) | The new service needs these IDs from the caller | local — stable contract |
| Internal | `websitePaymentConfirmedPayloadSchema.external_payment_id: z.string().trim().min(1)` (REQUIRED) | Present (HARD FACT verified during discovery) | Without this guarantee, inbound idempotency key collapses to null and dedupe fails | local — would require schema change to break, which is out of scope |
| Internal | `website_webhook_events` transport-level ledger (ADR-016) | Present | Already handles retry/replay at the transport layer; the new service is the second layer of defense via `idempotency_key` | local — locked, no change |
| Contract | Cross-repo: `websitePaymentConfirmedPayloadSchema` (the wire NoonWeb sends) | Locked | Wire contract NoonWeb-side does NOT change in this iteration | cross-repo — frozen |
| External | None | n/a | No new npm packages | n/a |
| Infra | None | n/a | No env vars, no deploy changes | n/a |
| Data | No new tables, no new columns, no migrations | n/a | Iteration is pure code change | n/a |

---

## Assumptions

1. **`credit_wallet_bucket` RPC is symmetric across actors**. The RPC accepts any `profile_id` and credits the corresponding `wallet_accounts` row, regardless of whether the actor is a seller, developer, or noon (`actor_id=null` for noon — handled by skipping the credit per the existing inline logic at line 258). The new service preserves that semantic.
2. **`earnings_ledger.idempotency_key` is the unique constraint that enforces dedupe**, not a combination of other columns. Verified empirically by the existing Stripe webhook code at line 252 (`onConflict: 'idempotency_key', ignoreDuplicates: true`).
3. **`external_payment_id` is monotonically unique per payment event from NoonWeb side**. Schema enforces `min(1)`; NoonWeb's own discipline guarantees uniqueness. Verified by `website_inbound_links.external_payment_id` already used as a lookup key in `findLinkByExternalRef`.
4. **`receiveWebsitePaymentConfirmed` runs under the admin (service-role) client** (line 476: `createSupabaseAdminClient()`). The new service does NOT need its own auth resolution — the caller passes the already-elevated client. Outbound (Stripe webhook) also uses admin client; behavior symmetric.
5. **Project's `developer_user_id` is resolved from `activation.project_id`** via a separate `client.from('projects').select('developer_user_id').eq('id', projectId).maybeSingle()` query. The Stripe webhook already does this at lines 173-182. The wire-up in `receiveWebsitePaymentConfirmed` will need the same lookup (or Architecture decides to push it into the service).
6. **Existing 487 tests + the new tests will run under `tsx --test`** (no React testing infra needed). The service is a pure function over Supabase admin client; the existing test pattern at `tests/server/seller-fees/*` and `tests/server/api/webhooks/stripe-checkout-completed.test.ts` is the reference.
7. **Browser/live-Stripe smoke is deferred to operator post-merge** per router. The iteration delivers the code + test coverage; the operator may choose to validate inbound earnings end-to-end via a NoonWeb staging payment after merge, but that is NOT a gate for COMPLETE.

If any assumption breaks during implementation, the responsible skill stops and updates this spec with a dated note before proceeding.

---

## Risks

| # | Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R1 | Allocation asymmetry between outbound and inbound (outbound subtracts `sellerFeeAmount` before split; inbound does not) is a policy decision, not a bug. If not documented explicitly in ADR-021, future readers will assume it's a bug and "fix" it, breaking outbound. | Medium | High | High | Architecture MUST declare the asymmetry policy in ADR-021 with the rationale ("inbound has no seller take, full amount distributed 50/50 to dev/noon"). Service signature MUST require `leadOrigin` as a discriminator to make the asymmetry explicit at every call site. |
| R2 | `developerUserId` is nullable in inbound (and sometimes in outbound — proposal converted to project before developer assignment). Service must handle null. Default proposed: skip developer share, credit only noon (50% of base). Alternative: credit noon 100% (the developer-share-equivalent goes to noon until developer is assigned, then a separate manual reallocation is needed). | High | Medium | High | Architecture decides between the two options in ADR-021. Spec default is **skip developer share** (consistent with current Stripe webhook behavior at line 218-232: developer row uses `actor_id: null` notes when unassigned and the credit loop at line 258 skips `if (!row.actor_id)` — net effect today is the developer share IS inserted into earnings_ledger but NOT credited to any wallet because actor_id is null. New service should preserve this semantic.). Open Question Q2 documents the inheritance. |
| R3 | RESOLVED in Analysis discovery. `external_payment_id` is REQUIRED in `websitePaymentConfirmedPayloadSchema` (line 70). Idempotency key for inbound is safely `website:${external_payment_id}` with no fallback needed. | n/a | n/a | resolved | Marked resolved; Architecture inherits the resolution. |
| R4 | Points policy in inbound is silent. Outbound awards 50 points to seller. In inbound, sellerId=null. If operator wants developer-points-in-inbound, this iteration must add a new code path. Default proposed: no points in inbound. | Low | Low | Low | Open Question Q4 surfaces the default. If operator says "yes, developer points in inbound" at spec sign-off, the scope of this iteration grows by ~5 lines (a points row in the new service or in the caller). Otherwise unchanged. |
| R5 | Refactor introduces a subtle behavior change in outbound that the existing test suite doesn't catch (e.g., the existing tests mock `creditWalletBucket` at the route module level and don't notice that the call now goes through an indirection). | Medium | High | High | Backend MUST run the existing Stripe webhook test suite verbatim before and after refactor; diff in test output must be zero. Refactor step is explicitly separate from wire step per router chunking. |
| R6 | Service is extracted but the seller-share allocation accidentally moves into it (instead of staying in the Stripe webhook handler). Then inbound would credit a seller share with `sellerId=null` → either a NOT NULL violation or a silent skip with a missing-earnings audit gap. | Medium | High | High | Architecture contract MUST explicitly exclude the seller-share row from the service. Service receives `sellerFeeAmount` only to compute `base = activationAmount - sellerFeeAmount` for outbound. Seller-share row is built in the Stripe webhook handler (outside the service) and inserted alongside the service-returned dev/noon rows in the same `earnings_ledger.upsert` call — OR Architecture decides the service writes only dev/noon and the caller writes the seller row separately. Both shapes are defensible; ADR-021 picks one. |
| R7 | Inbound test infrastructure may be weaker than outbound. The B1.3b smoke at 8/10 PASS suggests gaps. If the new integration test for inbound earnings can't easily mock the website webhook chain (HMAC auth + transport ledger + admin client), Backend may fall back to "skip integration, rely on unit tests only" — which would leave the gate weaker. | Medium | Medium | Medium | Testing skill MUST treat the inbound integration test as REQUIRED. If the existing mock infrastructure for `payment-confirmed` doesn't exist, Backend writes it as part of this iteration. The test pattern at `tests/server/website/webhook-events.test.ts` is the reference for transport-ledger mocking; the rest follows. |
| R8 | Stripe webhook handler also handles `charge.refunded` (line 12 imports `debitWalletForRefund`) and `account.updated` (line 319 onwards). Refactor inadvertently touches those handlers. | Low | High | Medium | Backend's refactor diff MUST be scoped to lines 184-279 (the allocation+credit block) inside `handleCheckoutSessionCompleted`. Other handlers in the same file MUST NOT be touched. PR diff review is the gate. |
| R9 | Live Stripe smoke is deferred — if the operator chooses to also defer the NoonWeb staging inbound smoke, the iteration closes COMPLETE on test-mock evidence alone. A real-traffic edge case (e.g., NoonWeb sending `external_payment_id` with a format App's idempotency key didn't anticipate) goes undetected until first production inbound payment. | Medium | Low | Medium | Acceptable for this iteration per operator decision. Validator records the deferred smokes explicitly. The next inbound real-customer payment serves as the implicit live validation; operator monitors `wallet_ledger_entries` rows + `/dashboard/earnings` for the receiving developer immediately after. |

---

## Open Questions

Each has a default the responsible skill (Architecture in most cases) can apply with documented reasoning. If any becomes load-bearing during implementation, escalate to operator.

### Q1 — Service surface: does `creditActivationEarnings` write earnings_ledger AND wallet_ledger, or only wallet_ledger?
- **Default**: writes BOTH. The current Stripe webhook code does both (line 250-253 earnings_ledger upsert; line 257-278 wallet credit per actor). Splitting them into two services creates a partial-failure window where earnings_ledger has rows but wallet_ledger doesn't. Architecture should preserve atomicity.
- **Reason to deviate**: if the existing `credit_wallet_bucket` RPC already inserts an audit row that subsumes earnings_ledger, double-write is wasteful. Backend verifies the RPC behavior; if it already writes to earnings_ledger as a side-effect, the service skips the explicit upsert.

### Q2 — `developerUserId=null` in inbound: skip the developer earning row entirely, or insert it with `actor_id=null` (no wallet credit but audit trail preserved)?
- **Default**: insert the row with `actor_id=null` (matches current Stripe webhook semantics at line 219-232: the row IS inserted into `earnings_ledger` for audit, but the wallet credit loop at line 258 skips `if (!row.actor_id)`). This preserves the audit invariant "every payment has 2-3 earning rows" regardless of assignment state.
- **Reason to deviate**: if operator wants a "developer share parked in noon wallet until developer is assigned" model, the service needs an additional `defaultDeveloperShareTargetWhenUnassigned` parameter. Out of scope unless explicitly requested.

### Q3 — Idempotency-key strategy for inbound (RESOLVED).
- **Default**: `website:${external_payment_id}:wallet:${actorRole}:${actorId ?? 'unassigned'}` for wallet credits and `website:${external_payment_id}:earning:${actorRole}:${actorId ?? 'unassigned'}` for earnings_ledger rows. Symmetric with outbound (`stripe:${session.id}:...`). RESOLVED by hard-fact discovery: schema guarantees `external_payment_id` is present.

### Q4 — Points policy in inbound: any points awarded?
- **Default**: NO. Outbound awards 50 points to the seller (line 307-316); inbound has `sellerId=null` so the existing path naturally skips. Developer-points-in-inbound is NOT introduced.
- **Reason to deviate**: operator explicit request. If so, ADR-021 declares the new policy and the service (or caller) adds a developer-points row. Spec scope grows by ~5 lines.

### Q5 — Should the new service take `creditWalletBucket` as a dependency (callback), or call the RPC directly?
- **Default**: call the RPC directly. The helper at `app/api/webhooks/stripe/route.ts:23-56` is a thin wrapper around `client.rpc('credit_wallet_bucket', ...)`. The new service can either (a) move that helper into the service and stop exporting from the route file, or (b) inline the RPC call. (a) is cleaner; (b) is simpler. Architecture picks.

### Q6 — Does the test for inbound integration need to start the real `/api/integrations/website/payment-confirmed` route handler, or mock at the `receiveWebsitePaymentConfirmed` level?
- **Default**: mock at the `receiveWebsitePaymentConfirmed` level. The transport-layer auth + ledger are already covered by `tests/server/website-webhook-auth.test.ts` and `tests/server/website/webhook-events.test.ts`. This iteration's test focuses on the new behavior (earnings credit) — not on re-testing the upstream transport.

### Q7 — Logging additions in the new service: log every credit attempt, every error, or only failures?
- **Default**: log allocation summary at INFO level (one row per call: leadOrigin, base, sellerShare, devShare, noonShare, paymentId), log every error at WARN/ERROR. PII (amounts) is internal money data and acceptable per existing earnings logging precedent. No request body or signed payload logging.

---

## Recommended Testing Methodology

**Integration-first with regression+new-behavior split.**

Justification (one line per router): existing Stripe webhook coverage is integration-mock-based and serves as the regression gate; the new inbound credit path needs a new integration test at the same level to prove symmetric behavior.

- **Unit tests** (Vitest-style under `tsx --test`): one file `tests/server/earnings/activation-credit.test.ts` covering:
  - Outbound: `sellerFeeAmount > 0` → `base = activationAmount - sellerFeeAmount` → expected dev/noon shares.
  - Inbound: `sellerFeeAmount = 0` → `base = activationAmount` → expected dev/noon shares.
  - `developerUserId = null` → default behavior per Q2.
  - `sellerId = null` (outbound edge case where lead has no assigned_to/created_by) → seller share insertion behavior depends on Architecture's Q1 decision.
  - Idempotency key generation matches the expected pattern.
- **Integration regression** (Stripe outbound): `tests/server/api/webhooks/stripe-checkout-completed.test.ts` — runs unchanged, expects same wallet_ledger + earnings_ledger output.
- **Integration new-behavior** (inbound): `tests/server/api/integrations/website/payment-confirmed.test.ts` (existing or new):
  - Single inbound payment → developer + noon credited, no seller row, no `confirmSellerFee` side effect.
  - Duplicate inbound payment (same `external_payment_id`) → no duplicate rows.
  - Inbound payment with `developerUserId=null` on the project → noon credited, developer behavior per Q2.

Total test count expectation: 487 baseline + ~6-10 new tests = ~493-497.

---

## Definition of Done

Bounded to this iteration only.

- [ ] Spec `specs/fase-3-r4-inbound-earnings-auto-credit.md` Status moved Draft → Approved before Architecture starts.
- [ ] ADR-021 landed at `docs/adrs/ADR-021-<slug>.md` covering the 3 packed decisions per router handoff.
- [ ] All 10 acceptance criteria verified (see `## Acceptance Criteria`).
- [ ] PR opened on `fix/fase-3-r4-inbound-earnings-auto-credit` (or equivalent slug) branch with title following repo convention. PR description references this spec by path.
- [ ] `npx tsc --noEmit` filtered for in-scope files: 0 errors.
- [ ] `npx eslint` on modified files: 0 issues.
- [ ] `tsx --test tests/**/*.test.ts` (with globstar): all pass, count = baseline + new tests.
- [ ] Out-of-scope diff check: PR diff modifies only files in `## Affected Files / Modules` list (or each addition justified in PR description against `## Scope Boundary § Explicitly out of scope`).
- [ ] `docs/context/project.context.core.md` line 366 updated (remove "Pending FASE 3" wording).
- [ ] `docs/context/project.context.full.md` earnings flow section updated to reflect dual symmetric entry-points.
- [ ] `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §6 Bloque A "FASE 3 lifecycle propuesta" item closure (per `feedback_keep_roadmap_in_sync`).
- [ ] `system-security` returns GATE-OPEN (zero CRITICAL/HIGH).
- [ ] `system-validator` returns COMPLETE or PARTIAL with explicit deferred-smoke list (live Stripe + NoonWeb staging inbound).
- [ ] Spec lifecycle Draft → Approved → Implemented on Validator COMPLETE.

---

## Chunking Decision

**Single iteration. Internal sequence is not chunking.**

The three structural steps (extract / refactor Stripe / wire inbound) are interdependent and must validate together:
- Extract without wire = dead code path.
- Wire without extract = inline duplication, which is the exact anti-pattern this iteration removes.
- Refactor without wire = mechanical code movement with no entry-point change; no validator value.

Within the iteration, Backend executes:
1. **Backend phase A — Create the service**. New file + unit tests. Stripe webhook untouched. Tests pass.
2. **Refactor phase — Replace Stripe inline loop with service call**. Stripe webhook regression suite unchanged, must pass identically.
3. **Backend phase B — Wire inbound**. `receiveWebsitePaymentConfirmed` calls service. New integration test passes.

If any phase reveals scope balloon (e.g., the `credit_wallet_bucket` RPC behavior doesn't match what the inline code assumed), Backend stops and asks. Default fallback: close iteration PARTIAL after phase A or B with explicit pending list.

---

## Success Criterion

> **After this iteration merges, an inbound payment from NoonWeb arriving at `POST /api/integrations/website/payment-confirmed` automatically credits the developer (50% of activation amount) and noon (50% of activation amount) into their respective `wallet_accounts.pending` buckets with corresponding `earnings_ledger` + `wallet_ledger_entries` audit rows, using the `website:${external_payment_id}` idempotency-key namespace, with zero duplicate credits under webhook retry. The outbound Stripe path continues to produce the same earnings allocation it did before the iteration (seller from `seller_fees.amount` + developer 50% of `base` + noon 50% of `base` where `base = activationAmount - sellerFeeAmount`), verified by zero changes to the existing Stripe webhook test suite.**

---

## Skill Chain Hypothesis

`system-analysis` (this spec) → `system-architecture` (ADR-021 with 3 packed decisions) → `system-backend` (phase A: service + unit tests) → `system-refactor` (replace Stripe inline loop with service call, regression must hold) → `system-backend` (phase B: wire inbound, integration test) → `system-testing` (run full suite, verify regression + new behavior) → `system-security` MANDATORY (idempotency, namespace separation, re-entrancy, PII in logs) → `system-docs` (ADR + context.core + context.full + roadmap) → `system-validator` (COMPLETE / PARTIAL / BLOCKED).

Note: Backend phases A and B sandwich the refactor step per router decision. Architecture may consolidate them but the testing target separation (regression vs new) must remain explicit so Validator can attribute any failure correctly.

---

## Handoff Payload — to `system-architecture`

- **Task summary**: see `## Task Summary`.
- **Scope boundary**: `## Scope Boundary` — strict. Out-of-scope list is the router lock, authoritative.
- **Acceptance criteria**: `## Acceptance Criteria` (10 items).
- **Affected files**: `## Affected Files / Modules`.
- **Dependencies**: `## Dependencies` — all internal; no cross-repo coordination needed.
- **Assumptions**: `## Assumptions` (7 items). Break any → stop and update spec.
- **Open questions**: `## Open Questions` (Q1-Q7) — each has a default; Architecture documents deviations in ADR-021.
- **Risks**: `## Risks` (R1-R9) — R1, R2, R5, R6 are the most likely to require Architecture decisions in ADR-021.
- **Pre-resolved by Analysis**: Risk R3 (idempotency-key source for inbound) resolved by hard-fact verification of `websitePaymentConfirmedPayloadSchema.external_payment_id: z.string().trim().min(1)`.
- **Recommended depth**: FULL (already locked by router).
- **Chunking decision**: single iteration; internal sequence Backend-A → Refactor → Backend-B.
- **Success criterion**: see `## Success Criterion`.
- **Recommended testing methodology**: integration-first with regression+new-behavior split.
- **Path to this spec**: `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-r4-inbound-earnings-auto-credit.md`.
- **Next ADR number**: ADR-021 (verified — ADR-018, ADR-019, ADR-020 already taken by R5 resolution, GDPR, dashboard summary respectively).

---

## Lifecycle

- **Draft** — 2026-05-23 (analysis output)
- **Approved** — 2026-05-23 (operator sign-off: "Approved, arrancá architecture"; ADR-010 client-portal anchor reinforced explicitly post-Draft per operator emphasis)
- **Implemented** — pending Validator COMPLETE
- **Archived** — n/a

Status changes recorded inline as dated notes when transitioned. Spec is not edited after Implemented; follow-up iterations create new spec files and reference this one.
