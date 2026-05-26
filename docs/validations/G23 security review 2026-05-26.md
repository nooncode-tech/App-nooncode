# G23 Security Review — Outbound Webhook Retry + Dead-Letter Ledger

**Date:** 2026-05-26
**Reviewer:** system-security (G23 MANDATORY gate)
**Depth:** DEEP (auth, persistence, cross-repo signal, kill-switch, admin replay)
**Verdict:** **GATE-OPEN.** No CRITICAL or HIGH findings. One MEDIUM (M1) and several LOW/INFO hardening items below.

## Scope summary

Reviewed: ADR-027 D1–D12 firm decisions, spec §19 hard constraints, and the shipped implementation surfaces:
- `lib/server/website/outbound-webhook-events.ts` (helper + kill-switch)
- `lib/server/website-integration.ts` lines 698–1617 (dispatcher rewrap + cron sweep driver + admin replay driver)
- `app/api/cron/outbound-webhook-retry/route.ts` (cron handler)
- `app/api/admin/outbound-webhooks/[eventId]/replay/route.ts` (admin replay endpoint)
- `app/api/cron/webhook-failure-alert/route.ts` (D6 extension)
- `supabase/migrations/0062_phase_3r5_outbound_webhook_events.sql` (RLS + indexes)
- Auxiliary verified: `lib/server/website-webhook-auth.ts`, `lib/server/auth/guards.ts`, `lib/server/api/logger.ts`, `vercel.json`, `.env.example`, `supabase/migrations/0034_phase_14a_website_inbound_integration.sql` (uniqueness constraint).

Cross-referenced precedent: `docs/validations/B15 security review 2026-05-20.md` (sibling inbound ledger).

Out of scope per directive: NoonWeb-side receiver hardening (R2 cross-repo), DAST, load testing.

---

## Threat surface findings

### S1 — Outbound amplification under sustained receiver outage (R1)

**Surface:** sustained NoonWeb 5xx / network outage producing retry storms.

**Audit:**
- Inline cap: `OUTBOUND_RETRY_MAX_ATTEMPTS = 3` (`website-integration.ts:727`), enforced in `driveDispatchLoop` `while (attempt < input.maxAttempts)` at line 975. Verified: a row exhausting attempts is force-transitioned to `dead_letter` on lines 1040–1044.
- Cron cadence: `*/5 * * * *` (`vercel.json:25`). Batch cap: `DEFAULT_BATCH_SIZE = 50` clamped on lines 50–53 of the cron route. Operator-supplied `limit` is bounded `0 < n <= 50`.
- Cron shares the same `max_attempts` budget (D4). `claimOutboundPendingDue` filters in JS `row.attempt_count < row.max_attempts` (`outbound-webhook-events.ts:544`). Once attempt_count reaches max_attempts the row stops being eligible.
- However, cron's call into `driveDispatchLoop` passes `inlineRetryEnabled: true` AND `maxAttempts: row.maxAttempts` (`website-integration.ts:1337, 1333`). The loop will burn the entire remaining budget AND the inline `sleepImpl(delayMs)` runs INSIDE the cron-invoked path (up to ~10s each between attempts).
- A 50-row batch × up to ~14s per row sequential = up to ~700s (~12 min) wall-clock. With `*/5 *` cadence and Vercel default function timeout (~10s on Hobby, up to 60s default on Pro, configurable to 5min/15min), the cron handler could time out before completing the batch. **Time-out is the natural amplification ceiling.** A timed-out cron run leaves rows partially-processed but durable (next cron picks them up).
- Kill-switch (D5) does NOT disable the cron — by design (durability-preserving). An operator panic of `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED=false` collapses inline to 1 attempt but the cron continues to drive `pending` rows. ADR-027 D5 explicitly accepts this; documented.

**Verdict — M1 (MEDIUM): cron sweep wall-clock cost is unbounded by handler-level budget.** The loop in `runOutboundWebhookCronSweep` (lines 1303–1381) processes candidates serially with the in-loop `sleepImpl` for backoff. There is no overall handler-level deadline. Under sustained outage with 50 candidates × 3-remaining attempts × ~14s backoff, the cron could exceed even Vercel Pro's 5min cap. Mitigation in place: Vercel runtime timeout itself bounds it; subsequent cron run picks up where the previous left off. Not load-bearing for correctness. Recommendation R-1 below.

Severity: **MEDIUM** (operator-visible noise + Vercel function-timeout log noise under outage; no correctness impact).

---

### S2 — Cross-repo replay attack (R2)

**Surface:** attacker captures a signed outbound POST off the wire and replays it to NoonWeb.

**Audit:**
- HMAC: `signWebsitePayload` (`website-webhook-auth.ts:118–130`) signs `${timestamp}.${bodyText}` with HMAC-SHA256 over `NOON_WEBSITE_WEBHOOK_SECRET`. Timestamp is current epoch-seconds at sign time.
- NoonWeb's verifier (mirror of the App's verifier on `website-webhook-auth.ts:30–44`) enforces `MAX_CLOCK_SKEW_SECONDS = 300` (±5 minutes). A captured request is replayable for at most 5 minutes against NoonWeb.
- Each App retry RE-SIGNS with a fresh timestamp (verified `runSingleAttempt` line 888: `const headers = signWebsitePayload(bodyText)` inside the per-attempt function, NOT outside). Cached signature is forbidden by code structure — there is no carry-across of the header.
- `X-Noon-Idempotency-Key = <external_proposal_id>:<decision>` (D3): predictable to anyone who knows the external_proposal_id, BUT the idempotency key is NOT a credential. It is a dedup hint for the receiver. The HMAC over `${timestamp}.${bodyText}` is the authentication primitive.

**Verdict — LOW.** Within the ±5min window an off-the-wire replay COULD reach NoonWeb if TLS were broken (out of threat model). Inside the window: replays drive NoonWeb's de-dupe (cross-repo R2 contract, escalated). Outside the window: replays fail the timestamp check on NoonWeb. The new `X-Noon-Idempotency-Key` header does NOT leak any new authentication material — `external_proposal_id` is already in the JSON body, and `decision` is in the body too. The header is purely an additive dedup hint.

Severity: **LOW**.

---

### S3 — Admin replay endpoint authz

**Surface:** unauthenticated or non-admin caller attempts to trigger replay.

**Audit:**
- Route handler (`app/api/admin/outbound-webhooks/[eventId]/replay/route.ts:33`): `await requireRole(['admin'])` is the FIRST statement inside `try`. Throws `AuthGuardError` with status 401 (unauthenticated) or 403 (non-admin / inactive profile). `toErrorResponse` on line 119 emits the right HTTP code from `AuthGuardError.status`.
- `requireRole` chain (`guards.ts:105–119`): `assertAuthEnabled` → `requireSession` (401 if no session) → `requirePrincipal` (403 if no profile / inactive) → role check (403 if not in `['admin']`). PM, sales_manager, developer, sales_rep all reject with 403.
- Service-role bypass: there is NO service-role-key path that reaches the route. The handler uses `requireRole` which depends on `getCurrentSession()` from cookies. There is no `Bearer ${CRON_SECRET}`-style bypass.
- Eventid is `z.string().uuid()` parsed (line 25, 34). Non-UUID returns 400 via `ZodError` → `toErrorResponse`. NO eventId pre-validation leak — an attacker probing a malformed UUID gets 400 BEFORE the admin role is checked? **Check order:** in the handler `requireRole` runs BEFORE `routeParamsSchema.parse(await context.params)`. Good — authz fires first, no probing oracle.
- `not_found` (HTTP 404) on a UUID that doesn't exist (`driveAdminOutboundReplay` returns `{ kind: 'not_found' }`). This DOES disclose to an authenticated admin whether a given UUID is present in the ledger. However, the endpoint is admin-only, and admins have direct SELECT on the table via RLS — no incremental disclosure.
- GET / PUT / DELETE / PATCH: only GET is defined and returns 405 (line 123). PUT/DELETE/PATCH would fall through to Next.js default (405). Acceptable.
- Method-level CSRF: this is a state-mutating POST. Next.js + Supabase SSR cookies — there is no anti-CSRF token. The endpoint requires admin role (very narrow), AND the body is empty (`_request` is unused). However, an admin-session CSRF could trigger replay via a crafted form. Spawning a replay re-emits the same idempotency-key — NoonWeb-side de-dupe (R2) makes this a no-op. Worst case: an attacker who can CSRF an admin into POSTing to a random `[eventId]/replay` URL drives one extra retry against NoonWeb for that already-dead-lettered event. Bounded; LOW.

**Verdict — LOW.** Authz is strict and correctly ordered. No PM / sales_manager / developer / unauthenticated access. `routeParamsSchema.parse` after `requireRole` prevents an enumeration oracle. Open CSRF surface is bounded by D10 idempotency-key inheritance.

Severity: **LOW**.

---

### S4 — Cron handler authz

**Surface:** unauthenticated request to `/api/cron/outbound-webhook-retry` triggers a sweep.

**Audit:**
- `isCronAuthorized` (`outbound-webhook-retry/route.ts:24–28`): `request.headers.get('authorization')` must equal `Bearer ${CRON_SECRET}`. Missing CRON_SECRET in env causes `isCronAuthorized` to return `false` (line 26) — fail-closed.
- Mirrors B25 pattern: `webhook-failure-alert/route.ts:36–40` is identical (verified verbatim). Same fail-closed posture.
- GET and POST both gated. Both call `handleCronRequest`. 401 on miss/wrong bearer.
- `dryRun` query param does NOT bypass authz (authz check is first; `dryRun` is parsed after).
- Timing: `auth === \`Bearer ${CRON_SECRET}\`` uses `===` not constant-time compare. **Theoretical timing leak**: an attacker measuring response time differences could probe for the CRON_SECRET char-by-char. However: `CRON_SECRET` is high-entropy (operator-generated random), and V8's string `===` short-circuits at the FIRST differing byte AFTER length check — but length comparison is constant. Practical attack would require >>2^128 probes against a 256-bit secret over a noisy network. Indistinguishable from network jitter. Same posture as the four existing crons (consolidate-earnings, cleanup-revoked-tokens, project-sla-breach-alert, webhook-failure-alert) — none use `crypto.timingSafeEqual`. Pre-existing repo-wide condition, not a G23 regression.

**Verdict — LOW.** Matches B25 closure precedent verbatim. Fail-closed if CRON_SECRET unset. Theoretical timing leak is repo-wide pre-existing condition; if escalated, fix across all 5 crons in a separate iteration.

Severity: **LOW** (INFO if accounting as pre-existing pattern parity).

---

### S5 — Service-role write-only on `outbound_webhook_events`

**Surface:** authenticated users (or anon) reach the ledger table via Supabase client.

**Audit:**
- RLS enabled (`0062_phase_3r5_outbound_webhook_events.sql:95`).
- One SELECT policy: `outbound_webhook_events_admin_read` (lines 97–111) — `authenticated` role, `user_profiles.role = 'admin' AND is_active = true`.
- NO INSERT / UPDATE / DELETE policies. PostgreSQL RLS denies by default when RLS is enabled and no policy permits the operation. Anon and authenticated cannot write.
- `grant select on public.outbound_webhook_events to authenticated;` (line 113) — works through the SELECT policy. No INSERT/UPDATE/DELETE grants to authenticated.
- `grant all on public.outbound_webhook_events to service_role;` (line 114) — service_role bypasses RLS, can write.
- Helper module (`outbound-webhook-events.ts:30–32`): `outboundTable(client)` returns the table via `client.from(...)`. The `DatabaseClient` type is `SupabaseClient<Database>` (line 28). The CALLER controls which client is passed in. All call sites in `website-integration.ts` pass `createSupabaseAdminClient()` (line 1068 dispatcher, 1281 cron sweep, 1487 admin replay driver). The cron route handler passes `createSupabaseAdminClient()` (line 55 of `route.ts`). Admin replay route handler does NOT pass a client — it uses the default `deps.client ?? createSupabaseAdminClient()` (line 1487).
- **Concern:** is the admin replay endpoint write using `createSupabaseAdminClient()` (service_role) or the admin user's session cookie? Verified: `driveAdminOutboundReplay` (line 1483) defaults `client = deps.client ?? createSupabaseAdminClient()`. The route handler does NOT pass `client`, so it gets `createSupabaseAdminClient()`. Service-role. Good — the admin's user JWT is NOT used to write to the ledger.
- An admin who somehow obtained service_role could write directly; that is the standard service-role threat-model boundary, identical to ADR-016 D7.

**Verdict — LOW.** RLS posture mirrors inbound ledger verbatim. All write paths confirmed to flow through `createSupabaseAdminClient()`. No authenticated-session JWT writes.

Severity: **LOW**.

---

### S6 — HMAC secret rotation safety

**Surface:** operator rotates `NOON_WEBSITE_WEBHOOK_SECRET` while pending / dead-letter rows exist.

**Audit:**
- `readSharedSecret()` (`website-webhook-auth.ts:18–24`) reads `process.env.NOON_WEBSITE_WEBHOOK_SECRET` on EVERY call — NOT cached. `signWebsitePayload` (line 118) calls `readSharedSecret()` on every sign. After rotation + container restart, all subsequent signs use the new secret.
- A `dead_letter` row replayed AFTER rotation will be signed with the NEW secret. NoonWeb (configured with the SAME new secret simultaneously) will verify successfully. NoonWeb (still on the OLD secret) will reject the signature. Operator runbook responsibility (cross-repo coordination).
- The ledger stores `signature_header` (the LAST signature header sent, refreshed each attempt). Stored value is forensic-only — NOT used for replay re-derivation. `spawnOutboundReplay` (`outbound-webhook-events.ts:425–492`) does NOT copy `signature_header` to the new row (line 456 sets `signature_header: null`). The dispatcher re-signs from scratch on the spawned row's first attempt. Good — no stale signature reuse.
- `idempotency_key` is preserved across replay (D10), but the HMAC signature is recomputed. NoonWeb-side de-dupe sees the same idempotency-key with a fresh, valid signature.
- Concern: if NoonWeb and App rotate at different moments, an in-flight inline retry between attempts (with `setTimeout` mid-sleep) MAY span the boundary. The next attempt re-reads `readSharedSecret()`, so within a single process the secret reads are consistent until the process restarts (a typical rotation procedure restarts the container). Bounded.
- No env-var caching in the kill-switch (line 117 `INLINE_RETRY_ENABLED = readInlineRetryFlag()`) — this IS cached at module load. The HMAC secret is NOT cached. Different posture, both intentional.

**Verdict — LOW.** HMAC secret rotation is operator-runbook territory (cross-repo coordination required). The code does NOT prevent rotation, and stored signature headers are forensic-only (no replay-from-storage path). Spawn-replay deliberately nulls `signature_header` to force fresh signing.

Recommendation: Docs (R-2 below) should document the rotation runbook.

Severity: **LOW**.

---

### S7 — Ledger payload disclosure

**Surface:** raw outbound payload bytes leak via logging, error responses, or admin endpoint responses.

**Audit:**
- Migration stores `payload_hash text not null` (line 38), NO `payload_bytes` column. ADR-027 D2 "no raw payload storage" honored verbatim.
- Body is reconstructable in cron sweep via `rebuildProposalReviewDecisionBody` (line 1386) which joins `website_inbound_links` + `lead_proposals`. The reconstruction happens only inside the dispatcher; it is NOT returned to any client.
- Admin replay response shape (`route.ts:50–113`): exposes `eventId`, `externalProposalId`, `decision`, `deliveredAt`, `replayedByEventId`, `nextRetryAt`, `status`, `httpStatus`, `errorMessage`. No payload bytes. NO `bodyText`, no PII fields.
- Cron handler response (`route.ts:88–101`): `delivered: string[]` (event IDs), `deadLettered: string[]`, `pending: string[]`, `errors`. No payload bytes.
- `errorMessage` in replay response carries `last_error` which is clipped to 1000 chars (`outbound-webhook-events.ts:222–225`). `last_error` is sourced from receiver body snippets when 5xx/429 (`website-integration.ts:908: const bodySnippet = await response.text().catch(() => '')`). **Verify: does NoonWeb 5xx body ever echo our payload?** It could in theory (e.g., a NoonWeb 500 page that includes echo of the request). However: (a) this is a server-to-server channel, (b) NoonWeb is a trusted partner (we sign requests TO it), (c) the field is clipped at 1000 chars, (d) the admin replay endpoint that surfaces it is admin-only. Bounded.
- Logger (`api/logger.ts:15`): redacts keys matching `secret|password|token|authorization|cookie|signature|key|credential` and truncates string values >500 chars. `last_error` carrying receiver text would pass through (no sensitive key match), but capped at 500 chars in logs. No log path emits the rebuilt `bodyText` — verified via `Grep` of `bodyText` in `website-integration.ts`: all uses are inside the dispatcher, never as a `logger.*` argument.
- `payload_hash` is sha256 of the (PII-bearing) body, which is one-way and not PII (B15 §S5 precedent applies).
- `external_proposal_id`, `external_session_id`, `idempotency_key = external_proposal_id:decision` — pseudonymous identifiers, same posture as B15 §S5.
- No `inbound_payload` JSONB on the outbound ledger (that lives only on `website_inbound_links`).

**Verdict — LOW.** Posture mirrors inbound ledger (B15 §S5). One INFO note: a hostile NoonWeb 5xx could in theory inject content into our `last_error` (server-controlled by NoonWeb). Capped at 1000 chars on ledger, 500 in logs, admin-only read. Low severity. Recommendation R-3 below.

Severity: **LOW**.

---

### S8 — Kill-switch bypass

**Surface:** attacker manipulates env var to disable outbound delivery, or `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` is parsed loosely.

**Audit:**
- Parsing (`outbound-webhook-events.ts:99–115`): `raw === undefined → true`; `.trim().toLowerCase()` then `normalized === 'false' → false`; anything else → warn + default to true.
- ONLY the literal lowercased `'false'` (after trim) disables. `'0'`, `'False'`, `'FALSE'`, `'no'`, `'disabled'`, `'off'`, empty string, etc., all PASS through to enabled (with one-time `console.warn`). Verified line 108: `if (normalized !== 'true') console.warn(...)` — note that `'False'` would warn and default to true (matches B15 §S7 precedent).
- Single read at module load (line 117). Mirrors `WEBSITE_WEBHOOK_LEDGER_ENABLED` (B15 reference).
- Env-var injection: an attacker who can write env vars to set this to `'false'` has already compromised the operator's secrets/deployment posture (out of threat model). The fail-safe is the right way around: an accidental typo defaults to ENABLED (retry on), preserving cross-repo invariant.
- Coverage: when `false`, `effectiveMaxAttempts = 1` (`website-integration.ts:1198`) — one attempt → if non-2xx → dead_letter immediately. Cron sweep does NOT read the flag (it reads `outbound_webhook_events` directly). Admin replay does NOT read the flag (it spawns a new row + drives via `driveDispatchLoop` with `inlineRetryEnabled: true`, regardless of the env). This matches ADR-027 D5 coverage decision verbatim — and is the durability-preserving outcome.

**Verdict — LOW.** Strict parsing (only literal `'false'` disables), fail-safe defaults, B15 precedent honored. Kill-switch coverage matches D5 verbatim.

Severity: **LOW**.

---

### S9 — Forgery via signature header (chain dependency on B15)

**Surface:** inbound `X-Webhook-Signature` to App is forged → triggers PM review queue insertion → PM approves → outbound webhook side-effect.

**Audit:**
- This is INBOUND attack surface (covered by B15 security review). G23 inherits the chain.
- The inbound HMAC chain: `readSignedWebsiteJsonWithRawBody` → `verifyWebsiteWebhookSignature` (`website-webhook-auth.ts:57–73`) → `assertRecentTimestamp` (±5min) → `timingSafeEquals` (constant-time HMAC compare). All verified in B15. No regression introduced by G23.
- The outbound side-effect is itself ledger-recorded (G23 contribution). If a forged inbound somehow got through (B15 vulnerability), the outbound dispatch would produce an `outbound_webhook_events` row that admins could detect. G23 IMPROVES the auditability of the post-compromise blast radius. Net-positive.
- The new outbound code does NOT introduce a new inbound surface. Both call sites (`app/api/proposals/[proposalId]/review/route.ts:65` and `app/api/inbound/pm-queue/[proposalId]/review-webhook/route.ts:46`) gate the OUTBOUND dispatch behind `requireRole(['admin', 'pm'])` — verified at line 32 of `proposals/[proposalId]/review/route.ts` and line 26 of `pm-queue/.../review-webhook/route.ts`. An attacker would need a logged-in admin/PM session to trigger outbound, OR a forged inbound that survives B15's HMAC. No new chain weakness.

**Verdict — INFO.** B15 coverage holds. G23 strictly improves auditability of compromised-inbound scenarios via the new outbound ledger.

Severity: **INFO**.

---

### S10 — Idempotency-key collision

**Surface:** two distinct logical decisions produce the same `<external_proposal_id>:<decision>` key, causing NoonWeb-side de-dupe to drop the second.

**Audit:**
- Format: `${externalProposalId}:${decision}` (`website-integration.ts:792`). `decision ∈ {'approved','rejected','changes_requested','cancelled'}` (CHECK constraint at migration line 21).
- `external_proposal_id` uniqueness: `website_inbound_links_external_proposal_unique unique (external_source, external_proposal_id)` (`0034_phase_14a_website_inbound_integration.sql:27`). Per-(source, proposal_id) is unique. Since `external_source = 'noon_website'` for the only outbound endpoint today, `external_proposal_id` is effectively unique per outbound emission.
- ADR-027 D3 explicitly assumes a single proposal can only transition ONCE into each terminal state. The four states (approved/rejected/changes_requested/cancelled) are mutually exclusive on a single proposal's lifecycle. The natural-key formula is collision-free under this invariant.
- Failure mode: a `(prop_X, approved)` followed by a `(prop_X, rejected)` produces TWO distinct keys → no collision.
- A PM-corrected re-review (request_changes → resubmit → approve) produces `(prop_X, changes_requested)` then `(prop_X, approved)` — distinct keys. No collision.
- Admin replay reuses the SAME key (D10) — by design, to drive NoonWeb's de-dupe.
- The format is human-readable; an external observer who can read NoonWeb's logs sees the key but cannot forge it (the HMAC signature is the credential, not the idempotency key).

**Verdict — LOW.** Format is collision-free under the documented invariant (D3 forward-looking note). No `:` escape issue because `decision` is a 4-value enum without `:`.

Severity: **LOW**.

---

### S11 — Log injection / observability

**Surface:** user-controlled / receiver-controlled strings appear in structured logs without escaping.

**Audit:**
- All log calls verified to use `logger.{info,warn,error}` with structured `LogContext` objects, never string interpolation.
- The logger (`api/logger.ts:42–46`) sanitizes by KEY (redacts secret-like) and TRUNCATES values >500 chars.
- The serialization is `JSON.stringify(payload)` (line 58) — strings are JSON-escaped automatically. CRLF / control-chars cannot break out of the log structure.
- `errorToLogContext` (line 76–87) returns `{ errorName, errorMessage }` — error message is bounded by `JSON.stringify` escaping.
- NoonWeb-controlled strings flowing into logs:
  - `cron.outbound_webhook_retry.done` → counts only, no body.
  - `outbound_webhook.snapshot_*_failed` → `linkId` + error context. No receiver body.
  - `admin.outbound_webhook_replay.replayed` → `sourceEventId`, `newEventId`, `status`. No body.
  - `cron.outbound_webhook_retry.dry_run` → counts + candidate event IDs (UUIDs).
  - `outbound_webhook.cron_row_failed` → event ID + error context.
- Receiver body bytes are NOT logged. They land in `last_error` on the ledger (clipped 1000 chars). If an operator queries the ledger via the admin UI / SQL, they see the snippet. Not a log-injection surface; an information surface (S7 covers).
- `console.warn` direct call in `outbound-webhook-events.ts:110, 330` (signature header persistence + kill-switch typo). These are bounded: kill-switch warn quotes a raw env value (which the operator controls); signature_header warn quotes an error.message — bounded by V8's Error.message length and `console.warn` not honoring our JSON structure. Minor inconsistency: the helper uses `console.warn` while the dispatcher uses the structured `logger`. Functional, not a security gap.

**Verdict — INFO.** No log injection surface. Minor INFO: helper module uses raw `console.warn` rather than the structured logger (kill-switch + signature-header bounded paths). Pre-existing pattern in the inbound ledger module (B15 precedent). Recommendation R-4 below.

Severity: **INFO**.

---

### S12 — Migration safety (0062)

**Surface:** RLS gaps, missing CHECK constraints, default values that bypass invariants, GRANT/REVOKE posture.

**Audit:**
- `create table if not exists` (line 15) — idempotent, ADR-014 compliant.
- CHECK constraints: `endpoint in ('proposal-review-decision')` (line 18), `decision in (4-value enum)` (line 21), `status in (4-value enum)` (line 25), `attempt_count >= 0` (line 27), `max_attempts > 0` (line 29). All present per D2.
- Defaults: `id = gen_random_uuid()`, `status = 'pending'`, `attempt_count = 0`, `max_attempts = 3`, `created_at = now()`, `updated_at = now()`. Safe defaults — `attempt_count=0` prevents underflow; `max_attempts=3` matches ADR-027 D1.
- NULLability: `payload_hash text not null`, `idempotency_key text not null`, `endpoint not null`, `decision not null`, `status not null`. Forensic columns (`signature_header`, `last_error`, `last_http_status`, `request_id`, `actor_id`) nullable. Soft-FK columns (`link_id`, `proposal_id`) nullable. Matches D2 verbatim.
- Soft-FK posture: `link_id uuid` and `proposal_id uuid` declared as plain UUIDs WITHOUT `references` clause. Cascade behavior: none. Forensic durability (ADR-016 D7 precedent). Verified at lines 22–23.
- Indexes (lines 60–83): all 7 D2 indexes present including partial indexes (e.g., `where status = 'pending' and next_retry_at is not null` for the cron hot path). The additional `outbound_webhook_events_dead_lettered_at_idx` matches D2.
- Trigger `set_updated_at` (lines 87–91): uses existing `public.set_updated_at()` helper (referenced from 0001/0002/0034 — implicit dependency). If this function does NOT exist, the migration would fail. The migration assumes upstream presence — standard practice in this repo.
- RLS enabled (line 95). One SELECT policy admin-read (lines 97–111). No INSERT/UPDATE/DELETE policies — DENY by default.
- Grants: `select to authenticated` (works through policy); `all to service_role` (bypass RLS). NO `anon` grant. NO `public` grant.
- ADR-027 D6 surface: `alerted_at timestamptz` column (line 43) — additive on top of locked D2 column set. Migration comment justifies (lines 48–55): used by `webhook-failure-alert` cron to skip already-alerted rows. The `enqueue_user_notification` RPC dedupes by `(profile_id, source_kind, source_event_id)` so this is a cost-optimization, not a correctness gate. Acceptable additive surface — Architecture intent in D6 documented. **NOTE:** the spec §19 "Hard constraints" forbids "NO new value added to `website_inbound_links.review_webhook_status` CHECK constraint" — `alerted_at` is on the NEW ledger table, not the partner table. No constraint regression.
- `comment on table` (line 57) references ADR-027. Good audit trail.

**Verdict — LOW.** Migration is well-formed, idempotent, RLS-correct, and CHECK-constraint-defensive. Soft-FK posture matches ADR-016 D7. `alerted_at` addition is well-justified in-comment.

Severity: **LOW**.

---

## Findings summary

| ID | Severity | Surface | Description | Status |
|---|---|---|---|---|
| M1 | MEDIUM | S1 | Cron sweep wall-clock cost unbounded by handler-level budget under sustained outage (Vercel runtime timeout is the natural ceiling) | Open — recommendation R-1 |
| L1 | LOW | S2 | Outbound replay attack bounded by HMAC ±5min window; idempotency-key not a credential | Acknowledged |
| L2 | LOW | S3 | Admin replay endpoint: no anti-CSRF token; bounded by D10 idempotency-key inheritance + admin-only role | Acknowledged |
| L3 | LOW | S4 | Cron handler uses `===` not `crypto.timingSafeEqual`; repo-wide pre-existing pattern across all 5 crons | Acknowledged — pre-existing |
| L4 | LOW | S5 | RLS posture mirrors B15 verbatim | Verified clean |
| L5 | LOW | S6 | HMAC secret rotation is operator-runbook territory; spawn-replay nulls signature_header correctly | Recommendation R-2 |
| L6 | LOW | S7 | Hostile NoonWeb 5xx could inject `last_error` content (bounded 1000 chars on ledger, 500 in logs, admin-only read) | Recommendation R-3 |
| L7 | LOW | S8 | Kill-switch strict parsing, fail-safe defaults | Verified clean |
| L8 | LOW | S10 | Idempotency-key collision-free under documented invariant | Verified clean |
| L9 | LOW | S12 | Migration RLS / CHECK / GRANT posture clean | Verified clean |
| I1 | INFO | S9 | B15 inbound HMAC chain holds; G23 improves audit of compromised-inbound blast radius | Acknowledged |
| I2 | INFO | S11 | Helper module uses raw `console.warn` rather than structured logger (2 spots) | Recommendation R-4 |

**Distribution:** 0 CRITICAL, 0 HIGH, 1 MEDIUM, 9 LOW, 2 INFO.

---

## Gate decision

**GATE-OPEN.** Zero CRITICAL, zero HIGH. The single MEDIUM (M1) is operator-noise grade, not a correctness gate. ADR-027 D4 explicitly accepted the inline-retry-from-cron pattern as a tradeoff. Validator may proceed.

Per Severity-to-Outcome rule:
- Unresolved MEDIUM: "At least PARTIAL, unless explicitly justified and documented." M1 is justified by ADR-027 D4 + Vercel runtime timeout as natural ceiling, and surfaced here as a recommendation (R-1). It does not block COMPLETE.

---

## Recommendations (prioritized)

**R-1 (MEDIUM, future iteration):** Add an explicit cron-handler wall-clock budget. Suggestion: pass a deadline (`Date.now() + N seconds`) into `runOutboundWebhookCronSweep`, break out of the candidate loop when crossed, leave un-processed rows in `pending` for the next cron run. Sweep is already idempotent; partial completion is safe. Defer to a follow-up iteration unless production telemetry shows actual timeouts. NOT a G23 blocker.

**R-2 (LOW, Docs deliverable):** Document the `NOON_WEBSITE_WEBHOOK_SECRET` rotation runbook in `docs/runbooks/` (or in `docs/integrations/cross-repo-webhook-v1.md` §X): rotate App + NoonWeb simultaneously; flush any `dead_letter` rows OR accept brief signature-rejection window. Cross-repo coordination signal already escalated as R2 — append rotation procedure to the same closure note.

**R-3 (LOW, Docs deliverable):** Consider scrubbing `last_error` to a fixed enum / safe-string set before persistence, OR explicitly note in `docs/runbooks/` that admin replay responses may surface receiver-supplied content (bounded 1000 chars). The current bound is sufficient; this is operator-awareness, not a code change.

**R-4 (INFO):** Replace the two `console.warn` calls in `outbound-webhook-events.ts:109, 330` with `logger.warn(...)` to align with the project-wide structured-logging convention. Mirror change for the matching inbound helper if not already done. Not load-bearing; cosmetic.

**R-5 (INFO, low-priority repo-wide):** Audit the 6 cron handlers (`/api/leads/auto-followup`, `/api/cron/{consolidate-earnings,cleanup-revoked-tokens,project-sla-breach-alert,webhook-failure-alert,outbound-webhook-retry}`) for adopting `crypto.timingSafeEqual` on the bearer compare. Currently all 6 use `===`. Negligible practical risk (high-entropy CRON_SECRET vs network jitter); call as a hardening iteration if other timing-attack threats become relevant.

---

## Handoff payload to Validator

- **Areas reviewed:** all 12 mandated threat surfaces S1–S12, plus migration 0062 RLS and the inbound chain dependency (B15 inheritance).
- **Depth of review:** DEEP (auth, persistence, cross-repo signal, kill-switch, admin replay, migration).
- **Findings by severity:** 0 CRITICAL · 0 HIGH · 1 MEDIUM (M1, cron wall-clock budget) · 9 LOW · 2 INFO.
- **Findings resolved (in current iteration):** none required (all in-scope risk surfaces verified safe or accepted-tradeoff per ADR-027).
- **Findings open:** M1 (R-1 recommended for follow-up iteration). All other findings are LOW/INFO and acknowledged.
- **Security debt:** none new. R-5 (timingSafeEqual on cron bearer compares) is a repo-wide pre-existing condition surfaced for awareness, not a G23 regression.
- **Recommended reroute:** none. No fix required before Validator.
- **Production readiness judgment:** READY. R2 cross-repo escalation (NoonWeb-side de-dupe enforcement) remains an Active risk per ADR-027 + spec §4 — Docs owns the closure entry. No App-side security gate blocks COMPLETE.
- **Security outcome:** **GATE-OPEN.** Validator may proceed to final iteration gate.
