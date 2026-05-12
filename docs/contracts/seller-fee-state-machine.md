# Contract: seller fee state machine

**Responsibility:** Define the seller-fee entity for outbound activation payments — the seller-selected fixed fee of 100 / 300 / 500 USD that becomes part of the client's initial payment — and its state transitions (Potential → Confirmed → Pending payout → Paid out, or Cancelled), with role-aware visibility.

## Entity

`seller_fee` is the conceptual entity representing one seller's fixed-fee earning attached to one outbound proposal (and ultimately one activation payment). The fee is selected by the seller during outbound proposal generation, persisted on the proposal, and resolved against the client's confirmed initial payment. The contract treats the fee as a first-class entity with its own state machine rather than as a derived attribute of the earnings ledger.

The current implementation hard-codes the fee at $100 in `lib/maxwell/pricing.ts` and inside the Stripe webhook handler (per audit §3 F-05 and §4.6 sec 24). That implementation is structurally incompatible with the spec sec. 24 selectable model and is the surface this contract eventually replaces.

The exact ownership decision — whether the state machine sits on its own `seller_fees` entity or extends `earnings_ledger` rows with discriminated state — was **resolved by `docs/adrs/ADR-007-seller-fee-state-machine.md`** (2026-05-11) in favor of a dedicated `seller_fees` table. The wallet model decision (interaction with payout-side transitions) was **also resolved by ADR-007**: existing `credit_wallet_bucket` RPC for `Confirmed` and `service_debit` ledger entries for `confirmed → cancelled`. Both decisions are now implemented end-to-end (B3 closure 2026-05-12).

## States / lifecycle / transitions

Per spec sec. 24.4, the official seller-fee states are:

- Potential
- Confirmed
- Pending payout
- Paid out
- Cancelled

Transition rules (text):

- A seller_fee enters **Potential** when the seller selects 100 / 300 / 500 USD during outbound proposal generation. The selection is persisted on the proposal; the seller earning is not yet earned.
- The fee transitions **Potential → Confirmed** when the client's initial/activation payment is confirmed for that proposal (spec sec. 24.4 rule). Confirmation is the official earning event.
- **Confirmed → Pending payout** when the confirmed earning enters the payout queue per the existing payout/wallet rules.
- **Pending payout → Paid out** when the payout transaction settles to the seller.
- **Cancelled** is reachable from **Potential** (proposal not converted, lead released, proposal cancelled) and from **Confirmed** (payment refund, dispute resolution against seller, PM/Admin reversal). Cancellation from **Pending payout** or **Paid out** requires PM/Admin intervention and is treated as an exception path with a separate audit entry.
- Per spec sec. 24.2, the fee is one-time, charged inside the activation payment, not monthly, not recurring, and does not participate in membership/monthly payments. The state machine therefore terminates at Paid out (or Cancelled); there is no recurring re-confirmation.
- Per spec sec. 24.1, the seller chooses the fee value based on desired earning, perceived opportunity, difficulty of closing, client price sensitivity, and commercial strategy. The chosen value is locked at proposal generation; it is not editable after the client opens the proposal. Re-pricing requires a new proposal version.

## Conceptual data shape

Named fields (English nouns; no DDL):

- `seller fee id` — stable identifier for this fee record.
- `proposal reference` — the outbound proposal this fee is attached to.
- `seller reference` — the seller account that selected the fee.
- `fee amount` — one of: 100 USD, 300 USD, 500 USD.
- `state` — one of the states listed in Lifecycle.
- `selected at` — when the seller chose the fee at proposal generation.
- `confirmed at` — when the client's initial payment confirmed.
- `payment reference` — pointer to the activation payment that confirmed the fee, when applicable.
- `payout reference` — pointer to the payout that paid out the fee, when applicable.
- `cancellation reason` — short structured note when state is Cancelled, distinguishing pre-confirmation cancellations from refund/dispute reversals.
- `formula context snapshot` — record of the activation-payment formula as applied (`outbound initial payment = base activation price + seller fixed fee`, per spec sec. 24.2), so later changes to base pricing do not retroactively alter the fee record.

Permission concern (spec sec. 24.3, sec. 8.3, sec. 13.3): visibility is strictly role-aware.

- **Client** — sees the total initial/activation price. Does not see the fee breakdown, does not see the seller's chosen value, does not see seller earning state.
- **Seller** — sees own selected fee, own earning potential, own confirmed earning after payment, own payout/wallet status.
- **Developer** — must not see the seller fee. Spec sec. 13.3 lists seller commission among fields collaborators must not see by default.
- **PM/Admin** — sees the full internal financial structure for audit and exceptions.

## Inputs / triggers (what causes state changes)

- **Seller selects fee at proposal generation** → creates `seller_fee` in `Potential` linked to the proposal.
- **Client initial/activation payment confirmed** for the linked proposal → transitions `Potential → Confirmed`.
- **Payout queueing rule** (existing wallet/payout logic) → transitions `Confirmed → Pending payout`.
- **Payout settlement** → transitions `Pending payout → Paid out`.
- **Proposal cancellation, lead release, or proposal not converted** before payment confirmation → transitions `Potential → Cancelled`.
- **Payment refund, dispute resolution, or PM/Admin reversal** after confirmation → transitions to `Cancelled` from `Confirmed`, or (exception path) from `Pending payout` / `Paid out` with explicit PM/Admin audit.
- **Seller re-prices** → not an in-place transition; requires a new proposal version with a new `seller_fee` record.

## Outputs / consumers (who reads or reacts)

- **Stripe webhook split** — reads the persisted seller-fee value from the proposal/payment record (not from a code constant) when computing the activation payment split. This is the F-05 fix anchor.
- **Earnings ledger and wallet system** — credits the seller's monetary wallet on `Confirmed`; debits / re-credits on `Cancelled` per the wallet model decision (gated by Q4).
- **Seller dashboard** — reflects state for the seller's own fees: potential, confirmed, pending payout, paid out, cancelled.
- **PM/Admin financial views** — read full state and history for audit and exception handling.
- **Internal activity log** — records state transitions per spec sec. 22.1 (`earnings adjustments`, `PM/Admin intervention`).
- **Notifications system** — may emit events on `Confirmed` and on `Cancelled` from a confirmed state; channel scope is gated by the index-level OPEN marker on Q9.

## Cross-entity references

None directly. The seller_fee links to a proposal and a payment, both of which already exist in the repository as their own entities (proposal lifecycle, Stripe payments). This contract does not redefine those entities; it adds a state-bearing record alongside them.

## Cross-refs to ADRs / audit / spec / flows

- ADR: none directly.
- Audit: `docs/audits/v3-phase-0-audit.md` §3 F-05 + F-02, §4.6 sec 24, §5.2 production-blocking 5, §6 (Seller fee step in the audit's recommended phase ordering).
- Spec: `docs/product/master-spec-v3.md` sec. 24 (24.1–24.4), sec. 25.
- Flows: `docs/product/master-spec-v3-flows.md` §10 Financial visibility flow for seller fee.
- Sibling contracts: none directly.

## OPEN markers

- CLOSED 2026-05-11: audit §7 Q4 (wallet model) — resolved by `docs/adrs/ADR-007-seller-fee-state-machine.md` §Rationale: existing `wallet_accounts` + `credit_wallet_bucket` RPC + `service_debit` ledger entries; no new wallet primitives needed.
- CLOSED 2026-05-11: audit §7 Q7 (seller-fee entity ownership) — resolved by `docs/adrs/ADR-007-seller-fee-state-machine.md` §Decision: dedicated `seller_fees` table (not discriminated on `earnings_ledger`), per state enum granularity (5 states vs 3) and structural RLS separation (developer excluded).
- Implementation landed in migrations `0043_phase_18a_seller_fees.sql` + `0044_phase_18b_seller_fees_rls.sql`, service layer `lib/server/seller-fees/*`, proposal API integration, webhook integration, UI selector. Browser validated 2026-05-12.
