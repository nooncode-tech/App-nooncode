# ADR-007: Seller-fee state machine — dedicated entity, role-aware visibility, conservative cancellation

**Status:** Accepted
**Date:** 2026-05-11
**Deciders:** Engineering team

---

## Context

Master spec v3 `docs/product/master-spec-v3.md` §24 requires the outbound seller fee to be a selectable 100 / 300 / 500 USD value with role-aware visibility (§24.3) and a five-state lifecycle (§24.4): `Potential → Confirmed → Pending payout → Paid out`, plus `Cancelled` as a side state reachable from multiple points.

The current implementation hard-codes the fee at `$100` in two replicated locations:

- `lib/maxwell/pricing.ts:56` — `const sellerFee = isOutbound ? 100 : 0`
- `app/api/webhooks/stripe/route.ts:154` — `Math.max(activationAmount - 100, 0)` (base before split)
- `app/api/webhooks/stripe/route.ts:163` — `amount: 100` (the seller earnings ledger row)
- `app/api/webhooks/stripe/route.ts:169` — notes string mentioning `"$100 fixed"`

The contract `docs/contracts/seller-fee-state-machine.md` describes the conceptual entity but leaves two design decisions open in its own §Open markers:

- **Q4** (wallet model): does the state machine interact with the existing wallet bucket model, or does it need a new one?
- **Q7** (storage model): does the entity live on its own table or as discriminated rows in `earnings_ledger`?

The analysis spec `specs/fase-0-b3-seller-fee-selector.md` further surfaces:

- Two ambiguities in master spec §24.4: cancellation from `Paid out` (auto-debit risk vs PM/Admin exception) and cancellation from `Pending payout` (interaction with the existing payout queue).
- The `earnings_ledger` table already exists with its own three-value `earning_status` enum (`credited | paid_out | cancelled`), which does not cleanly extend to five states.
- RLS on `earnings_ledger` allows the seller and admin/pm roles to SELECT; the developer role can SELECT their own developer-typed rows, which implicitly reveals the base = total − seller_fee. This breaks §13.3 (developers must not see the seller fee).

This ADR is the gating decision document for B3 Chunk 1 of `specs/fase-0-b3-seller-fee-selector.md`. Migration authoring (Chunk 1b) and RLS authoring (Chunk 1c) follow this decision verbatim.

---

## Decision

The seller fee is implemented as a **dedicated first-class entity** named `seller_fees`, with its own five-state enum, role-aware RLS policies that **structurally** exclude the developer role from SELECT, and integration into the existing `wallet_accounts` / `wallet_ledger_entries` model via the existing `credit_wallet_bucket` RPC. Cancellation from `Paid out` is a **forbidden automatic transition**: refunds or disputes that occur after payout require a PM/Admin-recorded exception path outside the state machine. Activity logging reuses the existing `lead_activities` table with new `lead_activity_type` enum values.

The decision resolves the contract's §Q4 and §Q7 markers and the spec's open questions 1, 2, 4, 7 in one document. Open questions 3 (cancellation from `Pending payout` mechanics), 5 (backfill strategy for in-flight outbound proposals at deploy time), and 6 (selector required-ness in the UI) are deferred to their respective implementation chunks because they are not architectural decisions.

---

## Rationale

### Dedicated entity vs discriminated `earnings_ledger`

Three reasons make the dedicated entity the safer call:

1. **State enum granularity.** `earning_status` is `credited | paid_out | cancelled` (three values). The contract requires five states, including a pre-payment `Potential` state that has no semantic equivalent in `earnings_ledger`. Extending `earning_status` with `potential | pending_payout` would alter the meaning of two existing values for non-seller-fee earnings (developer share, noon share), forcing every consumer of `earnings_ledger` to disambiguate per row.
2. **RLS separation.** Master spec §13.3 forbids developer visibility into the seller fee. `earnings_ledger` already grants developers SELECT on their own `actor_role='developer'` rows; even if those rows do not name the fee value directly, the existence of a corresponding seller row plus the column `notes` (which today reads `"Outbound activation - $100 fixed"`) creates a leak surface. A separate table with its own RLS policy that has no rows readable by the developer role is **structurally** safer than a per-row filter on a shared table.
3. **Lifecycle audit trail.** The contract's `selected_at`, `confirmed_at`, `cancellation_reason`, `formula_context_snapshot`, etc. are seller-fee-specific. Mixing them into `earnings_ledger` either bloats every row (most of which are not seller fees) or requires a nullable-column proliferation that hides the state machine from readers.

`earnings_ledger` continues to receive a row per actor on activation payment confirmation, preserving the existing audit shape and downstream consumers. The `seller_fees` table is the **state-bearing** entity; `earnings_ledger` continues to record the **monetary movement**.

### State enum: new `seller_fee_state` enum

Values, in `snake_case` per Postgres convention:

- `potential` — seller has selected the fee on an outbound proposal; client has not paid.
- `confirmed` — client's activation payment has been confirmed; the seller's earning is real.
- `pending_payout` — the confirmed earning has entered the payout queue.
- `paid_out` — the payout transaction has settled to the seller's external account.
- `cancelled` — terminal failure state, reachable from `potential` (pre-payment cancellations) and from `confirmed` (refund / dispute resolution); **not** reachable from `pending_payout` or `paid_out` automatically (see §Cancellation from Paid out below).

A separate `seller_fee_state` enum is introduced rather than extending `earning_status`, for the reasons in §Rationale above.

### Cancellation from `Paid out`: forbidden automatic transition

Master spec §24.4 lists `Cancelled` as reachable from any prior state, but the spec is ambiguous about the mechanics. Three options were evaluated:

- **A — Auto-debit on refund.** The state machine forcibly debits the seller's wallet on a `paid_out → cancelled` transition. Risk: if the seller has already withdrawn the funds to Stripe Connect, the wallet goes negative, and the system has no recovery path short of manual intervention. **Rejected.**
- **B — PM/Admin exception path.** Cancellation from `paid_out` requires explicit PM/Admin action recorded as an exception, not as a state machine transition. **Adopted.**
- **C — Forbidden entirely.** Refunds after payout are flagged for accounting reconciliation outside the system. Strictly safer than B but loses auditability. **Rejected.**

Under the adopted rule, the `seller_fee_state` enum still contains `cancelled` for the pre-payout cases (`potential → cancelled`, `confirmed → cancelled`), but the state machine **does not expose a transition** from `pending_payout` or `paid_out` to `cancelled`. PM/Admin-driven exception handling lives outside this state machine and writes a separate exception record (out of scope for B3; deferred until a payout-reconciliation iteration is scoped).

### Cancellation from `Pending payout`: deferred mechanics

The contract allows `pending_payout → cancelled`, but the existing payout pipeline (`payout_batches`, `payouts`, status enum `pending | processing | completed | failed`) is queue-shaped and does not expose a clean pull-back primitive without inspecting the queue's state machine. Chunk 2 (service layer) inspects this and either:

- (a) Pulls the payout row out of the queue if it has not yet entered `processing`, returning the funds to `available_to_withdraw` and transitioning the seller fee to `cancelled`.
- (b) Treats the transition as exceptional (PM/Admin) when the payout is already `processing` or `completed`.

This is **not** an architectural decision; it is a service-layer mechanic. The ADR records the policy intent (transition is allowed in principle for not-yet-in-flight payouts) and leaves the implementation to Chunk 2.

### Activity logging: reuse `lead_activities`

The contract's transitions are logged via the existing `lead_activities` table with new `lead_activity_type` enum values:

- `seller_fee_selected`
- `seller_fee_confirmed`
- `seller_fee_pending_payout`
- `seller_fee_paid_out`
- `seller_fee_cancelled`

Each transition records a row with `lead_id` (the lead the proposal/fee belongs to), `actor_profile_id` (who triggered the transition), `note_body` (human-readable rationale), and `metadata` (the seller fee amount, the proposal id, the prior state, the new state, the cancellation reason if applicable).

Reuse rationale:

- The seller's activity feed already aggregates `proposal_*` events; adding `seller_fee_*` keeps the seller's lead-detail view unified.
- The existing trigger pattern in `0004_phase_2c_lead_proposals.sql` is reusable: trigger writes activity rows from the migration, not from application code, avoiding miss-cases on direct SQL mutations.
- Postgres enum values are append-only without recreating the type, so new values do not destabilize existing consumers.

### Currency column type

`amount` on `seller_fees` is `numeric(12,2)` with a check constraint `amount IN (100, 300, 500)` and currency `text not null default 'USD'`. Three justifications:

1. Consistent with neighboring financial columns (`lead_proposals.amount`, `earnings_ledger.amount`, `wallet_ledger_entries.amount` are all `numeric(12,2)`).
2. The check constraint enforces the three-value rule at the database, not at the application layer. The selector UI is one defense; the DB constraint is the second.
3. The `currency` column is included for forward-compatibility even though USD is the only supported value today. Multi-currency is not in scope for B3.

### Wallet integration: existing `credit_wallet_bucket` RPC

The `Confirmed` transition (fired by the Stripe webhook on activation payment confirmation) calls the existing `credit_wallet_bucket` RPC with the persisted seller-fee amount, crediting the `pending` bucket of the seller's `wallet_accounts` row. Consolidation (`pending → available_to_withdraw`) follows the existing path. No wallet model changes are introduced. This resolves contract §Q4 trivially.

Wallet debit on `cancellation` from `Confirmed` (refund before payout) uses the existing `service_debit` ledger entry type. The `wallet_ledger_entries.reference_type` is `seller_fee_cancellation` and `reference_id` is the `seller_fees.id`, allowing traceability without coupling the wallet to the seller_fee state machine.

---

## Consequences

The following are **hard rules** introduced by this ADR. Violations should be treated as architectural defects and blocked in review.

1. **The seller fee is persisted in a dedicated table `seller_fees`.** Any code that needs the fee value reads from this table or from a derived column on the linked `lead_proposals` row, **never** from a hard-coded constant. By the end of B3 Chunk 3, no `100` literal referring to the seller fee may remain in `lib/maxwell/pricing.ts`, `app/api/webhooks/stripe/route.ts`, or any other production code path. Unit-conversion `* 100` (for cents) is unrelated and allowed.

2. **Developer role has no SELECT on `seller_fees`.** RLS policies must structurally exclude the developer role. Application-layer filtering is not sufficient. Direct queries to `seller_fees` by an authenticated user with `user_profiles.role = 'developer'` must return zero rows.

3. **Cancellation from `paid_out` is forbidden as an automatic state-machine transition.** Refunds or disputes after payout follow a PM/Admin exception path that lives outside the `seller_fees` state machine and writes a separate exception record. This rule may be revisited in a future ADR when the payout-reconciliation iteration is scoped.

4. **Cancellation from `pending_payout` is allowed in principle.** The implementation mechanic (pull-back from the queue vs PM/Admin escalation when in flight) is decided in Chunk 2 service-layer code, not here.

5. **Activity logging reuses `lead_activities` with new enum values.** No new activity table is introduced. The new enum values are append-only additions to `lead_activity_type`.

6. **Wallet integration uses existing primitives.** `credit_wallet_bucket` for `Confirmed`, `service_debit` ledger entries for `confirmed → cancelled` (refund before payout). No new wallet bucket types or new RPCs are introduced by B3.

7. **The `seller_fees.amount` column is `numeric(12,2)` with a check constraint `amount IN (100, 300, 500)` and currency `text not null default 'USD'`.** Application code should not need to validate the value; the database does. Adding a fourth value requires a new ADR and a migration.

8. **The Active risk on `project.context.core.md`** for "Outbound seller fee is hard-coded at `$100` in `lib/maxwell/pricing.ts:56`" is **scheduled for removal** at the close of B3 Chunk 5. It remains active until then.

9. **The OPEN markers Q4 and Q7 in `docs/contracts/seller-fee-state-machine.md`** are closed by reference to this ADR. The contract file is amended in Chunk 5 (closure chunk).

10. **The `earnings_ledger` table continues to receive per-actor rows on activation payment confirmation** (seller / developer / noon). It is unchanged. The `seller_fees` table is **additive**, not a replacement. Both records exist after a confirmed outbound activation: a `seller_fees` row in `confirmed` state (state-bearing) and an `earnings_ledger` row with `actor_role='seller'` (monetary movement).

11. **Idempotency.** The Stripe webhook handler already uses idempotency keys per actor. The `Potential → Confirmed` transition must also be idempotent: a webhook retry that fires `confirmSellerFee` on a row already in `confirmed` state for the same payment is a no-op, not an error.

12. **Backwards compatibility window.** Between deploy of Chunks 1–3 and the backfill of in-flight outbound proposals (decided in Chunk 3), the webhook handler may encounter a confirmed payment for a proposal whose `seller_fees` row does not yet exist. The handler's fallback behavior is decided in Chunk 3 and removed in Chunk 5 once the backfill is verified. This ADR does not pre-decide the fallback shape because it is a transition-period concern, not an architectural one.

---

## Cross-references

- Contract: `docs/contracts/seller-fee-state-machine.md` (the conceptual entity being implemented). §Open markers Q4 and Q7 are closed by this ADR.
- Master spec: `docs/product/master-spec-v3.md` §24.1–24.4 (fee values, one-time nature, role-aware visibility, state lifecycle), §13.3 (developer visibility prohibition), §22.1 (activity log integration).
- Visibility flow: `docs/product/master-spec-v3-flows.md` §10 ("Financial visibility flow for seller fee").
- Analysis spec: `specs/fase-0-b3-seller-fee-selector.md` (the chunked execution plan; this ADR is the gating output for Chunk 1).
- Audit: `docs/audits/v3-phase-0-audit.md` §3 row F-05 (the catalogued finding), §4.6 sec. 24 (reconciliation table).
- Sister ADRs: `docs/adrs/ADR-005-maxwell-modules-shared-brand.md`, `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` (other Pre-Phase and Phase-0 decisions).
- Pricing surface: `lib/maxwell/pricing.ts:56` (hard-code to remove in Chunk 3).
- Webhook surface: `app/api/webhooks/stripe/route.ts:154, 163, 169` (hard-codes to remove in Chunk 3).
- Earnings ledger schema: `supabase/migrations/0027_phase_10a_commissions.sql` (the existing per-actor ledger that stays unchanged).
- Wallet integration anchors: `supabase/migrations/0024_phase_3a_monetary_wallet_foundation.sql` (`wallet_accounts`, `wallet_ledger_entries`, `credit_wallet_bucket`), `supabase/migrations/0036_phase_15a_wallet_atomic_credit.sql` (atomic credit hardening).
- Active risk to remove at Chunk 5 close: the seller-fee-hardcoded bullet in `docs/context/project.context.core.md`.
