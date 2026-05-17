# spec.md — fase-3-earnings-lifecycle

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-17
- Session ID: fase-3-earnings-lifecycle
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-architecture → system-backend → system-testing → system-docs → system-validator
- Router mode: New Build
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope the implementation of the automatic earnings consolidation trigger as a single bounded iteration. This closes the FASE 2 Bloque A pending item (roadmap §6) by replacing the manual `POST /api/admin/earnings/consolidate` step with an automatic Vercel cron that transitions earnings from `pending` (post-payment) to `available_to_withdraw` (ready for payout) after a configurable cooling period, atomically with the corresponding `seller_fees` state machine transition (`confirmed → pending_payout`).
- Why this work matters now: the seller fee state machine (B3 closure) defined five states but only `potential → confirmed` and `confirmed → cancelled` have callers. `confirmed → pending_payout` (the consolidation step) has the service-layer function `markPendingPayout` but no production trigger — it has been called only from its own unit tests. The wallet bucket consolidation `pending → available_to_withdraw` lives in `lib/server/earnings/admin.ts::consolidateEarnings` and is gated behind a manual admin endpoint that is not even surfaced in the UI. The two operations are decoupled, non-atomic, and require operator memory to fire on each seller fee. This iteration unifies them and automates the trigger.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: yes (architecture-impacting — new cron route, new orchestration service, new env var for the cooling period; touches the `seller_fees` state machine and the wallet bucket model — both load-bearing)
- `project.context.history.md` reviewed: no (the relevant history is captured in core.md operating rules + ADR-007 + ADR-014)
- Reason `full` was included: this iteration introduces a new automatic background trigger that mutates wallet balances. Wrong design = silent corruption of seller earnings. Architecture review is mandatory.

### ROUTER DECISION
- Why this mode is correct: New Build. The cron route, the orchestration service, and the cron schedule entry are all net-new. The existing `seller_fees::markPendingPayout` and `earnings/admin.ts::consolidateEarnings` are pre-existing primitives that this iteration composes into a single atomic operation; the composition itself is new behavior.
- Why this depth is correct: Full because the new trigger mutates monetary balances on a schedule with no manual approval step in the default path. A bug would silently shift seller earnings from `pending` to `available_to_withdraw` (where they become withdrawable via Stripe Connect), so the safety properties (idempotency, atomic transaction, replay-safety on cron retries) need explicit design.
- Why this skill is the right active skill now: nothing else can route until the affected-files inventory is complete and the cooling-period decision is locked. Architecture cannot design the cron contract without scope; backend cannot wire it without architecture's transaction model.
- Reroute already known at start: no.

### SCOPE
- In scope: see `## Scope Boundary`.
- Explicitly out of scope: see `## Scope Boundary`.
- Success criterion: see `## Success Criterion`.

### INPUTS
- Files/modules involved: see `## Affected Files / Modules`.
- Contracts or architecture inputs available:
  - `docs/contracts/seller-fee-state-machine.md` — entity contract; rule "Confirmed → Pending payout when the confirmed earning enters the payout queue per the existing payout/wallet rules" is the operational anchor.
  - `docs/adrs/ADR-007-seller-fee-state-machine.md` — state machine decisions; defers `pending_payout` mechanics to a follow-up iteration. **This iteration is that follow-up.**
  - `docs/adrs/ADR-014-migration-ledger-reconciliation.md` — ledger conventions for new migrations (if any). This iteration likely does **not** require a new migration; the existing columns (`seller_fees.pending_payout_at`, `wallet_accounts.pending` / `.available_to_withdraw`) are sufficient.
  - `docs/product/master-spec-v3.md` §24.4 — earnings states canonical definition.
- Relevant handoffs received: roadmap §17 entry "Path C — FASE 3 lifecycle" with user confirmation 2026-05-17 to start now. Decision gating on the trigger: **cron job with configurable cooling period (Option B)** confirmed by user; cron threshold default 7 days, configurable via env var.
- External dependencies or environment assumptions: Vercel Cron is already wired in this project (`vercel.json` has one cron entry for `/api/leads/auto-followup` daily). The new entry runs as a peer. Supabase RPCs `credit_wallet_bucket` and the existing `consolidateEarnings` non-RPC helper are reusable; a new RPC for atomic consolidation may or may not be needed (architecture decision).

### RISK SNAPSHOT
- Known risks before starting:
  - **Atomicity:** `seller_fees` state transition and wallet bucket move must succeed or fail together. Today they are non-atomic (two separate calls, no transaction boundary). Architecture must decide between (a) a Postgres RPC that does both in a single transaction, or (b) compensating logic if one side fails after the other. Wrong choice = balance corruption.
  - **Idempotency:** Vercel Cron retries on failure. Each row processed twice would double-credit the available bucket. The state machine guard in `markPendingPayout` (skips if already `pending_payout`) helps, but the wallet move must also be guarded. A `consolidated_at` column on `wallet_ledger_entries` or a re-query of the bucket after the state flip can serve as the guard.
  - **Multi-actor per payment:** A single Stripe payment generates up to 3 `earnings_ledger` rows (seller, developer, noon) and credits 2 wallet buckets (seller, developer; noon has no actor wallet). The cron must consolidate all of them in lockstep for a given payment, not piecemeal.
  - **Unassigned developer at payment time:** When the developer was not yet assigned at payment time, `earnings_ledger.actor_id IS NULL` for the developer row and no wallet credit was created. Today there is no retroactive credit when the developer is later assigned. The cron must skip these rows (or surface them) — it cannot create new credits for actors that did not receive the original pending credit.
  - **Cron auth:** Vercel Cron calls `/api/cron/<path>` from a known internal source (`x-vercel-cron` header). The handler must reject calls without that header to prevent unauthenticated triggers from operators or external probes.
  - **Refund window collision:** Stripe permits refunds up to 180 days by default. A 7-day cooling period leaves a 173-day window where a refund could fire on an already-consolidated earning. The refund handler (`handleChargeRefunded`) today flips `seller_fees.state → cancelled` and updates `earnings_ledger.status → cancelled` for the rows, but does NOT debit `wallet_accounts.available_to_withdraw` (only the `pending` bucket reversal is partial — see roadmap §17 Path G). After this iteration ships, a post-consolidation refund will leave the seller's `available_to_withdraw` inflated until Path G lands. **Accept this risk for the pilot**; document in the iteration closure and in §16 G14 (new entry).
  - **Cron schedule overlap:** the existing cron (`/api/leads/auto-followup` at 0 9 * * *) is a peer; pick a non-overlapping minute to keep logs readable.
- Known blockers before starting: none.
- Known assumptions before starting: the cooling period is uniform across all earnings of a single payment (seller + developer + noon all consolidate on the same day relative to `paid_at`). No per-actor tiered cooling.

### CONTINUITY NOTES
- Previous session relevant to this one: same day session. G7 closed in PR #62 + #63 (ledger reconciled, types regenerated, drift fixed). Pricing gatekeeper closed in PRs #59-61. FASE 1 100%. This iteration starts FASE 2 Bloque A in earnest.
- Expected next skill after this session if all goes well: system-architecture — define the atomic transaction contract for `consolidateEarningsForPayment`, decide RPC-vs-application-layer composition, decide the idempotency guard. Then system-backend.

---

## Task Summary

Build the automatic earnings consolidation trigger:

1. **Vercel Cron route** at `app/api/cron/consolidate-earnings/route.ts` that runs daily.
2. **Query** all `payments` rows where `status = 'succeeded'` AND `paid_at < now() - <cooling period>` AND (their associated `seller_fees.state = 'confirmed'` OR there exist `wallet_ledger_entries` with `balance_bucket = 'pending'` not yet consolidated).
3. **Per payment**, in an atomic operation:
   - Transition `seller_fees.state: confirmed → pending_payout` via the existing `markPendingPayout` service.
   - Move all `wallet_ledger_entries` rows for actors (seller + developer if non-null) tied to this payment from the `pending` bucket to `available_to_withdraw`, with corresponding entries in `wallet_ledger_entries` and a balance update on `wallet_accounts`.
4. **Idempotent**: re-running the cron processes only payments not yet consolidated. A second run of the cron is a no-op against the same row.
5. **Authenticated**: reject calls without `x-vercel-cron` header (returning 401).
6. **Logged**: structured logs per payment processed, with counts at the end.

The cooling period defaults to **7 days** and is configurable via `EARNINGS_CONSOLIDATION_COOLING_DAYS` env var (positive integer). Schedule: daily at `30 6 * * *` (6:30 AM UTC, 2.5 hours before the existing `/api/leads/auto-followup`).

Manual admin override path stays through the existing `POST /api/admin/earnings/consolidate`, but the endpoint gets refactored in this iteration to **also** transition the seller_fees state (today it only moves the wallet). This ensures both the automatic cron and the manual override produce the same end state.

---

## Scope Boundary

### In scope

- **Migration 0048_phase_19b_consolidation_idempotency.sql** (TBD by architecture): if architecture decides an `earnings_ledger.consolidated_at` column or a new RPC is required for atomicity / idempotency, the migration ships here. Otherwise this iteration is migration-free.
- **New module `lib/server/earnings/consolidation-service.ts`** with `consolidateEarningsForPayment(adminClient, { paymentId })` that orchestrates state machine + wallet bucket move atomically per payment.
- **Refactor `lib/server/earnings/admin.ts::consolidateEarnings`** to call into the new service so the manual admin endpoint and the cron share the same atomic primitive. Existing input shape (`targetProfileId`, `amount`, `actorProfileId`) is preserved for backwards compatibility; internally it routes through the new service.
- **New route `app/api/cron/consolidate-earnings/route.ts`**:
  - Method: GET (Vercel Cron uses GET).
  - Auth: rejects without `x-vercel-cron` header (401).
  - Body: optional `?dryRun=true` query param for diagnostic runs without mutations.
  - Reads `EARNINGS_CONSOLIDATION_COOLING_DAYS` (default 7).
  - Iterates over eligible payments, calls the consolidation service per payment.
  - Returns JSON summary: `{ processed: N, skipped: M, errors: [...] }`.
- **Vercel Cron entry** in `vercel.json` for the new route, daily at `30 6 * * *`.
- **`.env.example`** updated with `EARNINGS_CONSOLIDATION_COOLING_DAYS=7`.
- **Unit tests** (in `tests/server/earnings/consolidation-service.test.ts`):
  - Happy path: payment with seller-only earnings → consolidated atomically.
  - Happy path: payment with seller + developer earnings → both consolidated.
  - Idempotency: re-running consolidation on already-consolidated payment → no-op.
  - Seller fees state guard: skip when `seller_fees.state !== 'confirmed'` (already paid_out, cancelled, or still potential).
  - Unassigned developer row: skip the developer side, consolidate seller side.
  - Wallet integrity: ledger entries match wallet account deltas exactly.
- **Cron handler tests** (in `tests/api/cron/consolidate-earnings.test.ts`):
  - Reject without `x-vercel-cron` header (401).
  - Dry run mode reports what would be processed but does not mutate.
  - Cooling period boundary: payment paid exactly at `now() - 7d` is included; paid at `now() - 6d 23h` is excluded.
- **Documentation**:
  - Operating rule in `docs/context/project.context.core.md` describing the new lifecycle invariant.
  - Runbook entry at `docs/runbooks/cutover-pilot.md` §X for failure modes (cron failure, partial consolidation, refund-after-consolidation post-iteration risk).
  - Roadmap §16 entry G14 (new) capturing the refund-after-consolidation gap until Path G ships (wallet reversal RPC).
  - Roadmap §17 snapshot update on closure.
- **ADR-015** (if architecture decides a new RPC is needed, or if the atomicity strategy warrants its own decision document; otherwise the architecture handoff is enough).

### Explicitly out of scope

- **Path G (wallet reversal RPC)** — the refund handler debiting the `available_to_withdraw` bucket on post-consolidation refunds. Stays deferred per roadmap §17. This iteration documents the gap in G14 + runbook but does not close it.
- **Retroactive developer earnings** when the developer is assigned after payment but before consolidation. The cron skips developer rows where `earnings_ledger.actor_id IS NULL` at consolidation time. A separate iteration can decide whether to credit retroactively (and from which actor — likely admin manual action).
- **Per-actor tiered cooling periods** (e.g., seller=7d, developer=14d). One uniform period across all actors of a payment.
- **Admin UI for consolidation status** (visualizing which payments are pending consolidation, which have been consolidated, etc.). The existing manual admin endpoint stays; building a UI is a separate iteration.
- **Notification on consolidation** (emailing the seller that their earnings are now withdrawable). Cross-repo with NoonWeb per ADR-012; deferred to v3.
- **Stripe Connect transfer at consolidation** (i.e., automatically initiating a payout). Consolidation only moves the bucket; the seller still has to manually initiate the payout via the existing flow.
- **Membership-type earnings** (per spec v3 §24 there is a `membership` earnings type alongside `activation`). Only `activation` earnings exist in the runtime today; the cron operates only on `earning_type = 'activation'`. Membership-type consolidation lands when membership is implemented.

---

## Affected Files / Modules

| File | Change |
|---|---|
| `supabase/migrations/0048_phase_19b_consolidation_idempotency.sql` (new, TBD by architecture) | Possibly adds `wallet_ledger_entries.consolidated_at` or a new RPC `consolidate_payment_earnings`. Architecture decides; iteration may be migration-free if the existing primitives compose safely |
| `lib/server/earnings/consolidation-service.ts` (new) | `consolidateEarningsForPayment(adminClient, { paymentId, actorProfileId, dryRun })` — orchestrates state machine + wallet bucket atomically |
| `lib/server/earnings/admin.ts` | Refactor `consolidateEarnings` to delegate to the new service. Preserve existing input shape for backwards compatibility |
| `app/api/cron/consolidate-earnings/route.ts` (new) | Vercel Cron handler. Auth via `x-vercel-cron` header. Reads `EARNINGS_CONSOLIDATION_COOLING_DAYS` env. Iterates eligible payments, calls service per payment, returns JSON summary |
| `vercel.json` | Add cron entry: `{ "path": "/api/cron/consolidate-earnings", "schedule": "30 6 * * *" }` |
| `.env.example` | `EARNINGS_CONSOLIDATION_COOLING_DAYS=7` |
| `scripts/validate-runtime-env.ts` | Validate the new env var is a positive integer when set (optional with default 7) |
| `tests/server/earnings/consolidation-service.test.ts` (new) | 6+ unit tests per `## Scope Boundary` `Tests` |
| `tests/api/cron/consolidate-earnings.test.ts` (new) | 3+ tests covering auth + dry-run + cooling boundary |
| `tests/infra/env-example.test.ts` | Extend to require `EARNINGS_CONSOLIDATION_COOLING_DAYS` line in template |
| `docs/context/project.context.core.md` | Operating rule on the consolidation lifecycle invariant |
| `docs/runbooks/cutover-pilot.md` | New §X.X entry on consolidation failure modes |
| Roadmap §16 (operator's Desktop file) | G14 new entry on post-consolidation refund gap |
| Roadmap §17 (operator's Desktop file) | Closure snapshot on session end |

---

## Success Criterion

The iteration is COMPLETE when all of the following hold:

1. The cron route `GET /api/cron/consolidate-earnings` exists and rejects calls without `x-vercel-cron` header with HTTP 401.
2. `vercel.json` contains the new cron entry; Vercel Dashboard shows it scheduled.
3. Calling the route (manually via `x-vercel-cron` header, or after the next scheduled run in Production) processes all `payments` with `paid_at < now() - EARNINGS_CONSOLIDATION_COOLING_DAYS` whose associated `seller_fees.state = 'confirmed'`:
   - `seller_fees.state` transitions to `pending_payout` with `pending_payout_at` set.
   - For each `wallet_ledger_entries` row with `reference_id = payment.id` and `balance_bucket = 'pending'`, a paired ledger entry is created with `balance_bucket = 'available_to_withdraw'`, `entry_type = 'earnings_distribution'`, `status = 'confirmed'`, `reference_type = 'consolidation'`.
   - `wallet_accounts.pending` decreases by the consolidated amount; `wallet_accounts.available_to_withdraw` increases by the same amount.
   - Sum of `wallet_accounts.{pending + available_to_withdraw + available_to_spend + locked}` is invariant across the operation (no money leaks).
4. Re-running the cron on the same payment is a no-op (idempotent): `seller_fees.state` stays `pending_payout`, no new ledger entries appear, wallet account totals stay the same.
5. Calling the route with `?dryRun=true` returns the count of payments that would be processed and a sample of payment IDs, but mutates nothing.
6. The existing manual `POST /api/admin/earnings/consolidate` endpoint continues to work for admin-driven cases and also transitions the `seller_fees` state (refactor ensures parity).
7. All existing tests (current baseline 297) continue to pass; new unit tests are added per `## Scope Boundary` and all pass.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` are green.
9. `docs/context/project.context.core.md` updated with the operating rule.
10. `docs/runbooks/cutover-pilot.md` updated with the §X.X entry.
11. Roadmap §16 G14 entry created (post-consolidation refund gap, deferred to Path G).
12. Validator (system-validator skill) returns COMPLETE.

---

## Implementation Chunks

### Chunk 1 — Architecture handoff (~30-60 min, ADR if needed)
System-architecture skill defines:
- The atomic transaction model: single Postgres RPC vs application-layer with compensating logic.
- The idempotency guard: column-based (`consolidated_at`), state-based (re-query state machine), or both.
- The cron eligibility query: pseudo-SQL spelled out.
- ADR-015 if the RPC vs application choice is a non-trivial commitment.

Output: architecture handoff payload + ADR-015 if applicable.

### Chunk 2 — Migration + service core (~2-3 h)
Per architecture handoff:
- Migration 0048 (if needed).
- `lib/server/earnings/consolidation-service.ts` with `consolidateEarningsForPayment`.
- Refactor `lib/server/earnings/admin.ts::consolidateEarnings` to delegate.
- 6 unit tests covering happy paths + idempotency + edge cases.

### Chunk 3 — Cron route + Vercel Cron entry (~1-2 h)
- `app/api/cron/consolidate-earnings/route.ts` with auth + dry-run + processing loop.
- `vercel.json` cron entry.
- `.env.example` + `scripts/validate-runtime-env.ts` updates.
- 3 cron handler tests.

### Chunk 4 — Documentation + closure (~30-60 min)
- Operating rule in `core.md`.
- Runbook entry.
- Roadmap §16 G14 entry.
- Validator pass.

Total estimated effort: ~5-7 h end-to-end, sequencable as a single session if the architecture handoff is decisive. May split into two sessions if architecture surfaces more design space than expected.

---

## template-session-close
> Filled per session-templates skill before the iteration is declared closed.

### WORK COMPLETED
- (deferred — this spec is the system-analysis output; implementation chunks are tracked by their own commits, each calling back to this spec)

### FINDINGS
- The state machine and the wallet bucket model are decoupled today. The `markPendingPayout` service exists but has no production caller. The `consolidateEarnings` admin function moves wallet but does not touch the state machine. This iteration unifies them.
- Refund-after-consolidation is a real but accepted risk for the pilot. Path G (wallet reversal RPC) closes it; this iteration documents the gap in G14.
- Unassigned-developer-at-payment is a separate concern. The cron skips those rows; retroactive credit is out of scope.

### NEXT STEPS
- After this iteration: Path G (wallet reversal on refund) — ~2-3h, closes the refund-after-consolidation gap captured in G14.
- After that: Path B (B1.3b inbound smoke cross-repo with NoonWeb dev) — gated on coordination.
- Long-term: B1.5 pilot sign-off.
