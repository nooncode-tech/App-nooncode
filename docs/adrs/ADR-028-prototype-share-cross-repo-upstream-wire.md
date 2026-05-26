# ADR-028: Prototype-share cross-repo upstream wire — Web→App lead/workspace create + share_token emit

**Status:** Proposed
**Date:** 2026-05-26
**Deciders:** Pedro (Engineering owner), Piedra (App owner) — pending review; system-architecture
**Supersedes:** None
**Related:**
- ADR-023 (prototype-decision cross-repo contract — defines the downstream POST decision wire that consumes the token this ADR proposes to emit)
- ADR-024 (prototype-signed-read cross-repo contract — defines the GET render-time fetch keyed on the token)
- ADR-025 (prototype-decision impl architecture firmups — App-side persistence + RPC firmups for the downstream)
- ADR-016 (transport-level webhook ledger pattern — the new endpoint sits behind the same `website_webhook_events` ledger)
- ADR-010 (client portal lives in NoonWeb — App is operator-only)
- `docs/integrations/cross-repo-webhook-v1.md` (the contract doc this ADR extends with a 4th symmetric inbound entry)
- noon-web-main: `lib/maxwell/prototipo-decision.ts` and `lib/maxwell/prototipo-render-fetch.ts` (Web-side helpers for the downstream wire; pattern this ADR mirrors for the upstream helper)

---

## Context

The D-slice landed on `main` (NoonWeb) 2026-05-26 via PRs #17 + #18. It implements the public route `/maxwell/prototipo/[token]`: render the prototipo via signed-read (ADR-024 Pull B.2) and capture the client's accept/reject via POST decision (ADR-023). A bilateral handshake smoke against App `develop` on 2026-05-26 validated the HMAC envelope and the error taxonomy mapping end-to-end.

The smoke also exposed the gap this ADR addresses: **the upstream that issues the `share_token` does not exist in NoonWeb.** Three independent greps confirmed:

- `app/api/maxwell/proposal/` has no references to `share_token`, `prototype-decision`, nor `postNoonAppWebhook` calls to a token-emitting endpoint.
- The whole `app/` tree has no file that POSTs to App for the purpose of creating a workspace and emitting a token.
- `components/maxwell/` has no references to `share_token` nor to `/maxwell/prototipo/`.

The legacy Maxwell flow currently ends at `POST /api/maxwell/proposal` (generates proposal text via LLM) and redirects the seller to `/contact?source=maxwell-studio-agent`. There is no UX path that creates a `prototype_workspaces` row in App, asks App to emit a `share_token`, and surfaces the resulting URL `/maxwell/prototipo/<token>` to the seller for them to forward to the client.

The D-slice plan dated 2026-05-25 explicitly scoped this as deferred: "~70% buildable without App dependencies; Pull B.2 render fetch blocked until App ships signed-read." The upstream wire is the remaining ~30%, scoped to its own iteration here.

App-side context that frames the proposed contract:

- App today exposes 4 endpoints under `/api/integrations/website/`: `inbound-proposal`, `payment-confirmed`, `prototype-decision`, `prototype-signed-read`. None of them creates a `prototype_workspaces` row from a Web trigger and returns the issued token.
- ADR-023 D2 establishes that the token is **App-issued**, opaque, and resolved server-side. ADR-023 D3 establishes the lifecycle (state-driven, regenerate supersedes, no calendar TTL).
- ADR-023 D4 establishes `prototype_decisions` as the persistence target for the downstream. ADR-025 D3 records that B-slice and C-slice landed bundled in migration `0060_phase_23a_prototype_decisions.sql`. Whether that B-slice already generates `share_token` on workspace creation, and via which trigger, is one of the load-bearing open questions for Piedra below (Q-piedra-1).

Architecture's job in this iteration is to firm the upstream wire contract and the noon-web-main implementation surface that consumes it, without inventing App-side internals beyond what the cross-repo contract requires. No code lands in this iteration; the deliverable is this ADR plus the §6 extension of `docs/integrations/cross-repo-webhook-v1.md` (to be drafted in the same App-side PR).

The architecturally load-bearing questions:

- **Q-arch-1** — New symmetric inbound entry, or extension of the existing `inbound-proposal` response shape?
- **Q-arch-2** — What payload does Web send to identify the prototipo to share (v0 chat id, deployed url, version_number, lead context)?
- **Q-arch-3** — What response shape does App return: token only, token + URL, token + URL + workspace_id + lead_id?
- **Q-arch-4** — Where does Web persist the token + URL + state on its own DB (column extension on `studio_session`, or new table)?
- **Q-arch-5** — Does the studio state machine need a new `prototype_shared` phase, or can the new state be derived from non-null columns?
- **Q-arch-6** — Does the new wire ADDITIVE coexist with the legacy proposal-send flow, or REPLACE it?
- **Q-arch-7** — Single feature flag (`MAXWELL_PROTOTIPO_DECISION_ROUTE` reused) or separate flag for the upstream CTA?

Three operator inputs are taken as **immutable** here (do not relitigate):

- **L-1.** Token is App-issued and opaque (ADR-023 D2).
- **L-2.** Token lifecycle is state-driven; regenerate supersedes, accept terminates, reject does not auto-invalidate (ADR-023 D3).
- **L-3.** The cross-repo wire uses the v1 HMAC envelope and the v1 transport-level ledger (`docs/integrations/cross-repo-webhook-v1.md` §2 + §10 / ADR-016).

---

## Decision

The fourth Web→App inbound webhook entry **`prototype-share`** is defined symmetrically with the existing three (`inbound-proposal`, `payment-confirmed`, `prototype-decision`). The full wire-level shape lives in `docs/integrations/cross-repo-webhook-v1.md` §6 (to be added in the same App-side PR as this ADR). This section defines the architectural decisions that bound it.

### D1 — Q-arch-1 resolved: new symmetric inbound entry, not an extension of `inbound-proposal`

A new endpoint `POST /api/integrations/website/prototype-share` is added to App, accepting signed JSON from NoonWeb. Rationale for separating it from `inbound-proposal`:

1. **Semantic distinctness.** `inbound-proposal` is the legacy proposal-review path: it creates a `lead_proposals` row that goes into PM review (ADR-010). `prototype-share` creates (or returns the existing) `prototype_workspaces` row and emits a `share_token` for the client-portal decision flow defined by ADR-023. The two are orthogonal concerns; bundling them into one endpoint would couple proposal-review state to prototipo-share state in a way that complicates idempotency, error mapping, and future evolution.
2. **Response shape conflict.** `inbound-proposal` returns `{ linkId, leadId, proposalId, status }` (ADR-023 cross-repo doc §3.4). Adding `share_token` to that response would require all current callers (the legacy `inbound-proposal` flow) to either ignore the field or trigger a side effect they did not opt into. Optional fields with side-effect semantics are a contract anti-pattern.
3. **Independent rate limit + ledger semantics.** Per `docs/integrations/cross-repo-webhook-v1.md` §9, each endpoint gets its own 120 req/min counter under an independent namespace. Sharing a counter between proposal-review and prototipo-share would let one path's bursts starve the other.
4. **Precedent.** ADR-023 D1 made the same call for `prototype-decision` (separate endpoint, not an extension of an existing one). This ADR follows that pattern for symmetry.

The endpoint reuses the v1 HMAC-SHA256 protocol per `docs/integrations/cross-repo-webhook-v1.md` §2 (same shared secret `NOON_WEBSITE_WEBHOOK_SECRET`, same `x-noon-timestamp` + `x-noon-signature` headers, same ±5min clock-skew window, same byte-fidelity signing input `${timestamp}.${bodyText}`). It sits behind the existing `website_webhook_events` ledger per ADR-016, with the discriminator value `'prototype-share'` added to the table's `CHECK (endpoint in (...))` constraint and to the helper's `WebsiteWebhookEndpoint` union type. Identity key is the same shape `(endpoint, signature_hash)`; bit-identical replay returns the same wire response with HTTP 200 (`idempotent: true`).

### D2 — Q-arch-2 resolved: payload identifies the prototipo by `(external_session_id, v0_chat_id, version_number)` + carries lead context

The payload Web sends to App:

```json
{
  "external_source": "noon_website",
  "external_session_id": "string (required, non-empty, NoonWeb studio_session.id)",
  "lead": {
    "business_name": "string (required, non-empty, trimmed)",
    "project_type_label": "string (required, non-empty, e.g. 'Landing Page')",
    "customer": {
      "name": "string | null (optional, may be unknown at share time)",
      "email": "string | null (optional, valid email if present, lowercased on receive)",
      "phone": "string | null (optional)",
      "whatsapp": "string | null (optional)",
      "company": "string | null (optional)"
    }
  },
  "prototype": {
    "v0_chat_id": "string (required, non-empty, identifies the V0 chat that built this artifact)",
    "version_number": "integer >= 1 (required)",
    "deployed_url": "string (required, https URL of the V0 deploy)",
    "generated_html": "string | null (optional, srcdoc fallback if deployed_url is unreachable)",
    "generated_at": "ISO 8601 string (required, when V0 produced the build)"
  },
  "metadata": "<record, optional, NoonWeb may forward additional context; App preserves but does not interpret>"
}
```

**Field rationale:**

- `external_session_id` ties the share to the studio session for trace correlation and idempotency-by-resource (D4 below). Web already holds this UUID; sending it costs nothing and lets App's structured logs join cleanly to Web's session logs.
- `lead.business_name` + `lead.project_type_label` are required because App needs to populate or reconcile the lead row that owns the new `prototype_workspaces`. They duplicate fields that App may already have if `inbound-proposal` ran first; App's handler is responsible for deduplicating via the lead-resolution path (Q-piedra-3).
- `lead.customer` fields are optional because the share moment may precede full customer capture. App should be tolerant of NULLs and reconcile on a later `inbound-proposal` if/when the customer details solidify.
- `prototype.v0_chat_id` is the upstream-of-token identity: regenerate = new V0 chat = new workspace = new token. The (`external_session_id`, `v0_chat_id`) pair is the natural application-level dedup key (D4).
- `prototype.deployed_url` MUST be a valid `https://` URL. App stores it on the new workspace row.
- `prototype.generated_html` is an optional fallback. If both `deployed_url` and `generated_html` are NULL → 400 (no artifact to share). Schema validation enforces this.
- `prototype.generated_at` is the V0 build timestamp, used by App for ordering and audit. Falls back to `now()` if absent (defensive).

### D3 — Q-arch-3 resolved: response returns `share_token` + `prototype_workspace_id` + `lead_id` + lifecycle context; URL is composed by NoonWeb

```json
{
  "data": {
    "idempotent": "boolean",
    "share_token": "string (opaque, App-issued, the same value that prototype_workspaces.share_token holds)",
    "prototype_workspace_id": "uuid (the workspace row that owns this token)",
    "lead_id": "uuid (the lead row that owns the workspace)",
    "version_number": "integer >= 1 (echo of the version that this share refers to)",
    "issued_at": "ISO 8601 string (when App emitted/last-validated the token)",
    "superseded_workspace_ids": "uuid[] (zero or more prior workspace ids whose tokens this share invalidates, per ADR-023 D3 regenerate semantics; empty array on V1)"
  },
  "requestId": "string"
}
```

HTTP status: `201` if newly created, `200` if idempotent replay (transport-level OR application-level dedup hit).

**Why token-only, not URL:**

The URL the client sees is `https://<noonweb-host>/<locale>/maxwell/prototipo/<token>`. The route is owned by NoonWeb (per ADR-010); the hostname and locale segment are NoonWeb's concerns. App returning a full URL would force App to know NoonWeb's deployment URL per environment (Preview vs Production) and pick a locale, which it has no business doing. Token-only response keeps the separation clean: App owns the token, NoonWeb owns the URL composition.

**Why include `superseded_workspace_ids`:**

When a seller regenerates V2 from a session that previously shared V1, App invalidates the V1 token (per ADR-023 D3). NoonWeb needs to know the V1 token is dead so its own `studio_session.share_token` column can be updated and the previously-shared URL flagged as superseded in Web's audit log. Returning the list lets NoonWeb take action without a second roundtrip. On V1 (first share), the array is empty.

### D4 — Idempotency: transport-level + application-level dedup keyed on `(external_session_id, v0_chat_id)`

**Transport-level (per ADR-016 / `docs/integrations/cross-repo-webhook-v1.md` §10.2):** identical to the other three inbound entries. Identity key `(endpoint, signature_hash)` where `endpoint = 'prototype-share'` and `signature_hash = sha256(${timestamp}.${bodyText})`. Bit-identical replay returns the original wire-shape response with HTTP `200` and `idempotent: true`. The handler MUST sit behind the existing `website_webhook_events` ledger; the `endpoint` CHECK constraint is extended to include `'prototype-share'`.

**Application-level (resource dedup):** keyed on `(external_session_id, v0_chat_id)`. If a request arrives with a pair that maps to an existing `prototype_workspaces` row whose state is not `archived`, App returns the existing `share_token` with HTTP `200` and `idempotent: true`. The application-level dedup is what handles the case where NoonWeb retries after a network blip with a slightly different `bodyText` (e.g., updated customer email) but the same underlying prototipo — transport-level would not detect this as a replay, but the resource is the same.

**No payload-level idempotency.** Specifically, no `share_request_id` UUID, no `Idempotency-Key` header. Per ADR-016 D2 / ADR-023 D1, the transport ledger is the single explicit idempotency layer; application-level dedup is an internal optimization, not part of the contract surface.

### D5 — Error response taxonomy

Common shape per `docs/integrations/cross-repo-webhook-v1.md` §8.

| HTTP | Code | When |
|---|---|---|
| `401` | `WEBSITE_WEBHOOK_AUTH_FAILED` | Missing/invalid signature, stale timestamp (±5min window violated), missing secret |
| `400` | (validation) | Body is not JSON, schema violation per D2 |
| `400` | `PROTOTYPE_SHARE_INVALID_PROTOTYPE` | `prototype.deployed_url` not https, or both `deployed_url` and `generated_html` are NULL, or `version_number < 1` |
| `400` | `PROTOTYPE_SHARE_INVALID_LEAD` | `lead.business_name` or `lead.project_type_label` empty after trim |
| `409` | `PROTOTYPE_SHARE_WORKSPACE_TERMINAL` | The resource-dedup found an existing workspace with state `accepted` or `archived`. The seller must regenerate to share a new version |
| `429` | (rate limit) | More than 120 requests/minute from sender — namespace `prototype-share`, independent counter |
| `500` | `PROTOTYPE_SHARE_PERSIST_FAILED` | DB error during INSERT or workspace lookup |
| `500` | `PROTOTYPE_SHARE_TOKEN_GENERATION_FAILED` | App could not generate a unique `share_token` (collision after N retries on `prototype_workspaces.share_token UNIQUE`) |

Each `PROTOTYPE_SHARE_*` code maps to a deterministic NoonWeb-studio UX state (D9 below). NoonWeb's helper must surface the structured `code` field so the studio UI can render the right error copy.

### D6 — Q-arch-4 resolved: Web-side persistence via additive columns on `studio_session`, not a new table

Add four nullable columns to `public.studio_session`:

```sql
alter table public.studio_session
  add column prototype_workspace_id uuid,
  add column share_token text,
  add column share_token_url text,
  add column prototype_shared_at timestamptz;

create unique index ux_studio_session_share_token
  on public.studio_session(share_token)
  where share_token is not null;

create index idx_studio_session_prototype_workspace
  on public.studio_session(prototype_workspace_id)
  where prototype_workspace_id is not null;
```

**Why columns, not a new `studio_prototype_shares` table:**

1. **App is the system of record for share history.** Per ADR-023 D4, `prototype_decisions` (App-side) joined to `prototype_workspaces` (App-side) is the canonical event log of the full share lifecycle. NoonWeb-side only needs the **current** state per studio session to render the studio UI. Duplicating history on the Web side would invite drift.
2. **Regenerate semantics are 1:1 per session at any given time.** When the seller regenerates V2, the V1 token is superseded (per D3's `superseded_workspace_ids`). The studio session's columns OVERWRITE to point at V2. There is never a moment where one session has two live tokens.
3. **Soft-delete via NULL is sufficient.** Setting `share_token = NULL` and `prototype_shared_at = NULL` cleanly reverts the session to pre-share state, which is what the regenerate path needs.

The unique partial index on `share_token` defends against the rare case where two sessions could end up holding the same token (App should never emit duplicates, but the index makes the invariant DB-enforced and surfaces App-side bugs immediately).

The partial index on `prototype_workspace_id` supports the audit query "which Web session shared workspace X" without scanning the whole table.

**Migration file (Web-side):** `supabase/migrations/20260527_019_studio_session_share_token.sql` (or the next sequential number — los devs to confirm against the current head of `supabase/migrations/`). ADDITIVE only: no column drops, no existing data touched. Reversible via `drop column ... cascade` if needed.

**Backfill:** none required. Existing rows stay NULL; the new wire only writes when sellers explicitly share.

### D7 — Q-arch-5 resolved: add `prototype_shared` phase to the studio state machine

Current state machine in `lib/maxwell/state-machine.ts`:

```
intake → clarifying → generating_prototype → prototype_ready
prototype_ready → revision_requested | approved_for_proposal
revision_requested → revision_applied | prototype_ready
revision_applied → prototype_ready
approved_for_proposal → proposal_pending_review
proposal_pending_review → proposal_sent | approved_for_proposal
proposal_sent → converted
```

Proposed ADDITIVE change:

```
prototype_ready → revision_requested | approved_for_proposal | prototype_shared   (← NEW transition)
prototype_shared → revision_requested | approved_for_proposal                     (← NEW state, new transitions)
```

**Rationale for a real state vs. derived state via column nullability:**

1. **Explicit transitions are testable.** The state machine table is the contract for what the studio is allowed to do. Adding a phase forces `state-machine.test.ts` to enumerate the new transitions, which catches regressions when someone later changes the UI flow.
2. **UX semantics depend on the phase.** The `studio-proposal-cta.tsx` component branches on `phase` to render the right block. A derived state (column not null) would require every consumer to compute the same boolean, which scales poorly.
3. **Legacy proposal-send remains reachable.** From `prototype_shared` the seller can still go to `approved_for_proposal` (then proposal_pending_review etc.). This is the ADDITIVE-coexistence path (D11). Adding the state does not close any existing door.
4. **Reactivity to client decisions is out of scope here.** Web does NOT auto-transition `prototype_shared → converted` on a client accept. App fires its post-accept Maxwell draft per ADR-023 D6 fire-and-forget; the seller's notification arrives via the existing `user_notifications` pipeline. If a future iteration wants Web to reactively reflect "client accepted → seller can now wrap up", that introduces a callback contract (App → Web on accept) which is its own ADR.

### D8 — Web-side outbound helper

New file: `lib/maxwell/prototipo-share.ts`. Mirrors the pattern of `lib/maxwell/prototipo-decision.ts`:

- Exports `requestPrototipoShare(input: RequestPrototipoShareInput): Promise<RequestPrototipoShareResult>`
- Builds the payload per D2; signs and POSTs via `postNoonAppWebhook("/api/integrations/website/prototype-share", payload)`
- Maps App's response (success or `NoonAppIntegrationError`) to a discriminated union the Server Action consumes
- Retry inherited from `postNoonAppWebhook`: 3 attempts total, 1s + 2s backoff with ±20% jitter, retry on 5xx + network errors, do not retry on 4xx

Companion types file: `lib/maxwell/prototipo-share-types.ts`. Exports:

- `PrototipoSharePayload` (the wire-shape outbound)
- `PROTOTIPO_SHARE_ERROR_CODES` const (the D5 error code set)
- `PrototipoShareErrorCode` (union type)
- `RequestPrototipoShareResult` (discriminated union: `{ status: 'ok', data: {...} } | { status: 'error', code, httpStatus, message }`)
- `mapShareResultToUxState(result) → PrototipoShareUxState` (pure function, mirrors `mapResultToUxState` in `prototipo-decision-types.ts`)
- `PrototipoShareUxState` (discriminated union of UX buckets: `idle | sharing | success | terminal.workspace-locked | transient.persist-failed | transient.rate-limited | fatal.unknown`)

### D9 — Web-side Server Action

New file: `app/[locale]/maxwell/studio/_actions/share-prototype.ts` (or the equivalent path matching the current Maxwell studio route structure — los devs to confirm; the page that owns this action is the studio page, not the public prototipo page).

Responsibilities:

1. Validate the seller owns the session (use existing `viewerOwnsStudioSession` ownership helper).
2. Pull the latest prototype version from `studio_session` (`v0_chat_id`, `version_number`, `previewUrl`/`deployedUrl`).
3. Call `requestPrototipoShare` with the payload.
4. On `ok`: persist the result (`share_token`, `share_token_url`, `prototype_workspace_id`, `prototype_shared_at`) on the studio_session row; transition state `prototype_ready → prototype_shared` via `assertValidTransition`; revalidate the studio page; return `{ uxState: { kind: 'success', shareUrl } }`.
5. On `error`: log structured event `studio.share.error` with the App `requestId` (if present); return `{ uxState: mapShareResultToUxState(...) }`.

URL composition (the value stored in `share_token_url`): `<canonical-locale-prefixed-noonweb-base>/maxwell/prototipo/<token>`. The base is read from a new env var `NOON_WEBSITE_PUBLIC_BASE_URL` (defaults to `https://noon-main.vercel.app` on Production, the request origin in Preview/Development). Locale is the seller's current studio locale.

### D10 — UI integration point

Modify `components/maxwell/studio-proposal-cta.tsx`:

- Add a new branch when `phase === "prototype_shared"`: shows the shareable URL with a "Copy link" button (clipboard API) + a status badge "Compartido con el cliente — esperando decisión" + secondary buttons "Pedir cambios" (transitions to revision_requested) and "Enviar propuesta detallada" (legacy path to approved_for_proposal).
- When `phase === "prototype_ready"` AND `MAXWELL_PROTOTIPO_DECISION_ROUTE === "1"` (D11 below): add a primary CTA "Compartir prototipo con el cliente" alongside the existing `onApprove` / `onRequestCorrection` / `onRequestProposal` buttons. Clicking dispatches the Server Action from D9.
- When `phase === "prototype_ready"` AND the flag is OFF: legacy CTA unchanged.

Loading state for the new CTA mirrors the existing `Loader2` spinner pattern in the file. Error UX (per D5 codes mapped via D8's `mapShareResultToUxState`):

| UX bucket | Copy |
|---|---|
| `terminal.workspace-locked` | "Este prototipo ya fue aceptado o archivado. Generá una nueva versión para compartir." |
| `transient.persist-failed` | "No pudimos compartir el prototipo. Probá nuevamente en unos segundos." |
| `transient.rate-limited` | "Demasiados intentos. Esperá un minuto e intentá de nuevo." |
| `fatal.unknown` | "Ocurrió un error inesperado al compartir el prototipo. Si persiste, contactá a soporte." |

All ES copy strings are subject to copy review by Mel before merge, same review pattern as the D-slice client-facing strings.

### D11 — Q-arch-7 resolved: reuse `MAXWELL_PROTOTIPO_DECISION_ROUTE` flag for the upstream CTA

Single feature flag gates both the downstream route (D-slice public prototipo page) and the upstream CTA (this slice). Rationale:

1. **Atomic enable/disable.** When the flag is OFF, sellers don't see the CTA AND clients can't reach `/maxwell/prototipo/[token]` (it `notFound()`s). Turning the flag ON enables both surfaces together. Avoids a partial-state where the CTA is visible but the route 404s, or the route is reachable but no seller can emit a token.
2. **Single bilateral smoke.** Production flip of the flag is the moment to validate the end-to-end happy path. Sellers can immediately share; clients can immediately decide. Splitting flags would require two independent smokes.
3. **Rollback simplicity.** If post-flip something breaks, flipping back to OFF reverts both surfaces atomically.

A separate flag would only be justified if the upstream and downstream had genuinely different rollback risks. They don't — both are gated by the same App-side endpoints which are either live or not.

### D12 — Q-arch-6 resolved: ADDITIVE coexistence with legacy proposal-send; deprecation deferred

For this iteration, both the new prototype-share flow AND the legacy proposal-send flow are available to the seller from `prototype_ready`:

- "Compartir prototipo con el cliente" → new flow (this ADR)
- "Generar propuesta detallada" → legacy flow (existing `POST /api/maxwell/proposal` + `inbound-proposal` cross-repo path)

The seller picks based on the use case (the new flow is appropriate when the client wants to see and approve the prototipo themselves; the legacy flow is appropriate when the seller wants to package a full proposal for the operator review path per ADR-010).

**Why defer the deprecation decision:**

1. **Insufficient data.** The new flow has not run in production yet; we cannot know how often sellers prefer it to the legacy path.
2. **Different downstream paths.** The new flow leads to `prototype_decisions` (client-portal decision); the legacy flow leads to `lead_proposals.review_status` (PM operator review per ADR-010). These are not equivalent — deprecating the legacy path would also deprecate the PM review surface, which is a stakeholder-impacting decision separate from this wire-level architecture.
3. **Reversibility cost.** Adding a CTA is cheap. Removing a CTA later, after sellers have built habits around it, is more disruptive. ADDITIVE-first matches the data migration rule (D14 below) at the UX level.

A follow-up iteration after the upstream wire has been live for some period (≥2 weeks of seller usage data) can decide whether to deprecate the legacy CTA, sunset `inbound-proposal` cross-repo entry for new sessions, or keep both indefinitely. That decision is owner-level and outside this ADR's scope.

### D13 — Test matrix

**Web-side tests required for implementation readiness:**

- `tests/maxwell/prototipo-share.test.ts` (new) — exercises `requestPrototipoShare` against mocked `global.fetch`. Mirrors `prototipo-decision.test.ts`:
  - Happy path: 201 response, all fields parsed, idempotent=false.
  - Idempotent replay: 200 response, idempotent=true, same token returned.
  - Each D5 error code: 401, 400×2, 409, 429, 500×2 — assert the structured code surfaces and the UX state mapper buckets correctly.
  - Network failure: assert maps to `transient.persist-failed` with `httpStatus: 0`.
  - Misconfigured env: missing `NOON_WEBSITE_WEBHOOK_SECRET` or `NOON_APP_BASE_URL` — assert short-circuits to AUTH_FAILED before fetch is called.
  - The UX state mapper: tabular coverage of every `PROTOTIPO_SHARE_ERROR_CODES` → UX bucket.
- `tests/maxwell/state-machine.test.ts` (extend existing) — add cases for the new transitions:
  - `prototype_ready → prototype_shared` allowed.
  - `prototype_shared → revision_requested` allowed.
  - `prototype_shared → approved_for_proposal` allowed.
  - `prototype_shared → prototype_ready` NOT allowed (no auto-revert; explicit revision must go through revision_requested).
  - Legacy transitions unchanged.
- `tests/visual/studio-share-cta.spec.ts` (new Playwright a11y) — renders the studio at `phase = "prototype_ready"` with the flag ON and at `phase = "prototype_shared"`, asserts axe-clean across the new CTA states + the success URL display. One viewport, one theme, same scope as the D-slice a11y spec.

**Out of scope for this iteration (deferred to future):**

- E2E bilateral smoke with a real token (gated by Piedra's confirmation that B-slice emits `share_token` per Q-piedra-1).
- Reactivity test for "client accepted → seller's studio shows it" (no Web↔App callback exists; see D7 rationale).
- Load test of the new endpoint under regenerate burst (out of scope; the 120 req/min limit is well above realistic seller cadence).

### D14 — Migration discipline: additive-first, expand-migrate-contract not yet needed

The Web-side migration `20260527_019_studio_session_share_token.sql` is additive only:

- New nullable columns: `prototype_workspace_id`, `share_token`, `share_token_url`, `prototype_shared_at`.
- New partial indexes: `ux_studio_session_share_token`, `idx_studio_session_prototype_workspace`.
- No existing column modified, no existing index dropped, no data backfilled.

Reversible via `drop column ... cascade` on the four columns. The indexes drop with the columns.

The expand-migrate-contract pattern does NOT apply here because no schema shape is being changed from one form to another — entirely new columns are being introduced. If a future iteration replaces `share_token text` with something else (e.g., a structured `share_token_metadata jsonb`), that migration WILL need expand-migrate-contract semantics; it is out of scope here.

**Locking concerns:** `studio_session` is a hot table in the Maxwell flow but `ADD COLUMN` with a default of NULL on PostgreSQL ≥11 is a metadata-only operation (no table rewrite, no AccessExclusiveLock held during a scan). The two `CREATE INDEX` calls should use `CREATE INDEX CONCURRENTLY` to avoid holding the write lock; los devs to confirm against the project's existing migration conventions (most prior migrations in `supabase/migrations/` appear to use blocking `CREATE INDEX`; given Maxwell's current write volume on `studio_session` is low, blocking is acceptable for this iteration, but `CONCURRENTLY` is the safer default).

### D15 — Module boundaries

| Module | Owns | Does NOT own |
|---|---|---|
| `lib/maxwell/prototipo-share.ts` | HTTP transport, retry semantics, error envelope parsing, response shape validation | Persistence, state transitions, UX copy, URL composition |
| `lib/maxwell/prototipo-share-types.ts` | Wire types, error code constants, UX state mapper (pure function) | I/O, side effects |
| `app/[locale]/maxwell/studio/_actions/share-prototype.ts` | Ownership check, payload composition from session state, persistence via repository, state-machine transition, structured logging, URL composition | HTTP transport (delegates to prototipo-share), UX copy (delegates to component) |
| `lib/maxwell/repositories.ts` (extension) | DB write for the new four columns | Business logic, validation, URL composition |
| `lib/maxwell/state-machine.ts` (extension) | New `prototype_shared` phase + transitions, validation | DB writes, UX |
| `components/maxwell/studio-proposal-cta.tsx` (extension) | Render branches, clipboard interaction, loading/error UX | Server Action transport, persistence, state mutation (delegates to action) |

### D16 — Shortcuts (allowed) and forbidden shortcuts

**Allowed shortcuts (with cost recorded):**

- **No retry on top of `postNoonAppWebhook`'s built-in 3-attempt loop.** The helper does not add a fourth retry layer. Cost: if all 3 attempts fail, the seller sees a `transient.persist-failed` and must click again manually. This is acceptable for the first iteration because (a) the action is seller-initiated and synchronous, (b) the seller can retry trivially. Future work: add a server-side queue if the failure rate becomes a UX problem.
- **No background revalidation of stale `share_token` on the Web side.** If App invalidates a token externally (e.g., admin archives the workspace), Web's `studio_session.share_token` column stays populated until the seller's next interaction. Cost: the seller may see a stale URL for some period. Future work: a periodic sweep or a Web↔App callback to invalidate. Out of scope here because the seller-facing UX consequence is "you'll find out when you try to use it" which is acceptable.
- **No granular telemetry on the new CTA beyond structured logging.** Existing Sentry hooks per memory `feedback_observability_choice` capture errors; no new analytics events are introduced. Cost: we won't know precisely how often the CTA is used vs the legacy path. Future work: add an event if the deprecation decision needs the data.

**Forbidden shortcuts (with rationale):**

- **Do not embed the URL composition in the App response.** Per D3 rationale — App returns the token, Web composes. Embedding the URL in App would couple App to NoonWeb's deployment topology and is a contract anti-pattern.
- **Do not skip the `share_token UNIQUE` index.** Per D6 — the index is the DB-level invariant that catches App-side token-generation bugs. Cost-of-omission is too high (silent dual-token corruption).
- **Do not introduce a payload-level idempotency key.** Per D4 / ADR-016 D2 — transport ledger is the single layer. Two layers create ambiguity about which is authoritative on conflict.
- **Do not auto-transition `prototype_shared → converted` on perceived client accept.** Per D7 — no Web↔App callback exists. Inferring acceptance from Web-side polling would be a contract violation against ADR-023 D6 (App owns the post-accept side effect).
- **Do not deprecate the legacy proposal-send flow in this iteration.** Per D12 — deprecation is a stakeholder decision separate from architecture.

---

## Implementation surface

Paths repo-relative. Web = `noon-web-main` repo; App = `App-nooncode` repo.

**App-side (this PR or a sibling PR — los devs to confirm with Piedra):**

- `docs/adrs/ADR-028-prototype-share-cross-repo-upstream-wire.md` (this file)
- `docs/integrations/cross-repo-webhook-v1.md` — new §6 entry `prototype-share` mirroring §3/§4/§5 structure
- `app/api/integrations/website/prototype-share/route.ts` (new)
- `lib/server/website-integration.ts` — new exported `receiveWebsitePrototypeShare(input)` handler
- `supabase/migrations/<next>_prototype_share_endpoint.sql` — extends `website_webhook_events.endpoint` CHECK constraint to include `'prototype-share'`; ensures `prototype_workspaces.share_token` is UNIQUE and generated on workspace creation (verify against B-slice via Q-piedra-1)
- App-side error logging conventions per ADR-016 D8

**Web-side (separate feature branch + PR per `feedback_feature_branches_always`):**

- `lib/maxwell/prototipo-share.ts` (new — outbound helper)
- `lib/maxwell/prototipo-share-types.ts` (new — wire types + UX mapper)
- `app/[locale]/maxwell/studio/_actions/share-prototype.ts` (new — Server Action; verify path against current Maxwell studio route structure)
- `lib/maxwell/repositories.ts` — extend studio_session repository with the four new columns (read + write)
- `lib/maxwell/state-machine.ts` — add `prototype_shared` status to `StudioStatus` type, extend `VALID_TRANSITIONS`
- `components/maxwell/studio-proposal-cta.tsx` — extend per D10
- `supabase/migrations/20260527_019_studio_session_share_token.sql` (new — verify next sequential number)
- `tests/maxwell/prototipo-share.test.ts` (new)
- `tests/maxwell/state-machine.test.ts` (extend)
- `tests/visual/studio-share-cta.spec.ts` (new)

**Files NOT touched (explicit non-scope):**

- `app/[locale]/maxwell/prototipo/[token]/**` — D-slice route, complete; not modified by this iteration.
- `lib/maxwell/prototipo-decision.ts` and `prototipo-decision-types.ts` — D-slice POST decision, complete; not modified.
- `lib/maxwell/prototipo-render-fetch.ts` and `prototipo-render-types.ts` — D-slice GET render, complete; not modified.
- `app/api/integrations/website/prototype-signed-read/[token]/route.ts` — dev-only loopback, not modified.
- `app/api/maxwell/proposal/**` — legacy proposal flow, coexists per D12; not modified in this iteration.
- `app/api/integrations/website/inbound-proposal/**` — legacy cross-repo entry, coexists per D12; not modified.

---

## Open questions

**For Piedra (App owner):**

- **Q-piedra-1.** Does App's existing B-slice persistence (migration `0060_phase_23a_prototype_decisions.sql` per ADR-025 D3) already generate `share_token` on `prototype_workspaces` row creation? If yes, what is the trigger path today (which code path creates the workspace, and where is the token issued)? If no, this ADR's `prototype-share` endpoint must own the workspace creation AND the token issuance.
- **Q-piedra-2.** What is the resolution path for `(external_session_id, v0_chat_id)` → existing `prototype_workspaces` row (D4 application-level dedup)? Does App have a stable resolver, or does this ADR's handler need to define one?
- **Q-piedra-3.** When the payload's `lead.business_name` + `lead.customer.email` resolve to an existing `leads` row (e.g., a prior `inbound-proposal` ran for the same customer), should the new workspace attach to that existing lead, or should App always create a fresh lead? Coordination with `inbound-proposal`'s lead-resolution path is required.
- **Q-piedra-4.** Rate limit namespace `prototype-share`: confirm that adding it to the v1 rate limiter config is in scope of this iteration's App-side PR.
- **Q-piedra-5.** `requestId` inclusion on error responses: during the 2026-05-26 bilateral smoke against App `develop`, the `prototype-signed-read` 404 response omitted `requestId`. Per `docs/integrations/cross-repo-webhook-v1.md` §8 the field SHOULD be present on all error responses. Confirm the new `prototype-share` handler includes it consistently.

**For Pedro (Web owner):**

- **Q-pedro-1.** Confirm `prototype_shared` as a new state machine phase (D7 recommends a real state vs. a derived state via column nullability).
- **Q-pedro-2.** Confirm ADDITIVE coexistence with legacy proposal-send (D12 recommends; defers deprecation decision to a later iteration).
- **Q-pedro-3.** Confirm feature flag reuse `MAXWELL_PROTOTIPO_DECISION_ROUTE` (D11 recommends single flag).
- **Q-pedro-4.** Confirm Web-side migration number `019` (or next sequential against `supabase/migrations/`).
- **Q-pedro-5.** Confirm Server Action path (D9 proposes `app/[locale]/maxwell/studio/_actions/share-prototype.ts`; los devs may pick a different convention).
- **Q-pedro-6.** Confirm `NOON_WEBSITE_PUBLIC_BASE_URL` is the right env var name for URL composition (D9), vs. reusing an existing var.

Architecture proceeds on the clear part and explicitly marks these as blocked-pending-answer. Implementation cannot begin until Q-piedra-1 is resolved (the App-side surface depends on it).

---

## Architecture outcome

**Needs clarification.** This ADR is ready for Pedro + Piedra review. Implementation readiness requires answers to Q-piedra-1, Q-piedra-2, Q-piedra-3 (which determine whether the App-side handler creates the workspace + token or delegates to an existing internal path) and Q-pedro-1 through Q-pedro-3 (which determine the Web-side state machine and flag strategy).

Once Q-piedra-1/2/3 are resolved and Pedro confirms the Web-side architectural decisions, the outcome flips to **Ready** for Backend (App side) and Frontend (Web side) implementation in parallel feature branches per `feedback_feature_branches_always`.

---

## Success criterion

A seller in `/maxwell/studio` whose session has reached `prototype_ready`, with `MAXWELL_PROTOTIPO_DECISION_ROUTE=1` set in Vercel:

1. Sees a "Compartir prototipo con el cliente" CTA alongside the existing approval buttons.
2. Clicks the CTA; a server action fires, signs and POSTs to App's `/api/integrations/website/prototype-share` with the session's V0 chat + version + deployed URL + lead context.
3. Receives `201` with `share_token` + `prototype_workspace_id` + `lead_id` (or `200 idempotent: true` on retry).
4. The Server Action persists the four new columns to `studio_session`, transitions to `prototype_shared`, and revalidates.
5. The CTA component re-renders showing the shareable URL `https://<host>/<locale>/maxwell/prototipo/<token>` with a copy-link button.
6. From the same UI the seller can still pick "Pedir cambios" (→ revision_requested) or "Enviar propuesta detallada" (→ approved_for_proposal, legacy path).
7. The client opens the URL; the existing D-slice route renders the prototipo via signed-read (ADR-024); the client accepts or rejects; the existing D-slice POST decision flow records the outcome (ADR-023).
8. All four gates (lint, tsc, tests, build) pass on both repos.
9. Validator confirms the new CTA is keyboard-accessible, screen-reader-readable, and the error states map correctly per D5/D10.
