# spec.md — fase-3-adr-023-b-c-slice-prototype-decision-impl

## Title and metadata

- **Iteration name:** `fase-3-adr-023-b-c-slice-prototype-decision-impl`
- **Date:** 2026-05-25
- **Author:** Pedro (`noondevelop@gmail.com`), with `system-analysis` skill
- **Status:** Draft → **Architecture-firmed 2026-05-25** (pending operator Approval gate before Backend kickoff)
- **Router mode:** **New Build** (per router handoff `docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md` §3 — overrides the spec's original "Backend" framing; Mode + Depth + Chain inherit from router decision unchanged)
- **Depth:** **FULL** (money-domain-adjacent via post-accept Maxwell draft → `lead_proposals` placeholder amount; cross-repo wire contract; schema change that lifts the existing `prototype_workspaces.lead_id UNIQUE` constraint)
- **Active skill chain:** `system-analysis` (this spec) → **`system-architecture` (ADR-025, this turn — firms OQ-1, OQ-4, and bundling)** → `system-backend` (B-slice migration + RPC extension + helper extension; C-slice route + handler + fan-out, bundled per ADR-025 D3) → `system-refactor` (handler-sibling symmetry pass) → `system-testing` (integration-first per ADR-016 precedent) → `system-security` (HMAC surface review + RLS verification for new table) → `system-docs` (`cross-repo-webhook-v1.md` §5 status flip + core.md update + roadmap sync) → `system-validator` → close-out
- **Architecture iteration this depends on:** ADR-023 (Accepted 2026-05-23) — all 9 architectural decisions D1–D9 are immutable inputs. **PLUS ADR-025 (Accepted 2026-05-25) — Architecture firm-ups on OQ-1 (replay-path), OQ-4 (Gate B cap semantics), and B+C bundling. See `## Architecture firm decisions` section below.**

---

## Business objective

Materialize the firmed wire contract `POST /api/integrations/website/prototype-decision` (ADR-023 + `docs/integrations/cross-repo-webhook-v1.md` §5) so that NoonWeb can post client accept/reject decisions back to App, App persists the decision, and on accept fires Option β Maxwell draft creation. Without this iteration the Maxwell-chat lead-creation flow cannot complete end-to-end: NoonWeb's D-slice (`/maxwell/prototipo/[token]`) is blocked on the POST target's existence; the dual-gate regenerate enforcement is non-functional; and Maxwell's draft side-effect on accept has no trigger.

This iteration unblocks NoonWeb dev's parallel D-slice build and closes the App-side persistence + endpoint loop. The render-read endpoint (G22 / ADR-024) and NoonWeb D-slice remain out of scope.

---

## Scope — in

### B-slice (persistence + RPC + helper extension)

- **Migration `0060_phase_23a_prototype_decisions.sql`**:
  - Drop `prototype_workspaces.lead_id` UNIQUE constraint (today: `lead_id uuid not null unique`); replace with a non-unique index `idx_prototype_workspaces_lead_id`. Required because regenerate produces V1/V2/V3 workspaces sharing the same `lead_id`. See R1 below.
  - Add `prototype_workspaces.share_token text` with deferred `unique` constraint applied AFTER backfill (existing rows get token via `gen_random_uuid()::text` backfill within the migration). Final state: `text not null unique`.
  - Add `prototype_workspaces.share_token_superseded_at timestamptz null`.
  - Add `prototype_credit_settings.max_iterations_per_lead integer not null default 3 check (max_iterations_per_lead > 0)`. Backfill via the column default; admin write surfaces remain a future Frontend iteration per ADR-023 §Required follow-up.
  - Create `public.prototype_decisions` table per ADR-023 D4 line 92–118 (id, prototype_workspace_id FK CASCADE, lead_id FK CASCADE, decision CHECK ('accepted','rejected'), notes, client_user_agent, webhook_event_id FK SET NULL, decided_at, created_at + 3 indexes + UNIQUE on `prototype_workspace_id` for one-terminal-decision invariant).
  - Enable RLS on `prototype_decisions` with SELECT scoped to admin/sales_manager (all), sales (own — workspace's lead assigned to or created by them), pm (lead visible to pm). No `authenticated` INSERT/UPDATE/DELETE policies — service_role writes only from the webhook handler. RLS shape mirrors `prototype_workspaces` policy from migration 0020.
  - Extend `website_webhook_events.endpoint` CHECK constraint (migration `0051_phase_20a_*`) to include `'prototype-decision'`.

- **RPC extension `request_lead_prototype(uuid)`**: rewrite the body to:
  - Remove the `PROTOTYPE_WORKSPACE_EXISTS` short-circuit (existing line 305–307 of migration 0020). Multiple workspaces per lead are now legal.
  - Before inserting the new workspace, evaluate Gate B: `select count(*) from prototype_workspaces where lead_id = target_lead_id and status <> 'archived'` (or equivalent — exact predicate to be Architecture-confirmed during Backend execution; the count semantic per ADR-023 D7 is "how many workspaces exist for this lead"). If `count >= max_iterations_per_lead`, raise `P0001 ITERATION_CAP_REACHED`.
  - On regenerate (existing workspace present and not yet decided-accepted), mark the previous workspace row's `share_token_superseded_at = clock_timestamp()` BEFORE inserting the new one. Issue a fresh `share_token` for the new row.
  - Gate A semantics preserved verbatim — credit cost still deducts, still raises `INSUFFICIENT_CREDITS` on shortfall. Both gates evaluate independently; either failure aborts the regenerate.
  - The new workspace row writes a fresh `share_token` (UUID-text via `gen_random_uuid()::text`).
  - Migration `0060_phase_23a_prototype_decisions.sql` ships the RPC `create or replace` body in the same file as the schema changes (single atomic migration per ADR-014 convention).

- **TypeScript helper extension**:
  - `lib/server/website/webhook-events.ts`: extend `WebsiteWebhookEndpoint` union with `'prototype-decision'`.
  - `lib/server/website/webhook-events.ts`: `composeReplayResponseFromLedger` must learn how to replay a `prototype-decision` ledger row (currently it re-queries `website_inbound_links` by `link_id` for the other two endpoints — for prototype-decision the replay payload is reconstructed from `prototype_decisions` joined to `prototype_workspaces` keyed by the ledger row's metadata since `link_id` is NULL per §5.7. Implementation alternative: store a `prototype_decision_id` reference in the ledger row's existing JSONB-ish slot or add a column — Backend chain to decide between (a) extending the ledger schema with `prototype_decision_id` column vs (b) querying by `(endpoint, signature_hash)` join through `webhook_event_id` FK on `prototype_decisions`. See OQ-1 below).

- **`database.types.ts` regen** after migration applies per ADR-014 convention. Manual override block forbidden per recent core-context line 459.

### C-slice (route + handler + side effects)

- **Route file**: `app/api/integrations/website/prototype-decision/route.ts` mirroring the skeleton of `inbound-proposal/route.ts` (HMAC verify → ledger claim → handler → mark processed). Differences: rate-limit namespace `'website-prototype-decision'`, schema `websitePrototypeDecisionPayloadSchema`, handler `receiveWebsitePrototypeDecision`, ledger `endpoint = 'prototype-decision'`.

- **Handler `receiveWebsitePrototypeDecision`** in `lib/server/website-integration.ts` (append to the existing module — same pattern as `receiveWebsiteInboundProposal` + `receiveWebsitePaymentConfirmed`):
  - Zod schema `websitePrototypeDecisionPayloadSchema` per §5.2: `token`, `prototype_workspace_id` (uuid), `decision` (enum), `notes` (optional, nullable, ≤2000 chars trimmed), `client` (optional with `user_agent`), `metadata` (default `{}`), `external_source` (default `noon_website`).
  - Step 1 — resolve `token` → workspace row (select id, lead_id, share_token_superseded_at, status FROM prototype_workspaces WHERE share_token = $1). If null → `404 PROTOTYPE_DECISION_TOKEN_NOT_FOUND`.
  - Step 2 — cross-validate `prototype_workspace_id` matches resolved row id. Mismatch → `409 PROTOTYPE_DECISION_IDENTIFIER_MISMATCH` + structured log (per §5.5).
  - Step 3 — lifecycle checks: if `share_token_superseded_at` non-null → `410 PROTOTYPE_DECISION_TOKEN_EXPIRED`. If FK-cascade left a stale row pointing at a deleted lead (defensive: lead row null on join) → `410 PROTOTYPE_DECISION_LEAD_DELETED`.
  - Step 4 — uniqueness check: `select 1 from prototype_decisions where prototype_workspace_id = $1`. If exists with different decision OR same decision but the ledger row indicates non-bit-identical replay → `409 PROTOTYPE_DECISION_ALREADY_DECIDED`. (Bit-identical replay is handled by `composeReplayResponseFromLedger` before reaching the handler; this Step 4 only fires for conflicting NEW requests.)
  - Step 5 — INSERT `prototype_decisions` row with `decision`, `notes`, `client_user_agent`, `webhook_event_id` (from the ledger event id passed in), `decided_at = now()`. DB failure → `500 PROTOTYPE_DECISION_PERSIST_FAILED`.
  - Step 6 — return wire-shape `{ idempotent: false, decisionId, prototypeWorkspaceId, leadId, decision, decidedAt, draftPropuestaQueued: <bool> }`.
  - Step 7 (only when `decision === 'accepted'`): fire-and-forget Maxwell draft helper.
  - Step 8 (both decisions): fire-and-forget seller notification via `user_notifications` insert (kind TBD — Backend chain to confirm or add new kind during impl; existing kinds inventoried in migration `0055_phase_21c_cron_notification_kinds.sql` per core context).

- **Maxwell draft fire-and-forget helper** (new file `lib/server/maxwell/prototype-decision-draft.ts` or appended to `lib/server/maxwell/lead-engine.ts` — Backend chain decides placement):
  - Input: workspace row + lead row + accepted decision row.
  - Action: call the existing Maxwell drafting path (inventory via grep during Backend; likely a `generateObject` call against `lib/server/maxwell/*`) to produce `{ title, body, project_type, complexity }` for the lead.
  - Insert a `lead_proposals` row with the inferred 4 fields + `amount = <placeholder per ADR-023 D9 / D9 line 201>` (placeholder = `computePricing(projectType, complexity, 'outbound', 0).activationBase` per ADR-013 + ADR-023 D9; the seller's later fee-pick UI recomputes and updates `amount` before submit-to-PM. The existing `proposal-amount-validation.ts` validator at submit-to-PM time enforces the invariant — the draft cannot be sent without seller fee picked). `seller_fees` row is NOT created — preserves ADR-013 invariant.
  - On failure: structured log `prototype.decision.accepted.draft_creation_failed` + escalated `user_notifications` row "accepted but draft pending — create manually from lead detail". No retry.
  - Background execution mechanism: deferred promise post-response, runtime-appropriate (Node `queueMicrotask` or `setImmediate` after the response is written). Specific mechanism chosen by Backend; constraint is the response MUST be sent before the helper runs.

- **Notifications fan-out**:
  - On `decision === 'accepted'` + draft success → notification "Cliente aceptó el prototipo. Maxwell preparó un borrador de propuesta — revisalo y elegí seller fee."
  - On `decision === 'accepted'` + draft failure → notification "Cliente aceptó el prototipo. Generación de borrador falló — creá la propuesta manualmente desde el detalle del lead."
  - On `decision === 'rejected'` → notification "Cliente rechazó el prototipo. Nota: <truncated notes if present>. Podés regenerar V2 si el lead lo amerita."
  - Recipient: `prototype_workspaces.requested_by_profile_id` (the seller). Single recipient per decision row.
  - Insert path: existing repository in `lib/server/notifications/repository.ts` (confirmed exists, file uses `from('user_notifications')`).

### Out of band (operational but explicit)

- **Apply migration via `mcp__supabase__apply_migration` when MCP auth is fresh OR Dashboard SQL Editor + manual ledger insert per ADR-014 convention. Regenerate `database.types.ts` immediately after apply.**
- **Update `docs/api-auth-matrix.md`** with the new endpoint row (entry for HMAC-signed inbound, no role gate, ledger-backed).
- **Update `docs/context/project.context.core.md`** at close-out: convert the existing "future `POST /api/integrations/website/prototype-decision` endpoint" treat-as rule (line 457) from "future" framing into "implemented" framing + add the B-slice schema treat-as rules.
- **Update roadmap §16 G24-adjacent rows** to mark C-slice + B-slice RESOLVED + close-out date.
- **PR title and body** must reference ADR-023, this spec, and the cross-repo doc §5 anchor.

---

## Scope — out

- **G24 (auth helpers consolidation)** — explicitly deferred. The C-slice handler does not touch `requireSession/requirePrincipal/requireRole/requireDashboardAccess` (HMAC-authed webhook). Better absorption opportunity: a future iteration that touches the admin-write path for `prototype_credit_settings.max_iterations_per_lead` (which IS user-authenticated and would naturally call into the helpers).
- **G22 / ADR-024 signed-read endpoint** — separate spec `fase-3-g22-signed-read-spec.md`. Concurrent iteration; orthogonal endpoint.
- **D-slice NoonWeb route `/maxwell/prototipo/[token]`** — different repo (`noon-web-main`), different owner (NoonWeb-dev). Out of scope by definition.
- **Admin UI for `max_iterations_per_lead`** — flagged in ADR-023 §Required follow-up as a future Frontend iteration. The column ships with default 3; admin can override via direct DB until UI lands.
- **Seller fee-pick UI on the Maxwell draft** — flagged in ADR-023 §Required follow-up as a future Frontend iteration. The draft is sendable only after the seller picks the fee; the existing `proposal-amount-validation.ts` validator enforces this at submit-to-PM time.
- **Queue infrastructure for Maxwell draft retry** — flagged in ADR-023 D6 / Re-evaluation triggers as a future scope upgrade (when QStash / Inngest / Postgres job runner lands). Hybrid fire-and-forget is the locked design for this iteration.
- **Render-read endpoint (Pull pattern B.2)** — covered by G22 / ADR-024.
- **Phase 23A Maxwell Niches** — separate initiative (handoff docs `D:\Pedro\Descargas\maxwell-lead-engine-niches.md` + `claude-code-prompt-niches.md`). Different feature, different scope. Note: shares migration prefix `0059_phase_23*` — collision noted under Dependencies; first to land wins the slot.
- **Bilateral cross-repo coordination with NoonWeb-dev** — App ships the endpoint; NoonWeb-side D-slice is bilateral §14 change-control concern outside this iteration.

---

## Acceptance criteria

Each criterion is observable via test, API call, or DB query.

1. **AC-1 — Migration applies cleanly:** `0060_phase_23a_prototype_decisions.sql` applies via `mcp__supabase__apply_migration` (or Dashboard) with no errors; ledger row registered per ADR-014; `database.types.ts` regen produces a clean diff with `prototype_decisions` types, `prototype_workspaces.share_token` / `share_token_superseded_at`, `prototype_credit_settings.max_iterations_per_lead`, and `website_webhook_events.endpoint` enum literal `'prototype-decision'`.
2. **AC-2 — RPC respects both gates:** `request_lead_prototype(uuid)` raises `INSUFFICIENT_CREDITS` (P0001) when wallet short. With sufficient credits AND `count(workspaces) >= max_iterations_per_lead`, raises `ITERATION_CAP_REACHED` (P0001). With both gates passing, inserts a new workspace, supersedes the previous one's token, deducts credits, returns the new workspace id.
3. **AC-3 — Endpoint happy-path accept:** A signed POST with valid token + matching workspace UUID + `decision: 'accepted'` returns HTTP 201, persists a `prototype_decisions` row with the correct fields (including `webhook_event_id` FK populated), enqueues the Maxwell draft helper, sends one `user_notifications` row to the seller, and returns the wire-shape with `draftPropuestaQueued: true`.
4. **AC-4 — Endpoint happy-path reject:** Same as AC-3 but with `decision: 'rejected'`, `notes` populated. Persists the row, does NOT call the Maxwell draft helper, sends one `user_notifications` row with "rejected" copy + truncated notes, returns `draftPropuestaQueued: false`.
5. **AC-5 — Idempotency (bit-identical replay):** A second POST with identical timestamp + body + signature returns HTTP 200 with `idempotent: true`, does NOT insert a second `prototype_decisions` row, does NOT re-enqueue the Maxwell draft, does NOT send a second notification. Ledger `attempt_count` increments.
6. **AC-6 — Error code matrix:** Each of the 7 error codes from §5.5 surfaces with the documented HTTP status: unknown token → 404 `_TOKEN_NOT_FOUND`; mismatched workspace UUID → 409 `_IDENTIFIER_MISMATCH`; superseded token → 410 `_TOKEN_EXPIRED`; deleted lead → 410 `_LEAD_DELETED`; second different decision → 409 `_ALREADY_DECIDED`; bad decision enum → 400 `_INVALID_DECISION`; DB failure simulated → 500 `_PERSIST_FAILED`.
7. **AC-7 — HMAC + rate limit reuse:** Missing/invalid HMAC → 401 `WEBSITE_WEBHOOK_AUTH_FAILED` (existing behavior). >120 req/min from sender → 429 (existing behavior; namespace `website-prototype-decision`).
8. **AC-8 — Maxwell draft persists with placeholder amount:** Post-accept, the inserted `lead_proposals` row carries `title`, `body`, `project_type`, `complexity` populated, no `seller_fees` row, and `amount = computePricing(projectType, complexity, 'outbound', 0).activationBase`. The existing `proposal-amount-validation.ts` validator rejects a submit-to-PM attempt on the draft (proves seller must pick fee first).
9. **AC-9 — Maxwell draft failure path:** When the draft helper is forced to fail (test seam — mock the Maxwell call to throw), the decision row stays, the structured log fires, and the seller notification copy escalates to "draft pending — create manually".
10. **AC-10 — RLS verification:** A direct SELECT on `prototype_decisions` from `authenticated` role returns only rows the role's policy permits (admin/sales_manager: all; sales: own; pm: visible-to-pm); a direct INSERT from `authenticated` is rejected (no policy granted).
11. **AC-11 — Project gates green:** `pnpm lint`, `pnpm typecheck`, full test suite all pass. Existing tests for `inbound-proposal` and `payment-confirmed` continue to pass (no regression in shared helpers).
12. **AC-12 — Cross-repo doc + ADR alignment:** `docs/integrations/cross-repo-webhook-v1.md` §5 is the spec text reference; no contract deviations in implementation. ADR-023 D1–D9 are not violated. Any deviation requires a dated note in the spec PLUS an ADR amendment or supersession.

---

## Affected files and modules

### New files

- `supabase/migrations/0060_phase_23a_prototype_decisions.sql`
- `app/api/integrations/website/prototype-decision/route.ts`
- `lib/server/maxwell/prototype-decision-draft.ts` (likely — Backend chain may instead append to `lib/server/maxwell/lead-engine.ts` if the existing module is the natural home; decision belongs to Backend)
- `tests/integration/website/prototype-decision.spec.ts` (integration-first per recommended testing methodology — see §11)
- `tests/integration/website/prototype-decision-rpc-gates.spec.ts` (or merged into the above — Testing chain decides)

### Modified files

- `lib/server/website-integration.ts` — append `websitePrototypeDecisionPayloadSchema` + `receiveWebsitePrototypeDecision` + the draft helper (if not in a new file).
- `lib/server/website/webhook-events.ts` — extend `WebsiteWebhookEndpoint` union literal; extend `composeReplayResponseFromLedger` to handle the new endpoint (replay payload reconstruction — see OQ-1).
- `lib/server/supabase/database.types.ts` — regen after migration.
- `docs/api-auth-matrix.md` — add row for the new endpoint.
- `docs/context/project.context.core.md` — convert "future endpoint" treat-as line 457 to "implemented" + add 1–2 new treat-as lines for B-slice schema invariants (one-decision-per-workspace, state-driven token invalidation, dual-gate enforcement point).
- `docs/roadmap/...` (operator decides — typically a §16/§17 closure note + status flip to RESOLVED).

### Read-only references (no modification expected)

- `app/api/integrations/website/inbound-proposal/route.ts` (skeleton pattern)
- `app/api/integrations/website/payment-confirmed/route.ts` (skeleton pattern)
- `lib/server/website-webhook-auth.ts` (HMAC verifier — reused)
- `lib/server/api/rate-limit.ts` (rate-limit primitive — reused)
- `lib/server/notifications/repository.ts` (notifications insert path — reused)
- `lib/server/prototypes/*` (existing prototype workspace service/repository/types — may need light extension if exposed types include `share_token` / `share_token_superseded_at`)
- `lib/server/pricing/...` (`computePricing` — reused for placeholder amount per ADR-023 D9)
- `lib/server/leads/proposal-amount-validation.ts` (verifies the validator still rejects draft submit-to-PM)

---

## Dependencies

### Internal

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| ADR-023 (Architecture decisions) | ✅ Accepted 2026-05-23 | Without it, no contract; iteration unscoped | system-architecture (closed) |
| `docs/integrations/cross-repo-webhook-v1.md` §5 | ✅ Published 2026-05-23 | NoonWeb cannot build D-slice without it; impl drifts without anchor | system-architecture (closed) |
| ADR-016 (transport ledger) | ✅ Accepted | Without it, idempotency model is undefined | system-architecture (closed) |
| `website_webhook_events` ledger + helper module | ✅ Live (migration 0051) | Without it, no transport idempotency | Backend (existing) |
| `lib/server/website-webhook-auth.ts` HMAC verifier | ✅ Live | Without it, no inbound auth | Backend (existing) |
| `prototype_workspaces` table | ✅ Live (migration 0020) | Without it, no workspace to attach decisions to | Backend (existing) |
| `prototype_credit_settings` table | ✅ Live (migration 0020) | Without it, no place to extend `max_iterations_per_lead` | Backend (existing) |
| `user_notifications` table + repository | ✅ Live | Without it, no fan-out path | Backend (existing) |
| `computePricing` + `proposal-amount-validation.ts` (ADR-013) | ✅ Live | Without them, Maxwell draft placeholder amount undefined | Backend (existing) |

### External

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| NoonWeb D-slice signed POST to the new endpoint | ⚠️ Not built (D-slice TBD) | Without it, the endpoint is inert post-merge; first real exercise lands when NoonWeb ships | NoonWeb-dev |
| Maxwell LLM endpoint reachability (for draft helper) | ✅ Live (existing Maxwell pipeline) | Without it, draft helper fails → notification escalation path triggers (acceptable fallback per D6) | Operator (env config) |

### Contract

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| Wire shape per §5.2–5.5 of cross-repo doc | ✅ Frozen by ADR-023 | Any deviation breaks NoonWeb integration on first POST | system-architecture (closed) |
| ADR-013 invariant `amount = base + sellerFee` | ✅ Enforced by `proposal-amount-validation.ts` | Draft must persist placeholder; seller fee-pick UI recomputes | Backend (existing) |

### Infra

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| `NOON_WEBSITE_WEBHOOK_SECRET` env var | ✅ Live (shared with the other two inbound) | Without it, HMAC fails on all 3 inbound endpoints | Operator |
| Migration apply path (MCP / Dashboard) | ✅ Live | Without it, schema cannot land | Operator |
| `database.types.ts` regen path (`npx supabase gen types typescript`) | ✅ Live | Without it, TS surface stale | Operator (per ADR-014) |
| Migration prefix slot `0059` | ⚠️ Contended with Phase 23A Maxwell Niches (handoff doc `D:\Pedro\Descargas\maxwell-lead-engine-niches.md` proposes `0059_phase_23a_maxwell_niche_system.sql`) | First to land wins; the other initiative renumbers | Operator (sequencing decision) |

### Data

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| Existing `prototype_workspaces` rows (if any in prod) | ⚠️ Backfill required for `share_token` | Without backfill, `share_token unique not null` constraint fails on apply | This iteration (migration handles it) |
| RLS policy on `prototype_workspaces` (existing) | ✅ Live | Mirrored by new policy on `prototype_decisions` | This iteration (migration writes the new policy) |

---

## Assumptions

1. **A-1 — `lib/server/website-integration.ts` is the canonical home for the handler.** ADR-023 §Required follow-up line 288 names this module or a sibling. Convention in this codebase is to keep symmetric inbound handlers co-located; the spec assumes this module.
2. **A-2 — `composeReplayResponseFromLedger` can be extended to handle the new endpoint.** The function exists and is used by both other inbound entries; extension is mechanical. If the function design forbids this (e.g., hard-coded enum branch with no extension point), Backend will surface a refactor and the spec must update.
3. **A-3 — The Maxwell drafting helper exists in a reusable form.** The existing Maxwell pipeline produces text given prompt + context. Assumed callable from a server-side helper. If the existing API requires UI context not available server-side, the helper falls back to a simpler structured-output call. Backend confirms the shape during impl.
4. **A-4 — `user_notifications` schema supports a kind suitable for prototype-decision events.** Existing kinds inventoried in migration 0055; if no kind fits, the migration adds one (small extension, in-scope).
5. **A-5 — The `lead_id UNIQUE` constraint on `prototype_workspaces` has no callers that rely on the uniqueness invariant beyond the existing RPC.** Grep during Backend will confirm. If callers exist, they must be adjusted in the same iteration.
6. **A-6 — `gen_random_uuid()::text` is a sufficient share-token shape for V1.** Opaque, sufficiently long, unguessable. ADR-023 D2 calls it "App-issued opaque" without specifying entropy; UUID-v4 meets the bar. Future hardening (rotating signing key, prefix, etc.) is a re-evaluation trigger, not this iteration.
7. **A-7 — Migration prefix `0059` is available** (i.e., this iteration lands before the Phase 23A Maxwell Niches migration). If Maxwell Niches lands first, this iteration renumbers to `0060_phase_23a_prototype_decisions.sql` — change is mechanical, doesn't affect the spec.
8. **A-8 — No existing production data in `prototype_workspaces` will be broken by the constraint change.** The `lead_id` UNIQUE drop is additive (allows more rows); existing rows remain valid. The `share_token` backfill via UUID is safe (no real share token to preserve).

---

## Open questions

> **Status note (2026-05-25):** OQ-1 and OQ-4 are **RESOLVED** by ADR-025 (Architecture firm-ups). OQ-2 and OQ-3 remain open for Backend resolution during implementation (operational, not architectural).

- **OQ-1 — Where does the replay-response reconstruction for prototype-decision live?** → **RESOLVED by ADR-025 D1: option (b), FK-join via `prototype_decisions.webhook_event_id`.** The ledger schema stays generic per ADR-016 D9. The B-slice migration MUST add a partial index `idx_prototype_decisions_webhook_event_id` on `(webhook_event_id) where webhook_event_id is not null`. The C-slice handler implements the replay path via a sibling helper `composePrototypeDecisionReplayResponseFromLedger` (Architecture preference) or by extending `composeReplayResponseFromLedger` with an endpoint discriminator branch (also acceptable). The `WebsiteWebhookEventRecord` shape MUST be extended to include `endpoint: WebsiteWebhookEndpoint`. Replay wire-shape: `{ idempotent: true, decisionId, prototypeWorkspaceId, leadId, decision, decidedAt, draftPropuestaQueued: false }` — `draftPropuestaQueued` is **always `false` on replay** per ADR-023 D6 (the Maxwell draft side-effect runs only on the original successful run). See `## Architecture firm decisions` below for full constraints.
- **OQ-2 — Background execution mechanism for fire-and-forget.** Open.
  - Options: `queueMicrotask`, `setImmediate`, or detached promise `void Promise.resolve().then(...)`. All run after the response is sent on Node's serverless model.
  - **Recommended:** detached promise with explicit `.catch()` for the log line. Safe across Node 20 / 22 / Vercel runtime.
  - Architecture deferral: operational choice; Backend resolves during implementation within the explicit constraint "response sent before helper runs" (ADR-023 D6).
- **OQ-3 — `user_notifications.kind` value.** Open.
  - **Drift verification (2026-05-25 by Architecture):** the current `user_notifications.source_kind` CHECK constraint (migration `0055_phase_21c_cron_notification_kinds.sql`) accepts only `{'lead_activity', 'task_activity', 'project_activity', 'proposal_review', 'project_sla_breach', 'webhook_failure'}` — no prototype-decision-aligned kind exists today.
  - **Options:** (a) reuse `'lead_activity'` (the closest existing kind; semantic stretch — the source is a webhook decision, not a lead activity per se); (b) add a new kind `'prototype_decision_received'` to the CHECK constraint in the B-slice migration (cleanest semantic; tiny additive migration cost). **Recommended:** option (b). Architecture deferral: operational choice within Backend authority; either option preserves the contract.
- **OQ-4 — Cap evaluation predicate.** → **RESOLVED by ADR-025 D2: lifetime cap, count INCLUDES `archived` workspaces.** Exact predicate B-slice ships: `select count(*) from public.prototype_workspaces where lead_id = target_lead_id` (no status filter). Archive does NOT reduce the count. Admin-driven cap raise on `prototype_credit_settings.max_iterations_per_lead` is the controlled escape hatch for legitimate "needs a fresh start" leads; per-lead override is **out of scope** for this iteration. See `## Architecture firm decisions` below for full rationale.

---

## Risks

| ID | Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| **R1** | Lifting `prototype_workspaces.lead_id UNIQUE` breaks an unidentified caller (e.g., a `select ... where lead_id = ? limit 1` that assumed singleton) | Medium | High (silent data shape change post-merge) | **High** | Grep all references to `prototype_workspaces` during Backend; identify single-row assumptions (e.g., `.single()` calls without `order by created_at desc limit 1`); refactor to "latest workspace" semantics. Add a smoke test on the existing `/api/leads/[leadId]/prototype/route.ts` flow before merging. |
| **R2** | `composeReplayResponseFromLedger` extension introduces a subtle replay bug (returns stale data because the reconstruction query reads committed-but-stale state) | Low | High (idempotency contract violation = NoonWeb sees inconsistent retries) | **Medium** | Integration test that exercises the replay path explicitly: POST decision, capture response, POST identical signed body, assert wire-identical response. Per ADR-016 D6 the response shape must be byte-equal across original + replay. |
| **R3** | Maxwell draft helper produces a placeholder `amount` that drifts from the ADR-013 invariant the `proposal-amount-validation.ts` validator expects (e.g., picks `activationFinal` instead of `activationBase`, ships to production, seller cannot submit) | Medium | Medium (visible to operator, requires patch + redeploy) | **Medium** | Unit test on the helper: input `(projectType, complexity)` → assert output `amount === computePricing(projectType, complexity, 'outbound', 0).activationBase`. Integration test that asserts the validator REJECTS the draft until the seller fee row is created. |
| **R4** | Fire-and-forget detached promise crashes the Node process under a serverless worker that recycles aggressively | Low | Medium (operator confusion, possible draft silently dropped) | **Low** | Wrap in `.catch(error => logger.error('prototype.decision.accepted.draft_creation_failed', {...}))`. The notification fan-out runs synchronously BEFORE the fire-and-forget so the seller is always told; even a process recycle leaves the seller informed. |
| **R5** | RLS policy on `prototype_decisions` accidentally exposes cross-tenant data (e.g., the sales policy admits more rows than intended) | Low | High (data leak across sellers) | **Medium** | Mirror the `prototype_workspaces` policy verbatim, then explicit RLS verification test (AC-10) that signs in as a sales user and SELECTs — assert zero rows for decisions tied to leads not visible to that user. |
| **R6** | Migration prefix collision with Phase 23A Maxwell Niches (`0059_phase_23a_*`) is resolved silently in the wrong direction (Maxwell Niches ships `0059`, this iteration ships `0060`, but a stale local branch holds the original `0060_phase_23a_prototype_decisions.sql` and confuses operators) | Medium | Low (recoverable by renumbering) | **Low** | Operator decides sequencing explicitly (this iteration first per the bundle decision); if Maxwell Niches lands first, this iteration renumbers in a single sed across the migration file + the spec + the PR description. No production data risk because neither migration has shipped yet. |
| **R7** | NoonWeb-side D-slice payload diverges from the firmed §5.2 contract on first integration test (e.g., NoonWeb sends `clientUserAgent` camelCase instead of `client.user_agent` nested) | Medium | Medium (integration cycle slowdown, but caught early by HTTP 400 validation) | **Medium** | The Zod schema rejects deviations with `400 (validation)`; structured logs show the exact payload shape. Operator forwards the failing payload to NoonWeb-dev for fix. No App-side change required (contract is firmed). |
| **R8** | Drop of `lead_id UNIQUE` requires a transaction-safe constraint drop on a non-empty table (existing rows respect uniqueness; the drop is purely a permission relaxation — but Postgres semantics around DROP CONSTRAINT on referenced tables can surface lock issues) | Low | Medium (migration apply blocks behind lock; rare in dev, possible in prod under traffic) | **Low** | Run the migration during a low-traffic window OR wrap in `lock_timeout` guard + retry. The constraint drop is metadata-only; no rewrite. Acceptable risk. |
| **R9** | Test infrastructure for HMAC-signed inbound integration tests doesn't exist or is brittle | Low | Medium (testing chain stuck) | **Low** | Existing tests for `inbound-proposal` and `payment-confirmed` provide the harness; mirror their setup. If brittleness surfaces, that's a Testing-chain finding, not a blocker for this spec. |
| **R10** | The "lifetime cap" interpretation of Gate B (OQ-4) is wrong and the operator actually wants "currently-active cap" — leading to a Gate B behavior change post-launch | Low | Medium (semantic surprise, requires a follow-up patch) | **Low** | OQ-4 documents the assumption + recommendation. If operator disagrees during PR review, the change is a one-line predicate in the RPC. |

---

## Recommended testing methodology

**Integration-first**, per ADR-016 precedent. Justification: this iteration's correctness criterion is **wire-contract observable behavior** (HTTP request/response shape, ledger state, DB persistence, error codes) — exactly what integration tests verify directly. Unit tests are appropriate for the Maxwell draft helper's pricing calculation (R3 mitigation) but secondary to the integration suite. TDD would be over-rotation given the contract is firmed externally; CDD / BDD adds ceremony without value. Existing tests for `inbound-proposal` and `payment-confirmed` define the harness pattern; this iteration extends it.

Concrete test plan summary (Testing chain will expand):
- Happy-path accept + reject (AC-3, AC-4).
- Idempotency / bit-identical replay (AC-5).
- Error matrix (AC-6) — 7 explicit error cases.
- Auth + rate-limit reuse (AC-7).
- Maxwell draft persistence shape (AC-8) + failure path (AC-9).
- RLS verification (AC-10).
- RPC gate evaluation (AC-2) — credit short, cap reached, both pass, regenerate token rotation.

---

## Definition of Done

- [ ] Migration `0060_phase_23a_prototype_decisions.sql` applied to remote + ledger row registered per ADR-014.
- [ ] `database.types.ts` regenerated cleanly; no manual override blocks.
- [ ] Route file + handler + draft helper + notifications fan-out shipped.
- [ ] All 12 acceptance criteria green.
- [ ] `pnpm lint`, `pnpm typecheck`, full test suite green.
- [ ] `docs/api-auth-matrix.md` updated with the new endpoint row.
- [ ] `docs/context/project.context.core.md` updated — "future endpoint" line 457 transitioned to "implemented" + new schema treat-as lines added.
- [ ] Roadmap §16 row for the C-slice marked `RESOLVED YYYY-MM-DD <PR#>`; B-slice row added + marked RESOLVED in the same.
- [ ] PR opened, ADR-023 + this spec referenced in description.
- [ ] system-validator returns COMPLETE.

---

## Chunking decision

**Single iteration** — bundle B-slice + C-slice. **Confirmed by Architecture per ADR-025 D3 (overrides the router handoff's 4-chunk split).** Reasoning:

1. **Soft dependency makes splitting wasteful.** Per ADR-023 line 273 "C-slice has a soft dependency on B-slice (the handler needs the table to exist)". Splitting would either (a) ship B-slice alone with no consumer and no end-to-end validation, or (b) ship C-slice against a migration not yet applied (failing tests). Both worse than bundled.
2. **Both slices are individually small.** B-slice = 1 migration + 1 RPC + 1 helper extension. C-slice = 1 route + 1 handler + 1 helper. Combined: ~7-8 files of net change. Single PR is healthy.
3. **The wire contract is the natural validation unit.** Sending a signed POST and observing the persisted decision exercises both slices simultaneously. Splitting forces synthetic harness work to validate B-slice alone.
4. **Maxwell-draft destabilization risk is bounded by ADR-023 D6's fire-and-forget pattern.** The router's conservatism (handoff §3.1 trigger 2) assumed Maxwell-draft was a likely destabilizer; the spec's R3 + R4 analysis shows the side-effect's failure mode is already "decision recorded, notification escalates seller, manual draft via UI" — non-destabilizing by construction. The router's split was over-conservative for the current risk picture; ADR-025 D3 records the calibration.

**R1 grep-pass safety valve.** If during Backend the bundle proves too large (specifically if R1 — the `lead_id UNIQUE` drop — surfaces >2-3 callers needing semantic refactor beyond "use latest workspace"), the spec MAY be re-cut as B-slice-only iteration + a C-slice follow-up. This is the explicit fallback per ADR-025 D3 §"Required follow-up work" + the SCOPE DISCIPLINE rule. Backend's first step is the grep pass; the decision to bundle vs re-cut is made at that gate.

---

## Success criterion

**A signed POST from NoonWeb to `/api/integrations/website/prototype-decision` with a valid token, matching workspace UUID, and `decision: 'accepted'` produces a persisted `prototype_decisions` row, a Maxwell-drafted `lead_proposals` row with placeholder amount, a seller `user_notifications` row, and an HTTP 201 wire-shape response — bit-identical replay returns the same wire-shape with HTTP 200 and `idempotent: true`, doing nothing else.**

That sentence, observable end-to-end against a real Supabase + real HMAC + real Maxwell draft (or its tested fallback), is the iteration's definition of complete.

---

## Lifecycle

- **Status:** Draft → **Architecture-firmed 2026-05-25** (OQ-1 + OQ-4 resolved; bundling confirmed; Backend may proceed pending operator Approval gate)
- **Definition of Ready check:** acceptance criteria testable ✅; scope bounded ✅; methodology decided ✅; dependencies classified ✅; risks rated ✅; architectural decisions firmed (ADR-025) ✅. → Spec is **ready for Approval gate**. Operator marks Approved before Backend begins.
- **Supersedes:** nothing.
- **Superseded by:** nothing.
- **Amended by:** ADR-025 (2026-05-25) — adds `## Architecture firm decisions` section; resolves OQ-1 and OQ-4; confirms bundling.
- **Related specs:**
  - `specs/fase-3-prototipo-decision-cross-repo-contract.md` (the contract-firming Architecture iteration that produced ADR-023; this spec is its implementation follow-up).
  - `specs/fase-3-g22-signed-read-spec.md` (parallel signed-read spec; orthogonal endpoint; produced ADR-024 — uses the same `share_token` + `share_token_superseded_at` columns this iteration's B-slice introduces; no collision).
- **Related ADRs:**
  - ADR-023 (D1-D9 immutable inputs).
  - ADR-024 (orthogonal sibling — render-read endpoint; shares the `share_token` columns).
  - ADR-025 (firm-ups produced in the Architecture pass on this spec — see `## Architecture firm decisions` below).
- **Related handoffs:**
  - `docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md` (router decision; Mode + Depth + Chain inherit; the 4-chunk split is overridden by ADR-025 D3).

---

## Architecture firm decisions (added by system-architecture 2026-05-25)

This section records the three Architecture decisions made on top of the parallel-authored spec body. The full rationale lives in `docs/adrs/ADR-025-prototype-decision-impl-architecture-firmups.md`. This section is the spec-local summary that Backend reads as the immutable input.

### A1 — Replay-response reconstruction (resolves OQ-1)

**Decision:** option (b) — FK-join `prototype_decisions.webhook_event_id → website_webhook_events.id`. `website_webhook_events` schema is NOT extended with a `prototype_decision_id` column. Per ADR-025 D1.

**Backend constraints:**

- B-slice migration MUST add this partial index (in addition to the three ADR-023 D4-declared indexes):
  ```sql
  create index idx_prototype_decisions_webhook_event_id
    on public.prototype_decisions(webhook_event_id)
    where webhook_event_id is not null;
  ```
- The replay path for `endpoint = 'prototype-decision'` joins `prototype_decisions` filtered by `webhook_event_id = ledger.eventId` to reconstruct the wire-shape. Two acceptable implementation shapes (Architecture preference is b.2):
  - **(b.1)** Extend `composeReplayResponseFromLedger` with a `switch (claim.endpoint)` branch (modifies existing function).
  - **(b.2)** Sibling helper `composePrototypeDecisionReplayResponseFromLedger` with the same signature shape (preserves existing function unchanged; smaller blast radius).
- The `WebsiteWebhookEventRecord` shape in `lib/server/website/webhook-events.ts` MUST be extended to include `endpoint: WebsiteWebhookEndpoint`. The `recordWebsiteWebhookEvent` SELECT projection MUST include `endpoint` to populate it. Existing inbound-proposal / payment-confirmed call sites continue to ignore the field; the new prototype-decision call site uses it for the discriminator branch.
- Replay wire-shape for `prototype-decision`: `{ idempotent: true, decisionId, prototypeWorkspaceId, leadId, decision, decidedAt, draftPropuestaQueued: false }`. The `draftPropuestaQueued` field is **always `false` on replay** — the Maxwell draft side-effect runs only on the original successful run per ADR-023 D6.
- If `webhook_event_id` is NULL on the matched `prototype_decisions` row (defensive — the FK is `on delete set null`, so a ledger row purge could orphan the link), the replay reconstruction MUST fall back to "re-run business logic" semantics per ADR-016 D6's failed-then-retry branch. Practically: surface `shouldProcess: true` from the helper and let the handler re-invoke its Step 1-5 idempotency-aware logic.

### A2 — Gate B cap semantics (resolves OQ-4)

**Decision:** lifetime cap. The count INCLUDES `archived` workspaces. Per ADR-025 D2.

**Backend constraints:**

- B-slice migration's `request_lead_prototype(uuid)` rewrite MUST use this exact Gate B predicate (no status filter):
  ```sql
  declare
    workspace_count integer;
    max_iterations integer;
  begin
    select coalesce(settings.max_iterations_per_lead, 3)
      into max_iterations
      from public.prototype_credit_settings settings
     where settings.singleton_key = true;

    select count(*)
      into workspace_count
      from public.prototype_workspaces
     where lead_id = target_lead_id;

    if workspace_count >= max_iterations then
      raise exception using errcode = 'P0001', message = 'ITERATION_CAP_REACHED';
    end if;
  end;
  ```
- Backend MUST NOT add `where status <> 'archived'` or any equivalent status filter to this predicate.
- Gate B evaluation order: per ADR-023 D7 line 177, both gates evaluate independently. Architecture firms the **sequencing**: evaluate **Gate B (cap) FIRST**, then Gate A (credits). Rationale: cap is a hard product-level limit; surfacing `ITERATION_CAP_REACHED` before the seller's wallet is touched avoids the "you spent credits on a request that was about to be capped" UX. Both gates surface distinct `P0001` messages so the seller's UX can branch appropriately (top-up credits vs escalate manually).
- The escape hatch for legitimate "needs a fresh start" leads is admin-driven raise of `prototype_credit_settings.max_iterations_per_lead` (singleton row, global). Per-lead override is **out of scope** for this iteration.

### A3 — Bundling decision (resolves the spec-vs-router divergence)

**Decision:** bundle B-slice + C-slice in a single iteration. Single migration `0060_phase_23a_prototype_decisions.sql`. Single PR. Per ADR-025 D3.

**Backend constraints:**

- **R1 grep pass is the first Backend step.** Before any code change, Backend greps for `prototype_workspaces` callers, especially `.single()` calls on `lead_id` lookups. Search patterns to cover: `from('prototype_workspaces')`, `prototype_workspaces`, `prototype_workspace` (singular references). Expected surface: `request_lead_prototype` RPC + workspace status update paths + the lead detail UI's prototype panel. If the grep surfaces >2-3 callers needing semantic refactor beyond "use latest workspace" (typical refactor: `.eq('lead_id', leadId).single()` → `.eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).single()` or equivalent "latest workspace" pattern), Backend pauses and proposes re-cut to ADR-025 D3 alternative (c) — B-slice solo + C-slice follow-up. Architecture amends ADR-025 with a closure note documenting the re-cut.
- **Migration is single-file (not split).** `0060_phase_23a_prototype_decisions.sql` carries all six elements per ADR-025 D3:
  1. Drop `prototype_workspaces.lead_id UNIQUE` constraint; replace with non-unique index `idx_prototype_workspaces_lead_id` (per spec §B-slice).
  2. Add `share_token text` + backfill via `gen_random_uuid()::text` + final state `not null unique`; add `share_token_superseded_at timestamptz null`.
  3. Add `prototype_credit_settings.max_iterations_per_lead integer not null default 3 check (max_iterations_per_lead > 0)`.
  4. Create `public.prototype_decisions` table + 3 indexes per ADR-023 D4 + the new `idx_prototype_decisions_webhook_event_id` partial index per A1 above + RLS policies.
  5. Extend `website_webhook_events.endpoint` CHECK to include `'prototype-decision'`.
  6. `create or replace function public.request_lead_prototype(uuid)` with the dual-gate body per A2 + regenerate semantics (mark prior workspace's `share_token_superseded_at = clock_timestamp()` before insert; issue fresh `share_token` on new row).
- **PR is single (not chained).** One PR with: migration + route + handler + helper extensions + Maxwell draft + notifications fan-out.
- **`user_notifications.source_kind` CHECK constraint** (drift verified by Architecture 2026-05-25): current accepted values are `{'lead_activity', 'task_activity', 'project_activity', 'proposal_review', 'project_sla_breach', 'webhook_failure'}`. If Backend resolves OQ-3 in favor of adding `'prototype_decision_received'`, the same `0059` migration extends the CHECK constraint with the same DROP-and-ADD pattern used by migration 0055. If Backend reuses `'lead_activity'`, no CHECK change required. Architecture defers to Backend judgment.

### Drift verifications performed during this Architecture pass (2026-05-25)

| Spec assumption | Verification result |
|---|---|
| `prototype_workspaces.lead_id UNIQUE` exists | **CONFIRMED.** Migration `0020_phase_2o_wallet_prototype_credits_foundation.sql` line 56: `lead_id uuid not null unique references public.leads(id) on delete cascade`. Drop is required as spec states. |
| `website_webhook_events.endpoint` CHECK includes only `'inbound-proposal'` and `'payment-confirmed'` | **CONFIRMED.** Migration `0051_phase_20a_website_webhook_event_ledger.sql` line 7: `check (endpoint in ('inbound-proposal','payment-confirmed'))`. Extension to `'prototype-decision'` required as spec states. |
| `composeReplayResponseFromLedger` exists with the shape the spec describes | **CONFIRMED with one nuance.** Function exists in `lib/server/website/webhook-events.ts` (lines 197-225). It currently joins `website_inbound_links` by `link_id` and returns `{ idempotent: true, linkId, leadId, proposalId, [projectId], status }`. For `prototype-decision` the `link_id` column will be NULL by design (the new endpoint does not produce `website_inbound_links` rows). ADR-025 D1 firms the replay path via the new FK-join route. |
| `computePricing(projectType, complexity, 'outbound', 0).activationBase` returns the right placeholder value | **CONFIRMED.** Function exists in `lib/maxwell/pricing.ts` lines 58-71 with signature `(projectType, complexity, channel, feeAmount)` and `PricingResult.activationBase` is the matrix value. Spec's placeholder choice is correct. |
| `user_notifications.source_kind` CHECK has a suitable kind | **PARTIAL.** Current accepted values per migration 0055: `{'lead_activity', 'task_activity', 'project_activity', 'proposal_review', 'project_sla_breach', 'webhook_failure'}`. No prototype-aligned kind. Backend resolves OQ-3 by either reusing `'lead_activity'` (semantic stretch) or adding `'prototype_decision_received'` in the B-slice migration (cleanest). |
| `prototype_credit_settings.max_iterations_per_lead` does not exist yet | **CONFIRMED.** Migration 0020 lines 28-34 declares only `request_cost`. B-slice adds the new column. |
| ADR-024's `share_token` / `share_token_superseded_at` columns collide with this iteration's B-slice additions | **NO COLLISION.** Both ADRs share the same columns by design (ADR-024 D1 declares dependency on B-slice's column adds per its "Implementation pointers" table line 521). Whichever iteration ships first creates the columns; the other consumes them. Since this iteration is the B-slice owner of these columns, **this iteration creates them** and ADR-024's handler iteration (future) consumes them. |

No drift findings invalidate the spec body. All assumptions A-1 through A-8 hold.

### Forbidden by Architecture firm decisions

- **No `website_webhook_events.prototype_decision_id` column.** Per A1 / ADR-025 D1.
- **No status filter in Gate B predicate.** Per A2 / ADR-025 D2. Backend MUST NOT write `where status <> 'archived'`.
- **No `draftPropuestaQueued: true` on replay.** Per A1 / ADR-025 D1.
- **No mid-state feature-flag fence between B and C.** Per A3 / ADR-025 D3. Both ship together or both split (re-cut to alternative (c)).
- **No per-lead Gate B override in this iteration.** Per A2 / ADR-025 D2. Admin-driven global cap raise is the only escape hatch.

### Allowed by Architecture firm decisions (already in spec body)

- All shortcut decisions in the spec body remain in force (fire-and-forget Maxwell draft, no payload-level idempotency scheme, no queue infrastructure, RLS policy mirroring `prototype_workspaces` policy verbatim, ledger schema generic per ADR-016 D9).
- OQ-2 (background execution mechanism) and OQ-3 (`user_notifications.kind`) remain Backend's choice within explicit constraints.
