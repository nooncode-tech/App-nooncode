# Spec — Fase 3 R5: Outbound webhook retry policy + dead-letter ledger

## 1. Title and metadata

- Feature/iteration name: `fase-3-r5-outbound-webhook-retry-policy`
- Date: 2026-05-26
- Author: system-analysis (G23)
- Status: Approved (Analysis self-approves; Definition of Ready met — see §13)
- Router mode: Refactor + small Backend addition (per router handoff §1)
- Depth: FULL (per router handoff §1; net-new persistence + cron + endpoint + cross-repo signal)
- Supersedes: nothing
- Expected duration: 2-3 days, single PR against `develop`

## 2. Business objective

The PM-review → website decision relay (`proposal_review_decision` outbound webhook) currently runs as a single-shot fire from `sendProposalReviewDecisionToWebsite` with no retry on transient failures and no durable record of attempts beyond a snapshot on the `website_inbound_links` row. Once NoonWeb ships the client-facing `/portal/[projectId]` view, a single missed delivery becomes a user-visible bug (client never sees the PM decision). This iteration adds bounded retry-with-backoff, a dead-letter ledger, a cron sweeper for stuck attempts, and an admin replay endpoint — making the outbound contract durable enough for the upcoming cross-repo invariant without changing the wire envelope NoonWeb receives.

## 3. Scope — in

- Add net-new persistence layer (table + indexes + RLS) for outbound webhook delivery attempts, modeled after the inbound `website_webhook_events` ledger (ADR-016 precedent), but for outbound semantics.
- Wrap `sendProposalReviewDecisionToWebsite` (`lib/server/website-integration.ts:683-813`) with inline retry-with-backoff (parameters defined by Architecture).
- On exhaustion of inline retries, write a terminal `dead_letter` ledger row; preserve existing row-level snapshot writes on `website_inbound_links` for backwards-compatible operator visibility.
- Add cron sweeper (handler under `app/api/cron/outbound-webhook-retry/route.ts` or equivalent — exact name decided by Architecture) following the B25 pattern (`CRON_SECRET` bearer auth, dry-run mode, structured logger).
- Register the new cron entry in `vercel.json` with cadence locked by Architecture (recommended starting point: 5 min).
- Add admin-only replay endpoint (`POST /api/admin/outbound-webhooks/[eventId]/replay` or equivalent path — final URL decided by Architecture) restricted to `admin` role via `requireRole(['admin'])`.
- Add kill-switch env var (`NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` or final name set by Architecture) read at module load following the `WEBSITE_WEBHOOK_LEDGER_ENABLED` precedent in `lib/server/website/webhook-events.ts`.
- Add unit tests for: retry-with-backoff against mocked `fetch` (5xx → retry, 2xx → terminate), dead-letter row creation on exhaustion, ledger idempotency on replay, admin replay endpoint authz, cron handler authz + sweep behavior.
- Add ADR (next free number — see §14) documenting the 8 D-decisions from router handoff §4 plus any new D-points Architecture surfaces.
- Add migration file at `supabase/migrations/0062_phase_3r5_outbound_webhook_events.sql` (additive, idempotent, RLS-enabled).
- Update `.env.example` with the new env vars (kill-switch + any new tuning knobs Architecture defines).
- Update `docs/integrations/cross-repo-webhook-v1.md` with the cross-repo idempotency contract for replayed `proposal_review_decision` deliveries (R2 mitigation surface).
- Update `docs/context/project.context.core.md` with the closure entry at iteration close (handled by `system-docs`).

## 4. Scope — out

- **R6 backfill**: pre-G23 rows on `website_inbound_links` with `review_webhook_status='failed'` are explicitly NOT backfilled into the new ledger. Pre-G23 failures predate the cross-repo `/portal/[projectId]` invariant (NoonWeb has not shipped that surface yet), and operator value of backfilling is low. A follow-up iteration may revisit this if production shows the gap matters. **Out-of-scope declaration is binding.**
- **UI for admin replay**: the replay endpoint is operator-tool-only via curl/Postman/Supabase console. No `/dashboard/*` UI is added in this iteration. A future iteration may add an admin console for dead-letter inspection and replay if operator volume justifies it.
- **Generic outbound webhook abstraction extraction**: if Architecture surfaces a reusable `withOutboundWebhookRetry` wrapper worth extracting to power future outbound surfaces (e.g., hypothetical `payment_confirmed_relay`, `prototype_decision_relay`), `system-refactor` may pull it out *conditionally* within this iteration. If the abstraction is non-trivial (>1 day of work, multiple consumers needed to validate the seams), the extraction is **deferred to a future iteration** and G23 ships with the retry logic inline in `sendProposalReviewDecisionToWebsite`. Analysis instruction to Architecture: prefer inline over abstraction unless the seam is clearly correct on first read.
- **NoonWeb-side receiver hardening**: cross-repo idempotency enforcement on the NoonWeb receiver side (R2 mitigation on the *other* repo) is **NOT** in this iteration. It is escalated to NoonWeb as a cross-repo coordination signal and recorded in `docs/context/project.context.core.md` Active risks at iteration close. The App-side change ships ready (with idempotency-key headers per the Architecture-defined contract); NoonWeb-side enforcement is its own iteration owned by `noon-web-main`.
- **Touching other outbound webhook surfaces** (Stripe outbound retries, internal webhook fan-out, future `prototype_decision_relay`): out-of-scope. This iteration is exclusively about `proposal_review_decision` outbound dispatch.
- **Modifying the existing wire envelope shape sent to NoonWeb**: no field additions, no field removals. Retry behavior is observable to NoonWeb only via repeated POSTs with the same `external_proposal_id` (the de-dupe key); the JSON payload structure is unchanged.
- **Production deploy of the cron entry**: vercel.json registration ships in the PR; whether the cron is *enabled* in production at merge time is an Infra/Docs runbook decision, not part of this spec's Definition of Done.

## 5. Acceptance criteria

Each criterion below is testable and observable. Validator measures against these.

**AC-1 — Inline retry on 5xx**: Given a stubbed receiver returning HTTP 503 for the first 2 attempts and HTTP 200 on the 3rd, when `sendProposalReviewDecisionToWebsite` is invoked, then the ledger row for that delivery transitions `pending → delivered` with `attempt_count = 3` and `last_error` cleared. The function returns `status: 'sent'`. `website_inbound_links.review_webhook_status = 'sent'`.

**AC-2 — Dead-letter on exhaustion**: Given a stubbed receiver returning HTTP 503 for the maximum-allowed attempts (number locked by Architecture), when `sendProposalReviewDecisionToWebsite` is invoked, then the ledger row transitions to `dead_letter` with `attempt_count = <max>`, `next_retry_at = NULL`, and `last_error` populated. The function returns `status: 'failed'`. `website_inbound_links.review_webhook_status = 'failed'` (preserves existing snapshot contract).

**AC-3 — Network-error retry parity with 5xx**: Given the receiver throws `fetch` network errors (timeout, ECONNREFUSED) for the first 2 attempts and succeeds on the 3rd, when invoked, then the same retry behavior applies as AC-1.

**AC-4 — 4xx terminal (no retry)**: Given the receiver returns HTTP 400 (or any 4xx other than 429), when invoked, then the ledger row goes directly to `dead_letter` with `attempt_count = 1`. (4xx = receiver-side contract violation; retrying does not help.) Architecture confirms 4xx-treatment semantics; if 429 is treated as retryable, the ADR documents it.

**AC-5 — Cron sweeps stuck `pending` rows**: Given a ledger row with `status = 'pending'` and `next_retry_at` in the past, when the cron handler runs (authenticated via `CRON_SECRET` bearer), then the row is picked up, the outbound POST is re-attempted, and the row transitions to `delivered`, `pending` (with bumped `next_retry_at`), or `dead_letter` depending on the receiver response. Cron processes a bounded batch per run (size locked by Architecture).

**AC-6 — Cron authz**: Given a request to the cron handler without the `Bearer ${CRON_SECRET}` header, when invoked, then 401 is returned and no rows are touched.

**AC-7 — Admin replay endpoint authz**: Given a `POST /api/admin/outbound-webhooks/[eventId]/replay` request from a principal with role ≠ `admin`, when invoked, then 403 is returned. Given a principal with role = `admin`, when invoked against a `dead_letter` row, then a fresh delivery attempt is fired, a new ledger row (or reset of the existing row — Architecture decides) is created, and the response indicates which path was taken.

**AC-8 — Admin replay idempotency on `delivered` row**: Given an admin replay against a ledger row already in `delivered` state, when invoked, then no new outbound POST is fired, the existing row is unchanged, and the response indicates `noop: true` (or equivalent — Architecture locks the exact wire shape).

**AC-9 — Kill-switch revert behavior**: Given `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED=false`, when `sendProposalReviewDecisionToWebsite` is invoked and the first POST fails, then no inline retry is attempted and the ledger row is written as `dead_letter` immediately (preserves durability even in panic mode — Architecture decision R5 / D5). The legacy `website_inbound_links` snapshot contract is preserved.

**AC-10 — Cross-repo idempotency header**: Given a retry of the same delivery (same `external_proposal_id` + same `decision`), the outbound POST carries an idempotency-key header (name + format defined by Architecture; recommended: derived from `external_proposal_id` + `decision`) so NoonWeb can de-dupe. The ADR documents the cross-repo contract; cross-repo escalation to NoonWeb is the closure-handoff signal, not an in-iteration deliverable.

**AC-11 — Migration registered**: `supabase/migrations/0062_phase_3r5_outbound_webhook_events.sql` exists, is idempotent (`create table if not exists`), enables RLS, defines admin-read policy mirroring `website_webhook_events`, and is registered in the migration ledger per ADR-014 manual-apply procedure (operator step at apply time; spec records the expectation).

**AC-12 — vercel.json cron registered**: a new cron entry exists in `vercel.json` for the outbound retry sweeper with cadence locked by Architecture.

**AC-13 — Existing call sites unchanged at the call boundary**: the two existing callers (`app/api/proposals/[proposalId]/review/route.ts` and `app/api/inbound/pm-queue/[proposalId]/review-webhook/route.ts`) call `sendProposalReviewDecisionToWebsite` with the same signature as today. New retry behavior is internal to the function. (Confirms scope: this is a refactor of the library, not a surface change.)

**AC-14 — No PII expansion in ledger**: the ledger row stores no payload bytes beyond what is already in the existing wire envelope. Architecture explicitly decides whether to store `payload_hash` (for forensic re-derivation) vs `payload_bytes` (full audit). Recommended: `payload_hash` only, mirroring inbound ledger. Security review verifies.

**AC-15 — Validator-acceptable evidence form**: per R7 (NoonWeb `/portal/[projectId]` not yet shipped), Validator accepts the following as sufficient evidence: (a) unit tests passing for AC-1 through AC-14, (b) one simulated end-to-end run with a local mock receiver demonstrating dead-letter creation and admin replay, (c) cron handler dry-run output recorded in iteration history. Browser-visible portal state is NOT required for this iteration.

## 6. Affected files and modules

### Files to be modified

- `lib/server/website-integration.ts` — wrap `sendProposalReviewDecisionToWebsite` (lines 683-813) with retry + ledger write. Add helper functions for ledger insert / update / state transition. Existing call sites untouched.
- `vercel.json` — add new cron entry.
- `.env.example` — add kill-switch env var and any new tuning knobs.
- `docs/integrations/cross-repo-webhook-v1.md` — add §X documenting outbound retry behavior + cross-repo idempotency-key contract for `proposal_review_decision`.

### Files to be created

- `supabase/migrations/0062_phase_3r5_outbound_webhook_events.sql` — new ledger table, indexes, RLS, admin-read policy.
- `lib/server/website/outbound-webhook-events.ts` (proposed name; final lives at Architecture's discretion) — sibling helper to `lib/server/website/webhook-events.ts`, providing `recordOutboundDeliveryAttempt`, `markOutboundDelivered`, `markOutboundFailed`, `markOutboundDeadLetter`, `bumpOutboundRetry` (signatures locked by Architecture).
- `app/api/cron/outbound-webhook-retry/route.ts` (proposed name) — cron handler following `app/api/cron/webhook-failure-alert/route.ts` as template.
- `app/api/admin/outbound-webhooks/[eventId]/replay/route.ts` (proposed name) — admin replay endpoint.
- `docs/adrs/ADR-027-outbound-webhook-retry-and-dead-letter-ledger.md` (next free ADR number — see §14).
- `tests/server/outbound-webhook-retry.test.ts` (proposed name) — unit tests for retry-with-backoff, ledger transitions, idempotency, kill-switch behavior.
- `tests/api/cron/outbound-webhook-retry.test.ts` (or co-located) — cron handler authz + sweep tests.
- `tests/api/admin/outbound-webhook-replay.test.ts` (or co-located) — admin replay endpoint authz + idempotency tests.

### Files explicitly NOT touched

- `app/api/proposals/[proposalId]/review/route.ts` (call site — signature stable).
- `app/api/inbound/pm-queue/[proposalId]/review-webhook/route.ts` (call site — signature stable).
- `lib/server/website/webhook-events.ts` (inbound ledger — reference template, not modified).
- `supabase/migrations/0051_phase_20a_website_webhook_event_ledger.sql` (inbound ledger schema — sibling table is created, inbound schema unchanged).
- All other outbound surfaces (Stripe webhooks, internal fan-out).
- `docs/context/project.context.core.md` and roadmap — updated by `system-docs` at closure, not during analysis/architecture/backend.

## 7. Dependencies

| Dependency | Class | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `lib/server/website/webhook-events.ts` (inbound ledger pattern) | internal | implemented, ADR-016 | reference template for ledger shape — without it, Backend has no precedent | App (no action needed) |
| `app/api/cron/webhook-failure-alert/route.ts` (B25 cron pattern) | internal | implemented | reference for cron auth + structured logging — without it, Backend would re-derive | App (no action needed) |
| `CRON_SECRET` env var | infra | already configured (used by 4 existing crons) | new cron would fail auth | App (no action needed) |
| `requireRole(['admin'])` from `lib/server/auth/guards` | internal | implemented | admin replay endpoint cannot authz | App (no action needed) |
| `signWebsitePayload` from `lib/server/website-webhook-auth.ts` | internal | implemented, ADR-016 | retry must re-sign each attempt (HMAC-with-timestamp); without it, NoonWeb rejects retries as stale | App (no action needed) |
| `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` env var | infra | already configured | dispatch URL must remain set; retry adds no new URL config | App (no action needed) |
| Supabase admin client `createSupabaseAdminClient` | internal | implemented | ledger inserts require service-role privilege bypass of RLS | App (no action needed) |
| `enqueue_user_notification` RPC (for dead-letter alert routing) | internal | implemented (used by B25 webhook-failure-alert cron) | reused for dead-letter alert thresholds (if Architecture decides to wire it; recommended) | App (no action needed) |
| ADR-014 migration ledger procedure | contract | implemented | new migration must follow the manual-apply + ledger-row-insert procedure | App (Backend at apply time) |
| NoonWeb-side de-dupe on `external_proposal_id + decision` | contract | **NOT YET IMPLEMENTED on `noon-web-main`** | without it, retry-with-backoff can corrupt portal v3 state via duplicate decision processing — see R2 | NoonWeb (cross-repo escalation at closure) |
| `WEBSITE_WEBHOOK_LEDGER_ENABLED` precedent for kill-switch reading | internal | implemented | reference for env-var parsing strictness (ADR-016 D9) | App (no action needed) |
| Next free migration prefix `0062` | data | verified against `supabase/migrations/` | wrong prefix would collide with existing migration | Analysis (verified — `0061_phase_23b_maxwell_niche_system.sql` is the last) |
| Next free ADR number `ADR-027` | data | verified against `docs/adrs/` | wrong number would collide with existing ADR-026 (Maxwell GPT-5.5 model selection) | Analysis (verified — see §14 escalation) |

## 8. Assumptions

- A1. The current outbound wire envelope (`sendProposalReviewDecisionToWebsite` body shape) is correct as-is and NoonWeb's receiver accepts it. Retry-with-backoff only re-sends; no shape changes.
- A2. NoonWeb's receiver currently has no documented de-dupe-on-replay behavior for `proposal_review_decision`. (This is R2 — surfaced explicitly so Architecture can lock the cross-repo contract and Docs can escalate at closure.)
- A3. Inbound ledger `website_webhook_events` (ADR-016) is the correct precedent template for outbound ledger structure. Sibling table with adapted state machine (`pending | delivered | dead_letter | replayed`) preserves operational coherence.
- A4. Cron infrastructure under B25 (Vercel-cron + `CRON_SECRET` bearer + structured logger) is the correct pattern for the new sweeper. No new infra abstractions introduced.
- A5. Admin role is sufficient authz scope for the replay endpoint. `sales_manager`, `pm`, `developer` are explicitly NOT granted (R4).
- A6. The two existing call sites of `sendProposalReviewDecisionToWebsite` (proposals/review/route.ts + inbound/pm-queue/.../review-webhook/route.ts) both belong to the same logical surface (proposal_review_decision dispatch) and both benefit symmetrically from the inline retry. No call-site changes required — wrapping the library function covers both. (Router handoff said "single call site"; Analysis confirmed two call sites in the same domain; scope is unchanged because both go through the same library function.)
- A7. The kill-switch reverts to "single attempt + immediate dead-letter row" behavior (R5 / D5 recommended-b), preserving durability even in panic mode. Architecture confirms or overrides.
- A8. The migration is purely additive — no destructive changes to `website_inbound_links` columns. Existing `review_webhook_status / review_webhook_attempted_at / review_webhook_sent_at / review_webhook_error` columns remain as the row-level snapshot of the latest delivery outcome; the new ledger is the historical attempt log. Same dual-track pattern as ADR-016.
- A9. The migration ledger registration follows ADR-014 manual-apply procedure (Backend at apply time, not auto-applied via CI).
- A10. Validator accepts unit-test + simulated-run evidence per AC-15 because production cross-repo invariant is not yet live (R7).

## 9. Risks

Re-stated from router handoff §6 with Analysis framing + R8 added.

**R1 — Amplification under sustained NoonWeb outage**
- Probability: medium
- Impact: medium (operator noise + Upstash cost surge if retries pile up)
- Severity: medium
- Mitigation: Architecture locks (a) max attempts cap inline (recommended 3), (b) cron batch size cap, (c) exponential backoff with jitter, (d) total time budget per delivery. Architecture also locks D6 dead-letter alert threshold so operators see the pile-up early.

**R2 — Cross-repo idempotency invariant (BLOCKER for production-ready ship)**
- Probability: high (will trigger on first retry that completes both client-side timeout and server-side success)
- Impact: HIGH — duplicate decision processing on NoonWeb side corrupts portal v3 state once `/portal/[projectId]` ships
- Severity: HIGH
- Mitigation: ADR-027 must document the de-dupe key contract (recommended: `external_proposal_id + decision`, since a single proposal can only transition once into each terminal state). App-side ships ready (idempotency-key header outbound). **NoonWeb-side enforcement is out-of-scope for this iteration and MUST be escalated as a cross-repo coordination signal in `docs/context/project.context.core.md` Active risks at iteration close.** Analysis explicitly flags this as not-yet-resolved at ship time. **This risk is NOT promoted to a lifecycle blocker** because: (a) NoonWeb has not shipped `/portal/[projectId]` yet (R7), so there is no production user-visible impact at ship time, and (b) the App-side cannot fix NoonWeb-side from within this iteration. The mitigation is signal quality (clear escalation + recorded Active risk) not in-iteration enforcement.

**R3 — Cron schedule collision with B25 schedules**
- Probability: low
- Impact: low (Vercel cron infra handles concurrent runs gracefully; risk is operator-cognitive, not technical)
- Severity: low
- Mitigation: Infra step verifies new cron cadence (recommended every 5 min: `*/5 * * * *`) does not visually collide with the 5 existing daily crons. Recommended distinct minute slot if added later for non-5-min cadences. Already covered by Infra route step.

**R4 — Replay endpoint privilege escalation**
- Probability: low (admin-only is a straightforward authz check)
- Impact: high (operator could replay decisions arbitrarily if pm/sales_manager were allowed; could be used to spam NoonWeb-side)
- Severity: medium
- Mitigation: `requireRole(['admin'])` strictly; explicit test for 403 on pm/sales_manager/developer. Security review verifies. The cron sweeper uses `service_role` via `CRON_SECRET`-bearer (B25 pattern); operator-triggered replay uses admin principal. Distinction preserved.

**R5 — Kill-switch semantic ambiguity**
- Probability: medium (panic-mode env-var flip is rare-event but high-stakes)
- Impact: medium (wrong semantic = lost decisions OR continued amplification)
- Severity: medium
- Mitigation: Architecture locks D5 explicitly. Analysis recommendation: option (b) — kill-switch skips inline retry but **still writes a dead-letter row immediately**. This preserves durability even in panic mode, so operators can replay later. Option (a) — kill-switch skips ledger entirely — is rejected because it loses durability precisely when the system is in trouble.

**R6 — Backfill of pre-G23 failed rows on `website_inbound_links`**
- Probability: low (out-of-scope decision is binding)
- Impact: low (pre-G23 failures predate the cross-repo invariant; no user impact)
- Severity: low
- Mitigation: Declared out-of-scope in §4. If production telemetry post-G23 shows pre-G23 failures matter, a follow-up iteration backfills via a one-shot SQL admin task. No code path needed in G23.

**R7 — NoonWeb `/portal/[projectId]` not yet shipped (Validator evidence-form risk)**
- Probability: certain (this is a current state of the world)
- Impact: low (good news — gives App time to ship G23 before cross-repo invariant becomes user-visible)
- Severity: low
- Mitigation: AC-15 explicitly defines Validator-acceptable evidence as test + simulated-run + cron-dry-run. Browser-visible portal state NOT required for COMPLETE verdict. Documented in spec to prevent Validator confusion.

**R8 (new — surfaced by Analysis) — ADR numbering collision**
- Probability: would have been certain if not caught
- Impact: medium (ADR ordering and traceability would have been corrupted)
- Severity: low (caught at Analysis)
- Mitigation: Router tentatively numbered the new ADR as ADR-026; Analysis verified against `docs/adrs/` and found ADR-026 is already taken (`ADR-026-maxwell-lead-engine-gpt-5-5-model-selection.md`). Correct next free ADR is **ADR-027**. See §14 escalation. Architecture writes ADR-027.

## 10. Open questions for Architecture

The 8 D-decisions from router handoff §4 are restated below, plus 3 new open questions surfaced by Analysis. Architecture must answer all of these in ADR-027 before Backend writes code.

**OQ-1 (D1) — Retry algorithm parameters.** What is the maximum number of inline attempts? What is the base delay, growth factor, jitter window, and total time budget? Recommended starting point from router handoff: 3 attempts, exponential 2s → 4s → 8s with ±25% jitter, total ~14s. Architecture locks final numbers.

**OQ-2 (D2) — Dead-letter ledger schema.** What is the exact column set? Recommended baseline (mirroring `website_webhook_events`):
- `id uuid primary key`
- `external_proposal_id text not null` (de-dupe / identity)
- `decision text not null check (decision in ('approved','rejected','changes_requested','cancelled'))`
- `link_id uuid` (FK soft to `website_inbound_links`)
- `status text not null check (status in ('pending','delivered','dead_letter','replayed'))`
- `attempt_count integer not null default 0`
- `next_retry_at timestamptz` (null when delivered or dead_letter)
- `last_attempted_at timestamptz`
- `delivered_at timestamptz`
- `dead_lettered_at timestamptz`
- `last_error text`
- `payload_hash text` (forensic, no PII)
- `signature_header text` (last sent header for forensic re-derivation)
- `request_id text`
- `created_at timestamptz default now()`
- `updated_at timestamptz`
- Architecture locks final columns + indexes + RLS policies.

**OQ-3 (D3) — Cross-repo idempotency contract.** What header name carries the idempotency key? What format? Recommended: `X-Noon-Idempotency-Key: <external_proposal_id>:<decision>` (or sha256 of same). Architecture locks the exact format. ADR-027 documents the cross-repo contract; Docs escalates to NoonWeb at iteration close.

**OQ-4 (D4) — Cron sweeper cadence.** Recommended 5 min (`*/5 * * * *`) — frequent enough that backoff timers don't accumulate unbounded delay, infrequent enough not to waste compute. Batch size: recommended 50 rows/run. Architecture locks final cadence + batch.

**OQ-5 (D5) — Kill-switch semantic precision.** When `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED=false`, does the system (a) skip ledger writes entirely (legacy behavior), or (b) write a single `pending → dead_letter` row immediately on first failure (no inline retry but still durable)? Analysis recommendation: **(b)**. Architecture confirms.

**OQ-6 (D6) — Dead-letter alert threshold.** When should operators be alerted? Recommended: any new `dead_letter` row triggers a `user_notifications` row for admins (reusing the B25 `enqueue_user_notification` pattern), and the existing `webhook-failure-alert` cron can be extended OR a new dead-letter-specific alert path can be added. Architecture locks alert wiring (extension vs new).

**OQ-7 (D7) — Admin replay endpoint contract.** Exact URL path, request shape, response shape, idempotency behavior (replay against `delivered` row is noop; replay against `dead_letter` row resets to `pending` and triggers fresh delivery; replay against `pending` row — what?). Architecture locks.

**OQ-8 (D8) — Relationship to existing row-level snapshot columns on `website_inbound_links`.** ADR-027 must explicitly state: row columns (`review_webhook_status`, `review_webhook_attempted_at`, `review_webhook_sent_at`, `review_webhook_error`) remain the **latest-attempt snapshot**; new ledger is the **historical attempt log**. Same dual-track pattern as ADR-016 (`website_webhook_events` ledger + transactional rows on business tables). Backend must preserve the existing snapshot writes for backwards compatibility with operator queries.

**OQ-9 (new — Analysis) — 4xx treatment.** Are HTTP 4xx responses from NoonWeb treated as terminal (no retry, immediate `dead_letter`) or retryable? Recommended: 4xx-except-429 is terminal; 429 is retryable (respecting `Retry-After` header if present). 400 = receiver-side contract violation, retrying doesn't help. Architecture locks.

**OQ-10 (new — Analysis) — Idempotency-key persistence on ledger.** Does the ledger persist the idempotency-key header value (so admin replay reuses the same key — keeps NoonWeb de-dupe correct) or regenerate it on each replay (so a replay is observably a new delivery to NoonWeb)? Analysis recommendation: **persist on ledger**, so replays carry the same key — this means a replay against a `delivered` row that NoonWeb already accepted is a noop on NoonWeb side, which is the correct durability semantic. Architecture locks.

**OQ-11 (new — Analysis) — Replay endpoint identity argument.** Does `POST /api/admin/outbound-webhooks/[eventId]/replay` use the ledger row UUID as `eventId`, or use `external_proposal_id` (more operator-friendly)? Recommended: ledger row UUID (more precise, allows replaying a specific attempt); but the response body should include the `external_proposal_id` for operator confirmation. Architecture locks.

## 11. Recommended testing methodology

**Methodology: integration-first** (with unit-test substrate).

Justification: the iteration's correctness lives at the boundary between the inline retry loop, the ledger state machine, and the wire-level outbound POST. Pure unit tests against mocked `fetch` cover the happy path and the obvious failure modes (5xx, timeout) but do not catch the most-likely-to-bite class of bugs: state-machine transitions under repeated retry, idempotency under admin replay, and cron-sweep correctness against real ledger rows. An integration-first methodology runs against (a) a local mock receiver (Express stub or `MSW`-style fetch interceptor returning scripted 5xx/2xx sequences) and (b) the local Supabase test DB with the new ledger table actually present. Unit tests for the pure functions (backoff math, idempotency-key derivation) supplement the integration layer.

TDD is not the right choice here because the contract is partially open at spec time (Architecture locks 8+ D-points). BDD is overkill for an internal infrastructure layer. CDD is not applicable (no consumer-driven contract on the App side; the contract is between App and NoonWeb, owned cross-repo).

System-testing skill instruction at chain step 5: produce integration tests against the mock receiver + local test DB; supplement with focused unit tests for retry-math and signature-header derivation.

## 12. Definition of Done

This iteration is Done when ALL of the following are true:

- [ ] ADR-027 is written, signed, and indexed under `docs/adrs/`.
- [ ] Migration `0062_phase_3r5_outbound_webhook_events.sql` is committed and applied to remote `pdotsdahsrnnsoroxbfe` with ledger row registered per ADR-014.
- [ ] `lib/server/website-integration.ts` `sendProposalReviewDecisionToWebsite` wraps retry + ledger writes internally; no signature change at call boundary.
- [ ] New helper module (`lib/server/website/outbound-webhook-events.ts` or final name) is committed.
- [ ] Cron handler `app/api/cron/outbound-webhook-retry/route.ts` (or final path) is committed and the route returns 401 without `CRON_SECRET`.
- [ ] `vercel.json` includes the new cron entry with cadence locked by Architecture.
- [ ] Admin replay endpoint `app/api/admin/outbound-webhooks/[eventId]/replay/route.ts` (or final path) is committed and returns 403 for non-admin principals.
- [ ] Kill-switch env var is read at module load with strict parsing (false-disables semantics, mirroring `WEBSITE_WEBHOOK_LEDGER_ENABLED`).
- [ ] `.env.example` updated with new env vars.
- [ ] `docs/integrations/cross-repo-webhook-v1.md` updated with the App-side outbound contract for retry + idempotency-key header.
- [ ] All AC-1 through AC-15 verified via tests + at least one simulated end-to-end run with a mock receiver.
- [ ] `system-security` verifies: admin authz, cron authz, kill-switch behavior, no PII expansion in ledger, idempotency-key header does not leak sensitive data.
- [ ] `system-infra` verifies: new cron entry registered, env vars documented, no production deploy conflicts.
- [ ] `system-docs` updates `docs/context/project.context.core.md` with the closure entry (no R-codes, no Sprint numbers per `feedback_context_docs_no_plan_refs`) and updates roadmap §16 G23 PENDIENTE → CERRADO + §17 snapshot.
- [ ] R2 cross-repo idempotency is recorded as an Active risk in `docs/context/project.context.core.md` (NoonWeb-side enforcement still pending, escalated cross-repo).
- [ ] `system-validator` returns COMPLETE.
- [ ] PR is opened against `develop`; operator merges (per `feedback_no_auto_merge_prs`).

## 13. Definition of Ready (Analysis self-approval gate)

Per `system-analysis` spec lifecycle rule, this spec moves from Draft to Approved only when:

- [x] Acceptance criteria are testable (AC-1 through AC-15 above).
- [x] Scope is bounded (in/out lists explicit; out-of-scope items binding).
- [x] Methodology is decided (integration-first + unit substrate).
- [x] Dependencies are classified (§7 table).
- [x] Risks are rated with probability/impact/severity/mitigation (R1–R8).
- [x] Open questions are crisp enough for Architecture to act (OQ-1 through OQ-11).
- [x] Chunking decision is explicit (§15: single PR confirmed).
- [x] Success criterion is testable and bounded (§16).
- [x] Required inputs from router handoff §8 are consumed and verified (see §17).

**Status: Approved by Analysis. Ready for Architecture (`system-architecture`).**

## 14. Escalations to router and architecture

**E-1 — ADR numbering.** Router handoff §4 tentatively numbered the new ADR as **ADR-026**. Analysis verified against `docs/adrs/` and found that ADR-026 is already taken: `ADR-026-maxwell-lead-engine-gpt-5-5-model-selection.md`. The correct next free ADR number is **ADR-027**. Architecture writes `docs/adrs/ADR-027-outbound-webhook-retry-and-dead-letter-ledger.md` (final slug at Architecture's discretion). This is a non-blocking correction; no router re-decision needed.

**E-2 — Call-site count.** Router handoff §1 and §8 imply a "single call site" for `sendProposalReviewDecisionToWebsite`. Analysis verified there are **two** call sites in the same domain (proposal_review_decision dispatch):
1. `app/api/proposals/[proposalId]/review/route.ts:65` — primary PM review action.
2. `app/api/inbound/pm-queue/[proposalId]/review-webhook/route.ts:46` — explicit dispatch-only / operator retry surface.

Both invoke the same library function with the same signature. Since the retry+ledger logic lives inside the library function, both call sites benefit symmetrically with **zero changes** at the call boundary. Scope is NOT expanded. Analysis records this clarification so Architecture and Backend do not waste effort hunting for a second integration point. **No router re-decision needed.**

**E-3 — Architecture confirmation.** Router pre-decision: Architecture is required. Analysis confirms. The 11 open questions (OQ-1 through OQ-11, of which OQ-1 through OQ-8 correspond to the 8 D-decisions in router handoff §4, plus 3 new ones) are non-trivial and must be locked in ADR-027 before Backend writes code. Backend cannot proceed against the current spec alone — too many contract holes. **Architecture must run.**

**E-4 — No risk promoted to lifecycle blocker.** Router handoff explicitly called out R2 (cross-repo idempotency) and asked Analysis to consider promoting any R-risk to a lifecycle blocker. Analysis decision: **no R-risk is promoted to blocker for this iteration.** Justification:
- R2 has HIGH severity but is mitigatable via signal-quality (clear ADR contract + escalation at closure). NoonWeb-side enforcement cannot be done from within App-side iteration, so blocking on it would block forever.
- R7 (NoonWeb `/portal/[projectId]` not shipped) is the buffer that makes R2 not-yet-user-visible at ship time.
- All other R-risks (R1, R3, R4, R5, R6, R8) are low-to-medium severity with clean mitigations in scope.

If during Architecture or Backend the team discovers a new fact that makes R2 immediately user-visible (e.g., NoonWeb ships `/portal/[projectId]` before App ships G23), Analysis must be re-invoked and this decision revisited.

## 15. Chunking decision

**Single iteration, single PR. Confirmed.**

Analysis confirms router handoff §3: chunking is not appropriate for this iteration. All components (ledger schema + retry-with-backoff inline + dead-letter row creation + cron sweeper + admin replay endpoint + ADR + tests + docs) are tightly coupled. Splitting any one of them produces an interim state where part of the system is dark (e.g., dead-letter table without sweeper = pile-up; sweeper without ledger = no-op; admin replay without ledger = nothing to replay against). Iteration budget (2-3 days) is within one validated iteration.

If Architecture surfaces an unexpected scope expansion (e.g., a generic `withOutboundWebhookRetry` abstraction worth extracting now), Analysis must be re-invoked and chunking re-decided at that point. Until then: single PR.

## 16. Success criterion

**One sentence:** A PM-review decision that experiences transient NoonWeb 5xx or network errors during outbound dispatch is automatically retried, and if all inline retries are exhausted, persists as a durable `dead_letter` ledger row that the cron sweeper or an admin-triggered replay can drive to terminal `delivered` state — all without changing the wire envelope NoonWeb receives or the existing snapshot semantics on `website_inbound_links`.

## 17. Lifecycle

- **Filename**: `specs/fase-3-r5-outbound-webhook-retry-policy.md` (this file).
- **Supersedes**: nothing.
- **Superseded by**: nothing (current).
- **Status timeline**:
  - 2026-05-26 Draft created by `system-analysis` (G23).
  - 2026-05-26 Approved by `system-analysis` (Definition of Ready met per §13).
  - Future: Implemented when `system-validator` returns COMPLETE.
  - Future: Archived if/when superseded.
- **Expected duration**: 2-3 days.
- **PR target**: `develop` (no direct push; per `feedback_develop_pr_only_or_local`).
- **Inputs consumed during Analysis** (verified before approval):
  - Router handoff `docs/handoffs/2026-05-26-g23-outbound-retry-router-decision.md` — read in full.
  - `docs/context/project.context.core.md` — loaded per CLAUDE.md session discipline.
  - `lib/server/website-integration.ts` lines 683-813 — confirmed function `sendProposalReviewDecisionToWebsite` is a direct `fetch` without retry; confirmed two callers (E-2).
  - `lib/server/website/webhook-events.ts` — confirmed inbound ledger shape and helper signatures; identified as reference template for outbound sibling module.
  - `vercel.json` — confirmed 5 existing cron entries; pattern for new cron registration is clear.
  - `app/api/cron/webhook-failure-alert/route.ts` — confirmed as best B25 template (also a webhook-failure cron; uses `CRON_SECRET` bearer auth, `dryRun` mode, structured logger, `enqueue_user_notification` for admin alerting).
  - `supabase/migrations/0061_phase_23b_maxwell_niche_system.sql` — confirmed last migration; next free prefix is `0062`.
  - `supabase/migrations/0051_phase_20a_website_webhook_event_ledger.sql` — confirmed inbound ledger schema as precedent.
  - `docs/adrs/` directory — confirmed ADR-026 already taken; next free is ADR-027 (E-1).
  - Existing failure-state columns on `website_inbound_links` (`current_status`, `review_webhook_status`, `review_webhook_attempted_at`, `review_webhook_sent_at`, `review_webhook_error`) — confirmed in `lib/server/website-integration.ts:725-810`. Preserved by this iteration (A8).
- **Outputs produced by Analysis**:
  - This spec file (`specs/fase-3-r5-outbound-webhook-retry-policy.md`).
  - Handoff payload to `system-architecture` (see §18).

## 18. Handoff payload to system-architecture

- **Task summary**: wrap `sendProposalReviewDecisionToWebsite` with inline retry-with-backoff + dead-letter ledger + cron sweeper + admin replay endpoint; preserve existing wire envelope and existing snapshot writes on `website_inbound_links`; ADR-027 locks the 11 open questions.
- **Scope boundary**: see §3 (in) and §4 (out). Out-of-scope is binding.
- **Affected files/modules**: see §6.
- **Dependencies**: see §7. Note R2 dependency on NoonWeb-side de-dupe (cross-repo, escalated at closure).
- **Assumptions**: see §8. Architecture must validate A1 (envelope stable), A2 (NoonWeb dedupe pending), A6 (two call sites covered symmetrically), A7 (kill-switch option-b recommended), A8 (dual-track pattern with `website_inbound_links` snapshot).
- **Open questions Architecture must resolve in ADR-027**: see §10 (OQ-1 through OQ-11).
- **Risks that may alter design**: R1 (amplification — drives D1 + D4 + D6 numbers), R2 (cross-repo idempotency — drives D3 + OQ-3 + OQ-10), R5 (kill-switch semantics — drives D5 + OQ-5), R8 (ADR numbering — drives file naming).
- **Recommended depth**: FULL (router-decided; Analysis confirms — net-new persistence + cron + endpoint + cross-repo signal cannot be honestly compressed to LITE).
- **Chunking decision**: single PR, single iteration. See §15.
- **Success criterion**: see §16.
- **Recommended testing methodology**: integration-first with unit substrate. See §11.
- **Path to spec.md**: `specs/fase-3-r5-outbound-webhook-retry-policy.md` (this file).
- **Escalations**: E-1 (ADR-027 not ADR-026), E-2 (two call sites not one), E-3 (Architecture confirmed required), E-4 (no R promoted to blocker). See §14.

---

## 19. Architecture firm decisions (appended 2026-05-26 by system-architecture)

Status: **Architecture locked. Ready for Backend.**

All 11 open questions OQ-1 through OQ-11 are RESOLVED via `docs/adrs/ADR-027-outbound-webhook-retry-and-dead-letter.md` (Accepted, 2026-05-26). One additional decision (D12) surfaced by Architecture is also locked. Backend MUST honor the constraints below; deviation requires re-invoking Architecture.

### 19.1 OQ resolution map

| OQ | Status | ADR-027 decision | Constraint summary for Backend |
|---|---|---|---|
| OQ-1 | RESOLVED | D1 | Max 3 inline attempts, base 2000ms, growth 2x, jitter ±25% uniform, max single delay 10s, soft total ~14s. Attempt counter bumped before each fetch. Pure-helper math, injectable for tests. |
| OQ-2 | RESOLVED | D2 | Sibling table `outbound_webhook_events`. 20-column schema locked (see ADR-027 D2 § "Locked column set"). State machine `pending|delivered|dead_letter|replayed`. Indexes locked. RLS: admin-read only; writes via `service_role`. Soft FKs (no constraint) on `link_id`, `proposal_id`. Hash-only payload storage (no PII bytes). |
| OQ-3 | RESOLVED | D3 | Header `X-Noon-Idempotency-Key`. Value format `<external_proposal_id>:<decision>` (UTF-8 plain text). Emitted on every POST. Persisted on ledger (see OQ-10). |
| OQ-4 | RESOLVED | D4 | Cron schedule `*/5 * * * *`. Batch size 50 rows/run. Order `next_retry_at asc`. `?dryRun=true` flag. `CRON_SECRET` bearer auth. Cron shares the same `max_attempts` budget as inline (no separate cron budget). |
| OQ-5 | RESOLVED | D5 | Env var `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED`. Default `true`. Only literal lowercased `'false'` disables. Read at module load. **Option-b semantics: ledger row still written as `dead_letter` immediately on first failure when flag is off (durability-preserving panic mode).** Cron sweeper + admin replay endpoint remain active regardless of flag. |
| OQ-6 | RESOLVED | D6 | Extend the existing `webhook-failure-alert` cron handler to scan a third ledger (`outbound_webhook_events` where `status='dead_letter'`). Reuse `enqueue_user_notification` RPC with `next_source_kind='webhook_failure'`, `next_source_event_id=ledger.id` (UUID — no MD5 hashing needed). Threshold: any new dead-letter row in lookback window → one notification per active admin per row. |
| OQ-7 | RESOLVED | D7 | URL `POST /api/admin/outbound-webhooks/[eventId]/replay`. `requireRole(['admin'])` strict. Behavior by source row status: `delivered` → 200 noop; `replayed` → 200 noop with `replayed_by_event_id`; `pending` → 409 conflict; `dead_letter` → spawn new ledger row inheriting identity keys (D10 — same `idempotency_key`), source row transitions to `replayed`, dispatcher drives new row synchronously. |
| OQ-8 | RESOLVED | D8 | Dual-track: `website_inbound_links` snapshot columns (`review_webhook_status`, `review_webhook_attempted_at`, `review_webhook_sent_at`, `review_webhook_error`, `current_status`) remain the LATEST-attempt snapshot. New `outbound_webhook_events` is the historical attempt log. Backend MUST preserve every snapshot write the current dispatcher does today (see ADR-027 D8 § "Mapping" for the exact value matrix per outcome). |
| OQ-9 | RESOLVED | D9 | 4xx (excluding 429) is terminal — dead-letter on first attempt, NO retry. 429 is retryable (counts as a normal attempt, standard backoff sequence). `Retry-After` header parsing OUT OF SCOPE for G23. 5xx + network throws are retryable. fetch-resolved-but-body-fails treated as network throw. |
| OQ-10 | RESOLVED | D10 | `idempotency_key` persisted as a column on the ledger row. Computed once at row creation: `${external_proposal_id}:${decision}`. Every outbound POST (inline retry / cron retry / admin replay's spawned row) uses the SAME stored value. Admin replay's new row inherits source row's key verbatim. |
| OQ-11 | RESOLVED | D11 | Replay endpoint `[eventId]` argument is the ledger row UUID (`outbound_webhook_events.id`), NOT `external_proposal_id`. Response body MUST include `external_proposal_id` + `decision` + `endpoint` for operator confirmation. |
| (new) | RESOLVED | D12 | Dispatcher accepts injectable deps `{ fetchImpl, now, randomFn, client }` defaulting to production values. Tests substitute scripted values for deterministic retry-math + jitter testing. Mandatory for `system-testing`'s integration-first methodology (§11). |

### 19.2 Hard constraints for Backend (must not deviate)

- **Migration prefix**: `0062_phase_3r5_outbound_webhook_events.sql`. Architecture verified `0062` is free against `supabase/migrations/`. If a concurrent iteration claims `0062` between now and apply, escalate (do NOT silently pick `0063`).
- **ADR reference**: every new file (migration comment, helper module JSDoc, cron handler, admin endpoint, env-var doc) MUST reference `ADR-027` (NOT `ADR-026`).
- **Wire envelope is FROZEN**: do NOT add, remove, or rename any field in the JSON body of the outbound POST. The only wire-level addition is the `X-Noon-Idempotency-Key` HTTP header (D3).
- **HMAC signing per attempt**: each retry MUST re-sign with a fresh timestamp via the existing `signWebsitePayload`. NoonWeb's `±5min` window requires this. Do NOT cache the signature header across retries.
- **Snapshot columns on `website_inbound_links` MUST keep being written** for every terminal outcome (D8 mapping table). Do NOT remove the existing snapshot writes; the new ledger is ADDITIVE.
- **Call-site signatures FROZEN**: `sendProposalReviewDecisionToWebsite(proposalId, action, actor?)` signature stays. Both call sites (`app/api/proposals/[proposalId]/review/route.ts:65` and `app/api/inbound/pm-queue/[proposalId]/review-webhook/route.ts:46`) are NOT modified.
- **Kill-switch coverage**: flag covers inline-retry ONLY. Ledger writes, cron sweeper, admin replay endpoint, and dead-letter alert wiring all remain active when the flag is `false`.
- **RLS**: admin-read-only `SELECT` policy. NO `INSERT`/`UPDATE`/`DELETE` policies — all writes via `service_role` (`createSupabaseAdminClient`).
- **`enqueue_user_notification` reuse**: use the existing 8-arg signature (see ADR-027 D6 drift verification). Do NOT introduce a new notification kind; reuse `'webhook_failure'`.
- **Authz parity**: cron uses `CRON_SECRET` bearer (B25 pattern); admin replay uses `requireRole(['admin'])`. Do NOT bypass either path.
- **Test seam (D12)**: dispatcher MUST accept injectable deps `{ fetchImpl, now, randomFn, client }` with production defaults. Do NOT couple retry math to global `Math.random` / `Date.now` in untestable ways.

### 19.3 Allowed shortcuts

- **`Retry-After` header on 429 is NOT parsed in G23** — D9 deliberately defers this. Standard backoff sequence is used. A future iteration may add parsing when (and if) NoonWeb actually starts emitting `Retry-After`.
- **No `claimed_at` lock column on the ledger** — D4 relies on Vercel cron serialization at `*/5 * * * *` cadence. If post-ship telemetry shows concurrent cron runs double-fetch (unlikely at this cadence), a future iteration adds explicit row-level claiming.
- **No backfill of pre-G23 `review_webhook_status='failed'` rows on `website_inbound_links`** — spec §4 makes this binding. The new ledger only records G23+ attempts.
- **No rate-limit on admin replay endpoint** — admin role is trusted; a future iteration may add if abuse surfaces.
- **`request_id` may be nullable on cron-driven rows** — D2 allows it. The column joins to Vercel logs when populated; cron-driven contexts may generate a local UUID or leave NULL.

### 19.4 Forbidden shortcuts

- **NO storing payload bytes** on the ledger. `payload_hash` only (matches inbound posture; D2). Storing bytes would expand PII surface and bloat the table.
- **NO writing the ledger row AFTER the first fetch.** The row MUST be created BEFORE the first fetch so that a process crash mid-fetch still leaves a `pending` row for the cron to discover.
- **NO sharing the same row across replay** — admin replay MUST spawn a new row (D7). Reusing the source row would corrupt history and break the `dead_letter` terminal contract.
- **NO different `idempotency_key` between original and replay** — D10 requires inheriting the source row's key verbatim. A different key would defeat cross-repo dedupe.
- **NO new outbound webhook surface in this iteration** — only `proposal_review_decision`. Generic abstraction extraction is conditional and deferred per spec §4.
- **NO bypass of `requireRole(['admin'])`** on the replay endpoint. `service_role` bypass is explicitly NOT a valid path; the cron handler is the only service-role context.
- **NO breaking change to `sendProposalReviewDecisionToWebsite`'s signature.** Call sites stay byte-identical.
- **NO new value added to `website_inbound_links.review_webhook_status` CHECK constraint or `current_status` CHECK constraint.** D8 mapping uses ONLY the existing four values (`pending|sent|failed|skipped`) and the existing terminal statuses (`review_webhook_sent|review_webhook_failed`). If a new value is needed, Architecture must be re-invoked.

### 19.5 Drift verifications passed (Architecture pre-Backend audit)

All assumptions in §7 and §8 verified against repo state. See ADR-027 § "Drift verifications surfaced" for the full table. **No drift failed.** One unresolved item is documented as an Infra dependency, not an architectural gap:

- **Vercel cron sub-hourly cadence (`*/5 * * * *`)**: ALL five existing crons in `vercel.json` are daily. Architecture's preference is `*/5`. Infra step MUST verify the Vercel project's plan tier supports sub-hourly schedules. If hobby-tier only allows daily, fallback to `0 * * * *` hourly (with `max_attempts` bumped from 3 to ~5 to compensate latency), OR escalate plan-tier upgrade. Backend codes as if `*/5` is final.

### 19.6 Handoff to Backend (G23 chain step 3)

- **Reference files Backend MUST read** (verbatim, in this order):
  1. `D:\Pedro\Proyectos\Noon\App-nooncode\docs\adrs\ADR-027-outbound-webhook-retry-and-dead-letter.md` (the full firm-decision pack).
  2. `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-r5-outbound-webhook-retry-policy.md` (this spec, including this §19 amendment).
  3. `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\website-integration.ts:683-813` (the function being rewrapped).
  4. `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\website\webhook-events.ts` (sibling helper module — template for the new outbound helper).
  5. `D:\Pedro\Proyectos\Noon\App-nooncode\supabase\migrations\0051_phase_20a_website_webhook_event_ledger.sql` (schema/RLS precedent).
  6. `D:\Pedro\Proyectos\Noon\App-nooncode\app\api\cron\webhook-failure-alert\route.ts` (cron template + alert extension target for D6).
  7. `D:\Pedro\Proyectos\Noon\App-nooncode\supabase\migrations\0034_phase_14a_website_inbound_integration.sql` (the `website_inbound_links` schema D8 dual-tracks with).
- **Files Backend creates**:
  - `supabase/migrations/0062_phase_3r5_outbound_webhook_events.sql` (per D2 shape).
  - `lib/server/website/outbound-webhook-events.ts` (per ADR-027 § "Helper module" signatures).
  - `app/api/cron/outbound-webhook-retry/route.ts` (per ADR-027 § "Cron handler shape").
  - `app/api/admin/outbound-webhooks/[eventId]/replay/route.ts` (per ADR-027 § "Admin replay endpoint shape").
  - Unit + integration tests per spec §11 + ADR-027 D12 (injectable deps for determinism).
- **Files Backend modifies**:
  - `lib/server/website-integration.ts` — rewrap `sendProposalReviewDecisionToWebsite` per ADR-027 § "Dispatcher refactor shape" pseudocode.
  - `vercel.json` — add `/api/cron/outbound-webhook-retry` cron entry (cadence per D4 / Infra verification).
  - `.env.example` — add `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` per ADR-027 § "Env-var reference update".
  - `app/api/cron/webhook-failure-alert/route.ts` — add third ledger scan per D6 (ADR-027 § "`webhook-failure-alert` cron extension shape").
  - `docs/integrations/cross-repo-webhook-v1.md` — add §X documenting the outbound `X-Noon-Idempotency-Key` header contract (per D3 cross-repo contract).
  - `lib/server/supabase/database.types.ts` — regen preferred (D10 ADR-016 path); override-block fallback if regen drops manual patches.
- **Test seam expectations** (per D12 + spec §11):
  - Dispatcher's retry loop is callable in tests with scripted `fetchImpl` (returning a queue of `Response` objects: `[503, 503, 200]` etc.) for deterministic backoff verification.
  - `now` is injectable for `next_retry_at` calculations.
  - `randomFn` is injectable (seeded) for deterministic jitter verification.
  - `client` is injectable for stubbing the Supabase admin client (existing patterns in `tests/server/` work).
- **Architecture outcome**: **Ready.** Backend may proceed.


