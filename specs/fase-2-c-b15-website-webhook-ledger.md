# spec.md — fase-2-c-b15-website-webhook-ledger

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-20
- Session ID: fase-2-c-b15-website-webhook-ledger
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec). Downstream chain prescribed by router: system-architecture → system-infra → system-backend → system-refactor → system-testing → system-security → system-docs → system-validator.
- Router mode: Hybrid New Build + Refactor (defense-in-depth on existing inbound endpoints).
- Depth: Full.

### OBJECTIVE
- Define the bounded scope and authoritative inputs for adding a transport-level idempotency ledger (`website_webhook_events`) to the two inbound v1 webhook endpoints (`/api/integrations/website/inbound-proposal` and `/api/integrations/website/payment-confirmed`), mirroring the proven `stripe_webhook_events` pattern (migration 0041 + `lib/server/stripe/webhook-events.ts`).
- The output is the input artifact for system-architecture, which signs the unresolved technical decisions (hash strategy, race-condition resolution mechanism, retention policy, ledger placement vs auth) before any code is written.

### CONTEXT USED
- `project.context.core.md`: yes — confirmed module map (inbound endpoints listed under "Website inbound review and payment handoff"); confirmed Operating rules (Stripe ledger pattern is the canonical reference per "Stripe webhook ledger idempotente (`0041` + `webhook-events.ts`)"); confirmed migration discipline (ADR-014 four-digit prefix convention, manual override blocks in `database.types.ts` until clean regen).
- `project.context.full.md`: not loaded in this session — this iteration follows an existing pattern (Stripe ledger 0041 + companion lib) and does not change cross-cutting architecture. Architecture will load it if needed.
- `project.context.history.md`: implicit via roadmap §17 snapshots already in scope notes (B15 has been on the deferred list since FASE 2 Bloque C started; latest reference 2026-05-13 snapshot).
- Reason `full` was included: not required for analysis.
- Reason `history` was included: B1.3b smoke 2026-05-18 closure validated the v1 inbound contract end-to-end against production; B15 is the next item in FASE 2 Bloque C per roadmap §6 and §17.

### ROUTER DECISION
- Mode: Hybrid New Build (new table + new lib module) + Refactor (two existing route handlers gain a new pre-business-logic step) is correct because (a) the table and the helper lib are wholly new artifacts; (b) the routes themselves are modified to call into the new ledger before invoking the business handlers; (c) the wire contract is unchanged (HTTP shape stays identical per `cross-repo-webhook-v1.md` §13 — B15 is mitigation of an internal "audit B15" finding, not a contract change).
- Depth: Full because (a) defense-in-depth on auth surfaces always needs explicit threat-model reasoning (eight router-prescribed risks listed below); (b) the iteration crosses architecture (table shape, hash strategy), infra (migration apply + types regen), backend (route refactor + new lib module), security (review of hash strategy + retention + PII implications), refactor (route handler shape changes), and testing (unit + integration against the existing inbound smoke fixtures). Lite would skip one of those skills and create silent gaps.
- Why analysis is the active skill now: nothing downstream can start until (a) the table column set is specified at a level architecture can sign without inventing; (b) the eight router risks are reduced to OPEN questions architecture must answer; (c) the no-go items (wire contract changes, observability dashboards) are explicitly excluded so they cannot creep in during implementation; (d) the success criterion is bounded so validator has an unambiguous gate.
- Reroute already known at start: no.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules" below.
- Contracts or architecture inputs available:
  - `docs/integrations/cross-repo-webhook-v1.md` — v1 wire contract. §2 auth, §3 inbound-proposal, §4 payment-confirmed, §8 idempotency model (current state vs B15 planned mitigation), §13 open issues (B15 listed Medium severity, "Add `website_webhook_events` mirror of `stripe_webhook_events` pattern").
  - `supabase/migrations/0041_phase_17a_stripe_webhook_event_ledger.sql` — canonical schema reference.
  - `lib/server/stripe/webhook-events.ts` — canonical helper-lib reference (`beginStripeWebhookEvent` / `markStripeWebhookEventProcessed` / `markStripeWebhookEventFailed`).
  - `lib/server/website-webhook-auth.ts` — current HMAC verify + raw-body capture (`readSignedWebsiteJson` already reads bodyText before parse — this is load-bearing for the hash strategy decision in Q1 below).
  - `specs/fase-1-b1-3b-inbound-smoke-cross-repo.md` — the live smoke validated v1 against production and documented divergences (notably the Q2 missing-timestamp issue, since FIXED per commit `92f1e0b` 2026-05-19 — see Operating rules and recent commits, F-1 / B1.3c).
  - `docs/tdrs/TDR-003-stripe-event-ledger.md` — the architectural rationale behind the Stripe ledger pattern (referenced; architecture will read in full).
- Relevant handoffs received from router:
  - 8 explicit risks (mapped 1:1 in OPEN questions Q1-Q8 below — no inventions).
  - 4 explicit no-objetivos that MUST be excluded.
  - Chain prescribed: analysis → architecture → infra → backend → refactor → testing → security → docs → validator.
  - Constraint: spec must be ~150-300 lines and not sign contracts that belong to architecture.
- External dependencies or environment assumptions:
  - Migration apply method per ADR-014 (Dashboard SQL Editor + manual ledger row when MCP auth not fresh; MCP `apply_migration` when fresh).
  - `database.types.ts` regen via MCP `generate_typescript_types` OR `npx supabase gen types typescript` after migration lands — and per Operating rules, the file currently carries 3 manual override blocks (`seller_fees`, `prototype_workspaces`, `lead_proposals`), so a new table addition may require an additional manual override block OR be the trigger for a clean regen (architecture decides).
  - F-1 / B1.3c fix is now merged (commit `92f1e0b` 2026-05-19) — the timestamp header is now strictly required at the auth layer, which removes one ambiguity that Q1 in B1.3b spec called out. This iteration assumes the post-F-1 auth surface is the baseline.

### RISK SNAPSHOT
- Known risks before starting: see "## Risks" below for the classified register (8 from router + 2 additional surfaced during context load).
- Known blockers before starting: none. The pattern is proven (Stripe ledger live in production since Phase 17A) and the inbound contract has been smoke-tested end-to-end (B1.3b closed 2026-05-18).
- Known assumptions before starting:
  - The HMAC verify in `lib/server/website-webhook-auth.ts` is post-F-1 (timestamp header strictly required); the ledger does not need to defend against the timestamp-missing case because the auth layer rejects it before the ledger is consulted.
  - The Stripe ledger pattern's race-condition resolution (idempotent UPSERT semantics via SELECT-then-INSERT or update) is acceptable as a starting point; architecture may strengthen it with a UNIQUE constraint + `ON CONFLICT` handling (see Q4 below).
  - The two inbound endpoints have distinct rate-limiter namespaces already (`website-inbound-proposal`, `website-payment-confirmed`), so the ledger table can use a single shape with an `endpoint` column or two narrow shapes — architecture decides (Q3 below).

### CONTINUITY NOTES
- Previous session relevant: B1.3b closure 2026-05-18 (live smoke against the v1 contract — PASS on all 7 scenarios; recorded Q2 timestamp divergence as a follow-up). B1.3c (F-1 fix) 2026-05-19: closed Q2 by making `x-noon-timestamp` strictly required at the auth layer. B15 was the next item already queued in roadmap §6 Bloque C.
- Expected next skill after this session if all goes well: system-architecture loads `project.context.full.md`, opens the 8 OPEN questions below, signs each decision, produces ADRs where appropriate (likely 1 new ADR for the ledger pattern adaptation; possibly amends TDR-003 references), then hands off to system-infra for the migration apply plan.

---

## Task Summary

Add transport-level idempotency to the two inbound v1 webhook endpoints by introducing a `website_webhook_events` ledger (new table + new lib helper + minimal route refactor) that mirrors the proven `stripe_webhook_events` pattern (migration 0041 + `lib/server/stripe/webhook-events.ts`). The ledger is consulted **after** HMAC + timestamp verification and **before** business-logic invocation; replays at the transport layer return a 200-shaped "already processed" response that matches the existing idempotent shape so the NoonWeb side sees no wire-level change. The wire contract (`docs/integrations/cross-repo-webhook-v1.md`) is **not** modified by this iteration — the ledger is internal defense-in-depth listed under "open issues B15, Medium severity, planned mitigation v2" in §13, and this iteration brings that mitigation into v1 without bumping the contract version.

App-level idempotency (lookup by `external_session_id` / `external_proposal_id` / `external_payment_id` in `website_inbound_links`) is **preserved unchanged** as the inner layer of defense. The ledger is the outer layer that protects against replays a malicious actor with a stale-but-valid signature could otherwise execute when external ids are forged or reused.

---

## Scope Boundary

### Included
- **Migration `00XX_phase_<N>_website_webhook_event_ledger.sql`** (4-digit prefix following ADR-014 convention; exact prefix decided by infra after checking the current ledger high-water mark).
  - New table `public.website_webhook_events` with columns covering: identity (signature_hash, payload_hash or both — Q1 decides), event metadata (endpoint, livemode-equivalent, received_at), status state machine (`processing | processed | failed | replay_detected`), attempt counter, error capture, and timestamps. Exact column list signed by architecture in Q2.
  - Indexes per the access pattern: at minimum on `received_at desc` (operator queries), on `endpoint` (filter), and on whatever pair forms the idempotency lookup (Q4).
  - UNIQUE constraint on the idempotency pair to make the first-write race explicit (Q4 decides whether `(signature_hash, payload_hash)` or `(endpoint, external_id, signature_hash)` is the right key).
  - RLS enabled with the same admin-only read policy as `stripe_webhook_events` (verbatim copy of the policy from migration 0041, only the table name swapped — see ## Affected Files for the exact pattern reference).
- **New helper module `lib/server/website/webhook-events.ts`** exposing the same 3-call surface as `lib/server/stripe/webhook-events.ts`:
  - `beginWebsiteWebhookEvent(client, eventInputs)` — SELECT-then-INSERT-or-UPDATE; returns `{ shouldProcess: boolean, status: WebsiteWebhookEventStatus, eventId: string }`.
  - `markWebsiteWebhookEventProcessed(client, eventId)`.
  - `markWebsiteWebhookEventFailed(client, eventId, error)`.
  - The module accepts the inputs needed to compute the row's identity (signature_hash, payload_hash, endpoint, headers metadata) — exact signature signed by architecture in Q1/Q2.
- **Refactor of two existing route handlers** to wrap their business-logic invocation in the ledger lifecycle:
  - `app/api/integrations/website/inbound-proposal/route.ts` — after `readSignedWebsiteJson` returns (signature + timestamp already verified per F-1), call `beginWebsiteWebhookEvent`. If `shouldProcess === false`, return the "already processed" response shape (200 with `idempotent: true` + best-effort recovered ids — Q6 decides recovery strategy). Otherwise proceed to existing `receiveWebsiteInboundProposal` call. On success → `markWebsiteWebhookEventProcessed`. On error → `markWebsiteWebhookEventFailed`.
  - `app/api/integrations/website/payment-confirmed/route.ts` — same shape adapted to that route.
- **Capture of raw body bytes** alongside the existing signature verification, so the payload_hash can be computed on the exact same bytes the signature was computed against. `readSignedWebsiteJson` already reads `request.text()` before parsing JSON — extend the helper (or wrap it) to return both the parsed payload and the raw bodyText + signature value to the route handlers, so the ledger insertion has both.
- **Unit tests** under `tests/server/website/webhook-events.test.ts` mirroring the structure of `tests/server/stripe/webhook-events.test.ts` (which exists per Grep result above). Coverage: first-time insertion, idempotent re-insertion, status transitions, error capture, UNIQUE-violation handling on race.
- **Integration tests** against both routes verifying:
  - Happy path: signed request → 201, ledger row created with status `processed`.
  - Replay (same signature + same payload): second call returns 200 with the same response shape as app-level idempotency would produce, no second business-side invocation.
  - Business-logic error: ledger row marked `failed` with error captured (no orphan `processing` rows on raise).
- **`database.types.ts` update** to include the new table (manual override block OR clean regen — architecture decides per Operating rules constraint).
- **Documentation updates** (system-docs scope, listed here for completeness):
  - `docs/context/project.context.core.md` — append a Closed-in-runtime entry; update Operating rules with the ledger-as-outer-layer rule.
  - `docs/integrations/cross-repo-webhook-v1.md` §8.2 — flip from "B15 planned mitigation v2" to "B15 implemented in v1 internal — wire contract unchanged" so the contract document stays honest.
  - `docs/integrations/cross-repo-webhook-v1.md` §13 — remove B15 from open issues (or mark resolved with date).
  - `C:\Users\pbu50\Desktop\Noon\NoonApp Roadmap.md` §6 Bloque C — flip B15 from pending to closed (per MEMORY rule "keep roadmap in sync").

### Excluded
- **Wire contract changes.** No new request header (`x-noon-event-id` proposed in cross-repo-webhook-v1.md §8.2 stays deferred to v2). Response shape stays identical. NoonWeb side requires no coordination because the contract surface does not change.
- **Outbound `proposal-review-decision` ledger.** B15 is internal defense for inbound only. Outbound App→Web idempotency is the Web side's responsibility per contract §5.4 and is tracked separately under audit B9 (Web).
- **Stripe webhook ledger changes.** The existing `stripe_webhook_events` table + `lib/server/stripe/webhook-events.ts` are untouched. If architecture finds a generalizable abstraction, that is a follow-up refactor (out of B15 scope).
- **Observability dashboard / metrics endpoint for replay rate or rejection rate.** Tempting to add given the table exists, but explicitly excluded; tracked as follow-up "B15-bis: observability over webhook ledgers".
- **Retention / TTL job.** Architecture decides the retention model in Q5; if a cron-based cleanup is required, that becomes a separate iteration. This iteration ships the table with retention as a documented policy, not as enforced code.
- **PII review / scrub of `inbound_payload` in the existing `website_inbound_links` table.** The new ledger does NOT store the payload — only its hash. The existing payload-storing tables are out of scope for this iteration's GDPR posture; they were already in production before B15 and B15 does not introduce new PII surface.
- **Replay detection that stores rejected-by-timestamp events.** Per Q7 below, the ledger insertion happens AFTER timestamp verification — events rejected at the auth layer are NOT logged in this table. Their evidence stays in Vercel logs only. This minimizes writes for adversarial traffic; observability follow-up may revisit.
- **NoonWeb-side notification of replay detection.** When the ledger detects a replay, the response shape matches the app-level idempotency shape (200 + idempotent: true). NoonWeb sees no distinct signal. Distinguishing transport-replay from app-replay is an observability concern, not a wire-contract concern.
- **Feature flag / staged rollout.** Architecture decides in Q8 whether the migration is safe to apply hot (it should be — pure additive change). If a flag is needed, that adds scope and is itself a question for architecture.
- **Modifying `app/api/integrations/website/inbound-proposal/route.ts` or `payment-confirmed/route.ts` for anything else** (e.g., changing log shape, adjusting rate-limit namespace, updating error codes). Only the ledger lifecycle wrap is added.

---

## Affected Files / Modules

### New files
- `supabase/migrations/00XX_phase_<N>_website_webhook_event_ledger.sql` — table + indexes + UNIQUE + RLS. Pattern reference: `supabase/migrations/0041_phase_17a_stripe_webhook_event_ledger.sql`.
- `lib/server/website/webhook-events.ts` — helper module. Pattern reference: `lib/server/stripe/webhook-events.ts`.
- `tests/server/website/webhook-events.test.ts` — unit tests. Pattern reference: `tests/server/stripe/webhook-events.test.ts`.

### Modified files
- `app/api/integrations/website/inbound-proposal/route.ts` — wrap `receiveWebsiteInboundProposal` call in ledger lifecycle.
- `app/api/integrations/website/payment-confirmed/route.ts` — wrap `receiveWebsitePaymentConfirmed` call in ledger lifecycle.
- `lib/server/website-webhook-auth.ts` — extend `readSignedWebsiteJson` (or add a sibling function) to return `{ payload, bodyText, signature, timestamp }` so the route handlers can pass the hash inputs to the ledger. The current function only returns the parsed payload; the bodyText is captured but discarded after verification.
- `lib/server/supabase/database.types.ts` — add the new table type (manual override block OR clean regen).
- `docs/integrations/cross-repo-webhook-v1.md` — §8.2 + §13 updates (status flip, not contract change).
- `docs/context/project.context.core.md` — Closed-in-runtime entry + Operating rules entry (per MEMORY: no plan refs).
- `C:\Users\pbu50\Desktop\Noon\NoonApp Roadmap.md` — §6 Bloque C + §17 snapshot update (per MEMORY: keep roadmap in sync).

### Files exercised but NOT modified
- `lib/server/website-integration.ts` — the business-logic functions `receiveWebsiteInboundProposal` and `receiveWebsitePaymentConfirmed` are called by the routes as today; the ledger wraps the call site, not the function. App-level idempotency inside these functions stays unchanged.
- `lib/server/stripe/webhook-events.ts` — reference only.

### External systems touched
- Supabase migration apply via MCP (preferred) or Dashboard SQL Editor (fallback per ADR-014).
- Vercel Production deploy after merge (auto-deploy per G11 fix 2026-05-17, pending empirical re-verification — see Operating rules).

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `stripe_webhook_events` table + companion lib live in production | contract / reference | Verified live (Phase 17A 2026-04-26-ish per migration 0041 prefix) | Without this reference, B15 has no proven shape to mirror; architecture would have to invent | Pre-existing, no action |
| F-1 / B1.3c fix merged (timestamp header strictly required at auth) | internal | Merged 2026-05-19 (commit `92f1e0b`) | If not merged, ledger would need to also defend against missing-timestamp; with F-1 merged, the auth layer pre-empts that case | Pre-existing, no action |
| Migration apply path (MCP fresh, OR Dashboard + manual ledger insert) | infra | Documented in Operating rules (ADR-014) | Migration cannot land cleanly; ledger row count in `supabase_migrations.schema_migrations` drifts | Pedro / system-infra |
| `database.types.ts` regen path (MCP `generate_typescript_types` OR `npx supabase gen types typescript`) | infra | Per Operating rules: 3 manual override blocks already exist; new table needs either an additional block or a clean regen | If not done, TypeScript fails to type the ledger queries | system-infra / system-backend |
| `@supabase/supabase-js` admin client (already in use by `createSupabaseAdminClient`) | internal | Live | None — pre-existing | Pre-existing |
| Vercel auto-deploy still functional post-G11 fix (or manual Deploy Hook) | infra | Empirically unverified per Operating rules — first post-G11 merge proves it | If broken, B15 lands in develop but not in Production until a deploy is forced | system-infra |
| No NoonWeb-side coordination required | external | Confirmed by scope — wire contract unchanged | None | NoonWeb is not paged for this iteration |
| Public repo posture (no secrets in migration, no PII in test fixtures) | infra / security | `nooncode-org/App-nooncode` is PUBLIC per Operating rules | If a test fixture leaks production-like PII or the test secret resembles the real shared secret, secrets are exposed | system-security review |

---

## Risks

The 8 router-prescribed risks (R1-R8) plus 2 surfaced during context load (R9, R10). Each risk is mapped to an OPEN question architecture must close before backend touches code.

| # | Risk | Probability | Impact | Severity | Mitigation | Owner question |
|---|---|---|---|---|---|---|
| R1 | Replay window vs idempotency window conflict — events rejected at the auth layer (timestamp out-of-window) leak into the ledger and pollute writes for adversarial traffic | Medium | Medium | Medium | Insert into ledger only AFTER timestamp+signature verification (Q7). Adversarial traffic never reaches the ledger | Q7 |
| R2 | Hash strategy mismatch — canonical JSON (`JSON.stringify(payload, Object.keys(payload).sort())`) loses byte fidelity vs raw body bytes; HMAC signature is already on raw bodyText so payload_hash should be too | High (if not consciously decided) | High (incorrect dedup) | High | Decide raw-bodyText-based hash; require `readSignedWebsiteJson` to expose bodyText to caller (Q1) | Q1 |
| R3 | PII in payload_hash — payload contains customer email; hashing the payload does not produce PII, BUT the row associates signature_hash with timestamps in a table queryable by admins, which has GDPR retention implications | Low | Medium | Medium | Architecture decides retention (Q5). Security reviews PII posture explicitly. Hash is one-way and never logged; only the metadata row persists | Q3 + Q5 |
| R4 | Race condition first-write — two concurrent requests with identical signature+payload both pass SELECT, both attempt INSERT, both succeed (no UNIQUE) producing duplicate rows; OR both succeed and both invoke business logic | High under load | High | High | UNIQUE constraint on idempotency key + `ON CONFLICT DO NOTHING` semantics OR exclusive-row-lock pattern. Stripe pattern uses SELECT-then-UPDATE-or-INSERT without an explicit UNIQUE — architecture decides whether to copy that or strengthen (Q4) | Q4 |
| R5 | Production migration risk (new table) — additive change with no backfill, BUT mid-traffic flip of route behavior might surprise NoonWeb if anything goes wrong | Low | Medium | Medium | Wire contract unchanged → NoonWeb sees no behavioral change in success cases. If a bug is introduced in the route refactor, a feature flag could disable the ledger and revert to pre-ledger behavior in seconds (Q8) | Q8 |
| R6 | Retention policy undefined — Stripe ledger has 2 years implied; if website ledger has no policy, table grows unbounded; if it has a stricter policy, replay-detection window is shorter | Medium | Low | Low | Architecture decides retention (Q5). Document but do not implement cleanup job in this iteration (out of scope) | Q5 |
| R7 | Observability gap — ledger enables replay-rate / rejection-rate metrics, but no dashboard exists today | Low (scope creep is the actual risk) | Low | Low | Explicitly excluded from B15 scope (see Excluded). Tracked as B15-bis follow-up | — |
| R8 | Cross-repo coordination concern — does NoonWeb see a different status code on replay? Contract §3.4 / §4.5 say replay returns 200 with `idempotent: true` already; new ledger should preserve that | Low | High (if violated, NoonWeb breaks) | High | Preserve the exact wire response shape. Q6 decides the recovery path when the ledger detects replay but the app-level idempotency lookup also runs (or doesn't) | Q6 |
| R9 | TypeScript regen friction — `database.types.ts` carries 3 manual override blocks per Operating rules; adding a 4th may not be the right tradeoff vs a clean regen | Medium | Low | Low | Architecture decides regen-now vs override-block (Q9 — added by analysis) | Q9 |
| R10 | First-write timing under cold-start — if the ledger SELECT-then-INSERT path serializes badly under a Vercel cold start, the inbound endpoint p95 latency may regress noticeably (current p95 unknown — no Sentry per ADR-009 deferral) | Low | Low | Low | Architecture decides whether to measure baseline first OR ship-and-watch via Vercel logs. No specific mitigation if we accept the ship-and-watch path | Q10 (advisory) |

---

## Open Questions

These questions block ARCHITECTURE, not analysis. Analysis cannot answer them without signing technical decisions that belong to architecture.

### Q1 — Hash strategy: raw bodyText vs canonical JSON
What goes into `payload_hash`? Options:
- (a) `sha256(bodyText)` — raw bytes captured by `readSignedWebsiteJson` (already done, just not exposed). Byte-identical to what HMAC was computed over.
- (b) `sha256(JSON.stringify(payload, Object.keys(payload).sort()))` — canonical-JSON over the parsed payload. More portable but loses byte-fidelity (e.g., float formatting, key ordering, whitespace).
- (c) Both — raw for dedup, canonical for cross-language verifiability.

Recommendation from analysis: (a). Architecture signs.

### Q2 — Ledger table column set
Minimum proposed columns: `id (uuid pk)`, `endpoint (text)`, `signature_hash (text)`, `payload_hash (text)`, `status (text check in 'processing|processed|failed|replay_detected')`, `attempt_count (int)`, `received_at`, `processed_at`, `failed_at`, `last_error (text)`. Plus context columns: `request_id (text)`, `external_session_id (text)`, `external_proposal_id (text)`, `external_payment_id (text nullable)` — these duplicate fields the business handler already extracts, but help operator queries.

OPEN: should the ledger row carry the extracted external ids (operator UX) or stay purely transport-level (signature_hash + payload_hash only, with no business identity leak)? Trade-off: operator queries vs minimalist surface.

Recommendation from analysis: include the external ids as nullable columns populated AFTER successful parse, NULL if parse failed. Architecture signs.

### Q3 — One table for two endpoints (`endpoint` column) vs two tables
Stripe ledger is one table for one endpoint (`/api/webhooks/stripe`). Website has TWO inbound endpoints. Options:
- (a) Single `website_webhook_events` table with `endpoint` discriminator column.
- (b) Two tables `website_inbound_proposal_events` + `website_payment_confirmed_events`.

Recommendation from analysis: (a). Less migration churn, single helper module, easier operator queries. Architecture signs.

### Q4 — Race-condition resolution
Stripe pattern uses SELECT-then-INSERT-or-UPDATE without an explicit DB-level UNIQUE on the lookup key (because `event_id` is itself the PRIMARY KEY — Stripe guarantees uniqueness per event id). Website has no equivalent natural key. Options:
- (a) UNIQUE constraint on `(signature_hash, payload_hash)` + handler catches `UNIQUE_VIOLATION` and returns "replay detected".
- (b) UNIQUE constraint on `(endpoint, signature_hash)` — assumes the same signature never legitimately applies to two different payloads (true by HMAC construction).
- (c) Advisory lock or `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` — Postgres-native, no app-level catch.

Recommendation from analysis: (c) with the unique key being `(endpoint, signature_hash)`. Architecture signs.

### Q5 — Retention policy
Options:
- (a) Same as Stripe ledger (no explicit retention today — implied 2 years per TDR-003, but no cron deletes).
- (b) Shorter (30-90 days) since the replay-window protection is most valuable in the near term and the table grows faster than Stripe ledger (two endpoints × current traffic).
- (c) No cleanup job in this iteration; document the policy in code comments and defer the cron to a follow-up.

Recommendation from analysis: (c) — ship the table with no cleanup, document the policy as a TODO. Cron is a separate iteration.

### Q6 — Replay response shape
When the ledger detects a replay (existing row with status `processed`), what does the route return? Options:
- (a) Re-query `website_inbound_links` to recover the original `linkId/leadId/proposalId/...` and return the full app-level idempotent response shape. Two reads instead of one.
- (b) Return a minimal shape `{ data: { idempotent: true }, ... }` without the recovered ids. Faster, but NoonWeb-side may be relying on the full shape per contract §3.4 / §4.5.
- (c) Store the original response shape in the ledger row's `last_response_json` column and replay it verbatim. One read, full fidelity, but ledger now holds business data.

Recommendation from analysis: (a). Wire contract preservation matters more than a saved read. Architecture signs.

### Q7 — Ledger insertion point relative to timestamp verification
Already addressed in scope: insertion AFTER timestamp+signature verification (current `readSignedWebsiteJson` flow), so adversarial traffic does not pollute the table. Architecture confirms.

### Q8 — Feature flag for staged rollout
The migration is additive (no behavior change for existing rows because there are no existing rows). The route refactor IS a behavior change. Options:
- (a) Ship behind `WEBSITE_WEBHOOK_LEDGER_ENABLED` env flag default-on; can be flipped off in seconds if a bug surfaces.
- (b) No flag — ship and rely on revert if a bug surfaces.

Recommendation from analysis: (a). The cost is one env var; the benefit is a 5-second rollback path that does not need a revert PR. Architecture signs.

### Q9 — `database.types.ts` regen vs manual override block
Per Operating rules, the file carries 3 manual override blocks. Adding a 4th sets precedent for "always manual" which is bad long-term. A clean regen now ALSO requires re-checking the 3 existing override blocks against current schema.

Recommendation from analysis: regen now if MCP auth is fresh; manual override block if not (and queue a clean regen as a follow-up). Architecture signs.

### Q10 — Baseline latency measurement (advisory)
The inbound endpoints have no documented p95. Adding a SELECT-then-INSERT (or INSERT-ON-CONFLICT) per request will move it. Without a baseline, we cannot quantify the regression. Options:
- (a) Measure p95 from Vercel logs over a 24-48h window before merging the refactor.
- (b) Ship-and-watch via post-deploy logs; revert via the feature flag if regression is severe.

Recommendation from analysis: (b). The pattern is proven on Stripe ledger (same shape, same RPC, no documented latency complaints). Architecture confirms.

---

## Assumptions

- Stripe ledger pattern transposes cleanly to website ledger: same RLS posture, same status enum, same lifecycle calls. Architecture validates by reading TDR-003 and confirming.
- F-1 / B1.3c fix is live in Production (commit `92f1e0b` merged 2026-05-19). The auth surface this iteration depends on is the post-F-1 surface.
- The wire contract document at `docs/integrations/cross-repo-webhook-v1.md` is the authoritative description of the wire contract; if the new ledger's behavior under replay needs a contract clarification (it shouldn't — replay returns 200 idempotent per §3.4 / §4.5 already), that triggers a coordinated PR per §14, which is out of scope here.
- NoonWeb-side is OK with no coordination required. If NoonWeb observability changes (e.g., they start counting 200-replay vs 201-new), that is their concern, not App's.
- Vercel auto-deploys post-G11 work (or manual Deploy Hook is acceptable fallback). The iteration does not block on this distinction.

---

## Chunking Decision

**Single iteration, not chunked.** The 6 deliverables (migration, lib module, two route refactors, types update, tests) are tightly coupled — the migration alone is useless without the lib module; the lib module alone is useless without the route call sites; the types update is forced by the migration. Splitting them across iterations would force orphan-PRs that cannot be merged safely.

Estimated effort: ~4h per roadmap §6 Bloque C estimate. Architecture may revise.

If during architecture the 8 open questions surface enough complexity to push the iteration above the 4-6h envelope, analysis re-routes to chunking (e.g., chunk A = migration + lib + types; chunk B = route refactors + tests). That decision belongs to architecture once Q1-Q9 are signed.

---

## Recommended Testing Methodology

**Unit-first + integration follow-up.** Justification: the lib module (`lib/server/website/webhook-events.ts`) is a pure-function-over-DB-client surface with no business logic — exactly the shape `tests/server/stripe/webhook-events.test.ts` proves works for the Stripe ledger. Unit tests cover the lifecycle calls in isolation; integration tests against the two routes verify the ledger lifecycle is correctly wired and replay returns the right wire shape.

TDD-strict not required — the pattern exists and the shape is known. CDD inappropriate — no behavior surface for cucumber-style. BDD inappropriate — no user-visible behavior change.

---

## Recommended Route Depth

**Full.** Justified above. Lite would skip the security review (PII / retention / hash-strategy review is non-trivial) and the architecture step (the 8 open questions are real and a Lite path would invent answers).

---

## Success Criterion

B15 is **COMPLETE** when **all** of the following hold:

1. Migration `00XX_phase_<N>_website_webhook_event_ledger.sql` applied in Production Supabase (`pdotsdahsrnnsoroxbfe`), schema_migrations row inserted per ADR-014.
2. `lib/server/website/webhook-events.ts` exists with the three-call surface (begin / mark-processed / mark-failed), test coverage >= 80% on the new file, all unit tests green.
3. Both inbound route handlers (`inbound-proposal/route.ts` + `payment-confirmed/route.ts`) wrap their business-logic invocations in the ledger lifecycle, preserving the wire contract response shape on success, on replay, and on error.
4. Integration tests verify: happy path → ledger row `processed`; replay → ledger row stays `processed` count==1, response shape is the existing idempotent shape; business error → ledger row `failed` with error captured.
5. `database.types.ts` reflects the new table (manual block OR regen).
6. Security review (system-security) returns zero CRITICAL and zero HIGH findings on the implementation. Any MEDIUM findings are explicitly accepted by the user OR addressed in this iteration.
7. `docs/integrations/cross-repo-webhook-v1.md` §8.2 + §13 updated to reflect B15 as implemented (not deferred to v2).
8. `docs/context/project.context.core.md` Closed-in-runtime + Operating rules updated (no plan refs per MEMORY).
9. `C:\Users\pbu50\Desktop\Noon\NoonApp Roadmap.md` §6 + §17 updated (per MEMORY).
10. system-validator returns COMPLETE.

If criterion 6 surfaces an unresolved CRITICAL or HIGH: B15 is **BLOCKED**. The finding is triaged and either fixed in-iteration or explicitly deferred with a risk register entry; validator does not return COMPLETE.

If criteria 1-5 pass but 7-9 are missing: B15 is **PARTIAL** until the documentation lands.

---

## Definition of Done

- All 10 success criteria above satisfied.
- Wire contract document accurately reflects implementation reality (no drift).
- Production Supabase + Production Vercel deploy carry the change and the ledger is observably writing rows under the next genuine inbound webhook traffic.
- Operating rules updated to record the new layer.
- No code, contract document, or migration touched outside the affected files list.
- system-validator returns COMPLETE.

---

## Handoff to system-architecture

system-architecture is the next active skill. Inputs already on disk (this spec). Required outputs from architecture before system-infra or system-backend can start:

- Signed decisions on Q1-Q9 above (Q10 advisory).
- 1 ADR draft if a generalizable decision is taken (e.g., "all transport-level webhook ledgers in App follow the Stripe pattern with UNIQUE on `(endpoint, signature_hash)` and `INSERT ... ON CONFLICT ... DO NOTHING` semantics").
- Final column list for the migration (signed answer to Q2).
- Final lib signature for `beginWebsiteWebhookEvent` (signed answer to Q1 + Q2).
- Final response-shape contract on replay (signed answer to Q6).
- Final feature-flag decision (signed answer to Q8).
- Final regen / override-block decision (signed answer to Q9).

When architecture is done: hand off to system-infra with the migration filename + apply method + types-regen method.

---

## Lifecycle

- Status: **Draft** (pending architecture sign on Q1-Q9).
- Moves to **Approved** when architecture closes Q1-Q9.
- Moves to **Implemented** when validator returns COMPLETE.
- No superseding spec planned.
