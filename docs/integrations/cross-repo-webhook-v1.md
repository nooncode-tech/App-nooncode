# Cross-repo webhook contract — NoonApp ↔ NoonWeb (v1)

> **Status:** v1 is the live, deployed protocol. **No `X-Webhook-Schema-Version` header is enforced yet** — that arrives with v2 (see §11).
> **Owners:** App side and Web side change this protocol together. Any change requires simultaneous PRs in both repos and is announced in the daily cross-repo sync.
> **Audience:** Go dev (will reimplement App side in Go), NoonWeb dev (owns Web side), App Next.js maintainers (current implementation).
> **Source of truth:** this document. Any divergence between the running code and this doc is a bug — open an issue, do not change the contract by editing one side silently.

---

## 1. Overview

Two repos communicate over signed HTTPS webhooks:

```
NoonWeb (sitio publico)                          NoonApp (workspace interno)
─────────────────────                            ─────────────────────────
inbound-proposal       ──────────────────────►  POST /api/integrations/website/inbound-proposal
payment-confirmed      ──────────────────────►  POST /api/integrations/website/payment-confirmed
prototype-decision     ──────────────────────►  POST /api/integrations/website/prototype-decision

prototype-signed-read  ──────────────────────►  GET  /api/integrations/website/
(NoonWeb fetches at                                  prototype-signed-read/[token]
 render time, Pull B.2)

POST /api/integrations/        ◄──────────────  proposal-review-decision
     noon-app/
     proposal-review-decision
```

Five message types today (four inbound on App + one outbound from App):
1. **Web → App: `inbound-proposal`** — a client completed Maxwell on the website and a proposal was created. App creates a lead + proposal + inbound link, queues PM review.
2. **Web → App: `payment-confirmed`** — the client paid for an approved proposal. App activates the project, records payment, kicks off delivery.
3. **Web → App: `prototype-decision`** — a client accepted or rejected a prototipo at the NoonWeb route `/maxwell/prototipo/[token]`. App records the decision and, on accept, fires a fire-and-forget Maxwell draft propuesta for the seller to complete. See §5.
4. **Web → App: `prototype-signed-read`** — NoonWeb server-side fetches prototipo data from App at render time of `/maxwell/prototipo/[token]` (Pull pattern B.2 per ADR-023 D8 / ADR-024). This is the only **GET** entry; the others are POST. See §6.
5. **App → Web: `proposal-review-decision`** — the PM approved/rejected/requested changes on an inbound proposal. Web updates client UI.

All five share the same auth + signing protocol. They differ only in URL/method, payload, and response.

---

## 2. Authentication and signing

### 2.1 Algorithm

HMAC-SHA256 over `${timestamp}.${bodyText}`, hex-encoded, prefixed with `sha256=`.

```
signed_payload = `${unix_timestamp_seconds}.${raw_request_body}`
signature      = hex(hmac_sha256(NOON_WEBSITE_WEBHOOK_SECRET, signed_payload))
header value   = `sha256=${signature}`
```

**Empty-body signing input (GET endpoints).** For GET entries (§6 `prototype-signed-read` is the only GET today), the request body is empty by HTTP convention. The signing input is the **natural extension** of the general form with `bodyText = ""`:

```
signed_payload (GET) = `${unix_timestamp_seconds}.`     // timestamp + literal dot + empty body
```

That is, the trailing dot is preserved and the body segment is the empty string. No serialization shim, no canonicalization of the URL path, no inclusion of headers in the signing input. `verifyWebsiteWebhookSignature` in `lib/server/website-webhook-auth.ts` consumes the body text as-read from the request — for a GET the read returns `""` and the verifier computes `hmac_sha256(secret, ${timestamp}.)` byte-identically with the sender. Per ADR-024 D1 this convention is locked; do NOT introduce alternative shims (e.g., signing over the URL path) that would diverge from this rule.

The shared secret is the same string on both sides. It is stored in environment variables:
- App side: `NOON_WEBSITE_WEBHOOK_SECRET`
- Web side: `NOON_WEBSITE_WEBHOOK_SECRET` (same name, same value)

### 2.2 Required headers on every request

| Header | Value | Notes |
|---|---|---|
| `content-type` | `application/json` | Body is always JSON; no other content types accepted |
| `x-noon-timestamp` | Unix seconds (integer string) | UTC seconds since epoch. Sender's clock at signing time |
| `x-noon-signature` | `sha256=<hex>` | Lowercase `sha256=` prefix. Hex is lowercase |

### 2.3 Receiver validation rules

The receiver MUST:
1. Read the raw request body as text **before** parsing JSON. Parsing JSON first and re-serializing changes byte order/whitespace and breaks signature.
2. Verify `x-noon-signature` header is present. Reject `401` if missing.
3. Verify `x-noon-timestamp` is within ±5 minutes of receiver's current time (`MAX_CLOCK_SKEW_SECONDS = 300`). Reject `401` if outside window.
4. Recompute the expected signature with the same secret and `${timestamp}.${bodyText}` format.
5. Compare using a **timing-safe** comparison. Reject `401` on mismatch.
6. After signature verification passes, parse JSON. Reject `400` if invalid JSON or schema violation.

The receiver MUST NOT:
- Accept requests without the timestamp header (even if signature alone matches).
- Use string equality for signature comparison (timing attack vector).
- Trust the signed payload until both timestamp window and signature pass.

### 2.4 Secret rotation

Coordinated rotation between repos:

1. Generate new secret (≥32 bytes random).
2. Deploy new secret to both repos' env vars **on the same day**.
3. Briefly accept either old or new during the rotation window if needed (not currently implemented — both sides switch atomically).
4. Old secret retired.

Rotation cadence: at minimum yearly, or immediately if compromise suspected.

---

## 3. Inbound webhook — `inbound-proposal` (Web → App)

### 3.1 Endpoint

`POST /api/integrations/website/inbound-proposal`

### 3.2 Request payload

```json
{
  "external_source": "noon_website",
  "external_session_id": "string (required, non-empty)",
  "external_proposal_id": "string (required, non-empty)",
  "customer": {
    "name": "string (required, non-empty, trimmed)",
    "email": "string (required, valid email, lowercased on receive)",
    "phone": "string | null (optional)",
    "whatsapp": "string | null (optional)",
    "company": "string | null (optional)"
  },
  "proposal": {
    "title": "string (required, non-empty)",
    "body": "string (required, non-empty)",
    "amount": "number (required, >= 0, coerced from string ok)",
    "currency": "string (3-8 chars, default 'USD')"
  },
  "maxwell": {
    "summary": "string | null (optional)",
    "session_url": "string | null (optional)",
    "prototype_url": "string | null (optional)",
    "prototype_versions": [
      {
        "label": "string | null",
        "url": "string | null",
        "version_number": "integer > 0 | null",
        "v0_chat_id": "string | null"
      }
    ]
  },
  "metadata": {
    "score": "number 0-100 (optional, default 80)",
    "<arbitrary>": "<arbitrary> (any other keys preserved as record)"
  }
}
```

### 3.3 Idempotency

The receiver looks up an existing `website_inbound_links` row by, in this order:
1. `(external_source, external_payment_id)` if `external_payment_id` was supplied (not in this webhook, but the same lookup table is used for `payment-confirmed`)
2. `(external_source, external_proposal_id)`
3. `(external_source, external_session_id)`

If any lookup finds an existing row, the receiver UPDATES the existing lead/proposal/link with the new snapshot and returns `200 OK` with `idempotent: true`. Otherwise it CREATES a new lead + proposal + link and returns `201 Created` with `idempotent: false`.

**Behavior change:** if the existing link is in `proposal_pending_review` or `proposal_changes_requested` state, the lead and proposal records are updated with the new snapshot. If the link is in any other state (approved, paid, activated, rejected), only the inbound_payload snapshot is updated but lead/proposal records are NOT modified.

### 3.4 Success response

```json
{
  "data": {
    "idempotent": "boolean",
    "linkId": "uuid",
    "leadId": "uuid",
    "proposalId": "uuid",
    "status": "proposal_pending_review"
  },
  "requestId": "string"
}
```

HTTP status: `201` if newly created, `200` if idempotent.

### 3.5 Error responses

See §8 for common error shape.

| HTTP | Code | When |
|---|---|---|
| `401` | `WEBSITE_WEBHOOK_AUTH_FAILED` | Missing/invalid signature, stale timestamp, missing secret |
| `400` | (validation) | Body is not JSON, schema validation fails |
| `429` | (rate limit) | More than 120 requests/minute from sender |
| `503` | `INTEGRATION_ACTOR_NOT_FOUND` | No active admin or PM profile exists to attribute the inbound lead |
| `500` | `INBOUND_*_FAILED` | DB error during create/update |

---

## 4. Inbound webhook — `payment-confirmed` (Web → App)

### 4.1 Endpoint

`POST /api/integrations/website/payment-confirmed`

### 4.2 Request payload

```json
{
  "external_source": "noon_website",
  "external_session_id": "string (required)",
  "external_proposal_id": "string (required)",
  "external_payment_id": "string (required)",
  "customer": "<same shape as inbound-proposal.customer, optional>",
  "proposal": "<same shape as inbound-proposal.proposal, optional>",
  "maxwell": "<same shape as inbound-proposal.maxwell>",
  "handoff": {
    "summary": "string | null (optional)",
    "<arbitrary>": "<arbitrary>"
  },
  "payment": {
    "amount": "number >= 0 (optional, falls back to proposal.amount)",
    "currency": "string (optional, falls back to proposal.currency)",
    "provider": "string | null (optional)",
    "paid_at": "ISO 8601 string | null (optional, defaults to receive time)"
  },
  "metadata": "<record, optional>"
}
```

`customer` and `proposal` are **required** if this is a first-time payment for a session not previously seen via `inbound-proposal`. The receiver detects this case and falls back to creating the lead+proposal first, then activating the project.

### 4.3 Idempotency

Same lookup chain as §3.3 plus `external_payment_id`. If a payment record already exists for the proposal (status `succeeded`), the existing payment id is reused (no duplicate `payments` row).

If `link.external_payment_id` is already set to a **different** value, the receiver returns `409 Conflict`.

### 4.4 Activation precondition

The receiver requires the proposal's `review_status` to be `approved` before activating the project. If the proposal is still `pending_review`, `changes_requested`, `rejected`, or `cancelled`, the receiver returns `409 Conflict` with code `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL`.

This guarantees: a client cannot bypass PM review by paying directly. The website must enforce this on its side too (do not show the pay button until App webhook confirms the proposal is approved — see §7).

### 4.5 Success response

```json
{
  "data": {
    "idempotent": "boolean",
    "linkId": "uuid",
    "leadId": "uuid",
    "proposalId": "uuid",
    "projectId": "uuid",
    "status": "project_activated"
  },
  "requestId": "string"
}
```

HTTP status: `201` if newly activated, `200` if idempotent (payment already recorded).

### 4.6 Error responses

| HTTP | Code | When |
|---|---|---|
| `401` | `WEBSITE_WEBHOOK_AUTH_FAILED` | Signature/timestamp invalid |
| `400` | (validation) | Schema violation |
| `409` | `INBOUND_PAYMENT_MISSING_SNAPSHOT` | First-time payment without `customer`+`proposal` snapshots |
| `409` | `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL` | Proposal not yet approved by PM |
| `409` | (conflict) | Different `external_payment_id` already bound to this proposal |
| `429` | (rate limit) | More than 120 requests/minute |
| `500` | `INBOUND_*_FAILED` | DB error |

---

## 5. Inbound webhook — `prototype-decision` (Web → App)

> **Status:** **Implemented 2026-05-25** (iteration `fase-3-adr-023-b-c-slice-prototype-decision-impl`). B-slice + C-slice landed bundled per ADR-025 D3 via migration `supabase/migrations/0060_phase_23a_prototype_decisions.sql` (persistence + RPC) plus route `app/api/integrations/website/prototype-decision/route.ts` and handler `receiveWebsitePrototypeDecision` in `lib/server/website-integration.ts`. NoonWeb route `/maxwell/prototipo/[token]` remains D-slice (NoonWeb-side).
> **Anchor:** see `docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md` for the rationale behind every shape decision below.

### 5.1 Endpoint

`POST /api/integrations/website/prototype-decision`

### 5.2 Request payload

```json
{
  "external_source": "noon_website",
  "token": "string (required, opaque, App-issued share token, authoritative for resolution)",
  "prototype_workspace_id": "uuid (required, defensive cross-check against the token-resolved row)",
  "decision": "accepted | rejected (required)",
  "notes": "string | null (optional, client-provided rationale, especially on reject)",
  "client": {
    "user_agent": "string | null (optional, forwarded by NoonWeb for forensic context)"
  },
  "metadata": "<record, optional, NoonWeb may forward additional context; App preserves but does not interpret>"
}
```

**Field semantics:**

- `token` is the **authoritative** identifier. The handler resolves `token` → `prototype_workspaces.share_token` server-side. The opaque shape and rotation rules are App-internal (see §5.6 lifecycle).
- `prototype_workspace_id` is **defensive**. NoonWeb already holds this UUID from the Pull B.2 render-time fetch; sending it back lets the handler cross-validate that the token-resolved row matches the workspace NoonWeb rendered. Mismatch → `409 PROTOTYPE_DECISION_IDENTIFIER_MISMATCH`.
- `decision` MUST be exactly `'accepted'` or `'rejected'`. Any other value → `400 PROTOTYPE_DECISION_INVALID_DECISION`.
- `notes` is optional but strongly encouraged on `rejected`. Stored verbatim on `prototype_decisions.notes`. No length cap beyond the cross-repo §8 common validation envelope; sender SHOULD truncate to ≤2000 chars to stay within reasonable JSON payload sizes.

### 5.3 Idempotency

**Transport-level (per ADR-016 / §10.2):** identical to the other two inbound entries. Identity key `(endpoint, signature_hash)` where `endpoint = 'prototype-decision'` and `signature_hash = sha256(${timestamp}.${bodyText})`. Bit-identical replay (same `bodyText`, same `x-noon-timestamp`, same `x-noon-signature`) returns the original wire-shape response with HTTP `200` and `idempotent: true`. The handler MUST sit behind the existing `website_webhook_events` ledger; the `endpoint` CHECK constraint is extended to include `'prototype-decision'` in the B-slice migration.

**No payload-level idempotency.** Specifically, a `decision_id` UUID, `Idempotency-Key` header, or any other payload-level dedup mechanism is forbidden per ADR-023 D1. Transport ledger is the single layer.

**Application-level uniqueness:** `prototype_decisions` carries a UNIQUE index on `(prototype_workspace_id)` enforcing one terminal decision per workspace. A conflicting second decision (different `decision` value, OR same decision but different signature_hash i.e. not a bit-identical replay) returns `409 PROTOTYPE_DECISION_ALREADY_DECIDED`. See §5.5.

### 5.4 Success response

```json
{
  "data": {
    "idempotent": "boolean",
    "decisionId": "uuid",
    "prototypeWorkspaceId": "uuid",
    "leadId": "uuid",
    "decision": "accepted | rejected",
    "decidedAt": "ISO 8601 string",
    "draftPropuestaQueued": "boolean (true when decision === 'accepted' and the post-accept Maxwell draft was fire-and-forget'd; false otherwise)"
  },
  "requestId": "string"
}
```

HTTP status: `201` if newly recorded, `200` if idempotent replay (bit-identical retry of the same signed request).

`draftPropuestaQueued` is `true` when `decision === 'accepted'` AND the handler successfully enqueued the Option β Maxwell draft creation as a fire-and-forget background task. `false` when `decision === 'rejected'` or when the response is an idempotent replay (the draft was queued on the original run; the replay does not re-enqueue). NoonWeb SHOULD render an "Accepted — your seller has been notified" UX regardless of this field's value; it is exposed for observability only.

### 5.5 Error responses

Common shape per §8.

| HTTP | Code | When |
|---|---|---|
| `401` | `WEBSITE_WEBHOOK_AUTH_FAILED` | Missing/invalid signature, stale timestamp (±5min window violated), missing secret |
| `400` | (validation) | Body is not JSON, schema violation per §5.2 |
| `400` | `PROTOTYPE_DECISION_INVALID_DECISION` | `decision` field not in `{'accepted', 'rejected'}` after Zod parse. Belt-and-suspenders against schema drift |
| `404` | `PROTOTYPE_DECISION_TOKEN_NOT_FOUND` | `token` does not resolve to any `prototype_workspaces.share_token` row |
| `409` | `PROTOTYPE_DECISION_IDENTIFIER_MISMATCH` | `token` resolved to workspace A but payload's `prototype_workspace_id` is B (≠ A). Indicates NoonWeb-side stale render cache or token rotation; structured log fires for App ops |
| `409` | `PROTOTYPE_DECISION_ALREADY_DECIDED` | The resolved workspace already has a `prototype_decisions` row with a conflicting decision, OR the same decision but the request is not a bit-identical replay (per §5.3). Note: bit-identical replay returns `200 idempotent: true` per ADR-016 D6, NOT `409` |
| `410` | `PROTOTYPE_DECISION_TOKEN_EXPIRED` | The resolved workspace has `share_token_superseded_at` non-null (regenerated to V2+). The current valid token is on the new workspace row; the operator must reshare |
| `410` | `PROTOTYPE_DECISION_LEAD_DELETED` | The parent lead row has been hard-deleted. Rare (FK cascade should remove the workspace too), defensive code path |
| `429` | (rate limit) | More than 120 requests/minute from sender — namespace `prototype-decision`, independent counter per endpoint |
| `500` | `PROTOTYPE_DECISION_PERSIST_FAILED` | DB error during `prototype_decisions` INSERT or workspace cross-validation read |

Each `PROTOTYPE_DECISION_*` code maps to a deterministic NoonWeb-portal UX state. See ADR-023 D5 for the suggested copy per code.

### 5.6 Token lifecycle and invalidation semantics

Per ADR-023 D3, the share token is **state-driven**, not calendar-bounded:

- **V1 token is alive** while the V1 prototipo is the current artifact under the lead (workspace status not `archived`, no superseding V2).
- **Regenerate to V2 invalidates V1.** The B-slice persistence issues a fresh `share_token` on the new workspace row and sets `share_token_superseded_at = now()` on the prior row. A decision posted against the prior token returns `410 PROTOTYPE_DECISION_TOKEN_EXPIRED`.
- **Accept is terminal.** Once a `prototype_decisions` row exists with `decision = 'accepted'`, a second decision (any value) against the same token returns `409 PROTOTYPE_DECISION_ALREADY_DECIDED` (modulo bit-identical replay per §5.3).
- **Reject does NOT auto-invalidate.** A rejected V1 stays viewable at the same URL until the seller regenerates V2.
- **Hard-delete of the parent lead invalidates implicitly** via FK cascade on `prototype_workspaces.lead_id`. Returns `410 PROTOTYPE_DECISION_LEAD_DELETED` defensively if the cascade did not remove the workspace row.
- **No calendar TTL.** A legitimate client opening the URL after weeks/months still sees the current prototipo (or an "updated" page if superseded). Calendar TTL would create dead-letter UX for legitimate late clients and is explicitly rejected per ADR-023.

If operator later needs explicit offer-expiration semantics (legal / commercial), that becomes a separate concept on the workspace (e.g., `prototype_offer_expires_at`) rendered by NoonWeb before the client clicks accept/reject. It does NOT change token validity.

### 5.7 Ledger row shape

The `website_webhook_events` row written for a `prototype-decision` request has the same shape as `inbound-proposal` and `payment-confirmed` rows per ADR-016 D7, with these specifics:

- `endpoint`: `'prototype-decision'` (the B-slice migration extends the CHECK constraint and the helper's TypeScript `WebsiteWebhookEndpoint` union).
- `external_session_id`: NULL (no `external_session_id` in this payload's contract).
- `external_proposal_id`: NULL (no `external_proposal_id` in this payload's contract).
- `external_payment_id`: NULL (orthogonal to payments).
- `link_id`: NULL (not a `website_inbound_links` row; the business identity is `prototype_decisions.id` which is logged separately in the structured handler log line, not in the ledger column — same forensic-durability rationale as ADR-016 D7).

Post-processing on success: the handler calls `markWebsiteWebhookEventProcessed` with NULL business identity columns. The structured log line (`logger.info('website.prototype_decision.received', {...})`) carries the `prototype_workspace_id`, `decision`, and `decisionId` for trace joining.

### 5.8 Side effect on accept — Option β Maxwell draft (fire-and-forget)

Per ADR-023 D6, when `decision === 'accepted'` the handler:

1. Synchronously records the `prototype_decisions` row, marks the ledger row processed, and returns `201` to NoonWeb.
2. Fires-and-forgets a background task that calls the Maxwell drafting helper to create a draft `lead_proposals` row with `title`, `body`, `project_type`, `complexity` populated. Per ADR-013 + ADR-023 D9, the `seller_fees` row is NOT created at this point — the seller picks the fee explicitly in a follow-up UI iteration.
3. Notifies the seller via the existing `user_notifications` pipeline that the prototipo was accepted (existing notifications schema, fan-out logic added in C-slice).

If the Maxwell draft creation fails:

- The decision row stays in place (correct — the client did accept).
- A structured log line `prototype.decision.accepted.draft_creation_failed` fires.
- The seller's notification copy escalates to "accepted but draft pending — create manually from lead detail".
- No automatic retry. Operator escalation is the explicit fallback.

NoonWeb sees no difference between a successful background draft and a failed one — the webhook response is `201` either way (the response field `draftPropuestaQueued` indicates whether the task was enqueued, not whether it succeeded). This is intentional per ADR-023 D6: the webhook response represents the load-bearing fact (decision recorded), not the side-effect outcome (draft created).

### 5.9 Retry semantics (NoonWeb-side guidance)

NoonWeb's signed POST to this endpoint follows the same retry rules as the other inbound entries:

- `2xx` → success; do not retry.
- `4xx` → terminal failure; do NOT retry. Surface error to the client per the §5.5 code mapping.
- `5xx` or network error → MAY retry with exponential backoff. Bit-identical retries are detected by the App-side ledger and return `200 idempotent: true` per §5.3 / §10.2 (transport-level idempotency) / ADR-016 D6. Recommended cap: 3 attempts with backoff 1s / 5s / 30s.

A successful response after retry MUST be treated identically to a successful response on first attempt. The `idempotent` flag in the response data is informational; the wire-shape is the same.

---

## 6. Inbound read endpoint — `prototype-signed-read` (Web → App, GET)

> **Status:** wire contract firmed by ADR-024 (2026-05-25; amended A1 2026-05-26 — lead-context source column mapping correction). **Endpoint shipped 2026-05-26 via PR `feat/g22-prototype-signed-read-handler` (App-side handler).** Persistence (`prototype_workspaces.share_token` + `share_token_superseded_at`) shipped in B-slice per ADR-023 (PR #110, 2026-05-26). NoonWeb route `/maxwell/prototipo/[token]` render against this endpoint lands in D-slice (NoonWeb-side, pending).
> **Anchor:** see `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md` for the rationale behind every shape decision below. This is the symmetric **read** entry to §5 `prototype-decision`'s **write** entry; together they materialize Pull pattern B.2 from ADR-023 L-2 / D8.

### 6.1 Endpoint

`GET /api/integrations/website/prototype-signed-read/[token]`

The token is the URL path parameter. App-issued opaque identifier matching `prototype_workspaces.share_token`. Same token NoonWeb received from the workspace creation / regenerate event; same token that authorizes the §5 `prototype-decision` POST.

### 6.2 Direction and trigger

- **Direction:** NoonWeb → App. App responds; App is the system of record for prototipo content + lead context + decision state. NoonWeb is the render layer.
- **Trigger:** NoonWeb's server (not the client browser) hits this endpoint at render time of `/maxwell/prototipo/[token]` to fetch the data needed to render the page. NoonWeb may revalidate within the cache window (§6.8) without re-hitting App.
- **NOT triggered by:** the client browser directly. App has no client-authenticated path (ADR-010). All traffic to this endpoint is server-to-server signed by the cross-repo HMAC.

### 6.3 Request — headers and HMAC envelope

Required headers (per §2):

| Header | Value | Notes |
|---|---|---|
| `x-noon-timestamp` | Unix seconds (integer string) | Sender's clock at signing time |
| `x-noon-signature` | `sha256=<hex>` | HMAC-SHA256 of `${timestamp}.` (empty body — see §2.1) |

No `content-type` header is required on a GET (no body). The handler does NOT read or parse a request body.

**Signing input (per §2.1 empty-body convention):**

```
signed_payload = `${unix_timestamp_seconds}.`     // trailing dot + empty string
signature      = hex(hmac_sha256(NOON_WEBSITE_WEBHOOK_SECRET, signed_payload))
header value   = `sha256=${signature}`
```

Secret: `NOON_WEBSITE_WEBHOOK_SECRET` — the same value used for the three inbound POST entries (§3 / §4 / §5). **No new env var** per ADR-024 D1. Clock-skew window ±5min as in §2.3. URL path is **not** included in the signing input (ADR-024 D1 sub-detail).

### 6.4 Success response (200 OK)

Payload shape per ADR-024 D3 (Choice C: prototipo content + minimal lead context + decision state):

```json
{
  "data": {
    "workspace": {
      "id": "uuid",
      "version": 1,
      "generatedAt": "ISO 8601 string"
    },
    "leadContext": {
      "businessName": "string",
      "projectTypeLabel": "string"
    },
    "prototype": {
      "deployedUrl": "string | null",
      "generatedHtml": "string | null"
    },
    "decision": {
      "status": "pending | accepted | rejected",
      "notes": "string | null",
      "decidedAt": "ISO 8601 string | null"
    },
    "lifecycle": {
      "tokenSuperseded": false,
      "iterationNumber": 1
    },
    "serverTime": "ISO 8601 string"
  },
  "requestId": "string"
}
```

**Field semantics (ADR-024 D3):**

- `data.workspace.id` — `prototype_workspaces.id`. NoonWeb forwards this as the `prototype_workspace_id` defensive cross-check in the subsequent §5 `prototype-decision` POST.
- `data.workspace.version` — integer ≥ 1, derived from iteration history under the same lead (+1 per regenerate). Matches the ADR-023 D7 `max_iterations_per_lead` semantics.
- `data.workspace.generatedAt` — `prototype_workspaces.created_at` as ISO 8601 (UTC).
- `data.leadContext.businessName` — handler derives `leads.company ?? leads.name` (always populated). See ADR-024 §Amendments A1 (2026-05-26) for the source-column mapping correction.
- `data.leadContext.projectTypeLabel` — **derived label** from `leads.maxwell_snapshot ->> 'project_type'` (e.g., `"Landing Page"`, `"Web App"`, `"E-commerce"`) with default `"Sitio Web"` when the snapshot is missing or malformed. The raw source value is NOT exposed. Decouples NoonWeb from App's internal Maxwell snapshot evolution. See ADR-024 §Amendments A1.
- `data.prototype.deployedUrl` — Vercel-hosted prototipo URL (iframe target). Nullable during the "build in progress" state.
- `data.prototype.generatedHtml` — fallback static HTML when no iframe URL is available. Nullable. Both may be null simultaneously during the build window; NoonWeb renders "preparando tu prototipo".
- `data.decision.status` — `'pending'` (no `prototype_decisions` row), `'accepted'`, or `'rejected'`.
- `data.decision.notes` — non-null only when `status === 'rejected'` AND the client provided rejection notes. For `'accepted'` or `'pending'`, the field is `null` even if a notes column happens to carry a value (sanitizer enforces; §6.11).
- `data.decision.decidedAt` — ISO 8601 of `prototype_decisions.decided_at`. Null when `status === 'pending'`.
- `data.lifecycle.tokenSuperseded` — always `false` on a 200 response by definition (a superseded token returns 410 per §6.6). Exposed for forward-compatibility per ADR-024 D3.
- `data.lifecycle.iterationNumber` — currently equals `workspace.version`; the `lifecycle.*` cluster is the home of forward iteration-related context (Gate B exposure, "you've done X/Y iterations").
- `data.serverTime` — `now()` at handler time. Always present on 200. Useful for client-side clock anchoring.
- `requestId` — per §8 common envelope. Trace correlation with App logs.

**The response does NOT include an open `metadata` envelope** (unlike the POST `inbound-proposal` and `payment-confirmed` payloads, per ADR-024 D3). Closed shape is auditable; future extensions go through §16 change control.

### 6.5 Response codes table

Common error shape per §8. The `PROTOTYPE_READ_*` namespace is registered in the handler module's TypeScript union (handler iteration scope).

| HTTP | Code | Trigger | NoonWeb portal UX |
|---|---|---|---|
| `200` | (no error code) | Token resolves to a workspace; not superseded; workspace renderable; decision may be pending / accepted / rejected — `data.decision.status` conveys which | Render per `data.decision.status` (CTA pending / accepted-banner / rejected-banner). |
| `400` | (validation) | Token path-param is empty or contains forbidden characters (e.g., non-URL-safe bytes). Belt-and-suspenders against bad routing | Generic validation error. |
| `401` | `WEBSITE_WEBHOOK_AUTH_FAILED` | HMAC missing/invalid, stale timestamp (±5min violated), missing secret. **Reused verbatim from §8.** Sender-misconfigured; not client-facing. | NoonWeb logs and surfaces a generic "service temporarily unavailable" page. |
| `404` | `PROTOTYPE_READ_TOKEN_NOT_FOUND` | Token does not match any `prototype_workspaces.share_token` row | "Este link no es válido." |
| `410` | `PROTOTYPE_READ_TOKEN_SUPERSEDED` | Token resolves to a workspace with `share_token_superseded_at IS NOT NULL` (regenerated to V2+) | "Este prototipo fue actualizado, pedile al vendedor el nuevo link." |
| `410` | `PROTOTYPE_READ_LEAD_DELETED` | Parent lead has been hard-deleted (rare; FK cascade should remove the workspace too — defensive code path) | "Este prototipo ya no está disponible." |
| `429` | (rate limit) | Combined-key rate limit exceeded — see §6.7 | NoonWeb should NOT retry within the 1-min window; surface a generic transient error. |
| `500` | `PROTOTYPE_READ_INTERNAL_FAILED` | DB error during workspace lookup, decision lookup, or sanitization. Naming: `INTERNAL_FAILED` (no persistence happens on read; "PERSIST" would mislead) | NoonWeb surfaces a generic transient error and may retry per §6.7 rate-limit budget. |

**Naming-symmetry note (ADR-024 D2).** The write entry (§5) uses `PROTOTYPE_DECISION_TOKEN_EXPIRED` (legacy from ADR-023 D5); the read entry uses `PROTOTYPE_READ_TOKEN_SUPERSEDED`. Both codes represent the same workspace state. The "superseded" naming matches the state-driven model (ADR-023 D3, no calendar TTL). Future docs amendment may align the write entry; not blocking. NoonWeb-dev maps both codes to the same UX copy.

**Edge case — post-accept / post-reject (not superseded):** the endpoint returns `200` with `decision.status='accepted'` or `'rejected'` and the decision `notes` / `decidedAt` populated. NoonWeb renders the prototipo read-only with a "Ya aceptaste este prototipo" or "Lo rechazaste — esperá la próxima versión" banner. The `410` is reserved for token-superseded and lead-deleted; the decision state is conveyed inside the 200 payload. See ADR-024 D2.

### 6.6 Lifecycle — token state mapping

The endpoint maps the workspace lifecycle (ADR-023 D3, state-driven, no calendar TTL) to read-appropriate HTTP responses:

| Workspace state | Response |
|---|---|
| V1 alive (current artifact under lead, not superseded) | `200` with `decision.status` = current decision (pending / accepted / rejected) |
| V1 superseded by V2+ (`share_token_superseded_at` non-null) | `410 PROTOTYPE_READ_TOKEN_SUPERSEDED` — terminal for V1 token; client must request the new link |
| Lead hard-deleted (cascade race or defensive path) | `410 PROTOTYPE_READ_LEAD_DELETED` — terminal |
| Decision recorded (accept or reject) and token still alive | `200` with `decision.status` reflecting the recorded value; prototipo remains renderable until supersede |

Order of checks (handler iteration): lead-deleted first, then token-superseded, then decision lookup. Deterministic so two concurrent requests racing a cascade do not see different codes. **Bit-identical 200 responses race-free** because the read is non-mutating; cache (§6.8) bounds the worst-case stale window to 90s.

### 6.7 Rate limit — override of §9 defaults

Per ADR-024 D6, the endpoint overrides the §9 defaults with a tighter posture:

- **Namespace:** `prototype-signed-read` (new, independent counter).
- **Limit:** 60 requests per minute (tighter than §9 default 120).
- **Window:** 60_000 ms.
- **Identity key:** `${token}:${remoteIp}` combined (not IP-only). `remoteIp` from `getClientIp(request)` (first hop of `x-forwarded-for`). If `remoteIp` is `'unknown'`, key degrades to `${token}:unknown` (defensive — IP detection failure does not silently disable rate limiting).
- **Rationale:** legitimate render is 1-2 req/session/token; 60/min/(token,IP) is generous for legitimate traffic. The combined key bounds abuse against a single token from a single IP — the realistic abuse vector at pilot scale.

When exceeded: `429 Too Many Requests` (common shape per §8). NoonWeb edge cache (§6.8) typically keeps actual hit rate well under the budget.

### 6.8 Cache strategy — `Cache-Control` headers

Per ADR-024 D7, the 200 success response includes:

```
Cache-Control: private, max-age=30, stale-while-revalidate=60
```

- `private` — token-bound + lead-context content stays in per-tenant edge buckets; never in a shared CDN tier.
- `max-age=30` — 30 seconds of fresh cache; covers normal scroll / click cycles.
- `stale-while-revalidate=60` — if the cache entry is stale (30-90s old), serve the stale version and revalidate in background. Upper-bound supersede-visibility window: 90s.

Non-200 responses (4xx / 5xx) include:

```
Cache-Control: no-store
```

to prevent caching of error states (especially the `410 PROTOTYPE_READ_TOKEN_SUPERSEDED` which would otherwise pin a stale supersede flag in NoonWeb's edge).

App does **NOT cache the response internally**. The handler is server-rendered at request time from `prototype_workspaces` + `prototype_decisions` reads. The cache headers are advisory for NoonWeb's edge / browser.

**Eventual-consistency window (ADR-024 D7):** during the 30-90s stale window, a client may see "you can still accept" UI for a prototipo that has been superseded server-side. If the client clicks accept during the stale window, the §5 `prototype-decision` POST returns `410 PROTOTYPE_DECISION_TOKEN_EXPIRED`; NoonWeb's UX handles that 410 gracefully ("Este prototipo fue actualizado, pedile el nuevo link al vendedor"). This is the natural cost of the cache layer; the write-side 410 is the authoritative guard.

### 6.9 Transport ledger participation — declined by design

The `website_webhook_events` ledger pattern from ADR-016 (POST entries §3 / §4 / §5) is **NOT** applied to this endpoint. Per ADR-024 D1, the decline is explicit, not an oversight:

1. **GET is HTTP-idempotent by construction.** Replaying the same GET twice produces the same effect (zero side effects) regardless of whether the receiver dedups. The ledger's job — transport-level dedup of replays — has nothing to defend on a read.
2. **No state mutation → no replay-protection requirement.** ADR-016's ledger guards a forged-but-novel replay slipping past application-layer idempotency and double-writing. A read writes nothing.
3. **Performance.** Logging every render hit to a ledger table would scale at the rate of (concurrent clients × refresh rate) per workspace — an unbounded read multiplier. The ledger's `INSERT … ON CONFLICT DO NOTHING` is fine for writes (low rate); poor for high-frequency reads.
4. **Observability via structured logs.** Each request produces a `logger.info('website.prototype_signed_read.served', { token_hash, workspace_id, decision_status, server_time })` line (handler iteration writes this). Vercel runtime logs are the audit trail.

Future Architecture seeing this endpoint without a ledger row in `website_webhook_events` MUST reference ADR-024 §D1 and NOT panic. If a future iteration adds analytics on render-fetch (e.g., "how many times did the client open this prototipo before deciding"), that analytics layer lives in NoonWeb (which already sees the render hit) or in a dedicated read-analytics table — not in the transport ledger.

### 6.10 Idempotency

GET is intrinsically idempotent at the HTTP layer; no application-level idempotency mechanism is needed and none is declared on this surface. Bit-identical replay returns a bit-identical 200 response (the underlying DB reads are non-mutating and deterministic for the cache window). Concurrent reads do not collide.

This is the structural complement of §10 (transport-level idempotency for writes): writes need the ledger, reads do not.

### 6.11 Sanitization — positive allowlist construction

Per ADR-024 D4 (ad-hoc inline allowlist; formal `lib/security/project-isolation.ts` deferred), the handler iteration enforces a **positive allowlist** at egress:

1. The handler constructs the response object **field-by-field from named source values**. No `{ ...workspaceRow }` spreads. No `Object.assign(response, leadRow)`. Pattern: `const response = { workspace: { id: workspaceRow.id, version: workspaceRow.version, generatedAt: workspaceRow.created_at.toISOString() }, leadContext: { ... }, ... }`.
2. New fields added to upstream tables (`leads`, `prototype_workspaces`, `prototype_decisions`, etc.) default to "not in response" unless explicitly added to the allowlist.
3. The handler module ships unit tests asserting that for a fixture row decorated with operator-internal fields, **none of those fields appear in the JSON response**.

**Explicit strip-list (operator-internal fields that MUST NEVER appear in the response body):**

- `lead_proposals.*` (no propuesta data on the prototipo surface)
- `seller_fees.*` (per ADR-013 — seller fee is the seller's commercial decision; client never sees it on the prototipo surface)
- `user_wallets.*`, `wallet_ledger_entries.*` (credit balance is operator-internal)
- `user_profiles.*` (seller / PM identity is operator-internal)
- `leads.notes`, `leads.score`, `leads.next_follow_up_at`, `leads.lead_origin` (CRM-internal)
- `leads.assigned_to`, `leads.created_by` (operator identity)
- `prototype_workspaces.created_by`, `prototype_workspaces.updated_at` (audit metadata)
- `prototype_credit_settings.*` (admin config)
- `prototype_decisions.client_user_agent` (forensic — client-side already knows their own UA)
- `prototype_decisions.webhook_event_id` (transport-ledger forensic linkage)
- The raw `leads.maxwell_snapshot ->> 'project_type'` value (only the derived `leadContext.projectTypeLabel` is exposed; see ADR-024 §Amendments A1)
- `prototype_workspaces.share_token` (MUST NEVER echo back the token in the response body — defense against log scraping)
- `share_token_superseded_at` raw timestamp (only the derived boolean `lifecycle.tokenSuperseded` is exposed)

The handler emits a structured warning (`logger.warn('prototype.signed_read.allowlist.unexpected_field', { fieldName })`) if a source row contains a field not on the allowlist AND not on the explicit strip-list — canary for future schema additions that bypass the allowlist by accident.

**E-1 escalation (handler iteration scope):** if sanitization logic requires more than ~2h of expansion (nested object traversal, recursive depth checks, DTO mapping), the handler iteration MUST pause and open a separate iteration to materialize `lib/security/project-isolation.ts` with the formal `sanitizeForClient()` pattern. See ADR-024 D4 for the trigger detail.

### 6.12 Token lifecycle and invalidation semantics

The same state-driven invalidation locked by ADR-023 D3 (and reaffirmed in §5.6 for the write entry) governs this read entry:

- **V1 token is alive** while the V1 prototipo is the current artifact under the lead (no superseding V2).
- **Regenerate to V2 invalidates V1.** B-slice persistence issues a fresh `share_token` on the new workspace row and sets `share_token_superseded_at = now()` on the prior row. A read against the prior token returns `410 PROTOTYPE_READ_TOKEN_SUPERSEDED`.
- **Accept is NOT terminal for the read.** Once a `prototype_decisions` row exists with `decision = 'accepted'`, subsequent reads return `200` with `decision.status='accepted'` so the client can still see what they accepted (audit-preservation per ADR-024 D2).
- **Reject is NOT terminal for the read.** Same as accept — `200` with `decision.status='rejected'` and the client's rejection notes echoed back.
- **Hard-delete of the parent lead invalidates implicitly** via FK cascade on `prototype_workspaces.lead_id`. Returns `410 PROTOTYPE_READ_LEAD_DELETED` defensively.
- **No calendar TTL.** A legitimate client opening the URL after weeks/months still sees the current prototipo (or `410` if superseded).

NoonWeb's UX state machine maps cleanly to the union of both endpoints' responses: read-side `200 decision.status` switches the page mode; read-side `410` terminates the page with a copy banner; write-side `410` on POST after a stale 200 read is the safety net for the cache window (§6.8).

---

## 7. Outbound webhook — `proposal-review-decision` (App → Web)

### 7.1 Endpoint

`POST {NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL}`

The URL is configured on the App side via the env var `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL`. Typical value: `https://noon.example.com/api/integrations/noon-app/proposal-review-decision`. If the URL is empty, App logs and skips (review still recorded internally; Web just does not get notified).

### 7.2 Request payload

```json
{
  "event": "proposal_review_decision",
  "decision": "approved | rejected | changes_requested | cancelled",
  "external_source": "noon_website",
  "external_session_id": "string",
  "external_proposal_id": "string",
  "noon_app": {
    "lead_id": "uuid",
    "proposal_id": "uuid",
    "reviewed_at": "ISO 8601 string",
    "reviewer": {
      "id": "string | null",
      "email": "string | null",
      "role": "string | null"
    } | null
  },
  "proposal": {
    "title": "string",
    "body": "string | null",
    "amount": "number",
    "currency": "string",
    "review_status": "approved | rejected | changes_requested | cancelled"
  },
  "customer": {
    "id": "uuid",
    "name": "string",
    "email": "string",
    "company": "string | null"
  } | null
}
```

The `decision` and `proposal.review_status` always match. They are sent both for redundancy and clarity.

### 7.3 Expected response from Web

Web SHOULD return `2xx` to acknowledge receipt. App treats:
- `2xx` → `review_webhook_status = 'sent'`
- non-2xx → `review_webhook_status = 'failed'` with the response text saved in `review_webhook_error`
- network error → `review_webhook_status = 'failed'` with the error message saved

As of G23 / ADR-027 the App retries failed outbound POSTs automatically (3 attempts inline with exponential backoff 2s/4s/8s ±25% jitter), persists every attempt to the `outbound_webhook_events` ledger, and runs a 5-minute cron sweeper (`/api/cron/outbound-webhook-retry`) that drives stuck `pending` rows. Terminal failures land in `dead_letter` and become operator-replayable via `POST /api/admin/outbound-webhooks/[eventId]/replay`. See §7.6 below for the receiver-side contract NoonWeb MUST implement to remain safe under retries.

### 7.4 Idempotency on Web side

Web SHOULD treat the combination `(external_source, external_proposal_id, decision)` as the idempotency key. Receiving the same decision twice MUST NOT create duplicate notifications/state transitions on the client portal.

### 7.5 Decision semantics

| Decision | Client portal behavior (Web) |
|---|---|
| `approved` | Show "Proceed to payment" CTA. Enable Stripe Checkout link |
| `rejected` | Show "Proposal declined" with optional message. No payment path |
| `changes_requested` | Show "PM requested changes" with the changes summary if provided. Allow resubmission |
| `cancelled` | Show "Proposal cancelled" terminal state. No further action |

### 7.6 Retry semantics + idempotency-key header (App-side ready since G23 / ADR-027)

Starting with the G23 iteration the App actively retries failed `proposal_review_decision` deliveries. Because the same logical decision may now reach NoonWeb more than once (e.g., when the App times out client-side while the receiver actually processed the request, or when an admin triggers a replay against a dead-letter ledger row), the receiver MUST de-duplicate.

**Wire-level header (NEW, additive — does NOT modify §2.2 required headers):**

| Header | Value | Emitted on |
|---|---|---|
| `X-Noon-Idempotency-Key` | `<external_proposal_id>:<decision>` (UTF-8 plain text) | EVERY POST: first attempt, inline retries, cron-driven retries, and admin replays |

Example: `X-Noon-Idempotency-Key: prop_abc123:approved`.

**Receiver-side contract (NoonWeb MUST implement):**

1. Read `X-Noon-Idempotency-Key` on every POST to the review-decision endpoint.
2. Persist it as a UNIQUE constraint key on the receiver's own ledger (e.g., a `proposal_review_decisions_received` table with `unique(idempotency_key)`).
3. On a duplicate key, return **200 with the same response body** as the first successful processing — DO NOT re-emit notifications, DO NOT re-transition portal state.
4. On a fresh key, process the decision normally and record the key alongside the response so step 3 can replay it.

**Why `<external_proposal_id>:<decision>` (and not a hash):**

- Human-readable in NoonWeb logs (operator triage).
- Stable: `external_proposal_id` is the cross-repo identity and `decision` is from a 4-value enum; a single proposal can only transition once into each terminal state, so the pair is uniquely meaningful.
- Cheaper than `sha256(...)` to debug; cryptographic strength is already provided by the existing HMAC envelope (§2.1).

**App-side retry envelope (informational for receiver-side timeout tuning):**

- Inline attempts: up to 3, with `2s → 4s → 8s` base delays (±25% uniform jitter), capped per-attempt at 10s.
- Cron sweeper: runs `*/5 * * * *`; picks up stuck `pending` rows and drives them through the remaining budget.
- Admin replay: spawns a NEW ledger row carrying the SAME `X-Noon-Idempotency-Key` value — receiver dedupe MUST keep portal state intact.

**Per-attempt re-signing:** every retry calls `signWebsitePayload` again, producing a fresh `x-noon-timestamp` and `x-noon-signature`. The receiver's `±5min` HMAC window check (§2.3) keeps working unchanged.

**Terminal classifications (App-side, informational):**

| Receiver response | App treatment |
|---|---|
| 2xx | `delivered` (terminal happy path) |
| 429 | Retryable; counts as a normal attempt; `Retry-After` header is NOT parsed in G23 |
| 4xx (non-429) | Immediate `dead_letter`; NO retry (receiver-side contract violation; retrying does not heal it) |
| 5xx | Retryable; counts as a normal attempt |
| Network throw / timeout | Retryable; counts as a normal attempt |

---

## 8. Common error response shape

All endpoints (4 inbound on App — three POST + one GET — and 1 outbound from App) return errors in a consistent shape when they fail:

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE",
  "requestId": "string"
}
```

HTTP status reflects the category. The `code` field is stable for programmatic handling. `requestId` correlates with App-side logs.

---

## 9. Rate limiting

The four inbound endpoints (on App) enforce:

- **Default limit:** 120 requests per minute per namespace
- **Namespace `inbound-proposal`:** independent counter per endpoint (default 120 req/min, IP-based identity)
- **Namespace `payment-confirmed`:** independent counter per endpoint (default 120 req/min, IP-based identity)
- **Namespace `prototype-decision`:** independent counter per endpoint (default 120 req/min, IP-based identity)
- **Namespace `prototype-signed-read`:** independent counter per endpoint with **tighter override** — 60 req/min, combined `(token, remoteIp)` identity (per ADR-024 D6 / §6.7). Per-namespace tuning is permitted because counters are independent.

When exceeded: `429 Too Many Requests`.

**Known limitation:** the current rate limiter is in-process and does not survive multi-instance deployment (TDR-002). Web side should self-throttle to under 60 RPM during normal operation. Go rewrite is expected to replace this with a distributed rate limiter.

---

## 10. Idempotency model

### 10.1 What guarantees idempotency today

| Webhook | Idempotency key | Where enforced |
|---|---|---|
| `inbound-proposal` | `(external_source, external_session_id)` or `(external_source, external_proposal_id)` | Lookup in `website_inbound_links` table |
| `payment-confirmed` | `(external_source, external_payment_id)` plus fallback to session/proposal id | Same table + unique constraint on `external_payment_id` |
| `prototype-decision` | Transport-level only — `(endpoint='prototype-decision', signature_hash)` in `website_webhook_events` ledger, plus application-level UNIQUE on `prototype_decisions(prototype_workspace_id)` for one-terminal-decision-per-workspace | Ledger row claim + table UNIQUE; see §5.3 |
| `prototype-signed-read` (GET) | **Intrinsic HTTP idempotency** — no application-level or transport-level dedup required. Reads are non-mutating; replay returns the same response within the cache window (§6.8). Transport ledger declined by design per ADR-024 D1; see §6.9 / §6.10 | n/a — HTTP semantics suffice |
| `proposal-review-decision` (outbound) | App side: stable transition (PM decision is itself idempotent). Web side: see §7.4 | App stores decision in `lead_proposals.review_status` |

### 10.2 Transport-level idempotency (B15 — implemented 2026-05-20)

**Status:** implemented in v1 internal. The wire contract is unchanged.

App side now persists every signed inbound request in a `website_webhook_events` ledger as the **first** action after HMAC + timestamp verification. Identity key is the pair `(endpoint, signature_hash)` where `signature_hash = sha256(${timestamp}.${bodyText})` — byte-identical to the HMAC signing input. See ADR-016 for the full rationale.

**Behavior NoonWeb observes:**

- Fresh signed request → same response as before (200 or 201, business-logic shape).
- **Bit-identical replay** (same `bodyText`, same `x-noon-timestamp`, same `x-noon-signature`) → wire shape is identical to the existing app-level idempotent response: `{ idempotent: true, linkId, leadId, proposalId, [projectId], status }` with HTTP 200. NoonWeb cannot tell ledger-replay from app-replay.
- Adversarial traffic rejected by HMAC verify still gets 401 — those rejections are **not** persisted in the ledger (kept in Vercel runtime logs only).

**The `x-noon-event-id` header proposal is dropped.** Identity is computed from the existing `(x-noon-timestamp, body)` pair, no new header is required. NoonWeb senders need no code changes.

**Kill-switch:** the App-side env var `WEBSITE_WEBHOOK_LEDGER_ENABLED` is default-ON. If set to literal `'false'` (case-insensitive, post-trim), App reverts to pre-B15 behavior — app-level idempotency via `external_session_id` lookup only. NoonWeb still observes wire-identical responses.

**Retention:** 180 days documented in ADR-016 D8. Cleanup cron deferred (B15-bis).

---

## 11. Versioning strategy (v2 proposal)

### 11.1 Current state (v1)

- No version header
- Schema changes are made simultaneously on both sides via coordinated PRs
- Breaking changes require coordinated deploy

### 11.2 Proposed (v2)

Add header on every request:

```
x-noon-webhook-schema-version: 1
```

When sender bumps to `2`, receiver MUST accept both `1` and `2` during a minimum 7-day migration window. After the window, receiver MAY reject `1` with `426 Upgrade Required`.

**Status:** not yet implemented on either side. Tracked as a v2 enhancement when Go rewrite arrives. Until then, follow the coordinated-deploy rule.

---

## 12. Environment variables reference

### App side
| Env var | Purpose | Required |
|---|---|---|
| `NOON_WEBSITE_WEBHOOK_SECRET` | HMAC shared secret (bidirectional) | Yes for inbound + outbound |
| `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` | Outbound URL for proposal-review-decision | Optional (if absent, App logs and skips) |

### Web side
| Env var | Purpose | Required |
|---|---|---|
| `NOON_WEBSITE_WEBHOOK_SECRET` | HMAC shared secret (must match App) | Yes |
| (App webhook URLs) | URLs for the inbound webhooks on App side | Yes |

Both repos MUST use the exact same value for `NOON_WEBSITE_WEBHOOK_SECRET`. If they diverge, every webhook fails with `401`.

The `prototype-decision` endpoint (§5) introduces **no new env var**; it reuses `NOON_WEBSITE_WEBHOOK_SECRET` for HMAC verification, same as the other two inbound POST entries.

The `prototype-signed-read` endpoint (§6) also introduces **no new env var** per ADR-024 D1. It reuses `NOON_WEBSITE_WEBHOOK_SECRET` exactly as the four POST entries do — same secret, same `x-noon-timestamp` + `x-noon-signature` headers, same ±5min clock-skew window, same secret-rotation procedure (§2.4). The only signing-input difference is the empty-body convention `${timestamp}.` (§2.1).

---

## 13. Test fixtures

A minimal end-to-end signed payload for unit tests on either side:

```js
const secret = 'unit-secret'
const timestamp = Math.floor(Date.now() / 1000).toString()
const body = JSON.stringify({
  external_source: 'noon_website',
  external_session_id: 'sess_test_001',
  external_proposal_id: 'prop_test_001',
  customer: { name: 'Test', email: 'test@example.com' },
  proposal: { title: 'T', body: 'B', amount: 100, currency: 'USD' },
  maxwell: {},
  metadata: {}
})
const signature = crypto.createHmac('sha256', secret)
  .update(`${timestamp}.${body}`).digest('hex')
const headers = {
  'content-type': 'application/json',
  'x-noon-timestamp': timestamp,
  'x-noon-signature': `sha256=${signature}`,
}
```

The receiver MUST verify the signature using the EXACT raw body bytes received, not a re-serialized version. Trailing whitespace, key ordering, and float formatting all matter for HMAC.

The same fixture pattern applies to the `prototype-decision` endpoint (§5) by swapping the body shape per §5.2 and pointing at `/api/integrations/website/prototype-decision`. No header changes.

**GET fixture for `prototype-signed-read` (§6).** For the read endpoint the body is empty; the signing input is `${timestamp}.` (trailing dot, empty string body). The fixture below produces a valid request:

```js
const secret = 'unit-secret'
const token = 'wsp_test_token_001'                       // App-issued share_token
const timestamp = Math.floor(Date.now() / 1000).toString()
const signature = crypto.createHmac('sha256', secret)
  .update(`${timestamp}.`).digest('hex')                  // empty body → trailing dot
const url = `https://app.example.com/api/integrations/website/prototype-signed-read/${token}`
const headers = {
  'x-noon-timestamp': timestamp,
  'x-noon-signature': `sha256=${signature}`,
}
// fetch(url, { method: 'GET', headers })
```

No `content-type` header is required (no body). URL path is NOT part of the signing input — the handler validates the path implicitly via Next.js routing and resolves the token via DB lookup against `prototype_workspaces.share_token`.

---

## 14. Reference implementation (Next.js, current)

These files implement the v1 contract on the App side. The Go rewrite will reimplement the same contract on the same URLs with the same headers/payloads. The reference is here only for the Go dev to compare; it is NOT part of the contract.

- HMAC sign + verify: `lib/server/website-webhook-auth.ts`
- Inbound proposal route: `app/api/integrations/website/inbound-proposal/route.ts`
- Inbound payment route: `app/api/integrations/website/payment-confirmed/route.ts`
- Inbound prototype-decision route: `app/api/integrations/website/prototype-decision/route.ts` (B+C slice implemented 2026-05-25 — migration `0060_phase_23a_prototype_decisions.sql` + handler `receiveWebsitePrototypeDecision` + Maxwell draft `lib/server/maxwell/prototype-decision-draft.ts`; contract per ADR-023 + §5)
- Inbound prototype-signed-read route: `app/api/integrations/website/prototype-signed-read/[token]/route.ts` (handler shipped 2026-05-26; handler-helper `serveWebsitePrototypeSignedRead` in `lib/server/website-integration.ts`; repository helpers `getPrototypeWorkspaceByShareToken` + `countPrototypeWorkspaceVersionForLead` in `lib/server/prototypes/repository.ts`; contract per ADR-024 + §6)
- Schema definitions: `lib/server/website-integration.ts`
- Outbound proposal-review-decision sender: `sendProposalReviewDecisionToWebsite` in `lib/server/website-integration.ts`
- Idempotency table: `supabase/migrations/0034_phase_14a_website_inbound_integration.sql`
- Transport ledger table: `supabase/migrations/00XX_phase_..._website_webhook_event_ledger.sql` (per ADR-016); B-slice extends the `endpoint` CHECK constraint with `'prototype-decision'`
- Prototype decision persistence: `supabase/migrations/00YY_phase_..._prototype_decisions.sql` (B-slice — pending; per ADR-023 D4)
- Tests: `tests/server/website-webhook-auth.test.ts`

---

## 15. Open issues

| Issue | Severity | Owner | Notes |
|---|---|---|---|
| ~~No webhook event ledger / nonce store on App side (audit B15)~~ | ~~Medium~~ | — | **Resolved 2026-05-20 — ADR-016.** Transport-level idempotency ledger `website_webhook_events` implemented and live in production. See §10.2. |
| No version header enforced yet (§11) | Low | Bilateral | Negotiate v2 cutover during Go rewrite |
| Outbound `proposal-review-decision` lacks retry on failure (audit B9 Web) | Medium | Go rewrite | Exponential backoff retry queue |
| In-memory rate limiter does not scale multi-instance (TDR-002) | Medium | Go rewrite | Distributed rate limiter |
| Web side B9 retry of inbound when App is down | Medium | NoonWeb | Web should retry inbound-proposal / payment-confirmed / prototype-decision if App returns 5xx (per §5.9 for prototype-decision). `prototype-signed-read` (§6) is GET — Web SHOULD retry on 5xx within the §6.7 rate-limit budget; treat 4xx as terminal per the §6.5 code mapping. |
| ~~Secret rotation procedure not documented as a runbook~~ | ~~Low~~ | — | **Resolved 2026-05-26** — `docs/runbooks/cross-repo-secret-rotation.md` covers planned + incident-driven rotation for all App-nooncode secrets, with §4 dedicated to cross-repo coordination of `NOON_WEBSITE_WEBHOOK_SECRET`. Codifies the G13 (2026-05-17) `.mcp.json` rotation pattern. |
| `prototype-decision` endpoint code not yet implemented (C-slice) | Tracking | App | Contract firmed by ADR-023 + §5; route + handler + Maxwell-draft fire-and-forget pending. NoonWeb-dev acknowledgment of §5 required before D-slice (NoonWeb route) builds |
| `prototype_decisions` table + `prototype_workspaces.share_token` + `prototype_credit_settings.max_iterations_per_lead` migration not yet applied (B-slice) | Tracking | App | Per ADR-023 D4 + D7. Soft prerequisite of C-slice handler and §6 handler iteration |
| ~~`prototype-signed-read` endpoint code not yet implemented (handler iteration)~~ | ~~Tracking~~ | — | **Resolved 2026-05-26** — handler shipped per ADR-024 + §6 + ADR-024 §Amendments A1. Route + handler-helper + repository helpers + 10 unit tests landed on branch `feat/g22-prototype-signed-read-handler` (PR pending). NoonWeb-dev acknowledgment of §6 still required before D-slice render-fetch builds against it; wire shape unchanged from §6 firmed contract. |
| NoonWeb-side render of `/maxwell/prototipo/[token]` against §6 (D-slice render iteration) | Tracking | NoonWeb | Out of this repo. NoonWeb consumes the firmed §6 contract: GET fetch on render, switch UI mode based on `data.decision.status`, render error states per §6.5 (404 / 410 / 401 / 429 / 500), embed iframe at `data.prototype.deployedUrl`. Bilateral smoke test required against the App-side handler before NoonWeb production deploy. |

---

## 16. Change control

Any change to this document MUST:

1. Be agreed in the daily cross-repo sync between App side and NoonWeb side.
2. Land via simultaneous PRs in both repos (App: `docs/integrations/cross-repo-webhook-v1.md`; Web: matching path on Web side).
3. If the change is breaking, bump the document filename to `cross-repo-webhook-v2.md` and follow §11 migration window.
4. The `v1` filename stays as historical reference until the migration window closes.

The `prototype-decision` §5 addition (2026-05-23) follows this rule with one operational nuance: the App-side §5 PR may land without simultaneous NoonWeb-side acknowledgment because no App-side code lands in the same iteration (the contract publication is the unblocking artifact for both parallel build streams per ADR-023). NoonWeb-dev acknowledgment is required **before** D-slice (NoonWeb route) builds against this section; not before §5 lands here.

The `prototype-signed-read` §6 addition (2026-05-25) follows the same operational nuance per ADR-024 D5: the App-side §6 PR may land without simultaneous NoonWeb-side acknowledgment because no App-side code lands in the same iteration. NoonWeb-dev acknowledgment is required **before** the NoonWeb-side render iteration (D-slice render of `/maxwell/prototipo/[token]`) builds against §6; not before §6 lands here. Bilateral smoke test (NoonWeb → App `GET /api/integrations/website/prototype-signed-read/[token]` round-trip with a real signed request and a known-good token) is required before NoonWeb production deploy of the render route.

---

## 17. References

- HMAC implementation: `lib/server/website-webhook-auth.ts`
- ADR-005 (Maxwell modules shared brand): `docs/adrs/ADR-005-maxwell-modules-shared-brand.md`
- ADR-010 (client portal lives in NoonWeb — App is operator-only; anchors §5 + §6): `docs/adrs/ADR-010-client-portal-lives-in-noonweb.md`
- ADR-013 (seller-fee additive pricing — anchors §5.8 Option β + §6.11 strip-list invariant): `docs/adrs/ADR-013-seller-fee-additive-pricing.md`
- ADR-016 (transport-level webhook ledger pattern — anchors §5.3, §5.7, §10.2; explicitly declined for §6 per ADR-024 D1 — see §6.9): `docs/adrs/ADR-016-transport-level-webhook-ledger-pattern.md`
- ADR-023 (prototype-decision cross-repo contract — full rationale for §5): `docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md`
- ADR-024 (prototype-signed-read cross-repo contract — full rationale for §6; discharges ADR-023 D8): `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md`
- Spec `specs/fase-3-g22-signed-read-spec.md` — Analysis output that ADR-024 resolves; the spec scopes the contract-only iteration.
- Idempotency table migration: `supabase/migrations/0034_phase_14a_website_inbound_integration.sql`
- Cross-repo coordination protocol: `docs/business/roadmap-reconciled.md` and the parallel `NoonApp Roadmap.md` (vault) §10
- Audit findings B9, B11, B15 (NoonWeb Launch.md and NoonApp Launch.md, in user vault)
