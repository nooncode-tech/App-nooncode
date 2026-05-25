# spec.md — fase-3-prototipo-decision-cross-repo-contract

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-23
- Session ID: fase-3-prototipo-decision-cross-repo-contract
- Developer: Pedro (`noondevelop@gmail.com`)
- Main active skill: `system-analysis` (this spec); downstream chain per router: `system-architecture → system-validator → close-out`
- Router mode: **Refactor mode** (contract-definition extension over the established cross-repo webhook protocol; no implementation in this iteration)
- Depth: FULL

### ARCHITECTURAL CONSTRAINT ANCHOR (load-bearing, do not violate)
- **The client decides on the prototipo, not on the propuesta.** Locked by operator 2026-05-23. The propuesta path stays as today's PM-internal-review path (`lead_proposals.review_status`).
- **The client portal lives in NoonWeb (`noon-web-main`), not in App-nooncode** — ADR-010. Any client-visible surface for prototipo decision is OWNED by NoonWeb at route `/maxwell/prototipo/[token]`. App is operator-only.
- **Pull pattern B.2 is locked**: when client opens the NoonWeb prototipo route, NoonWeb fetches prototipo data from App via signed read at render time. App is the system of record; NoonWeb is the render layer. Do not propose Push (B.1) variants.
- **Operator-driven outbound URL share pattern is locked** (ADR-010 amendment 2026-05-14): App generates content + share token, the seller copies the NoonWeb URL inside App and shares with the client out-of-band. No client-authenticated path in App.
- **Option β is locked** for post-accept propuesta generation: on client accept, Maxwell auto-creates a draft propuesta with inferable fields filled (title, body, projectType, complexity suggestion), `seller_fee_amount` left blank so the seller chooses 100/300/500 per ADR-013. Maxwell never picks the fee.
- **Dual-gate rejection control is locked**: every prototipo regenerate must pass Gate A (credit cost via existing `prototype_credit_settings.request_cost` + `user_wallets`) AND Gate B (iteration cap per lead, default 3 = V1/V2/V3, admin-configurable). Both gates close orthogonal failure modes and must pass independently.

### OBJECTIVE
- What must be achieved in this session: produce the bounded spec that defines the WIRE CONTRACT for a new third inbound webhook entry from NoonWeb to App — `POST /api/integrations/website/prototype-decision` — so that NoonWeb's future route `/maxwell/prototipo/[token]` has a signed, idempotent, versioned protocol to post client accept/reject decisions back to App. The spec scopes the contract surface only; endpoint code, NoonWeb route, persistence schema, Maxwell pipeline, and UI changes all live in subsequent iterations.
- Why this work matters now: the Maxwell chat lead-creation flow (10-step, locked 2026-05-23 in project memory) needs the operator and NoonWeb-dev to agree on the cross-repo protocol BEFORE either side builds anything. Without a firmed contract, NoonWeb cannot build its render+post route, App cannot build the handler, and the dual-gate iteration cap cannot be wired. The contract is the artifact that unblocks parallel build streams (NoonWeb route, App handler, dual-gate persistence) in later iterations without coordination risk.
- It is NOT a "build the endpoint" iteration. Per router: depth FULL but Refactor mode (extend the established cross-repo webhook v1 contract doc with a third symmetric entry), Architecture-led. No code shipped this iteration.

### CONTEXT USED
- `project.context.core.md`: reviewed — confirms webhook treat-as rules (`Website inbound review and payment handoff now has a real App-side code path` at lines 100-111) and prototype workspace foundation (migrations `0020`, `0021`, routes `/api/leads/[leadId]/prototype`, `/api/prototypes`).
- `project.context.full.md`: reviewed — confirms `prototype_workspaces` table shape, RPC `request_lead_prototype(uuid)`, the `handoff_prototype_workspace_to_delivery(uuid)` mutation, and the wallet/credits foundation already present.
- ADR-010 (client portal lives in NoonWeb): reviewed — anchors the constraint that prototipo decision UI lives in NoonWeb, not in App.
- ADR-013 (seller fee additive pricing): reviewed — anchors why Option β leaves `seller_fee_amount` blank.
- ADR-014 (migration ledger reconciliation): reviewed — pattern for persistence decisions.
- ADR-016 (transport-level webhook ledger pattern): reviewed — anchors that the new endpoint MUST sit behind `website_webhook_events` ledger for transport-level idempotency, byte-identical to the two existing inbound entries.
- ADR-022 (Stripe Connect dormant manual payouts): reviewed — orthogonal but confirms no new payment surface is introduced here.
- `docs/integrations/cross-repo-webhook-v1.md`: reviewed in full — the new entry is the third symmetric inbound entry, must follow §2 (auth/signing), §6 (error shape), §7 (rate limiting), §8 (idempotency), and §14 (change control).
- Project memory `project_maxwell_chat_lead_creation_flow.md`: reviewed — authoritative input. 4 locked decisions and 2 open questions (Q1 NoonWeb route OUT OF SCOPE here; Q2 IS this contract iteration). Locked decisions are inputs, not subjects to relitigate.
- Previous spec `specs/fase-3-r4-inbound-earnings-auto-credit.md` (landed 2026-05-23): reviewed as template/format reference.

### ROUTER DECISION
- Mode: Refactor (contract extension over established protocol, not net-new system).
- Depth: FULL (cross-repo coordination, money-domain-adjacent because client decision triggers downstream propuesta+fee paths; ADR mandatory).
- Chain: Analysis → Architecture → Validator → close-out. No Backend / Frontend / Infra / Security implementation this iteration (no code shipped).
- Active skill rationale: 5 architecture-level questions (Q-arch-1 through Q-arch-5) must be either resolved or surfaced as defaults BEFORE the wire contract can be firmed and the contract doc extended. Analysis bounds them; Architecture resolves them in ADR-023.

### SCOPE
- In scope: see `## Scope Boundary`.
- Explicitly out of scope: see `## Scope Boundary`.
- Success criterion: see `## Success Criterion`.

### INPUTS
- Files/modules involved: see `## Affected Files / Modules`.
- Contracts or architecture inputs available: cross-repo webhook v1 doc + ADR-010/013/014/016/022 + project memory locked decisions.
- Relevant handoffs received: router handoff 2026-05-23 (this session); operator memory lock 2026-05-23 (4 decisions + 2 open questions).
- External dependencies: NoonWeb-dev will own the NoonWeb-side build against this firmed contract; coordination is out-of-band per §14 of cross-repo-webhook-v1.md change control rule.

### RISK SNAPSHOT
- Known risks before starting: see `## Risks` (R1–R5).
- Known blockers before starting: none.
- Known assumptions before starting: see `## Assumptions`.

### CONTINUITY NOTES
- Previous session relevant to this one:
  - **R4 inbound earnings auto-credit** (PR #102 merged 2026-05-23) — established the symmetric-shared-service pattern across outbound (Stripe) and inbound (NoonWeb) entry points. This iteration adds a THIRD inbound entry; the symmetry pattern is the precedent.
  - **B15 transport-level webhook ledger** (ADR-016) — established `website_webhook_events` as the first-action ledger after HMAC verify. The new endpoint MUST sit behind the same ledger.
  - **Prototype workspace foundation** (migrations 0020/0021) — established the `prototype_workspaces` table, wallet credits, and the lead→prototipo flow up to `pending_generation`. This iteration assumes that foundation exists but does not extend it.
- Expected next skill: `system-architecture` to produce **ADR-023** (next available after ADR-022) packing the resolution of Q-arch-1..Q-arch-5 plus the extension of `docs/integrations/cross-repo-webhook-v1.md` with the third symmetric entry section. Validator closes the iteration; close-out updates `project.context.core.md`, roadmap, and opens the PR for operator merge.

---

## Task Summary

Firm the WIRE CONTRACT for a new third inbound webhook entry into App, `POST /api/integrations/website/prototype-decision`, which NoonWeb will call when a client clicks accept/reject on the prototipo at `/maxwell/prototipo/[token]`. The contract must be byte-symmetric with the existing two inbound entries (`inbound-proposal`, `payment-confirmed`) in terms of auth (HMAC §2), error shape (§6), rate-limit posture (§7), transport-level idempotency via `website_webhook_events` ledger (§8.2 / ADR-016), and change control (§14).

The contract MUST express:
- The decision payload (`token` + `decision: 'accepted' | 'rejected'` + optional `notes` + any other firmed fields per Q-arch-1).
- The identity of the prototipo target (opaque token vs `prototype_workspace_id` UUID vs both — Q-arch-1).
- TTL/expiration semantics for the share token (Q-arch-2).
- The error code taxonomy for the operator-visible failure modes (token not found, already decided, expired, lead deleted — Q-arch-4).
- The transactionality of side effects (accept → Maxwell drafts propuesta — sync or async — Q-arch-5).

Idempotency MUST be bit-identical to ADR-016 pattern. App MUST NOT invent variant idempotency schemes for this entry.

The deliverable is Architecture's: ADR-023 + extension of `docs/integrations/cross-repo-webhook-v1.md` with the new §X "Inbound webhook — `prototype-decision`" section symmetric to the existing §3 and §4 sections. The wire contract becomes the firmed input for two later, independent build iterations:
- B-slice: dual-gate persistence (Gate B iteration-cap mechanism — new field on `prototype_credit_settings` + per-lead cap tracking).
- C-slice: endpoint code (`app/api/integrations/website/prototype-decision/route.ts` + handler in `lib/server/website-integration.ts`).
- D-slice (later, NoonWeb-side, out of this repo): NoonWeb route `/maxwell/prototipo/[token]`.

The build iterations do not run inside this contract iteration. This iteration FIRMS THE PROTOCOL ONLY.

---

## Scope Boundary

### In scope

- **Wire contract definition** for `POST /api/integrations/website/prototype-decision`: payload schema, required vs optional fields, identifier semantics (token + optional UUID per Q-arch-1), success response shape, error response shape (reusing common §6 error envelope), HTTP status code matrix, idempotency model, rate limit posture.
- **Locking the 4 operator decisions as INPUTS** (not subjects to relitigate): client-decides-on-prototipo, Pull pattern B.2 render, Option β post-accept draft, dual-gate rejection control with Gate A credits + Gate B iteration cap default 3. These are declared in the spec as load-bearing input; Architecture documents them in ADR-023 but does not re-decide them.
- **Extension of `docs/integrations/cross-repo-webhook-v1.md`** with the new section (symmetric to §3 `inbound-proposal` and §4 `payment-confirmed`). The new section follows the same sub-numbering convention (X.1 endpoint, X.2 request payload, X.3 idempotency, X.4 success response, X.5 error responses). Section number to be assigned by Architecture (likely §5 with subsequent renumber of current §5 outbound — Architecture decides per cross-repo doc convention).
- **Identification of follow-up App-side build work** opened by this contract decision (B-slice dual-gate persistence, C-slice endpoint code) — listed in the spec for traceability, NOT implemented.
- **ADR-023** (Architecture deliverable) packing resolution of Q-arch-1 through Q-arch-5 plus the explicit declaration of the 4 locked operator decisions as immutable inputs.

### Explicitly out of scope (this iteration only)

- **NoonWeb route `/maxwell/prototipo/[token]`** (memory Q1). Out of scope: NoonWeb-dev builds this against the contract firmed here. Cross-repo coordination protocol per §14 of the cross-repo-webhook-v1.md doc applies (simultaneous PRs not required for this iteration because no App-side code lands — only the contract doc — but NoonWeb-dev MUST acknowledge the contract before building).
- **Maxwell pipeline (GPT/V0/Opus/deploy) for prototipo generation** — v3 Phase 5 territory, 4-8 weeks, requires LLM budget approval per ADR-011 amendment + PoC recommendation per roadmap. The prototipo content generation is upstream of the decision contract and out of scope here.
- **Gate B iteration cap mechanism implementation in code** — defined as a locked decision INPUT (default cap 3, admin-configurable on `prototype_credit_settings`), but the migration adding the new column, the per-lead counter table or column, and the handler-side cap-check belong to the next iteration (B-slice). This iteration does not write the migration nor the cap-enforcement code.
- **Endpoint code for `app/api/integrations/website/prototype-decision/route.ts`** — belongs to the C-slice iteration after the contract is firmed and the B-slice persistence lands.
- **Persistence schema for the client decision** — Q-arch-3 will be SURFACED here for Architecture to resolve in ADR-023 (default proposal: extend `prototype_workspaces` with `client_decision`, `client_decision_at`, `client_decision_notes` columns OR introduce a separate `prototype_decisions` table; Architecture picks). The migration itself is out of scope.
- **UI changes in App** — admin Gate B cap field in `/dashboard/settings`, propuesta draft view post-accept, Maxwell chat flow itself, prototipo card extensions for decision-state surfacing — all future iterations.
- **Implementation of Option β draft auto-creation** — the trigger-on-accept that calls Maxwell to draft a propuesta with `seller_fee_amount` blank, locks `assigned_to`, and routes to seller for fee selection. Future iteration (post-C-slice).
- **Stripe Connect / payouts / earnings flow** — orthogonal; ADR-022 covers Stripe Connect dormancy. The prototipo-decision contract does not introduce any earnings or payment surface.
- **Rejection feedback regenerate UI** — the seller-facing flow that consumes the dual-gate state to decide whether regenerate is allowed. Future iteration.
- **Cross-repo schema versioning header (`x-noon-webhook-schema-version`)** — §9 of cross-repo-webhook-v1.md proposes v2 with this header; deferring to v2 cutover per established plan. The new entry adheres to v1 conventions (no version header enforced yet).
- **Live runtime validation** — no code lands, so no runtime validation is meaningful. Architecture + Validator gate the iteration on contract self-consistency and adherence to v1 doc conventions.

---

## Affected Files / Modules

Best-effort map. Architecture may identify additional doc surfaces during ADR drafting; any addition MUST justify against `## Scope Boundary § Explicitly out of scope`.

| Path | Why | Confidence |
|---|---|---|
| `docs/integrations/cross-repo-webhook-v1.md` | Extend with the new third inbound entry section, symmetric to current §3 and §4. Update §1 ASCII diagram to show the new arrow. Update §10 env vars reference if any new env var is introduced (Architecture decides — none expected; reuses `NOON_WEBSITE_WEBHOOK_SECRET`). Update §13 open issues if any new open issue surfaces from Q-arch resolution. | High |
| `docs/adrs/ADR-023-<slug>.md` | NEW — Architecture deliverable. Pack the resolution of Q-arch-1..Q-arch-5 plus the explicit declaration of the 4 operator-locked decisions as immutable inputs. Reference ADR-010/013/014/016. | High |
| `docs/context/project.context.core.md` | Close-out adds the entry that the prototipo-decision contract is FIRMED (treat-as rule for the new endpoint when it lands later). No reference to plan IDs / R-codes per memory `feedback_context_docs_no_plan_refs`. | High |
| `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` | Per memory `feedback_keep_roadmap_in_sync`: log the contract decision and the opened B/C/D follow-up slices so the roadmap stays in sync with the Maxwell chat flow design intent. | High |

**Files explicitly NOT touched** (any change here is a scope violation):
- Any file under `app/api/integrations/website/**` (no endpoint code lands)
- Any file under `lib/server/website-integration.ts` (no handler code lands)
- Any file under `supabase/migrations/**` (no schema change)
- Any file under `lib/server/prototypes/**` or `lib/server/wallet/**` (no persistence change)
- Any frontend component
- Any test file (no test surface change without code surface change)
- `docs/integrations/cross-repo-webhook-v2.md` (would only exist after v2 migration window per §9)

---

## Dependencies

| Type | Dependency | Status | Impact if missing | Owner |
|---|---|---|---|---|
| Contract | `docs/integrations/cross-repo-webhook-v1.md` v1 protocol (HMAC §2, error shape §6, rate limit §7, transport ledger §8.2, change control §14) | Present and live | Contract extension impossible without the v1 baseline | local — change control §14 requires bilateral acknowledgment but no NoonWeb code lands this iteration |
| Contract | ADR-016 transport-level ledger pattern (`website_webhook_events` ledger sits in front of every signed inbound endpoint) | Present | New endpoint must inherit this pattern; without it, retry/replay semantics diverge from established inbound entries | local — locked, no change to ledger itself |
| Internal | `prototype_workspaces` table + `prototype_credit_settings` table (migrations 0020, 0021) | Present | The decision contract references prototipo identifiers; without the table, no target to decide on | local — locked, no migration this iteration |
| Internal | Project memory `project_maxwell_chat_lead_creation_flow.md` (4 locked decisions + 2 open questions) | Present | The operator-locked decisions ARE the authoritative input to ADR-023 | local — frozen at memory level |
| Cross-repo | NoonWeb-dev acknowledgment of the firmed contract before NoonWeb-side build iteration begins | Not yet | Without acknowledgment, NoonWeb may build against a different shape and break the App handler. Mitigation: contract doc extension PR is the artifact NoonWeb-dev signs off against; cross-repo sync per §14. | bilateral |
| External | None this iteration (no code, no env vars, no npm packages) | n/a | n/a | n/a |
| Infra | None this iteration | n/a | n/a | n/a |
| Data | None this iteration (no migration, no new column) | n/a | n/a | n/a |

---

## Assumptions

1. **The HMAC signing protocol per §2 of cross-repo-webhook-v1.md is reused as-is** for the new endpoint. Same header set (`x-noon-timestamp`, `x-noon-signature`), same algorithm (HMAC-SHA256 over `${timestamp}.${bodyText}`), same secret (`NOON_WEBSITE_WEBHOOK_SECRET`), same ±5min clock-skew window. No new env var.
2. **The error envelope per §6 (`{ error, code, requestId }`) is reused as-is** for all error responses of the new endpoint. Code namespace for prototipo-specific errors will be `PROTOTYPE_DECISION_*` (Architecture confirms in ADR-023).
3. **Rate limiting per §7 (120 req/min) is reused** with a new namespace `prototype-decision`. Independent counter per endpoint.
4. **Transport-level idempotency per §8.2 / ADR-016 is reused as-is**: the new endpoint sits behind `website_webhook_events` ledger; identity key is `(endpoint, signature_hash)` where `signature_hash = sha256(${timestamp}.${bodyText})`. Bit-identical replay returns the same response shape with HTTP 200 and `idempotent: true` (or equivalent — Architecture confirms). NO new variant idempotency scheme is invented.
5. **The share token is generated by App** at prototipo-creation time (existing flow upstream of this iteration). The token is opaque to NoonWeb; NoonWeb passes it back verbatim in the decision payload. App resolves token → `prototype_workspace_id` server-side. Whether the contract also accepts the UUID directly is Q-arch-1.
6. **The `lead_proposals` schema permits `seller_fee_amount` blank on draft creation** (required for Option β: Maxwell drafts the propuesta with the fee field blank so the seller fills it explicitly). Risk R4 below tracks the verification; if the schema rejects blank/null on insert, Architecture must surface the gap and either ADR a schema change as out-of-scope follow-up or adjust Option β to insert a sentinel value. Assumption is that ADR-013 already required `seller_fee_amount` nullable for the legacy migration path, but explicit verification is owed.
7. **Wire contract changes after this iteration are breaking and require bilateral PR per §14**. Once ADR-023 lands and the doc is extended, App and NoonWeb both reference this as truth; future schema evolution follows the v2 cutover plan in §9 (header-versioned).
8. **No cross-repo synchronization gate**: NoonWeb-dev can build against the firmed contract on their own timeline; App-side B-slice and C-slice iterations can also start without NoonWeb being ready. The contract is the decoupling artifact.

If any assumption breaks during Architecture drafting, the responsible skill stops and updates this spec with a dated note before proceeding.

---

## Open Questions

Each has a default the responsible skill (Architecture in ADR-023) can apply with documented reasoning. If any becomes load-bearing, escalate to operator.

### Q-arch-1 — How is the prototipo identified in the decision payload?
- **Options**:
  - (a) Opaque `token` only (App resolves server-side via lookup).
  - (b) `prototype_workspace_id` UUID only (NoonWeb already needs the UUID for the Pull B.2 render fetch, so it's already in NoonWeb's hand).
  - (c) Both `token` + `prototype_workspace_id` for defense-in-depth (NoonWeb sends both; App cross-validates they refer to the same row).
- **Default**: (c) both. Cross-validation defends against token reuse / UUID guessing edge cases at trivial cost. Matches the defensive posture of the two existing inbound entries that carry redundant identifiers (`external_session_id` + `external_proposal_id`).
- **Rationale to deviate**: if Architecture finds the token is already strong enough (HMAC-signed JWT or similar), the UUID becomes redundant overhead.

### Q-arch-2 — TTL/expiration semantics for the share token.
- **Options**:
  - (a) No TTL — client can decide indefinitely after token issuance.
  - (b) TTL bounded (e.g., 30 days) — past TTL the endpoint returns `PROTOTYPE_DECISION_TOKEN_EXPIRED`.
  - (c) TTL tied to prototipo lifecycle state (e.g., expires when prototipo is regenerated to V2; V1 token is dead).
- **Default**: (c) tied to lifecycle. When the seller regenerates (V2), the V1 share token becomes invalid because the artifact the client was evaluating no longer represents the current state. This naturally enforces "client decides on the current version" semantics. TTL is implicit (no calendar bound) but state-driven.
- **Rationale to deviate**: if operator wants explicit calendar TTL for legal/audit reasons (offer expiration date), (b) layered on top of (c).

### Q-arch-3 — Where does the client decision persist?
- **Options**:
  - (a) Extend `prototype_workspaces` with `client_decision` (enum: pending|accepted|rejected), `client_decision_at` (timestamptz), `client_decision_notes` (text nullable).
  - (b) Separate `prototype_decisions` table with FK to `prototype_workspaces.id`, supports multiple decision attempts (e.g., client rejects V1, accepts V2; both rows persist).
- **Default**: (b) separate table. The dual-gate regenerate flow naturally produces multiple decision events (V1 rejected with notes → V2 generated → V2 accepted). A separate table preserves the full audit history without overloading the workspace row, and it composes cleanly with the iteration-cap tracking needed for Gate B (B-slice can use the same table or a parallel cap-counter).
- **Rationale to deviate**: if the regenerate flow always replaces the workspace row (V2 is a NEW `prototype_workspaces` row, not an update), then (a) suffices because each workspace has at most one decision. Architecture verifies the regenerate semantics against migration 0020 before deciding.

### Q-arch-4 — Error code taxonomy for operator-visible failure modes.
- **Options** (defaults proposed):
  - `PROTOTYPE_DECISION_TOKEN_NOT_FOUND` — 404, token does not resolve to any known prototipo.
  - `PROTOTYPE_DECISION_ALREADY_DECIDED` — 409, this prototipo has a non-pending `client_decision` already (with idempotency caveat: same decision payload replay returns 200 idempotent per §8.2; only a CONFLICTING decision triggers 409).
  - `PROTOTYPE_DECISION_TOKEN_EXPIRED` — 410, token is past its TTL or its workspace state is superseded (per Q-arch-2).
  - `PROTOTYPE_DECISION_LEAD_DELETED` — 410, the parent lead has been hard-deleted (defensive; current schema likely cascades, but explicit code helps NoonWeb).
  - `PROTOTYPE_DECISION_INVALID_DECISION` — 400, `decision` field is not in `{accepted, rejected}`.
  - Standard `WEBSITE_WEBHOOK_AUTH_FAILED` (401), validation errors (400), rate limit (429), DB error (500) inherited from cross-repo §6.
- **Default**: ship all 5 prototipo-specific codes in ADR-023. Each maps to a deterministic client-portal UX state NoonWeb can render.
- **Rationale to deviate**: collapse codes only if Architecture finds two failure modes are operationally indistinguishable to NoonWeb.

### Q-arch-5 — Transactionality of side effects: on accept, is the propuesta draft creation sync or async?
- **Options**:
  - (a) Sync in handler: webhook handler creates the draft propuesta in the same transaction as recording the decision. Response 200/201 only after the draft exists. Failure modes: if Maxwell drafting fails, the webhook fails and NoonWeb retries (which is bad for UX — client clicked accept but got an error).
  - (b) Async via queue: handler records the decision, enqueues a job for Maxwell drafting, returns 200. Failure mode: webhook always succeeds; draft creation may lag or fail silently from NoonWeb's perspective.
  - (c) Hybrid: handler records the decision sync, fires-and-forgets the Maxwell draft creation (background task within the same request handler, not via a queue). Pragmatic middle ground for current infra.
- **Default**: (c) hybrid for the initial implementation. Decision persistence is sync (so NoonWeb's response is meaningful: "decision recorded"). Maxwell draft creation is fired into a background task with structured logging; if it fails, seller notification surfaces the gap and the operator manually triggers re-draft. This avoids both (a)'s flakiness and (b)'s queue-infra prerequisite.
- **Rationale to deviate**: if a real queue (e.g., QStash, Inngest, Postgres-based job runner) is already in the stack by the time C-slice ships, (b) becomes cleaner.

---

## Risks

| # | Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R1 | Contract is firmed and the doc extension lands in App repo, but NoonWeb-dev has no committed timing for building the NoonWeb route. The contract sits dormant; later, NoonWeb-dev builds and a subtle drift (e.g., NoonWeb sends `decision: 'accept'` instead of `'accepted'`) breaks the protocol. | High | Medium | High | Architecture's ADR-023 declares the contract as a freeze-and-publish artifact. The contract doc PR explicitly tags NoonWeb-dev for acknowledgment per §14 change control. Operator decision (out of band): proceed with App-side contract publication knowing NoonWeb timing is uncommitted; the contract is the gate that unblocks them when they're ready. Acceptable risk. |
| R2 | Future evolution of the payload schema (e.g., adding a `reject_reason_category` enum field) is a breaking change cross-repo. Without versioning, App and NoonWeb deploys must coordinate atomically per §14, blocking either side. | Medium | Medium | Medium | The doc extension MUST anchor that the new entry follows v1 conventions (no header version yet), and that any future evolution rides the v2 cutover plan in §9. ADR-023 SHOULD include an "evolution path" subsection: which fields are likely to change (notes structure, rejection categorization, decision metadata) and which are stable (token, decision enum, timestamps). NoonWeb-dev is forewarned. |
| R3 | Maxwell pipeline (Phase 5, GPT/V0/Opus/deploy) takes 8+ weeks or is deprioritized, leaving this contract inert — no prototipos are actually generated, so no client decisions are ever posted. | Medium | Low | Medium | ACCEPTED. The contract sits dormant until Phase 5 lands; it costs nothing in the meantime and unblocks Phase 5 the moment it starts. The contract is forward-investment. Validator records this explicitly as "contract is ready ahead of upstream pipeline" rather than as a blocker. |
| R4 | Option β requires `lead_proposals.seller_fee_amount` to accept blank/null on draft insert (Maxwell drafts the propuesta with the fee field blank so the seller fills it explicitly). If the current schema enforces NOT NULL on `seller_fee_amount`, Option β cannot be implemented as locked, and a sentinel value (e.g., 0) would silently violate the audit invariant. | Medium | High | High | Architecture verifies the `lead_proposals` schema during ADR-023 drafting: read `supabase/migrations/0004_phase_2c_lead_proposals.sql` and any later seller-fee migrations (e.g., ADR-013 implementation migration) to confirm nullability. If schema enforces NOT NULL, ADR-023 records the gap and the implementation iteration (post-contract) must include a schema-allowance migration. If nullable, ADR-023 records the verification result and proceeds. |
| R5 | The new endpoint reinvents idempotency semantics subtly different from ADR-016 (e.g., uses a `decision_id` UUID from the payload as idempotency key instead of the transport-level `(endpoint, signature_hash)` identity). This bifurcates idempotency reasoning across the three inbound entries and creates a class of bugs where retry semantics differ per endpoint. | Low | High | High | ADR-023 MUST declare bit-identical adherence to ADR-016. The new endpoint MUST sit behind `website_webhook_events` ledger as the first action after HMAC verify. No payload-level idempotency hint may override or replace the transport-level identity. Reviewer (Validator) checks the contract doc extension for explicit `(endpoint, signature_hash)` reuse language matching §8.2 verbatim. |

---

## Recommended Testing Methodology

**N/A — no code lands this iteration.**

The Validator gate is contract self-consistency and adherence to v1 doc conventions:
- Contract section follows §3 and §4 structural template (X.1 endpoint, X.2 request payload, X.3 idempotency, X.4 success response, X.5 error responses).
- HMAC/auth/headers explicitly reuse §2.
- Error envelope explicitly reuses §6.
- Rate limiting explicitly reuses §7 with new namespace.
- Transport-level idempotency explicitly reuses §8.2 / ADR-016 — no variant scheme.
- All 5 Q-arch questions are resolved in ADR-023 with documented rationale (or escalated to operator if Architecture cannot pick a default with confidence).
- The 4 locked operator decisions are restated in ADR-023 as immutable inputs (not subject to relitigation).

When B-slice / C-slice iterations follow up later, testing methodology will be integration-first symmetric to R4 (the inbound earnings auto-credit iteration) — but that is the next iteration, not this one.

---

## Definition of Done

Bounded to this iteration only.

- [ ] Spec `specs/fase-3-prototipo-decision-cross-repo-contract.md` Status moved Draft → Approved before Architecture starts.
- [ ] ADR-023 landed at `docs/adrs/ADR-023-<slug>.md` packing resolution of Q-arch-1..Q-arch-5 plus explicit declaration of the 4 locked operator decisions as immutable inputs. References ADR-010/013/014/016.
- [ ] `docs/integrations/cross-repo-webhook-v1.md` extended with the new third inbound entry section (symmetric to §3 and §4). §1 ASCII diagram updated. §13 open issues updated if any new open item surfaces.
- [ ] R4 verified (schema nullability of `seller_fee_amount` on `lead_proposals`). If gap exists, recorded as out-of-scope follow-up for the implementation iteration.
- [ ] R5 verified (contract doc extension explicitly reuses ADR-016 transport-level idempotency language; no variant invented).
- [ ] `docs/context/project.context.core.md` updated with the contract-firmed entry (no plan-IDs / R-codes per memory rule).
- [ ] Roadmap (`D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md`) synced: contract decision logged + B/C/D follow-up slices flagged.
- [ ] PR opened (branch slug TBD by Architecture / close-out per repo convention) with title and body referencing this spec by path. Per memory `feedback_no_auto_merge_prs` — do NOT auto-merge; operator merges.
- [ ] `system-validator` returns COMPLETE.
- [ ] Spec lifecycle Draft → Approved → Implemented on Validator COMPLETE.

---

## Chunking Decision

**Single iteration. Contract-only — no code chunking needed.**

The iteration ships exactly two artifacts: ADR-023 + extension of cross-repo-webhook-v1.md. Both are produced by Architecture in one pass; Validator gates as one unit. No internal sequence beyond Architecture → Validator → close-out.

Follow-up iterations are independent and may run in any order once the contract is firmed:
- **B-slice** (Gate B persistence): adds a column to `prototype_credit_settings` for `max_iterations_per_lead` (default 3) + a counter mechanism per lead. Independent of NoonWeb.
- **C-slice** (Endpoint code): `app/api/integrations/website/prototype-decision/route.ts` + `lib/server/website-integration.ts::receiveWebsitePrototypeDecision` handler. Depends on B-slice if cap-check runs in the handler; otherwise independent.
- **D-slice** (NoonWeb route): NoonWeb-side build, out of this repo. Independent.

The iteration explicitly does NOT block on D-slice readiness. Contract is publishable without NoonWeb-side commitment per Risk R1 acceptance.

---

## Success Criterion

> **After this iteration merges, `docs/integrations/cross-repo-webhook-v1.md` contains a third inbound webhook entry section for `POST /api/integrations/website/prototype-decision` that is byte-symmetric in structure with the existing §3 (`inbound-proposal`) and §4 (`payment-confirmed`) sections, reuses the v1 auth/error/rate-limit/transport-ledger/change-control conventions verbatim, and is sufficient for NoonWeb-dev to build the NoonWeb-side route `/maxwell/prototipo/[token]` and for App-side B-slice + C-slice implementation iterations to start in parallel without further coordination. ADR-023 documents the resolution of Q-arch-1..Q-arch-5 and restates the 4 operator-locked decisions (client-decides-on-prototipo, Pull pattern B.2 render, Option β post-accept, dual-gate rejection control) as immutable inputs.**

---

## Skill Chain Hypothesis

`system-analysis` (this spec) → `system-architecture` (ADR-023 + cross-repo doc extension) → `system-validator` (COMPLETE / PARTIAL / BLOCKED) → close-out (context.core + roadmap + PR).

No Backend, Frontend, Infra, Security, Testing, Refactor, Docs (beyond ADR + contract doc + context.core) in this iteration — no code is shipped. Security is not invoked because no new endpoint, validation, or sensitive surface lands; the contract spec sets the security posture for future B/C/D slices but does not exercise it.

---

## Handoff Payload — to `system-architecture`

- **Task summary**: see `## Task Summary`.
- **Scope boundary**: `## Scope Boundary` — strict. Out-of-scope list is the router lock, authoritative.
- **Acceptance criteria**: see `## Definition of Done`.
- **Affected files**: `## Affected Files / Modules`.
- **Dependencies**: `## Dependencies` — primarily contract dependencies (cross-repo-webhook-v1.md + ADR-016 + project memory).
- **Assumptions**: `## Assumptions` (8 items). Break any → stop and update spec.
- **Open questions**: `## Open Questions` (Q-arch-1 through Q-arch-5) — each has a default; Architecture documents deviations in ADR-023.
- **Risks**: `## Risks` (R1–R5) — R4 (schema nullability verification) and R5 (idempotency variant prevention) are the most likely to require explicit Architecture verification work in ADR-023.
- **Locked operator decisions (INPUTS — do NOT relitigate)**:
  - Client decides on prototipo, not propuesta.
  - Pull pattern B.2 for prototipo render.
  - Option β for post-accept propuesta generation (Maxwell drafts inferable fields, `seller_fee_amount` blank, seller picks fee).
  - Dual-gate rejection control: Gate A (credits) + Gate B (iteration cap default 3, admin-configurable).
- **Recommended depth**: FULL (already locked by router).
- **Chunking decision**: single iteration; Architecture-only output. No code.
- **Success criterion**: see `## Success Criterion`.
- **Recommended testing methodology**: N/A (no code).
- **Path to this spec**: `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-prototipo-decision-cross-repo-contract.md`.
- **Next ADR number**: ADR-023 (next available after ADR-022).
- **Doc to extend**: `docs/integrations/cross-repo-webhook-v1.md` with new third inbound entry section, symmetric to §3 and §4.

---

## Lifecycle

- **Draft** — 2026-05-23 (analysis output)
- **Architecture** — 2026-05-23 — ADR-023 emitted at `docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md`; cross-repo contract doc extended with §5 (`prototype-decision` inbound entry) plus renumber cascade (outbound → §6, common error → §7, rate limit → §8, idempotency → §9, versioning → §10, env vars → §11, test fixtures → §12, reference impl → §13, open issues → §14, change control → §15, references → §16). R4 verified: `lead_proposals.seller_fee_amount` column does not exist; seller fee lives in separate `seller_fees` table per ADR-013, so Option β is enforced by construction — no schema gap, no follow-up migration required. R5 verified: contract extension reuses ADR-016 transport-level idempotency verbatim (identity key `(endpoint, signature_hash)`); no variant scheme invented.
- **Approved** — 2026-05-23 (operator merged PR #105)
- **Implemented** — 2026-05-23 (PR #105 merged at `5016693` from squashed commit `cc16e5e`, Validator verdict COMPLETE, contract artifacts durable in `develop`: ADR-023 + `cross-repo-webhook-v1.md` §5 + this spec)
- **Archived** — n/a

Status changes recorded inline as dated notes when transitioned. Spec is not edited after Implemented; follow-up iterations (B/C/D slices) create new spec files and reference this one.
