# ADR-016: Transport-level webhook ledger pattern for inbound HMAC webhooks

**Status:** Accepted
**Date:** 2026-05-20
**Deciders:** Architecture (system-architecture skill, B15 iteration)
**Supersedes:** None
**Related:**
- TDR-003 (Stripe webhook event ledger) — the canonical precedent this ADR generalizes.
- `docs/integrations/cross-repo-webhook-v1.md` §8.2, §13 (audit B15 placeholder).
- `specs/fase-2-c-b15-website-webhook-ledger.md` — iteration spec authored alongside this ADR.
- ADR-014 (migration prefix convention).

---

## Context

Two classes of inbound HTTPS webhooks now exist in the App:

1. **Stripe** — single endpoint (`/api/webhooks/stripe`). Sender supplies an event id (`evt_…`) that is unique per event by construction. Transport-level idempotency is enforced via `stripe_webhook_events` (migration 0041 + `lib/server/stripe/webhook-events.ts`) using `event_id` as the PRIMARY KEY.
2. **NoonWeb v1 cross-repo** — two endpoints (`/api/integrations/website/inbound-proposal`, `/api/integrations/website/payment-confirmed`). Sender authenticates with HMAC-SHA256 over `${timestamp}.${bodyText}` (`lib/server/website-webhook-auth.ts`). **No sender-supplied event id.** Today the only idempotency guarantee is at the application layer: lookup by `(external_source, external_session_id|external_proposal_id|external_payment_id)` against `website_inbound_links`.

Audit B15 (`cross-repo-webhook-v1.md` §13, Medium severity) identifies the gap: a replay carrying a forged but never-seen-before external-id triplet would currently pass auth and reach business logic — the inner idempotency layer cannot detect it because there is no row to find by external id.

The Stripe pattern is proven (live since Phase 17A, ~3 weeks of production traffic, zero duplicates observed per ops). The Web v1 pattern needs the same protection but lacks the natural primary key Stripe gets for free. Architecture must decide:

- What identity to use for transport-level dedup when the sender does not supply one.
- Whether to copy Stripe's SELECT-then-INSERT-or-UPDATE shape verbatim or strengthen it with a DB-level UNIQUE.
- Whether to define a generalizable pattern (this ADR) or treat the website ledger as a one-off.

This ADR defines the **transport-level webhook ledger pattern** as the App's canonical answer to inbound-webhook idempotency, applies it to the website v1 inbound endpoints (the B15 iteration scope), and leaves the existing Stripe ledger untouched as a structurally-equivalent specialization.

---

## Decision

### D1 — Pattern: every inbound HMAC webhook gets a transport-level ledger

Every server-side inbound HMAC webhook endpoint in the App SHOULD be backed by a transport-level ledger table that records — at minimum — an idempotency key, status state machine, and operational timestamps for every authenticated request. The ledger sits **after** auth (HMAC + timestamp window) and **before** business-logic invocation. Replays return the same wire-shape response the application-layer idempotency would produce; the ledger is internal defense-in-depth, not a contract surface.

Existing inbound webhooks adopt the pattern as iterations land. The Stripe ledger (migration 0041) already conforms in shape; only its identity key differs (event id vs computed hash).

### D2 — Identity key for HMAC webhooks without sender event ids

When the sender does not supply a unique event id (the NoonWeb v1 case), the ledger row identity is `(endpoint, signature_hash)` where:

- `endpoint` is a short text discriminator naming the inbound route (`inbound-proposal`, `payment-confirmed`).
- `signature_hash = sha256(${timestamp}.${bodyText})` is computed over the **exact byte string the HMAC was verified against**. This is the same input the auth layer fed to `crypto.createHmac` — see `verifyWebsiteWebhookSignature` in `lib/server/website-webhook-auth.ts`. Two requests carrying the same `x-noon-signature` value have the same `signature_hash` and represent the same logical event; two requests carrying different `x-noon-signature` values are different events even if their payload bodies look identical (different timestamps would produce different signatures, which is the desired behavior — a replay attempt with the same body but a refreshed timestamp would have to be the legitimate sender who knows the secret).

Rationale for byte-fidelity (raw `bodyText`) over canonical JSON: the HMAC already verifies that the receiver sees the same bytes the sender signed. Computing the hash over canonical JSON would re-introduce the exact serialization-drift risk the wire contract §11 explicitly warns against ("Trailing whitespace, key ordering, and float formatting all matter"). The auth layer already enforces byte fidelity; the ledger inherits it for free.

For Stripe (sender-supplied event id), identity stays `event_id` as PRIMARY KEY. This ADR does not change Stripe.

### D3 — Race-condition resolution: DB-level UNIQUE + `INSERT … ON CONFLICT DO NOTHING`

For HMAC webhooks the ledger MUST carry a UNIQUE constraint on the identity tuple (`(endpoint, signature_hash)` for D2) and the helper MUST use Postgres-native `INSERT … ON CONFLICT … DO NOTHING RETURNING …` to claim the row. This is stronger than the SELECT-then-INSERT-or-UPDATE shape the Stripe helper uses because:

- Stripe gets uniqueness from the PRIMARY KEY (`event_id`). Two concurrent inserts of the same `event_id` collide on PK violation — the helper catches the error and falls back to the existing-row branch. This is functionally equivalent to `ON CONFLICT DO NOTHING` but uses the PK as the conflict target.
- The website ledger has no natural single-column primary key. Without `ON CONFLICT` semantics, two concurrent requests with identical signatures could both pass a SELECT-then-INSERT sequence and produce duplicate rows or duplicate business-logic invocations under load.

The helper claims the row in one round trip; if the row was already claimed (concurrent or replay), it then SELECTs the existing row to read its status. Two round trips on replay is acceptable; one on first write is the hot path.

### D4 — Insertion order: AFTER auth, BEFORE business logic

The ledger is consulted **only after** `verifyWebsiteWebhookSignature` (which covers both HMAC verify and `±5min` timestamp window) returns successfully. Adversarial traffic rejected at the auth layer is **not** logged to the ledger. Its evidence stays in Vercel `warn` logs only. This minimizes table writes for adversarial traffic and keeps the ledger small.

The ledger is consulted **before** `receiveWebsiteInbound*` is invoked. On replay (existing row with `status='processed'`), the route handler returns the existing wire-shape response (see D6) and does NOT invoke business logic a second time.

### D5 — Single table with `endpoint` discriminator, not two tables

Both NoonWeb v1 inbound endpoints share the auth surface, the rate-limit shape, and the wire-contract response shape. One table `website_webhook_events` with an `endpoint` column (constrained to `'inbound-proposal' | 'payment-confirmed'`) is the right grain: one helper module, one migration, one set of indexes, one operator query surface. Each endpoint's UNIQUE constraint scope is `(endpoint, signature_hash)` so the two endpoints' signature spaces are independent (a hypothetical signature collision across endpoints — vanishingly unlikely with SHA-256 — is still not a replay because the discriminator differs).

### D6 — Replay response shape: re-query and return full wire shape

On replay detection (row claim returns existing row), the route handler:

1. Reads the existing row's `external_session_id`, `external_proposal_id`, `external_payment_id`, `link_id` (populated by the previous successful run — see D7).
2. If `link_id` is present, SELECTs the matching `website_inbound_links` row and returns the same response shape the app-level idempotency path returns (the `idempotent: true` branch in `receiveWebsiteInboundProposal` / `receiveWebsitePaymentConfirmed`).
3. If `link_id` is NULL (parse failed on the original run, or the original run was marked `failed` before completing), the helper returns a `'replay'` signal and the route handler re-runs the parse + business logic (because the original run did not produce a usable link row). The ledger row's `attempt_count` is incremented; the existing row is re-marked `processing`.

This preserves the wire-contract response shape on the success-then-replay path (the dominant case) and gives a clean retry semantics on the failed-then-retry path (still defended against true bit-for-bit replay because the row remains, but allowing the operator to retry by re-sending).

NoonWeb sees no difference between an app-level-idempotent reply (existing `website_inbound_links` row + same external ids) and a ledger-level-idempotent reply (existing ledger row + recovered ids). The wire contract `cross-repo-webhook-v1.md` §3.4 / §4.5 is preserved exactly.

### D7 — Ledger column set: transport metadata + nullable business-id columns populated post-parse

Final column set for `website_webhook_events`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | Surrogate primary key — not used for dedup, used for FK targeting from logs |
| `endpoint` | `text not null check (endpoint in ('inbound-proposal','payment-confirmed'))` | Discriminator (D5) |
| `signature_hash` | `text not null` | `sha256(${timestamp}.${bodyText})` lowercase hex (D2) |
| `payload_hash` | `text not null` | `sha256(bodyText)` lowercase hex — diagnostic only, not part of the UNIQUE. Useful for "is the body identical?" forensic queries |
| `signature_header` | `text not null` | The raw `x-noon-signature` header value as received (`sha256=…`). Operational evidence |
| `request_id` | `text not null` | Server-generated request id via `getRequestId(request)` — joins ledger row to Vercel logs |
| `received_at` | `timestamptz not null default now()` | When auth passed and the ledger row was claimed |
| `processed_at` | `timestamptz` | When `markWebsiteWebhookEventProcessed` ran |
| `failed_at` | `timestamptz` | When `markWebsiteWebhookEventFailed` ran |
| `status` | `text not null default 'processing' check (status in ('processing','processed','failed'))` | State machine. No `'replay_detected'` separate status — replays do not change the existing row's terminal status; they only bump `attempt_count` |
| `attempt_count` | `integer not null default 1 check (attempt_count > 0)` | Bumped each time a request with the same `(endpoint, signature_hash)` arrives |
| `last_error` | `text` | First 1000 chars of the last `Error.message` when status flipped to `failed` |
| `external_session_id` | `text` | NULL on row claim. Populated post-parse by the route handler via a follow-up update |
| `external_proposal_id` | `text` | Ditto |
| `external_payment_id` | `text` | Ditto (NULL for inbound-proposal endpoint; the column carries 0 information for that endpoint by design) |
| `link_id` | `uuid` | NULL until business logic produces a `website_inbound_links` row id. Populated by `markWebsiteWebhookEventProcessed` |

**Indexes:**
- `unique index website_webhook_events_endpoint_signature_hash_key on (endpoint, signature_hash)` — the idempotency key. Drives `INSERT … ON CONFLICT DO NOTHING`.
- `index website_webhook_events_received_at_idx on (received_at desc)` — operator query (recent events).
- `index website_webhook_events_status_idx on (status)` — operator query (failed events).
- `index website_webhook_events_endpoint_idx on (endpoint)` — operator query (per-endpoint slice).
- `index website_webhook_events_external_session_id_idx on (external_session_id) where external_session_id is not null` — operator query (find ledger trace for a known session).

**No FK constraint on `link_id` → `website_inbound_links.id`.** Forensic intent: keep ledger durable even if a future `website_inbound_links` row is deleted. The column documents intent; the join is best-effort.

**No raw payload storage (`payload_bytes`).** Hashes are sufficient for replay detection and forensics. Storing the raw body would re-introduce the PII surface the existing `website_inbound_links.inbound_payload` JSONB column already covers — duplicating it here would compound the GDPR retention burden for no operational benefit.

### D8 — Retention policy: documented, not enforced this iteration

The ledger ships with no `DELETE` job. Documented policy: rows older than **180 days** MAY be archived/deleted by a future cron iteration (B15-bis). The 180-day window is chosen to comfortably exceed Stripe's 180-day refund window — i.e., the maximum legitimate replay-detection horizon for any payment-confirmed event we'd realistically inspect. Documented in code comments on the migration and on the helper module. The cron itself is **explicitly deferred** to a separate iteration.

The Stripe ledger has no documented policy today (TDR-003 "Known gaps"). When B15-bis lands a cleanup cron, it covers both tables.

### D9 — Feature flag: `WEBSITE_WEBHOOK_LEDGER_ENABLED` env var, default ON, kill-switch only

The implementation reads `process.env.WEBSITE_WEBHOOK_LEDGER_ENABLED` once at module load. If the value is exactly `'false'` (case-insensitive), the route handlers skip the ledger entirely and behave exactly as today. Any other value (including absent) means enabled.

Rationale for env-driven (not flag-table-driven): the ledger is on the request hot path; a DB round-trip per request just to read a flag would defeat the kill-switch's purpose (the failure mode the kill-switch protects against would itself be a DB problem). Env-driven is one Vercel env-var flip + redeploy (~60s rollback path) and zero runtime overhead.

Default ON because the iteration ships the ledger and expects it to be active. The env var exists for emergency rollback; under normal operations it is never set.

### D10 — `database.types.ts` regen path: prefer clean regen, fall back to override block

Per Operating rules and `lib/server/supabase/database.types.ts` baseline, three tables (`seller_fees`, `prototype_workspaces`, `lead_proposals`) carry inline-but-undocumented additions. system-infra attempts a clean regen first (`mcp__supabase__generate_typescript_types` if MCP auth is fresh; otherwise `npx supabase gen types typescript --project-id pdotsdahsrnnsoroxbfe`). If regen succeeds and the existing additions survive (i.e., the live schema actually carries them and the previous additions were forward-looking patches now reflected upstream), commit the regen as-is. If regen drops any existing additions, system-infra **adds the new ledger type via an override block** and queues "clean regen + reconcile override blocks" as a follow-up. Either path is documented in the iteration handoff.

This ADR does not enforce one path because the choice depends on MCP auth state at apply time, which is operational, not architectural.

---

## Rationale

### Why generalize as a pattern instead of one-offing B15

Three reasons:

1. **The shape is structurally identical between Stripe and Web.** Same lifecycle calls, same status enum, same RLS policy shape, same operator query surface. Treating B15 as one-off would force the next inbound-webhook integration to re-derive the same decisions.
2. **The differences are minimal and well-bounded.** Sender event id vs computed hash is one column; PK vs UNIQUE constraint is one DDL line. Documenting "transport-level ledger" as a pattern with two specializations (sender-id-as-PK, hash-as-UNIQUE) makes future inbound webhooks (e.g., a hypothetical OAuth provider, Stripe Connect events, a Calendly integration) cheap.
3. **The wire-contract clause `cross-repo-webhook-v1.md` §13 references this as audit B15.** A pattern-level ADR closes B15 at the conceptual level (not just the implementation level) and lets future audits reference the pattern directly.

### Why `(endpoint, signature_hash)` and not `(endpoint, signature_hash, payload_hash)`

`signature_hash` is computed over `${timestamp}.${bodyText}`. The HMAC has already verified the receiver sees the same bytes the sender signed. Any two requests with identical `signature_hash` carry identical `(timestamp, bodyText)` pairs by construction. Adding `payload_hash` to the UNIQUE would be redundant — `signature_hash` collisions imply `payload_hash` collisions. The `payload_hash` column is kept for forensic queries ("is this body byte-identical to a known body?") but plays no role in the idempotency key.

### Why allow `link_id` to be nullable instead of a FK

Three reasons:

1. **The row is claimed before parse.** At INSERT time, no `link_id` exists yet — it is populated by `markWebsiteWebhookEventProcessed`.
2. **Parse failure leaves the row with `link_id` NULL forever.** A failed-then-retry path (D6) handles this case.
3. **Forensic durability.** If a future operational action deletes a `website_inbound_links` row (currently not supported, but a possible future migration), the ledger should not cascade-delete or break FK. Keeping the column unconstrained documents intent without coupling lifetimes.

### Why no `'replay_detected'` status

Status is a state machine of how the row's processing went, not of how often it was hit. `attempt_count` records the hit count. A row with `status='processed'` and `attempt_count=5` means "processed once on attempt 1, replayed 4 times, all 4 replays returned the existing wire shape". Adding a separate `'replay_detected'` would either (a) overwrite the original status (losing the "did we ever successfully process this?" signal) or (b) require a more complex state machine for no operational gain.

### Why hash on raw bodyText vs canonical JSON

Already in D2. Reiterated as load-bearing: the HMAC layer commits the App to a byte-fidelity contract. The ledger must inherit it or risk a class of bug where the auth says "this is the same request" and the ledger says "no it isn't".

---

## Consequences

### Defense-in-depth invariant established

After B15 ships, every authenticated inbound NoonWeb v1 webhook produces exactly one `website_webhook_events` row per `(endpoint, signature_hash)` value seen, regardless of how many times the sender retries. The application-layer idempotency (`website_inbound_links` lookup) stays intact as the inner layer. Together they defend against:

- Bit-for-bit replay (caught by ledger).
- External-id forgery + replay (caught by ledger because the signed payload would differ → different signature → different ledger row → but the inner `website_inbound_links` lookup would not match anything, so the request creates a new lead+proposal which is the correct behavior for a forged-but-validly-signed payload; an attacker who can sign requests is in possession of the shared secret and the system has bigger problems).
- True duplicate delivery from NoonWeb's outbound retry queue (caught by ledger; wire shape preserved per D6).

### Wire contract unchanged

`cross-repo-webhook-v1.md` is updated to reflect implementation reality (§8.2 flipped from "planned mitigation v2" to "implemented in v1 internal — wire unchanged"; §13 removes B15) but the schema, headers, status codes, response shapes are byte-identical to today. NoonWeb requires no coordination.

### Stripe ledger untouched

Migration 0041 + `lib/server/stripe/webhook-events.ts` stay as-is. They already conform to the pattern in shape; their identity-key specialization (`event_id` PK) is documented here as the alternative branch of D2.

### Future inbound HMAC webhooks adopt the pattern by default

Any future inbound-webhook spec invokes this ADR by reference and inherits D1-D10 unless it explicitly justifies a deviation. Specifically:

- New endpoint → new row in the `endpoint` CHECK constraint + corresponding handler wraps in `recordWebsiteWebhookEvent(...)` (or a more general helper if the integration is not NoonWeb).
- New integration with its own auth surface → may need its own ledger table following the same shape (different RLS, different env-var scope), but the pattern's anatomy (identity, status, lifecycle calls, response-shape preservation) carries over.

### Operational surface

Operator queries (admin-only, RLS-enforced) become possible without a dashboard:

```sql
-- Recent events by endpoint
select endpoint, status, count(*) from website_webhook_events
where received_at > now() - interval '24 hours' group by 1,2;

-- Replays in the last 24h
select endpoint, signature_hash, attempt_count, received_at, processed_at
from website_webhook_events where attempt_count > 1 and received_at > now() - interval '24 hours';

-- Failed events with errors
select endpoint, request_id, last_error, attempt_count, failed_at
from website_webhook_events where status = 'failed' order by failed_at desc limit 50;
```

### Retention growth

At current and projected NoonWeb traffic (tens of inbound webhooks per day, growing), 180-day retention bounds the table at ~10k rows. Within Supabase free-tier limits. If traffic grows ≥100× and the cleanup cron lands earlier than B15-bis, the operator follow-up adjusts the retention window.

### Risk register

| Risk | Mitigation |
|---|---|
| `signature_hash` collision across honest traffic | SHA-256 collision probability is negligible; the UNIQUE catches it as a "replay" which would degrade UX for one unlucky request — accepted as immeasurably small |
| Helper failure between claim and business invocation | Row stays `'processing'`. Next retry from NoonWeb is detected as replay; helper re-runs business logic per D6 fallback. Documented operator runbook: rows older than 1h in `'processing'` may indicate stuck claims — operator can mark `failed` manually or rerun |
| Env-var typo on `WEBSITE_WEBHOOK_LEDGER_ENABLED` flip | Default ON means a typo means "still on". Only the exact lowercased `'false'` disables. Documented in env-var reference |
| `database.types.ts` regen drops the 3 existing override patches | Override-block fallback (D10) restores them; clean-regen-reconcile follow-up tracked separately |
| Hash-strategy drift if HMAC contract changes | If `verifyWebsiteWebhookSignature` ever changes its signing input (e.g., adds a header to the signed payload), the ledger hash MUST be updated in lockstep. Documented as a coupling note in the helper module's JSDoc |

---

## Implementation contract

### Migration `00XX_phase_<N>_website_webhook_event_ledger.sql`

Owned by system-infra. Architecture-signed shape:

```sql
-- Phase <N>: transport-level idempotency ledger for NoonWeb v1 inbound webhooks.
-- See ADR-016 for rationale. Identity key is (endpoint, signature_hash); see D2.

create table if not exists public.website_webhook_events (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null check (endpoint in ('inbound-proposal','payment-confirmed')),
  signature_hash text not null,
  payload_hash text not null,
  signature_header text not null,
  request_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failed_at timestamptz,
  status text not null default 'processing'
    check (status in ('processing','processed','failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  external_session_id text,
  external_proposal_id text,
  external_payment_id text,
  link_id uuid
);

create unique index if not exists website_webhook_events_endpoint_signature_hash_key
  on public.website_webhook_events (endpoint, signature_hash);

create index if not exists website_webhook_events_received_at_idx
  on public.website_webhook_events (received_at desc);

create index if not exists website_webhook_events_status_idx
  on public.website_webhook_events (status);

create index if not exists website_webhook_events_endpoint_idx
  on public.website_webhook_events (endpoint);

create index if not exists website_webhook_events_external_session_id_idx
  on public.website_webhook_events (external_session_id)
  where external_session_id is not null;

alter table public.website_webhook_events enable row level security;

drop policy if exists "website_webhook_events_admin_read" on public.website_webhook_events;
create policy "website_webhook_events_admin_read"
  on public.website_webhook_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.id = auth.uid()
        and profile.role = 'admin'
        and profile.is_active = true
    )
  );

-- No INSERT/UPDATE/DELETE policy: writes happen via service_role (admin client).
-- See ADR-016 D8 for retention policy (180-day documented, cleanup cron deferred).
```

system-infra confirms the 4-digit prefix `00XX` against the current migrations ledger high-water mark (last seen `0050_phase_19d_…`). Per ADR-014 the apply path is MCP-fresh-preferred + Dashboard-fallback with manual ledger reconciliation.

### Helper module `lib/server/website/webhook-events.ts`

Architecture-signed signature:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>
export type WebsiteWebhookEndpoint = 'inbound-proposal' | 'payment-confirmed'
export type WebsiteWebhookEventStatus =
  Database['public']['Tables']['website_webhook_events']['Row']['status']

export interface WebsiteWebhookEventInput {
  endpoint: WebsiteWebhookEndpoint
  signatureHeader: string   // raw x-noon-signature value, e.g. "sha256=…"
  signatureHash: string     // sha256(`${timestamp}.${bodyText}`) lowercase hex
  payloadHash: string       // sha256(bodyText) lowercase hex
  requestId: string         // from getRequestId(request)
}

export interface WebsiteWebhookEventRecord {
  shouldProcess: boolean
  eventId: string                       // ledger row id (uuid)
  status: WebsiteWebhookEventStatus     // 'processing' on fresh claim; 'processed' or 'failed' on replay
  attemptCount: number
  externalSessionId: string | null      // populated only if a prior successful run set it
  externalProposalId: string | null
  externalPaymentId: string | null
  linkId: string | null
}

/**
 * Claim a ledger row for the (endpoint, signatureHash) tuple.
 * - First-time: inserts a fresh row with status='processing', returns shouldProcess=true.
 * - Replay where the prior row reached status='processed' and has a linkId: returns
 *   shouldProcess=false; caller MUST re-query website_inbound_links by linkId (or by
 *   externalSessionId fallback) and return the wire-shape response per ADR-016 D6.
 * - Replay where the prior row reached status='failed' OR is still 'processing' OR
 *   has no linkId: returns shouldProcess=true with attemptCount bumped. Caller proceeds
 *   to invoke business logic again (idempotent at the app layer via existing
 *   website_inbound_links lookup) and then marks processed/failed as normal.
 *
 * Throws on DB errors. Throwing is propagated to the route handler which returns 500.
 */
export async function recordWebsiteWebhookEvent(
  client: DatabaseClient,
  input: WebsiteWebhookEventInput,
): Promise<WebsiteWebhookEventRecord>

/**
 * Mark a previously-claimed ledger row as processed and populate the business
 * identity columns (external ids + link id). Idempotent — repeated calls on the
 * same eventId with the same shape are safe.
 */
export async function markWebsiteWebhookEventProcessed(
  client: DatabaseClient,
  eventId: string,
  outcome: {
    externalSessionId: string | null
    externalProposalId: string | null
    externalPaymentId: string | null
    linkId: string | null
  },
): Promise<void>

/**
 * Mark a previously-claimed ledger row as failed and capture the error message.
 * Does NOT throw on DB errors during the mark — failures during failure-recording
 * are swallowed (logged by caller) to avoid masking the original error.
 */
export async function markWebsiteWebhookEventFailed(
  client: DatabaseClient,
  eventId: string,
  error: unknown,
): Promise<void>
```

Helper consumers: `app/api/integrations/website/inbound-proposal/route.ts` + `app/api/integrations/website/payment-confirmed/route.ts`. The helper is intentionally narrower than the Stripe helper (one `recordWebsiteWebhookEvent` instead of `beginStripeWebhookEvent`) because the row claim and the existing-row lookup collapse into one `INSERT … ON CONFLICT … RETURNING` round trip in the happy path.

### Route refactor shape

Both inbound routes adopt the same skeleton:

```typescript
// after auth + parse (existing readSignedWebsiteJson is extended to also return bodyText + signatureHeader + timestamp)
const { payload, bodyText, signatureHeader, timestamp } = await readSignedWebsiteJson(...)

if (websiteWebhookLedgerEnabled()) {
  const signatureHash = sha256Hex(`${timestamp}.${bodyText}`)
  const payloadHash = sha256Hex(bodyText)
  const adminClient = createSupabaseAdminClient()
  const claim = await recordWebsiteWebhookEvent(adminClient, {
    endpoint: 'inbound-proposal',     // or 'payment-confirmed'
    signatureHeader,
    signatureHash,
    payloadHash,
    requestId,
  })

  if (!claim.shouldProcess && claim.linkId) {
    // Replay of a previously-processed event → re-query and return the same wire shape
    const replayResponse = await composeReplayResponseFromLedger(adminClient, claim, payload)
    return jsonWithRequestId({ data: replayResponse }, { status: 200 }, requestId)
  }

  try {
    const result = await receiveWebsiteInboundProposal(payload)  // existing
    await markWebsiteWebhookEventProcessed(adminClient, claim.eventId, {
      externalSessionId: payload.external_session_id,
      externalProposalId: payload.external_proposal_id,
      externalPaymentId: null,           // payment-confirmed handler populates
      linkId: result.linkId,
    })
    return jsonWithRequestId({ data: result }, { status: result.idempotent ? 200 : 201 }, requestId)
  } catch (error) {
    await markWebsiteWebhookEventFailed(adminClient, claim.eventId, error).catch(() => {})
    throw error
  }
}

// Kill-switch path: pre-ledger behavior, unchanged
const result = await receiveWebsiteInboundProposal(payload)
return jsonWithRequestId({ data: result }, { status: result.idempotent ? 200 : 201 }, requestId)
```

`composeReplayResponseFromLedger` is a small helper inside the same lib module. It calls `table(client, 'website_inbound_links').select(...).eq('id', claim.linkId).single()` and reshapes into the existing `{ idempotent: true, linkId, leadId, proposalId, [projectId], status }` response. If the lookup fails (deleted row, etc.), it falls back to the `shouldProcess=true` retry semantics by re-running business logic (handled in the route handler — the helper just signals).

### Auth-surface extension

`lib/server/website-webhook-auth.ts::readSignedWebsiteJson` is extended (or a sibling `readSignedWebsiteJsonWithRawBody` added) to return `{ payload, bodyText, signatureHeader, timestamp }` instead of just `payload`. The HMAC signing inputs (`timestamp` + `bodyText`) are already captured inside the function; this just exposes them. The existing single-value `readSignedWebsiteJson` MAY be kept as a thin wrapper for any non-webhook callers, OR replaced entirely if the call sites are exclusively the two routes.

### Env-var reference update

Add `WEBSITE_WEBHOOK_LEDGER_ENABLED` to env-var docs (default ON, kill-switch only). No corresponding NoonWeb-side env var because the contract is unchanged.

---

## References

- TDR-003 — Stripe webhook event ledger (the canonical precedent).
- `docs/integrations/cross-repo-webhook-v1.md` §2 (HMAC contract), §3.4 / §4.5 (wire response shapes), §8.2 (B15 placeholder), §13 (audit B15).
- `specs/fase-2-c-b15-website-webhook-ledger.md` — iteration spec.
- `supabase/migrations/0041_phase_17a_stripe_webhook_event_ledger.sql` — schema reference.
- `lib/server/stripe/webhook-events.ts` — helper-shape reference.
- `lib/server/website-webhook-auth.ts` — auth surface this ADR depends on.
- ADR-014 — migration prefix + ledger reconciliation discipline.
