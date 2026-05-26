# Maxwell-chat cross-repo contracts handoff — for NoonWeb dev (GET signed-read + POST decision)

> **Date:** 2026-05-25 (extended same day with POST `prototype-decision` wire spec).
> **From:** App-side Architecture + Docs (G22 iteration `fase-3-g22-signed-read-spec` + B+C Architecture pass over `fase-3-adr-023-b-c-slice-prototype-decision-impl`).
> **To:** NoonWeb dev (owner of `/maxwell/prototipo/[token]` render + decision route).
> **Source of truth:**
> - GET render: `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md` + `docs/integrations/cross-repo-webhook-v1.md` §6.
> - POST decision: `docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md` + `docs/adrs/ADR-025-prototype-decision-impl-architecture-firmups.md` + `docs/integrations/cross-repo-webhook-v1.md` §5.
> **Status:** both wire contracts **frozen**. NoonWeb-side D-slice render+decision iteration can start NOW against this handoff. Both App-side handler iterations are independent slices (the contracts decouple both sides). Bilateral smoke test required before NoonWeb production deploy.

This handoff is the operational unblock for NoonWeb-dev to build the full Maxwell-chat lead-creation flow at `/maxwell/prototipo/[token]`. It compacts both wire contracts into the minimal surface NoonWeb needs to build the route end-to-end. For any rationale not covered here, defer to the source-of-truth ADRs.

---

## 1. What this handoff covers

The flow has two cross-repo App endpoints:

1. **GET `prototype-signed-read`** (§2-§4) — App returns the prototipo data when NoonWeb renders the page. Wire contract firmed by ADR-024 (2026-05-25).
2. **POST `prototype-decision`** (§6) — App records client accept/reject when the user clicks. Wire contract firmed by ADR-023 (2026-05-23) + cross-repo §5 + ADR-025 (2026-05-25).

Both endpoints share the same HMAC envelope pattern (`NOON_WEBSITE_WEBHOOK_SECRET`, `x-noon-timestamp` + `x-noon-signature`, ±5min clock-skew window). The **signing input differs** because GET has no body and POST has body — see §2.3 (`${timestamp}.`) vs §6.3 (`${timestamp}.${bodyText}`).

When the client opens `/maxwell/prototipo/[token]` on NoonWeb, NoonWeb's **server** (not the browser) fetches the prototipo data via GET at render time. App is the system of record; NoonWeb is the render layer. This materializes Pull pattern B.2 (ADR-023 L-2 / D8 → ADR-024 discharge). When the client clicks accept or reject, NoonWeb's server POSTs the decision to App. App persists, fires-and-forgets Maxwell draft creation (on accept), notifies seller, and responds.

**No client identity ever reaches App.** Authentication is server-to-server via the HMAC envelope NoonWeb already uses for the inbound webhook entries.

**App-side handler implementation status (2026-05-25):**
- GET handler: not specced yet (future iteration after operator decides).
- POST handler: B+C iteration Architecture done (ADR-025 firmed today); Backend pending.

NoonWeb can build the full route NOW against mocks — both contracts are frozen.

---

## 2. GET `prototype-signed-read` wire spec

### 2.1 Endpoint URL

```
GET https://<app-host>/api/integrations/website/prototype-signed-read/[token]
```

- `<app-host>` is the App-side base URL (operator-configured; same host that serves the POST inbound entries).
- `[token]` is the URL path parameter — the App-issued opaque share token (matches `prototype_workspaces.share_token`). Same token NoonWeb has from the upstream workspace creation / regenerate event. Same token NoonWeb later forwards in the POST `prototype-decision` payload (§5 of the contract doc).

### 2.2 Required headers

| Header | Value | Notes |
|---|---|---|
| `x-noon-timestamp` | Unix seconds (integer string) | Sender's clock at signing time |
| `x-noon-signature` | `sha256=<lowercase-hex>` | HMAC-SHA256 of `${timestamp}.` (trailing dot + empty body) |

**No `content-type` header is required.** The body is empty.

### 2.3 HMAC signing recipe

The signing input for a GET is the **empty-body convention** locked by ADR-024 D1 (also documented in §2.1 of the cross-repo doc):

```
signed_payload = `${unix_timestamp_seconds}.`     // timestamp + literal dot + empty string body
signature      = hex(hmac_sha256(NOON_WEBSITE_WEBHOOK_SECRET, signed_payload))
header value   = `sha256=${signature}`
```

The trailing dot is mandatory. Do NOT include the URL path, headers, or any other content in the signing input.

**Secret:** `NOON_WEBSITE_WEBHOOK_SECRET` — the same env var NoonWeb already uses for the POST inbound entries. No new secret. No rotation procedure change.

**Clock-skew window:** ±5 minutes (`MAX_CLOCK_SKEW_SECONDS = 300`). Same as the POST entries.

### 2.4 Sample successful request

```bash
# Variables
TOKEN="wsp_abcd1234example5678token"          # App-issued share_token (received from upstream)
SECRET="$NOON_WEBSITE_WEBHOOK_SECRET"
TIMESTAMP=$(date -u +%s)
APP_HOST="https://app.noon.example.com"        # operator-configured base URL

# Sign empty body
SIGNING_INPUT="${TIMESTAMP}."
SIGNATURE=$(echo -n "$SIGNING_INPUT" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.*= //')

# Request
curl -sS -X GET \
  -H "x-noon-timestamp: $TIMESTAMP" \
  -H "x-noon-signature: sha256=$SIGNATURE" \
  "${APP_HOST}/api/integrations/website/prototype-signed-read/${TOKEN}"
```

Node.js equivalent (cleaner for the production NoonWeb code path):

```js
const crypto = require('crypto')

async function fetchPrototype(token, appHost, secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signingInput = `${timestamp}.`
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('hex')
  const url = `${appHost}/api/integrations/website/prototype-signed-read/${token}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-noon-timestamp': timestamp,
      'x-noon-signature': `sha256=${signature}`,
    },
  })
  // Caller handles status codes per §3 of this handoff.
  return res
}
```

### 2.5 Sample 200 success response

```json
{
  "data": {
    "workspace": {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "version": 1,
      "generatedAt": "2026-05-25T14:32:18.000Z"
    },
    "leadContext": {
      "businessName": "Acme Co",
      "projectTypeLabel": "Landing Page"
    },
    "prototype": {
      "deployedUrl": "https://acme-prototype-v1.vercel.app",
      "generatedHtml": null
    },
    "decision": {
      "status": "pending",
      "notes": null,
      "decidedAt": null
    },
    "lifecycle": {
      "tokenSuperseded": false,
      "iterationNumber": 1
    },
    "serverTime": "2026-05-25T16:45:02.123Z"
  },
  "requestId": "req_8h3jdkl290sl3kjf"
}
```

**Field semantics:**

- `data.workspace.id` — UUID. Forward this as `prototype_workspace_id` in the subsequent POST `prototype-decision` payload (§5 defensive cross-check).
- `data.workspace.version` — `1` for V1; `2`, `3`, etc. after regenerate. Use for "Prototipo V2" badge if desired.
- `data.leadContext.businessName` — render as "Prototipo para `{businessName}`" page header.
- `data.leadContext.projectTypeLabel` — human-readable label ("Landing Page", "Web App", "E-commerce"). Do NOT expect the raw enum — App decoupled it.
- `data.prototype.deployedUrl` — iframe target (primary render path). Nullable during the build window.
- `data.prototype.generatedHtml` — fallback static HTML when no `deployedUrl` is available. Both fields may be null simultaneously while the build is in progress; render "preparando tu prototipo" in that case.
- `data.decision.status` — `'pending'`, `'accepted'`, or `'rejected'`. Drives the UI mode switch:
  - `'pending'` → show accept / reject CTAs.
  - `'accepted'` → render read-only with "Ya aceptaste este prototipo" banner. Echo `decidedAt` if useful.
  - `'rejected'` → render read-only with "Lo rechazaste — esperá la próxima versión" banner + echo `decision.notes` if non-null.
- `data.decision.notes` — non-null only when `status === 'rejected'` AND the client provided rejection notes. Sanitizer guarantees it is `null` for `'accepted'` and `'pending'`.
- `data.decision.decidedAt` — ISO 8601. Null when `status === 'pending'`.
- `data.lifecycle.tokenSuperseded` — always `false` on a 200 (supersede → 410). Defensive assertion only.
- `data.lifecycle.iterationNumber` — same as `workspace.version` today. Exposed for forward-compatibility (Gate B exposure in a future iteration).
- `data.serverTime` — `now()` at handler time. Useful for client-side clock anchoring ("generado hace 2 min").
- `requestId` — App-side trace id. Forward in your logs to enable cross-repo log joins.

### 2.6 Sample 410 PROTOTYPE_READ_TOKEN_SUPERSEDED

```json
{
  "error": "This prototype token has been superseded by a newer version.",
  "code": "PROTOTYPE_READ_TOKEN_SUPERSEDED",
  "requestId": "req_4j2lksdf83hflk2"
}
```

HTTP status: `410 Gone`. Terminal for the V1 token. **NoonWeb UX:** render "Este prototipo fue actualizado, pedile al vendedor el nuevo link." Do NOT retry; do NOT cache (Cache-Control will be `no-store`).

### 2.7 Sample 410 PROTOTYPE_READ_LEAD_DELETED

```json
{
  "error": "This prototype is no longer available.",
  "code": "PROTOTYPE_READ_LEAD_DELETED",
  "requestId": "req_9z2lakwe3hf"
}
```

HTTP status: `410 Gone`. Rare (FK cascade should remove the workspace too); defensive code path. **NoonWeb UX:** "Este prototipo ya no está disponible." Terminal.

### 2.8 Sample 401 WEBSITE_WEBHOOK_AUTH_FAILED

```json
{
  "error": "Webhook authentication failed.",
  "code": "WEBSITE_WEBHOOK_AUTH_FAILED",
  "requestId": "req_x2kjasdlf8h"
}
```

HTTP status: `401 Unauthorized`. Indicates sender misconfiguration (missing or invalid `x-noon-signature`, stale `x-noon-timestamp` outside ±5min window, missing secret). **NoonWeb UX:** surface a generic "service temporarily unavailable" page. Do NOT show the auth error to the client. Log loudly App-side trace correlation via `requestId`.

### 2.9 Sample 404 PROTOTYPE_READ_TOKEN_NOT_FOUND

```json
{
  "error": "Prototype not found for this token.",
  "code": "PROTOTYPE_READ_TOKEN_NOT_FOUND",
  "requestId": "req_kjas9d2lkfh"
}
```

HTTP status: `404 Not Found`. The token does not match any `prototype_workspaces.share_token` row. **NoonWeb UX:** "Este link no es válido." Terminal copy, no retry.

### 2.10 Sample 429 RATE_LIMITED

```json
{
  "error": "Rate limit exceeded for this endpoint.",
  "code": "RATE_LIMITED",
  "requestId": "req_n2k4jasl9df"
}
```

HTTP status: `429 Too Many Requests`. Indicates the combined-key `${token}:${remoteIp}` bucket exceeded 60 req/min. **NoonWeb UX:** surface a generic transient error and do NOT retry within the same minute. If you see this frequently in production for legitimate traffic, the rate-limit budget can be retuned via an App-side follow-up iteration — log the occurrence and surface to operator.

### 2.11 Sample 500 PROTOTYPE_READ_INTERNAL_FAILED

```json
{
  "error": "Internal server error.",
  "code": "PROTOTYPE_READ_INTERNAL_FAILED",
  "requestId": "req_82lkjsadf9h"
}
```

HTTP status: `500 Internal Server Error`. DB error during workspace / decision lookup or sanitization. **NoonWeb UX:** surface a generic transient error. MAY retry once with backoff (e.g., 2s) within the §2.10 rate-limit budget. Log `requestId` for cross-repo trace.

---

## 3. GET cache strategy (read carefully)

The 200 success response carries:

```
Cache-Control: private, max-age=30, stale-while-revalidate=60
```

- `private` — token-bound; do NOT push to any shared CDN tier (no Vercel public edge, no ISP cache).
- `max-age=30` — 30 seconds of fresh cache.
- `stale-while-revalidate=60` — if the cache entry is stale (30-90s old), serve the stale version and revalidate in background.
- **Total worst-case window for supersede visibility: 90 seconds.** During this window a client may see the "you can still accept" UI on a prototipo that has been superseded server-side. **This is by design.** The safety net is the POST `prototype-decision` write-side `410 PROTOTYPE_DECISION_TOKEN_EXPIRED` (§5.5 of the contract doc); NoonWeb-side UX MUST handle that 410 gracefully ("Este prototipo fue actualizado, pedile el nuevo link al vendedor").

Non-200 responses (4xx / 5xx) carry:

```
Cache-Control: no-store
```

Do NOT cache error states (especially the 410s, which would otherwise pin a stale supersede flag at NoonWeb's edge).

**Recommendation:** respect the `Cache-Control` header as-is. The 30-90s freshness window is operator-deemed acceptable; tightening it (e.g., `no-store`) is a future Architecture flip (Q-arch-7 alternative a) that requires App-side coordination — do NOT unilaterally bypass.

---

## 4. GET rate limit (read carefully)

The endpoint enforces (ADR-024 D6, §6.7 of the contract doc):

- **Namespace:** `prototype-signed-read` (independent counter from the POST entries).
- **Limit:** 60 requests per minute.
- **Window:** 60_000 ms.
- **Identity key:** `${token}:${remoteIp}` combined — App computes `remoteIp` from the first hop of `x-forwarded-for`. If detection fails, the key degrades to `${token}:unknown`.

Legitimate render is 1-2 req/session/token; 60/min/(token,IP) is generous. If you observe consistent 429s for legitimate traffic, escalate to operator — the budget can be retuned on the App side.

**Do NOT retry on 429 within the same minute** — wait for the next window. Treat as a transient transport-layer error, not a contract violation.

---

## 5. NoonWeb-side checklist (GET render + POST decision)

Build the D-slice render+decision route against both contracts. The items below are the minimal acceptance surface for the full flow.

### 5.1 GET render path

- [ ] **Fetch** — server-side `fetch` to `GET https://<app-host>/api/integrations/website/prototype-signed-read/[token]` with the HMAC signing recipe from §2.3.
- [ ] **Handle 200** — switch UI mode based on `data.decision.status`:
  - `'pending'` → render iframe at `data.prototype.deployedUrl` (or fallback HTML at `data.prototype.generatedHtml`) + accept / reject CTAs that POST to `prototype-decision` (§6).
  - `'accepted'` → render the prototipo read-only with "Ya aceptaste este prototipo" banner + `data.decision.decidedAt`.
  - `'rejected'` → render the prototipo read-only with "Lo rechazaste — esperá la próxima versión" banner + `data.decision.notes` echoed.
- [ ] **Handle 410 PROTOTYPE_READ_TOKEN_SUPERSEDED** — "Este prototipo fue actualizado, pedile al vendedor el nuevo link." Terminal copy, no retry.
- [ ] **Handle 410 PROTOTYPE_READ_LEAD_DELETED** — "Este prototipo ya no está disponible." Terminal copy.
- [ ] **Handle 404 PROTOTYPE_READ_TOKEN_NOT_FOUND** — "Este link no es válido." Terminal copy.
- [ ] **Handle 401 WEBSITE_WEBHOOK_AUTH_FAILED** — generic "service temporarily unavailable" page (do NOT expose the auth code to the client). Log loudly with `requestId` for cross-repo trace.
- [ ] **Handle 429 (rate limit) / 500 PROTOTYPE_READ_INTERNAL_FAILED** — generic transient error page. 5xx MAY be retried once with ~2s backoff. 429 MUST NOT be retried within the same minute.
- [ ] **Cache** — respect `Cache-Control: private, max-age=30, stale-while-revalidate=60` on 200 (Vercel's edge handles this natively if you use the standard `fetch` with `next: { revalidate: 30 }` or equivalent). For 4xx/5xx, `Cache-Control: no-store` is honored automatically; verify in dev tools.

### 5.2 POST decision path

- [ ] **Build signed POST** — when the client clicks accept or reject, server-side `fetch` to `POST https://<app-host>/api/integrations/website/prototype-decision` with body-included HMAC signing (§6.3). **Cache the signed bytes** for retry use (`bodyText` + `timestamp` + `signature`).
- [ ] **Handle 201 Created** — first successful submit. Render confirmation banner ("Aceptado — el equipo te contactará" / "Rechazado — esperá la próxima versión"). Lock the page to read-only state. `draftPropuestaQueued` is observability only — do NOT branch UX on it.
- [ ] **Handle 200 idempotent replay** — same UX as 201 (the `idempotent` field is observability only). Means the request was a bit-identical retry that App-side detected via transport ledger.
- [ ] **Handle 409 PROTOTYPE_DECISION_IDENTIFIER_MISMATCH** — stale workspace UUID. Re-fetch via GET §2 to refresh `data.workspace.id`, then re-attempt POST with the fresh UUID.
- [ ] **Handle 409 PROTOTYPE_DECISION_ALREADY_DECIDED** — race with another tab or double-click. Re-fetch via GET §2 to render the current decision state ('accepted' or 'rejected' banner). Do NOT show error — show the truth.
- [ ] **Handle 410 PROTOTYPE_DECISION_TOKEN_EXPIRED** — same UX as GET 410 SUPERSEDED ("Prototipo actualizado, pedí nuevo link"). Terminal.
- [ ] **Handle 410 PROTOTYPE_DECISION_LEAD_DELETED** — same UX as GET 410 LEAD_DELETED ("Ya no disponible"). Terminal.
- [ ] **Handle 404 PROTOTYPE_DECISION_TOKEN_NOT_FOUND** — same UX as GET 404 ("Este link no es válido"). Terminal.
- [ ] **Handle 400 PROTOTYPE_DECISION_INVALID_DECISION or 400 (validation)** — bug in NoonWeb code (sent invalid decision value or malformed body). Generic error UX; surface internally for fix. Do NOT retry.
- [ ] **Handle 401 / 429 / 500 PROTOTYPE_DECISION_PERSIST_FAILED** — generic transient error UX. 5xx MAY be retried using **cached signed bytes** (see retry policy below). 429 MUST NOT retry within the same minute.
- [ ] **Retry policy** — on 5xx or network error, MAY retry up to 3 times with 1s / 5s / 30s exponential backoff. **Use the EXACT same bytes from the first attempt** (cached `bodyText` + `timestamp` + `signature`). Do NOT re-sign with a fresh timestamp — the transport ledger relies on bit-identical replay detection.

---

---

## 6. POST `prototype-decision` wire spec

> Wire contract firmed by ADR-023 (2026-05-23) + cross-repo §5 + ADR-025 (2026-05-25). App-side B+C iteration Architecture done; Backend pending. NoonWeb-dev can build the decision-write path NOW against this spec.

When the client clicks accept or reject in the rendered page, NoonWeb's server (not the browser) POSTs to App. Same HMAC envelope as the GET, **same secret, different signing input** (POST has body, GET has empty body).

### 6.1 Endpoint URL

```
POST https://<app-host>/api/integrations/website/prototype-decision
```

### 6.2 Required headers

| Header | Value | Notes |
|---|---|---|
| `x-noon-timestamp` | Unix seconds (integer string) | Sender's clock at signing time |
| `x-noon-signature` | `sha256=<lowercase-hex>` | HMAC-SHA256 of `${timestamp}.${bodyText}` |
| `content-type` | `application/json` | Required — body is JSON |

### 6.3 HMAC signing recipe

For POST, the signing input includes the **full body**, in contrast to the GET empty-body-trailing-dot convention:

```
signed_payload = `${unix_timestamp_seconds}.${bodyText}`
signature      = hex(hmac_sha256(NOON_WEBSITE_WEBHOOK_SECRET, signed_payload))
header value   = `sha256=${signature}`
```

The `bodyText` MUST be the **exact serialized JSON** that NoonWeb sends in the request body — same bytes, same whitespace, same key order. Bit-identical reproducibility is required for transport-level idempotency (§6.9).

**Secret + clock-skew window:** same as GET (`NOON_WEBSITE_WEBHOOK_SECRET`, ±5min).

### 6.4 Request body payload

```json
{
  "external_source": "noon_website",
  "token": "wsp_abcd1234example5678token",
  "prototype_workspace_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "decision": "accepted",
  "notes": null,
  "client": {
    "user_agent": "Mozilla/5.0 ..."
  },
  "metadata": {}
}
```

**Field semantics:**

- `external_source` — constant `"noon_website"` (denotes NoonWeb as sender).
- `token` — **authoritative**. The opaque share_token NoonWeb already has (same value used in the GET URL path §2.1). The handler resolves `token → prototype_workspaces.share_token` server-side.
- `prototype_workspace_id` — **defensive** cross-check. The UUID NoonWeb received as `data.workspace.id` from the GET response §2.5. Mismatch → `409 PROTOTYPE_DECISION_IDENTIFIER_MISMATCH`.
- `decision` — exactly `"accepted"` or `"rejected"`. Any other value → `400 PROTOTYPE_DECISION_INVALID_DECISION`.
- `notes` — optional, especially encouraged on `rejected`. Sender SHOULD truncate to ≤2000 chars. Stored verbatim by App.
- `client.user_agent` — optional, forensic context.
- `metadata` — optional record. App preserves but does not interpret.

### 6.5 Sample successful request

```bash
TOKEN="wsp_abcd1234example5678token"
WORKSPACE_ID="f47ac10b-58cc-4372-a567-0e02b2c3d479"
SECRET="$NOON_WEBSITE_WEBHOOK_SECRET"
TIMESTAMP=$(date -u +%s)
APP_HOST="https://app.noon.example.com"

# Compose body (exact bytes matter for HMAC reproducibility on retry)
BODY='{"external_source":"noon_website","token":"'"$TOKEN"'","prototype_workspace_id":"'"$WORKSPACE_ID"'","decision":"accepted","notes":null,"client":{"user_agent":"Mozilla/5.0"},"metadata":{}}'

# Sign with body
SIGNING_INPUT="${TIMESTAMP}.${BODY}"
SIGNATURE=$(echo -n "$SIGNING_INPUT" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.*= //')

# Request
curl -sS -X POST \
  -H "x-noon-timestamp: $TIMESTAMP" \
  -H "x-noon-signature: sha256=$SIGNATURE" \
  -H "content-type: application/json" \
  -d "$BODY" \
  "${APP_HOST}/api/integrations/website/prototype-decision"
```

Node.js (cleaner for production NoonWeb code path):

```js
const crypto = require('crypto')

async function postDecision({ token, workspaceId, decision, notes, userAgent, appHost, secret }) {
  // 1. Compose body — capture bytes for retry reuse
  const body = JSON.stringify({
    external_source: 'noon_website',
    token,
    prototype_workspace_id: workspaceId,
    decision,
    notes: notes ?? null,
    client: { user_agent: userAgent ?? null },
    metadata: {},
  })
  // 2. Sign
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signingInput = `${timestamp}.${body}`
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('hex')
  // 3. Send
  const url = `${appHost}/api/integrations/website/prototype-decision`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-noon-timestamp': timestamp,
      'x-noon-signature': `sha256=${signature}`,
      'content-type': 'application/json',
    },
    body,
  })
  // 4. Caller handles status codes per §6.8. For retry, reuse { body, timestamp, signature } verbatim.
  return { res, signedBytes: { body, timestamp, signature } }
}
```

### 6.6 Sample 201 success response (newly recorded)

```json
{
  "data": {
    "idempotent": false,
    "decisionId": "d3a8f10b-7d2e-4391-b9c7-2a4b1e8c5d62",
    "prototypeWorkspaceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "leadId": "9b8c7d6e-5f4a-3b2c-1d0e-8f7a6b5c4d3e",
    "decision": "accepted",
    "decidedAt": "2026-05-25T18:23:45.000Z",
    "draftPropuestaQueued": true
  },
  "requestId": "req_p2q3r4s5t6u7v8w9"
}
```

HTTP status: `201 Created`.

**Field semantics:**

- `idempotent` — `false` on the first successful POST. `true` on bit-identical replay (§6.7).
- `decisionId` — UUID of the new `prototype_decisions` row.
- `prototypeWorkspaceId` — echo of the workspace UUID.
- `leadId` — UUID of the parent lead (App-internal; exposed for cross-repo trace).
- `decision` — echo.
- `decidedAt` — ISO 8601 timestamp when the row was persisted.
- `draftPropuestaQueued` — `true` if `decision === 'accepted'` AND the post-accept Maxwell draft was fire-and-forget'd. `false` if `decision === 'rejected'` OR if this is an idempotent replay. **NoonWeb SHOULD render the success UX regardless of this field's value** — exposed for observability only.

### 6.7 Sample 200 idempotent replay response

A bit-identical retry (same `timestamp` + same `bodyText` + same `signature`) returns the original wire-shape with HTTP `200` and `idempotent: true`:

```json
{
  "data": {
    "idempotent": true,
    "decisionId": "d3a8f10b-7d2e-4391-b9c7-2a4b1e8c5d62",
    "prototypeWorkspaceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "leadId": "9b8c7d6e-5f4a-3b2c-1d0e-8f7a6b5c4d3e",
    "decision": "accepted",
    "decidedAt": "2026-05-25T18:23:45.000Z",
    "draftPropuestaQueued": false
  },
  "requestId": "req_p2q3r4s5t6u7v8w9"
}
```

**Bit-identical means**: same `bodyText` byte-for-byte, same `x-noon-timestamp`, same `x-noon-signature`. Different timestamp = different signature = NOT bit-identical = the App-side ledger does NOT treat as replay. A retry with a fresh timestamp will hit application-level uniqueness (UNIQUE on `prototype_workspace_id`) and return `409 PROTOTYPE_DECISION_ALREADY_DECIDED`.

**Recommended NoonWeb retry pattern**: cache the original `{ body, timestamp, signature }` on the first send. If you need to retry (network error, 5xx), resend the EXACT same bytes. Do NOT re-sign with a fresh timestamp on retries within the ±5min window.

### 6.8 Error responses

| HTTP | Code | Trigger | NoonWeb UX |
|---|---|---|---|
| `400` | `(validation)` | Body not JSON or schema violation | Generic transient error. Log payload + requestId. Bug in NoonWeb code — do NOT retry. |
| `400` | `PROTOTYPE_DECISION_INVALID_DECISION` | `decision` field is not exactly `'accepted'` or `'rejected'` after Zod parse | Bug in NoonWeb code. Surface internally; do NOT retry. |
| `401` | `WEBSITE_WEBHOOK_AUTH_FAILED` | Missing/invalid signature, stale timestamp, missing secret | Generic "service temporarily unavailable" UX. Log loudly with requestId. |
| `404` | `PROTOTYPE_DECISION_TOKEN_NOT_FOUND` | Token does not resolve to any workspace | "Este link no es válido." Terminal. |
| `409` | `PROTOTYPE_DECISION_IDENTIFIER_MISMATCH` | Token resolved to workspace A but payload `prototype_workspace_id` is B | Stale render cache. Re-fetch via GET §2, then re-attempt POST with fresh workspace UUID. |
| `409` | `PROTOTYPE_DECISION_ALREADY_DECIDED` | Workspace already has a decision row (conflicting decision OR not a bit-identical replay) | Re-fetch via GET §2 to show current decision state (`'accepted'` or `'rejected'` banner). Show the truth, not an error. |
| `410` | `PROTOTYPE_DECISION_TOKEN_EXPIRED` | Token's workspace was superseded (V2+ exists) | "Este prototipo fue actualizado, pedile al vendedor el nuevo link." Terminal. |
| `410` | `PROTOTYPE_DECISION_LEAD_DELETED` | Parent lead was hard-deleted | "Este prototipo ya no está disponible." Terminal. |
| `429` | `(rate limit)` | >120 req/min from sender (namespace `prototype-decision`, **independent counter from the GET's 60/min**) | Generic transient error. Do NOT retry within the same minute. |
| `500` | `PROTOTYPE_DECISION_PERSIST_FAILED` | DB error during INSERT or cross-validation | Generic transient error. MAY retry once with backoff (1-5s) using the EXACT same signed bytes — transport-level idempotency catches replay. |

All error responses share the common shape `{ error: string, code: string, requestId: string }` per cross-repo doc §8.

### 6.9 Idempotency model (read carefully)

**Transport-level only.** App-side rejects payload-level idempotency mechanisms (no `Idempotency-Key` header, no UUID dedup in body — per ADR-023 D1).

The contract:
- Bit-identical replay (same `bodyText` + same `timestamp` + same `signature`) → returns the original response with `200 idempotent: true`.
- ANY byte difference in `bodyText` or different timestamp → treated as a NEW request. If a decision row already exists for the workspace, you'll get `409 PROTOTYPE_DECISION_ALREADY_DECIDED`.

**Application-level uniqueness**: `prototype_decisions` table has UNIQUE on `prototype_workspace_id` — one terminal decision per workspace. Regenerate to V2 creates a NEW workspace with a new token; the new workspace's decision row is independent (V1 and V2 do not share the uniqueness constraint).

### 6.10 Token lifecycle (parallel to §5.6 of cross-repo doc)

Same state-driven rules as the GET — no calendar TTL:

- **V1 token alive** while V1 is current artifact.
- **Regenerate to V2** → V1's `share_token_superseded_at` set; V1 POST returns `410 PROTOTYPE_DECISION_TOKEN_EXPIRED`.
- **Accept is terminal** — second POST against the same workspace returns `409 PROTOTYPE_DECISION_ALREADY_DECIDED` (modulo bit-identical replay).
- **Reject does NOT auto-invalidate** — same URL viewable until seller regenerates V2 (the client could change their mind and request regen via the seller, but until V2 ships the rejected V1 is still readable). Per ADR-025 D2 the iteration cap is **lifetime** (default 3), so rejected workspaces count toward the cap.
- **Hard-delete lead** → `410 PROTOTYPE_DECISION_LEAD_DELETED` defensively.

### 6.11 Side-effect on accept — Maxwell draft fire-and-forget

When `decision === 'accepted'` and HTTP 201 returned:

1. App synchronously persists `prototype_decisions` row + marks ledger row processed + returns 201 to NoonWeb.
2. App fires-and-forgets a background task: Maxwell drafts a `lead_proposals` row with `title`, `body`, `project_type`, `complexity` populated. The `seller_fees` row is NOT created at this point (per ADR-013 + ADR-023 D9; seller picks fee in a follow-up UI).
3. App notifies seller via `user_notifications`.

If Maxwell draft fails App-side:
- Decision row stays (correct — client did accept).
- Structured log `prototype.decision.accepted.draft_creation_failed` fires App-side.
- Seller notification escalates to "accepted but draft pending — create manually".
- No automatic retry; operator escalation is the explicit fallback.

**NoonWeb sees no difference between successful and failed background draft.** The 201 response is the same. `draftPropuestaQueued` indicates the task was enqueued, not whether it succeeded. NoonWeb-side UX is `decision === 'accepted'`-only; the draft outcome is invisible cross-repo.

### 6.12 Retry semantics (NoonWeb-side guidance)

Same rules as the other inbound entries:

- `2xx` → success; do not retry.
- `4xx` → terminal failure; do NOT retry. Surface error per §6.8 code mapping.
- `5xx` or network error → MAY retry with exponential backoff. Bit-identical replay returns `200 idempotent: true`. Recommended cap: 3 attempts with 1s / 5s / 30s backoff.

**If you retry**: use the EXACT bytes from the first attempt (cached `bodyText` + `timestamp` + `signature`). Do NOT re-sign with a fresh timestamp — that would defeat transport-level idempotency.

---

## 7. Coordination notes

- **Pull pattern B.2 materialized.** ADR-023 D8's deferred render-read endpoint declaration is **discharged** by ADR-024 (GET §2-§4). The accept/reject decision write path is firmed by ADR-023 + cross-repo §5 + ADR-025 (POST §6). Both surfaces are frozen; NoonWeb-dev can build against them without further App-side coordination.
- **NoonWeb-dev can start NOW on the full route.** No App-side code precondition. The contracts are the artifacts that unblock both sides.
- **App-side handler implementations are independent iterations.**
  - **GET handler** (`app/api/integrations/website/prototype-signed-read/[token]/route.ts` + handler module + sanitization allowlist): not specced yet, future App-side iteration.
  - **POST handler** (`app/api/integrations/website/prototype-decision/route.ts` + handler in `lib/server/website-integration.ts` + `prototype_decisions` migration + Maxwell-draft fire-and-forget helper): B+C iteration, **Architecture done 2026-05-25** (ADR-025 firmed), Backend pending — App-side estimate ~2-3 days when operator schedules.
  - NoonWeb does NOT need to wait for either to start its own iteration — both sides can build in parallel against the firmed contracts using mocks.
- **Bilateral smoke test required before NoonWeb production deploy.** Sequence (recommended): App ships POST handler first (faster — Architecture done) → smoke POST flow with curl → App ships GET handler → smoke GET flow → NoonWeb deploys route → end-to-end bilateral smoke with both endpoints. Verify each error code surfaces with the expected wire shape.
- **Cross-repo §16 change control applies.** Any deviation from §5 or §6 wire shape requires bilateral PRs in both repos (App: `docs/integrations/cross-repo-webhook-v1.md`; Web: matching path). Do not silently diverge.
- **App-internal Architecture decisions (ADR-025) do NOT affect the NoonWeb wire contract.** ADR-025 D1 (replay via FK join), D2 (lifetime cap on Gate B), D3 (B+C bundling) are App-side handler implementation choices. NoonWeb-facing contract per §5 is unchanged. The only NoonWeb-observable consequence: per D2, regenerate to V2 counts the V1 attempt toward `max_iterations_per_lead` (default 3) — a seller hitting the cap will see `ITERATION_CAP_REACHED` on the workspace creation path (App-internal `request_lead_prototype` RPC), NOT on the POST `prototype-decision` (the cap is enforced on regenerate, not on the decision itself).
- **Acknowledgment requested.** Please acknowledge receipt of this handoff and your intent to build against §5 + §6 as written. The App-side PRs (G22 + B+C) may land before your acknowledgment (no App-side code is in those same iterations on G22 side; B+C is Backend pending), but acknowledgment is required **before** your D-slice render+decision iteration starts so we can catch any drift early.

---

## 8. Open question — NoonWeb-side route path

The NoonWeb-side render route is `/maxwell/prototipo/[token]` per project memory `project_maxwell_chat_lead_creation_flow.md` (Q1 open question on the App-side at lock time). If NoonWeb-dev decides on a different final path (e.g., `/p/[token]`, `/prototipo/[token]`, etc.), please confirm with operator and update the project memory. The App-side GET endpoint URL is independent of the NoonWeb-side render route — only the token value matters at the wire level.

---

## 9. References

### GET render contract sources
- **ADR-024** — `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md` — full rationale + 7 decisions D1-D7 for the GET endpoint.
- **Spec G22** — `specs/fase-3-g22-signed-read-spec.md` — Analysis output, scope boundary, Q-arch resolution targets.
- **Cross-repo doc §6** — `docs/integrations/cross-repo-webhook-v1.md` §6 "Inbound read endpoint — `prototype-signed-read` (Web → App, GET)" — the wire-level extension §2-§4 of this handoff compact.

### POST decision contract sources
- **ADR-023** — `docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md` — full rationale + 9 decisions D1-D9 for the POST endpoint (wire contract firmed 2026-05-23).
- **ADR-025** — `docs/adrs/ADR-025-prototype-decision-impl-architecture-firmups.md` — Architecture firm-ups added 2026-05-25 for the App-side B+C implementation iteration: D1 replay-via-FK-join, D2 lifetime cap semantics for Gate B, D3 bundling decision. NoonWeb-facing wire contract unchanged.
- **Spec B+C** — `specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md` — App-side implementation spec (Architecture-amended 2026-05-25). NoonWeb does NOT consume this directly — it documents the App-side handler internals only.
- **Cross-repo doc §5** — `docs/integrations/cross-repo-webhook-v1.md` §5 "Inbound webhook — `prototype-decision` (Web → App)" — the wire-level entry §6 of this handoff compacts.

### Shared / context
- **ADR-010** — `docs/adrs/ADR-010-client-portal-lives-in-noonweb.md` — anchors why no client-authenticated path lives in App and both endpoints are server-to-server.
- **ADR-013** — `docs/adrs/ADR-013-seller-fee-additive-pricing.md` — anchors why the post-accept Maxwell draft (§6.11) creates a `lead_proposals` row but NOT a `seller_fees` row (seller picks fee in a follow-up UI).
- **ADR-016** — `docs/adrs/ADR-016-transport-level-webhook-ledger-pattern.md` — the ledger pattern for the POST endpoint's transport-level idempotency. (GET endpoint declines this ledger by design per ADR-024 D1.)
- **Project memory** — `project_maxwell_chat_lead_creation_flow.md` — the 4 operator-locked decisions L-1..L-4 inherited verbatim by ADR-023 + ADR-024 + ADR-025.

---

## 10. Contact

Questions, deviations, or blockers → operator (Pedro). Please mention ADR-024 (for GET) + ADR-023/ADR-025 (for POST) + this handoff in any cross-repo communication so the App-side context is loaded quickly.
