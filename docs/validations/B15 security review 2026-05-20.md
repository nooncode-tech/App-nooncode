# B15 — Security review (website_webhook_events ledger)

**Date:** 2026-05-20
**Iteration:** B15 — webhook_event_seen ledger para website inbound
**Reviewer role:** system-security (mandatory gate per FULL-depth chain)
**Verdict:** **GATE-OPEN. No CRITICAL or HIGH findings.**

## Scope

The review covers the changes introduced by B15:

- Migration `0051_phase_20a_website_webhook_event_ledger.sql` (applied 2026-05-20 via Dashboard).
- Manual override block #4 in `lib/server/supabase/database.types.ts`.
- New module `lib/server/website/webhook-events.ts` (helper + replay composer + kill-switch).
- Auth surface extension in `lib/server/website-webhook-auth.ts` (`readSignedWebsiteJsonWithRawBody`).
- Route refactors in:
  - `app/api/integrations/website/inbound-proposal/route.ts`
  - `app/api/integrations/website/payment-confirmed/route.ts`
- New env var `WEBSITE_WEBHOOK_LEDGER_ENABLED` (default ON, ADR-016 D9).

Out of scope: pre-existing inbound integration behavior, Stripe ledger, outbound `proposal-review-decision`, NoonWeb side.

## Reference

- ADR-016 §Threat model coverage + D-decisions.
- Spec §Risks R1-R10 + Architecture §Risks R11-R15 + Infra §Risks R-INFRA-1..R-INFRA-4 (all carried forward).
- F-1 fix baseline (PR #67, merged 2026-05-19): `x-noon-timestamp` strictly required; ±5min window enforced.

## Threat-model verifications

### S1 — Replay defense (primary purpose)

**Surface:** repeated inbound requests with identical signed body.

**Mitigation chain:**
1. Rate limit (120/min, namespace per endpoint) — unchanged.
2. HMAC verify + timestamp window — unchanged.
3. **NEW:** ledger UNIQUE `(endpoint, signature_hash)` — replay short-circuits to `composeReplayResponseFromLedger`.
4. App-level idempotency via `external_session_id` lookup in `website_inbound_links` — unchanged fallback.

**Verdict:** **LOW.** Defense-in-depth, four layers. Pre-B15 behavior remains the floor when ledger is disabled via kill-switch.

### S2 — Hash collision (SHA-256)

**Surface:** crafted payload producing same `sha256(${timestamp}.${bodyText})` as a prior accepted event.

**Mitigation:** SHA-256 collision resistance ~2^128 work. Computationally infeasible. The `(endpoint, signature_hash)` UNIQUE constraint is the dedup key; payload_hash stored separately is forensic-only and not on the UNIQUE.

**Verdict:** **LOW.**

### S3 — Timing oracle on ledger lookup

**Surface:** attacker measures response time to determine whether a given `signature_hash` already exists.

**Mitigation:** HMAC verification occurs **before** the ledger lookup (verified in route flow: `readSignedWebsiteJsonWithRawBody` runs before `recordWebsiteWebhookEvent`). Attackers without the shared secret cannot reach the ledger code path. Postgres indexed lookup is constant-time enough to not leak structurally.

**Verdict:** **LOW.**

### S4 — Plaintext storage of `signature_header`

**Surface:** the `x-noon-signature` value (e.g., `sha256=4a2b…c91f`) is stored in `signature_header` column. An admin with SELECT access to the ledger could read it.

**Mitigation:** the header value is publicly transmitted (over TLS but visible to NoonWeb and to anyone with the secret). It is **not a secret**. To forge a signature, an attacker would need both the original `bodyText` (which we do **not** store) AND the shared HMAC key (which is service-side env only). Neither is exposed by the ledger.

**Verdict:** **LOW.** Documented in ADR-016 R13.

### S5 — PII and GDPR retention

**Surface:** the ledger stores 16 columns. Are any of them PII?

**Audit:**
- `id`, `request_id`, `received_at`, `processed_at`, `failed_at`, `attempt_count`, `last_error`, `status`, `endpoint` — operational metadata, not PII.
- `signature_hash`, `payload_hash`, `signature_header` — cryptographic derivatives. The `payload_hash` is derived from a payload that **does** contain PII (customer email/name), but the hash itself is not PII (one-way function).
- `external_session_id`, `external_proposal_id`, `external_payment_id` — pseudonymous identifiers, not directly PII. Linkage to a real customer requires joining `website_inbound_links` (where the original PII lives in `inbound_payload` JSONB).
- `link_id` — FK-style pointer to `website_inbound_links`. Not PII on its own.

**GDPR Art. 15 / 17 implications:**
- A customer deletion request requires deleting the corresponding `website_inbound_links` row (the PII source) and cascading through `leads`, `lead_proposals`, etc. — same as today, B15 does not change this surface.
- The B15 ledger row can remain as it carries no direct PII. The pseudonymous external_ids become dangling references but are not exploitable.

**Retention policy:** 180 days documented in ADR-016 D8. Cleanup cron deferred to B15-bis. The 180-day window aligns with Stripe's refund window (the legitimate replay-inspection horizon) and stays under typical GDPR retention thresholds for transactional pseudonymous logs.

**Verdict:** **LOW.** No new GDPR surface introduced.

### S6 — Insert/update race condition

**Surface:** two concurrent identical requests arrive nearly simultaneously.

**Mitigation:** UNIQUE constraint serializes via Postgres. First INSERT wins, second gets `23505` and falls into the SELECT path. By the time SELECT runs, the winner's row exists. Second request reads the row in `status='processing'` and either short-circuits (if winner has `markProcessed` already, with linkId) or re-runs business logic (which is itself idempotent at app level via `external_session_id`).

Worst case: both run business logic concurrently. App-level idempotency in `receiveWebsiteInboundProposal` catches the second via `findLinkByExternalRef` — both return `idempotent: true` with same `linkId`.

**Verdict:** **LOW.** Race-safe by construction (UNIQUE + app-level idempotency stacking).

### S7 — Kill-switch misconfiguration

**Surface:** operator sets `WEBSITE_WEBHOOK_LEDGER_ENABLED` to a typo'd value (`'False'`, `' false'`, `'0'`, `'disabled'`).

**Mitigation:** only the literal `'false'` (case-insensitive, post-trim) disables. All other values enable. `console.warn` surfaces non-canonical values at module load so typos become visible in logs.

**Verdict:** **LOW.** Fail-safe: typos default to enabled (the safer state since the ledger is defense-in-depth).

### S8 — SQL injection / parameter binding

**Surface:** helper builds queries via supabase-js client.

**Audit:** all queries use `.from(...).select(...).eq(col, val)`, `.insert(value)`, `.update(value).eq(col, val)`. Values flow through supabase-js parameter binding — no string interpolation into SQL.

**Verdict:** **LOW.** Standard supabase-js usage matches all other server code.

### S9 — Service-role bypass of RLS

**Surface:** the helper uses `createSupabaseAdminClient()` which uses the service-role key (bypasses RLS).

**Mitigation:** service-role usage is the standard pattern for server-side webhook handlers in this repo (mirrors `lib/server/stripe/webhook-events.ts`, `lib/server/website-integration.ts`). The service-role key lives in env (`SUPABASE_SERVICE_ROLE_KEY`), never exposed to user input or client code.

**Verdict:** **LOW.**

### S10 — Override block #4 type-safety drift

**Surface:** the manual override block in `database.types.ts` could drift from the actual schema if someone later modifies `website_webhook_events` without regenerating types.

**Mitigation:** documented as queued follow-up "clean regen + reconcile 4 override blocks" when MCP/CLI Supabase auth refreshes. The override matches the migration DDL verbatim (column names, types, nullability). Until regen, the source of truth for the schema is the migration file.

**Verdict:** **LOW.** Pre-existing repo-wide condition (3 prior override blocks); B15 adds the 4th. No worse than baseline.

### S11 — Replay short-circuit response leaks information

**Surface:** the replay response shape (`{ idempotent: true, linkId, leadId, proposalId, projectId?, status }`) reveals internal identifiers.

**Audit:** this is the same wire shape returned by the existing receive functions (`receiveWebsiteInboundProposal`, `receiveWebsitePaymentConfirmed`) on app-level idempotent path. NoonWeb already receives these on every signed request. B15 does not expand the disclosure surface.

**Verdict:** **LOW.** Wire-identical to pre-B15 behavior.

### S12 — Ledger as DoS amplifier

**Surface:** attacker with valid HMAC (e.g., compromised secret) spams either endpoint to fill the ledger.

**Mitigation:** rate limit 120/min per endpoint, pre-existing. At rate-limit ceiling: 172,800 rows/day, ~10k rows / endpoint at 30 req/h sustained. Storage cost negligible. Postgres index on `(endpoint, signature_hash)` keeps lookups fast even at millions of rows.

**Verdict:** **LOW.** Bounded by existing rate limit.

## Findings

| ID | Severity | Description | Status |
|---|---|---|---|
| — | — | None identified | — |

**Carry-forward acknowledgments (already documented in architecture / infra, no new severity assigned):**

- R11 (partial-state replay) — pre-existing; B15 surfaces it via ledger but does not worsen it. Future mitigation = transactional RPC refactor of `receiveWebsiteInboundProposal`, out of B15 scope.
- R13 (signature_header storage) — safe by `bodyText` non-storage.
- R15 (`'processing'` rows on kill-switch flip) — operational note.
- R-INFRA-3 (kill-switch typo silently fails-to-on) — mitigated by `console.warn` at module load (verified in `lib/server/website/webhook-events.ts:readLedgerFlag`).

## Conditions for passing the security gate

Per ADR-016 §Threat model coverage and the validator gate's "zero CRITICAL/HIGH abiertos" requirement:

- ✅ No CRITICAL findings.
- ✅ No HIGH findings.
- ✅ All previously-flagged risks (R11-R15, R-INFRA-1..R-INFRA-4) acknowledged.
- ✅ HMAC verify ordering preserved (verified in route source).
- ✅ Kill-switch fail-safe (verified in test `websiteWebhookLedgerEnabled returns true regardless of env`).
- ✅ No PII directly stored.
- ✅ Service-role posture matches existing patterns.

**Gate verdict:** **GATE-OPEN.** Validator may proceed.

## Recommendations (informational, not blocking)

1. **Future iteration B15-bis:** add a retention cleanup cron + observability dashboard. Currently 180-day policy is documented but not enforced.
2. **Future hardening:** transactional RPC for `receiveWebsiteInboundProposal` to eliminate the partial-state risk (R11). Independent iteration.
3. **Cross-repo follow-up:** confirm with dev NoonWeb that any future `x-noon-event-id` header proposal is dropped in favor of computed identity (ADR-016 D2). Update `docs/integrations/cross-repo-webhook-v1.md` §8.2 reflects this — handled by system-docs.
