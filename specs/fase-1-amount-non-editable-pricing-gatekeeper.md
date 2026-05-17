# spec.md — fase-1-amount-non-editable-pricing-gatekeeper

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-17
- Session ID: fase-1-amount-non-editable-pricing-gatekeeper
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-architecture (schema) → system-backend (validator + Maxwell tool) → system-frontend (UI rewire) → system-testing → system-docs → system-validator
- Router mode: Bugfix
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope the implementation of the proposal-amount gatekeeper as a single bounded iteration that closes the bypass vector surfaced by B1.3a observation §2 (2026-05-17). The premise was clarified by ADR-013 (same date): the additive pricing model is already implemented correctly via Maxwell + `lib/maxwell/pricing.ts`; the gap is that the seller can bypass Maxwell entirely by typing into the `Monto estimado` input.
- Why this work matters now: every outbound proposal created without invoking Maxwell skips the canonical pricing matrix. In the pilot this surfaced as the B1.3a smoke (Pedro typed `$1`); at scale this becomes the dominant failure mode if it stays open — sellers will inevitably anchor to "round numbers" or undercut the matrix because the input is editable. Closing the bypass before the pilot processes a second real payment makes the additive math load-bearing rather than aspirational.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: yes (architecture-impacting — new persisted columns on `lead_proposals`, new server-side validator, new Maxwell tool fields)
- `project.context.history.md` reviewed: no (no relevant prior history beyond what is already captured in core and in ADR-007 / ADR-013)
- Reason `full` was included: this iteration adds two columns to `lead_proposals`, changes the Maxwell `create_proposal` tool contract, and introduces a server-side validator that is authoritative on activation pricing. All three touch durable architecture.

### ROUTER DECISION
- Why this mode is correct: Bugfix. The system already has a working additive pricing path (Maxwell → `computePricing` → `create_proposal` → `lead_proposals.amount`). The defect is that the seller form exposes a manual override that bypasses the path. No new product capability is introduced; no refactor of existing behavior is needed beyond closing the bypass.
- Why this depth is correct: Full because two columns are added to a persisted table, a new server-side validator is introduced as the authoritative source on activation pricing, and the Maxwell tool contract changes. Lite would underspecify the schema migration and the validator's error contract.
- Why this skill is the right active skill now: nothing else can route until the affected files are inventoried and the chunk order is fixed. Architecture cannot design the validator's signature without scope; backend cannot wire it without architecture's contract; frontend cannot rewire the form without backend's API shape.
- Reroute already known at start: no.

### SCOPE
- In scope: see `## Scope Boundary` below.
- Explicitly out of scope: see `## Scope Boundary` below.
- Success criterion: see `## Success Criterion` below.

### INPUTS
- Files/modules involved: see `## Affected Files / Modules`.
- Contracts or architecture inputs available:
  - `docs/adrs/ADR-013-seller-fee-additive-pricing.md` — the gating decision document for this iteration.
  - `docs/adrs/ADR-007-seller-fee-state-machine.md` — five-state machine for `seller_fees` (not superseded by ADR-013).
  - `docs/contracts/seller-fee-state-machine.md` — entity-level contract; `formula context snapshot` requirement aligns with this iteration's `projectType` / `complexity` persistence.
  - `lib/maxwell/pricing.ts` — canonical pricing matrix (no changes required by this iteration; consumed by the new validator).
- Relevant handoffs received: roadmap §17 entry 2026-05-17 §2 surfaced the smoke observation; user confirmed scope of "close the bypass via UI non-editable + server-side validator" on 2026-05-17 after the ADR-013 ambiguity was resolved.
- External dependencies or environment assumptions: Next.js 16.2.6 App Router. Supabase migration delivery via `mcp__supabase__apply_migration` (or Dashboard SQL Editor fallback while G7 ledger reconciliation is pending). No new npm dependencies expected.

### RISK SNAPSHOT
- Known risks before starting:
  - Legacy `lead_proposals` rows have `project_type = null` and `complexity = null`. The validator must skip revalidation for these rows when they are re-issued for payment, or it will reject every legacy proposal.
  - The pricing matrix in `lib/maxwell/pricing.ts` is a TypeScript-side enum, not a DB enum. Validator behavior must match Maxwell's behavior exactly; any drift (e.g., a matrix update that only ships in `pricing.ts` without updating the validator) would silently allow mismatches. Mitigation: validator imports `computePricing` directly, so one source of truth.
  - The Maxwell LLM occasionally produces tool calls with arithmetic drift (model rounds, off-by-one, currency mix). The server-side validator catches these and returns a structured error. Maxwell needs to either retry with corrected math or surface the error to the seller.
  - UI dropdowns introduce a discoverability tradeoff: sellers used to typing `$1000` may find the matrix-only path more rigid. Mitigation: the helper block below the dropdowns shows the computed total live, so the seller sees the matrix's output before submitting.
  - `seller_fees.amount` (existing column from migration `0043`) is separate from `proposal.amount`. Maxwell already accounts for this via the system prompt; the new flow must not introduce a double-charge or double-credit by accident.
- Known blockers before starting: none.
- Known assumptions before starting: the existing `proposal` form mounting in `components/lead-detail.tsx` is the only UI surface that creates outbound proposals. Maxwell's `create_proposal` tool is the only programmatic path. No other surface (admin script, seed, etc.) creates outbound proposals at runtime.

### CONTINUITY NOTES
- Previous session relevant to this one: same session — ADR-013 was just drafted and is committing alongside this spec on branch `docs/adr-013-seller-fee-additive-pricing`.
- Expected next skill after this session if all goes well: system-architecture for the schema + validator + Maxwell tool contract. Implementation starts in a new session.

---

## Task Summary

Close the proposal-amount bypass: make `proposal.amount` for outbound proposals derive structurally from `project_type` + `complexity` + `seller_fee_amount`, eliminating the manual-input override. Persist `project_type` and `complexity` on `lead_proposals` so server-side revalidation is authoritative and so future audit / refund flows can reconstruct the formula. Update Maxwell's tool contract and prompt to declare the same fields explicitly and to clarify that `amount` is the `activationFinal`. Touch the UI form last, after the backend is authoritative; the UI rewire is then purely a presentation change.

The implementation lands in four ordered chunks:

1. **Schema** — additive migration adds two nullable columns to `lead_proposals`.
2. **Server-side validator + API integration** — new module under `lib/server/leads/`; wired into the `POST /api/leads/[leadId]/proposals` route after the existing schema parse.
3. **Maxwell tool + prompt** — `create_proposal` tool gains `projectType` + `complexity`; system prompt clarifies `amount = activationFinal` and replaces the `$100 fijo` hard-code with parameterized seller-fee copy.
4. **UI rewire** — `components/lead-detail.tsx` removes the editable amount input, adds two dropdowns + the computed-total helper block. Pure presentation; server is already authoritative.

Each chunk is independently testable. Chunks 1 and 2 can ship together (one PR) because chunk 2 depends on chunk 1's columns. Chunks 3 and 4 are separable but recommended in one PR because both touch the seller-facing flow and shipping them apart would create a one-merge window where Maxwell asks for `projectType` but the UI form doesn't expose it (or vice versa).

Path J's deletion (commit `baf14bf` on PR #58) is already complete; this iteration starts from the post-revert state where the proposal API has no amount-related validation beyond the existing Zod schema.

---

## Scope Boundary

### In scope

- Migration `0047_phase_19a_proposal_pricing_context.sql` adding `project_type text` and `complexity text` to `lead_proposals`. Both nullable, no DB CHECK constraints.
- New module `lib/server/leads/proposal-amount-validation.ts` exporting `assertOutboundProposalAmountMatchesPricing(payload, projectType?, complexity?, channel)` and a typed error class `ProposalAmountPricingMismatchError extends ApiError` (status 422, code `PROPOSAL_AMOUNT_PRICING_MISMATCH`).
- Wire the validator into `app/api/leads/[leadId]/proposals/route.ts` `POST` after the existing schema parse and after `getLeadById`. The validator runs for outbound proposals only; inbound skip.
- Update `createLeadProposalSchema` in `lib/server/leads/proposal-schema.ts` to accept optional `projectType` and `complexity` fields (Zod enums matching `ProjectType` and `Complexity` from `lib/maxwell/pricing.ts`).
- Update `app/api/maxwell/route.ts` `create_proposal` tool definition: add `projectType` and `complexity` to the Zod input schema, with descriptions that point to the same enums.
- Update `lib/maxwell/system-prompt.ts`: (a) `Regla Outbound` block changes from `$100 fijo` to parameterized copy referring to the seller-chosen fee from inputs; (b) `create_proposal` reference section adds: *"El campo `amount` debe ser el precio final de activación (activationFinal = activationBase + sellerFeeAmount), no el precio base."*; (c) the system prompt mentions the new `projectType` + `complexity` fields the tool now accepts and reminds the LLM to pass them.
- Rewire `components/lead-detail.tsx` proposal form: remove the editable `Monto estimado` `<Input>`; add two `<Select>` dropdowns for `Tipo de proyecto` and `Complejidad estimada`; add a derived helper block rendering `Base de activación`, `Tu comisión`, and `Total al cliente` computed from `computePricing()`; the submitted `amount` to the API is the computed `activationFinal`.
- Tests:
  - Unit tests for the new validator covering: (a) outbound + matrix-exact amount → ok, (b) outbound + arbitrary amount → rejects, (c) inbound → skip, (d) outbound + legacy null projectType → skip (per consequences §legacy), (e) one test per matrix cell × 3 sellerFee values (15 cells × 3 = 45 cases; can use parametric loop).
  - Schema test for new optional fields.
  - Existing tests (`tests/server/leads/proposal-schema-create.test.ts`, `tests/server/maxwell/pricing.test.ts`) continue to pass.
- Documentation:
  - `docs/context/project.context.core.md` operating rule about `proposal.amount` deriving from `computePricing()` for outbound + non-editable in the UI.
  - `docs/runbooks/cutover-pilot.md` §5 entry on the bypass closure and what to do if a legacy proposal needs to be re-issued.
  - Roadmap §16 entry tracking the bug closure (next available ID, ADR-013 reference, this spec reference).

### Out of scope

- Re-running `lib/maxwell/pricing.ts` matrix values. The matrix is unchanged.
- Changing the seller fee enum (100/300/500). ADR-007 owns that; no change here.
- Touching the Stripe checkout flow (`lib/server/stripe/service.ts`) or the webhook split (`app/api/webhooks/stripe/route.ts`). Both are correct under the additive model; this iteration leaves them alone.
- Touching inbound proposal creation. Inbound has no seller fee and no `projectType` / `complexity` UI flow today; revalidation skips inbound entirely.
- Adding DB-level CHECK constraints on `project_type` or `complexity`. Validation at the API layer is sufficient because the enum lives in TypeScript (`lib/maxwell/pricing.ts`); a DB enum would force a migration for every matrix update.
- Backfilling legacy `lead_proposals` rows with `projectType` / `complexity`. Legacy rows remain unchanged; the validator skips them when null.
- Building any admin / PM override that lets a non-Maxwell amount through. If override capability is ever needed, it lands in a separate iteration with explicit authorization scope.
- v3 Phase 5 AI MVP pipeline integration. The schema change here is forward-compatible with v3 Phase 5; the integration itself is deferred per roadmap §9.

---

## Affected Files / Modules

| File | Change |
|---|---|
| `supabase/migrations/0047_phase_19a_proposal_pricing_context.sql` (new) | Adds `project_type text` and `complexity text` (nullable, no defaults, no CHECK) to `public.lead_proposals` |
| `lib/server/supabase/database.types.ts` | Regenerate (or manual override per G7) to surface the two new columns in `lead_proposals` Row / Insert / Update |
| `lib/server/leads/proposal-schema.ts` | Add `projectType` and `complexity` optional fields to `createLeadProposalSchema` |
| `lib/server/leads/proposal-amount-validation.ts` (new) | Validator function + typed error class; consumes `computePricing` from `lib/maxwell/pricing.ts` |
| `app/api/leads/[leadId]/proposals/route.ts` `POST` | Inject the validator between `getLeadById` and `createLeadProposal`; pass `projectType` + `complexity` into the insert payload |
| `lib/server/leads/proposal-mappers.ts` | Pass the two new fields through `mapCreateLeadProposalInputToInsert` and surface them in the wire-shape mapper |
| `app/api/maxwell/route.ts` | `create_proposal` tool: add `projectType` + `complexity` to input schema; pass them into the same insert |
| `lib/maxwell/system-prompt.ts` | Three edits as listed in `## Scope Boundary` |
| `components/lead-detail.tsx` | UI rewire: remove editable amount; add two Selects; render computed-total helper; submit computed `amount` |
| `tests/server/leads/proposal-amount-validation.test.ts` (new) | Unit tests per `## Scope Boundary` `Tests` |
| `tests/server/leads/proposal-schema-create.test.ts` | Extend with `projectType` / `complexity` acceptance and rejection cases |
| `docs/context/project.context.core.md` | New operating rule entry |
| `docs/runbooks/cutover-pilot.md` | §5 entry on the closure |

---

## Success Criterion

The iteration is COMPLETE when all of the following hold:

1. Migration `0047` is applied to `pdotsdahsrnnsoroxbfe` and verified via `mcp__supabase__list_tables` (or Dashboard SQL Editor read) showing the two new columns.
2. `POST /api/leads/[leadId]/proposals` rejects an outbound proposal where `amount !== computePricing(projectType, complexity, 'outbound', sellerFeeAmount).activationFinal` with `422 PROPOSAL_AMOUNT_PRICING_MISMATCH`.
3. `POST /api/leads/[leadId]/proposals` accepts an outbound proposal where the amount matches the matrix; the resulting row in `lead_proposals` has `project_type` and `complexity` populated.
4. `POST /api/leads/[leadId]/proposals` accepts inbound proposals unchanged (no revalidation), including legacy rows with null `project_type` / `complexity`.
5. `app/api/maxwell/route.ts` `create_proposal` tool accepts `projectType` + `complexity` and Maxwell's persisted proposals carry both fields.
6. `components/lead-detail.tsx` shows two dropdowns + a computed-total block; the `Monto estimado` editable input is gone. The submitted amount equals `computePricing(...).activationFinal`.
7. All existing tests (current baseline 238) continue to pass; new tests are added per `## Scope Boundary` `Tests` and pass.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green.
9. `docs/context/project.context.core.md` updated with the operating rule.
10. `docs/runbooks/cutover-pilot.md` updated with the §5 entry.
11. Validator (system-validator skill) returns COMPLETE.

---

## Implementation Chunks

### Chunk 1 — Schema migration (~30 min)
Single migration file. Apply remote via Supabase MCP (or Dashboard SQL Editor if MCP auth has expired — G7 ongoing). Verify columns appear in `list_tables`. Regenerate `database.types.ts` if MCP auth works; otherwise manual override per the B3 / F-V06 pattern.

### Chunk 2 — Server-side validator + API integration (~2-3 h)
Net-new module + schema update + route wire. Tests: 45 matrix cases + 4 edge cases (inbound, legacy null, missing seller fee, malformed enum). Validator returns typed `ApiError`; `toErrorResponse` already serializes it.

### Chunk 3 — Maxwell tool + system prompt (~1-2 h)
Two-file change with one shared concern: the tool's input schema and the prompt must agree on the field names. Test approach: smoke a single Maxwell session in dev with a synthetic lead; verify the LLM passes `projectType` + `complexity` correctly and that the persisted proposal carries both. Maxwell's natural-language reasoning is not unit-testable; the smoke is the validation.

### Chunk 4 — UI rewire (~2 h)
Replace `<Input>` with two `<Select>`. Local computation via `computePricing()` on every change. Submit the computed `amount` to the API. The server is authoritative; UI is friendly defaults. No new tests (the existing flow tests still exercise the API path).

### Chunk 5 — Documentation + closure (~30 min)
Operating rule, runbook entry, roadmap §16 gap closure, validator pass.

---

## template-session-close
> Filled per session-templates skill before the iteration is declared closed.

### WORK COMPLETED
- (deferred — this spec is the system-analysis output; implementation chunks are tracked by their own PRs, each calling back to this spec)

### FINDINGS
- The pricing model is already additive end-to-end via Maxwell. No checkout / webhook math changes are needed.
- The bypass vector is the editable `Monto estimado` UI input. Closing it is the entire scope of this iteration.
- The Maxwell system prompt has a non-load-bearing ambiguity around `amount` semantics; clarifying it is included as defense-in-depth.

### NEXT STEPS
- Once Chunk 1 + 2 land (single PR), Chunks 3 + 4 can be parallelized if two devs are available; otherwise sequential.
- Chunk 5 closes the iteration. Validator must pass before declaring COMPLETE.
- Path G (wallet reversal RPC on refund) and Path C (FASE 3 lifecycle auto-credit) from roadmap §17 remain independent of this iteration and can run in any order before or after.
