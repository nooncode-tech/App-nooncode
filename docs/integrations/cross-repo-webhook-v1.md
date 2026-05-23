# Cross-repo webhook contract — NoonApp ↔ NoonWeb (v1)

> **Status:** v1 is the live, deployed protocol. **No `X-Webhook-Schema-Version` header is enforced yet** — that arrives with v2 (see §10).
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

POST /api/integrations/        ◄──────────────  proposal-review-decision
     noon-app/
     proposal-review-decision
```

Four message types today:
1. **Web → App: `inbound-proposal`** — a client completed Maxwell on the website and a proposal was created. App creates a lead + proposal + inbound link, queues PM review.
2. **Web → App: `payment-confirmed`** — the client paid for an approved proposal. App activates the project, records payment, kicks off delivery.
3. **Web → App: `prototype-decision`** — a client accepted or rejected a prototipo at the NoonWeb route `/maxwell/prototipo/[token]`. App records the decision and, on accept, fires a fire-and-forget Maxwell draft propuesta for the seller to complete. See §5.
4. **App → Web: `proposal-review-decision`** — the PM approved/rejected/requested changes on an inbound proposal. Web updates client UI.

All four share the same auth + signing protocol. They differ only in URL, payload, and response.

---

## 2. Authentication and signing

### 2.1 Algorithm

HMAC-SHA256 over `${timestamp}.${bodyText}`, hex-encoded, prefixed with `sha256=`.

```
signed_payload = `${unix_timestamp_seconds}.${raw_request_body}`
signature      = hex(hmac_sha256(NOON_WEBSITE_WEBHOOK_SECRET, signed_payload))
header value   = `sha256=${signature}`
```

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

See §7 for common error shape.

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

This guarantees: a client cannot bypass PM review by paying directly. The website must enforce this on its side too (do not show the pay button until App webhook confirms the proposal is approved — see §6).

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

> **Status:** wire contract firmed by ADR-023 (2026-05-23). Endpoint code lands in a follow-up iteration (C-slice). Persistence (`prototype_decisions` table + `prototype_workspaces.share_token` + `share_token_superseded_at` + `prototype_credit_settings.max_iterations_per_lead`) lands in B-slice. NoonWeb route `/maxwell/prototipo/[token]` lands in D-slice (NoonWeb-side).
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
- `notes` is optional but strongly encouraged on `rejected`. Stored verbatim on `prototype_decisions.notes`. No length cap beyond the cross-repo §7 common validation envelope; sender SHOULD truncate to ≤2000 chars to stay within reasonable JSON payload sizes.

### 5.3 Idempotency

**Transport-level (per ADR-016 / §8.2):** identical to the other two inbound entries. Identity key `(endpoint, signature_hash)` where `endpoint = 'prototype-decision'` and `signature_hash = sha256(${timestamp}.${bodyText})`. Bit-identical replay (same `bodyText`, same `x-noon-timestamp`, same `x-noon-signature`) returns the original wire-shape response with HTTP `200` and `idempotent: true`. The handler MUST sit behind the existing `website_webhook_events` ledger; the `endpoint` CHECK constraint is extended to include `'prototype-decision'` in the B-slice migration.

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

Common shape per §7.

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
- `5xx` or network error → MAY retry with exponential backoff. Bit-identical retries are detected by the App-side ledger and return `200 idempotent: true` per §5.3 / §9.2 (transport-level idempotency) / ADR-016 D6. Recommended cap: 3 attempts with backoff 1s / 5s / 30s.

A successful response after retry MUST be treated identically to a successful response on first attempt. The `idempotent` flag in the response data is informational; the wire-shape is the same.

---

## 6. Outbound webhook — `proposal-review-decision` (App → Web)

### 6.1 Endpoint

`POST {NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL}`

The URL is configured on the App side via the env var `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL`. Typical value: `https://noon.example.com/api/integrations/noon-app/proposal-review-decision`. If the URL is empty, App logs and skips (review still recorded internally; Web just does not get notified).

### 6.2 Request payload

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

### 6.3 Expected response from Web

Web SHOULD return `2xx` to acknowledge receipt. App treats:
- `2xx` → `review_webhook_status = 'sent'`
- non-2xx → `review_webhook_status = 'failed'` with the response text saved in `review_webhook_error`
- network error → `review_webhook_status = 'failed'` with the error message saved

App does NOT currently retry failed outbound webhooks automatically. This is tracked as audit finding B9 (Web side) and will be addressed by either side adding a retry queue. Recommended: Go-side rewrite implements exponential backoff retry (3-5 attempts).

### 6.4 Idempotency on Web side

Web SHOULD treat the combination `(external_source, external_proposal_id, decision)` as the idempotency key. Receiving the same decision twice MUST NOT create duplicate notifications/state transitions on the client portal.

### 6.5 Decision semantics

| Decision | Client portal behavior (Web) |
|---|---|
| `approved` | Show "Proceed to payment" CTA. Enable Stripe Checkout link |
| `rejected` | Show "Proposal declined" with optional message. No payment path |
| `changes_requested` | Show "PM requested changes" with the changes summary if provided. Allow resubmission |
| `cancelled` | Show "Proposal cancelled" terminal state. No further action |

---

## 7. Common error response shape

All four endpoints (3 inbound on App, 1 outbound from App) return errors in a consistent shape when they fail:

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE",
  "requestId": "string"
}
```

HTTP status reflects the category. The `code` field is stable for programmatic handling. `requestId` correlates with App-side logs.

---

## 8. Rate limiting

The three inbound endpoints (on App) enforce:
- **Limit:** 120 requests per minute per namespace
- **Namespace `inbound-proposal`:** independent counter per endpoint
- **Namespace `payment-confirmed`:** independent counter per endpoint
- **Namespace `prototype-decision`:** independent counter per endpoint
- **Identity:** by remote IP (current Next.js in-memory rate limiter)

When exceeded: `429 Too Many Requests`.

**Known limitation:** the current rate limiter is in-process and does not survive multi-instance deployment (TDR-002). Web side should self-throttle to under 60 RPM during normal operation. Go rewrite is expected to replace this with a distributed rate limiter.

---

## 9. Idempotency model

### 9.1 What guarantees idempotency today

| Webhook | Idempotency key | Where enforced |
|---|---|---|
| `inbound-proposal` | `(external_source, external_session_id)` or `(external_source, external_proposal_id)` | Lookup in `website_inbound_links` table |
| `payment-confirmed` | `(external_source, external_payment_id)` plus fallback to session/proposal id | Same table + unique constraint on `external_payment_id` |
| `prototype-decision` | Transport-level only — `(endpoint='prototype-decision', signature_hash)` in `website_webhook_events` ledger, plus application-level UNIQUE on `prototype_decisions(prototype_workspace_id)` for one-terminal-decision-per-workspace | Ledger row claim + table UNIQUE; see §5.3 |
| `proposal-review-decision` (outbound) | App side: stable transition (PM decision is itself idempotent). Web side: see §6.4 | App stores decision in `lead_proposals.review_status` |

### 9.2 Transport-level idempotency (B15 — implemented 2026-05-20)

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

## 10. Versioning strategy (v2 proposal)

### 10.1 Current state (v1)

- No version header
- Schema changes are made simultaneously on both sides via coordinated PRs
- Breaking changes require coordinated deploy

### 10.2 Proposed (v2)

Add header on every request:

```
x-noon-webhook-schema-version: 1
```

When sender bumps to `2`, receiver MUST accept both `1` and `2` during a minimum 7-day migration window. After the window, receiver MAY reject `1` with `426 Upgrade Required`.

**Status:** not yet implemented on either side. Tracked as a v2 enhancement when Go rewrite arrives. Until then, follow the coordinated-deploy rule.

---

## 11. Environment variables reference

### App side
| Env var | Purpose | Required |
|---|---|---|
| `NOON_WEBSITE_WEBHOOK_SECRET` | HMAC shared secret (bidirectional) | Yes for inbound + outbound |
| `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` | Outbound URL for proposal-review-decision | Optional (if absent, App logs and skips) |

### Web side
| Env var | Purpose | Required |
|---|---|---|
| `NOON_WEBSITE_WEBHOOK_SECRET` | HMAC shared secret (must match App) | Yes |
| (App webhook URLs) | URLs for the two inbound webhooks on App side | Yes |

Both repos MUST use the exact same value for `NOON_WEBSITE_WEBHOOK_SECRET`. If they diverge, every webhook fails with `401`.

The `prototype-decision` endpoint (§5) introduces **no new env var**; it reuses `NOON_WEBSITE_WEBHOOK_SECRET` for HMAC verification, same as the other two inbound entries.

---

## 12. Test fixtures

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

---

## 13. Reference implementation (Next.js, current)

These files implement the v1 contract on the App side. The Go rewrite will reimplement the same contract on the same URLs with the same headers/payloads. The reference is here only for the Go dev to compare; it is NOT part of the contract.

- HMAC sign + verify: `lib/server/website-webhook-auth.ts`
- Inbound proposal route: `app/api/integrations/website/inbound-proposal/route.ts`
- Inbound payment route: `app/api/integrations/website/payment-confirmed/route.ts`
- Inbound prototype-decision route: `app/api/integrations/website/prototype-decision/route.ts` (C-slice — pending implementation as of 2026-05-23; contract firmed by ADR-023 + §5 of this doc)
- Schema definitions: `lib/server/website-integration.ts`
- Outbound proposal-review-decision sender: `sendProposalReviewDecisionToWebsite` in `lib/server/website-integration.ts`
- Idempotency table: `supabase/migrations/0034_phase_14a_website_inbound_integration.sql`
- Transport ledger table: `supabase/migrations/00XX_phase_..._website_webhook_event_ledger.sql` (per ADR-016); B-slice extends the `endpoint` CHECK constraint with `'prototype-decision'`
- Prototype decision persistence: `supabase/migrations/00YY_phase_..._prototype_decisions.sql` (B-slice — pending; per ADR-023 D4)
- Tests: `tests/server/website-webhook-auth.test.ts`

---

## 14. Open issues

| Issue | Severity | Owner | Notes |
|---|---|---|---|
| ~~No webhook event ledger / nonce store on App side (audit B15)~~ | ~~Medium~~ | — | **Resolved 2026-05-20 — ADR-016.** Transport-level idempotency ledger `website_webhook_events` implemented and live in production. See §9.2. |
| No version header enforced yet (§10) | Low | Bilateral | Negotiate v2 cutover during Go rewrite |
| Outbound `proposal-review-decision` lacks retry on failure (audit B9 Web) | Medium | Go rewrite | Exponential backoff retry queue |
| In-memory rate limiter does not scale multi-instance (TDR-002) | Medium | Go rewrite | Distributed rate limiter |
| Web side B9 retry of inbound when App is down | Medium | NoonWeb | Web should retry inbound-proposal / payment-confirmed / prototype-decision if App returns 5xx (per §5.9 for prototype-decision) |
| Secret rotation procedure not documented as a runbook | Low | Either repo | Add `docs/runbooks/cross-repo-secret-rotation.md` |
| `prototype-decision` endpoint code not yet implemented (C-slice) | Tracking | App | Contract firmed by ADR-023 + §5; route + handler + Maxwell-draft fire-and-forget pending. NoonWeb-dev acknowledgment of §5 required before D-slice (NoonWeb route) builds |
| `prototype_decisions` table + `prototype_workspaces.share_token` + `prototype_credit_settings.max_iterations_per_lead` migration not yet applied (B-slice) | Tracking | App | Per ADR-023 D4 + D7. Soft prerequisite of C-slice handler |

---

## 15. Change control

Any change to this document MUST:

1. Be agreed in the daily cross-repo sync between App side and NoonWeb side.
2. Land via simultaneous PRs in both repos (App: `docs/integrations/cross-repo-webhook-v1.md`; Web: matching path on Web side).
3. If the change is breaking, bump the document filename to `cross-repo-webhook-v2.md` and follow §10 migration window.
4. The `v1` filename stays as historical reference until the migration window closes.

The `prototype-decision` §5 addition (2026-05-23) follows this rule with one operational nuance: the App-side §5 PR may land without simultaneous NoonWeb-side acknowledgment because no App-side code lands in the same iteration (the contract publication is the unblocking artifact for both parallel build streams per ADR-023). NoonWeb-dev acknowledgment is required **before** D-slice (NoonWeb route) builds against this section; not before §5 lands here.

---

## 16. References

- HMAC implementation: `lib/server/website-webhook-auth.ts`
- ADR-005 (Maxwell modules shared brand): `docs/adrs/ADR-005-maxwell-modules-shared-brand.md`
- ADR-010 (client portal lives in NoonWeb — App is operator-only; anchors §5): `docs/adrs/ADR-010-client-portal-lives-in-noonweb.md`
- ADR-013 (seller-fee additive pricing — anchors §5.8 Option β): `docs/adrs/ADR-013-seller-fee-additive-pricing.md`
- ADR-016 (transport-level webhook ledger pattern — anchors §5.3, §5.7, §9.2): `docs/adrs/ADR-016-transport-level-webhook-ledger-pattern.md`
- ADR-023 (prototype-decision cross-repo contract — full rationale for §5): `docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md`
- Idempotency table migration: `supabase/migrations/0034_phase_14a_website_inbound_integration.sql`
- Cross-repo coordination protocol: `docs/business/roadmap-reconciled.md` and the parallel `NoonApp Roadmap.md` (vault) §10
- Audit findings B9, B11, B15 (NoonWeb Launch.md and NoonApp Launch.md, in user vault)
