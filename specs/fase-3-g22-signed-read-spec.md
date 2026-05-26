# spec.md — fase-3-g22-signed-read-spec

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-25
- Session ID: fase-3-g22-signed-read-spec
- Developer: Pedro (`noondevelop@gmail.com`)
- Main active skill: `system-analysis` (this spec); downstream chain per router: `system-architecture → system-docs → system-validator → close-out`
- Router mode: **Refactor mode (docs-as-design)** — extends an established cross-repo wire contract with a new symmetric *read* surface. No code is shipped this iteration.
- Depth: FULL

### ARCHITECTURAL CONSTRAINT ANCHOR (load-bearing, do not violate)
- **Pull pattern B.2 is locked** (project memory `project_maxwell_chat_lead_creation_flow.md`, ADR-023 D8 / L-2). When the client opens the NoonWeb route `/maxwell/prototipo/[token]`, NoonWeb's server fetches prototipo data from App at render time via signed HTTPS. App is the single source of truth; NoonWeb is the render layer. Do not propose Push (B.1) variants.
- **App is operator-only** (ADR-010). No client-authenticated path lives in App. The signed-read endpoint is **server-to-server** (NoonWeb → App), authenticated by the shared cross-repo HMAC. No client identity ever reaches App.
- **The cross-repo HMAC protocol of `docs/integrations/cross-repo-webhook-v1.md` §2 is reused as-is** for this new GET surface. Same shared secret (`NOON_WEBSITE_WEBHOOK_SECRET`), same `x-noon-timestamp` + `x-noon-signature` headers, same ±5min clock-skew window, same byte-fidelity signing input `${timestamp}.${bodyText}`. App is the receiver in both the existing POST inbound entries (§3–§5) and in this new GET surface — same auth verifier, same secret rotation procedure (§2.4).
- **State-driven token invalidation is locked** by ADR-023 D3. The share token has no calendar TTL; it is invalidated by lifecycle events on the workspace (regenerate → V2 supersedes V1; hard-delete of the lead cascades). The signed-read endpoint MUST honor the same invalidation semantics already firmed for the decision-write endpoint.
- **App ↔ NoonWeb cross-repo change control per §15** (renumbered from §14 after ADR-023 cascade). Contract additions land via simultaneous PRs on both sides; the App-side §X PR may land first when no App-side code is in the same iteration (the contract publication is the unblocking artifact). NoonWeb-dev acknowledgment of the firmed contract is required **before** NoonWeb-side code builds against it.
- **Sanitization principle**: any payload field the endpoint serves MUST be either (a) explicitly client-visible by design, or (b) stripped/redacted before egress. No operator-internal metadata (PM notes, lead score, internal labels, audit fields, fee data, credit balances) ever crosses the App→NoonWeb boundary on this surface. This is the App-side counterpart of `lib/security/project-isolation.ts` outlined in roadmap §9.1 Phase 2 v3.

### OBJECTIVE
- What must be achieved in this session: produce the bounded spec that defines the **WIRE CONTRACT** for a new symmetric *read* surface on App — `GET /api/integrations/website/prototype-signed-read` (provisional path; final naming is an Architecture decision) — so that NoonWeb's future route `/maxwell/prototipo/[token]` can fetch prototipo data on render-time per Pull pattern B.2. The spec scopes the contract surface only; endpoint code, RLS, sanitizer module materialization, tests, NoonWeb-side route, and observability all live in subsequent iterations.
- Why this work matters now: ADR-023 D8 explicitly deferred this signed-read endpoint to a future Architecture iteration. That iteration is this one. Operator decision 2026-05-25 (handoff `docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md` §6): firm the GET contract first so NoonWeb-dev can begin work on `/maxwell/prototipo/[token]` in parallel with the App-side C-slice (the POST decision-write endpoint). Without a firmed read contract, NoonWeb cannot render the page; with it, both sides build in parallel and the cross-repo coordination cost collapses to one synchronization point.
- It is NOT a "build the endpoint" iteration. Per router: depth FULL but Refactor mode (extend the established cross-repo webhook v1 contract doc with a new *inbound read entry* symmetric to the existing POST entries), Architecture-led. No code shipped this iteration.

### CONTEXT USED
- `CLAUDE.md`: reviewed — confirms session discipline (read `project.context.core.md` first, downstream skill rules, spec lifecycle Draft→Approved→Implemented, no-auto-merge policy).
- `project.context.core.md`: reviewed — confirms `prototype_workspaces` foundation (migrations `0020/0021/0022`, routes `/api/leads/[leadId]/prototype`, `/api/prototypes`), confirms `lead_proposals` + Maxwell context shape, confirms three existing cross-repo entries (`inbound-proposal`, `payment-confirmed`, `proposal-review-decision`).
- `docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md`: reviewed in full — anchors D3 (state-driven token invalidation), D8 (this iteration is the deferred render-read iteration declared there), L-2 (Pull B.2 lock), the architectural-truth table § (read column: "App is system of record; Pull B.2 fetch via future signed-read endpoint").
- `docs/integrations/cross-repo-webhook-v1.md`: reviewed in full — §2 (HMAC), §5 (`prototype-decision` POST as the structural sibling), §8 (rate limit, will need a new namespace for read), §9 (idempotency model, simpler for GET since reads are naturally idempotent), §11 (env vars — no new var introduced; this entry reuses `NOON_WEBSITE_WEBHOOK_SECRET`), §15 (change control rule). Q-arch-5 decides whether to extend this doc with a new §X subsection or create a sibling doc `cross-repo-read-v1.md`.
- `specs/fase-3-prototipo-decision-cross-repo-contract.md`: reviewed in full as **structural template** — predecessor spec that closed COMPLETE 2026-05-23 with PR #105 merged. Same section order is followed verbatim here.
- `docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md`: reviewed — anchors operator priority "destrabar NoonWeb", confirms G22 was opened as separate gap in roadmap §16 row 9, confirms the 3-4h docs-only effort estimate, confirms ADR-024 will be the Architecture deliverable.
- Project memory `project_maxwell_chat_lead_creation_flow.md`: reviewed — 4 operator-locked decisions (L-1..L-4) confirmed as immutable inputs to the parent Maxwell flow; this iteration scopes a sub-surface (render-read) and inherits all 4 locks without revisiting them.
- `lib/server/website-webhook-auth.ts` (verified to exist): the HMAC verifier this endpoint will reuse.
- `lib/server/website/webhook-events.ts` (verified to exist): the transport ledger. GET reads do not typically sit behind the ledger (idempotent by HTTP semantics); Architecture confirms whether ledger participation is required (default: no, per Q-arch-2 framing).
- `lib/server/api/rate-limit.ts` (verified to exist): the in-process rate limiter that backs §8 of the cross-repo doc. Reused with a new namespace per Q-arch-6.

### ROUTER DECISION
- Mode: Refactor (extending an established protocol with a new symmetric entry; no net-new system).
- Depth: FULL (cross-repo coordination, contract durability matters, sets the read posture for any future client-facing render surface).
- Chain: Analysis (this spec) → Architecture (ADR-024) → Docs (cross-repo doc update + context.core + roadmap + handoff) → Validator → close-out.
- Active skill rationale: 7 architecture-level questions (Q-arch-1 through Q-arch-7) must be either resolved or surfaced as defaults BEFORE the wire contract can be firmed. Analysis bounds them; Architecture resolves them in ADR-024.

### SCOPE
- In scope: see `## Scope Boundary`.
- Explicitly out of scope: see `## Scope Boundary`.
- Success criterion: see `## Success Criterion`.

### INPUTS
- Files/modules involved: see `## Affected Files / Modules`.
- Contracts or architecture inputs available: cross-repo webhook v1 doc + ADR-023 + ADR-010 + ADR-013 + ADR-016 + project memory locked decisions.
- Relevant handoffs received: router handoff 2026-05-25 (`docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md`); operator priority "destrabar NoonWeb" (§6 of that handoff).
- External dependencies: NoonWeb-dev will own the NoonWeb-side build against this firmed contract; coordination per §15 of `cross-repo-webhook-v1.md`.

### RISK SNAPSHOT
- Known risks before starting: see `## Risks` (R1–R4, possibly more).
- Known blockers before starting: none.
- Known assumptions before starting: see `## Assumptions`.

### CONTINUITY NOTES
- Previous session relevant to this one:
  - **ADR-023 contract iteration** (PR #105 merged 2026-05-23) — firmed the POST decision-write entry and explicitly deferred this signed-read entry to a future Architecture iteration. This iteration discharges that defer.
  - **2026-05-25 handoff** — operator brought lista cruce, operator chose to prioritize NoonWeb-unblock work; this iteration is the chosen path because G22 spec lands in 3-4h docs-only and unblocks NoonWeb-dev for `/maxwell/prototipo/[token]` render in parallel with App-side C-slice POST endpoint implementation.
- Expected next skill: `system-architecture` to produce **ADR-024** packing the resolution of Q-arch-1..Q-arch-7. Docs extends `docs/integrations/cross-repo-webhook-v1.md` with a new inbound-read section (or creates `cross-repo-read-v1.md` if Q-arch-5 picks that path), updates `docs/context/project.context.core.md`, syncs the roadmap, and writes the close-out handoff. Validator closes the iteration.

---

## Task Summary

Firm the WIRE CONTRACT for a new symmetric *read* surface on App, `GET /api/integrations/website/prototype-signed-read` (provisional; Architecture names the final path), which NoonWeb will call on render of `/maxwell/prototipo/[token]` to fetch the prototipo content to display. The contract must be byte-symmetric with the existing inbound *write* entries (`inbound-proposal`, `payment-confirmed`, `prototype-decision`) in terms of:

- **Auth**: HMAC-SHA256 of `${timestamp}.${bodyText}` per §2 with the shared secret `NOON_WEBSITE_WEBHOOK_SECRET`. For a GET request the `bodyText` is the empty string `""`; the signing input is `${timestamp}.` — Architecture confirms this convention in ADR-024 (Q-arch-1 sub-detail).
- **Error envelope**: `{ error, code, requestId }` per §7 (renumbered after ADR-023 cascade).
- **Rate-limit posture**: per §8 with a new namespace `prototype-signed-read` (Q-arch-6).
- **Change control**: per §15.

The contract MUST express:

- The token-bound request shape (Q-arch-1: how the token travels — path param, query param, or header — and whether HMAC envelope is layered on top of the signed-token).
- The lifecycle response-code mapping (Q-arch-2: 200 / 410 / 404 / 401/403 / 429 — supersede vs accepted vs not-found vs auth-fail vs rate-limit).
- The response payload shape (Q-arch-3: what is client-visible; what is stripped at the sanitization layer).
- The sanitization-layer location (Q-arch-4: ad-hoc inline for this iteration, with future formal materialization triggered by E-1 escalation).
- The contract doc home (Q-arch-5: extend existing `cross-repo-webhook-v1.md` vs create `cross-repo-read-v1.md`).
- The rate-limit identity and budget (Q-arch-6).
- The cache-control posture (Q-arch-7).

Idempotency is **naturally provided by HTTP GET semantics** — no transport-ledger participation expected for a read (Architecture confirms in ADR-024; this is the structural difference from the POST entries that depend on the `website_webhook_events` ledger per ADR-016).

The deliverable is Architecture's: ADR-024 + the doc-home decision (Q-arch-5 outcome) materialized. The wire contract becomes the firmed input for two later, independent build iterations:

- **App-side handler iteration**: implements the route + RLS + sanitizer + tests against the firmed contract. Naming and module placement are an Architecture decision in ADR-024.
- **NoonWeb-side render iteration**: builds `/maxwell/prototipo/[token]` consuming the firmed contract. Out of this repo entirely.

The build iterations do not run inside this contract iteration. This iteration **FIRMS THE PROTOCOL ONLY**.

---

## Scope Boundary

### In scope

- **Wire contract definition** for the signed-read endpoint: HTTP method (GET), URL/path shape, required headers (auth pair), token transport (path/query/header — Q-arch-1), success response shape (Q-arch-3), error response shape (reusing common error envelope), HTTP status code matrix (Q-arch-2), rate-limit posture (Q-arch-6), cache-control header (Q-arch-7).
- **Default proposals with tradeoffs for the 7 Q-arch open questions**. Architecture resolves them in ADR-024.
- **Decision on doc home** (Q-arch-5): extend `cross-repo-webhook-v1.md` with a new §X "Inbound read endpoints" subsection, OR create `cross-repo-read-v1.md` as a separate doc. Default proposed: extend existing.
- **Identification of follow-up App-side build work** opened by this contract decision (handler iteration + sanitizer materialization trigger E-1 + RLS iteration + observability iteration) — listed for traceability, NOT implemented.
- **Cross-repo coordination note**: NoonWeb-dev acknowledgment of the firmed read contract is required before NoonWeb begins `/maxwell/prototipo/[token]` render-fetch implementation. The App-side ADR-024 + doc extension PR may land first; NoonWeb-side code is downstream.
- **ADR-024** (Architecture deliverable) packing the resolution of Q-arch-1..Q-arch-7 plus the explicit declaration of this surface's inheritance from ADR-023 D3 (token invalidation), ADR-016 (transport-ledger pattern — declined-by-design for read), ADR-010 (App is operator-only), ADR-013 (irrelevant for read but cited for the seller-fee field-stripping invariant in sanitization).

### Explicitly out of scope (this iteration only)

- **Handler code** for the route (e.g., `app/api/integrations/website/prototype-signed-read/route.ts` — final naming is Architecture's decision). No `.ts` file in `app/api/integrations/website/**` is created or modified this iteration.
- **RLS policies** on `prototype_workspaces` or any other table this endpoint reads. Architecture documents the intended RLS posture in ADR-024 (service-role-only access from the handler; no `authenticated` policy delta required because the handler uses the admin client per the symmetric inbound POST handlers). The migration itself, if any, is out of scope.
- **Sanitizer module materialization** (`lib/security/project-isolation.ts` + `sanitizeForClient()` per roadmap §9.1 Phase 2 v3). The pattern is referenced for forward consistency, but the formal module is **not built this iteration**. **E-1 escalation trigger**: if the materialization of `project-isolation.ts` requires more than ~2h of expansion in a future implementation iteration, that iteration MUST pause and open a separate `lib/security/project-isolation.ts` iteration to avoid scope drift. The signed-read handler iteration MAY ship with an ad-hoc inline sanitizer (per Q-arch-4 default) without triggering E-1.
- **Tests**: no unit, integration, or browser tests. No `tests/**` change.
- **NoonWeb-side `/maxwell/prototipo/[token]` implementation**: belongs to NoonWeb-dev's iteration, out of this repo entirely. The contract firmed here is what NoonWeb consumes.
- **Observability / metrics / tracing**: no Vercel Analytics event, no Sentry span, no log shape change. Observability for this endpoint is a future iteration when the handler is written.
- **Deploy / env-var setup**: no new env vars introduced. The endpoint reuses `NOON_WEBSITE_WEBHOOK_SECRET` for HMAC verification. No infra change.
- **Cross-repo schema versioning header (`x-noon-webhook-schema-version`)**: deferred to v2 cutover per `cross-repo-webhook-v1.md` §10 / ADR-023 spec L113. The new entry adheres to v1 conventions.
- **C-slice POST endpoint code** (`/api/integrations/website/prototype-decision`): parallel build iteration, separate spec (`fase-3-adr-023-c-slice-prototype-decision-endpoint.md`, pending). Both can ship in parallel; both consume the firmed read contract differently (POST writes a decision after a render; GET serves the render itself).
- **Live runtime validation**: no code lands, so no runtime validation is meaningful. Architecture + Docs + Validator gate the iteration on contract self-consistency and adherence to v1 doc conventions.

---

## Success Criterion

> **After this iteration merges, the cross-repo wire contract documentation (`docs/integrations/cross-repo-webhook-v1.md` if Q-arch-5 picks extend, or `docs/integrations/cross-repo-read-v1.md` if Q-arch-5 picks separate) contains a complete inbound-read entry for `GET /api/integrations/website/prototype-signed-read` (or final-named path) that is structurally symmetric with the existing inbound POST entries (auth, error envelope, rate limit, change control), reuses ADR-023 D3 token-invalidation semantics verbatim, and is sufficient for NoonWeb-dev to build the NoonWeb-side render-time fetch in `/maxwell/prototipo/[token]` and for App-side handler implementation iteration to start in parallel without further coordination. ADR-024 documents the resolution of Q-arch-1..Q-arch-7 and declares the inheritance from ADR-023 D3 + ADR-010 + ADR-016 (the last as a structural decline-by-design for read endpoints).**

---

## Affected Files / Modules

Best-effort map. Architecture may identify additional doc surfaces during ADR-024 drafting; any addition MUST justify against `## Scope Boundary § Explicitly out of scope`.

| Path | Why | Confidence |
|---|---|---|
| `docs/adrs/ADR-024-<slug>.md` | NEW — Architecture deliverable. Pack the resolution of Q-arch-1..Q-arch-7 plus the explicit declaration of inheritance from ADR-023 D3 (token invalidation), ADR-016 (ledger decline-by-design for read), ADR-010 (App is operator-only), ADR-013 (sanitization invariant: seller-fee fields stripped). Final slug suggestion: `ADR-024-prototype-signed-read-cross-repo-contract.md`. | High |
| `docs/integrations/cross-repo-webhook-v1.md` | Extend with a new §X "Inbound read endpoints" subsection, symmetric to current §3/§4/§5 POST entries. If Q-arch-5 picks the separate-doc option, this file is NOT extended and a new file `docs/integrations/cross-repo-read-v1.md` is created instead. **Default proposed (Q-arch-5 = extend)**: this file is extended. | High |
| `docs/integrations/cross-repo-read-v1.md` | CONDITIONAL — created only if Q-arch-5 picks separate-doc. Default proposed is extend, so this file likely does NOT land. | Low |
| `docs/context/project.context.core.md` | Close-out (Docs skill) adds the entry that the signed-read contract is FIRMED (treat-as rule for the new endpoint when it lands later). No reference to plan-IDs / R-codes per memory `feedback_context_docs_no_plan_refs`. | High |
| `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` | Per memory `feedback_keep_roadmap_in_sync`: log G22 as firmed contract + flag the App-side handler implementation iteration + NoonWeb-side render iteration as opened follow-up slices. §16 row 9 (G22) updated. | High |
| `docs/handoffs/2026-05-25-g22-signed-read-spec-closure.md` (or similar) | Close-out handoff capturing the firmed contract + next-session priorities. Naming and exact path are Docs/close-out decisions. | Medium |

**Files explicitly NOT touched** (any change here is a scope violation):
- Any file under `app/api/integrations/website/**` (no endpoint code lands)
- Any file under `lib/server/**` (no handler/sanitizer/auth/ledger module change)
- Any file under `lib/security/**` (no `project-isolation.ts` materialization — E-1 trigger if attempted)
- Any file under `supabase/migrations/**` (no schema change, no RLS migration)
- Any file under `tests/**` (no test surface change without code surface change)
- Any frontend component (no UI surface)
- `docs/integrations/cross-repo-webhook-v2.md` (would only exist after v2 migration window per §10)

---

## Dependencies

| Type | Dependency | Status | Impact if missing | Owner |
|---|---|---|---|---|
| Contract | `docs/integrations/cross-repo-webhook-v1.md` v1 protocol (HMAC §2, error shape §7, rate limit §8, change control §15) | Present and live | Contract extension impossible without the v1 baseline | local — change control §15 requires bilateral acknowledgment but no NoonWeb code lands this iteration |
| Contract | ADR-023 D3 (state-driven token invalidation: regenerate → V2 supersedes V1 via `share_token_superseded_at`) | Present, locked 2026-05-23 | Without ADR-023 D3, this endpoint cannot express coherent lifecycle response codes | local — locked, no change to ADR-023 |
| Contract | ADR-023 D8 (this iteration is the deferred render-read iteration declared there) | Present, locked 2026-05-23 | The iteration's reason-to-exist depends on D8's defer | local — discharging the defer here |
| Contract | ADR-010 (App is operator-only; no client identity in App) | Present, accepted | Without ADR-010, the security model of a server-to-server signed read does not align with App's posture | local — anchored |
| Contract | ADR-016 (transport-level webhook ledger pattern; this iteration **declines** the ledger by design because GET reads are HTTP-idempotent) | Present, accepted | The architectural reason for not participating in the ledger must be explicit in ADR-024 to avoid future confusion | local — anchored |
| Internal | `lib/server/website-webhook-auth.ts` (HMAC verifier) | Present, verified by Glob | The handler iteration (future) reuses this module without modification | local — locked |
| Internal | `lib/server/api/rate-limit.ts` (in-process rate limiter) | Present, verified by Glob | The handler iteration (future) reuses this module with a new namespace `prototype-signed-read` | local — locked |
| Internal | `prototype_workspaces` table (migrations 0020/0021/0022) + share_token column (B-slice pending per ADR-023 D4 note) | Partially present (table exists; `share_token` column added by B-slice migration NOT YET LANDED) | The handler iteration depends on B-slice for the `share_token` column lookup. This spec iteration is NOT blocked by B-slice — the contract can be firmed against the declared B-slice schema shape. | local — B-slice is a soft prerequisite for the handler iteration, NOT for this contract iteration |
| Internal | Project memory `project_maxwell_chat_lead_creation_flow.md` (4 locked decisions L-1..L-4) | Present, locked 2026-05-23 | Pull B.2 (L-2) is the reason this surface exists; all 4 locks inherit | local — frozen at memory level |
| Cross-repo | NoonWeb-dev acknowledgment of the firmed read contract before NoonWeb-side render-fetch code builds | Not yet (this is the artifact that enables the acknowledgment) | Without acknowledgment, NoonWeb may build against a different shape and break the App handler. Mitigation: contract doc PR explicitly tags NoonWeb-dev for sign-off per §15. | bilateral |
| External | None this iteration (no code, no env vars, no npm packages) | n/a | n/a | n/a |
| Infra | None this iteration | n/a | n/a | n/a |
| Data | None this iteration (no migration, no new column, no RLS policy) | n/a | n/a | n/a |

---

## Assumptions

1. **The HMAC signing protocol per §2 of cross-repo-webhook-v1.md is reused as-is** for the new GET endpoint. Same header set (`x-noon-timestamp`, `x-noon-signature`), same algorithm (HMAC-SHA256), same secret (`NOON_WEBSITE_WEBHOOK_SECRET`), same ±5min clock-skew window, same lowercase `sha256=` prefix on signature. For a GET with no body, the signing input is `${timestamp}.` (timestamp followed by a literal dot followed by the empty body) — Architecture confirms this exact convention in ADR-024 because it is the smallest assumption-load change to §2.
2. **The error envelope per §7 (`{ error, code, requestId }`) is reused as-is**. Code namespace for read-specific errors is `PROTOTYPE_SIGNED_READ_*` (Architecture confirms the exact prefix in ADR-024 — could be `PROTOTYPE_READ_*` for brevity).
3. **Rate limiting per §8 (120 req/min) is reused** with a new namespace `prototype-signed-read`. Independent counter per endpoint. Q-arch-6 proposes a defensive override (60 req/min, combined IP+token key) if Architecture wants tighter posture given that NoonWeb edge-cache + token-bound semantics should keep traffic well below 60 req/min/token.
4. **The share token is generated by App** (upstream of this iteration, by B-slice migration of `prototype_workspaces.share_token` per ADR-023 D4 footnote). The token is opaque to NoonWeb; NoonWeb passes it back verbatim. App resolves token → `prototype_workspace_id` server-side via `prototype_workspaces.share_token` column lookup. Same resolution path as the POST decision-write endpoint.
5. **The lifecycle invalidation semantics are inherited verbatim from ADR-023 D3**. V1 token is alive until V2 supersedes it; supersede sets `share_token_superseded_at` non-null. The read endpoint MUST honor the same `410 Gone` mapping for superseded tokens (with read-appropriate code, e.g., `PROTOTYPE_READ_TOKEN_EXPIRED`). Q-arch-2 expands the full map.
6. **GET reads are HTTP-idempotent by construction**. No transport-ledger participation is needed; the `website_webhook_events` table tracks POST inbound only. Architecture confirms in ADR-024 (this is a structural difference from POST entries, not a regression).
7. **No client identity is forwarded by NoonWeb to App on this endpoint**. The request is server-to-server, signed by the cross-repo HMAC. Any client-side identifier (cookies, session, IP) lives entirely in the NoonWeb-side render layer and never crosses to App. App's security model per ADR-010 holds.
8. **The response payload is read-only and stateless from App's perspective**. The read does NOT mark the token as "viewed", does NOT consume credits, does NOT trigger any side effect. The handler is a pure lookup + sanitize + return. Future analytics on render hits are a separate iteration and would live in NoonWeb's side (NoonWeb already sees the render hit).
9. **Wire contract changes after this iteration are breaking and require bilateral PR per §15**. Once ADR-024 lands and the doc is extended (or created), App and NoonWeb both reference it as truth; future schema evolution follows the v2 cutover plan in §10.
10. **No cross-repo synchronization gate for this iteration**: NoonWeb-dev can build against the firmed contract on their own timeline; App-side handler iteration can also start without NoonWeb being ready. The contract is the decoupling artifact, same pattern as ADR-023.

If any assumption breaks during Architecture drafting, the responsible skill stops and updates this spec with a dated note before proceeding.

---

## Open Questions / Q-arch

Each has a default the responsible skill (Architecture in ADR-024) can apply with documented reasoning. If any becomes load-bearing, escalate to operator.

### Q-arch-1 — Auth model: signed-token-only vs HMAC-envelope vs combined?

- **Options**:
  - (a) **Signed-token-only** — the share token itself is a self-verifying signed token (e.g., HMAC-JWT with payload `{workspace_id, issued_at}` and signature). NoonWeb sends the token; App verifies the signature; no extra cross-repo HMAC envelope.
  - (b) **HMAC-envelope only** — the share token is opaque (UUID-shape or random string); App resolves it via `prototype_workspaces.share_token` lookup. The request is authenticated only by the cross-repo HMAC envelope (`x-noon-timestamp` + `x-noon-signature`) using `NOON_WEBSITE_WEBHOOK_SECRET`.
  - (c) **Combined** — opaque token (App-issued, lookup-resolved) AND cross-repo HMAC envelope on top. Defense-in-depth.
- **Default**: **(c) combined**. Rationale: the token already travels in the URL `/maxwell/prototipo/[token]` for client identification; adding the HMAC envelope cross-repo is bare-cost (NoonWeb's server already has the secret because it sends the POST decision-write with the same envelope) and closes the replay/forgery vector. Without the envelope, anyone who learns a leaked token could pose as NoonWeb to App from any network location and harvest sanitized prototipo content; with the envelope, the request must originate from a holder of `NOON_WEBSITE_WEBHOOK_SECRET`, which is App↔NoonWeb private. Token possession alone is sufficient for the NoonWeb-render boundary (client side); HMAC envelope is sufficient for the cross-repo boundary (server side). Combined is the smallest design that secures both boundaries.
- **Rationale to deviate to (a)**: if Architecture has a strong preference for self-verifying tokens that don't require a DB lookup, (a) avoids the round-trip. Cost: token rotation (per ADR-023 D3 regenerate) becomes harder because superseded tokens still verify cryptographically — the supersede check must layer on top of the JWT verification anyway, so the DB lookup is unavoidable. Therefore (a) provides no net savings.
- **Rationale to deviate to (b)**: simplicity. Cost: removes one defense layer. Acceptable only if Architecture argues the token URL is never logged, never leaked, and never accessible to anything other than NoonWeb's server. Given that the token IS in the URL the client sees (`/maxwell/prototipo/[token]`), this argument fails — the token IS partially leaked by design (client browser history, referrer headers).
- **Sub-detail for the default**: the GET request's signing input is `${timestamp}.` (empty body). Architecture confirms this is acceptable in §2 of the existing doc (the §2 text says "${timestamp}.${bodyText}" without restricting bodyText to non-empty); ADR-024 adds a one-line note in the doc to make the empty-body case explicit.

### Q-arch-2 — Token-versioning vs workspace-state response mapping

ADR-023 D3 lock: regenerate → V2 supersedes V1 via `share_token_superseded_at`. The GET endpoint must map the workspace state to an HTTP response code coherently:

- **200 OK** — token valid, workspace in state that permits render (not superseded, not deleted, not accepted-and-locked, etc.).
- **410 GONE** — `share_token_superseded_at IS NOT NULL` → code `PROTOTYPE_READ_TOKEN_EXPIRED`. NoonWeb renders "Este prototipo fue actualizado, pedile al vendedor el nuevo link."
- **Edge case A — workspace status post-accept**: once the client has accepted (a `prototype_decisions` row with `decision='accepted'` exists for the workspace), what does the GET return?
  - Option 1: **200 OK with `accepted: true` flag in the response** — NoonWeb renders the prototipo read-only with an "Ya aceptaste este prototipo" banner. Preserves the audit trail and avoids dead-letter UX.
  - Option 2: **404 NOT FOUND** — terminal copy. Loses audit visibility for the client.
  - Option 3: **410 GONE with code `PROTOTYPE_READ_TERMINAL_ACCEPTED`** — between 1 and 2.
  - **Default proposed**: **Option 1 (200 with `accepted: true`)**. Rationale: the client should still see what they accepted ("here's the prototipo you said yes to"); the decision moment is over but the artifact remains visible for closure. Aligns with operator-driven outbound URL share pattern (the URL is durable; the state evolves).
- **Edge case B — workspace status post-reject**: rejected (a `prototype_decisions` row with `decision='rejected'` exists for the workspace) but NOT yet superseded by V2.
  - Per ADR-023 D3: "Reject does NOT invalidate the token by itself. A rejected prototipo remains visible to the client at the same URL until the seller regenerates V2."
  - **Default proposed**: **200 OK with `rejected: true` and `decision_notes` in the response**. NoonWeb renders the prototipo with a "Lo rechazaste — esperá la próxima versión" banner. Same audit-preservation rationale as Edge case A.
- **404 NOT FOUND** — token does not resolve to any `prototype_workspaces.share_token` row → code `PROTOTYPE_READ_TOKEN_NOT_FOUND`.
- **401 UNAUTHORIZED** — HMAC verification failed (signature mismatch, stale timestamp, missing secret) → code `WEBSITE_WEBHOOK_AUTH_FAILED` (inherited from §7).
- **403 FORBIDDEN** — reserved; Architecture decides if any case warrants 403 separately from 401 (likely no — all auth failures are 401 in the inbound POST entries).
- **429 TOO MANY REQUESTS** — rate-limit budget exceeded for the namespace `prototype-signed-read` → no code, standard rate-limit text per §8.
- **500 INTERNAL SERVER ERROR** — DB read error or sanitizer crash → code `PROTOTYPE_READ_PERSIST_FAILED` (the "PERSIST" suffix is borrowed from §5.5 for naming symmetry even though no persistence happens on read; Architecture may pick `PROTOTYPE_READ_INTERNAL_FAILED` for clarity).
- **410 GONE — additional case**: `PROTOTYPE_READ_LEAD_DELETED` mirroring §5.5 (defensive code path for FK cascade race).

**Architecture's responsibility in ADR-024**: enumerate the full code matrix verbatim in the contract doc subsection §X.5 (or equivalent), with NoonWeb UX copy mapping (mirroring §5.5's UX-copy column). Defaults above are starting points.

### Q-arch-3 — Response payload shape

What is in the response body? Three layered choices:

- **Choice A — Prototipo content only**: just the generated artifact (e.g., `generated_html` blob, or `iframe_url` pointing at the deployed Vercel URL, or `generated_text` content). No lead context, no business name, no metadata.
- **Choice B — Prototipo content + lead context (minimal)**: A + `business_name`, `project_type_label` (e.g., "Landing Page", "Web App"). NO operator metadata, NO notes, NO scoring, NO fee data, NO seller identity, NO credit balance.
- **Choice C — Prototipo content + lead context + state metadata (post-decision)**: B + the decision-state flags (`accepted` / `rejected` / `decision_notes`) per Q-arch-2 edge cases.

- **Default**: **Choice C as the natural superset** — the GET always returns the prototipo content + minimal lead context + the decision-state flags (which are null/false when no decision has been recorded). NoonWeb renders accordingly. The sanitizer (Q-arch-4) is the bouncer that strips everything else.

**Concrete default shape** (Architecture firms in ADR-024):

```json
{
  "data": {
    "prototypeWorkspaceId": "uuid",
    "leadContext": {
      "businessName": "string",
      "projectTypeLabel": "string"
    },
    "prototype": {
      "version": "integer (V1 = 1, V2 = 2, …)",
      "deployedUrl": "string | null (Vercel-hosted iframe URL when deploy succeeded)",
      "generatedHtml": "string | null (inline HTML when no iframe)",
      "generatedAt": "ISO 8601 string"
    },
    "decision": {
      "status": "pending | accepted | rejected",
      "notes": "string | null (only present when status='rejected')",
      "decidedAt": "ISO 8601 string | null"
    },
    "tokenLifecycle": {
      "superseded": "boolean (true when share_token_superseded_at is non-null — should be false on a 200 response by definition)",
      "leadDeleted": "boolean (false on 200; would surface as 410 path)"
    }
  },
  "requestId": "string"
}
```

**Explicitly NOT in the response** (sanitization strip-list, enforced by Q-arch-4):
- Any `lead_proposals.*` fields (no propuesta data is client-visible on this surface — that's the post-accept seller-controlled flow).
- Any `seller_fees.*` fields (per ADR-013, seller fee is the seller's commercial decision; client never sees it on the prototipo surface).
- Any `user_wallets.*` or `wallet_ledger_entries.*` (credit balance is operator-internal).
- Any `user_profiles.*` (seller/PM identity is operator-internal).
- Any `leads.notes`, `leads.score`, `leads.next_follow_up_at` (operator-internal CRM fields).
- Any audit metadata (`created_by`, `updated_at`, `assigned_to`, internal labels).
- Any `prototype_credit_settings.*` (operator-internal config).
- Any `prototype_decisions.client_user_agent` or `prototype_decisions.webhook_event_id` (forensic metadata, not client-visible).

### Q-arch-4 — Sanitization layer location

- **Options**:
  - (a) **Materialize `lib/security/project-isolation.ts` + `sanitizeForClient()` now** (per roadmap §9.1 Phase 2 v3). Build the formal module as part of this iteration's downstream handler iteration.
  - (b) **Ad-hoc inline sanitizer** in the handler module itself, with explicit field-allowlist (no field reaches the response unless it's on the allowlist). Materialize the formal module later when 2+ endpoints need it.
- **Default**: **(b) ad-hoc inline sanitizer**, with **E-1 escalation trigger**: if the handler implementation iteration finds that the sanitization logic requires more than ~2h of expansion (e.g., nested object traversal, recursive depth checks, deep DTO mapping), the iteration MUST pause and open a separate `lib/security/project-isolation.ts` iteration to avoid scope drift. The ad-hoc sanitizer for this single endpoint is a flat allowlist over a known shape (per Q-arch-3 default), which is well under the 2h threshold.
- **Rationale**: shipping the formal module now ahead of having two endpoints to abstract over is premature abstraction. The signed-read endpoint is the first client-visible read; the formal module makes sense when a second client-visible read (e.g., "client views their approved propuesta on NoonWeb" or "client views their project status") joins it.

### Q-arch-5 — Cross-repo doc home: extend existing vs create new

- **Options**:
  - (a) **Extend `docs/integrations/cross-repo-webhook-v1.md`** with a new §X "Inbound read endpoints" subsection, symmetric to §3/§4/§5 POST inbound entries.
  - (b) **Create `docs/integrations/cross-repo-read-v1.md`** as a separate doc, sibling to the webhook doc.
- **Default**: **(a) extend existing**. Rationale:
  - Minimizes fragmentation — the predecessor spec already cited §1–§16 of the existing doc, the doc is the single source-of-truth NoonWeb-dev already reads.
  - The "Inbound" framing semantically covers both inbound POST (writes) and inbound GET (reads) — both are NoonWeb→App directional, both are HMAC-protected, both rate-limit-counted.
  - Renames the existing §3/§4/§5 framing to "Inbound write endpoints" subsection-cluster and adds §X "Inbound read endpoints" subsection-cluster. Minor cascade rename, no semantic loss.
  - Section number for the new entry: Architecture decides after seeing the cascade. Probably §6 (between current §5 `prototype-decision` POST and current §6 `proposal-review-decision` outbound), with subsequent renumbers. Or §5.X as a sub-section of `prototype-decision` if Architecture wants tight pairing.
- **Rationale to deviate**: if Architecture surfaces semantic confusion (e.g., reviewers conflate inbound-read with outbound-read or with the existing webhook framing), the separate doc (b) keeps the boundary clean at the cost of a second source-of-truth. NoonWeb-dev would have to read two docs.

### Q-arch-6 — Rate-limit posture

- **Options**:
  - (a) **Inherit §8 defaults** — 120 req/min per namespace, IP-based identity. Same as POST entries.
  - (b) **Tighter override** — 60 req/min per namespace, combined `${token}:${client_ip}` identity. Defensive against token-scraping abuse.
  - (c) **Looser override** — 240 req/min per namespace, IP-based identity. Anticipates NoonWeb edge-cache reduces App's hit rate substantially; even a misbehaving NoonWeb retry loop is fine at 240/min.
- **Default**: **(b) tighter override**. Rationale: a legitimate NoonWeb render is 1-2 req/session/token (initial render + maybe one revalidate on a stale-while-revalidate trigger per Q-arch-7). A combined-key cap of 30 req/min per `(token, client_ip)` pair is generous for legitimate traffic and forces abuse detection. Hard cap conservative 60 req/min per namespace overall. The cost is one extra dimension on the limiter key; the in-process limiter (`lib/server/api/rate-limit.ts`) supports arbitrary string keys.
- **Rationale to deviate to (a)**: simplicity / symmetry with §8 defaults. Acceptable if Architecture argues NoonWeb edge-cache makes per-token-key tracking overkill.
- **Sub-detail**: the rate-limit identity is computed by the handler from `(token, x-forwarded-for first-hop)`. The combined key is `prototype-signed-read:${token}:${remoteIp}`. Architecture confirms in ADR-024.

### Q-arch-7 — Cache strategy / Cache-Control header posture

- **Options**:
  - (a) **`Cache-Control: no-store`** — no caching at all. NoonWeb edge cache is bypassed; every render hit App. Safest for freshness; worst for latency.
  - (b) **`Cache-Control: private, max-age=30, stale-while-revalidate=60`** — token-bound (private, not shared), 30s freshness, 60s stale-while-revalidate. NoonWeb's Vercel edge cache may use the header.
  - (c) **`Cache-Control: public, max-age=300`** — 5min cache, shared. Best latency, worst freshness. Risky given that `share_token_superseded_at` can flip at any time.
- **Default**: **(b) private, max-age=30, stale-while-revalidate=60**. Rationale:
  - `private` (not `public`) — the response is token-bound and includes lead context; should not land in any shared cache layer (CDN edge across tenants, ISP cache, etc.).
  - `max-age=30` — 30 seconds of freshness covers a normal client refresh cycle (open page, scroll, click) without hammering App.
  - `stale-while-revalidate=60` — if the cache entry is stale (30-90s old), serve the stale version while a background revalidate fetches fresh. Total window before guaranteed-fresh-on-next-render is ~90s.
  - App does NOT cache internally — the route is server-rendered at request time from `prototype_workspaces` + `prototype_decisions` reads. This ensures that any `regenerate` flip of `share_token_superseded_at` is visible to the next request within the cache window (worst case 90s).
- **Rationale to deviate**:
  - (a) `no-store` is safer if Architecture is uncomfortable with the 90s eventual-consistency window on supersede. Cost: every NoonWeb render is a round-trip to App. Acceptable cost at pilot scale.
  - (c) `public, max-age=300` is faster but risks a client seeing a stale "you can still accept" UI for up to 5min after a regenerate. Operator UX deemed unacceptable.

---

## Risks

| # | Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R1 | NoonWeb-dev acknowledgment timing — the firmed read contract lands in App repo as ADR-024 + doc extension, but NoonWeb-dev has no committed timing for acknowledging or building against it. The contract sits dormant; NoonWeb-dev later builds the `/maxwell/prototipo/[token]` render against a divergent shape (e.g., expects `data.prototype.url` instead of `data.prototype.deployedUrl`) and breaks the integration. | High | Medium | High | ADR-024 declares the contract as a freeze-and-publish artifact. The cross-repo doc extension PR explicitly tags NoonWeb-dev for acknowledgment per §15 change control. Operator decision (out of band, 2026-05-25 handoff): proceed with App-side contract publication knowing NoonWeb timing is uncommitted; the contract is the gate that unblocks NoonWeb-dev when they're ready. Acceptable risk. **NoonWeb-dev sign-off MUST be obtained before NoonWeb arranque su implementation**; the PR description on the App-side doc extension MUST request explicit acknowledgment from NoonWeb-dev as a closure condition. |
| R2 | ADR-023 D3 lifecycle model coverage — if an edge case post-accept surfaces during ADR-024 drafting or during the handler implementation iteration that is not cleanly mapped by D3 (e.g., "client accepts, seller regenerates V2 anyway, client opens V1 URL again — what does GET return?"), the contract is incomplete. | Medium | Medium | Medium | **Escalation E-4**: if Architecture surfaces an edge case during ADR-024 drafting that ADR-023 D3 does not cover, ADR-024 records the gap explicitly and either (a) makes a defensive default in ADR-024 that compatibility with D3 is the constraint, or (b) opens an ADR-023-amendment iteration to extend D3. Default in this iteration is (a). The handler iteration's testing phase should produce regression tests for every D3-stipulated lifecycle state to surface any remaining gaps before production traffic. |
| R3 | Sanitization scope creep — the handler iteration (downstream of this spec) starts with the ad-hoc inline sanitizer per Q-arch-4 default, but discovers that legitimate field allowlisting requires nested object traversal, recursive depth checks, or shape-specific DTO mapping. The handler iteration then either ships sloppy sanitization or expands its scope to materialize `lib/security/project-isolation.ts`, blowing past the 2h budget. | Medium | High | High | **Escalation E-1**: if the handler iteration's sanitization layer requires more than ~2h of expansion, the handler iteration MUST pause and open a separate `lib/security/project-isolation.ts` materialization iteration to avoid scope drift. The contract iteration here (this spec) MUST flag E-1 explicitly so the handler iteration's spec inherits the trigger. Default sanitization shape per Q-arch-3 is a flat allowlist over a known shape, well under 2h. |
| R4 | Auth model decision divergence with webhook inbound entries — if Architecture chooses an auth model for the GET endpoint that differs from the POST entries (e.g., signed-token-only without HMAC envelope), the cross-repo auth posture bifurcates. NoonWeb-dev has to reason about two different security models depending on direction. Hard-to-diagnose security bugs become possible. | Low | High | High | ADR-024 MUST justify the auth model choice with explicit comparison to the POST inbound entries. **Default Q-arch-1 = (c) combined** is the symmetric posture and the recommended decision. If Architecture deviates, the ADR MUST explain why the asymmetry is acceptable and how NoonWeb-dev is informed (separate "Auth model differences" subsection in the cross-repo doc). |
| R5 | Cache freshness vs supersede window — Q-arch-7 default `max-age=30, stale-while-revalidate=60` creates a 90s window where a client may see a "you can still accept" UI for a prototipo that has been superseded server-side. If the client clicks accept during the stale window, the POST decision-write endpoint will reject with `410 PROTOTYPE_DECISION_TOKEN_EXPIRED` (per ADR-023 D3). NoonWeb's UX must handle that gracefully (the 410 surfaces as "Este prototipo fue actualizado, pedile el nuevo link al vendedor"). | Low | Low | Low | The 90s window is the natural cost of any cache layer. The write-side (POST decision-write) is the authoritative gate; reads can stale within 90s without correctness harm. NoonWeb-side render iteration is responsible for handling the 410 from POST gracefully. ADR-024 records the eventual-consistency window explicitly. If operator finds 90s too long, Q-arch-7 can flip to (a) `no-store` in a follow-up iteration. |
| R6 | Doc-home cascade renumbering (Q-arch-5 default = extend) — if Architecture picks the extend-existing path, the cross-repo doc's existing §3/§4/§5/§6/§7/... numbering must cascade. References to specific section numbers in ADR-023 (which cites §5.5, §5.7, §5.8, §5.9) and in other docs may go stale. | Medium | Low | Low | Architecture's renumber cascade is mechanical: the existing §5 (`prototype-decision`) becomes a sub-cluster of "Inbound write endpoints" (e.g., §5.A or just keep §5 and add §6 for the read entries). ADR-024 + the Docs step explicitly run `grep` for stale section references and update them. The predecessor spec `fase-3-prototipo-decision-cross-repo-contract.md` already cited the renumber cascade pattern as routine. |

---

## Recommended Testing Methodology

**N/A — no code lands this iteration.**

The Validator gate is contract self-consistency and adherence to v1 doc conventions:

- The new entry's section structure mirrors §3 / §4 / §5 (X.1 endpoint, X.2 request, X.3 idempotency-or-its-absence-with-rationale, X.4 success response, X.5 error responses, X.6 lifecycle, X.7 cache-control, X.8 retry semantics).
- HMAC/auth/headers explicitly reuse §2 (with the empty-body signing-input convention made explicit).
- Error envelope explicitly reuses §7.
- Rate limiting explicitly reuses §8 with the new namespace `prototype-signed-read`.
- Lifecycle invalidation explicitly cites ADR-023 D3 verbatim.
- Transport ledger participation is explicitly declined-by-design with rationale (GET is HTTP-idempotent; ADR-016 applies to writes only).
- All 7 Q-arch questions are resolved in ADR-024 with documented rationale (or escalated to operator if Architecture cannot pick a default with confidence).
- The 4 locked operator decisions (L-1..L-4) and ADR-023 D3 / D8 are restated in ADR-024 as immutable inputs.

When the handler implementation iteration follows up later, testing methodology will be integration-first symmetric to the C-slice POST endpoint (10 unit tests + 2 integration tests + N/A browser per the C-slice plan in the 2026-05-25 handoff §3.2), with additions:
- 1 unit test per Q-arch-2 lifecycle response code (5+ codes → 5+ unit tests).
- 1 integration test for sanitization (asserting strip-list fields are NEVER present in the response, by injecting test data with operator-internal fields and verifying egress is clean).
- 1 integration test for HMAC envelope failure modes (missing headers, stale timestamp, wrong secret).
- 1 integration test for cache-header presence (asserting `Cache-Control: private, max-age=30, stale-while-revalidate=60` on the 200 response).

But that is the handler iteration, not this one.

---

## Definition of Done

Bounded to this iteration only.

- [ ] Spec `specs/fase-3-g22-signed-read-spec.md` Status moved Draft → Approved before Architecture starts.
- [ ] ADR-024 landed at `docs/adrs/ADR-024-<slug>.md` packing resolution of Q-arch-1..Q-arch-7 plus explicit declaration of inheritance from ADR-023 D3 (token invalidation), ADR-016 (ledger decline-by-design for read), ADR-010 (App is operator-only), ADR-013 (sanitization strip invariant for seller-fee fields). References ADR-023 + ADR-016 + ADR-010 + ADR-013 + the 4 operator-locked decisions (L-1..L-4).
- [ ] Cross-repo doc home decision materialized:
  - If Q-arch-5 = extend (default): `docs/integrations/cross-repo-webhook-v1.md` extended with the new inbound-read subsection, symmetric to §3/§4/§5. §1 ASCII diagram updated to show the new GET arrow. §14 (open issues, renumbered) updated if any new open item surfaces.
  - If Q-arch-5 = separate: `docs/integrations/cross-repo-read-v1.md` created with the full contract, and the existing webhook doc gets a one-line cross-reference at the top of §1.
- [ ] `docs/context/project.context.core.md` updated with the contract-firmed entry (no plan-IDs / R-codes per memory rule).
- [ ] Roadmap (`D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md`) synced: G22 logged as firmed contract + handler implementation iteration + NoonWeb-side render iteration as opened follow-up slices in §16 row 9.
- [ ] Close-out handoff written at `docs/handoffs/2026-05-25-g22-signed-read-spec-closure.md` (or similar) capturing the firmed contract + next-session priorities (typically: arrancar C-slice C0 POST endpoint, or NoonWeb-dev acknowledgment loop).
- [ ] PR opened (branch slug TBD by Architecture / close-out per repo convention) with title and body referencing this spec by path. Per memory `feedback_no_auto_merge_prs` — do NOT auto-merge; operator merges.
- [ ] R1 mitigation in PR description: explicit NoonWeb-dev acknowledgment request as closure condition.
- [ ] R4 verified in ADR-024 (auth model symmetric with POST entries OR justified asymmetry).
- [ ] `system-validator` returns COMPLETE.
- [ ] Spec lifecycle Draft → Approved → Implemented on Validator COMPLETE.

---

## Chain Plan

`system-analysis` (this spec) → `system-architecture` (ADR-024) → `system-docs` (cross-repo doc update + context.core + roadmap + closure handoff) → `system-validator` (COMPLETE / PARTIAL / BLOCKED) → close-out (PR open, operator merge).

No Backend / Frontend / Infra / Security / Testing / Refactor in this iteration — no code is shipped. Security is **not invoked as a separate skill** because no new endpoint, validation, or sensitive surface lands here; the contract spec sets the security posture for the future handler iteration but does not exercise it. Architecture in ADR-024 captures the security-posture decisions inline (auth model, sanitization principle, no client identity).

---

## Chunking Decision

**Single iteration, single chunk. Contract-only — no code chunking needed.**

The iteration ships exactly three artifacts: ADR-024 + cross-repo doc home decision materialization (extend or new file) + downstream Docs propagation (context.core + roadmap + handoff). All produced sequentially by Architecture → Docs in one pass; Validator gates as one unit.

Follow-up iterations are independent and may run in any order once the contract is firmed:

- **App-side handler iteration**: implements the route + RLS posture + sanitizer + tests. Soft dependency on B-slice (`prototype_workspaces.share_token` column landing). Naming and module placement are Architecture's decision in ADR-024.
- **NoonWeb-side render iteration**: implements `/maxwell/prototipo/[token]` consuming the firmed contract. Out of this repo entirely. Pure NoonWeb-dev iteration.
- **C-slice POST endpoint iteration** (already separately routed per 2026-05-25 handoff): implements the POST decision-write endpoint. Can run in parallel with the App-side handler iteration here; they share no module boundary.

The iteration explicitly does NOT block on NoonWeb-side readiness. Contract is publishable without NoonWeb-side commitment per Risk R1 acceptance.

---

## Path

- **This spec**: `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-g22-signed-read-spec.md`
- **ADR to emit (Architecture next)**: `D:\Pedro\Proyectos\Noon\App-nooncode\docs\adrs\ADR-024-<slug>.md` (suggested slug: `prototype-signed-read-cross-repo-contract`)
- **Doc to extend or create (Docs next)**:
  - Default (Q-arch-5 = extend): `D:\Pedro\Proyectos\Noon\App-nooncode\docs\integrations\cross-repo-webhook-v1.md`
  - Alternative (Q-arch-5 = separate): `D:\Pedro\Proyectos\Noon\App-nooncode\docs\integrations\cross-repo-read-v1.md` (new file)
- **Close-out handoff (Docs/close-out)**: `D:\Pedro\Proyectos\Noon\App-nooncode\docs\handoffs\2026-05-25-g22-signed-read-spec-closure.md` (or equivalent date-tagged path)
- **Predecessor spec (template/format reference)**: `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-prototipo-decision-cross-repo-contract.md`
- **Anchor ADR**: `D:\Pedro\Proyectos\Noon\App-nooncode\docs\adrs\ADR-023-prototype-decision-cross-repo-contract.md` (this iteration discharges its D8 defer)
- **Inbound handoff (router decision input)**: `D:\Pedro\Proyectos\Noon\App-nooncode\docs\handoffs\2026-05-25-c-slice-adr-023-router-handoff.md`

---

## Handoff Payload — to `system-architecture`

- **Task summary**: see `## Task Summary`.
- **Scope boundary**: `## Scope Boundary` — strict. Out-of-scope list is the router lock, authoritative.
- **Acceptance criteria**: see `## Definition of Done`.
- **Affected files**: `## Affected Files / Modules`.
- **Dependencies**: `## Dependencies` — primarily contract dependencies (cross-repo-webhook-v1.md + ADR-023 D3/D8 + ADR-010 + ADR-016 + project memory).
- **Assumptions**: `## Assumptions` (10 items). Break any → stop and update spec.
- **Open questions**: `## Open Questions / Q-arch` (Q-arch-1 through Q-arch-7) — each has a default with tradeoffs; Architecture documents deviations in ADR-024.
- **Risks**: `## Risks` (R1–R6). R3 (sanitization scope creep / E-1) and R4 (auth-model divergence) are the most likely to require explicit Architecture verification work in ADR-024.
- **Locked operator decisions (INPUTS — do NOT relitigate)**:
  - L-1: Client decides on prototipo, not propuesta.
  - L-2: Pull pattern B.2 for prototipo render (this surface IS the implementation of L-2's read path).
  - L-3: Option β for post-accept propuesta generation.
  - L-4: Dual-gate rejection control (Gate A credits + Gate B iteration cap).
- **Locked architectural decisions inherited from ADR-023 (INPUTS — do NOT relitigate)**:
  - D3: state-driven token invalidation (no calendar TTL; supersede via `share_token_superseded_at`; hard-delete cascade).
  - D8: this iteration discharges the deferred render-read endpoint declaration.
- **Recommended depth**: FULL (already locked by router).
- **Chunking decision**: single iteration, single chunk; Architecture-led output. No code.
- **Success criterion**: see `## Success Criterion`.
- **Recommended testing methodology**: N/A (no code). Handler iteration's methodology is sketched in `## Recommended Testing Methodology` for downstream continuity.
- **Path to this spec**: `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-g22-signed-read-spec.md`.
- **Next ADR number**: ADR-024 (next available after ADR-023).
- **Doc to extend (default Q-arch-5)**: `docs/integrations/cross-repo-webhook-v1.md` with new inbound-read subsection, symmetric to §3/§4/§5.
- **Effort estimate (operator-firmed 2026-05-25)**: 3-4h docs-only across Architecture + Docs + Validator.

---

## Lifecycle

- **Draft** — 2026-05-25 (analysis output)
- **Approved** — 2026-05-25 (Architecture emitted ADR-024 packing D1-D7; Docs materialized cross-repo doc §6 + renumber cascade §6→§17 + §1 ASCII diagram + §2.1 empty-body note + §12/§15/§17 updates; context.core extended with ADR-024 rule + ADR-023 D8-discharge acknowledgment; roadmap §16 G22 row flipped PENDIENTE → RESUELTO 2026-05-25 + §17 snapshot 2026-05-25 evening appended; NoonWeb-dev handoff at `docs/handoffs/2026-05-25-maxwell-chat-cross-repo-contracts-noonweb-handoff.md` (extended same day to also cover the POST `prototype-decision` wire spec from ADR-023+ADR-025; renamed from `2026-05-25-g22-signed-read-noonweb-handoff.md`); Validator COMPLETE 2026-05-25)
- **Implemented** — pending (post-merge of the App-side PR carrying ADR-024 + cross-repo-webhook-v1.md §6 + context.core update + this spec; the predecessor spec `fase-3-prototipo-decision-cross-repo-contract.md` flipped its own Implemented marker after PR #105 merged 2026-05-23 — same pattern applies here)
- **Archived** — n/a

Status changes recorded inline as dated notes when transitioned. Spec is not edited after Implemented; follow-up iterations (App-side handler iteration + NoonWeb-side render iteration) create new spec files and reference this one.
