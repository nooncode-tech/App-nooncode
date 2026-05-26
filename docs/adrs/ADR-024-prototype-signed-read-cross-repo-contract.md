# ADR-024: Prototype signed-read cross-repo wire contract — symmetric inbound read entry for Pull B.2 render

**Status:** Accepted (amended 2026-05-26 — see §Amendments + §Closure notes at end)
**Date:** 2026-05-25
**Amended:** 2026-05-26 (A1 — lead-context source column mapping correction; see §Amendments)
**Closure notes:** 2026-05-26 (CN-1 — D7 `stale-while-revalidate=60` stripped by Vercel CDN in `private` responses, divergence accepted as-is; see §Closure notes)
**Deciders:** Pedro (Engineering owner), system-architecture
**Supersedes:** None
**Discharges:** ADR-023 D8 (deferred render-read endpoint declaration)
**Related:**
- ADR-010 (client portal lives in NoonWeb — App is operator-only; the signed-read endpoint is server-to-server, not client-authenticated)
- ADR-013 (seller-fee additive pricing — anchors the seller-fee egress strip invariant for D4)
- ADR-016 (transport-level webhook ledger pattern — explicitly **declined by design** for this surface; rationale captured in D1)
- ADR-023 (prototype-decision cross-repo contract — D3 lifecycle / D8 defer-and-discharge; this ADR is the symmetric read entry to ADR-023's write entry)
- `docs/integrations/cross-repo-webhook-v1.md` (the doc this ADR extends with a new inbound-read subsection — Docs materializes in the next turn)
- `specs/fase-3-g22-signed-read-spec.md` (Analysis output; the spec this ADR resolves)
- Project memory `project_maxwell_chat_lead_creation_flow.md` (4 operator-locked decisions L-1..L-4 inherited verbatim)

---

## Context

The Maxwell chat lead-creation flow locks Pull pattern B.2 (project memory L-2, ADR-023 L-2): when a client opens the NoonWeb route `/maxwell/prototipo/[token]`, NoonWeb's server fetches prototipo data from App at render time over signed HTTPS. App is the single system of record; NoonWeb is the render layer. ADR-023 firmed the **write** side of this loop (`POST /api/integrations/website/prototype-decision`) and explicitly **deferred** the **read** side to a future Architecture iteration (D8). That iteration is this one.

The cross-repo wire contract `docs/integrations/cross-repo-webhook-v1.md` currently defines three inbound writes (`inbound-proposal`, `payment-confirmed`, `prototype-decision`) and one outbound write (`proposal-review-decision`). None of them carry render-fetch semantics; all are POST. NoonWeb cannot render `/maxwell/prototipo/[token]` without a firmed read contract; the App-side handler iteration cannot start without a firmed shape; both sides risk drift if either builds against an assumed contract.

Analysis (`specs/fase-3-g22-signed-read-spec.md`, 2026-05-25) bounded the iteration to **contract-only**: produce ADR-024 + extend the cross-repo doc with a symmetric inbound-read entry. No code lands. No env vars are added. No migration runs. The deliverable is the protocol freeze that unblocks two downstream parallel build streams (App-side handler + NoonWeb-side render).

Seven questions surface as architecturally load-bearing:

- **Q-arch-1** — Auth model: signed-token-only, HMAC-envelope-only, or combined? Plus URL transport shape (path / query / header).
- **Q-arch-2** — Lifecycle response mapping: which HTTP status code + error code does each workspace state produce? How does post-accept and post-reject map?
- **Q-arch-3** — Response payload shape: what is client-visible; what is stripped before egress?
- **Q-arch-4** — Sanitization layer location: materialize `lib/security/project-isolation.ts` now, or ad-hoc inline allowlist?
- **Q-arch-5** — Cross-repo doc home: extend `cross-repo-webhook-v1.md` or create `cross-repo-read-v1.md`?
- **Q-arch-6** — Rate-limit posture: inherit §8 defaults (120/min IP) or override (tighter / looser, combined identity)?
- **Q-arch-7** — Cache strategy: `no-store`, `private, max-age=30, swr=60`, or `public, max-age=300`?

Four operator decisions from project memory enter this ADR as **immutable inputs** that frame the wire contract — they are not relitigated here:

- **L-1.** Client decides on prototipo, not propuesta.
- **L-2.** Pull pattern B.2: NoonWeb fetches prototipo data from App at render time; App is system of record. **This ADR is the wire materialization of L-2's read path.**
- **L-3.** Option β: on client accept, Maxwell drafts a propuesta with the four inferable fields; the seller chooses the seller fee explicitly per ADR-013.
- **L-4.** Dual-gate regenerate control (Gate A credits + Gate B iteration cap).

Two architectural locks from ADR-023 enter this ADR as **immutable inputs**:

- **ADR-023 D3.** State-driven token invalidation (no calendar TTL; supersede via `share_token_superseded_at`; hard-delete cascade). The read endpoint MUST honor the same invalidation semantics already firmed for the write endpoint.
- **ADR-023 D8.** The defer-and-discharge contract: this iteration discharges the deferred render-read declaration.

---

## Decision

The new inbound read entry **`prototype-signed-read`** is defined symmetrically with the existing three inbound write entries on auth, error envelope, rate limit, change control, and ledger-decline (the latter being a structural difference between reads and writes, made explicit in D1). The full wire-level shape lands in `docs/integrations/cross-repo-webhook-v1.md` as a new subsection §6 "Inbound read endpoints" (Docs materializes in the next turn per Q-arch-5 resolution); this section defines the architectural decisions that bound it.

### D1 — Auth model: HMAC envelope only over opaque-token URL path; transport ledger declined by design

**Resolves Q-arch-1.** Endpoint shape: `GET /api/integrations/website/prototype-signed-read/[token]`.

#### Options considered

| Option | Description | Tradeoff |
|---|---|---|
| (a) Signed-token-only | Share token is a self-verifying signed JWT (`HMAC-JWT { workspace_id, issued_at }`); no cross-repo HMAC envelope. NoonWeb sends only the token in the URL. | **Pro:** stateless cryptographic verification, no DB round trip on auth. **Con:** ADR-023 D3 supersede semantics require a DB lookup anyway (a superseded token still verifies cryptographically; the supersede check must layer on top of JWT verify); JWT verify provides no net savings. **Con:** asymmetric with the POST entries which all use HMAC envelope — bifurcates the cross-repo security model. |
| (b) HMAC-envelope-only | Opaque App-issued token in the URL path; request authenticated only by `x-noon-timestamp` + `x-noon-signature` over the URL path. No extra signed-token layer. | **Pro:** symmetric with the existing POST inbound entries (same secret, same headers, same verifier, same ±5min clock-skew window). **Pro:** zero new cryptographic primitives to learn or audit. **Pro:** secret rotation procedure §2.4 covers this entry unchanged. **Con:** token possession alone is insufficient to forge a request — but token possession is **also** insufficient under (c) combined, so this is not a real loss. |
| (c) Combined | Opaque token (App-issued, lookup-resolved) AND HMAC envelope. Defense-in-depth. | **Pro:** closes both the URL-leak vector (token alone cannot pose as NoonWeb without the secret) and the secret-leak vector (secret alone cannot guess a valid token). **Con:** the token IS already in the URL `/maxwell/prototipo/[token]` rendered by NoonWeb's edge — token leakage is partial **by design** (browser history, referrer headers). The HMAC envelope is the actual cross-repo authentication; the token is the workspace identifier, not a credential. **Con:** the spec proposes (c) as default to "defend against URL leakage", but the defense is illusory — without the HMAC envelope an attacker holding a leaked token gets nothing (App rejects unsigned requests with `401`); with the HMAC envelope an attacker holding a leaked token still gets nothing (no secret, no signature). The "combined" framing implies the token contributes to authentication. It does not — the token is the lookup key. Architecture renames this honestly. |

#### Decision — override spec default from (c) to (b)

**Selected: (b) HMAC-envelope-only.** The cross-repo authentication boundary is the HMAC envelope, period. The token is the workspace identifier (the equivalent of `external_proposal_id` in the POST `inbound-proposal` payload — an opaque resolution key, not an authentication factor). Framing the design as "combined auth" inflates the security model with a layer that contributes nothing once the HMAC envelope is correct; framing it as "HMAC envelope over an opaque identifier in the URL" matches the actual surface and matches the existing POST entries exactly.

The override of spec default (c) → (b) is justified by:

1. **Symmetry with POST entries is a value, not a cost.** All three POST inbound entries authenticate by HMAC envelope over the raw body. A `decision_id` in the body is the workspace identifier; nobody calls that "combined auth". Same for the GET: the token in the URL path is the workspace identifier.
2. **The "combined" framing implies defense layers that don't compose.** Without the HMAC envelope, the token grants nothing (App rejects `401`). Without the token, the HMAC envelope authenticates a malformed request that fails at the `404 NOT_FOUND` or at validation. The two pieces are not defense-in-depth — they are auth + lookup, and labeling them otherwise is confusing.
3. **Audit / security review is simpler with one named auth layer.** Future Architecture reviewing this endpoint reads "same auth as the POST entries"; the read entry inherits §2's cryptographic guarantees verbatim.

#### URL shape (final)

`GET /api/integrations/website/prototype-signed-read/[token]`

Alternative URL shapes considered:

| URL shape | Disposition |
|---|---|
| `GET /api/integrations/website/prototype-signed-read/[token]` | **Selected.** Path-parametric token. RESTful for "fetch the read view of resource identified by token". Cacheability is URL-based (Q-arch-7), works naturally with the `private` directive. The handler name `prototype-signed-read` (not `prototype-render`) is honest about what the endpoint does: "give me the signed read view of the prototipo". |
| `GET /api/integrations/website/prototype-render/[token]` | Rejected. "Render" is a NoonWeb-side concern; App does not render anything. The name misleads operators into thinking App composes HTML. |
| `POST /api/integrations/website/prototype-read` (token in body) | Rejected. Q-arch-7 (cache strategy) needs URL-based cacheability so NoonWeb's edge can honor `Cache-Control: private, max-age=30, stale-while-revalidate=60`. POST is uncacheable by default; carrying the token in the body would force `no-store` and waste the cache budget D7 picks. |

#### HMAC signing input for GET (zero-body convention)

For a GET request the body is empty. The signing input is:

```
${unix_timestamp_seconds}.
```

That is, `timestamp` followed by the literal `.` followed by the empty string. This is the exact natural extension of §2 of the existing doc (`${timestamp}.${bodyText}` with `bodyText = ""`). No restriction in §2 of the existing doc forbids empty `bodyText`, and `verifyWebsiteWebhookSignature` in `lib/server/website-webhook-auth.ts` consumes the body text as-read from the request — for a GET the read returns `""`. Docs adds a one-line note in §2 to make the empty-body case explicit so a future implementer does not introduce a serialization shim that breaks symmetry.

Sub-detail: the URL path itself is **not** part of the signing input. The handler validates the URL path is the expected route (Next.js router does this implicitly via the file-system route), and validates the token by lookup against `prototype_workspaces.share_token`. Including the URL in the signing input would diverge from §2 (which signs only timestamp + body), force NoonWeb's signer to canonicalize URLs (trailing slash? lowercased host?), and break symmetry. Rejected.

Secret: reuse `NOON_WEBSITE_WEBHOOK_SECRET` exactly as the POST entries do. **No new env var** — confirmed in spec §11. Spec L118 stated "no infra change" as a closure obligation; this decision honors it. Escalation E-2 NOT triggered.

Headers: reuse `x-noon-timestamp` (Unix seconds integer string) and `x-noon-signature` (`sha256=<lowercase-hex>`). Clock-skew window: ±5 minutes (`MAX_CLOCK_SKEW_SECONDS = 300`), unchanged.

#### Transport ledger: declined by design

The `website_webhook_events` ledger pattern from ADR-016 (POST entries) is **not** applied to this endpoint. Reasoning:

1. **GET is HTTP-idempotent by construction.** Replaying the same GET twice produces the same effect (zero side effects) regardless of whether the receiver dedups. The ledger's job (transport-level dedup of replays) has nothing to defend on a read.
2. **No state mutation = no replay-protection requirement.** The ADR-016 ledger guards against a forged-but-novel replay slipping past application-layer idempotency and double-writing. A read writes nothing; there is no double-write to defend against.
3. **Performance.** Logging every render hit to a ledger table would scale traffic into the table at the rate of (concurrent clients × refresh rate) per workspace — an unbounded read multiplier. The ledger's design (`INSERT … ON CONFLICT DO NOTHING`) is fine for writes (low rate) but poor for high-frequency reads.
4. **Observability.** Each request still produces a structured log line (`logger.info('website.prototype_signed_read.served', { token_hash, workspace_id, decision_status, server_time })` — the handler iteration writes this). Vercel runtime logs are the audit trail; the ledger is unnecessary.

The decline-by-design is **explicit, not an oversight.** Future Architecture seeing this endpoint without a ledger row in `website_webhook_events` should reference this ADR §D1 and not panic. If a future iteration adds analytics on render-fetch (e.g., "how many times did the client open this prototipo before deciding"), that analytics layer lives in NoonWeb (which already sees the render hit) or in a dedicated read-analytics table, not in the transport ledger.

### D2 — Lifecycle response mapping: 200 with decision-state flags, 410 on supersede, complete code matrix

**Resolves Q-arch-2.** The endpoint maps the workspace lifecycle (ADR-023 D3) to HTTP responses as follows.

#### Options considered for the post-accept / post-reject branches

| Branch | Option | Tradeoff |
|---|---|---|
| Post-accept | 200 with `decision.status='accepted'` flag | **Pro:** preserves audit visibility for the client ("here's what you accepted"). **Pro:** matches operator-driven URL-share pattern (the URL is durable; the state evolves). **Pro:** NoonWeb renders read-only with "Ya aceptaste este prototipo" banner. **Con:** consumes some response payload bytes to convey the state. |
| Post-accept | 404 NOT_FOUND | **Pro:** terminal, simple. **Con:** loses audit visibility. **Con:** breaks the "you can see what you accepted" UX. |
| Post-accept | 410 GONE | **Pro:** semantically "this resource transitioned to a state that prevents the read". **Con:** clashes with the supersede 410 — same code, different cause; NoonWeb has to switch on the error subcode anyway, at which point a 200-with-flag is cleaner. |
| Post-reject (not superseded) | 200 with `decision.status='rejected'` + `decision.notes` | **Pro:** ADR-023 D3 says "Reject does NOT invalidate the token by itself"; matching read response is 200. **Pro:** lets NoonWeb render "Lo rechazaste — esperá la próxima versión" with the client's own notes echoed back. **Con:** notes are client-provided text; sanitization (D4) MUST verify no operator field leaks. |
| Post-reject | 404 / 410 | Rejected for the same reason post-accept rejection is rejected. ADR-023 D3 explicitly preserves read-visibility post-reject; flipping read to error contradicts the locked semantics. |

#### Decision

**Adopt 200-with-flags for both post-accept and post-reject (not superseded); 410 strictly for token-superseded and lead-deleted.** The complete code matrix:

| HTTP | Code | Trigger | Body shape |
|---|---|---|---|
| `200` | (no error code) | Token resolves to a workspace; not superseded; workspace renderable; decision may be pending / accepted / rejected — the `decision.status` field conveys which | Success payload per D3 |
| `401` | `WEBSITE_WEBHOOK_AUTH_FAILED` | HMAC missing/invalid, stale timestamp (±5min violated), missing secret. **Reused verbatim from §7 of cross-repo-webhook-v1.md** | `{ error, code, requestId }` per §7 |
| `400` | (validation) | Token path-param is empty or contains forbidden characters (e.g., non-URL-safe bytes). Belt-and-suspenders — Next.js routing normally rejects this | Common §7 |
| `404` | `PROTOTYPE_READ_TOKEN_NOT_FOUND` | Token does not match any `prototype_workspaces.share_token` row | Common §7 |
| `410` | `PROTOTYPE_READ_TOKEN_SUPERSEDED` | Token resolves to a workspace with `share_token_superseded_at IS NOT NULL` (regenerated to V2+). NoonWeb renders "Este prototipo fue actualizado, pedile al vendedor el nuevo link." | Common §7 |
| `410` | `PROTOTYPE_READ_LEAD_DELETED` | Parent lead has been hard-deleted. Rare (FK cascade should remove the workspace too); defensive code path. NoonWeb renders "Este prototipo ya no está disponible." | Common §7 |
| `429` | (rate limit) | Combined-key rate limit exceeded — see D6. **Reused from §8** | Common §7 |
| `500` | `PROTOTYPE_READ_INTERNAL_FAILED` | DB error during workspace lookup, decision lookup, or sanitization. Naming: `INTERNAL_FAILED` (not `PERSIST_FAILED`) — no persistence happens on a read; "persist" would mislead | Common §7 |

#### Error code naming

Namespace prefix: **`PROTOTYPE_READ_*`** (not `PROTOTYPE_SIGNED_READ_*`). Rationale: the `_SIGNED_` infix in the spec proposal is redundant — every cross-repo endpoint in this doc is signed; "signed" describes the auth model, not the endpoint identity. The endpoint identity is "read of a prototipo". The spec acknowledges this option L178; Architecture confirms.

#### Edge case clarifications

- **Token resolves to a workspace that is in a transient inconsistent state** (e.g., workspace exists but `prototype_decisions` row is mid-INSERT). Not possible under D3's locked model: the GET reads two independent rows, neither of which is mid-flight from a transactional standpoint (the POST decision-write commits atomically). If the GET races a POST and reads the workspace before the decision, the response is `decision.status='pending'`; the next GET sees `decision.status='accepted'` or `'rejected'`. The client may see a momentary "still pending" state right after submitting their decision; the cache window (D7) is 30s so the stale window is bounded.
- **Workspace exists but has no `generated_html` / `deployed_url` yet** (prototipo build in progress, edge case if NoonWeb-dev calls the read before the build completes). The response shape MUST tolerate `null` for those fields per D3. NoonWeb-side UX renders "preparando tu prototipo" until both `generated_html` and `deployed_url` are non-null. If operator finds this gap surface-relevant, a future `workspace.build_status` enum may be added (out of scope; ADR-023 D3 does not lock build-status semantics).
- **Tombstone case** — `share_token_superseded_at` is non-null AND `lead_id` cascade-deleted. The handler checks lead-deleted first (the more terminal state) and returns `410 PROTOTYPE_READ_LEAD_DELETED`. Order is deterministic so two requests racing the cascade don't see different codes.

#### Symmetry with ADR-023 D5 codes

| ADR-023 (write) code | ADR-024 (read) code | Symmetric? |
|---|---|---|
| `PROTOTYPE_DECISION_TOKEN_NOT_FOUND` (404) | `PROTOTYPE_READ_TOKEN_NOT_FOUND` (404) | Yes |
| `PROTOTYPE_DECISION_TOKEN_EXPIRED` (410) | `PROTOTYPE_READ_TOKEN_SUPERSEDED` (410) | Renamed (TOKEN_EXPIRED → TOKEN_SUPERSEDED): the write's "expired" framing implies time-based expiry which ADR-023 D3 explicitly rejected. "Superseded" matches the state-driven model. **Architecture flags ADR-023 D5 for naming alignment in a future docs amendment; not blocking this ADR.** |
| `PROTOTYPE_DECISION_LEAD_DELETED` (410) | `PROTOTYPE_READ_LEAD_DELETED` (410) | Yes |
| `PROTOTYPE_DECISION_INVALID_DECISION` (400) | n/a on read (no decision field on GET) | n/a |
| `PROTOTYPE_DECISION_IDENTIFIER_MISMATCH` (409) | n/a on read (no `prototype_workspace_id` payload field — only token in URL) | n/a |
| `PROTOTYPE_DECISION_ALREADY_DECIDED` (409) | n/a on read (read serves the decision state in the response; "already decided" is not an error on a read — it's a `decision.status` value) | n/a |
| `PROTOTYPE_DECISION_PERSIST_FAILED` (500) | `PROTOTYPE_READ_INTERNAL_FAILED` (500) | Renamed (PERSIST → INTERNAL) for naming honesty on a read |

The naming-alignment note for `TOKEN_EXPIRED` → `TOKEN_SUPERSEDED` is recorded here for traceability. Docs may choose to amend `cross-repo-webhook-v1.md` §5.5 and ADR-023 D5 in the same Docs turn that materializes this ADR, OR defer the rename to a future iteration. Architecture's preference: defer. The `TOKEN_EXPIRED` code is already in the live spec; renaming creates a contract change for NoonWeb-dev who has already read ADR-023; the rename is cosmetic, not semantic.

#### Escalation gate

ADR-023 D3 covers every state the GET endpoint needs to render. No edge case requires an ADR-023 amendment. **Escalation E-4 NOT triggered.**

### D3 — Response payload shape: Choice C (prototipo content + minimal lead context + decision state) with explicit wire schema

**Resolves Q-arch-3.** The success response body for a 200 OK is:

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

#### Field-by-field rationale and tradeoffs

| Field | Type | Source | Why included | Why this shape |
|---|---|---|---|---|
| `data.workspace.id` | uuid | `prototype_workspaces.id` | NoonWeb needs the workspace UUID to attach to the subsequent `prototype-decision` POST (ADR-023 §5.2 `prototype_workspace_id` payload field). Without it, NoonWeb would have to derive it client-side or store it from a separate fetch. | Flat string UUID. No nesting. |
| `data.workspace.version` | integer ≥ 1 | derived from iteration history (count of preceding workspaces under the same lead, +1) | NoonWeb may render "Prototipo V2" badge. Operator-relevant for UX clarity. Operator inferred this is the right place from L-4 (iteration cap) tracking. | Integer 1, 2, 3, …; matches ADR-023 D7 `max_iterations_per_lead` semantics. |
| `data.workspace.generatedAt` | ISO 8601 | `prototype_workspaces.created_at` | NoonWeb may render "Generado el dd/mm". Audit visibility. | ISO 8601 string (UTC), not Unix epoch — symmetric with `decision.decidedAt` and other timestamps in the cross-repo doc. |
| `data.leadContext.businessName` | string | `leads.company` (with `leads.name` fallback) — see §Amendments A1 | NoonWeb renders "Prototipo para `{businessName}`" as the page header. The lead context is **minimal by design** — only fields the client themselves provided during the Maxwell chat. | Required (non-null); handler coalesces `company ?? name` so the field is always populated. |
| `data.leadContext.projectTypeLabel` | string | derived from `leads.maxwell_snapshot ->> 'project_type'` (with default `'Sitio Web'` fallback) — see §Amendments A1 | NoonWeb renders a human-readable project type ("Landing Page", "Web App", "E-commerce"). Reduces NoonWeb's coupling to App's internal source field shape. | Required string. **The raw `maxwell_snapshot.project_type` is NOT in the response** — only the derived label is exposed. This decouples the cross-repo contract from App's internal Maxwell snapshot evolution. |
| `data.prototype.deployedUrl` | string \| null | `prototype_workspaces.deployed_url` (whatever column B-slice declares) | The primary render path: NoonWeb embeds an iframe pointing at the Vercel-hosted prototipo URL. | Nullable for the "build in progress" state. |
| `data.prototype.generatedHtml` | string \| null | `prototype_workspaces.generated_html` (or equivalent) | Fallback render path for when no iframe URL is available (e.g., static HTML prototipo). NoonWeb decides which path to render based on which field is non-null. | Nullable. **Both may be null simultaneously** during the "build in progress" state; NoonWeb-side UX renders "preparando tu prototipo". |
| `data.decision.status` | `'pending' \| 'accepted' \| 'rejected'` | derived from `prototype_decisions` row presence + `decision` column | The state-machine value NoonWeb uses to switch the page's mode (accept/reject CTA vs accepted-banner vs rejected-banner). | Closed enum of three values. **`pending` is the default when no `prototype_decisions` row exists for the workspace.** |
| `data.decision.notes` | string \| null | `prototype_decisions.notes` | Echoed back to the client so they see their own rejection rationale ("Lo rechazaste — dijiste: '...'"). | Nullable. Non-null only when `status === 'rejected'` AND the client provided notes. **For `status === 'accepted'` or `status === 'pending'`, notes is null** — even if a notes column happens to exist with a value, the sanitizer (D4) returns null. (No leak of internal annotations.) |
| `data.decision.decidedAt` | ISO 8601 \| null | `prototype_decisions.decided_at` | Audit visibility ("aceptaste el dd/mm a las hh:mm"). | Nullable. Null when `status === 'pending'`. |
| `data.lifecycle.tokenSuperseded` | boolean | derived: `share_token_superseded_at IS NOT NULL` | **Always `false` on a 200 response by definition** (a superseded token returns 410 per D2). Included for forward-compatibility — if a future iteration loosens the 410 to a 200-with-flag (e.g., "still show the superseded prototipo with a read-only banner"), the field is already there. | Boolean. NoonWeb may treat this field as a defensive assertion. |
| `data.lifecycle.iterationNumber` | integer ≥ 1 | same as `workspace.version` for now | Duplicates `workspace.version` intentionally — the `lifecycle.*` cluster is the home of iteration-related context for forward iterations (Gate B exposure, "you've done X/Y iterations"). Architecture chose to expose it from day one so future Gate B UX on NoonWeb (a future iteration) doesn't require a contract change. | Integer. Currently always equals `workspace.version`; the two diverge if/when build-failed-retry counters get added (out of scope). |
| `data.serverTime` | ISO 8601 | `now()` at handler time | NoonWeb may use it for client-side clock comparison (e.g., display "generado hace 2 min" using server time as anchor rather than relying on the client's clock). | ISO 8601 string. **Always present on success responses.** |
| `requestId` | string | per §7 common envelope | Trace correlation with App logs. | Per §7. |

#### Explicitly NOT in the response (sanitization strip-list)

The following App-internal fields MUST NEVER appear in the response. The sanitizer (D4) enforces this as a positive allowlist — if a field is not on the allowlist above, it does not pass to egress.

- `lead_proposals.*` (all of it — no propuesta data on the prototipo surface)
- `seller_fees.*` (per ADR-013 — seller fee is the seller's commercial decision; client never sees it on the prototipo surface)
- `user_wallets.*`, `wallet_ledger_entries.*` (credit balance is operator-internal)
- `user_profiles.*` (seller / PM identity is operator-internal)
- `leads.notes`, `leads.score`, `leads.next_follow_up_at`, `leads.lead_origin` (CRM-internal fields)
- `leads.assigned_to`, `leads.created_by` (operator identity)
- `prototype_workspaces.created_by`, `prototype_workspaces.updated_at` (audit metadata)
- `prototype_credit_settings.*` (admin config)
- `prototype_decisions.client_user_agent` (forensic — client-side already knows their own UA)
- `prototype_decisions.webhook_event_id` (transport-ledger forensic linkage)
- The raw `leads.maxwell_snapshot ->> 'project_type'` value (only the derived label is exposed per `leadContext.projectTypeLabel`; see §Amendments A1)
- `prototype_workspaces.share_token` (must NEVER echo back the token in the response body — defense against log scraping)
- `share_token_superseded_at` (the timestamp itself; only the boolean `tokenSuperseded` derived from it is exposed)

#### Choice C as the natural superset — why not A or B

- **Choice A (content only).** Rejected: NoonWeb cannot render any header text ("Prototipo para ___") without lead context, and cannot render the post-decision UI without decision state. Stripping context further than Choice B accomplishes nothing — the client already sees their business name on every other NoonWeb surface; pretending it's sensitive on this surface is theater.
- **Choice B (content + lead context, no decision state).** Rejected: NoonWeb would need a separate fetch to know if the workspace is post-decision, doubling the cross-repo coordination and roundtrip count. Decision state IS the load-bearing UX switch.
- **Choice C (content + lead context + decision state).** Selected. Single fetch, all rendering inputs in one response, sanitizer enforces the strip-list.

#### `metadata` extension envelope explicitly omitted

The POST `inbound-proposal` and `payment-confirmed` entries carry a `metadata: <record, optional>` envelope for arbitrary key-value forwarding. The GET read endpoint **does NOT** include such an envelope in the response. Rationale: outbound payloads from App MUST be deterministic and sanitized; an open-ended `metadata` map invites accidental field leakage (a future iteration adds a metadata field on `prototype_workspaces`, someone forgets to add it to the strip-list, operator data leaks). The closed shape above is auditable; an open `metadata` envelope is not.

If a future iteration legitimately needs to extend the response with new fields, the cross-repo doc cascades via §15 change control — same procedure as any breaking change.

### D4 — Sanitization: ad-hoc inline allowlist with E-1 trigger; formal module deferred

**Resolves Q-arch-4.** The App-side handler iteration implements sanitization as an inline allowlist over the D3 shape. The formal module `lib/security/project-isolation.ts` + `sanitizeForClient()` (roadmap §9.1 Phase 2 v3) is **NOT materialized in the handler iteration**.

#### Options considered

| Option | Tradeoff |
|---|---|
| (a) Materialize `lib/security/project-isolation.ts` now | **Pro:** establishes the formal sanitization pattern early; second client-visible read endpoint inherits for free. **Con:** premature abstraction with one consumer; design driven by one endpoint's shape may not generalize correctly to "client views approved propuesta" or "client views project status". **Con:** materialization is itself a 2-4h iteration (module design + tests); coupling it to the handler iteration inflates the handler's scope past the 4-6h envelope the C-slice handler iteration targets. |
| (b) Ad-hoc inline allowlist in the handler | **Pro:** ships the secure surface in the smallest scope. **Pro:** the D3 shape is a flat 13-field allowlist — well within 2h of careful coding. **Pro:** establishes the strip-list pattern as a starting point for the formal module's eventual design. **Con:** if a second read endpoint lands without the formal module, the strip-list pattern duplicates. |

#### Decision

**Selected: (b) ad-hoc inline allowlist** with the following constraints carried into the handler iteration's spec:

1. The handler module MUST implement the strip-list as a **positive allowlist** (whitelist of fields that pass to the response), not a blacklist. New fields added to upstream tables default to "not in response" unless explicitly added.
2. The handler MUST construct the response object **field-by-field from named source values**, never via spread / shallow-copy of database rows. Pattern: `const response = { workspace: { id: workspaceRow.id, version: workspaceRow.version, generatedAt: workspaceRow.created_at.toISOString() }, leadContext: { ... }, ... }`. **No `{ ...workspaceRow }` or `Object.assign` shortcuts.**
3. The handler MUST include unit tests asserting that for a fixture lead/workspace/decision row decorated with operator-internal fields (`notes`, `score`, `lead_origin`, `assigned_to`, etc.), **none of those fields appear anywhere in the JSON response** when serialized. The test serializes the response and grep-asserts the operator-field names are absent.
4. The handler MUST log a structured warning (`logger.warn('prototype.signed_read.allowlist.unexpected_field', { fieldName })`) if the source row contains a field not on the allowlist AND not on the explicit-strip list. This is the canary for future schema additions that bypass the allowlist by accident.

#### E-1 escalation trigger (inherited from spec)

If the handler iteration finds the sanitization logic requires **more than ~2h** of expansion (e.g., nested object traversal, recursive depth checks, DTO mapping for shapes not anticipated here), the handler iteration MUST:

1. Pause and surface E-1 explicitly.
2. Open a separate iteration to materialize `lib/security/project-isolation.ts` with the formal `sanitizeForClient()` pattern.
3. Resume the handler iteration after the formal module ships, consuming it.

The 2h threshold is based on the D3 shape being a flat 13-field allowlist — sanitizing it should be ~30-60min of focused code + tests. Anything materially over 2h indicates the design has expanded past the D3 envelope, which is itself a scope drift that warrants pausing.

**E-1 NOT triggered by this ADR**; the trigger is carried forward to the handler iteration's spec.

### D5 — Cross-repo doc home: extend `cross-repo-webhook-v1.md`; new §6 "Inbound read endpoints"

**Resolves Q-arch-5.** The cross-repo wire contract for this new entry lands by **extending** `docs/integrations/cross-repo-webhook-v1.md` with a new §6 subsection, NOT by creating a sibling `cross-repo-read-v1.md`.

#### Options considered

| Option | Tradeoff |
|---|---|
| (a) Extend `cross-repo-webhook-v1.md` with §6 "Inbound read endpoints" | **Pro:** single source of truth for the cross-repo wire contract; NoonWeb-dev already reads this doc. **Pro:** §1 ASCII diagram extends naturally with a GET arrow. **Pro:** §2 (auth), §7 (error envelope), §8 (rate limit), §15 (change control) are reused verbatim with zero duplication. **Con:** the doc filename `cross-repo-webhook-v1.md` is slightly misnomer — the new entry is a GET, not a "webhook" in the strict push sense. **Mitigation:** the doc's §1 header already frames it as "signed HTTPS" (which covers both directions); the "webhook" filename is historical and changing it is a separate refactor. |
| (b) Create `cross-repo-read-v1.md` as a sibling doc | **Pro:** strictly clean filename. **Pro:** isolates the read semantics from the write semantics. **Con:** duplicates §2 (auth) or forces "see other doc §2" cross-references that fragment review. **Con:** NoonWeb-dev now reads two docs, and any future Architecture maintaining cross-repo state must keep two docs in sync. **Con:** the §15 change control rule would need duplication or extension. |
| (c) Create `cross-repo-shared-v1.md` for shared sections + per-direction docs | **Pro:** cleanest information architecture. **Con:** three docs to maintain. **Con:** the iteration was scoped contract-only docs-as-design 3-4h; introducing a three-doc reorganization is a doc-reorg iteration, not a contract iteration. Spec § escalation E-6: "doc home decision requires `cross-repo-shared-v1.md` third doc → re-scope with operator". This is exactly the E-6 case; rejecting (c) avoids the escalation. |

#### Decision

**Selected: (a) extend `cross-repo-webhook-v1.md` with new §6 "Inbound read endpoints"** subsection cluster. Docs is responsible (in the next turn) for:

1. Renaming the existing §3/§4/§5 cluster (`inbound-proposal`, `payment-confirmed`, `prototype-decision`) under a header "Inbound write endpoints" if needed for symmetry, OR leaving the section numbering as-is and adding §6 below §5 with the inbound-read subsection (which renumbers existing §6/§7/§8 → §7/§8/§9).

Architecture's preference: **add §6 below §5 and renumber forward**. Existing §6 (`proposal-review-decision` outbound) becomes §7; §7 (common error shape) becomes §8; §8 (rate limit) becomes §9; etc. ADR-023 cites §5.5, §5.7, §5.8, §5.9 — those references stay valid because §5 is unchanged. Cross-references in ADR-016 to §8.2 (transport-level idempotency) become §9.2 — Docs runs a search and updates.

2. Updating §1 ASCII diagram to show the new GET arrow:

```
GET /api/integrations/website/    ◄──────────────  prototype-signed-read (NoonWeb fetches at render)
     prototype-signed-read/[token]
```

3. Adding a one-line note in §2.1 making the empty-body signing-input convention explicit (per D1).

4. Updating §11 (env vars reference) to confirm no new env var (already the case; this is a "confirm" line).

5. Updating §14 (open issues) to add the implementation-tracking rows for App-side handler iteration + NoonWeb-side render iteration (parallel to the existing `prototype-decision` C-slice tracking row).

Renumbering risk: ADR-016 references `cross-repo-webhook-v1.md §8.2` (transport ledger). With the renumber, §8.2 → §9.2. Docs runs `grep -r "§8\.\|§7\.\|§8\b\|§7\b\|§8 \|§7 " docs/` and updates references. Risk R6 in the spec is the formal acknowledgment of this cascade.

#### Escalation gate

E-6 ("doc home decision requires `cross-repo-shared-v1.md` third doc → re-scope with operator") is **NOT triggered.** Architecture chose the lowest-friction option that preserves single-source-of-truth.

### D6 — Rate limit: tighter override, 60 req/min, combined `${token}:${remoteIp}` identity

**Resolves Q-arch-6.** The endpoint is rate-limited via `assertRateLimit` (`lib/server/api/rate-limit.ts`) with:

- **Namespace:** `'prototype-signed-read'` (new, independent counter per endpoint per §8 convention).
- **Limit:** 60 requests per minute.
- **Window:** 60_000 ms (1 minute).
- **Identity key:** `${token}:${remoteIp}` where `token` is the URL path parameter and `remoteIp` is computed by `getClientIp(request)` (first hop of `x-forwarded-for`).

#### Options considered

| Option | Tradeoff |
|---|---|
| (a) Inherit §8 default — 120 req/min, IP-only identity | **Pro:** symmetric with POST entries; one less knob to tune. **Con:** the POST entries are write-volume bounded (one decision per workspace, ever); the GET is read-volume which scales with client engagement (refresh, edge revalidate). 120/min/IP is too loose for the asymmetric read pattern. **Con:** IP-only identity does not bound abuse against a single token — an attacker scraping prototipo content under one leaked token from many IPs would not hit the limit. |
| (b) Tighter — 60 req/min, combined `${token}:${remoteIp}` | **Pro:** legitimate render is 1-2 req/session/token; 60/min/(token,IP) is generous for legitimate traffic. **Pro:** the combined key bounds abuse against a single token from a single IP (the realistic abuse vector). **Pro:** `lib/server/api/rate-limit.ts` supports arbitrary string keys via `options.key` — confirmed by reading the file (line 16, the `key?: string \| null` option). | **Con:** an attacker rotating IPs can still exceed the per-token limit aggregated. Mitigation: at pilot scale this is not a realistic threat; if it becomes one, a per-token-only key (no IP) can be added in a future tightening iteration. |
| (c) Looser — 240 req/min, IP-only | **Pro:** anticipates NoonWeb edge-cache reduces actual App hit rate; even a misbehaving retry loop is fine at 240/min. **Con:** trades safety for headroom that is not needed at pilot scale. |

#### Decision

**Selected: (b) tighter override, 60 req/min, combined `${token}:${remoteIp}`**, with the following implementation details:

- The handler computes `identity = `${token}:${remoteIp}`` and passes it via `options.key` to `assertRateLimit`.
- If `remoteIp` is `'unknown'` (no `x-forwarded-for` and no `x-real-ip`), the key degrades to `${token}:unknown` — all unknown-IP requests share a bucket per token. This is a slight defensive bonus (NoonWeb-side IP detection failure does not silently disable rate limiting).
- The 60 req/min budget is intentionally well above legitimate traffic (1-2 req/session/token) so legitimate stale-while-revalidate cycles (D7) do not trip the limit. A normal client session generates at most a handful of requests per minute even under aggressive refresh.

#### Symmetry note for cross-repo doc

The §9 (renumbered from §8) rate-limit section currently states "120 req/min per namespace, by remote IP". The §6 "Inbound read endpoints" subsection extending this doc declares the override locally: "the `prototype-signed-read` endpoint overrides the §9 defaults with 60 req/min and combined `(token, IP)` identity key". This is consistent with the §9 statement "Namespace `prototype-signed-read`: independent counter per endpoint" — independent counters allow per-namespace tuning.

### D7 — Cache strategy: `private, max-age=30, stale-while-revalidate=60`

**Resolves Q-arch-7.** The 200 success response includes:

```
Cache-Control: private, max-age=30, stale-while-revalidate=60
```

Non-200 responses (4xx / 5xx) include `Cache-Control: no-store` to prevent caching of error states (especially the 410 `TOKEN_SUPERSEDED` which would otherwise pin a stale supersede flag in NoonWeb's edge).

#### Options considered

| Option | Tradeoff |
|---|---|
| (a) `no-store` | **Pro:** strongest freshness guarantee — every render hits App, every supersede is visible on the next render. **Con:** every NoonWeb render is a round-trip; latency adds 100-300ms cross-repo per page load. **Con:** wastes the NoonWeb edge-cache capability for zero correctness benefit beyond the 30-90s window. |
| (b) `private, max-age=30, stale-while-revalidate=60` | **Pro:** 30s fresh window covers a typical client refresh cycle; stale-while-revalidate=60 means the absolute worst-case visible window for a supersede is 90s. **Pro:** `private` (not `public`) keeps the response out of any shared CDN tier — token-bound content stays per-tenant. **Pro:** the write-side (POST `prototype-decision`) is authoritative — a stale GET showing "you can still accept" results in a 410 on the POST, which NoonWeb already handles per ADR-023 §5.5. Eventual consistency is correctness-safe. | **Con:** the 90s window may surprise a future operator; documented explicitly. |
| (c) `public, max-age=300` | **Pro:** maximum latency reduction. **Con:** 5min stale window is too long given the supersede semantics (operator regenerates V2; client sees V1 for 5min). **Con:** `public` allows shared CDN tiers to cache; token-bound content leaking across tenants is a security risk that is hard to evaluate. **Rejected.** |

#### Decision

**Selected: (b) `private, max-age=30, stale-while-revalidate=60`**:

- `private` — token-bound + lead-context content stays in per-tenant edge buckets, never in a shared layer.
- `max-age=30` — 30s of fresh cache; covers normal scroll / click delays.
- `stale-while-revalidate=60` — if the cache entry is stale (30-90s old), serve the stale version and revalidate in background. Total upper-bound window for supersede visibility: 90s.

App does **NOT cache the response internally** — the handler is server-rendered at request time. The cache header is advisory for NoonWeb's edge / browser. Internal caching is rejected because (a) it would require an in-process cache layer that does not exist in App today (scope inflation), and (b) the 90s edge window is already sufficient.

#### Eventual-consistency risk (R5 from spec)

R5 acknowledges that during the 30-90s stale window, a client may see "you can still accept" UI on a prototipo that has been superseded. If the client clicks accept during the stale window, the POST `prototype-decision` returns `410 PROTOTYPE_DECISION_TOKEN_EXPIRED` (ADR-023 §5.5). NoonWeb's UX is responsible for handling that 410 gracefully ("Este prototipo fue actualizado, pedile el nuevo link al vendedor"). This is the natural cost of any cache layer; the write-side guard is the authoritative correctness check.

If operator finds 90s too long in practice, Q-arch-7 can flip to (a) `no-store` in a follow-up iteration. The flip is a one-line code change in the handler and a one-line update in the cross-repo doc.

---

## Architectural truth (capture for project memory and future sessions)

To remove ambiguity:

| Concept | Where it lives | Authority |
|---|---|---|
| Prototype share token issuance | App, on workspace creation / regenerate (B-slice adds `prototype_workspaces.share_token`) | App |
| Prototype render content | App (Pull B.2: NoonWeb fetches at render time via this signed-read endpoint) | App is system of record |
| Client decision URL | NoonWeb `/maxwell/prototipo/[token]` (D-slice, NoonWeb-side build) | NoonWeb |
| Client decision render-fetch (server-to-server, signed) | App `GET /api/integrations/website/prototype-signed-read/[token]` | **App (this ADR)** |
| Client decision capture (server-to-server, signed) | App `POST /api/integrations/website/prototype-decision` | App (ADR-023) |
| Decision persistence | `public.prototype_decisions` (B-slice migration per ADR-023 D4) | App |
| Sanitization layer (allowlist on this surface) | Inline in the handler module for now; formal `lib/security/project-isolation.ts` deferred per D4 | App |
| Rate-limit budget for this endpoint | Namespace `prototype-signed-read`, 60 req/min, combined `${token}:${ip}` | App |
| Cache directive served by this endpoint | `private, max-age=30, stale-while-revalidate=60` on 200; `no-store` on 4xx/5xx | App |
| Transport ledger participation | **Declined by design** — GET is HTTP-idempotent; ADR-016 applies to writes only | App |

The four operator decisions (L-1 to L-4), ADR-023 D3 / D8, and the seven Q-arch decisions resolved here (D1 to D7) are immutable inputs to all subsequent slices. Any iteration that proposes to alter them must open a new ADR that supersedes this one.

---

## Consequences

### Positive

- **NoonWeb-dev unblocks for `/maxwell/prototipo/[token]` render-fetch.** The wire contract for the GET endpoint is firmed; NoonWeb's render layer can build against the D3 response shape, the D2 error code matrix, and the D1 auth model without further coordination.
- **App-side handler iteration unblocks.** Endpoint URL (D1), HMAC reuse (D1), response shape (D3), error codes (D2), rate-limit posture (D6), cache headers (D7), and sanitization pattern (D4) are all specified. The handler iteration writes code only — no architectural decisions remain.
- **Cross-repo doc remains the single source of truth.** Q-arch-5 / D5 keeps `cross-repo-webhook-v1.md` as the canonical doc, extended with a new §6 subsection — no fragmentation.
- **Token invalidation semantics are coherent across read and write.** ADR-023 D3 firms the lifecycle; this ADR's D2 maps the same lifecycle states to read-appropriate HTTP responses. NoonWeb's UX state machine maps cleanly to the union of both endpoints' responses.
- **Symmetric security posture.** Same HMAC, same secret, same headers, same clock-skew window as the POST entries. Operators reading the auth model for any inbound entry (read or write) see the same shape.

### Negative

- **30-90s eventual-consistency window on supersede.** During cache TTL + SWR, a client may render a superseded prototipo's "you can still accept" UI. Mitigated by the write-side 410 (ADR-023 §5.5 + this ADR D2); NoonWeb-side UX handles the 410 gracefully. Recorded as R5 in the spec; acceptable cost.
- **Cross-repo doc renumber cascade.** D5 / R6: extending `cross-repo-webhook-v1.md` with §6 renumbers §6→§7, §7→§8, etc. ADR-016 references §8.2 → become §9.2. Docs runs a search-and-replace in the next turn; mechanical, low-risk.
- **`PROTOTYPE_READ_TOKEN_SUPERSEDED` vs ADR-023's `PROTOTYPE_DECISION_TOKEN_EXPIRED` naming divergence.** Read uses "superseded" (matches state-driven model); write uses "expired" (legacy from ADR-023 D5 which Architecture flags but does not rename in this ADR). Two error codes for the "same state" but on opposite directions. NoonWeb-dev maps both to the same UX copy. Future docs amendment may rename for alignment; deferred.
- **No transport ledger for reads.** Future Architecture investigating the absence of a `website_webhook_events` row for a GET render-fetch must reference this ADR D1 ("declined by design") to understand why. Risk: a future maintainer assumes "all signed inbound endpoints sit behind the ledger per ADR-016" and adds ledger participation without reading this ADR. Mitigation: this ADR's D1 explicitly notes the decline; ADR-016 is updated by Docs in a future amendment (out of scope here) to enumerate the exception.

### Neutral

- **`metadata` extension envelope omitted from the response.** Closed shape; future extensions go through §15 change control. This is a deliberate tradeoff between openness and auditability; chose auditability per the sanitization principle in the spec.
- **No new env var.** `NOON_WEBSITE_WEBHOOK_SECRET` covers this endpoint. No infra change. **Escalation E-2 NOT triggered.**
- **Build iterations are independent and may run in any order.** App-side handler iteration + NoonWeb-side render iteration share only the contract; neither blocks the other. Operator chooses sequencing.

### Required follow-up work declared by this ADR

| Slice | Owner | Description |
|---|---|---|
| Docs materialization (next turn) | system-docs | Extend `docs/integrations/cross-repo-webhook-v1.md` with §6 "Inbound read endpoints" (per D5). Update §1 ASCII diagram. Update §2.1 with empty-body signing-input note. Update §11 (env vars — confirm no new). Update §14 (open issues — add tracking rows for App-side handler + NoonWeb-side render). Run renumber cascade on §6/§7/§8/§9 cross-references. Update `docs/context/project.context.core.md` with the firmed contract entry (no plan-IDs / R-codes per memory rule). Sync `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §16 row 9 (G22). Write close-out handoff. |
| App-side handler iteration | future Architecture → Backend → Testing | Endpoint route `app/api/integrations/website/prototype-signed-read/[token]/route.ts`. Handler module reusing `lib/server/website-webhook-auth.ts` (HMAC verify) + `lib/server/api/rate-limit.ts` (with D6 combined key) + new sanitization allowlist per D4. Tests per the spec § "Recommended Testing Methodology" (5+ lifecycle unit tests + sanitization integration test + HMAC failure-mode integration test + cache-header presence integration test). Soft dependency on B-slice (`prototype_workspaces.share_token` column). |
| NoonWeb-side render iteration | NoonWeb-dev | Route `/maxwell/prototipo/[token]` rendering the GET fetch per D3, switching mode based on `decision.status`, rendering the D2 error states (404 / 410 / 401 / 429 / 500), embedding the iframe at `data.prototype.deployedUrl`, calling the POST `prototype-decision` (ADR-023) on accept/reject CTAs. Out of this repo entirely. |
| Sanitization formal module (E-1 conditional) | conditional — only if E-1 triggers during the handler iteration | Materialize `lib/security/project-isolation.ts` + `sanitizeForClient()` if D4's ad-hoc allowlist exceeds 2h of expansion. The handler iteration's spec inherits the E-1 trigger from the G22 spec. |
| `cross-repo-webhook-v1.md` filename refactor (deferred) | future Docs | The "webhook" framing in the filename no longer matches the broader scope (now covers GET reads too). A future doc-reorg iteration may rename to `cross-repo-https-v1.md` or similar. Not blocking; recorded for traceability. |
| `PROTOTYPE_DECISION_TOKEN_EXPIRED` → `PROTOTYPE_DECISION_TOKEN_SUPERSEDED` rename (deferred) | future Docs / ADR-023 amendment | Naming alignment with this ADR's `PROTOTYPE_READ_TOKEN_SUPERSEDED`. Cosmetic; deferred to avoid cascading a contract change to NoonWeb-dev who has already read ADR-023. |

### Active risks created or updated

- **Active risk (R1 from spec, accepted):** NoonWeb-dev acknowledgment of the firmed contract is uncommitted. Mitigation: the Docs PR explicitly tags NoonWeb-dev for sign-off per §15.
- **Active risk (R5 from spec, accepted):** 30-90s cache stale window on supersede. Write-side 410 is the authoritative guard. Documented in D7.
- **Active risk (new, low):** future maintainer adds ledger participation by reflex without reading D1. Mitigation: D1 is explicit; an ADR-016 amendment in a future docs iteration may enumerate the read-endpoint exception.

### Re-evaluation triggers

This ADR must be revisited when:

1. **A second client-facing read endpoint is proposed** (e.g., "client views approved propuesta on NoonWeb" or "client views project status"). The D4 sanitization pattern should be lifted into the formal `lib/security/project-isolation.ts` module at that point; E-1 trigger fires retroactively or proactively.
2. **The 30-90s cache stale window proves operationally too long.** Q-arch-7 flips to `no-store` (D7 alternative a) in a follow-up iteration.
3. **The 60 req/min/(token,IP) rate limit produces false-positive 429s** on legitimate NoonWeb edge-revalidate traffic. D6 tightens or loosens based on observed metrics.
4. **The empty-body HMAC signing convention causes implementation drift** on NoonWeb-side or App-side. Make it more explicit in §2 of the cross-repo doc with a worked example.
5. **A future read endpoint introduces a payload (not just URL path)** — D1's empty-body convention generalizes to `${timestamp}.${bodyText}` which already handles non-empty bodies.

### Reactivation / migration triggers

- If v2 of the cross-repo contract introduces a schema version header (§10), the `prototype-signed-read` entry migrates with the other entries; no special handling.
- If the endpoint is deprecated (e.g., NoonWeb moves to a different render-fetch model), the endpoint becomes a `410 Gone` redirect and a Docs amendment records the deprecation.

---

## Alternatives considered

### Alternative A — Signed JWT token (no HMAC envelope)

Rejected per D1. The DB lookup for supersede check is unavoidable; JWT verify provides no net savings. Bifurcates the cross-repo auth model with the POST entries.

### Alternative B — POST with token in body (instead of GET with token in URL path)

Rejected per D1. Forces `Cache-Control: no-store` (POST is uncacheable), wasting the cache budget D7 picks. The URL-based shape is naturally cacheable per D7.

### Alternative C — `Cache-Control: public, max-age=300`

Rejected per D7. 5min stale window is too long; `public` allows shared CDN caching of token-bound content (security risk hard to evaluate at pilot scale).

### Alternative D — Transport ledger participation (per ADR-016)

Rejected per D1. GET is HTTP-idempotent; the ledger's job has nothing to defend on a read. Logging every render hit would inflate the table. Vercel structured logs are the audit trail.

### Alternative E — Choice A (prototipo content only, no lead context, no decision state)

Rejected per D3. NoonWeb cannot render page header without lead context; cannot switch UI mode without decision state. Forces multiple fetches or breaks UX.

### Alternative F — Open `metadata` envelope in response (matching POST entries' input metadata)

Rejected per D3. Open-ended maps invite future field leakage; closed shape is auditable.

### Alternative G — Materialize `lib/security/project-isolation.ts` in the handler iteration

Rejected per D4. Premature abstraction with one consumer. E-1 trigger covers the case where the ad-hoc allowlist proves insufficient.

### Alternative H — Separate `cross-repo-read-v1.md` doc

Rejected per D5. Fragments the source of truth; duplicates §2 / §7 / §8 / §15. NoonWeb-dev would read two docs.

### Alternative I — Inherit §8 rate-limit default (120 req/min, IP-only)

Rejected per D6. IP-only does not bound abuse against a single token; 120/min is too loose for the asymmetric read pattern. Combined `(token, IP)` key at 60/min is more defensive at trivial cost.

---

## Implementation pointers

These are the files a future implementation iteration will touch. **None are touched by this ADR.**

| Path | Action | Owner |
|---|---|---|
| `app/api/integrations/website/prototype-signed-read/[token]/route.ts` | NEW — handler implementing D1/D2/D3/D4/D6/D7 | App-side handler iteration |
| `lib/server/website-integration.ts` (or sibling module) | EXTEND — add `serveWebsitePrototypeSignedRead` helper symmetric to existing `receiveWebsiteInbound*` helpers | App-side handler iteration |
| `lib/server/website-webhook-auth.ts` | NO CHANGE — handler reuses `verifyWebsiteWebhookSignature` as-is | App-side handler iteration |
| `lib/server/api/rate-limit.ts` | NO CHANGE — handler reuses `assertRateLimit` with new namespace + combined key | App-side handler iteration |
| `supabase/migrations/00YY_*.sql` | NO CHANGE on read — the handler READS from `prototype_workspaces` + `prototype_decisions` which B-slice creates; no migration in this read iteration | B-slice (separate iteration) |
| `tests/server/website-prototype-signed-read.test.ts` (or equivalent) | NEW — unit + integration tests per spec § Recommended Testing Methodology | App-side handler iteration |
| `docs/integrations/cross-repo-webhook-v1.md` | EXTEND — new §6 subsection per D5 | Docs (next turn) |
| `docs/context/project.context.core.md` | EXTEND — entry on firmed contract per §Closure obligations | Docs (next turn) |
| `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` | UPDATE — G22 row 9 §16 per memory rule | Docs (next turn) |

---

## Lifecycle

- **Author:** system-architecture (Claude Code session, 2026-05-25), reviewed by Pedro
- **Supersedes:** nothing
- **Superseded by:** nothing
- **Amendments:** A1 (2026-05-26) — see §Amendments
- **Discharges:** ADR-023 D8 (deferred render-read endpoint declaration)

This ADR formalizes the 4 operator-locked decisions (L-1..L-4 from project memory) and the 2 architectural locks inherited from ADR-023 (D3 + D8), then resolves 7 architecturally load-bearing questions (Q-arch-1..Q-arch-7) into a single durable record. The cross-repo wire contract document `docs/integrations/cross-repo-webhook-v1.md` §6 is the wire-level extension that NoonWeb-dev reads against (Docs materializes in the next turn); this ADR is the rationale and decision register that future App-side iterations reference.

---

## Amendments

### A1 (2026-05-26) — Lead-context source column mapping correction

**Context.** During the Analysis phase of iteration `fase-3-g22-prototype-signed-read-handler-impl` (G22 handler implementation), the operator-driven OQ-1 surfaced that two source columns referenced in D3 + cross-repo doc §6.4 do not exist in the actual schema:

- `leads.business_name` — does NOT exist. The `leads` table has `name`, `company`, `notes`, `maxwell_snapshot` (JSONB), etc.
- `leads.project_type` — does NOT exist as a column on `leads`. `project_type` exists only on `lead_proposals` (which is the wrong source — proposals don't exist at prototipo render time, before client decides).

The drift is between the ADR's prose (firmed 2026-05-25) and the schema as it stands at migration 0060. The endpoint has not shipped yet, so no NoonWeb client implementation breaks; the cost of amendment is bounded to docs.

**Decision.** Adopt the mapping verified empirically by Analysis against `lib/server/supabase/database.types.ts`:

| Response field | Original (incorrect) source | Amended source | Handler derivation |
|---|---|---|---|
| `data.leadContext.businessName` | `leads.business_name` | `leads.company` with `leads.name` fallback | `businessName = lead.company ?? lead.name` |
| `data.leadContext.projectTypeLabel` | derived from `leads.project_type` enum | derived from `leads.maxwell_snapshot ->> 'project_type'` with `'Sitio Web'` default | `projectTypeLabel = humanizeLabel(maxwellSnapshot?.project_type ?? 'Sitio Web')` |

**Rationale.**

1. **`leads.company` is the natural source for businessName.** It's the only column on `leads` that semantically maps to "client business / company name". The `leads.name` fallback covers the edge case where the lead was created without explicit company info (Maxwell may infer from chat).
2. **`leads.maxwell_snapshot` is the canonical home for client-provided context at prototipo render time.** Maxwell ingestion populates this JSONB with `business.industry`, `mainPain`, `noonOpportunity`, `prototypeIdea`, `objections`, `speech`, and **`project_type`** (the client's self-described project type, e.g., `'landing'`, `'web_app'`, `'ecommerce'`). The handler humanizes the value into the existing label vocabulary (`'Landing Page'`, `'Web App'`, `'E-commerce'`, etc.) using a small inline map.
3. **`'Sitio Web'` default is a safe fallback** when Maxwell snapshot is malformed or missing the project_type field. NoonWeb renders a generic "Prototipo para `{businessName}` — Sitio Web" header — better than an empty label or a 500.

**Backend constraints (G22 handler iteration):**

- The repository helper `getPrototypeWorkspaceByShareToken` (new, scope of the handler iteration) MUST include `leads.company`, `leads.name`, and `leads.maxwell_snapshot` in its SELECT projection.
- The handler builds the response via the existing field-by-field allowlist pattern (D4) and applies the derivations inline (no new shared helper required; ~10 lines).
- The humanization map (`projectTypeLabel` value transformation) lives inline in the handler. If it grows >5 entries or requires localization, a future iteration may extract it to `lib/maxwell/project-type-labels.ts`. Out of scope for the G22 handler iteration.

**Forbidden by A1:**

- Adding `leads.business_name` or `leads.project_type` columns to the schema as a "make the contract fit" workaround. The contract is what amends; the schema is the source of truth.
- Mapping `businessName` from `leads.maxwell_snapshot ->> 'company'` (the snapshot may carry stale or pre-edit data; `leads.company` is the operator-curated truth).

**Coordination with NoonWeb-dev:**

NoonWeb-dev has not yet acknowledged §6 (per the open issue tracked in `docs/handoffs/2026-05-25-maxwell-chat-cross-repo-contracts-noonweb-handoff.md`). The cross-repo doc §6.4 is updated in the same turn as this amendment; NoonWeb-dev's pending acknowledgment now covers the corrected wire mapping. No additional ceremony required; flag in the same handoff that the contract was amended pre-acknowledgment.

**Where this amendment lives in source:**

- D3 §"Field-by-field rationale and tradeoffs" table (rows for `businessName` + `projectTypeLabel`) edited inline with cross-reference to §Amendments A1.
- §"Explicitly NOT in the response (sanitization strip-list)" line about `leads.project_type` edited to refer to `maxwell_snapshot ->> 'project_type'`.
- `docs/integrations/cross-repo-webhook-v1.md` §6.4 field semantics updated in the same turn.
- Iteration spec `specs/fase-3-g22-prototype-signed-read-handler-impl.md` OQ-1 marked RESOLVED with reference here.

---

## Closure notes

### CN-1 (2026-05-26) — D7 `stale-while-revalidate=60` stripped by Vercel CDN in live `private` responses

**Context.** Smoke A G22 execution (Lista App follow-up, 2026-05-26) fired 8 signed GETs against the deployed handler at `https://nooncode-app-pi.vercel.app/api/integrations/website/prototype-signed-read/[token]`. All scenarios passed functional verification (HTTP statuses, body shapes, error codes, sanitization, idempotency, ledger-decline). One cosmetic divergence surfaced on scenarios 5/6/8 (200 responses).

**Finding.** D7 specifies the byte-exact 200-response header:

```
Cache-Control: private, max-age=30, stale-while-revalidate=60
```

The handler at `lib/server/website-integration.ts::serveWebsitePrototypeSignedRead` sets exactly this string (verified by unit test `tests/server/api/integrations/website/prototype-signed-read.test.ts` AC-9 + 525-test suite green). However, the **live response** from Vercel returns:

```
Cache-Control: private, max-age=30
```

The `stale-while-revalidate=60` directive is **stripped before the client receives the response**.

**Hypothesis (strong, not empirically confirmed).** Vercel CDN normalizes `Cache-Control` headers by stripping `stale-while-revalidate` when the response is marked `private`. Semantically, SWR is a shared-cache (CDN) directive — when a response is `private`, the CDN treats it as "do not cache here at all" and strips SWR which would otherwise be a no-op. The normalization is applied at the CDN edge before the response reaches the client.

The hypothesis is consistent with:
- The handler code provably emits the full string (unit-tested).
- The middleware / route wrapper does not touch the header further (verified by reading `app/api/integrations/website/prototype-signed-read/[token]/route.ts`).
- The Vercel platform is the only intermediary between handler and client.
- Other public Vercel projects report similar SWR-on-private normalization in community threads.

Hypothesis NOT confirmed empirically (would require firing the same request bypassing Vercel CDN, e.g., directly against the function URL — out of smoke scope).

**Decision: accept the divergence as-is. Do NOT amend D7.**

**Rationale:**

1. **Functional impact is bounded and small.** The `max-age=30` window is preserved verbatim. What's lost: the 60s SWR background-revalidation window. Per D7's "Eventual-consistency window" note, the supersede-visibility window narrows from 30-90s to 30s sharp. Cliente revalidates at max-age expiry instead of serving stale-during-revalidation. Slight extra latency on the (rare) cache-miss-during-revalidation path; no data correctness issue.
2. **NoonWeb consumer behavior unchanged for the common case.** The browser (or NoonWeb's edge if it deploys one) sees `private, max-age=30` and caches for 30s. After 30s it makes a fresh request. The SWR optimization is a perf nicety, not a correctness requirement.
3. **No data exposure risk.** `private` is preserved — that's the security-relevant directive. The CDN does NOT share the response across tenants. The lost SWR doesn't widen any blast radius.
4. **Investigation cost is disproportionate.** Confirming the hypothesis empirically (bypass-CDN test) and finding a workaround (e.g., `CDN-Cache-Control` separate header, or removing `private`) would be ~2-4h of investigation + likely require an ADR amendment if the workaround changes semantics. The win is the SWR 60s window — not worth the cost at pilot scale.
5. **D7 prose remains the architecturally intended behavior.** Future migration off Vercel CDN (or Vercel's own normalization policy change) would restore the full directive without code change. Documenting the divergence here preserves the architectural intent + the operational reality.

**Acceptable workarounds (for a future iteration if SWR becomes important):**

- Set `CDN-Cache-Control: public, max-age=30, stale-while-revalidate=60` as a separate header (Vercel-specific CDN directive that doesn't conflict with browser `Cache-Control: private, max-age=30`). Untested.
- Drop `private` and use `public, max-age=30, stale-while-revalidate=60`. **Rejected** — `private` is load-bearing; token-bound responses must NOT enter shared CDN tiers.
- Use the `Vercel-CDN-Cache-Control` header (similar to above, more explicit). Untested.

**Where this note lives in source:**

- This `CN-1` Closure note (here).
- The `docs/handoffs/2026-05-26-smoke-a-g22-signed-read-runbook.md` §9 "Execution report" cross-references this closure note.
- AC-9 of the iteration spec remains "Cache header exactness" by the test contract — the unit test verifies the handler's output value. The handler is correct; the CDN is the divergence point.
