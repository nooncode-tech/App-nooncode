# Router decision — G23 outbound webhook retry policy + dead-letter

Date: 2026-05-26
Trigger: user requested "Hacemos G23"
Iteration owner: router
Status: DECIDED — handoff to system-analysis

---

## 1. Iteration framing

**Mode**: Refactor + small Backend addition over existing working code path.

Justification: the outbound webhook code path (`sendProposalReviewDecisionToWebsite` in `lib/server/website-integration.ts`) already works on the happy path. It signs, posts, persists row-level success/failure on `website_inbound_links`, and is called from PM-review surfaces. What we are doing is:
- Adding durability (dead-letter ledger), not changing the happy-path contract observable to NoonWeb.
- Adding retry-with-backoff inside the same call path, not introducing a new outbound surface.
- Adding a cron sweeper (same pattern as B25), not a new product feature.

This is not Bugfix (no broken behavior to fix — the existing failure handling is correct, just not durable enough for the cross-repo `/portal/[projectId]` invariant). It is not New Build. It is not Recovery (state of the code path is fully understood). It is not Infra-only (changes business-logic data model + persistence).

Treating G23 as Refactor + Backend addition keeps the framing honest: the outbound contract envelope, signature, and post-PM-review trigger semantics are unchanged. What changes is durability, retry, and operator visibility.

**Depth**: FULL.

Justification:
- Net-new table (`outbound_webhook_events` or equivalent) → schema change, RLS, advisors review.
- New cron entry → infra surface affected.
- New admin replay endpoint → new API route + authz scoping.
- Touches a cross-repo contract surface (App ↔ NoonWeb) even though the envelope is unchanged — retry behavior is now observable to NoonWeb (idempotency required on receiver side, or risk of duplicate-decision processing).
- ADR required.

LITE was considered and rejected: net-new persistence + cron + endpoint + cross-repo coordination signal cannot be honestly compressed into a LITE iteration.

---

## 2. Chain order and skills

Route (Refactor FULL + Backend additions + Infra cron + Security review + Docs):

1. `system-analysis` — produce `specs/fase-3-r5-outbound-webhook-retry-policy.md`. Bound scope, classify chunking, surface open questions for design (especially: which retry algorithm, dead-letter row identity, cron cadence, replay authz).
2. `system-architecture` — write ADR-026 (or next free ADR number; verify against `docs/adrs/` before claiming). Define: table schema, state machine, retry algorithm parameters, kill-switch env var, idempotency key cross-repo, admin replay endpoint contract.
3. `system-backend` — implement migration, ledger writes inside `sendProposalReviewDecisionToWebsite`, retry-with-backoff inline, dead-letter row creation on terminal failure, admin replay endpoint, cron sweeper handler.
4. `system-refactor` — only if implementation reveals shared abstraction worth extracting (e.g., generic `withOutboundWebhookRetry` wrapper for future outbound surfaces). Conditional, not mandatory.
5. `system-testing` — unit tests for retry-with-backoff (mocked fetch), unit tests for dead-letter row creation on exhaustion, ledger idempotency test, admin replay endpoint authz tests, cron handler test. Optional: light integration test against a mock receiver.
6. `system-security` — MANDATORY. Surfaces touched: new outbound retries (amplification risk if receiver returns 5xx forever — cap matters), admin replay endpoint (new authz surface, must reject non-admin), cron handler (must be service-role-only per B25 pattern), dead-letter row (no PII beyond what's already in the envelope but worth audit).
7. `system-infra` — verify cron registration in `vercel.json` matches B25 pattern, env vars added to `.env.example`, no production deploy needed in this iteration.
8. `system-docs` — update `docs/context/project.context.core.md` (Confirmed module map + Confirmed auth and data reality + Active risks for G23 closure), update roadmap §16 G23 status (PENDIENTE → CERRADO with iteration id), update roadmap §17 snapshot, optionally append to `docs/runbooks/` if operator replay procedure is non-obvious.
9. `system-validator` — final gate.

Skipped: `system-frontend` (no UI in this iteration — admin replay endpoint is operator-tool-only via curl/Postman; UI deferred). `system-audit` (state of code path fully understood).

---

## 3. Chunking decision

**Single PR, single iteration.** No chunking.

Justification:
- Touches exactly one domain: outbound webhook delivery layer for `proposal_review_decision`.
- All pieces (ledger + retry + cron + replay endpoint + ADR + tests + docs) are tightly coupled: the dead-letter table is meaningless without the cron, the cron is meaningless without retry exhaustion writing dead-letter rows, the replay endpoint is meaningless without dead-letter rows existing. Splitting forces interim states where part of the system is dark.
- Estimate from roadmap: 2-3 days. Within one validated iteration budget.
- Migration is additive (`if not exists`), no destructive change to existing schema.
- Existing call site is a single function — change is localized, not a sprawl across modules.

Chunking would only be triggered if Architecture surfaces unexpected scope (e.g., a generic outbound abstraction worth extracting to power future outbound surfaces beyond `proposal_review_decision`). If that happens, Analysis must flag it and router re-decides at that point.

---

## 4. ADR requirement

**YES** — new ADR required. Tentative number: **ADR-026** (verify next free number against `docs/adrs/` directory before writing; the `feedback_context_docs_no_plan_refs` rule does not apply to ADRs themselves).

Reasoning: G23 introduces a durable cross-cutting pattern (retry-with-backoff + dead-letter ledger for outbound webhooks) that future outbound surfaces will inherit (e.g., if/when App emits webhooks for `payment_confirmed_relay`, `prototype_decision_relay`, etc., the same pattern applies). It deserves the same level of contract documentation that ADR-016 gave the inbound ledger.

Decisions the ADR must explicitly pack:
- **D1: retry algorithm parameters** — attempts cap, base delay, jitter strategy, max delay cap, total time budget. Recommended: 3 attempts inline (post-5xx/network-error), exponential 2s → 4s → 8s with jitter ±25%, total budget ~14s. Beyond 3 inline attempts → dead-letter row.
- **D2: dead-letter ledger schema** — identity key (idempotency key cross-repo), state machine (`pending` → `delivered` | `dead_letter` | `replayed`), columns mirroring ADR-016 inbound pattern but for outbound semantics.
- **D3: idempotency contract cross-repo** — what header/key NoonWeb must use to de-duplicate replayed decisions (per current `signWebsitePayload` envelope: `external_proposal_id` is the natural key; this should be documented as the de-dupe key for NoonWeb's receiver side, escalated cross-repo).
- **D4: cron sweeper cadence** — recommend 5min cadence aligned with B25 patterns; sweeps `pending` rows past their next-retry-at timestamp; bounded batch size; same `cron` runtime contract.
- **D5: kill-switch env var** — `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` boolean default `true`; when `false` the system reverts to the pre-G23 single-attempt behavior (operator panic switch).
- **D6: dead-letter alert** — alert when dead-letter row count or oldest dead-letter row age exceeds threshold (align with B25 `user_notifications` admin inbox).
- **D7: admin replay endpoint** — `POST /api/admin/outbound-webhooks/[eventId]/replay`, admin-only, idempotent (replaying a `delivered` row is a no-op), generates a fresh delivery attempt.
- **D8: relationship to existing row-level state on `website_inbound_links`** — explicit: the row columns (`review_webhook_status`, `review_webhook_attempted_at`, etc.) remain the snapshot of latest delivery outcome for that lead/proposal; the new ledger is the historical attempt log. Same dual-track pattern as ADR-016 (`website_webhook_events` ledger + transactional rows on business tables).

---

## 5. Migration prefix

Per `feedback_context_docs_no_plan_refs` and ADR-014 ledger convention: next migration prefix should be the next free number after `0061_phase_23b_maxwell_niche_system.sql`. Tentative: `0062_phase_3r5_outbound_webhook_events.sql`. Verify against `supabase/migrations/` immediately before writing the file. Migration must be additive, idempotent (`if not exists`), and must register itself in the ledger after manual apply per the established G17/G22 procedure.

---

## 6. Risk pre-flags for Analysis

These are not blockers — they are signals Analysis should bound and Architecture must resolve. Surfacing here so they do not get lost.

**R1 — Amplification under sustained receiver outage**: if NoonWeb is hard-down for hours, retry budget × dead-letter pile-up could create operator noise + Upstash rate-limit cost. Mitigation lives in D4 (cron batch cap) + D6 (alert threshold). Architecture must define the numbers.

**R2 — Cross-repo idempotency invariant**: NoonWeb's receiver (`noon-web-main`) currently has no documented dedupe-on-replay behavior for `proposal_review_decision`. If we ship retry-with-backoff and NoonWeb processes the same decision twice (because attempt N timed out App-side but reached NoonWeb-side), we corrupt the portal v3 state. The ADR must document the cross-repo de-dupe key (proposed: `external_proposal_id` + `decision` is sufficient because a single proposal can only transition once into each terminal state). This is a cross-repo coordination signal that must escalate to NoonWeb before this iteration ships to production — same posture as the existing recorded NoonWeb HMAC-timestamp risk in `project.context.core.md` Active risks. Architecture should explicitly flag this in the ADR and Docs should escalate it in the cross-repo handoff.

**R3 — Cooling window vs retry budget interaction**: existing `consolidate_payment_earnings` uses a 7-day cooling window. Not directly coupled with G23 (different domain), but flagged because both share the daily cron infrastructure under B25 — Infra step must verify the new cron entry does not collide with B25 schedules.

**R4 — Replay endpoint authz**: must be `admin`-only (not `pm`, not `sales_manager`, not `service_role`-bypass-from-cron). The cron sweeper uses `service_role` (B25 pattern), the operator-triggered replay uses admin principal. Security must verify this distinction is preserved.

**R5 — Kill-switch semantic precision**: when `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED=false`, does the system (a) skip ledger writes entirely and revert to legacy behavior, or (b) write a single `pending → dead_letter` row immediately on first failure (no inline retry but still durable)? Recommended (b) — preserves durability even in panic mode. Architecture must lock this.

**R6 — Backfill on existing failed rows**: there exist rows today with `review_webhook_status='failed'` on `website_inbound_links` that have no corresponding ledger entry (because the ledger does not exist yet). Question: does Backend backfill those into the new ledger on first cron run, or do we declare them out-of-scope and let operators manually trigger via SQL? Recommended: declare out-of-scope for this iteration; Analysis must capture this explicitly in spec lifecycle section so a follow-up iteration handles backfill (if needed) or formally declares it not worth backfilling (likely the case — pre-G23 failures predate the cross-repo `/portal/[projectId]` invariant since NoonWeb has not shipped that route yet).

**R7 — NoonWeb `/portal/[projectId]` not yet shipped**: per the bug recall and roadmap §16 G23 verbatim, the bug is latent because NoonWeb has not shipped the surface that exposes the decision to the client. This is good (we have time to ship G23 before the cross-repo invariant becomes user-visible) but also means there is NO production runtime evidence to gather for this iteration in the usual sense. Validator should accept "tests + simulated dead-letter run + ledger row inspection" as evidence, not "browser-visible portal state". Analysis should bound this explicitly in the spec acceptance criteria.

---

## 7. Context loading recommendation for next skill

**For Analysis (next skill)**: `docs/context/project.context.core.md` is sufficient as default per CLAUDE.md session discipline. `project.context.full.md` load is NOT required for Analysis because the scoping work does not need deep architecture truth — it needs scope bounding, dependency mapping, and chunking decision (all of which the core context + this handoff already give it).

**For Architecture (skill after Analysis)**: load `project.context.full.md` in addition to core. ADR-016 (inbound ledger pattern), ADR-014 (migration ledger convention), and B25 cron implementation details all live in the full context or in `docs/adrs/`. Architecture must read at least `docs/adrs/ADR-016-*.md` (inbound webhook ledger) and `docs/adrs/ADR-014-*.md` (migration ledger) verbatim before writing ADR-026 — those are the precedent patterns ADR-026 will mirror.

**For Backend**: full context not required if Architecture's ADR is complete and the spec contracts are clear. Backend reads ADR-026 + spec + the implementation file + existing inbound ledger code (`lib/server/website/webhook-events.ts`) as the implementation template.

**For Security**: load full context — same posture as B25 closure security review.

**For Validator**: full context mandatory per project rules.

---

## 8. Handoff payload to system-analysis

### Inputs Analysis must consume

1. This router decision doc.
2. Roadmap §16 G23 verbatim (already quoted in trigger; Analysis re-reads to confirm scope match).
3. Current code path: `lib/server/website-integration.ts:683-813` (function `sendProposalReviewDecisionToWebsite`).
4. Reference pattern: `lib/server/website/webhook-events.ts` (inbound webhook events ledger — ADR-016 closure).
5. Reference pattern: existing crons in `vercel.json` and `app/api/cron/*` (B25 closure pattern).
6. Existing failure state columns on `website_inbound_links`: `current_status`, `review_webhook_status`, `review_webhook_attempted_at`, `review_webhook_sent_at`, `review_webhook_error`.

### Outputs Analysis must produce

1. `specs/fase-3-r5-outbound-webhook-retry-policy.md` per CLAUDE.md iteration specs convention. Spec must include:
   - Scope statement (one paragraph, what this iteration includes and excludes).
   - Affected modules list (Backend, persistence layer, cron, admin API, docs, ADR).
   - Risk classification (R1–R7 from §6 above — Analysis may add R8+ if new risks surface).
   - Chunking confirmation (single PR confirmed unless Analysis disputes).
   - Acceptance criteria for Validator (concrete, testable — e.g., "given a stubbed receiver returning 503 for 3 attempts, ledger row transitions to `dead_letter` with `attempt_count=3` and `next_retry_at` cleared").
   - Open questions for Architecture (the 8 ADR decisions in §4 are the minimum set; Analysis may add more).
   - Out-of-scope declarations (R6 backfill explicitly, UI for admin replay explicitly, generic abstraction extraction explicitly conditional on Architecture).
   - Lifecycle section (filename, supersedes nothing, expected duration 2-3 days, single PR).

2. Decision on whether Architecture is required vs. whether Backend can proceed directly. Router pre-decision: **Architecture is required** because ADR-026 must exist and the 8 D-points must be locked before Backend writes code. Analysis may confirm or escalate.

3. Confirmation that no scope creep is happening (e.g., Analysis must NOT expand to "also harden NoonWeb-side receiver" — that is a cross-repo iteration owned by `noon-web-main`).

### What Analysis must NOT do

- NOT invent retry parameters (that is Architecture's D1).
- NOT design the dead-letter table schema (that is Architecture's D2).
- NOT write code.
- NOT touch the existing call site.
- NOT modify roadmap or context docs (that is Docs at iteration close).
- NOT skip flagging R2 cross-repo idempotency — even if it feels like a "future problem", it is a blocker for production-ready ship.

---

## 9. Closure obligations for this iteration

When Validator approves COMPLETE:
- `docs/context/project.context.core.md` updated with G23 closure entry (under Confirmed auth and data reality, mirroring the existing inbound webhook closure entries).
- Roadmap §16 G23 status flipped PENDIENTE → CERRADO with iteration id `fase-3-r5-outbound-webhook-retry-policy` and PR link.
- Roadmap §17 snapshot updated to reflect the new closure.
- ADR-026 (or next free) signed and indexed.
- Spec file in `specs/` committed.
- Migration file in `supabase/migrations/` committed and applied to remote `pdotsdahsrnnsoroxbfe` with ledger row registered (per ADR-014 manual-apply procedure).
- Cross-repo signal to NoonWeb recorded as an Active risk in core.md if R2 idempotency is not yet symmetrically implemented on the receiver side (likely outcome — NoonWeb work is its own iteration).

Per `feedback_no_auto_merge_prs`: after `gh pr create`, stop. Operator merges.
Per `feedback_develop_pr_only_or_local`: PR against develop. No direct push.
Per `feedback_context_docs_no_plan_refs`: closure entries in `docs/context/*.md` use feature language only — no R-codes, no Sprint numbers, no plan IDs. Roadmap is the place for plan IDs; context docs are not.

---

## 10. Next action

**Invoke `system-analysis`** with this handoff doc and the inputs in §8 as the sole context payload (plus `docs/context/project.context.core.md` per CLAUDE.md default).

Router is now idle. No further router action until Analysis returns a spec.
