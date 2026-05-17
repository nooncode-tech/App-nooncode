# ADR-013: Activation pricing — model is additive (already implemented via Maxwell); enforce gatekeeper at proposal creation

**Status:** Accepted
**Date:** 2026-05-17
**Deciders:** Engineering team
**Supersedes:** None
**Related:** ADR-007 (seller-fee state machine), `docs/contracts/seller-fee-state-machine.md`, `docs/product/master-spec-v3.md` §24, `lib/maxwell/pricing.ts`, `lib/maxwell/system-prompt.ts`.

---

## Context

A B1.3a smoke observation (roadmap §17, 2026-05-17 §2) surfaced what initially looked like a deductive vs additive pricing model mismatch in the Stripe checkout flow: a proposal with `amount=$1` + `sellerFeeAmount=$100` charged the client $1, credited the seller $100, and triggered the `Math.min(sellerFee, amount)` clamp introduced by Path J on the same PR.

Deeper investigation revealed the actual situation is different from the initial reading:

1. **The additive model is already implemented** end-to-end:
   - `lib/maxwell/pricing.ts` exposes `computePricing(projectType, complexity, channel, feeAmount)` which returns `{ activationBase, activationFinal, ... }` with `activationFinal = activationBase + sellerFee`. Pricing matrix is canonical across 5 project types × 3 complexities ($49 – $349 base).
   - `lib/maxwell/system-prompt.ts` line 37 instructs the LLM: *"El precio de activación final = precio base + $100 fijo del vendedor. El cliente NO ve el desglose."*
   - When Maxwell calls the `create_proposal` tool (`app/api/maxwell/route.ts:65`), it passes `amount = activationFinal` into `lead_proposals.amount`. Persisted `amount` therefore represents the total the client pays (base + fee).
   - `lib/server/stripe/service.ts:71` sends `proposal.amount * 100` cents to Stripe — i.e. the additive total. Client pays the additive total.
   - `app/api/webhooks/stripe/route.ts:185-187` computes `base = activationAmount - sellerFee = activationBase`, and splits 50/50 to developer/Noon. Mathematically correct under the additive interpretation of `proposal.amount`.

2. **The actual gap is UX/governance, not pricing math.** The seller can bypass Maxwell entirely by typing a number into the `Monto estimado` input on the proposal form (`components/lead-detail.tsx:1550-1561`). When this happens:
   - The pricing matrix is not consulted.
   - The `amount` persisted is whatever the seller chose — including values that would never come out of `computePricing()` ($1, $49 + arbitrary noise, etc.).
   - The webhook split still works mathematically (`base = amount - sellerFee`), but the resulting `base` may bear no relationship to the spec's canonical activation prices, and the seller has effectively re-priced the project against the project type / complexity matrix.

3. **The system prompt has a non-load-bearing ambiguity:** the `create_proposal` tool description (`app/api/maxwell/route.ts:70`) says *"Precio de activacion en USD"* without disambiguating final vs base. The LLM today reads it correctly (final) because the surrounding system prompt establishes "activación final = base + fee", but a future update to the prompt or a model change could silently flip the interpretation.

Path J's `Math.min` cap and proposal-amount validation were correct under the deductive (incorrect) reading of the gap. Under the additive (correct) model with Maxwell as gatekeeper, Path J's mitigations are wrong — they were reverted in commit `baf14bf` on PR #58 ahead of this ADR landing.

---

## Decision

**The additive pricing model is the system of record, as implemented.** No change is required to `lib/server/stripe/service.ts`, the Stripe checkout flow, or the webhook split logic — they all already do the right thing under the additive interpretation of `proposal.amount`.

The gap to close is at proposal creation:

1. **The seller must not be able to set `proposal.amount` by hand.** The `Monto estimado` input on `components/lead-detail.tsx` is removed and replaced by two read-only mechanisms:
   - **Primary path:** Maxwell generates the proposal (with `projectType`, `complexity`, `sellerFeeAmount` inputs) and the form pre-populates from the resulting proposal record. The amount is read-only.
   - **Secondary path:** when the seller fills the form manually (without invoking Maxwell), the form shows two dropdowns — `Project type` and `Complexity` — and computes the amount via `computePricing()` client-side; the amount is read-only.
   In both paths, the server-side proposal API revalidates the amount against `computePricing(projectType, complexity, channel, sellerFeeAmount)` and rejects mismatches.

2. **`projectType` and `complexity` become persisted fields on `lead_proposals`** so that the server can revalidate and so that future audit / refund / re-quote flows can reconstruct the formula. This is consistent with the contract `docs/contracts/seller-fee-state-machine.md`'s `formula context snapshot` requirement.

3. **The Maxwell system prompt is tightened** to (a) declare explicitly that `amount` passed to `create_proposal` is `activationFinal` (base + sellerFee), (b) reflect the 100/300/500 sellerFee options instead of the hard-coded "$100 fijo" copy. This is defense-in-depth against future prompt drift.

The implementation lands as `specs/fase-1-amount-non-editable-pricing-gatekeeper.md` with four chunks: schema, server-side validator, UI rewire, Maxwell prompt update.

---

## Rationale

### Why preserve the additive math instead of changing it

The math is correct. `proposal.amount = base + sellerFee` is consistent with master spec §24.2 (`Outbound initial payment = base activation price + seller fixed fee`), with the UI promise in `lead-detail.tsx:1585` (*"Se agrega al monto que paga el cliente"*), with the system prompt in `lib/maxwell/system-prompt.ts:37`, and with the downstream split logic in the webhook. Touching it would introduce a real bug; leaving it in place leaves a correct foundation.

### Why the bypass via manual amount editing is the load-bearing fault

Today's UI exposes an `<Input type="number" min="0">` for the amount. Pedro typed `$1` during the smoke and the entire pricing pipeline became inert — the matrix wasn't consulted, the Maxwell flow was bypassed, the `seller_fees` row was still attached. Nothing in the existing code prevents this. It is the single highest-leverage place to close the gap because:

- Removing the input forces sellers through either Maxwell or the dropdown-driven `computePricing()` path, both of which produce values from the canonical matrix.
- The server-side revalidation is cheap (one function call against the persisted `projectType` + `complexity` + `sellerFeeAmount`) and authoritative — it cannot be bypassed by the client.

### Why persist `projectType` + `complexity` on the proposal

Three reasons:

1. **Revalidation requires it.** The server cannot rebuild `activationBase` from `proposal.amount` alone; it needs the two matrix coordinates.
2. **Audit trail.** Refund / dispute / re-quote flows need to know which row of the pricing matrix was applied, especially if the matrix changes in the future. Without persistence, this becomes a lossy derivation.
3. **Future v3 Phase 5 AI MVP pipeline alignment.** v3 spec §15–§19 describes Maxwell determining `projectType` + `complexity` from the project description automatically. Persisting these fields now keeps the schema compatible with the v3 flow when it lands — no migration required at that point.

The fields are additive nullable columns (defaults `null` for legacy rows that pre-date this ADR). The proposal API enforces `not null` for new outbound rows at the validation layer, not at the DB level, to keep the schema migration backwards-compatible with the legacy in-flight proposals already in `lead_proposals`.

### Why the Maxwell prompt update is included in the same iteration

The prompt fix is a 5-line change but it eliminates a category of future regression: an LLM that misinterprets the ambiguous "Precio de activacion en USD" tool description could pass `activationBase` instead of `activationFinal`, which would silently undercharge the client. Tightening the prompt costs nothing and removes that risk before scaling beyond the pilot.

The hard-coded `$100 fijo` copy in the prompt also dates from before B3 closure (2026-05-12) — it tells the LLM that the seller fee is always $100, which is no longer true. Updating it to acknowledge the 100/300/500 options is overdue.

### Why this is not a server-side hard rejection of arbitrary amounts (rejected alternative)

The alternative — keep the amount input editable but reject any value at the server that doesn't match `computePricing()` output — was considered. It is strictly safer because it prevents any bypass even if the UI ships a buggy widget. Rejected for two reasons:

1. **It is a strictly subset of the dropdown approach.** Once `projectType` + `complexity` are required inputs, the server-side validation gets them for free and rejects mismatches. The dropdown rewire is the minimum work; adding hard rejection on top is one extra `if` in the validator and is included in the spec.
2. **Letting the UI shape the input is friendlier.** A seller who tries `$50` and gets a `422` is worse UX than dropdowns that surface the matrix values directly. Dropdowns also make `projectType` and `complexity` discoverable, which matters for sellers new to the matrix.

The implementation does both: dropdowns at the UI + server-side revalidation. Defense in depth.

### Why Path J was reverted

Path J's premise — that a proposal with `amount < sellerFee` is a data-integrity breach worth blocking at creation — assumes `proposal.amount = base` (deductive model). Under the additive model with Maxwell as gatekeeper, `proposal.amount` is always `>= sellerFee` by construction (because `amount = base + sellerFee ≥ sellerFee`), and any value that violates the inequality is a bypass of Maxwell. The right fix is to close the bypass, not to catch the symptom downstream.

Once the bypass is closed via this ADR's iteration, the inequality `amount >= sellerFee` becomes a free invariant. No explicit guard is needed.

---

## Consequences

### Pricing semantics

Unchanged. The system continues to charge clients `base + sellerFee` and credits the seller `sellerFee`, the developer `base * 0.5`, and Noon `base * 0.5`. The matrix in `lib/maxwell/pricing.ts` remains the source of truth for `base`.

### Form UX

The seller's proposal form changes from one input (`Monto estimado`) plus one dropdown (`Tu comisión`) to three controls:

- `Tipo de proyecto` (dropdown, required for outbound)
- `Complejidad estimada` (dropdown, required for outbound)
- `Tu comisión (seller fee)` (existing dropdown, unchanged)

Below those, the form renders a derived block:

```
Base de activación: $129 USD
Tu comisión:         $300 USD
────────────────────
Total al cliente:   $429 USD
```

(Numbers illustrative.) The total updates live as the seller changes any of the three controls.

### Schema

`lead_proposals` gains two additive nullable columns: `project_type text` and `complexity text`. No DB CHECK constraints for now — validation lives at the API layer because the canonical enum values are owned by `lib/maxwell/pricing.ts` (TypeScript types), and a DB enum would force every matrix update to ship a migration.

### Maxwell tool contract

The `create_proposal` tool gains two new fields:

- `projectType: enum('landing' | 'ecommerce' | 'webapp' | 'mobile' | 'saas_ai')`
- `complexity: enum('low' | 'medium' | 'high')`

`amount` continues to be passed (already required) but is now revalidated server-side against `computePricing()` of the new fields. The LLM is instructed in the prompt to pass `amount = activationFinal` (the result of `computePricing().activationFinal`).

### Legacy rows

`lead_proposals` rows created before this ADR have `project_type = null` and `complexity = null`. They are not retroactively backfilled. The server-side validator only applies to new outbound rows; existing legacy rows remain unchanged in shape and behavior. The smoke proposal from B1.3a (already refunded) is the only outbound row with persisted `$1` amount and a `seller_fees=$100` row attached; it stays as historical record without recalculation.

### Maxwell system prompt

Two updates:

1. The `Regla Outbound` block changes from a hard-coded `$100 fijo del vendedor` to a parameterized reference to the seller's chosen fee. The pricing table generator (`formatPricingTable`) does not change.
2. The `create_proposal` tool description gains the sentence: *"El campo `amount` debe ser el precio final de activación (base + sellerFee), no el precio base."*

Both updates are non-functional changes to natural-language instructions for the LLM. No runtime behavior changes from these updates alone — they harden the contract against future model or prompt drift.

### Risk register

| Risk | Mitigation |
|---|---|
| Sellers used to typing the amount object to the rewire | UI ships with the dropdown approach + computed total visible; copy explains the change once in the helper text below the controls |
| Maxwell LLM occasionally passes an `amount` that does not match `computePricing()` (LLM math drift) | Server-side validator rejects with `422 PROPOSAL_AMOUNT_MISMATCH`. Maxwell retries the tool call with corrected math, or surfaces an error to the seller |
| Legacy proposals (pre-ADR) without `projectType` / `complexity` re-issued for payment | Open Checkout sessions for legacy rows are unaffected (they use the already-persisted `amount` directly); new payment creation against a legacy proposal without `projectType` falls back to the existing path (no revalidation) and proceeds as today. Documented in §runbook update |
| Project type matrix needs to expand mid-pilot | `lib/maxwell/pricing.ts` is the single edit; both UI dropdown and server-side validator pick up the change for free. No DB migration required |

---

## Implementation chunks

Iteration spec: `specs/fase-1-amount-non-editable-pricing-gatekeeper.md` (drafted in the same iteration as this ADR).

1. **Schema** — `supabase/migrations/0047_...` adds `project_type text`, `complexity text` to `lead_proposals` (both nullable). No CHECK constraints; nullable for legacy backwards-compat.

2. **Server-side validator** — `lib/server/leads/proposal-amount-validation.ts` (new module name — Path J's module was deleted by `baf14bf`). The new validator calls `computePricing` and rejects when `amount !== activationFinal` for outbound proposals. Tests cover all matrix cells × 3 sellerFee values.

3. **UI rewire** — `components/lead-detail.tsx`: remove the `Monto estimado` input, add two dropdowns, render the computed-total block. Local computation only; the server is authoritative on submit.

4. **Maxwell prompt + tool** — `lib/maxwell/system-prompt.ts` and `app/api/maxwell/route.ts` tool schema get the `projectType` / `complexity` additions and the disambiguating sentences.

5. **Documentation + closure** — operating rule added to `docs/context/project.context.core.md`; runbook B1.4 §5 entry; roadmap §16 entry G12 marked RESOLVED with pointer to this ADR; ADR-007 referenced (no supersession).

Estimated effort: ~6-8 h end-to-end, sequencable as a single iteration. Chunks 1+2 + Chunks 3+4 + Chunk 5 are natural commit boundaries.

---

## References

- `docs/product/master-spec-v3.md` §24 (lines 1173–1240) — outbound seller fees
- `docs/contracts/seller-fee-state-machine.md` — entity-level contract; `formula context snapshot` requirement matches this ADR's `projectType` / `complexity` persistence
- `docs/adrs/ADR-007-seller-fee-state-machine.md` — state machine and storage decision (not superseded)
- `lib/maxwell/pricing.ts` — pricing matrix; canonical source for `activationBase`
- `lib/maxwell/system-prompt.ts:37` — LLM instructions encoding the additive formula
- `app/api/maxwell/route.ts:65` — `create_proposal` tool that persists `amount = activationFinal`
- `app/api/webhooks/stripe/route.ts:185-187` — webhook split computing `base = activationAmount - sellerFee` (correct under the additive interpretation; unchanged)
- `components/lead-detail.tsx:1550-1561` — the editable amount input that this ADR closes
- `components/lead-detail.tsx:1585` — existing helper copy that already promises the additive model
- PR #58 (`fix/path-i-j-cleanup-observations`) — Path I (`paid_at` from event timestamp) preserved; Path J (`baf14bf`) reverted
- Roadmap §17 entry 2026-05-17 §2 — observation that surfaced this ADR
