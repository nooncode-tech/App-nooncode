# ADR-027: Outbound webhook retry-with-backoff + dead-letter ledger for `proposal_review_decision`

**Status:** Accepted
**Date:** 2026-05-26
**Deciders:** Architecture (system-architecture skill, G23 iteration)
**Supersedes:** None
**Related:**
- ADR-016 — transport-level webhook ledger pattern for **inbound** HMAC webhooks. This ADR mirrors its anatomy for the **outbound** direction.
- ADR-014 — migration ledger reconciliation discipline (manual-apply + ledger INSERT fallback).
- ADR-006 — migration prefix convention (4-digit prefix; next free `0062`).
- TDR-003 — Stripe inbound ledger (the structural precedent ADR-016 generalized).
- `specs/fase-3-r5-outbound-webhook-retry-policy.md` — iteration spec authored alongside this ADR.
- `docs/integrations/cross-repo-webhook-v1.md` — wire contract App ↔ NoonWeb (this ADR adds outbound retry + idempotency-key contract to it).
- `lib/server/website-integration.ts:683-813` — `sendProposalReviewDecisionToWebsite` (the call site this ADR rewraps).
- `lib/server/website/webhook-events.ts` — inbound ledger sibling helper module (template for the new outbound module).
- `supabase/migrations/0051_phase_20a_website_webhook_event_ledger.sql` — inbound ledger schema (precedent).
- `app/api/cron/webhook-failure-alert/route.ts` — cron pattern template (B25 closure).

---

## Context

The App emits exactly one outbound HMAC webhook today: `proposal_review_decision`, fired by `sendProposalReviewDecisionToWebsite` (`lib/server/website-integration.ts:683-813`) when a PM approves / rejects / requests-changes / cancels an inbound proposal originating from NoonWeb. The call sites are:

1. `app/api/proposals/[proposalId]/review/route.ts:65` — primary PM review action.
2. `app/api/inbound/pm-queue/[proposalId]/review-webhook/route.ts:46` — operator dispatch-only / retry surface.

Both invoke the same library function with the same signature; both write a row-level snapshot of the outcome onto `website_inbound_links` (`review_webhook_status`, `review_webhook_attempted_at`, `review_webhook_sent_at`, `review_webhook_error`).

Today the function is a single-shot `fetch`:
- 2xx → snapshot `sent`.
- non-2xx or network throw → snapshot `failed`. No retry. No durable historical record of the attempt.

Once NoonWeb ships `/portal/[projectId]` (in progress on `noon-web-main`, not yet live), a single missed delivery becomes a user-visible bug: the client never sees the PM decision. Operator value of a durable, retryable outbound surface is high, and the cross-repo invariant (NoonWeb's portal v3 state must reflect every terminal decision) becomes load-bearing.

ADR-016 already established the **transport-level webhook ledger pattern** for inbound HMAC webhooks. ADR-027 generalizes the same pattern for the **outbound** direction: a sibling ledger table (`outbound_webhook_events`), a sibling helper module, retry-with-backoff inline, a dead-letter terminal state, a cron sweeper for stuck `pending` rows, and an admin replay endpoint. The wire envelope NoonWeb receives is unchanged.

This ADR packs the 11 D-decisions Architecture must lock before Backend writes code. The order mirrors the spec's OQ-1 through OQ-11.

---

## Decision

### D1 — Retry algorithm parameters (was OQ-1)

**Locked values:**

| Parameter | Value | Rationale |
|---|---|---|
| Max inline attempts | **3** | Two retries cover the dominant transient class (single-region NoonWeb hiccup, brief DB blip, cold-start latency spike). Beyond 3, the receiver is meaningfully down and retry-amplification cost dominates retry-benefit. |
| Base delay | **2000 ms** | Long enough to clear most transient receiver-side load; short enough to keep p99 PM-review latency under ~15s. |
| Growth factor | **2x exponential** | Sequence: 2s → 4s → 8s. Standard pattern; predictable for operators. |
| Jitter | **±25% uniform** per attempt's planned delay | Decorrelates retries across concurrent PM reviews when NoonWeb returns simultaneously after an outage. Computed as `delay × (0.75 + Math.random() × 0.5)`. |
| Max single delay cap | **10 000 ms** | Hard ceiling on any individual sleep (covers the 8s × 1.25 = 10s worst case). Prevents future tuning drift from running the 3rd-attempt sleep past 10s. |
| Total inline time budget | **~14 s** soft target (worst case ≈ `2 + 4 + 8` base + ≤25% jitter ≈ 17.5 s ceiling) | Backend MUST NOT abort mid-attempt to stay under budget; budget is informational for the call-site SLO. The hard correctness contract is the attempts cap. |
| What counts as a "transient" failure that consumes an attempt | Network error throw (fetch rejection: timeout, ECONNREFUSED, AbortError) OR HTTP 5xx OR HTTP 429 | See D9 for the 4xx complement. |
| What does NOT count as an attempt | HTTP 2xx (terminal: `delivered`). Successful claim is `attempt_count = N` at the value of `N` when the 2xx arrived (e.g., succeed on 2nd attempt → `attempt_count = 2`). |
| Attempt counter semantics on ledger | `attempt_count` is incremented BEFORE each `fetch`. On 2xx the row stays at the post-increment value. On exhaustion the row reaches `attempt_count = 3` and transitions to `dead_letter`. The cron path also increments before re-attempting; same semantics. |

**Tradeoffs:**
- **For:** bounded, predictable amplification ceiling (≤3× inline + bounded cron retries — see D4). Total Upstash/Vercel-cost surge per stuck delivery is bounded.
- **Against:** a 4th-attempt-would-have-worked scenario (e.g., receiver healed at t=15s) is converted to a `dead_letter` row that requires either the cron sweep to pick it up (~5 min later) or manual admin replay. Acceptable: 5 minutes operator-visible latency in a degraded mode is preferable to runaway retries.

**Backend constraint:** the retry math (delay computation, jitter draw, attempt accounting) is implemented as a pure helper that can be unit-tested without `fetch`. `fetch` is injected as a parameter (or wrapped via a thin transport seam) so tests can substitute scripted responses. See D11 § "Test seam expectations".

### D2 — Dead-letter ledger schema (was OQ-2)

Sibling table `outbound_webhook_events`. Identity key: ledger row UUID (surrogate). Natural composite for operator filtering: `(endpoint, external_proposal_id, decision)` — non-unique because the same proposal can have multiple historical attempts (a 4xx-aborted attempt + an admin-replay-triggered fresh attempt are two separate rows by design).

**Locked column set:**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Surrogate PK — used as `eventId` argument to admin replay endpoint (see D11). |
| `endpoint` | `text not null check (endpoint in ('proposal-review-decision'))` | Single value today. Extensible via future ADR (e.g., `prototype-decision-relay`). The CHECK uses an explicit enum so future-additive iterations must declare themselves. |
| `external_proposal_id` | `text not null` | Forensic operator key. Joins to `website_inbound_links.external_proposal_id`. Indexed. |
| `decision` | `text not null check (decision in ('approved','rejected','changes_requested','cancelled'))` | Matches the four values produced by `reviewDecisionByAction`. CHECK enforces no drift. |
| `link_id` | `uuid` | Soft FK (no constraint) to `website_inbound_links.id` for fast operator join. NULL ONLY if the calling code path somehow lost link context (defensive; under D8 dual-track this is populated on every row at insert time). |
| `proposal_id` | `uuid` | Soft FK (no constraint) to `lead_proposals.id`. Forensic. |
| `status` | `text not null default 'pending' check (status in ('pending','delivered','dead_letter','replayed'))` | State machine — see § "State machine" below. |
| `attempt_count` | `integer not null default 0 check (attempt_count >= 0)` | Bumped BEFORE each fetch. Inline path lands at 1/2/3; cron path bumps further; admin replay creates a NEW row at 0 (see D7) so the column never exceeds D1 cap × cron-bound. |
| `max_attempts` | `integer not null default 3 check (max_attempts > 0)` | Snapshotted at row creation. If a future iteration tunes the cap, in-flight rows preserve their original cap for replay determinism. |
| `next_retry_at` | `timestamptz` | Set to `now() + computed_delay` after a failed inline attempt that did NOT exhaust attempts. NULL when `status in ('delivered','dead_letter','replayed')`. Cron sweeper picks up `status='pending' and next_retry_at <= now()`. |
| `last_attempted_at` | `timestamptz` | `now()` at each fetch start. NULL until first attempt. |
| `delivered_at` | `timestamptz` | Set when 2xx response observed. NULL otherwise. |
| `dead_lettered_at` | `timestamptz` | Set when transitioned to `dead_letter`. NULL otherwise. |
| `replayed_at` | `timestamptz` | Set when admin replay supersedes this row (transitions it to `replayed` — see D7). |
| `replayed_by_event_id` | `uuid` | When `status='replayed'`, points to the new row spawned by admin replay. NULL otherwise. |
| `last_error` | `text` | First 1000 chars of `Error.message` or `HTTP <code>: <body-snippet>` on the most recent failed attempt. Cleared (kept) across retries — the LAST error wins. |
| `last_http_status` | `integer` | Most recent HTTP status code observed, or NULL on network error. Useful for operator triage. |
| `payload_hash` | `text not null` | `sha256(bodyText)` lowercase hex. Forensic — no PII expansion in the ledger. **Same posture as inbound ledger (ADR-016 D7).** |
| `signature_header` | `text` | Last sent `x-noon-signature` header (`sha256=…`). Forensic re-derivation aid. Populated on first attempt and refreshed on each retry (per D10: each attempt re-signs with a fresh timestamp; the header value drifts per attempt). |
| `idempotency_key` | `text not null` | Cross-repo de-dupe key sent to NoonWeb (see D3 + D10). Stored as a column so admin replay can re-emit the SAME key (preserving NoonWeb-side dedupe). Indexed for operator forensic queries. |
| `request_id` | `text` | Last request id (via `getRequestId(...)` or generated locally for outbound contexts). Joins ledger row to Vercel logs. |
| `actor_id` | `uuid` | Operator/user id who triggered the original PM review (from the `actor.id` field of `sendProposalReviewDecisionToWebsite`). NULL when invoked without an actor (e.g., dispatch-only retry surface). Forensic. |
| `created_at` | `timestamptz not null default now()` | Row creation. |
| `updated_at` | `timestamptz not null default now()` | Touched on every UPDATE. Backend implements a trigger or sets it explicitly in each UPDATE statement. |

**State machine (locked):**

```
                  (first attempt)
[created]  ─────────────────────────►  pending
                                          │
            2xx received                  │
           ─────────────►  delivered  ◄───┘ (terminal happy path)
                                          │
            5xx / 429 / network throw,     │
            attempts < max                 │
            next_retry_at = now()+backoff  │
           ──────────────►  pending  ◄─────┘ (loop; next fetch may be inline or cron)
                                          │
            5xx / 429 / network throw,     │
            attempts == max                │
           ──────────────►  dead_letter   ◄─┘ (terminal failure)
                                          │
            4xx (not 429)                  │
            on FIRST attempt only          │
           ──────────────►  dead_letter   ◄─┘ (terminal — D9)

                  admin replay:
            (separate row spawned)
            old row: pending OR dead_letter → replayed
                     replayed_by_event_id = new.id, replayed_at = now()
            new row: status='pending', attempt_count=0, fresh idempotency_key=OLD.idempotency_key  (D10)
```

**Indexes (locked):**

| Index | Definition | Operator query |
|---|---|---|
| primary | `id` | identity |
| `outbound_webhook_events_pending_retry_idx` | `(next_retry_at) where status = 'pending' and next_retry_at is not null` | cron sweeper hot path |
| `outbound_webhook_events_external_proposal_idx` | `(external_proposal_id)` | operator forensic ("show me all attempts for proposal X") |
| `outbound_webhook_events_idempotency_key_idx` | `(idempotency_key)` | operator forensic + cross-repo correlation |
| `outbound_webhook_events_status_idx` | `(status)` | operator queries by terminal state |
| `outbound_webhook_events_link_idx` | `(link_id) where link_id is not null` | join to `website_inbound_links` |
| `outbound_webhook_events_dead_lettered_at_idx` | `(dead_lettered_at desc) where dead_lettered_at is not null` | alert / dashboard recency |
| `outbound_webhook_events_created_at_idx` | `(created_at desc)` | recency |

**RLS (locked, mirrors inbound):**

- `enable row level security;`
- One `SELECT` policy: `outbound_webhook_events_admin_read`, scope = `authenticated` rows where `user_profiles.role = 'admin' and is_active = true`.
- **No INSERT/UPDATE/DELETE policies.** All writes go through `service_role` via `createSupabaseAdminClient` (the dispatcher / cron / admin endpoint). This matches ADR-016 D7's posture verbatim.

**Soft-FK posture (locked, mirrors ADR-016 D7):**

- `link_id`, `proposal_id` are NOT FK-constrained. Forensic durability: if a future operational action deletes a `website_inbound_links` or `lead_proposals` row, the ledger remains for audit. No cascade behavior. Documented in the migration comment.

**No raw payload storage:** the body bytes are reconstructable from the ledger metadata + the live `website_inbound_links` + `lead_proposals` rows. Storing the body bytes would (a) expand PII surface, (b) bloat the table, (c) compound the GDPR retention burden. Hash-only.

**Tradeoffs:**
- **For:** rich operator query surface; forensic by design; matches inbound pattern (one mental model for operators); RLS posture identical (admin-only read; service-role write).
- **Against:** ~20 columns is on the heavy end. Justification: each column serves a distinct operator or forensic purpose; the alternative (sparse table + a JSONB blob) would be cheaper at write but worse at every read.

### D3 — Cross-repo idempotency-key header contract (was OQ-3)

**Locked decision:**

- Header name: **`X-Noon-Idempotency-Key`** (App-scoped prefix; new header, not re-using `x-noon-signature`).
- Header value format: **`<external_proposal_id>:<decision>`** — UTF-8 plain text. Example: `prop_abc123:approved`.
- Header is emitted on **every** outbound `proposal_review_decision` POST (first attempt + every retry + admin replay). It does NOT change per attempt — D10 locks persistence so replays carry the same value.
- Value sourced from the ledger row's `idempotency_key` column (D2), computed once at row creation and never recomputed.

**Why `<external_proposal_id>:<decision>` not a hash:**
- Human-readable in NoonWeb logs (operator triage).
- Stable under the wire-envelope contract: `external_proposal_id` is the cross-repo identity, `decision` is the terminal state. The pair is unique because a single proposal can only transition once into each terminal state (locked invariant; if a future iteration adds reversible transitions, this ADR must be revisited).
- No collision risk: `external_proposal_id` is sender-supplied and unique; `decision` is from a 4-value enum.
- Cheaper than `sha256(...)` to debug; cryptographic strength is not the goal here (the HMAC signature already authenticates).

**Cross-repo contract to be communicated to NoonWeb (Docs at iteration close):**

NoonWeb's `proposal_review_decision` receiver MUST:
1. Read the `X-Noon-Idempotency-Key` header on every POST.
2. Persist it as a unique constraint key on its own receiver-side ledger (NoonWeb's `noon-web-main` repo).
3. On a duplicate key, return 200 with the same response body it returned the first time (without re-processing the decision).

App-side ships **ready** under this contract. NoonWeb-side enforcement is **out-of-scope** for G23 and is escalated to `noon-web-main` as cross-repo coordination signal R2 (see spec §9 R2; recorded as Active risk in `docs/context/project.context.core.md` at iteration close).

**Tradeoffs:**
- **For:** simplest contract that covers the dominant failure mode (client-side timeout / network race after server-side success). Operator-debuggable. Schema-stable.
- **Against:** assumes the (`external_proposal_id`, `decision`) pair is forever monotone — a future iteration introducing reversal semantics (e.g., "un-approve") would invalidate the uniqueness assumption. Mitigation: ADR-027 must be revisited if reversal semantics enter scope; the current state machine of `lead_proposals.review_status` does not support reversal, so this is a forward-looking note, not a present risk.

### D4 — Cron sweeper cadence + batch size (was OQ-4)

**Locked values:**

| Parameter | Value | Rationale |
|---|---|---|
| Schedule | **`*/5 * * * *`** (every 5 minutes) | Frequent enough that an inline-exhausted row gets retried within ~5 min of the previous attempt's `next_retry_at` becoming due. Infrequent enough that a hard NoonWeb outage at 1000-req/day inbound rate still keeps cron cost negligible. |
| Batch size cap | **50 rows per run** | Bounds amplification under sustained outage. At 50/run × 12 runs/hour × 24h = 14 400 retry-fetches/day worst-case ceiling — well within Vercel-function quota even on hobby tier. |
| Per-row select clause | `status = 'pending' and next_retry_at is not null and next_retry_at <= now() and attempt_count < max_attempts` | Cron NEVER fetches rows that haven't yet reached their backoff window; NEVER fetches rows that have already exhausted their attempts. |
| Order | `next_retry_at asc` (oldest-due first) | Ensures fairness; no starvation of long-pending rows behind newly-deferred ones. |
| Dry-run query | `?dryRun=true` returns counts + first 50 candidate row ids, no fetches fired | Mirrors `webhook-failure-alert` cron pattern. |
| Authz | `Bearer ${CRON_SECRET}` ONLY (same as B25). 401 on missing/wrong bearer. | Service-role via `createSupabaseAdminClient` inside the handler. |
| Per-fetch attempt accounting | Each cron-driven fetch increments `attempt_count` by 1 (same accounting as inline). If post-increment `attempt_count == max_attempts` and the fetch fails, transition to `dead_letter`. Otherwise compute `next_retry_at = now() + backoff(attempt_count)` and remain `pending`. | Uniformity with inline path. Cron sweeper does NOT have its own retry budget — it shares the same `max_attempts` ceiling. |
| Concurrent-cron-run safety | Cron handler claims rows via an UPDATE with `where status='pending' and next_retry_at <= now() ... returning *` (single round trip). Concurrent runs do not double-fetch because the UPDATE locks rows per the underlying transaction. **Alternative considered**: a `claimed_at` lock column — rejected as over-engineering for `*/5 * * * *` cadence (Vercel cron runs are essentially serialized at this cadence). | KISS until measured contention proves the need for explicit lock columns. |

**Infrastructure note (drift verification surfaced):**

The five existing crons in `vercel.json` are all daily. `*/5 * * * *` would be the FIRST sub-hourly cron. **Infra step MUST verify** that the Vercel project's plan tier supports sub-hourly schedules. If hobby-tier only allows daily, Infra escalates to `system-infra` to decide fallback (downgrade to `0 * * * *` hourly with corresponding `max_attempts` bump, OR escalate plan, OR keep cadence and accept tier upgrade as part of G23 infra work). Architecture's preference: keep `*/5 * * * *` and accept tier review as part of G23 infra deliverables. Backend should code as if `*/5 * * * *` is final; Infra owns the verification.

**Tradeoffs:**
- **For:** bounded amplification; clean operator mental model (cron picks up where inline left off, identical semantics); simple authz.
- **Against:** 5-minute "tail latency" for an exhausted row (worst case: inline retry exhausts at t=14s, cron picks up at t=300s). Acceptable: in a NoonWeb-degraded scenario, 5 minutes is not the dominant operator cost.

### D5 — Kill-switch env var + semantics (was OQ-5; durability-preserving option-b confirmed)

**Locked values:**

| Parameter | Value |
|---|---|
| Env var name | **`NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED`** |
| Default (absent) | **`true` (enabled)** — full retry + ledger behavior |
| Explicit `'false'` (case-insensitive, trimmed) | **disables inline retry but PRESERVES ledger durability** (option-b — locked) |
| Read posture | **module load** (mirrors `WEBSITE_WEBHOOK_LEDGER_ENABLED` in `webhook-events.ts:62` — single read at module init, no per-request env lookup). |
| Non-canonical values (e.g., `'False'`, `'0'`, `'no'`) | **warning logged once at module load; defaults to ENABLED.** Only the exact lowercased `'false'` disables. Mirrors ADR-016 D9 reading discipline. |
| Coverage | The flag controls **inline retry loop only**. It does NOT disable: the ledger row write (D2), the cron sweeper, the dead-letter alert wiring (D6), the admin replay endpoint (D7). The cron CAN still drive a `pending` row to `delivered` even when the flag is `'false'` — operators retain manual durability paths. |

**Behavior matrix (locked):**

| Flag value | First attempt 2xx | First attempt 5xx/network | First attempt 4xx (non-429) |
|---|---|---|---|
| `true` (default) | Insert row, status=`delivered`, attempt_count=1 | Insert row, status=`pending` (or after exhaustion `dead_letter`), retries fire inline | Insert row, status=`dead_letter`, attempt_count=1 |
| `'false'` (panic) | Insert row, status=`delivered`, attempt_count=1 | Insert row, status=`dead_letter` IMMEDIATELY (no inline retry; cron may still retry later) | Insert row, status=`dead_letter`, attempt_count=1 |

**Rationale for option-b (durability-preserving):**

Option-a (skip ledger writes entirely when flag is off) loses durability precisely when the system is in panic mode — the moment when durability matters most. Option-b accepts a small amplification floor (one fetch per call, always) in exchange for the invariant: "if the App fired a `proposal_review_decision` outbound, a row exists in `outbound_webhook_events`." Operators can always reconcile via the cron sweep + admin replay even after the flag was toggled.

The amplification cost of option-b in panic mode is one DB INSERT per call, which is bounded by PM-review traffic (low-frequency by design). Acceptable.

**Tradeoffs:**
- **For:** flag flip is a true safety lever (kills the inline-retry amplification surface) without sacrificing durability.
- **Against:** Naming the flag `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` (suggesting boolean retry on/off) is slightly imprecise because the ledger still writes when the flag is false. Documentation in `.env.example` (Backend deliverable) must call this out. Alternative names considered: `NOON_OUTBOUND_WEBHOOK_INLINE_RETRY_ENABLED` (more precise but verbose) — rejected for brevity + alignment with `WEBSITE_WEBHOOK_LEDGER_ENABLED` parallelism.

### D6 — Dead-letter alert wiring (was OQ-6)

**Locked decision:**

- **Reuse the existing `webhook-failure-alert` cron handler** (`app/api/cron/webhook-failure-alert/route.ts`). Extend its scope to ALSO scan `outbound_webhook_events` for `status='dead_letter'` rows created within the lookback window. Emit notifications via the existing `enqueue_user_notification` RPC, with:
  - `next_source_kind = 'webhook_failure'` (reused — operator inbox is `webhook_failure` already).
  - `next_source_event_id = ledger.id` (already UUID — no MD5 hashing needed; mirrors website-failure path).
  - `next_domain = 'delivery'` (reused).
  - `next_title = 'Outbound webhook fallido'` (Spanish, matches existing pattern).
  - `next_body = '<endpoint> (<external_proposal_id>) dead-letter. <last_error snippet>'`.
  - `next_href = '/dashboard/settings'` (operators have no dedicated UI yet — same as website-failure path).

- **Why extension over new cron:** the alert surface is logically identical to the existing one (a failed webhook event in a ledger). Three table scans in one cron is operationally simpler than three crons. Idempotency is preserved by the same `(profile_id, source_kind, source_event_id)` uniqueness contract `enqueue_user_notification` already provides.

- **Alert threshold:** ANY new `dead_letter` row in the lookback window (24h default) → one notification per active admin per row. Matches the existing `webhook_failure` pattern (no rate-limit / no threshold debouncing today; consistent for G23). Future iterations may add aggregation if operator volume justifies.

**Tradeoffs:**
- **For:** zero new cron, zero new notification kind, idempotency inherited, no schema additions to `user_notifications`.
- **Against:** the existing `webhook-failure-alert` cron now has THREE ledger scans (`stripe_webhook_events`, `website_webhook_events`, `outbound_webhook_events`); future maintainers should split it if it grows. Documented as a follow-up watchpoint.

**Drift verification (ADR-027 § Drift):** the `enqueue_user_notification` RPC signature is `(target_profile_id uuid, next_source_kind text, next_source_event_id uuid, next_domain text, next_title text, next_body text, next_href text, next_due_at timestamptz)` — confirmed against `supabase/migrations/0039_phase_16b_rpc_and_client_portal_security.sql:96`. The new outbound ledger uses UUID for `id`, so `next_source_event_id = ledger.id` directly (no MD5 needed; mirrors the website-failure code path at `app/api/cron/webhook-failure-alert/route.ts:201-209`).

### D7 — Admin replay endpoint contract (was OQ-7)

**Locked decision:**

- **URL**: `POST /api/admin/outbound-webhooks/[eventId]/replay`
- **Identity argument**: `[eventId]` is the ledger row UUID (D11 — locked rationale below).
- **Method**: `POST` only. GET returns 405.
- **Authz**: `requireRole(['admin'])` strict — no `pm`, no `sales_manager`, no `developer`, no service-role bypass. 403 on any non-admin. 401 on unauthenticated.
- **Request body**: empty (`{}` allowed). No fields read.
- **Behavior by ledger row state**:

| Source row `status` | Behavior | Response |
|---|---|---|
| `delivered` | NO new fetch. NO state change to source row. Return early. | `200 { idempotent: true, noop: true, eventId, deliveredAt, externalProposalId, decision }` |
| `replayed` | NO new fetch. Return the `replayed_by_event_id` for operator follow-up. | `200 { idempotent: true, noop: true, eventId, replayedByEventId, externalProposalId, decision }` |
| `pending` | Treat as "row is still in cron's retry window." NO new fetch fired by the endpoint (avoid racing the cron). Return 409. | `409 { error: 'event_in_pending_state', eventId, nextRetryAt }` |
| `dead_letter` | **Spawn a new ledger row** with `status='pending'`, `attempt_count=0`, fresh `created_at`. Source row transitions to `replayed`, `replayed_at = now()`, `replayed_by_event_id = new.id`. The new row inherits: `endpoint`, `external_proposal_id`, `decision`, `link_id`, `proposal_id`, `payload_hash`, `idempotency_key` (D10 — same key preserves NoonWeb dedupe), `max_attempts` (a fresh 3). Then immediately invokes the dispatcher's retry-with-backoff loop against the new row. | `200 { idempotent: false, replayed: true, sourceEventId, newEventId, status: 'delivered' \| 'pending' \| 'dead_letter', externalProposalId, decision }` |

**Why spawn-new-row instead of mutate-in-place:**

- Preserves history: the original `dead_letter` row remains for forensic ("what happened in the original failed run"). The new row records the replay attempt's own attempts + outcome.
- Cleaner state machine: `dead_letter` is truly terminal; `replayed` is the transition that points operators to the new row.
- Admin replay is observably-distinct in the ledger from cron sweep activity (cron updates the same row; admin spawns a new one).
- Matches the spec's R2 mitigation posture: the new row carries the SAME `idempotency_key` as the source row, so NoonWeb's de-dupe sees it as the same logical decision delivery — preventing duplicate processing of the cross-repo invariant.

**Rate-limit posture:** none in G23 (admin role is trusted; replay is rare-event operator work). Future iteration may add if abuse surfaces.

**Tradeoffs:**
- **For:** clean state machine; preserves audit trail; identity-key replay (D10) preserves cross-repo dedupe.
- **Against:** two-row pattern means operator forensic queries must join on `replayed_by_event_id` to follow the chain. Documented in `docs/integrations/cross-repo-webhook-v1.md` update.

### D8 — Dual-track relationship with `website_inbound_links` snapshot columns (was OQ-8)

**Locked decision:**

- **`website_inbound_links` snapshot columns (`review_webhook_status`, `review_webhook_attempted_at`, `review_webhook_sent_at`, `review_webhook_error`, `current_status`) remain the LATEST-attempt snapshot.** Backend MUST continue writing them on every terminal outcome (delivered / dead_letter), preserving backwards compatibility with existing operator queries and any consumer code that reads them.
- **`outbound_webhook_events` rows are the HISTORICAL attempt log.** One row per logical delivery (with `replayed_by_event_id` chains for admin replays).
- **Same dual-track pattern as ADR-016 D6 / D7** (inbound ledger + `website_inbound_links` row co-existence).

**Mapping (locked, Backend constraint):**

| Outcome | `outbound_webhook_events` write | `website_inbound_links` write |
|---|---|---|
| First attempt 2xx (delivered) | row created status=`delivered`, attempt_count=1, delivered_at=now() | `review_webhook_status='sent'`, `review_webhook_attempted_at=now`, `review_webhook_sent_at=now`, `review_webhook_error=null`, `current_status='review_webhook_sent'` |
| 5xx after 3 attempts (dead_letter) | row updated status=`dead_letter`, attempt_count=3, dead_lettered_at=now() | `review_webhook_status='failed'`, `review_webhook_attempted_at=last_attempt_at`, `review_webhook_error=last_error`, `current_status='review_webhook_failed'` |
| Cron drives `pending → delivered` | row updated status=`delivered`, attempt_count=N, delivered_at=now() | snapshot updated: `review_webhook_status='sent'`, ..., `current_status='review_webhook_sent'` |
| Cron drives `pending → dead_letter` | row updated status=`dead_letter`, ... | snapshot updated: `review_webhook_status='failed'`, ..., `current_status='review_webhook_failed'` |
| Admin replay drives `dead_letter → replayed`, new row → delivered | source row status=`replayed`, new row status=`delivered` | snapshot updated to `sent` (latest-attempt wins) |
| Kill-switch ON, first attempt fails | row created status=`dead_letter`, attempt_count=1, dead_lettered_at=now() | snapshot updated: `review_webhook_status='failed'`, ... |

**Why preserve snapshot writes:**

- Existing call sites + dashboards + queries (e.g., the `pm-queue/[proposalId]/review-webhook` operator surface) read from `website_inbound_links`. Migrating consumers to read from the new ledger is OUT OF SCOPE for G23.
- Two-tier durability: snapshot is fast O(1) lookup per proposal; ledger is rich historical query surface. Both have legitimate operator value.

**Tradeoffs:**
- **For:** zero migration burden on consumers; consistent with inbound dual-track precedent; operator queries by proposal are O(1) via snapshot, deep forensic queries are rich via ledger.
- **Against:** two writes per outcome → small write amplification (~2 RTTs to Supabase per terminal state). Acceptable: PM-review traffic is low-frequency; not a hot path.

### D9 — 4xx treatment (was OQ-9)

**Locked decision:**

| Response | Treatment | Rationale |
|---|---|---|
| 2xx | terminal `delivered` | happy path |
| **4xx (excluding 429)** | **terminal `dead_letter` on FIRST attempt; NO retry** | Receiver-side contract violation. Retrying does not heal a 400/403/404/410/422 etc. Operator must inspect via admin replay endpoint; if it's an App-side bug, the fix is code-side. If it's a NoonWeb-side schema drift, the fix is cross-repo. Either way, retry doesn't help. |
| **429** | retryable, COUNTS as a normal attempt (same backoff sequence as 5xx) | 429 is a transient back-pressure signal, not a contract violation. Hand-off `Retry-After` header parsing is OUT OF SCOPE for G23 (deferred follow-up); the standard backoff sequence covers the dominant 429 cause. |
| **5xx** | retryable, same backoff as above | transient receiver-side failure |
| **Network throw** (timeout, ECONNREFUSED, AbortError, DNS failure) | retryable, same backoff | transient transport failure |

**Edge case:** if `fetch` resolves but the response body cannot be read (e.g., the connection drops mid-body), treat as a network-throw equivalent (retryable). The status code may have been received; if it indicates 2xx, the implementation MUST still treat the row as `pending` (status code only) → re-attempt. Idempotency-key (D3) protects against duplicate processing if NoonWeb actually received the request. This is a deliberate "false positive retry" — strictly safer than a "false negative delivered." Documented in Backend test cases.

**Tradeoffs:**
- **For:** correct semantics for a wide range of failure modes; aligned with industry standard retry classifications.
- **Against:** 429 with a long `Retry-After` may still get retried at the standard 2s/4s/8s cadence in G23 (the cron sweep then handles longer windows). Acceptable: future iteration can add `Retry-After` parsing if NoonWeb actually starts emitting it.

### D10 — Idempotency-key persistence on ledger (was OQ-10)

**Locked decision: persist on ledger.**

- The `idempotency_key` column (D2) is populated at row creation: `idempotency_key = '${external_proposal_id}:${decision}'` (D3).
- Every outbound POST (first attempt + retries + admin replay's spawned row) uses the SAME `idempotency_key` value from the ledger row.
- Admin replay's new row (D7) inherits the source row's `idempotency_key` verbatim — same key, same NoonWeb-side dedupe semantics.

**Consequence (load-bearing for cross-repo invariant):**

If NoonWeb already processed a `proposal_review_decision` for `(external_proposal_id, decision)` and the App admin replays the same logical decision, NoonWeb's receiver-side dedupe (R2 cross-repo contract) MUST return 200-with-prior-result. The App's new ledger row transitions to `delivered`. The cross-repo state is preserved as if the App's original failed attempt had succeeded — exactly the durability guarantee G23 promises.

If NoonWeb has NOT yet processed it (the failed attempt never reached NoonWeb successfully), the replay's first attempt drives normal processing. Either branch is observably correct from the App's perspective.

**Tradeoffs:**
- **For:** durability-preserving replay; safe under cross-repo dedupe; operator can replay aggressively without corrupting NoonWeb state.
- **Against:** an admin replay of a row that has the WRONG (corrupted) `idempotency_key` is permanently doomed to be dedupe'd. Mitigation: the key is deterministic from `(external_proposal_id, decision)`, both of which are immutable on the row; corruption would require DB-level tampering which is out of threat model.

### D11 — Replay endpoint identity argument (was OQ-11)

**Locked decision: ledger row UUID (`outbound_webhook_events.id`) is the replay endpoint's `[eventId]` argument.**

**Rationale:**

- A single `external_proposal_id` may have **multiple ledger rows** over its lifetime (one original `dead_letter` row + one admin-replay-spawned row + a second cron-driven follow-up, etc.). Using `external_proposal_id` as the replay argument is ambiguous in that case.
- UUID is **monotone-precise**: operators replay a SPECIFIC historical attempt; there is no question which row was meant.
- Response body includes `external_proposal_id` + `decision` + `endpoint` for operator confirmation, so the friendlier identifiers remain visible in the operator's terminal.
- Aligns with REST convention: the URL path identifies the resource; the resource here is "the ledger row," not "the proposal."

**Tradeoffs:**
- **For:** unambiguous; cron-driven and replay-driven attempts are individually addressable; operator workflow is: query ledger by `external_proposal_id` → copy the row's `id` → curl the replay endpoint.
- **Against:** UUIDs are operator-hostile (long, hard to type). Mitigation: operators always have shell completion / clipboard; UUIDs are standard in admin tooling across the App already.

**Additional architecture-surfaced decision (D12 — new):**

### D12 — Test seam: dispatcher accepts an injectable `fetch` + `now()` provider for deterministic unit tests

The retry math, jitter draw, and ledger-state transitions all depend on `Date.now()` and `Math.random()`. To keep unit tests deterministic and reliable:

- The dispatcher's pure-retry helper (`runOutboundWebhookDispatch` or similar — Backend final name) accepts an optional dependency object: `{ fetchImpl, now, randomFn, logger }`. Defaults to the production `fetch`, `Date.now`, `Math.random`, and the project logger.
- Tests inject scripted `fetchImpl` (returning a queue of 503/200 etc.), frozen `now`, and seeded `randomFn` for reproducible jitter.
- The Supabase admin client is also injected (via the existing `createSupabaseAdminClient()` indirection — tests substitute a stub client per existing patterns in `tests/server/`).

**Why surface this as a D-decision:** without this seam, Backend will reach for `vi.useFakeTimers` + `vi.spyOn(Math, 'random')` which is fragile across Node versions and harder to reason about than explicit injection. Architecture mandates the seam to keep `system-testing` deterministic.

**Tradeoffs:**
- **For:** integration-first methodology (spec §11) requires deterministic boundary tests; injection is the cleanest path.
- **Against:** the dispatcher signature is slightly more complex than a bare function. Acceptable: the production call sites pass no overrides, so they observe a clean default-argument call.

---

## Rationale

### Why mirror ADR-016 instead of one-offing

Same three reasons as ADR-016's D1 rationale, adapted for outbound:

1. **Structurally identical anatomy**: row claim, state machine, status enum, RLS posture, helper module signatures, operator query surface. Outbound differs only in direction-of-flight and which terminal states exist (`dead_letter` for outbound; `failed` for inbound).
2. **The differences are minimal and well-bounded**: outbound has its own state machine (`pending|delivered|dead_letter|replayed`) vs inbound (`processing|processed|failed`), but the lifecycle calls (claim → mark delivered / mark failed) and the operator query surface are isomorphic.
3. **Future outbound webhooks adopt the pattern by default**: if/when App emits `prototype_decision_relay`, `payment_confirmed_relay`, etc., the same anatomy + same helper module scaled by `endpoint` discriminator (D2) carries over.

### Why a sibling table, not extending `website_webhook_events`

Considered: add an `direction` discriminator to the existing `website_webhook_events` table, store both inbound and outbound in one place. Rejected because:

- **Different state machines.** Inbound is `processing|processed|failed`; outbound is `pending|delivered|dead_letter|replayed`. Squashing both into one CHECK constraint creates a non-composable enum where some values are invalid for some directions.
- **Different identity keys.** Inbound uses `(endpoint, signature_hash)` as UNIQUE; outbound doesn't have a stable single-shot signature hash because each retry signs with a fresh timestamp.
- **Different RLS posture in spirit** (both admin-read in practice, but operationally inbound and outbound are read for different reasons).
- **Operator queries are different**: inbound asks "did NoonWeb deliver?"; outbound asks "did we deliver to NoonWeb?" The mental model is cleaner with two tables.

Sibling table costs ~50 lines of migration SQL and ~250 lines of helper module — well within G23's iteration budget.

### Why `idempotency_key` on the ledger and not just a derived header

Storing it explicitly (D10) lets the admin replay endpoint re-emit the SAME key without re-deriving it from `(external_proposal_id, decision)`. Re-derivation would work today (the formula is stable) but couples the replay endpoint to the formula. If a future iteration changes the format (e.g., adds a version suffix `v2:prop_abc:approved`), the persisted column is forward-stable; re-derivation would silently use the new format and break NoonWeb dedupe for in-flight rows.

Same principle as storing `signature_header` (D2): forensic stability over formula re-derivation.

### Why the cron extends `webhook-failure-alert` instead of being its own alert cron

Three reasons (D6):

1. **Same operator surface** (`user_notifications` inbox with `webhook_failure` kind). Two crons emitting into the same surface is needless complexity.
2. **Same idempotency semantics** (the `enqueue_user_notification` UNIQUE constraint dedupes per `(profile, kind, source_event_id)`).
3. **Same authz** (`CRON_SECRET` bearer). Same template, same skeleton, same tests.

The retry-sweeper cron (D4) is SEPARATE from the alert cron because they have different cadences (5min sweep vs 24h alert) and different concerns (drive delivery vs notify operators). Two crons. The alert cron is the EXISTING one with one more ledger added; the sweeper cron is the NEW one.

---

## Consequences

### Outbound durability invariant established

After G23 ships, every PM-review-decision outbound POST produces exactly one durable ledger row trail. Transient failures heal automatically (inline retries + cron sweeper). Terminal failures are visible (`dead_letter` rows + operator notifications) and replayable (admin endpoint). The cross-repo `/portal/[projectId]` invariant is App-side ready; only NoonWeb-side dedupe enforcement (R2) remains, escalated.

### Wire envelope unchanged

NoonWeb sees the same JSON body, same HMAC signature, same headers — PLUS a new `X-Noon-Idempotency-Key` header on every POST. The new header is purely additive; NoonWeb can ignore it (today's behavior) or enforce it (the requested mitigation). No envelope-shape change, no breaking change.

`docs/integrations/cross-repo-webhook-v1.md` is updated to document the new header contract (Backend deliverable at iteration close, alongside the cross-repo escalation Docs handles).

### Future outbound webhooks inherit the pattern

Any future outbound webhook spec invokes this ADR by reference and inherits D1-D12 unless explicitly justified. Specifically:

- New endpoint → add to `outbound_webhook_events.endpoint` CHECK enum + reuse helper module's lifecycle calls.
- New retry algorithm → may override D1 numbers but MUST preserve the state machine (D2).

### Operational surface

Operator queries (admin-only, RLS-enforced):

```sql
-- Recent dead-letter events
select endpoint, external_proposal_id, decision, attempt_count, last_error, dead_lettered_at
from outbound_webhook_events
where status = 'dead_letter' and dead_lettered_at > now() - interval '24 hours'
order by dead_lettered_at desc;

-- In-flight (stuck pending) events older than 1 hour (cron should have caught them)
select id, endpoint, external_proposal_id, attempt_count, next_retry_at
from outbound_webhook_events
where status = 'pending' and next_retry_at < now() - interval '1 hour'
order by next_retry_at asc;

-- Replay chains
select source.id as original_id, source.dead_lettered_at,
       replay.id as replay_id, replay.status, replay.delivered_at
from outbound_webhook_events source
join outbound_webhook_events replay on replay.id = source.replayed_by_event_id
where source.status = 'replayed'
order by source.dead_lettered_at desc;
```

### Retention growth

Same posture as ADR-016 D8: documented 180-day retention, cleanup cron deferred. Bound at PM-review traffic × 1.0-1.05 amplification (most rows reach `delivered` in 1 attempt) → 10s-100s of rows/day → comfortably within Supabase free tier for years.

### Risk register

| Risk (from spec §9) | This ADR's lock | Residual |
|---|---|---|
| R1 amplification | D1 caps inline at 3 attempts (~14s); D4 caps cron at 50 rows/run | Bounded; alert via D6 |
| R2 cross-repo idempotency | D3 + D10 ship App-side ready; cross-repo signal recorded at closure | NoonWeb-side enforcement out-of-scope (Active risk) |
| R3 cron cadence collision | D4's `*/5 * * * *` is distinct minute slot from B25's daily 14:00; Infra verifies plan tier supports sub-hourly | Infra to confirm tier |
| R4 replay privilege escalation | D7 `requireRole(['admin'])` strict | Security verifies the 403 tests |
| R5 kill-switch ambiguity | D5 locks option-b (durability-preserving) | None |
| R6 backfill pre-G23 rows | OUT OF SCOPE (spec §4) | None |
| R7 NoonWeb portal not shipped | Validator accepts test + simulated evidence (spec AC-15) | None |
| R8 ADR-027 not ADR-026 | This file is correctly numbered ADR-027 | None |

### Migration coupling

Backend writes `supabase/migrations/0062_phase_3r5_outbound_webhook_events.sql` per D2. Architecture does NOT pre-write the SQL body — Backend's deliverable. The shape (columns + indexes + RLS) is locked above.

`database.types.ts` regen path follows ADR-016 D10 (clean regen preferred; manual override fallback). Backend / Infra coordinate at apply time.

---

## Implementation contract (for Backend)

### Migration shape (Backend writes `0062_phase_3r5_outbound_webhook_events.sql`)

Architecture-signed shape — Backend authors the actual SQL using D2's column list verbatim. Must be idempotent (`create table if not exists`, `create index if not exists`, `drop policy if exists` then `create policy`). Must enable RLS. Must register the admin-read policy. Must include comments referencing this ADR.

### Helper module `lib/server/website/outbound-webhook-events.ts`

Architecture-signed signatures (Backend implements; final names at Backend's discretion if equivalent semantics):

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>

export type OutboundWebhookEndpoint = 'proposal-review-decision'
export type OutboundWebhookStatus = 'pending' | 'delivered' | 'dead_letter' | 'replayed'
export type OutboundWebhookDecision =
  | 'approved' | 'rejected' | 'changes_requested' | 'cancelled'

export interface OutboundWebhookEventInput {
  endpoint: OutboundWebhookEndpoint
  externalProposalId: string
  decision: OutboundWebhookDecision
  linkId: string | null
  proposalId: string | null
  payloadHash: string
  signatureHeader: string | null         // populated post-first-attempt
  idempotencyKey: string                 // computed from D3 formula
  requestId: string | null
  actorId: string | null
  maxAttempts?: number                   // default 3 (D1)
}

export interface OutboundWebhookEventRecord {
  eventId: string
  endpoint: OutboundWebhookEndpoint
  status: OutboundWebhookStatus
  attemptCount: number
  nextRetryAt: string | null
  externalProposalId: string
  decision: OutboundWebhookDecision
  idempotencyKey: string
  linkId: string | null
  // … (full row shape)
}

/** Insert a fresh outbound ledger row with status='pending', attempt_count=0. */
export async function createOutboundWebhookEvent(
  client: DatabaseClient,
  input: OutboundWebhookEventInput,
): Promise<OutboundWebhookEventRecord>

/** Bump attempt_count + 1 before each fetch. Sets last_attempted_at = now(). */
export async function beginOutboundAttempt(
  client: DatabaseClient,
  eventId: string,
): Promise<{ attemptCount: number }>

/** Terminal happy path: status='delivered', delivered_at=now(), last_http_status. */
export async function markOutboundDelivered(
  client: DatabaseClient,
  eventId: string,
  outcome: { httpStatus: number },
): Promise<void>

/** Non-terminal failure: schedule next retry. status stays 'pending'. */
export async function scheduleOutboundRetry(
  client: DatabaseClient,
  eventId: string,
  outcome: { lastError: string; lastHttpStatus: number | null; nextRetryAt: string },
): Promise<void>

/** Terminal failure: status='dead_letter', dead_lettered_at=now(). */
export async function markOutboundDeadLetter(
  client: DatabaseClient,
  eventId: string,
  outcome: { lastError: string; lastHttpStatus: number | null },
): Promise<void>

/** Admin replay: spawn a new row inheriting source's identity keys; transition source. */
export async function spawnOutboundReplay(
  client: DatabaseClient,
  sourceEventId: string,
): Promise<{ sourceEventId: string; newEventId: string }>

/** Operator query helper: fetch ledger row by id. */
export async function getOutboundWebhookEvent(
  client: DatabaseClient,
  eventId: string,
): Promise<OutboundWebhookEventRecord | null>

/** Cron sweep: claim up to N pending rows whose next_retry_at is due. */
export async function claimOutboundPendingDue(
  client: DatabaseClient,
  options: { limit: number; now: string },
): Promise<OutboundWebhookEventRecord[]>

/** Env-var read at module load (mirrors WEBSITE_WEBHOOK_LEDGER_ENABLED). */
export function outboundWebhookInlineRetryEnabled(): boolean
```

### Dispatcher refactor shape (Backend rewraps `sendProposalReviewDecisionToWebsite`)

```typescript
// Pseudocode — Backend implements the actual structure
export async function sendProposalReviewDecisionToWebsite(
  proposalId: string,
  action: WebsiteReviewAction,
  actor?: { id?: string; email?: string; role?: string },
  // D12 — injectable for tests; defaults in production
  deps?: {
    fetchImpl?: typeof fetch
    now?: () => Date
    randomFn?: () => number
    client?: DatabaseClient
  },
) {
  const client = deps?.client ?? createSupabaseAdminClient()
  const link = await getLinkByProposalId(client, proposalId)
  if (!link) return { applicable: false as const, status: 'not_applicable' }

  // … existing proposal lookup + review_status check (unchanged)

  const url = getProposalReviewDecisionWebhookUrl()
  if (!url) {
    // existing snapshot write (unchanged)
    return { applicable: true as const, status: 'skipped', reason: '...' }
  }

  const bodyText = JSON.stringify({ /* unchanged envelope */ })
  const idempotencyKey = `${link.external_proposal_id}:${reviewDecisionByAction[action]}`
  const payloadHash = sha256Hex(bodyText)

  // D2/D5 — always create ledger row (durability-preserving)
  const event = await createOutboundWebhookEvent(client, {
    endpoint: 'proposal-review-decision',
    externalProposalId: link.external_proposal_id,
    decision: reviewDecisionByAction[action],
    linkId: link.id,
    proposalId,
    payloadHash,
    signatureHeader: null,
    idempotencyKey,
    requestId: /* derive */,
    actorId: actor?.id ?? null,
  })

  const inlineRetryOn = outboundWebhookInlineRetryEnabled()
  const maxAttempts = inlineRetryOn ? 3 : 1                     // D5 kill-switch

  let lastError: { message: string; httpStatus: number | null } | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await beginOutboundAttempt(client, event.eventId)
    const headers = {
      ...signWebsitePayload(bodyText),
      'X-Noon-Idempotency-Key': idempotencyKey,                 // D3
    }
    try {
      const response = await (deps?.fetchImpl ?? fetch)(url, { method: 'POST', headers, body: bodyText })
      if (response.ok) {
        await markOutboundDelivered(client, event.eventId, { httpStatus: response.status })
        await writeLinkSnapshotSent(client, link.id, /* now */)  // D8 snapshot preserved
        return { applicable: true as const, status: 'sent', eventId: event.eventId }
      }

      const isClientError = response.status >= 400 && response.status < 500 && response.status !== 429
      if (isClientError) {
        // D9 — 4xx terminal, no retry
        const body = await response.text().catch(() => '')
        await markOutboundDeadLetter(client, event.eventId, {
          lastError: body || `HTTP ${response.status}`,
          lastHttpStatus: response.status,
        })
        await writeLinkSnapshotFailed(client, link.id, body)
        return { applicable: true as const, status: 'failed', httpStatus: response.status, eventId: event.eventId }
      }

      lastError = { message: (await response.text().catch(() => '')) || `HTTP ${response.status}`, httpStatus: response.status }
    } catch (err) {
      lastError = { message: err instanceof Error ? err.message : String(err), httpStatus: null }
    }

    if (attempt < maxAttempts) {
      const delayMs = computeBackoffMs(attempt, deps?.randomFn ?? Math.random)
      const nextRetryAt = new Date((deps?.now?.() ?? new Date()).getTime() + delayMs).toISOString()
      await scheduleOutboundRetry(client, event.eventId, {
        lastError: lastError.message,
        lastHttpStatus: lastError.httpStatus,
        nextRetryAt,
      })
      await sleep(delayMs)                                       // inline; cron picks up if process dies
    }
  }

  // Exhausted: dead-letter
  await markOutboundDeadLetter(client, event.eventId, {
    lastError: lastError?.message ?? 'unknown',
    lastHttpStatus: lastError?.httpStatus ?? null,
  })
  await writeLinkSnapshotFailed(client, link.id, lastError?.message ?? 'unknown')
  return { applicable: true as const, status: 'failed', error: lastError?.message, eventId: event.eventId }
}
```

(Pseudocode — exact structure at Backend's discretion. The contract is: D1-D12 honored.)

### Cron handler shape `app/api/cron/outbound-webhook-retry/route.ts`

Skeleton mirrors `app/api/cron/webhook-failure-alert/route.ts`:

- `CRON_SECRET` bearer auth → 401 on miss (B25 pattern).
- `?dryRun=true` returns counts + candidate row ids; no fetches fired.
- `claimOutboundPendingDue(client, { limit: 50, now: new Date().toISOString() })` (D4).
- For each claimed row: invoke the dispatcher's retry loop (via a thin wrapper that takes the ledger row instead of `proposalId`). Each cron-driven attempt counts toward `max_attempts`; cron does NOT have its own retry budget (D4).
- Structured `logger.info('cron.outbound_webhook_retry.done', { …counts })` and `logger.error` on failure paths.
- Returns JSON summary.

### Admin replay endpoint shape `app/api/admin/outbound-webhooks/[eventId]/replay/route.ts`

```typescript
export async function POST(request: Request, { params }: { params: { eventId: string } }) {
  await requireRole(['admin'])  // D7 — strict; 403 on non-admin, 401 on unauth
  const client = createSupabaseAdminClient()
  const source = await getOutboundWebhookEvent(client, params.eventId)
  if (!source) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  switch (source.status) {
    case 'delivered':
    case 'replayed':
      return NextResponse.json({ idempotent: true, noop: true, eventId: source.eventId, ... }, { status: 200 })
    case 'pending':
      return NextResponse.json({ error: 'event_in_pending_state', eventId: source.eventId, nextRetryAt: source.nextRetryAt }, { status: 409 })
    case 'dead_letter': {
      const { newEventId } = await spawnOutboundReplay(client, source.eventId)
      // Drive the new row through the dispatcher's retry loop synchronously
      const outcome = await driveReplayDispatch(client, newEventId)
      return NextResponse.json({ idempotent: false, replayed: true, sourceEventId: source.eventId, newEventId, status: outcome.status, ... }, { status: 200 })
    }
  }
}
```

### `webhook-failure-alert` cron extension shape (D6)

Add a third ledger scan in `app/api/cron/webhook-failure-alert/route.ts`:

```typescript
const [stripeRes, websiteRes, outboundRes, adminRes] = await Promise.all([
  // existing stripeRes
  // existing websiteRes
  client
    .from('outbound_webhook_events')
    .select('id, endpoint, external_proposal_id, decision, dead_lettered_at, last_error')
    .eq('status', 'dead_letter')
    .gte('dead_lettered_at', cutoff),
  // existing adminRes
])

// existing loop for stripeFailures
// existing loop for websiteFailures
for (const row of outboundFailures) {
  const errSummary = (row.last_error ?? '').slice(0, 200)
  await enqueueOne(
    'outbound',
    row.id,
    row.id,                                  // UUID; no MD5 hashing
    'Outbound webhook fallido',
    `${row.endpoint} (${row.external_proposal_id}/${row.decision}) dead-letter. ${errSummary}`.trim(),
    '/dashboard/settings'
  )
}
```

### Env-var reference update

Add to `.env.example`:

```
# Outbound webhook retry (G23 / ADR-027 D5)
# - 'true' / unset (default): full inline retry-with-backoff (3 attempts, 2s/4s/8s ±25% jitter)
# - 'false' (case-insensitive): kill-switch. Inline retry disabled. Ledger row still written
#   as 'dead_letter' on first failure (durability-preserving). Cron sweeper still active;
#   admin replay endpoint still functional.
NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED=true
```

(`NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` and `CRON_SECRET` are already present — no changes.)

---

## Drift verifications surfaced

| Assumption in spec / handoff | Status | Notes |
|---|---|---|
| Next free migration prefix `0062` | **VERIFIED FREE** | `supabase/migrations/006*.sql` shows only `0060` + `0061`. `0062` is the correct next prefix. |
| Next free ADR number `ADR-027` | **VERIFIED FREE** | `docs/adrs/ADR-02*.md` shows `ADR-020..ADR-026` taken; `ADR-027` is correct. |
| `enqueue_user_notification` RPC signature | **VERIFIED** | 8-arg signature confirmed against `0039_phase_16b_rpc_and_client_portal_security.sql:96`. `next_source_event_id` is `uuid`, so outbound ledger's UUID `id` flows directly (no MD5 hashing needed; mirrors website-failure path at `webhook-failure-alert/route.ts:201-209`). |
| `website_inbound_links` snapshot columns (`review_webhook_status`, `review_webhook_attempted_at`, `review_webhook_sent_at`, `review_webhook_error`, `current_status`) | **VERIFIED PRESENT** | Confirmed against `0034_phase_14a_website_inbound_integration.sql:14-44`. CHECK constraint allows only `pending|sent|failed|skipped` for `review_webhook_status` and a fixed set for `current_status` including `review_webhook_sent|review_webhook_failed`. **No new values added by G23** — D8 mapping uses existing values only. |
| `WEBSITE_WEBHOOK_LEDGER_ENABLED` reading discipline (env var, module load, default ON) | **VERIFIED** | Confirmed in `lib/server/website/webhook-events.ts:42-66`. D5 mirrors verbatim. |
| `CRON_SECRET` env var pattern + dryRun flag pattern | **VERIFIED** | Confirmed in `webhook-failure-alert/route.ts:29-44, 74-131`. New cron handler mirrors. |
| Two call sites for `sendProposalReviewDecisionToWebsite` (spec §8 A6 / E-2) | **VERIFIED** | Both call sites pass through the same library function; D2/D5 changes are internal to the function. **No call-site changes required.** |
| Vercel `*/5 * * * *` cadence support | **NOT VERIFIED — escalated to Infra** | All five existing crons in `vercel.json` are daily. This would be the first sub-hourly cron in the project. Infra MUST verify the Vercel plan tier supports it before the cron entry is registered. Backend codes as if `*/5` is final; if Infra discovers a tier limit, fallback is `0 * * * *` hourly with `max_attempts` bump from 3 to ~5 to compensate, OR plan-tier upgrade as part of G23. |
| `getRequestId(...)` helper availability for outbound contexts | **PARTIALLY VERIFIED** | The helper is request-scoped in `lib/server/api/`. For the cron and dispatcher paths (no incoming Request object), Backend either (a) generates a fresh UUID locally and stores as `request_id`, or (b) propagates from the calling Request when available. ADR-027 D2 allows `request_id` to be nullable in cron-driven cases; Backend chooses the form. |

**No drift verification failed.** All assumptions in the spec hold against repo state. The one unresolved item (Vercel cadence) is documented as an Infra dependency, not a blocking architectural gap.

---

## References

- ADR-016 — transport-level webhook ledger pattern (inbound). Mirrored anatomy.
- ADR-014 — migration ledger reconciliation (manual-apply + INSERT fallback).
- ADR-006 — migration prefix convention (4-digit, next free 0062).
- TDR-003 — Stripe inbound ledger (structural precedent).
- `specs/fase-3-r5-outbound-webhook-retry-policy.md` — iteration spec (this ADR's input).
- `docs/handoffs/2026-05-26-g23-outbound-retry-router-decision.md` — router decision.
- `docs/integrations/cross-repo-webhook-v1.md` — wire contract (gets new §X for outbound retry).
- `lib/server/website-integration.ts:683-813` — `sendProposalReviewDecisionToWebsite` (rewrapped by Backend).
- `lib/server/website/webhook-events.ts` — inbound ledger sibling (template).
- `supabase/migrations/0051_phase_20a_website_webhook_event_ledger.sql` — inbound schema (precedent).
- `app/api/cron/webhook-failure-alert/route.ts` — cron + alert template (D6 extends; D4 mirrors).
- `supabase/migrations/0034_phase_14a_website_inbound_integration.sql` — `website_inbound_links` schema (D8 dual-track partner).
- `supabase/migrations/0039_phase_16b_rpc_and_client_portal_security.sql:96` — `enqueue_user_notification` RPC signature.

---

**Signed-off:** system-architecture (G23 Architecture skill, 2026-05-26). Ready for Backend implementation against `specs/fase-3-r5-outbound-webhook-retry-policy.md` § "Architecture firm decisions" (appended in spec amendment).
