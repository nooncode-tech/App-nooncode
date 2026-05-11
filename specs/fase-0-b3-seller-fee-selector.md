# spec.md — fase-0-b3-seller-fee-selector

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-11
- Session ID: fase-0-b3-seller-fee-selector
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-architecture → system-backend → system-frontend → system-testing → system-validator (per chunk)
- Router mode: New Build
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope the execution of B3 Option C (full implementation of the seller-fee state machine per `docs/contracts/seller-fee-state-machine.md`) into a chunked iteration plan; catalogue every affected surface in the repo against the contract; produce explicit handoff for system-architecture covering the first chunk plus a chunking strategy for the remaining work. Analysis only — no schema changes, no code edits, no PR (for code). One PR with the spec itself, no merge.
- Why this work matters now: the seller fee is hard-coded at `$100` in two replicated locations (`lib/maxwell/pricing.ts:56` and `app/api/webhooks/stripe/route.ts:154,163,169`). Master spec v3 sec. 24 requires a selectable 100/300/500 USD fee with role-aware visibility and a five-state lifecycle (Potential → Confirmed → Pending payout → Paid out, plus Cancelled). The contract is already written (`docs/contracts/seller-fee-state-machine.md`); the code is structurally incompatible. Any outbound deal today pays under the fixed-$100 model, and silent drift between the two code constants would corrupt the earnings split. The contract → code gap is one of the five critical blockers in the project roadmap.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: no (per router handoff `load_full_context: false` — Analysis spec only)
- `project.context.history.md` reviewed: no
- Reason `full` was included if applicable: not required for the analysis phase. Architecture chunk will require it.
- Reason `history` was included if applicable: not required.

### ROUTER DECISION
- Why this mode is correct: B3 introduces a new persisted entity (`seller_fees`) with its own state machine, RLS policies, activity logging, and integration points across pricing, proposals, payments, earnings, and wallet — that is New Build, not Refactor.
- Why this depth is correct: Full because the work spans a database migration, RLS policies on financial data, two existing hard-coded constants that must stay in sync, a contract-defined visibility model that must be enforced at the database (not just the app), and integration with the Stripe webhook handler that is in production today processing real money. A wrong call corrupts production earnings.
- Why this skill is the right active skill now: nothing else can route until the affected-surfaces inventory is complete and the chunking strategy is fixed. Architecture cannot design without scope. Backend cannot implement without contracts.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules".
- Contracts or architecture inputs available: `docs/contracts/seller-fee-state-machine.md` (the contract being implemented), `docs/product/master-spec-v3.md` §24.1–24.4 + §13.3 + §22.1 (the product rules being enforced), `docs/product/master-spec-v3-flows.md` §10 "Financial visibility flow for seller fee" (the visibility flow).
- Relevant handoffs received: user request 2026-05-11 to pick Option C from the three-option overview presented in this session.
- External dependencies or environment assumptions: Stripe Checkout integration is live in production. Supabase project `pdotsdahsrnnsoroxbfe` is the remote primary. The wider schema↔ledger desync recorded in `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` §Reconciliation required is acknowledged: B3 migrations will be authored against current local-files state and applied via the same out-of-band path that existing migrations were applied, NOT via `supabase db push` until the follow-up ledger reconciliation iteration ships.

### RISK SNAPSHOT
- Known risks before starting: production seller earnings split runs on the hard-coded $100 every time an outbound activation payment confirms; any switch must avoid breaking in-flight proposals; the contract demands role-aware visibility that the current `earnings_ledger` RLS does not provide at the granularity needed (developer must not see seller fee, but current developer rows for `actor_role='developer'` reading their own row implicitly reveals base = activationAmount − sellerFee); webhook-side and proposal-generation-side hard-codes must stay in sync during any partial rollout; FASE 3 (proposal lifecycle automation) is on the roadmap and will eventually fire the Potential → Confirmed transition automatically, but is not yet implemented; the wider schema↔ledger desync means `supabase db push` cannot be used safely.
- Known blockers before starting: none for analysis. Architecture chunk is blocked on: (a) a product decision on whether `Cancelled` from `Paid out` debits the seller's wallet or is treated as an unrecoverable PM/Admin exception (master spec sec. 24.4 is ambiguous here); (b) confirmation that the seller is the lead's `assigned_to ?? created_by` and not a separate explicit seller column — current webhook code (line 126) infers it that way.
- Known assumptions before starting: the contract is authoritative (the existing 80-line `docs/contracts/seller-fee-state-machine.md` is the source of truth for behavior); the implementation can introduce a new table `seller_fees` rather than discriminating on `earnings_ledger`; the three fee values are exactly `100`, `300`, `500` USD; no other currencies are introduced by this iteration.

### CONTINUITY NOTES
- Previous session relevant to this one: this same session also produced PR #15 (Branch B / Option B2 reconciliation for ADR-006), which is currently in review and unmerged. B3 work proceeds in parallel on a separate branch.
- Expected next skill after this session if all goes well: system-architecture for Chunk 1 (migration + RLS + activity types), which is the foundation every later chunk depends on.

---

## Task Summary

Implement the seller-fee state machine end-to-end per `docs/contracts/seller-fee-state-machine.md`: introduce a `seller_fees` entity with the five-state lifecycle (`Potential → Confirmed → Pending payout → Paid out`, plus `Cancelled`); persist the seller's chosen fee value (`100 / 300 / 500 USD`) on outbound proposal generation; transition `Potential → Confirmed` when the client's activation payment confirms; replace both hard-coded `$100` instances (in `lib/maxwell/pricing.ts:56` and `app/api/webhooks/stripe/route.ts:154,163,169`) with reads from the persisted seller-fee record; enforce role-aware visibility (client never sees the breakdown, developer never sees the fee, seller sees own state, PM/Admin sees all) at the database level via RLS policies; log every state transition into the activity feed.

The work spans roughly 3–5 days. Analysis output here is the chunked spec; downstream skills (architecture, backend, frontend, testing) execute the chunks in sequence with explicit gating handoffs. Analysis itself performs no schema change, no service code, no UI change, and opens no implementation PR.

---

## Scope Boundary

### Included
- The new `seller_fees` table (column shape, indexes, triggers, RLS policies, state enum).
- The `lead_proposals` table change required to link a proposal to its `seller_fees` row (or to record the fee_amount inline if architecture decides discriminated storage).
- `lib/maxwell/pricing.ts`: `computePricing()` signature change to accept the seller-chosen fee value rather than deriving the constant `100`.
- `app/api/webhooks/stripe/route.ts`: replacement of the three hard-coded `100` references with reads from the persisted seller-fee record; transition trigger from the webhook handler.
- `lib/server/seller-fees/` new module: service surface for `createSellerFee()`, `confirmSellerFee()`, `cancelSellerFee()`, `markSellerFeePendingPayout()`, `markSellerFeePaidOut()` plus repository helpers.
- Activity logging: new `lead_activity_type` enum values for the state transitions (`seller_fee_selected`, `seller_fee_confirmed`, `seller_fee_pending_payout`, `seller_fee_paid_out`, `seller_fee_cancelled`).
- Proposal generation API/schema (`app/api/leads/[leadId]/proposals/route.ts` + `lib/server/leads/proposal-schema.ts` + `lib/server/leads/proposal-mappers.ts`): accept and persist `seller_fee_amount`.
- Frontend selector UI in the proposal-creation surface (the React component identified during architecture archaeology; the existing analysis pass located the API but not the dialog/form component — architecture must complete that lookup).
- Earnings page (`app/dashboard/earnings/page.tsx`) additions: display seller-fee state for the seller's own fees alongside generic earnings entries.
- Tests for the state machine transitions, RLS visibility, webhook integration, and pricing computation.
- One PR per chunk, against `develop`. Not merged by Claude. User merges each.

### Excluded
- **Wallet model overhaul.** The existing `wallet_accounts` / `wallet_ledger_entries` shape stays as-is; seller fees credit the same `pending` bucket via the existing `credit_wallet_bucket` RPC. Master spec sec. 24.4's "Pending payout / Paid out" maps to existing bucket transitions; no new wallet buckets are introduced.
- **Payout system rework.** Existing `payout_methods`, `payout_batches`, `payouts` tables stay as-is. `Confirmed → Pending payout → Paid out` transitions read from the existing payout pipeline, they do not redesign it.
- **FASE 3 proposal lifecycle automation.** The Potential→Confirmed transition is fired by the Stripe webhook in this iteration (manual via existing code path). When FASE 3 ships, the automation hooks here without re-work. FASE 3 is explicitly NOT in scope for B3.
- **Client-side payment UI breakdown.** Master spec sec. 24.3 says client does not see the fee. The existing Stripe Checkout Session creates a single line item with the total amount. B3 does not change this; client-side breakdown is already correctly hidden.
- **Other fee values.** Only `100 / 300 / 500` USD are supported. No custom values, no other currencies, no negotiated discounts.
- **Maxwell prompt changes that mention the fee selector.** Master spec sec. 24.1 says the seller chooses based on opportunity and difficulty. Whether the Maxwell prompt should suggest a fee value is a product decision and not in scope for B3.
- **Seller dashboard map / lead recommendation surfaces.** Out of scope.
- **Membership/recurring fees.** Master spec sec. 24.2 is explicit: the fee is one-time, not monthly. B3 does not touch membership pricing.
- **Re-introducing R-codes, Sprint numbers, or plan-IDs into durable docs, code comments, or commit messages.** Forbidden by user memory rule. The new migration's `comment on column` and the activity-type enum values must reference only the contract and this spec.
- **Auto-merging the resulting PRs.** Forbidden by router handoff and by user memory rule.
- **Absolute local filesystem paths in any committed file** (docs, code comments, commit messages, PR bodies).
- **Editing the wider schema↔ledger desync from ADR-006 §Reconciliation required.** That is a separate follow-up iteration (`fase-0-b4b-ledger-reconciliation`). B3 migrations are authored against current local-files state and apply via the same path the existing migrations applied (out-of-band; not `supabase db push`).
- **Renaming any existing migration file.** Only new migrations are added. Highest current local prefix is `0042_phase_17b_wallet_maxwell_rpc_hardening.sql`; new migrations use the next available prefix above that.

---

## Affected Files / Modules

Inventory derived from code archaeology 2026-05-11 (Explore agent). Paths relative to repo root. Each row notes which chunk touches it.

| Location | Refs | Chunk that touches it |
|---|---|---|
| `supabase/migrations/<next-prefix>_phase_18a_seller_fees.sql` (new) | new table, state enum, RLS policies, triggers, indexes | Chunk 1 |
| `supabase/migrations/<next-prefix+1>_phase_18b_seller_fees_activity.sql` (new) | new `lead_activity_type` enum values + trigger updates if logging is database-side | Chunk 1 |
| `lib/server/seller-fees/repository.ts` (new) | data access layer for `seller_fees` | Chunk 2 |
| `lib/server/seller-fees/service.ts` (new) | state machine transitions: create / confirm / cancel / pending_payout / paid_out | Chunk 2 |
| `lib/server/seller-fees/schema.ts` (new) | zod schemas for inputs/outputs | Chunk 2 |
| `lib/server/seller-fees/activity.ts` (new) | activity-logging helpers per transition | Chunk 2 |
| `lib/maxwell/pricing.ts` | `computePricing()` signature change: accept `feeAmount: 100 \| 300 \| 500 \| 0` instead of deriving from channel; line 56 hard-code removed | Chunk 3 |
| `lib/server/leads/proposal-schema.ts` | add optional `seller_fee_amount: 100 \| 300 \| 500` field; required when `lead_origin === 'outbound'` | Chunk 3 |
| `lib/server/leads/proposal-mappers.ts` | propagate `seller_fee_amount` from input to insert; trigger `createSellerFee()` in the same transaction | Chunk 3 |
| `app/api/leads/[leadId]/proposals/route.ts` | POST handler invokes `createSellerFee()` after proposal insert; enforces selector required for outbound | Chunk 3 |
| `app/api/webhooks/stripe/route.ts` | lines 154, 163, 169: replace hard-code with read of `seller_fees` row; line 154 base computation uses persisted fee; line 163 amount uses persisted fee; line 169 notes references the fee value dynamically; new call to `confirmSellerFee()` after earnings rows inserted | Chunk 3 |
| `app/api/payments/checkout/route.ts` | no signature change expected; the activation amount already includes the fee at proposal level, so checkout reads `proposal.amount` as before | Chunk 3 (verify-only) |
| Proposal-creation React component (location TBD — archaeology found the API but not the dialog) | new selector dropdown (100/300/500), required when outbound; passes the selection to the POST body | Chunk 4 |
| `app/dashboard/earnings/page.tsx` | display state column for seller-fee-typed earnings entries; group seller's own fees separately from generic earnings | Chunk 4 |
| `tests/server/seller-fees/*.test.ts` (new) | state machine transitions, RLS, idempotency | Chunk 5 |
| `tests/server/api/webhooks/stripe.test.ts` (new or extended) | webhook end-to-end with persisted fee read | Chunk 5 |
| `tests/server/maxwell/pricing.test.ts` (new) | pricing computation with the three fee values | Chunk 5 |
| `docs/contracts/seller-fee-state-machine.md` | OPEN markers resolved (the gating Q4 and Q7 references) | Chunk 5 (closure) |
| `docs/context/project.context.core.md` | Active risk for seller fee removed; FASE 3 narrative bullet updated to reference the realized state machine | Chunk 5 (closure) |
| `docs/adrs/ADR-007-seller-fee-state-machine.md` (new) | architectural decisions: dedicated table vs discriminated `earnings_ledger`, state enum design, Cancellation-from-Paid-Out policy, integration boundary with FASE 3 | Chunk 1 (paired with the migration) |

**Hard-coded `100` instances confirmed by archaeology** (must be eliminated by end of Chunk 3):

1. `lib/maxwell/pricing.ts:56` — `const sellerFee = isOutbound ? 100 : 0`
2. `app/api/webhooks/stripe/route.ts:154` — `Math.max(activationAmount - 100, 0)`
3. `app/api/webhooks/stripe/route.ts:163` — `amount: 100`
4. `app/api/webhooks/stripe/route.ts:169` — `notes: 'Outbound activation - $100 fixed'`

---

## Dependencies

| Dependency | Class | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `docs/contracts/seller-fee-state-machine.md` | contract | Present, complete enough to drive architecture | Architecture cannot finalize state shape without it | n/a |
| Master spec v3 §24, §13.3, §22.1 | product rule | Present | Visibility rules cannot be enforced without it | n/a |
| Existing `wallet_accounts` + `credit_wallet_bucket` RPC | infra | Present, working | New seller-fee transitions hook into existing wallet path; if absent, scope expands to wallet redesign | n/a |
| Existing Stripe Checkout integration | infra | Present, in production | Webhook handler is the firing point for `Potential → Confirmed`; cannot test without it | n/a |
| Highest current migration prefix `0042` | infra | Present | New migrations use `0043+`; if a higher prefix appears between this spec and implementation, new migrations re-pick | n/a |
| Wider schema↔ledger desync (ADR-006 §Reconciliation required) | infra | Active risk | New migrations cannot be applied via `supabase db push`; must use same out-of-band path as existing migrations (dashboard SQL editor or equivalent) | Pedro (user) |
| Ledger reconciliation iteration (`fase-0-b4b-ledger-reconciliation`) | infra | Not yet scoped | B3 ships without `db push` parity; the reconciliation iteration eventually restores it | Pedro (user) |
| Existing in-memory rate limiter (`lib/server/api/rate-limit.ts`) | infra | Present (active risk noted in core context, TDR-002) | Does not block B3; the new seller-fees endpoints inherit the same rate-limit posture as the existing proposal endpoints | n/a |
| GitHub `gh` CLI | infra | Available | PR creation per chunk requires it | system-infra (per chunk) |
| Project memory rules (no R-codes, no auto-merge, no absolute paths) | contract | Active | All chunk outputs honor these | n/a |

---

## Assumptions

1. The seller for a given lead is `leads.assigned_to ?? leads.created_by` per existing webhook code (`app/api/webhooks/stripe/route.ts:126`). Architecture must verify this matches the product mental model; if not, a new explicit `seller_user_id` column on `leads` or `lead_proposals` is required and the scope expands.
2. The contract's "Pending payout" and "Paid out" states map cleanly to the existing wallet bucket transitions (`pending → available_to_withdraw → withdrawn`). If they do not, architecture must reconcile.
3. Cancellation from `Paid out` is treated as an exception path requiring PM/Admin audit, not an automatic wallet debit. This is the prevailing interpretation of master spec sec. 24.4. Architecture must confirm and record in ADR-007.
4. The three fee values are immutable: exactly `100`, `300`, `500` USD. No business rule introduces a fourth value.
5. Outbound proposals always have a non-null seller; the assumption from #1 must hold for every outbound lead in the system. Architecture must verify there are no outbound leads with both `assigned_to` and `created_by` null.
6. The role-aware visibility is enforced at the database via RLS, not in the application layer. Application filtering is insufficient because any direct query to `earnings_ledger` by a developer currently returns rows where `actor_role='developer'` includes the implicit base = total − sellerFee. The cleanest approach is to write seller-fee rows to a separate `seller_fees` table that developers cannot SELECT.
7. `earnings_ledger` continues to receive a row per actor for the activation event (seller / developer / noon), keeping the existing audit shape. The `seller_fees` table is the state-bearing entity; `earnings_ledger` continues to record the monetary movement.
8. No in-flight outbound proposal between this spec landing and implementation: at implementation time, architecture must check `lead_proposals WHERE status IN ('sent', 'accepted') AND lead_origin='outbound'` and either backfill `seller_fees` records or scope a one-time backfill script.
9. The wider schema↔ledger desync from ADR-006 §Reconciliation required does not block authoring new migrations. Migrations are authored locally, applied to the remote project via the same out-of-band path as existing migrations (dashboard SQL editor), and the local file is committed.
10. The new ADR-007 is a peer of ADR-005 and ADR-006 (Pre-Phase decisions) but lands inside this iteration's Chunk 1, not as a standalone PR.

---

## Open Questions

These do not block bounded progress (Analysis can still scope and route). Architecture chunk resolves them before authoring the migration:

1. **Storage model**: dedicated `seller_fees` table vs discriminated `earnings_ledger` rows with state column extension? The contract leaves this open (`docs/contracts/seller-fee-state-machine.md` §Cross-refs to ADRs). Analysis recommends dedicated table for clean RLS separation. Architecture decides in ADR-007.
2. **Cancellation from `Paid out`**: automatic wallet debit (risking negative balance if seller withdrew), or PM/Admin-only exception path with audit trail? Master spec sec. 24.4 is ambiguous. Defer to product decision in ADR-007 or to a separate PRD.
3. **Cancellation from `Pending payout`**: does the existing payout queue handle pull-back, or does a new state transition force the row out of the queue? Architecture must inspect the existing payout pipeline.
4. **Activity-log integration**: are seller-fee transitions logged into the existing `lead_activities` table (using new enum values) or into a new `seller_fee_activities` table? Recommendation: `lead_activities` with new enum values, to keep the seller's activity feed unified.
5. **Backfill for in-flight outbound proposals at implementation time**: write-once script vs lazy backfill on next webhook event? Architecture decides per the count of in-flight proposals at implementation time.
6. **Seller selector required-ness in the proposal-create UI**: hard required (form blocks submit) or default-selected to `100` (preserving the current behavior)? Master spec sec. 24.1 implies seller actively chooses; recommendation is hard required, but architecture must check whether the proposal-create flow has other required-field patterns to mirror.
7. **Currency handling in `seller_fees.amount`**: numeric(12,2) like `lead_proposals.amount` and `earnings_ledger.amount`, or constrained to integer USD (no cents needed for 100/300/500)? Recommendation: numeric(12,2) for consistency with neighboring financial columns.
8. **OPEN markers in `docs/contracts/seller-fee-state-machine.md` §Q4 and §Q7**: Q4 is the wallet model question (resolves trivially if Assumption #2 holds); Q7 is the storage-model question (resolves with Open Question #1). Architecture closes both as part of ADR-007.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| Webhook reading a `seller_fees` row that does not exist for an in-flight proposal between deploy and backfill | Medium | High | **High** | Backfill script (one-time) or webhook fallback to fixed-$100 reads for proposals without `seller_fees` rows for a one-week deprecation window. Chunk 3 designs the fallback; Chunk 5 removes it once verified |
| Developer can read seller-fee values via direct `earnings_ledger` query (RLS gap for `actor_role='developer'` rows that imply the seller fee by subtraction) | High (current state) | High (privacy/visibility violation per sec. 13.3) | **High** | The new `seller_fees` table has its own RLS that excludes `developer` role explicitly. `earnings_ledger` row for the developer's own actor_role does not contain the seller fee value (it contains 50% of base, which does not require knowing the fee); review the `notes` column to ensure it does not leak the fee value |
| Production earnings split breaks during transition (the two hard-codes get out of sync mid-deploy) | Medium | Critical | **Critical** | Single PR (Chunk 3) replaces both hard-codes atomically; no intermediate state where one is hard-coded and the other reads persisted. Testing chunk verifies the invariant |
| New migration fails to apply against `pdotsdahsrnnsoroxbfe` because of the wider schema↔ledger desync | Medium | High | **High** | Apply migration via the same out-of-band path as existing migrations (dashboard SQL editor). Do not run `supabase db push`. Architecture pre-checks via `list_tables` after authoring |
| Cancellation from `Paid out` corrupts seller wallet (negative balance if seller already withdrew) | Low | High | **Medium** | Defer the policy decision to ADR-007. Initial implementation may forbid the transition entirely, requiring PM/Admin manual reversal |
| `lib/maxwell/pricing.ts` signature change breaks every consumer that does not yet pass `feeAmount` | Low | Medium | **Medium** | Single consumer identified in archaeology (`computePricing` is only called via the Maxwell proposal generation flow). Architecture verifies via `grep computePricing` before signing off |
| State machine transitions become non-idempotent if the webhook retries (Stripe retries are common) | Medium | High | **High** | The webhook already uses idempotency keys (`stripe:{session.id}:earning:{actor_role}:{actor_id}`). `confirmSellerFee()` must check current state and short-circuit if already `Confirmed` for this payment |
| Master spec sec. 24.3 (developer must not see seller fee) is violated by the `lead_proposals.amount` column itself if the proposal amount visible to a developer (e.g. via a project read path) includes the seller fee | Medium | Medium | **Medium** | Architecture decides whether `lead_proposals.amount` becomes "base only" (with fee separate on `seller_fees`) or "total" (with the developer's read path filtering it out). The former is cleaner; the latter is less invasive |
| Activity-log enum changes interact poorly with the existing `lead_activity_type` enum (Postgres enum migrations are append-only without recreate; reorder is not safe) | Low | Low | **Low** | Append-only enum values are safe in Postgres. New values do not reorder existing ones |
| Out-of-band migration application means CI cannot validate the migration against a real database before merge | Medium | Medium | **Medium** | `node scripts/check-migrations.mjs` runs in CI for prefix-collision detection (which catches mistakes early). Smoke testing in a fresh local Supabase stack is the alternative; architecture decides during chunk 1 |
| Frontend selector component cannot be identified by Analysis without expanding archaeology scope | Medium | Low | **Low** | Chunk 4 (frontend) opens with a focused archaeology pass on `components/lead-*` and the lead-detail dialog tree to locate the exact insertion point |
| FASE 3 (proposal lifecycle automation) lands after B3 and the integration is non-trivial | Low | Medium | **Low** | The state machine API surface (`confirmSellerFee(paymentId)`) is the same hook FASE 3 will call; FASE 3 integration is one call-site update |

---

## Recommended Route Depth (Full / Lite)
- **Full.** Touches schema, RLS, financial code, production webhook, role-aware visibility, and introduces a new ADR. None of this fits Lite depth.

---

## Chunking Decision

**Five chunks, sequential. Each is one PR, no merge by Claude.**

| Chunk | Skill chain | Scope | Estimated effort | Gates |
|---|---|---|---|---|
| Chunk 1 — Migration + RLS + ADR-007 | architecture → backend → testing → security → validator | New `seller_fees` table with state enum + RLS policies + indexes + activity-type enum additions + ADR-007 documenting the storage model and cancellation policy decisions | 0.5–1 day | Migration applies in fresh local stack; RLS verified per role; ADR-007 lands |
| Chunk 2 — Service layer | architecture → backend → testing → validator | `lib/server/seller-fees/` module: repository + service + activity helpers + zod schemas; no UI, no webhook integration yet | 1 day | Unit tests for each state transition; idempotency verified |
| Chunk 3 — Pricing + proposal + webhook integration | architecture → backend → testing → security → validator | `lib/maxwell/pricing.ts` signature change; `lib/server/leads/proposal-*` extended; webhook handler rewrites lines 154/163/169 to read persisted; backfill fallback designed | 1 day | All four hard-code instances removed; existing 141 tests still pass; new pricing + webhook tests pass |
| Chunk 4 — Selector UI + earnings dashboard | architecture (focused archaeology) → frontend → testing → validator | Selector component in proposal-create flow; earnings page shows state for seller's own fees; role-aware filtering on the dashboard | 1 day | Manual browser validation as seller / developer / PM-admin / client (if any client-side surface) |
| Chunk 5 — Tests, docs, closure | testing → docs → validator | Comprehensive integration test for end-to-end seller-fee flow; remove Chunk 3's backfill fallback once verified; close OPEN markers in `docs/contracts/seller-fee-state-machine.md`; update core context Active risk; deprecate the hard-coded $100 mention in the contract | 0.5 day | Active risk removed from core context; contract markers closed; CI green; validator returns COMPLETE for the chain |

**Total estimated effort**: 4–4.5 working days.

**Chunking rationale**:
- Chunk 1 is the foundation that everything else depends on; it is also the only chunk that touches the database schema. Isolating it as a single PR makes rollback trivial.
- Chunk 2 is service-layer-only (no DB schema change, no production code path touched). Safe to land and test in isolation.
- Chunk 3 is the highest-risk chunk because it touches the production webhook. It is intentionally narrow: only the four hard-code instances + the proposal-create wiring.
- Chunk 4 is UI-only; production behavior is unchanged until users start using the selector. Allows browser validation in production preview against real users.
- Chunk 5 is the closure chunk: removes any temporary fallback from Chunk 3, updates durable docs, and asks Validator to evaluate the chain.

**No further sub-chunking** is required. Architecture may elect to split Chunk 3 into two PRs (one for `lib/maxwell/pricing.ts` + proposal API, one for the webhook handler) if Validator flags a smaller blast radius is preferable.

---

## Success Criterion

The iteration succeeds when **all five chunks have landed**, the system passes the following invariants:

1. **No hard-coded `$100` in the codebase**: a `grep -n '100' lib/maxwell/pricing.ts app/api/webhooks/stripe/route.ts` returns nothing referencing the seller fee value. (`100` may appear as a unit conversion factor like `* 100` for cents — that is unrelated and acceptable.)
2. **The `seller_fees` table exists in `supabase/migrations/` and is applied to `pdotsdahsrnnsoroxbfe`** (verified via `list_tables`).
3. **Every outbound proposal created after the deploy** has a corresponding `seller_fees` row in `Potential` state.
4. **The first activation payment confirmation** after the deploy transitions the row to `Confirmed` and credits the wallet with the persisted fee value (not `100`).
5. **Developer role cannot SELECT from `seller_fees`** (RLS verified by impersonation test).
6. **Client-facing payment surface** continues to show only the total activation amount (no breakdown leaked) — verified via the existing Stripe Checkout flow.
7. **Activity feed** records the state transitions per the new enum values.
8. **Active risk** for "Outbound seller fee is hard-coded at $100" is **removed** from `docs/context/project.context.core.md`.
9. **OPEN markers in `docs/contracts/seller-fee-state-machine.md`** Q4 and Q7 are closed by ADR-007 references.
10. **All five PRs are merged by the user** (not by Claude). CI green on each.

**Per-chunk success criteria** are recorded inline in the chunking table above.

---

## Recommended testing methodology

- **Integration-first plus targeted unit tests for the state machine**. The state machine itself has well-defined transitions and is best validated by unit tests for each transition path including idempotency. The webhook integration is best validated by an integration test that drives a Stripe event through the handler and asserts on the resulting `seller_fees` row + earnings ledger rows + wallet credit. RLS visibility is best validated by an impersonation test that authenticates as a developer and asserts the SELECT returns zero rows.
- **No new browser test framework introduced**. Manual browser validation per chunk follows the pattern recorded in `docs/validations/`.
- **Smoke test in a fresh local Supabase stack** for Chunk 1 (migration applies cleanly + RLS works as expected) before applying out-of-band to the remote project. Architecture designs the smoke test.

---

## Definition of Done (this iteration)

- [ ] All five chunks landed via separate PRs against `develop`, each merged by the user.
- [ ] `seller_fees` table exists in `pdotsdahsrnnsoroxbfe` with state enum, RLS policies, indexes.
- [ ] All four hard-coded `100` references replaced.
- [ ] `computePricing()` signature accepts `feeAmount` and is called with the persisted seller-fee value at every call site.
- [ ] Webhook handler reads the persisted fee, not the hard-code, for both base computation (line 154 replacement) and seller row insert (lines 163, 169 replacements).
- [ ] State machine has unit tests for every transition including idempotency.
- [ ] RLS visibility tests pass for seller / developer / pm-admin roles.
- [ ] Active risk for seller fee removed from `project.context.core.md`.
- [ ] ADR-007 landed documenting storage model + cancellation-from-paid-out policy.
- [ ] OPEN markers Q4 and Q7 in `docs/contracts/seller-fee-state-machine.md` closed.
- [ ] No R-codes / Sprint numbers / plan-IDs in any diff (docs, code, commit messages, PR bodies).
- [ ] No absolute local filesystem paths in any diff.
- [ ] Validator returns COMPLETE for Chunk 5, which transitively gates the chain.

---

## Handoff payload to system-architecture (for Chunk 1)

- **Task summary**: design the `seller_fees` table schema + RLS policies + activity-type enum additions + ADR-007. Author the migration file under `supabase/migrations/<next-prefix>_phase_18a_seller_fees.sql`. Do not author service code, UI, or webhook changes — those are Chunks 2/3/4.
- **Scope boundary**: see "## Scope Boundary" above; for Chunk 1 specifically, the modifiable files are `supabase/migrations/` (new files only), `docs/adrs/ADR-007-seller-fee-state-machine.md` (new), and any cross-reference updates in `docs/contracts/seller-fee-state-machine.md` (OPEN markers Q4, Q7) and `docs/audits/v3-phase-0-audit.md` (F-05 reconciliation row).
- **Included/excluded**: as enumerated above. For Chunk 1: included = schema + RLS + ADR. Excluded = service code, UI, webhook, pricing changes.
- **Affected files/modules**: Chunk 1 row in the affected-files table above.
- **Dependencies**: highest current migration prefix `0042`; access to `pdotsdahsrnnsoroxbfe` for `list_tables` verification (Supabase MCP authorized this session); contract source-of-truth `docs/contracts/seller-fee-state-machine.md`; master spec v3 §24 + §13.3.
- **Assumptions**: assumptions 1–10 above. Architecture must validate assumption #1 (seller = `assigned_to ?? created_by`) and assumption #5 (no outbound leads with both null) by querying the remote database.
- **Open questions**: Open Questions 1–8 above. Chunk 1 must resolve questions 1 (storage model), 2 (cancellation from Paid out), 4 (activity-log integration), 7 (currency column type), 8 (contract OPEN markers Q4/Q7) before authoring the migration.
- **Risks that may alter design**: the "developer can read seller-fee values via direct `earnings_ledger` query" risk specifically constrains the RLS design — the new `seller_fees` table RLS must exclude `developer` role explicitly, and `earnings_ledger` rows must not leak the fee value via `notes` or by implication.
- **Recommended depth**: Full for Chunk 1 (schema decisions are irreversible against production).
- **Chunking decision**: this iteration's chunking is fixed at five chunks. Architecture may split Chunk 3 internally but Chunk 1 stays as one PR.
- **Success criterion**: Chunk 1's gates as listed in the chunking table (migration applies in fresh local stack; RLS verified per role; ADR-007 lands).
- **Spec location**: `specs/fase-0-b3-seller-fee-selector.md` (this file).

---

## Forbidden constraints carried forward
- Auto-merging any of the five resulting PRs.
- Introducing R-codes / Sprint numbers / plan-IDs into `docs/context/*` or any durable repo doc or code comment or commit message or PR body.
- Using absolute local filesystem paths in docs, commit messages, or PR bodies.
- Modifying existing migrations (only new migrations are added).
- Hard-coding the fee value anywhere after Chunk 3 lands.
- Bypassing the role-aware visibility via application-layer-only filtering (RLS must enforce).
- Applying new migrations via `supabase db push` until the wider schema↔ledger desync (ADR-006 §Reconciliation required) is reconciled.
- Re-introducing the existing hard-coded `$100` after Chunk 3 ships, even for "compatibility" reasons.

---

## Spec lifecycle
- Status: **Approved (Analysis output)**; ready to route to system-architecture for Chunk 1.
- Author: system-analysis (this session)
- Date: 2026-05-11
- Supersedes: nothing
- Superseded by: nothing
