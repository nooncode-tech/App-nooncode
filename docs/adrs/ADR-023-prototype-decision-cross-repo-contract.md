# ADR-023: Prototype-decision cross-repo wire contract — third inbound webhook entry, dual-gate rejection, Option β draft

**Status:** Accepted
**Date:** 2026-05-23
**Deciders:** Pedro (Engineering owner), system-architecture
**Supersedes:** None
**Related:**
- ADR-010 (client portal lives in NoonWeb — App is operator-only; the prototipo-decision client surface is owned by NoonWeb)
- ADR-013 (seller-fee additive pricing — Option β leaves the `seller_fees` row absent until the seller picks 100 / 300 / 500)
- ADR-014 (migration ledger reconciliation — applies to the new persistence introduced by D-arch-3 + R4 follow-up)
- ADR-016 (transport-level webhook ledger pattern — the new endpoint sits behind the same `website_webhook_events` ledger, identity-key shape `(endpoint, signature_hash)` unchanged)
- ADR-022 (Stripe Connect dormant — format precedent, orthogonal payment surface, no overlap)
- `docs/integrations/cross-repo-webhook-v1.md` (the doc this ADR extends with the third symmetric inbound entry)
- `specs/fase-3-prototipo-decision-cross-repo-contract.md` (iteration spec; Architecture handoff input)
- Project memory `project_maxwell_chat_lead_creation_flow.md` (4 operator-locked decisions formalized here)

---

## Context

The Maxwell chat lead-creation flow (locked 2026-05-23 in project memory) introduces a new client decision moment that does not exist today: the client final accepts or rejects the **prototipo** (a deployed working artifact at a real Vercel URL) in a NoonWeb route `/maxwell/prototipo/[token]`. On accept, the seller goes back into App to complete a propuesta for PM review; on reject (with notes), the seller may regenerate the prototipo as V2, V3, etc., subject to gating.

The existing cross-repo wire contract `docs/integrations/cross-repo-webhook-v1.md` defines two symmetric inbound entries (`inbound-proposal`, `payment-confirmed`) and one outbound (`proposal-review-decision`). None of them covers the prototipo-decision moment. NoonWeb cannot build the new route without a firmed protocol; App cannot wire the dual-gate regenerate logic without a firmed handler shape; both sides risk drift if either builds against an assumed contract.

Architecture's job in this iteration is to firm the wire contract and the decisions that gate downstream implementation slices (B-slice persistence + Gate B cap; C-slice endpoint code; D-slice NoonWeb route). No code lands in this iteration; the deliverable is this ADR plus the §5 extension of the cross-repo contract document.

Five questions surface as architecturally load-bearing:

- **Q-arch-1** — How does NoonWeb identify which prototipo the decision applies to in the payload (opaque token, UUID, or both)?
- **Q-arch-2** — What is the TTL / invalidation lifecycle of the share token (calendar-bounded, state-bounded, or none)?
- **Q-arch-3** — Where does the client decision persist (extend `prototype_workspaces`, or separate `prototype_decisions` table)?
- **Q-arch-4** — What error code taxonomy does the endpoint surface for the operator-visible failure modes the NoonWeb portal must render?
- **Q-arch-5** — Is the post-accept Maxwell draft creation transactional with the decision recording, queued, or fire-and-forget?

Four operator decisions from project memory enter this ADR as **immutable inputs** that frame the wire contract — they are not relitigated here:

- **L-1.** Client decides on prototipo, not propuesta. The existing `lead_proposals.review_status` PM-review path stays as-is.
- **L-2.** Pull pattern B.2: NoonWeb fetches prototipo data from App at render time; App is system of record.
- **L-3.** Option β: on client accept, Maxwell drafts a propuesta with `title`, `body`, `project_type`, `complexity` populated; the seller chooses the seller fee explicitly per ADR-013.
- **L-4.** Dual-gate regenerate control: Gate A (existing credit cost) AND Gate B (iteration cap per lead, default 3, admin-configurable). Both must pass for a regenerate to fire.

---

## Decision

The third inbound webhook entry **`prototype-decision`** is defined symmetrically with the existing two. The full wire-level shape lives in `docs/integrations/cross-repo-webhook-v1.md` §5 (added in the same iteration as this ADR); this section defines the architectural decisions that bound it.

### D1 — New inbound endpoint, transport-level ledger reused verbatim per ADR-016

A new endpoint `POST /api/integrations/website/prototype-decision` is added to App, accepting signed JSON from NoonWeb. The endpoint:

- Reuses the v1 HMAC-SHA256 protocol of `docs/integrations/cross-repo-webhook-v1.md` §2 (same shared secret `NOON_WEBSITE_WEBHOOK_SECRET`, same `x-noon-timestamp` + `x-noon-signature` headers, same ±5min clock-skew window, same byte-fidelity signing input `${timestamp}.${bodyText}`).
- Sits behind the existing `website_webhook_events` ledger per ADR-016, with the discriminator value `'prototype-decision'` added to the table's `CHECK (endpoint in (...))` constraint and to the helper's `WebsiteWebhookEndpoint` union type. Identity key is the same shape `(endpoint, signature_hash)`; bit-identical replay returns the same wire response with HTTP 200 (`idempotent: true`).
- Reuses the v1 error envelope per §6 (`{ error, code, requestId }`) and the v1 rate limit shape per §7 (120 req/min) with a new independent counter namespace `prototype-decision`.

**No variant idempotency scheme is invented.** A `decision_id` UUID in the payload, a `Idempotency-Key` header, or any other payload-level dedup mechanism is explicitly forbidden — the transport ledger is the single idempotency layer per ADR-016 D2. This closes R5 in the iteration spec.

### D2 — Q-arch-1 resolved: `token` is authoritative; `prototype_workspace_id` is defensive cross-check

The payload carries **both** `token` (opaque, App-issued) and `prototype_workspace_id` (UUID, already in NoonWeb's hand from the Pull B.2 render fetch).

- **Authoritative:** the handler resolves `token` → `prototype_workspace_id` server-side via the `prototype_workspaces.share_token` column (added by R4-adjacent persistence — see D5 below). Token possession = decision authority.
- **Defensive:** the handler cross-validates that the resolved row's `id` equals the `prototype_workspace_id` sent by NoonWeb. Mismatch returns `409 Conflict` with `PROTOTYPE_DECISION_IDENTIFIER_MISMATCH`. This defends against (a) NoonWeb-side stale-cache bugs sending a decision against a regenerated workspace, and (b) any future scenario where token rotation outpaces NoonWeb's render cache.
- **Audit:** both values are persisted on the decision row for forensic traceability.

This matches the defensive posture of the existing inbound entries which carry redundant `external_session_id` + `external_proposal_id` for the same reasons. Cost of the redundancy is one extra `text` column on the payload and one extra equality check in the handler — trivial.

### D3 — Q-arch-2 resolved: state-driven invalidation, no calendar TTL

The share token has **no calendar TTL** and is invalidated by lifecycle events on the workspace, not by elapsed time. Concretely:

- **V1 token is alive** as long as the V1 prototipo is the current artifact under the lead.
- **Regenerate → V2 invalidates V1.** The B-slice persistence (next iteration) will model regenerate as a state transition that issues a fresh `share_token` value and marks the prior token superseded (column `share_token_superseded_at` non-null, or equivalent — schema detail belongs to B-slice). A decision posted against a superseded token returns `410 Gone` with `PROTOTYPE_DECISION_TOKEN_EXPIRED`.
- **Accept terminates the token.** Once a decision is recorded as `accepted`, the token is logically terminal — a second decision (accept or reject) against the same token returns `409 Conflict` with `PROTOTYPE_DECISION_ALREADY_DECIDED` (modulo bit-identical replay, which returns `200 idempotent: true` per D1).
- **Reject does NOT invalidate the token by itself.** A rejected prototipo remains visible to the client at the same URL until the seller regenerates V2 (which then supersedes V1 as above). This preserves the audit trail "client rejected V1 with notes X; seller regenerated; client accepted V2".
- **Hard-delete of the parent lead invalidates the token implicitly** via FK cascade on `prototype_workspaces.lead_id`. A decision posted against a deleted lead returns `410 Gone` with `PROTOTYPE_DECISION_LEAD_DELETED`.

Rationale for no calendar TTL: a calendar bound would create a dead-letter UX when a legitimate client opens the URL after the bound (e.g., they came back from vacation). State-driven invalidation aligns with the actual semantics ("decide on the current artifact"). If operator later needs explicit offer-expiration semantics for legal reasons, that becomes a higher-layer concern on the workspace (e.g., a `prototype_offer_expires_at` field used by NoonWeb to render an "offer expired" page before the client clicks), distinct from token validity.

NoonWeb's pull at render time (Pull B.2) sees the workspace's current `share_token` and current invalidation state and renders the appropriate UX. The decision endpoint only enforces the contract at submit time.

### D4 — Q-arch-3 resolved: separate `prototype_decisions` table with FK to `prototype_workspaces`

Persistence of the client decision is a **separate table** `prototype_decisions`, not a column extension on `prototype_workspaces`. Architectural reasons:

1. **Dual-gate regenerate naturally produces multiple decision events per lead.** V1 rejected with notes → V2 generated → V2 accepted is 2 decisions across 2 workspace rows. The cross-row history is the architectural unit of truth, not a single field on the latest workspace.
2. **Iteration-cap accounting (Gate B) reads the decision history naturally.** A `select count(*) from prototype_decisions where workspace_id in (select id from prototype_workspaces where lead_id = ?)` (or equivalent grouped query) is the simplest evaluation of "how many decisions has this lead seen". Putting a counter column on `prototype_workspaces` would either duplicate the count or force a single-workspace-per-lead model that contradicts the regenerate semantics in D3.
3. **Future audit / re-evaluation flows benefit from an event log.** "Show me every rejection a client made on this lead with the seller's response time and the regenerate that followed" is a natural query against `prototype_decisions` joined to `prototype_workspaces`.

**Schema shape (B-slice implements this in the next iteration; recorded here as architectural truth):**

```sql
create table public.prototype_decisions (
  id uuid primary key default gen_random_uuid(),
  prototype_workspace_id uuid not null
    references public.prototype_workspaces(id) on delete cascade,
  lead_id uuid not null
    references public.leads(id) on delete cascade,
  decision text not null check (decision in ('accepted', 'rejected')),
  notes text,
  client_user_agent text,                 -- NULL if NoonWeb did not forward
  webhook_event_id uuid                   -- FK soft-link to website_webhook_events.id; not enforced
    references public.website_webhook_events(id) on delete set null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_prototype_decisions_workspace
  on public.prototype_decisions(prototype_workspace_id);
create index idx_prototype_decisions_lead
  on public.prototype_decisions(lead_id);
create index idx_prototype_decisions_decided_at
  on public.prototype_decisions(decided_at desc);

-- One terminal decision per workspace (accepted OR rejected, not both, not twice).
create unique index ux_prototype_decisions_workspace_one_terminal
  on public.prototype_decisions(prototype_workspace_id);
```

RLS scope (final design lives in B-slice migration): admin / sales_manager see all; sales sees own (rows whose workspace's lead is assigned to or created by them); pm sees rows under leads visible to pm scope; developer structurally excluded. Service role (admin client) writes from the webhook handler; no `authenticated` INSERT/UPDATE/DELETE policies.

**Note on `prototype_workspaces` evolution:** B-slice also adds `share_token text unique` and `share_token_superseded_at timestamptz` to `prototype_workspaces` to model the lifecycle in D3, plus extends `prototype_credit_settings` with `max_iterations_per_lead integer not null default 3 check (max_iterations_per_lead > 0)` for Gate B. Architecture flags these for B-slice; the migration itself is not in this iteration.

### D5 — Q-arch-4 resolved: 5 prototype-specific error codes, all reuse §6 error envelope

The new endpoint surfaces exactly five prototipo-specific error codes plus the inherited common codes. Each maps to a deterministic NoonWeb-portal UX state.

| HTTP | Code | When | NoonWeb portal UX |
|---|---|---|---|
| `404` | `PROTOTYPE_DECISION_TOKEN_NOT_FOUND` | `token` does not resolve to any `prototype_workspaces.share_token` | "Este link no es válido" — terminal copy, no retry |
| `409` | `PROTOTYPE_DECISION_ALREADY_DECIDED` | The resolved workspace already has a `prototype_decisions` row whose decision differs from the current request, OR same decision but the webhook is NOT a bit-identical replay (different signature_hash) | "Ya respondiste a este prototipo" — show the prior decision in read-only form |
| `409` | `PROTOTYPE_DECISION_IDENTIFIER_MISMATCH` | `token` resolves to workspace A but the payload's `prototype_workspace_id` is B (≠ A) | "El link no corresponde al prototipo solicitado" — terminal copy, likely NoonWeb cache bug. Log structured. |
| `410` | `PROTOTYPE_DECISION_TOKEN_EXPIRED` | The resolved workspace has `share_token_superseded_at` non-null (regenerated to V2+) | "Este prototipo fue actualizado. Pedile al vendedor el nuevo link." |
| `410` | `PROTOTYPE_DECISION_LEAD_DELETED` | The parent lead row has been hard-deleted (rare; FK cascade should already have removed the workspace, but defensive code path) | "Este prototipo ya no está disponible." |
| `400` | `PROTOTYPE_DECISION_INVALID_DECISION` | `decision` field not in `{'accepted', 'rejected'}` after Zod validation. Belt-and-suspenders against schema drift | Generic validation error rendered to NoonWeb. |
| Inherited from §6 | `WEBSITE_WEBHOOK_AUTH_FAILED` (401), `(validation)` (400), `(rate limit)` (429), `INBOUND_*_FAILED` analogue → reuse the namespace pattern: `PROTOTYPE_DECISION_PERSIST_FAILED` (500) for DB write errors |  |  |

**Bit-identical replay rule:** before returning `409 PROTOTYPE_DECISION_ALREADY_DECIDED`, the handler checks if the inbound request is a bit-identical replay of the original (same `(endpoint, signature_hash)` already in the ledger with terminal status). If yes, the handler returns the same wire-shape `200` response the original run produced, per ADR-016 D6. The `409` triggers only for **conflicting** new decisions or non-identical retries (e.g., NoonWeb re-sending with a refreshed timestamp).

**Schema drift insurance:** the error code namespace `PROTOTYPE_DECISION_*` is registered in the helper module's TypeScript union when C-slice ships; the contract doc enumerates them in §5.5 verbatim with this ADR as the cite.

### D6 — Q-arch-5 resolved: hybrid transactionality — decision sync, Maxwell draft fire-and-forget

The endpoint's transactionality model is hybrid:

1. **Synchronous in the request:**
   - HMAC verify + ledger claim per ADR-016 (transport idempotency).
   - Token resolution + cross-validation (D2) + lifecycle checks (D3).
   - INSERT into `prototype_decisions` recording the decision. This is the load-bearing persistence; if it fails, the webhook fails and NoonWeb's UX surfaces the error to the client (correct behavior — client should retry or contact the seller).
   - Mark ledger row processed.
   - Return `200` to NoonWeb.

2. **Fire-and-forget (only when `decision === 'accepted'`):**
   - Maxwell draft propuesta creation (Option β: title, body, project_type, complexity populated; NO `seller_fees` row created). Implemented in C-slice as an async helper invoked **after** the response is sent — explicit pattern: a background task that runs inside the request lifecycle using a deferred promise (Node `setImmediate`/`queueMicrotask`-style; the exact runtime mechanism is C-slice's choice). The decision persistence is already committed; the draft creation runs against committed state.
   - If the Maxwell draft creation fails:
     - The decision row stays in place (correct: the client did accept; the system of record reflects that).
     - A structured log entry `prototype.decision.accepted.draft_creation_failed` fires with the workspace id, the lead id, the seller id, and the error.
     - The seller is notified via the existing in-app notifications pipeline (`user_notifications` fan-out from a decision-accepted activity event) that the prototipo was accepted but the draft propuesta needs manual creation. The notification points the seller to the lead detail; the seller can use the existing `/dashboard/leads` proposal-create flow as a fallback.
     - No automatic retry. Operator escalation is the explicit fallback because a Maxwell draft failure usually indicates a systemic issue (LLM down, prompt drift) that benefits from human investigation, not retry storms.

**Rationale for hybrid over pure async (queue) or pure sync:**

- **Pure sync** would mean the webhook waits on the Maxwell LLM call before returning to NoonWeb. Maxwell calls take 5-30s; webhook timeouts at NoonWeb's HTTP client (default 30s) would cause NoonWeb to retry and the ledger to mark it as replay. Bad UX, bad observability.
- **Pure async via queue** would require a queue infrastructure (QStash, Inngest, Postgres-based job runner) that does not exist in the App today. Adding queue infra in the same iteration that ships the endpoint would inflate scope.
- **Hybrid** captures the decision atomically (the load-bearing fact) and defers the LLM-bound side effect to a fire-and-forget background task. Observability is preserved via structured logs + notifications. Retry policy is explicit (none — operator fallback).

When real queue infrastructure lands (potentially during v3 Phase 5 when Maxwell pipeline orchestration becomes complex enough to justify it), this decision should be revisited and the fire-and-forget upgraded to a queued job with explicit retry/backoff. Recorded as a re-evaluation trigger below.

### D7 — Dual-gate regenerate enforcement: architectural declaration, B-slice implementation

The dual-gate rejection control (memory lock L-4) is declared architecturally here and implemented in B-slice. The enforcement point is **not** the prototipo-decision endpoint (the decision flow records the rejection; the regenerate flow is the gated action). It is the existing `request_lead_prototype(uuid)` RPC path used today by `app/api/leads/[leadId]/prototype/route.ts`.

When B-slice ships:

- **Gate A (credit cost) is already enforced** by the existing `request_lead_prototype` RPC which deducts `prototype_credit_settings.request_cost` and raises `INSUFFICIENT_CREDITS` (P0001) when the wallet balance is short. Unchanged.
- **Gate B (iteration cap) is added** by extending the same RPC to count the number of `prototype_workspaces` rows for the lead (or equivalently the count of distinct `prototype_decisions` plus the active workspace) and raise `P0001 ITERATION_CAP_REACHED` when `count >= max_iterations_per_lead`. The cap value is read from `prototype_credit_settings.max_iterations_per_lead` (default 3, admin-writable through the existing admin write path on `prototype_credit_settings`).
- **Orthogonality:** both gates evaluate independently. Either failing blocks the regenerate. The seller's UX surfaces which gate failed (insufficient credits vs cap reached) so the operator can act appropriately (top up credits vs escalate the lead manually).

The endpoint defined in this ADR does not enforce gates itself — it records the decision. Gates fire on the seller's next regenerate attempt.

### D8 — Pull pattern B.2 render contract: out-of-scope, contract-relevant note

Memory lock L-2 (Pull B.2) means NoonWeb will need to fetch prototipo data from App at render time of `/maxwell/prototipo/[token]`. The signed-read endpoint that serves NoonWeb's render fetch is **out of scope for this ADR and this iteration** (it's a separate inbound surface from App's perspective — a GET, not a POST decision). It is noted here so that future architecture iterations:

- Do not design the render-read endpoint as a coupled extension of `prototype-decision`. They are two different surfaces (one read for render, one write for decision).
- Reuse the same HMAC protocol from `docs/integrations/cross-repo-webhook-v1.md` §2 for the render-read endpoint (App is the server in both directions of this protocol — same shared secret, same headers, same auth surface).
- Treat the share token as the natural request key for the render-read (same as the decision write).

The render-read iteration is a future Architecture concern. This ADR establishes that the decision-write contract assumes such a render-read exists in NoonWeb but does not specify or constrain it.

### D9 — R4 verification result: `lead_proposals` has no `seller_fee_amount` column; Option β is naturally enforced

R4 in the iteration spec flagged a verification owed: confirm `lead_proposals.seller_fee_amount` is nullable on draft so Option β (Maxwell drafts with the fee field blank) is implementable.

**Verification (this ADR, 2026-05-23):** `lead_proposals` does NOT have a `seller_fee_amount` column. Verified by reading `supabase/migrations/0004_phase_2c_lead_proposals.sql` (base schema), all subsequent migrations that touch `lead_proposals` (`0026_phase_9a_stripe_payments.sql`, `0027_phase_3_proposal_lifecycle.sql`, `0047_phase_19a_proposal_pricing_context.sql`), and `lib/server/supabase/database.types.ts` (current type contract lines 257-337). The seller fee is stored in the **separate** `seller_fees` table (migrations `0043_phase_18a_seller_fees.sql` + `0044_phase_18b_seller_fees_rls.sql`) with `amount numeric(12,2) not null check (amount in (100, 300, 500))` and `state public.seller_fee_state not null default 'potential'`. One row per `lead_proposals.id` via `proposal_id uuid not null unique`.

**Implication for Option β:** the architectural constraint is satisfied **by construction**. Maxwell drafts a `lead_proposals` row populating `title`, `body`, `project_type`, `complexity` (the four inferable fields). It does **not** create a `seller_fees` row. The seller explicitly picks the fee in the App UI (post-acceptance flow, implemented in a later iteration), at which point a `seller_fees` row is created with `state = 'potential'` and `amount in (100, 300, 500)`. ADR-013 §enforcement is preserved: the seller's choice is the only writer of the fee value, and the CHECK constraint forbids any value outside `{100, 300, 500}`.

No schema change is required to enable Option β. The R4 risk is **closed**.

**Side observation flagged but not blocking:** the `lead_proposals.amount` column is `not null default 0` (line 20 of migration 0004). Maxwell's draft must persist an `amount` value. Per ADR-013, `amount = computePricing(projectType, complexity, channel, sellerFeeAmount).activationFinal`. With `seller_fees` absent at draft time, `sellerFeeAmount` is unknown; therefore `amount` cannot be computed at draft time. **The draft must persist `amount` as a placeholder** (e.g., the activation base `computePricing(...).activationBase` with `sellerFee = 0` as a temporary, or `0` as a sentinel) and the seller's explicit fee-pick UI must recompute and update `amount` before the propuesta is sent to PM review. This is a **C-slice contract requirement**, not a schema gap, and is flagged here so the implementation iteration does not silently violate the ADR-013 invariant (`amount = base + sellerFee`) by leaving the placeholder in production. The proposal API's existing `proposal-amount-validation.ts` validator from ADR-013 already enforces this at submit-to-PM time; the draft state must not be sendable until the seller has overridden the placeholder.

---

## Architectural truth (capture for project memory and future sessions)

To remove ambiguity:

| Concept | Where it lives | Authority |
|---|---|---|
| Prototype share token issuance | App, on workspace creation / regenerate (B-slice adds `prototype_workspaces.share_token`) | App |
| Prototype render content | App (Pull B.2: NoonWeb fetches at render time via a future signed-read endpoint) | App is system of record |
| Client decision URL | NoonWeb `/maxwell/prototipo/[token]` (D-slice, NoonWeb-side build) | NoonWeb |
| Client decision capture | App `POST /api/integrations/website/prototype-decision` (C-slice) | App |
| Decision persistence | `public.prototype_decisions` (B-slice migration) | App |
| Regenerate gating | Existing `request_lead_prototype(uuid)` RPC extended with Gate B (B-slice) | App |
| Post-accept Maxwell draft propuesta | App fire-and-forget after decision recorded (C-slice; future: queued) | App |
| Seller-fee selection on the draft | Seller UI in App (post-C-slice iteration); `seller_fees` row created at that point per ADR-013 | App seller |
| PM review of the propuesta | Existing `lead_proposals.review_status` flow (unchanged) | App PM |

The four operator decisions (L-1 to L-4) and the five Q-arch decisions (D2 to D6) are immutable inputs to all subsequent slices. Any iteration that proposes to alter them must open a new ADR that supersedes this one.

---

## Rationale

### Why this contract iteration ships ahead of the build slices

Three reasons:

1. **Decoupling.** NoonWeb-dev and App-dev can build in parallel against the firmed contract. Without the contract, every NoonWeb-side design decision risks needing rework when App-side reality emerges, and vice versa.
2. **Cross-repo coordination cost.** Per `docs/integrations/cross-repo-webhook-v1.md` §14, contract changes require simultaneous PRs. Firming the contract once, ahead of build, means the build slices land independently without further cross-repo sync.
3. **Architectural decisions need ADR durability.** The 5 Q-arch decisions are the kind that produce subtle bugs if redecided per-iteration. ADR-023 freezes them.

### Why dual gates instead of one

Gate A (credit cost) bounds total seller spend. Gate B (iteration cap) bounds dead-loop on a single fundamentally-rejected concept. They close orthogonal failure modes. A seller with infinite credits could otherwise burn iterations forever on a lead that will never convert; a seller without credits cannot regenerate even a promising V2 idea. Both are real failure modes; both deserve a gate.

### Why hybrid transactionality (D6) instead of pure async

Two reasons already in D6:
- No queue infrastructure exists today; adding one inflates scope.
- Webhook timeout pressure makes sync-on-Maxwell unacceptable.

Hybrid captures the load-bearing fact (the decision) atomically and degrades gracefully on the side-effect (operator fallback via notification). It is the smallest design that satisfies the requirement without requiring infrastructure scope-creep.

### Why state-driven token invalidation (D3) instead of calendar TTL

Calendar TTL creates dead-letter UX for legitimate late clients. State-driven invalidation matches the actual product semantic ("decide on the current artifact"). If a legal-team-driven offer-expiration requirement surfaces later, it lives on the workspace, not on the token.

### Why a separate `prototype_decisions` table (D4) instead of columns on `prototype_workspaces`

Three reasons in D4:
- Regenerate produces multiple decisions across multiple workspaces — naturally an event log.
- Gate B counts decisions, a query against the log is natural.
- Audit / re-evaluation flows benefit from event-level granularity.

A column extension on `prototype_workspaces` would either lose history on regenerate (overwriting V1's decision when V2 is created) or force a single-decision-per-workspace model that doesn't compose with the regenerate semantics.

### Why R4 was a non-issue (D9)

The spec's R4 assumed `lead_proposals.seller_fee_amount` exists. It doesn't. The seller fee has its own state-machine table (`seller_fees`, ADR-007 + ADR-013) which is created only when the seller explicitly picks the value. Option β is naturally aligned with this design — Maxwell drafts the propuesta row without creating the fee row; the seller creates the fee row when they pick. ADR-013's invariant `amount = base + sellerFee` is enforced at submit-to-PM time by the existing validator, which catches the draft-placeholder gap noted in D9.

---

## Consequences

### What this enables

- **NoonWeb-dev unblocks.** The firmed wire contract is the artifact NoonWeb-dev signs off against to build `/maxwell/prototipo/[token]` (D-slice, NoonWeb-side) including the decision-post call shape, error rendering, and replay semantics.
- **App-side B-slice unblocks.** The persistence shape (`prototype_decisions` table + `prototype_workspaces.share_token` + `share_token_superseded_at` + `prototype_credit_settings.max_iterations_per_lead`) is declared architecturally; B-slice migration writes the SQL.
- **App-side C-slice unblocks.** The endpoint shape (route file + handler in `lib/server/website-integration.ts` or a sibling module) is fully specified by the wire contract; C-slice writes the code.
- **Parallel build streams.** B-slice, C-slice, and D-slice may run independently in any order once this ADR lands. C-slice has a soft dependency on B-slice (the handler needs the table to exist), but B-slice and D-slice are fully independent.

### What this forbids

- **No payload-level idempotency scheme.** Per D1 and ADR-016, the only idempotency layer is the transport ledger. Any C-slice design that adds a `decision_id` UUID, `Idempotency-Key` header, or similar must reopen this ADR.
- **No calendar TTL on the share token.** Per D3. State-driven only.
- **No coupling of the decision-write to a Maxwell draft sync call.** Per D6. The draft creation MUST be fire-and-forget post-response.
- **No `seller_fees` row creation by Maxwell.** Per D9 + ADR-013. The seller is the only writer of that row.
- **No new client-authenticated surface in App.** Per ADR-010. The endpoint is server-to-server (NoonWeb → App), authenticated by HMAC; no client identity ever touches App.

### Required follow-up work declared by this ADR

| Slice | Owner | Description |
|---|---|---|
| B-slice (App) | system-architecture → system-backend → system-infra | Migration adding `prototype_decisions` table + `prototype_workspaces.share_token` + `share_token_superseded_at` + `prototype_credit_settings.max_iterations_per_lead`. Extends `request_lead_prototype(uuid)` RPC with Gate B. Extends `website_webhook_events.endpoint` CHECK + helper TypeScript union with `'prototype-decision'`. Per ADR-014 ledger discipline. |
| C-slice (App) | system-architecture → system-backend | Endpoint route `app/api/integrations/website/prototype-decision/route.ts` mirroring the inbound-proposal/payment-confirmed skeleton. Handler `receiveWebsitePrototypeDecision` in `lib/server/website-integration.ts` (or sibling) implementing D2/D3/D5/D6. Maxwell draft helper for fire-and-forget post-accept. Notifications fan-out on decision events. |
| D-slice (NoonWeb) | NoonWeb-dev | Route `/maxwell/prototipo/[token]` rendering Pull B.2 fetch + accept/reject UI + signed POST to the C-slice endpoint. Idempotent retry on 5xx. Renders the 5 error codes from D5 with appropriate UX. |
| Render-read endpoint (App) | future Architecture iteration | Signed GET endpoint serving NoonWeb's render-time fetch per L-2 / D8. Not in this iteration. |
| Seller fee-pick UI on the draft (App) | future Frontend iteration | UI surface for the seller to pick 100/300/500 on a Maxwell-drafted post-accept propuesta. Creates `seller_fees` row. Recomputes and updates `lead_proposals.amount`. |
| `prototype_credit_settings` admin write for `max_iterations_per_lead` | future Frontend iteration | Settings tab "Prototipos" gets a second field beside `request_cost` to set the cap. Same admin-only write pattern. |

### Active risks created or updated

- **Active risk:** until C-slice lands a queue infrastructure, the post-accept Maxwell draft is fire-and-forget. Operator notification is the fallback for draft failures. Acceptable at pilot scale; revisit at v3 Phase 5 if Maxwell pipeline complexity grows.
- **Active risk:** until D-slice ships, the contract is inert (no decisions arrive). Acceptable per iteration spec R3 (forward-investment contract).
- **Active risk:** NoonWeb-dev acknowledgment of the contract is bilateral coordination per §14. Without acknowledgment the contract is published but not adopted. Mitigation: contract doc PR tags NoonWeb-dev explicitly.

### Re-evaluation triggers

This ADR must be revisited when:

1. **Queue infrastructure lands in App** (QStash, Inngest, Postgres-based job runner). D6 hybrid should be upgraded to queued-job with explicit retry/backoff.
2. **Maxwell pipeline (v3 Phase 5) ships** and prototype generation becomes real. D8 render-read endpoint design becomes urgent at that point.
3. **A second client-facing decision surface is proposed** (e.g., "client decides on PR milestone delivery"). The pattern from D1-D6 should be lifted into a more general "client decision webhook" specification rather than re-derived per surface.
4. **The Gate B default of 3 iterations proves wrong in practice.** If sellers consistently hit the cap on legitimate refinement cycles, the default raises (or the cap moves to per-lead-type configurability).
5. **The fire-and-forget Maxwell draft fails often enough that operator escalation friction outweighs queue-infra cost.** Threshold: if operator manual draft re-creation exceeds ~1/week.

### Reactivation / migration triggers

- If v2 of the cross-repo contract introduces a schema version header (per `cross-repo-webhook-v1.md` §9), the `prototype-decision` entry migrates with the other two; no special handling.
- If a deletion is needed (e.g., the prototipo-decision flow is abandoned), the endpoint becomes a `410 Gone` redirect and the `prototype_decisions` table stays as historical record per ADR-014 conservative-deletion convention.

---

## Alternatives considered

### Alternative A — `decision_id` in payload as idempotency key

Rejected. Bifurcates idempotency reasoning across the three inbound entries; contradicts ADR-016 D2. Transport ledger is the single layer.

### Alternative B — Token-only identification (no `prototype_workspace_id` in payload)

Considered defensible (token is sufficient for resolution). Rejected for the same reason the existing entries carry `external_session_id` + `external_proposal_id`: defense-in-depth catches cross-repo state-drift bugs at trivial cost. D2 picks the both-fields path.

### Alternative C — Calendar TTL on the share token (e.g., 30 days)

Rejected per D3. State-driven invalidation matches product semantics; calendar TTL creates dead-letter UX for legitimate late clients. Calendar bound can be added later as an offer-expiration concept distinct from token validity if needed.

### Alternative D — Single decision column on `prototype_workspaces` (`client_decision` enum + timestamp + notes)

Rejected per D4. Loses history on regenerate; doesn't compose with the dual-gate iteration model.

### Alternative E — Pure async via queue infrastructure (D6 alternative b)

Rejected for scope reasons. Would require adding a queue dependency (QStash / Inngest / Postgres-based runner) in the same iteration that ships the endpoint. Hybrid is the smallest design that satisfies the requirement without scope creep. Queue path is the documented upgrade trigger.

### Alternative F — Pure sync (handler awaits Maxwell draft)

Rejected per D6 reasoning. Webhook timeout pressure makes Maxwell-bound sync unacceptable (5-30s LLM calls vs 30s NoonWeb HTTP client timeout). Would cause spurious replays and ledger churn.

### Alternative G — Gate B as a per-seller-day rate limit instead of per-lead iteration cap

Rejected by operator at memory-lock time. Penalizes high-volume good prospectors; doesn't address the dead-loop case Gate B exists to close. Already documented in memory under "Rejected alternatives".

---

## Lifecycle

- **Author:** system-architecture (Claude Code session, 2026-05-23), reviewed by Pedro
- **Supersedes:** nothing
- **Superseded by:** nothing
- **Amendments:** none

This ADR formalizes 4 operator-locked decisions from project memory and resolves 5 architecturally load-bearing questions into a single durable record. The cross-repo wire contract document `docs/integrations/cross-repo-webhook-v1.md` §5 is the wire-level extension that NoonWeb-dev reads against; this ADR is the rationale and decision register that future App-side iterations reference.
