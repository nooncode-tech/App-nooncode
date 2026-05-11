# Cross-repo webhook contract — NoonApp ↔ NoonWeb (v1)

> **Status:** v1 is the live, deployed protocol. **No `X-Webhook-Schema-Version` header is enforced yet** — that arrives with v2 (see §9).
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

POST /api/integrations/        ◄──────────────  proposal-review-decision
     noon-app/
     proposal-review-decision
```

Three message types today:
1. **Web → App: `inbound-proposal`** — a client completed Maxwell on the website and a proposal was created. App creates a lead + proposal + inbound link, queues PM review.
2. **Web → App: `payment-confirmed`** — the client paid for an approved proposal. App activates the project, records payment, kicks off delivery.
3. **App → Web: `proposal-review-decision`** — the PM approved/rejected/requested changes on an inbound proposal. Web updates client UI.

All three share the same auth + signing protocol. They differ only in URL, payload, and response.

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

See §6 for common error shape.

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

This guarantees: a client cannot bypass PM review by paying directly. The website must enforce this on its side too (do not show the pay button until App webhook confirms the proposal is approved — see §5).

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

## 5. Outbound webhook — `proposal-review-decision` (App → Web)

### 5.1 Endpoint

`POST {NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL}`

The URL is configured on the App side via the env var `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL`. Typical value: `https://noon.example.com/api/integrations/noon-app/proposal-review-decision`. If the URL is empty, App logs and skips (review still recorded internally; Web just does not get notified).

### 5.2 Request payload

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

### 5.3 Expected response from Web

Web SHOULD return `2xx` to acknowledge receipt. App treats:
- `2xx` → `review_webhook_status = 'sent'`
- non-2xx → `review_webhook_status = 'failed'` with the response text saved in `review_webhook_error`
- network error → `review_webhook_status = 'failed'` with the error message saved

App does NOT currently retry failed outbound webhooks automatically. This is tracked as audit finding B9 (Web side) and will be addressed by either side adding a retry queue. Recommended: Go-side rewrite implements exponential backoff retry (3-5 attempts).

### 5.4 Idempotency on Web side

Web SHOULD treat the combination `(external_source, external_proposal_id, decision)` as the idempotency key. Receiving the same decision twice MUST NOT create duplicate notifications/state transitions on the client portal.

### 5.5 Decision semantics

| Decision | Client portal behavior (Web) |
|---|---|
| `approved` | Show "Proceed to payment" CTA. Enable Stripe Checkout link |
| `rejected` | Show "Proposal declined" with optional message. No payment path |
| `changes_requested` | Show "PM requested changes" with the changes summary if provided. Allow resubmission |
| `cancelled` | Show "Proposal cancelled" terminal state. No further action |

---

## 6. Common error response shape

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

## 7. Rate limiting

The two inbound endpoints (on App) enforce:
- **Limit:** 120 requests per minute per namespace
- **Namespace `inbound-proposal`:** independent counter per endpoint
- **Namespace `payment-confirmed`:** independent counter per endpoint
- **Identity:** by remote IP (current Next.js in-memory rate limiter)

When exceeded: `429 Too Many Requests`.

**Known limitation:** the current rate limiter is in-process and does not survive multi-instance deployment (TDR-002). Web side should self-throttle to under 60 RPM during normal operation. Go rewrite is expected to replace this with a distributed rate limiter.

---

## 8. Idempotency model

### 8.1 What guarantees idempotency today

| Webhook | Idempotency key | Where enforced |
|---|---|---|
| `inbound-proposal` | `(external_source, external_session_id)` or `(external_source, external_proposal_id)` | Lookup in `website_inbound_links` table |
| `payment-confirmed` | `(external_source, external_payment_id)` plus fallback to session/proposal id | Same table + unique constraint on `external_payment_id` |
| `proposal-review-decision` (outbound) | App side: stable transition (PM decision is itself idempotent). Web side: see §5.4 | App stores decision in `lead_proposals.review_status` |

### 8.2 What is NOT yet guaranteed (audit B15)

The current model assumes the website-side ids (`external_session_id`, `external_proposal_id`, `external_payment_id`) are stable and unique per logical entity. A replay attack with a forged but never-seen-before id pair would currently pass.

**Planned mitigation (v2):** add a `website_webhook_events` ledger table on App side mirroring the existing `stripe_webhook_events` pattern. Each inbound request gets a unique event id (header `x-noon-event-id` proposed). Replay → return `409` with code `WEBHOOK_EVENT_ALREADY_PROCESSED`.

---

## 9. Versioning strategy (v2 proposal)

### 9.1 Current state (v1)

- No version header
- Schema changes are made simultaneously on both sides via coordinated PRs
- Breaking changes require coordinated deploy

### 9.2 Proposed (v2)

Add header on every request:

```
x-noon-webhook-schema-version: 1
```

When sender bumps to `2`, receiver MUST accept both `1` and `2` during a minimum 7-day migration window. After the window, receiver MAY reject `1` with `426 Upgrade Required`.

**Status:** not yet implemented on either side. Tracked as a v2 enhancement when Go rewrite arrives. Until then, follow the coordinated-deploy rule.

---

## 10. Environment variables reference

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

---

## 11. Test fixtures

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

---

## 12. Reference implementation (Next.js, current)

These files implement the v1 contract on the App side. The Go rewrite will reimplement the same contract on the same URLs with the same headers/payloads. The reference is here only for the Go dev to compare; it is NOT part of the contract.

- HMAC sign + verify: `lib/server/website-webhook-auth.ts`
- Inbound proposal route: `app/api/integrations/website/inbound-proposal/route.ts`
- Inbound payment route: `app/api/integrations/website/payment-confirmed/route.ts`
- Schema definitions: `lib/server/website-integration.ts`
- Outbound proposal-review-decision sender: `sendProposalReviewDecisionToWebsite` in `lib/server/website-integration.ts`
- Idempotency table: `supabase/migrations/0034_phase_14a_website_inbound_integration.sql`
- Tests: `tests/server/website-webhook-auth.test.ts`

---

## 13. Open issues

| Issue | Severity | Owner | Notes |
|---|---|---|---|
| No webhook event ledger / nonce store on App side (audit B15) | Medium | Go rewrite | Add `website_webhook_events` mirror of `stripe_webhook_events` pattern |
| No version header enforced yet (§9) | Low | Bilateral | Negotiate v2 cutover during Go rewrite |
| Outbound `proposal-review-decision` lacks retry on failure (audit B9 Web) | Medium | Go rewrite | Exponential backoff retry queue |
| In-memory rate limiter does not scale multi-instance (TDR-002) | Medium | Go rewrite | Distributed rate limiter |
| Web side B9 retry of inbound when App is down | Medium | NoonWeb | Web should retry inbound-proposal/payment-confirmed if App returns 5xx |
| Secret rotation procedure not documented as a runbook | Low | Either repo | Add `docs/runbooks/cross-repo-secret-rotation.md` |

---

## 14. Change control

Any change to this document MUST:

1. Be agreed in the daily cross-repo sync between App side and NoonWeb side.
2. Land via simultaneous PRs in both repos (App: `docs/integrations/cross-repo-webhook-v1.md`; Web: matching path on Web side).
3. If the change is breaking, bump the document filename to `cross-repo-webhook-v2.md` and follow §9 migration window.
4. The `v1` filename stays as historical reference until the migration window closes.

---

## 15. References

- HMAC implementation: `lib/server/website-webhook-auth.ts`
- ADR-005 (Maxwell modules shared brand): `docs/adrs/ADR-005-maxwell-modules-shared-brand.md`
- Idempotency table migration: `supabase/migrations/0034_phase_14a_website_inbound_integration.sql`
- Cross-repo coordination protocol: `docs/business/roadmap-reconciled.md` and the parallel `NoonApp Roadmap.md` (vault) §10
- Audit findings B9, B11, B15 (NoonWeb Launch.md and NoonApp Launch.md, in user vault)
