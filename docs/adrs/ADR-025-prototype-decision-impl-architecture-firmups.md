# ADR-025: Prototype-decision impl architecture firm-ups — ledger replay path, Gate B cap semantics, B+C bundling

**Status:** Accepted
**Date:** 2026-05-25
**Deciders:** Pedro (Engineering owner), system-architecture
**Supersedes:** None
**Amends:** ADR-016 (one narrow extension of `composeReplayResponseFromLedger` precedent — see D1)
**Related:**
- ADR-016 (transport-level webhook ledger pattern — D9 keeps ledger generic; this ADR honors that by routing the new endpoint's replay lookup through `prototype_decisions.webhook_event_id` rather than extending ledger columns).
- ADR-023 (prototype-decision cross-repo wire contract — D4 declares the `prototype_decisions` shape; D7 declares Gate B "count the number of `prototype_workspaces` rows for the lead" — this ADR firms the predicate).
- ADR-024 (prototype signed-read cross-repo wire contract — orthogonal; uses the same `share_token` / `share_token_superseded_at` columns this ADR's B-slice introduces, no collision).
- ADR-014 (migration ledger reconciliation — applies to the B-slice migration).
- `specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md` (the implementation spec this ADR firms up — Architecture amendments appended in §Architecture firm decisions).
- `docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md` (the router decision this ADR partially overrides on bundling; see D3 reasoning).
- Project memory `project_maxwell_chat_lead_creation_flow.md` (Gate B "iteration cap per lead, default 3" — D2 firms the count predicate).

---

## Context

A parallel `system-analysis` pass produced `specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md` (Draft 2026-05-25). The spec is technically high-quality (12 testable AC, 10 risks rated, 8 assumptions, ADR-023 D1-D9 compliance verified) but it left two architectural decisions disguised as "Open Questions" and bundled B+C in a single iteration where the prior router decision (`docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md`) had directed a 4-chunk split for the C-slice alone.

This ADR resolves the three architectural decisions that Backend cannot safely guess at:

- **Q-impl-1** (the spec's OQ-1) — Where does the replay-response reconstruction for `prototype-decision` live: extend `website_webhook_events` with a `prototype_decision_id` column (option a), or keep the ledger generic and join `prototype_decisions` via `webhook_event_id` FK (option b)?
- **Q-impl-2** (the spec's OQ-4) — Gate B count semantics: does `archived` workspace status count toward `max_iterations_per_lead` (lifetime cap), or are only non-archived workspaces counted (currently-active cap)?
- **Q-impl-3** (router-vs-spec divergence) — Bundle B-slice + C-slice in a single iteration (spec proposal) or split per the router's 4-chunk decision?

The spec's other two Open Questions (OQ-2 background execution mechanism, OQ-3 `user_notifications.kind` value) are operational, not architectural, and stay open for Backend to resolve during implementation. This ADR does not pre-empt those.

Five operator and architectural inputs frame this ADR as immutable:

- **From project memory `project_maxwell_chat_lead_creation_flow.md`:** Gate B is an "iteration cap per lead, default 3 = V1, V2, V3"; "Gate A bounds total token/$ burn per seller; Gate B bounds the dead-loop case where a single lead consumes infinite iterations of a fundamentally rejected concept."
- **From ADR-023 D7:** "count the number of `prototype_workspaces` rows for the lead (or equivalently the count of distinct `prototype_decisions` plus the active workspace)".
- **From ADR-023 D4:** `prototype_decisions.webhook_event_id` is a soft-FK `references public.website_webhook_events(id) on delete set null` — present by design, ready to serve a replay-path join.
- **From ADR-016 D9:** the helper module is intentionally narrower than the Stripe helper; one `recordWebsiteWebhookEvent` + one `composeReplayResponseFromLedger` cover both inbound POST endpoints. The ledger schema is deliberately kept generic and the helper's replay path can be extended.
- **From the router handoff:** the C-slice-only decision was made under uncertainty about whether B-slice would land first; the router explicitly noted "Backend C2 cannot start before C1's migration is applied" — making B-slice a hard prerequisite for any C-slice work.

---

## Decision

### D1 — Q-impl-1 resolved: Option (b), FK-join via `prototype_decisions.webhook_event_id`; ledger schema stays generic

**Selected: option (b).** The replay-response reconstruction for `prototype-decision` is implemented by **joining `prototype_decisions` to the ledger row via the existing `webhook_event_id` soft-FK** declared in ADR-023 D4. The `website_webhook_events` schema is **not extended** with a `prototype_decision_id` column.

#### Options considered

| Option | Description | Pros | Cons |
|---|---|---|---|
| (a) Extend ledger schema | Add `website_webhook_events.prototype_decision_id uuid null` column; `composeReplayResponseFromLedger` reads it on replay. | Direct lookup (single row read); endpoint-local schema visibility. | Pollutes the ledger with endpoint-specific columns. Sets a precedent that every future endpoint adds its own column (next inbound integration would add `_calendly_event_id`, `_oauth_grant_id`, etc.) — the ledger schema would diverge into N endpoint-specific shapes, defeating ADR-016 D9's "ledger schema kept generic". Requires a non-trivial migration (ALTER TABLE on a live, growing ledger). |
| (b) FK-join via `prototype_decisions.webhook_event_id` | Keep ledger schema unchanged; in the replay path, query `prototype_decisions` filtered by `webhook_event_id = ledger.eventId`. The FK is already declared by ADR-023 D4 (no migration cost for the join key). | Honors ADR-016 D9 — ledger stays generic across all endpoints. Zero schema-level change beyond what B-slice already does (the new `prototype_decisions` table). One extra query per replay event (low-frequency code path; replays are <10% of inbound by transport observation). Join cost negligible because `webhook_event_id` is a UUID FK column (B-slice MUST index it; see implementation constraint below). | Two-step lookup in code: read ledger row → join `prototype_decisions`. Marginally more code than option (a). |

#### Rationale for (b)

1. **ADR-016 D9 invariant preserved.** The ledger column set is documented per-column for `inbound-proposal` and `payment-confirmed`. Extending it with endpoint-specific FKs sets a precedent for endpoint-specific schema sprawl. Future inbound integrations (Calendly hypothetical, OAuth callback hypothetical) would each demand their own column under option (a). Option (b) generalizes: each new endpoint's domain table soft-FKs to `website_webhook_events.id`, and the replay path joins through that FK. The pattern is uniform.
2. **The FK already exists.** ADR-023 D4 line 102-103 declares `webhook_event_id uuid references public.website_webhook_events(id) on delete set null` on `prototype_decisions`. The join key is **free** — B-slice was going to write that column anyway for forensic linkage; under (b) it doubles as the replay-path key.
3. **Migration cost asymmetry.** Option (a) requires ALTER TABLE on `website_webhook_events` (live table, growing). Option (b) requires nothing beyond what B-slice already does. The ALTER is reversible but adds an extra ledger migration to the chain — wasteful when (b) already covers the case.
4. **Performance is a non-concern at pilot scale.** Replays are <10% of inbound transport traffic by ADR-016's own observation (Stripe ledger ~0% replays in 3 weeks; NoonWeb v1 inbound ledger similar). Even at 10× pilot scale, replay frequency on the new endpoint is bounded by NoonWeb's retry behavior on 5xx — well under 1 req/min per workspace. One extra indexed-uuid lookup per replay is invisible.

#### Implementation constraints carried to B-slice and C-slice

- **B-slice migration MUST index `prototype_decisions.webhook_event_id`.** ADR-023 D4's index declaration list (lines 108-117) covers `prototype_workspace_id`, `lead_id`, `decided_at`. The migration extends that with:
  ```sql
  create index idx_prototype_decisions_webhook_event_id
    on public.prototype_decisions(webhook_event_id)
    where webhook_event_id is not null;
  ```
  Partial index because `webhook_event_id` is nullable (FK `on delete set null` per ADR-023 D4 line 102-103). The partial form keeps the index tight when the ledger row is deleted (which itself is rare).

- **C-slice handler MUST extend `composeReplayResponseFromLedger` (or write a sibling) to handle `endpoint='prototype-decision'`.** Two acceptable implementation shapes — Backend chooses:
  - **(b.1)** Extend `composeReplayResponseFromLedger` with a `switch (claim.endpoint)` branch, OR
  - **(b.2)** Introduce a sibling `composePrototypeDecisionReplayResponseFromLedger` with the same signature shape. Existing function stays untouched.
  Both are acceptable; (b.2) leaves the existing function's behavior unchanged for inbound-proposal/payment-confirmed (smaller blast radius). Architecture's preference is (b.2), but does not block on the choice.

- **Helper module `lib/server/website/webhook-events.ts` ALREADY HAS `WebsiteWebhookEventRecord` without `endpoint`** (verified by reading the file). The replay-path helper for `prototype-decision` needs the `endpoint` field to discriminate. **The `WebsiteWebhookEventRecord` shape MUST be extended to include `endpoint: WebsiteWebhookEndpoint`** (small additive change; the union already includes `'prototype-decision'` after the spec's helper extension).

- **Replay response shape for `prototype-decision`** mirrors the wire-contract shape declared in spec §C-slice Step 6: `{ idempotent: true, decisionId, prototypeWorkspaceId, leadId, decision, decidedAt, draftPropuestaQueued: false }` (the `draftPropuestaQueued` field is **always `false` on replay** — replays do not re-trigger the Maxwell draft side-effect per ADR-023 D6 "fire-and-forget runs only on the original successful run"; replays return the recorded state without re-invoking side-effects).

#### Soft amendment to ADR-016

The ADR-016 `composeReplayResponseFromLedger` helper was originally written assuming all inbound endpoints reconstruct their replay shape from `website_inbound_links` by `link_id`. The `prototype-decision` endpoint reconstructs from `prototype_decisions` by `webhook_event_id`. This is a narrow extension of the precedent, not a violation: ADR-016 D6 says "re-query and return the full wire shape" — the source table of the re-query is endpoint-specific by design. This ADR records the extension explicitly so future readers do not assume `website_inbound_links` is universal.

### D2 — Q-impl-2 resolved: Lifetime cap (count INCLUDES `archived` workspaces)

**Selected: lifetime cap.** Gate B's `request_lead_prototype(uuid)` RPC predicate counts **all** non-deleted `prototype_workspaces` rows for the target lead, regardless of `status`. Archived workspaces count.

Exact predicate B-slice ships:

```sql
select count(*) into workspace_count
from public.prototype_workspaces
where lead_id = target_lead_id;
-- (no status filter; the row's existence is the signal)

if workspace_count >= max_iterations_per_lead_value then
  raise exception using errcode = 'P0001', message = 'ITERATION_CAP_REACHED';
end if;
```

#### Options considered

| Option | Description | Pros | Cons |
|---|---|---|---|
| (a) Lifetime cap — count includes `archived` | Every workspace ever created against the lead counts; archiving does not reduce the count. | Aligns with the operator-locked semantics from project memory: "Gate B bounds the dead-loop case where a single lead consumes infinite iterations of a fundamentally rejected concept." A fundamentally rejected concept does not become un-rejected because the seller archived V1 + V2. Robust against abuse (seller cannot reset the counter by archiving). Predicate is simpler (no status filter to maintain or audit). | A seller who legitimately archives V1 as cleanup (e.g., concept totally pivoted; V1 is irrelevant) cannot regenerate to fresh V1' without admin intervention. Edge case; rare. |
| (b) Currently-active cap — exclude `archived` | Only workspaces in `{pending_generation, ready, delivery_active}` count. Archived workspaces are "forgiven". | More flexible for legitimate archive-and-restart flows. Admin doesn't need to intervene. | **Abuse vector**: seller archives V1 + V2 to free counter space, regenerates V3 + V4 + V5 indefinitely. Gate A (credits) is the only remaining bound. Defeats Gate B's stated purpose. Predicate carries a status filter that future migrations may need to audit (every new workspace status enum value forces a Gate B review). |
| (c) Hybrid — count `delivery_active` + `ready`; exclude `pending_generation` + `archived` | Pre-launch states forgiven; "real" prototipos count. | Theoretically aligned with "iterations that the client actually saw" — but ADR-023 D3 defines the client-visible artifact as the share token's lifecycle, which is orthogonal to workspace status. **Hybrid invents a new concept ("client-relevant iteration") not anchored in any prior ADR.** | New concept to maintain; high audit burden; no operator request behind it. |

#### Rationale for (a) — lifetime cap

1. **Memory lock alignment.** Project memory `project_maxwell_chat_lead_creation_flow.md` (Locked decisions §"Rejection feedback loop with layered cost control") describes Gate B as the dead-loop guard against "a single lead consum[ing] infinite iterations of a fundamentally rejected concept." A concept doesn't become un-rejected because the seller cleaned up the UI. Lifetime cap is the literal reading.
2. **ADR-023 D7 wording is permissive both ways but the rationale is monotonic.** ADR-023 D7 line 176 says "count the number of `prototype_workspaces` rows for the lead (or equivalently the count of distinct `prototype_decisions` plus the active workspace)". The phrase "or equivalently the count of distinct `prototype_decisions` plus the active workspace" implies a count that monotonically grows — never shrinks. Archived workspaces still have a `prototype_decisions` row (if they reached decision) or still exist as rows under the lead (if they didn't). The equivalent reading is lifetime.
3. **Abuse vector closed by construction.** Under (a), there is no operator action that reduces the count. The seller asking admin to raise `prototype_credit_settings.max_iterations_per_lead` per-instance is the controlled escape hatch — it's gated, audit-trailable, and per-tenant (the singleton row pattern means admin sets the global cap; per-lead exceptions would require a follow-up iteration if needed).
4. **Predicate simplicity.** No status filter means no audit burden when new statuses are added in future iterations. The predicate stays correct as `prototype_workspace_status` enum evolves.

#### Implementation constraints carried to B-slice

- **No status filter in the count.** The predicate B-slice ships is the exact one above. Backend MUST NOT add `where status <> 'archived'` or any status-based scoping.
- **Escape hatch is admin-driven.** If operator finds a legitimate "needs a fresh start" lead, admin raises `prototype_credit_settings.max_iterations_per_lead` globally OR (future iteration) introduces a per-lead override. The B-slice migration does NOT ship a per-lead override; only the singleton cap.
- **Hard-delete behavior is honest.** If admin hard-deletes a `prototype_workspaces` row (rare; rare enough that ADR-014 deletion-conservatism applies), the count drops by one. This is operator-driven and intentional. No defensive code path to recover the count.

#### Architectural truth (added to project memory in next docs turn)

> Gate B counts `prototype_workspaces` rows for the lead **regardless of status**. Archived workspaces count. The only count-reduction action is hard-delete of the workspace row, which is an operator-driven exceptional path.

### D3 — Q-impl-3 resolved: Override the router's split decision; bundle B-slice + C-slice in a single iteration

**Selected: bundle B+C.** The spec's chunking decision (single iteration covering both B-slice and C-slice) is adopted. The router's 4-chunk split (`docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md` §3) is overridden by Architecture as the more conservative-than-necessary decision for the current state.

#### Options considered

| Option | Description | Pros | Cons |
|---|---|---|---|
| (a) Bundle B+C (spec proposal) | Single iteration. 1 migration (`0060_phase_23a_prototype_decisions.sql`) ships B-slice schema + RPC extension + endpoint route + handler + helper extensions + Maxwell draft fire-and-forget + notifications fan-out. 1 PR. ~7-8 files net. | End-to-end validation in one shot (signed POST exercises both slices). Single PR review surface. One migration apply event. Soft dependency (per ADR-023 §Consequences line 273: "C-slice has a soft dependency on B-slice") is naturally satisfied by bundling. Smaller total review cost than 2+ PRs. | Larger blast radius if R1 surfaces (the `lead_id UNIQUE` drop with unforeseen callers requiring refactor). Less granular rollback. |
| (b) Split per router (4 chunks: C0 spec+arch / C1 persistence / C2 handler / C3 side-effect) | 3-4 PRs. Migration in PR 1; handler in PR 2; Maxwell draft in PR 3; (router proposed B-slice persistence in C1 as part of the C-slice, which is partially what happens under bundle too — the router was treating B and C as one iteration topologically even while splitting it into chunks). | Feature-flag friendly mid-state (handler stubbed pending Maxwell wire-up). Granular rollback. Pause point if R1 surfaces during C1. | Multiple migrations / PRs / review cycles. The "handler exists but Maxwell draft pending" mid-state is a feature-flag fence that adds code complexity for a short-lived state. Inflates total review + ops cost for a small marginal safety gain. |
| (c) Split B-slice (migration + RPC) into its own iteration, then C-slice handler in a separate iteration | 2 PRs. PR 1: migration + RPC. PR 2: route + handler + Maxwell + notifications. | Cleaner separation of concerns (data layer vs application layer). R1 (the `lead_id UNIQUE` drop) is fully resolved before any handler code lands. | Migration without a consumer in PR 1 — no end-to-end validation possible until PR 2. Forces synthetic test harness work for PR 1 to exercise B-slice in isolation. Two PRs to coordinate. |

#### Rationale for (a) — bundle

1. **The wire contract is the natural validation unit.** The spec's argument (line 286: "Sending a signed POST and observing the persisted decision exercises both slices simultaneously") is correct. Splitting forces synthetic harness work that bundling avoids.
2. **The router's split was driven by uncertainty about destabilization risk that the spec's risk analysis now bounds.** The router's reasoning (handoff §3.1: "If Maxwell-draft dispatcher destabilizes, C2 is already shippable as 'decision recorded, draft creation pending' with a feature-flag fence") assumed the Maxwell draft side-effect was a likely destabilizer. The spec's R3 + R4 + the ADR-023 D6 explicit fire-and-forget pattern reduce that risk: the side-effect's failure mode is **already** "decision recorded, notification escalates seller, manual draft via UI" — a feature-flag fence buys nothing additional. The Maxwell draft is structurally optional from day one.
3. **Both slices are individually small.** B-slice = 1 migration + 1 RPC + 1 helper-type extension. C-slice = 1 route + 1 handler + 1 helper extension. Combined: ~7-8 files of net change. Within healthy PR-review envelope (compare: B15 ledger landed as a single ~12-file PR; B20 inbound integration was larger still).
4. **The spec carries an explicit fallback to re-cut.** Spec line 288: "If during Backend the bundle proves too large (e.g., R1 surfaces unforeseen callers requiring substantial refactor), the spec MAY be re-cut as B-slice-only iteration + a C-slice follow-up. This is the explicit fallback per the SCOPE DISCIPLINE rule." This is the right safety valve — bundle by default, split on demand.
5. **R1 (the `lead_id UNIQUE` drop) is grep-bounded.** Per spec R1 mitigation: "Grep all references to `prototype_workspaces` during Backend; identify single-row assumptions (e.g., `.single()` calls without `order by created_at desc limit 1`)". A pre-Backend grep pass is fast (<10min); if surface is large, fall back to (c) at that gate. If surface is tight (the expected case based on the workspace's narrow callers — `request_lead_prototype` RPC + the workspace status update paths), bundle proceeds.

#### Implementation constraints carried to Backend

- **R1 grep pass is the first Backend step.** Before any code change, Backend greps for `prototype_workspaces` callers, especially `.single()` calls on `lead_id` lookups. If the grep surfaces non-trivial caller refactor (>2-3 files needing semantic changes beyond "use latest workspace"), Backend pauses and proposes re-cut to (c) — Architecture amends this ADR with a follow-up entry.
- **Migration is single-file (not split).** `0060_phase_23a_prototype_decisions.sql` carries: (i) drop `lead_id UNIQUE`, (ii) add `share_token` + `share_token_superseded_at` columns + backfill, (iii) add `max_iterations_per_lead` column, (iv) create `prototype_decisions` table + indexes + RLS, (v) extend `website_webhook_events.endpoint` CHECK to include `'prototype-decision'`, (vi) `create or replace function public.request_lead_prototype(uuid)` with the new dual-gate body. All atomic per ADR-014 ("single migration covers a coherent change set").
- **PR is single (not chained).** One PR carries the migration + route + handler + helper extensions + Maxwell draft + notifications. Operator merges per memory `feedback_no_auto_merge_prs`.
- **Refactor + Testing + Security + Docs + Validator stay in the chain.** The router decision on Mode (New Build) + Depth (FULL) + Chain (analysis → architecture (MANDATORY) → backend → refactor → testing → security → docs → validator) is preserved; only the chunking is overridden. After Backend lands, Refactor reviews for handler-sibling symmetry; Testing runs integration-first per spec §11; Security reviews HMAC + RLS surface; Docs updates `cross-repo-webhook-v1.md` §5 status (frozen → implemented) + `project.context.core.md` + roadmap; Validator gates COMPLETE.

#### Soft override of router handoff

The router handoff §3.1 ("Override del router vs hint del operator") is preserved on Mode + Depth + Chain + Architecture-mandatory. Only the 4-chunk split is overridden. Architecture takes ownership of the override per its authority to "force chunking if one design would be too broad or too coupled for one iteration" (and the symmetric authority to relax chunking when the original split was over-conservative).

---

## Architectural truth (capture for project memory and future sessions)

To remove ambiguity for future iterations:

| Concept | Where it lives | Authority |
|---|---|---|
| Replay-response reconstruction for `prototype-decision` | FK-join `prototype_decisions.webhook_event_id` → `website_webhook_events.id`. Ledger schema stays generic. | App (this ADR D1) |
| Gate B count predicate | `count(*) from prototype_workspaces where lead_id = $1` — no status filter. Lifetime cap. | App (this ADR D2; B-slice migration ships it) |
| Replay-side `draftPropuestaQueued` field | Always `false` on replay; Maxwell draft fires only on the original successful run per ADR-023 D6. | App (this ADR D1) |
| Bundling decision | B-slice + C-slice in single iteration, single migration, single PR. Router split overridden. | Architecture (this ADR D3) |
| Re-cut safety valve | If R1 (lead_id UNIQUE drop) surfaces non-trivial caller refactor during Backend grep pass, Backend pauses and proposes re-cut to (c) "B-slice solo + C-slice follow-up". | Backend gate (this ADR D3) |
| Ledger schema additions | Forbidden as part of this iteration. `website_webhook_events` stays generic; future inbound integrations follow the same FK-join pattern. | Architecture (this ADR D1) |
| `prototype_decisions.webhook_event_id` index | Required (partial index on non-null). Drives the replay-path join. | B-slice migration (this ADR D1 constraint) |

OQ-2 (background execution mechanism) and OQ-3 (`user_notifications.kind` value) remain open for Backend resolution during implementation per Architecture deferral. They are operational, not architectural, and do not affect contracts or external surfaces.

---

## Rationale

### Why not write a fourth ADR for Gate B alone or a fifth ADR for replay-path alone

Both Q-impl-1 and Q-impl-2 are tightly bounded decisions that share an iteration, share Backend ownership, and share a small implementation surface. Splitting them across separate ADRs would inflate the architectural-document index without improving traceability. Packaging them together with the bundling decision (Q-impl-3, also iteration-scoped) produces one ADR that future Architecture can grep with one key (`ADR-025`) when chasing "why did the prototype-decision implementation do X".

### Why this ADR amends ADR-016 narrowly rather than supersedes it

ADR-016 D6 "re-query and return the full wire shape" remains correct in spirit — the source table of the re-query is endpoint-specific by design. This ADR's D1 records that the `prototype-decision` endpoint re-queries `prototype_decisions` (not `website_inbound_links`). The pattern is preserved; the lookup table varies. No supersession is needed.

### Why a lifetime cap instead of a per-decision cap

A natural alternative interpretation of D2 is "count `prototype_decisions` rows, not `prototype_workspaces` rows". This would mean a workspace that was created but never decided does not count toward Gate B. Rejected: the workspace creation itself consumes a Gate A credit; the seller's regenerate-intent IS the iteration-counter event. Counting decisions would let a seller burn unlimited credits on `pending_generation` workspaces without ever crossing the cap — semantically wrong.

### Why the router was wrong (but not by much)

The router's 4-chunk split was conservative by design. It assumed the Maxwell-draft side-effect was a likely destabilizer (per router handoff §3.1 trigger 2). The spec's risk analysis (R3 + R4) shows the side-effect's failure mode is already non-destabilizing — fire-and-forget with notification escalation. The router's conservatism was correct under uncertainty; the spec's analysis resolved the uncertainty in favor of bundling. Architecture's override is calibration, not contradiction.

---

## Consequences

### What this enables

- **B-slice and C-slice land in one PR.** Smaller total review cost; one migration apply event; end-to-end validation in one shot.
- **Backend has a single chunk to implement.** No feature-flag fence between handler-exists and Maxwell-draft-exists. Both ship together.
- **Future inbound webhook endpoints inherit a clean pattern.** The FK-join replay model from D1 generalizes: each new endpoint adds a domain table soft-FKed to `website_webhook_events.id`; the replay path joins through that FK. The ledger stays generic.
- **Gate B is operator-comprehensible.** "Count of workspaces under the lead, lifetime, doesn't decrement on archive" is a one-sentence operator-facing rule. Admin can explain it to a seller without consulting the SQL.

### What this forbids

- **No `website_webhook_events.prototype_decision_id` column.** Per D1. The migration MUST NOT add it. Future inbound endpoints MUST NOT add per-endpoint FK columns to the ledger.
- **No status filter in Gate B predicate.** Per D2. Backend MUST NOT write `where status <> 'archived'` or any equivalent.
- **No `draftPropuestaQueued: true` on replay.** Per D1. The Maxwell draft side-effect runs only on the original successful run; replays return the recorded state.
- **No mid-state feature-flag fence between B and C.** Per D3. Both ship together or both split (re-cut to option (c)).

### Required follow-up work declared by this ADR

| Slice | Owner | Description |
|---|---|---|
| B+C bundled implementation | Backend | Single iteration per spec amendment, with the D1/D2 constraints encoded into the migration + RPC + handler + helper. R1 grep pass is the first Backend step. |
| Spec amendment | Architecture (done in this turn) | The spec `specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md` gets a new `## Architecture firm decisions (added 2026-05-25)` section referencing this ADR. OQ-1 and OQ-4 are marked RESOLVED with pointers to D1 and D2. |
| Backend documentation in core.md | system-docs (post-implementation) | Update `docs/context/project.context.core.md` to add the architectural truth rows from this ADR (when the implementation lands; not now — docs-only this iteration). Memory rule `feedback_context_docs_no_plan_refs` applies (no plan-IDs in core.md). |
| Roadmap sync | system-docs (post-implementation) | Update `D:\Pedro\Archivos Pedro\noon-app\roadmap\noonapp-roadmap.md` §16 (G24 row was the C-slice tracker; B-slice + C-slice both close in one PR per D3). |

### Active risks created or updated

- **Active risk (R1 from spec):** the `lead_id UNIQUE` drop may surface caller refactor work. Mitigated by the pre-Backend grep pass per D3. If the grep surfaces >2-3 callers needing semantic refactor, Backend pauses and triggers re-cut to option (c).
- **Active risk (new, low):** the FK-join replay path adds a code-path divergence per endpoint inside `composeReplayResponseFromLedger` (or sibling). Future maintainers reading the function must understand each endpoint has its own re-query table. Mitigated by D1's preference for option (b.2) — a sibling function `composePrototypeDecisionReplayResponseFromLedger` — which keeps the existing function untouched.
- **Active risk (operational, accepted):** Gate B lifetime cap may surprise a seller who archives V1 and expects a fresh counter. Mitigated by admin-driven cap raise as the controlled escape hatch (no per-lead override in B-slice scope; future iteration if needed).

### Re-evaluation triggers

This ADR must be revisited when:

1. **A third inbound endpoint adopts the FK-join pattern from D1** — at that point the pattern should be lifted into the `WebsiteWebhookEventRecord` shape (e.g., a generic `correlationTable` + `correlationId` pair) rather than re-derived per endpoint.
2. **Operator finds Gate B lifetime-cap semantics too rigid in production** — at that point the admin-driven cap-raise escape hatch may evolve into a per-lead override (new column on `leads` or a `prototype_lead_overrides` table; ADR amendment required).
3. **Backend grep pass on R1 surfaces unexpected caller scope** — at that point the bundle re-cuts to option (c) "B-slice solo + C-slice follow-up". This ADR amends with a closure note documenting the re-cut.
4. **The `prototype_decisions.webhook_event_id` partial index proves slow at production scale** — performance review at >100 req/min sustained replay rate. Not expected at pilot scale.

### Reactivation / migration triggers

- If v2 of the cross-repo contract introduces a schema version header (per `cross-repo-webhook-v1.md` §11 post-ADR-024 cascade), the `prototype-decision` entry migrates with the other entries; this ADR's decisions persist (D1 / D2 are App-internal; D3 is iteration-scoped and already discharged once Backend ships).
- If `prototype_decisions` is migrated to a different schema (e.g., sharding, archival), the FK-join replay key migrates with it. The `webhook_event_id` column is the durable identifier.

---

## Alternatives considered

### Alternative A — Extend ledger schema with `prototype_decision_id` column (Q-impl-1 option a)

Rejected per D1. Sets endpoint-specific schema sprawl precedent; violates ADR-016 D9 spirit. The FK-join is the generalizable shape.

### Alternative B — Currently-active cap, exclude archived (Q-impl-2 option b)

Rejected per D2. Opens an abuse vector (seller archives to reset counter); defeats Gate B's dead-loop guard purpose; misaligned with memory lock semantics.

### Alternative C — Split per router 4-chunk decision (Q-impl-3 option b)

Rejected per D3. The router's conservatism assumed Maxwell-draft destabilization risk that the spec's risk analysis bounds (fire-and-forget with notification escalation is already non-destabilizing). Bundle is the smaller-scope decision.

### Alternative D — Split B-slice + C-slice into 2 separate iterations (Q-impl-3 option c)

Rejected per D3 by default. Adopted as the explicit safety valve if R1 grep surfaces non-trivial caller refactor during Backend's first step.

### Alternative E — Pre-empt OQ-2 and OQ-3 in this ADR

Rejected. OQ-2 (background execution mechanism: `queueMicrotask` vs `setImmediate` vs detached promise) is operational; the runtime mechanism is Backend's choice within the explicit constraint "response sent before helper runs". OQ-3 (`user_notifications.kind` value) is similarly operational — Backend either reuses an existing kind (e.g., `'lead_activity'` per the existing CHECK constraint inventory in migration 0055) or adds a new kind in the B-slice migration. Both decisions are within Backend's authority per the agent contract; pre-empting them inflates this ADR without architectural benefit.

---

## Lifecycle

- **Author:** system-architecture (Claude Code session, 2026-05-25), reviewed by Pedro
- **Supersedes:** nothing
- **Superseded by:** nothing
- **Amends:** ADR-016 D6 (narrow extension — `composeReplayResponseFromLedger` per-endpoint re-query table)
- **Discharges:** spec OQ-1, OQ-4, and Chunking decision divergence vs router handoff

This ADR resolves three implementation-load-bearing decisions that the parallel-authored spec left open or in tension with the prior router decision. The spec is amended in the same turn (per the §"Required follow-up work" row above). Backend may proceed with the bundled B+C implementation as soon as the spec amendment lands and the operator approves the iteration's Definition-of-Ready gate.

---

## Closure notes (2026-05-25 — post-implementation)

### CN-1 — D1 implementation deviation: defensive 500 over re-run on orphan-FK

**Context.** D1 specified that when the FK-join replay reconstruction returns null (orphaned `webhook_event_id` after a hypothetical ledger row purge), the handler MUST "fall back to 're-run business logic' semantics per ADR-016 D6's failed-then-retry branch" via `shouldProcess: true`.

**Actual implementation.** The handler returns HTTP `500 PROTOTYPE_DECISION_PERSIST_FAILED` with a generic operator-friendly error string, plus a structured warn log `website.prototype_decision.replay_reconstruction_unavailable` carrying the ledger event id and attempt count. The re-run path is NOT taken.

**Rationale (per `system-security` review M-3, 2026-05-25).** Re-running business logic on a ledger row already marked `processed` would risk **double-firing the non-idempotent fire-and-forget Maxwell draft side effect and the seller notification** — the handler's Step 4 uniqueness check on `prototype_decisions(prototype_workspace_id)` catches a duplicate decision row, but the side-effect scheduler runs *after* the response is sent without re-consulting the ledger. The orphan-FK condition that would trigger this branch requires a deliberate manual ledger row purge (does not happen in normal operation), so the 500 is operator-detectable and the safer posture.

**Verdict.** Deviation accepted. ADR-025 D1 is amended to permit the defensive 500 as equivalent-or-safer to the literal "re-run" prescription. The architectural intent of D1 (avoid extending the ledger schema, route replay via FK-join) is fully honored; only the orphan-FK degenerate-case behavior is tightened.

**Where the 500 lives.** `app/api/integrations/website/prototype-decision/route.ts` lines 122-138 (post-Backend / post-M-2 cleanup state). Inline code comment cites this closure note.

**Future tightening (not now).** If a real orphan-FK case ever surfaces in production, options include: (a) reverse the FK direction (`prototype_decisions` becomes the parent; ledger rows reference it) — heavy refactor; (b) extend the side-effect scheduler with a `was_already_processed` short-circuit guard at the top of the helper — small change, future iteration. Neither is justified at pilot scale.

### CN-2 — Test debts deferred to operator post-merge

Per `system-testing` and `system-security` audits, two test debts are tracked but discharged-by-construction for this iteration:

- **AC-2 RPC dual-gate live SQL execution** — discharged by reading the live `pg_get_functiondef` of `request_lead_prototype(uuid)` against `pdotsdahsrnnsoroxbfe` (Gate B first; no status filter; SECURITY DEFINER + `search_path=public`). Operator-driven smoke against a Supabase test branch on first regenerate is the recommended next-confidence step.
- **AC-10 / R5 RLS live SELECT-as-3-personas** — discharged via static predicate-equivalence proof against `prototype_workspaces` policy + live INSERT-as-authenticated denial (`42501: new row violates row-level security policy`) + live anon SELECT = 0 rows. Operator post-merge fixture SQL is in the security review report.

### CN-3 — Security debt items recorded (none blocking)

- **SD-1 (MEDIUM):** rate-limit precedes HMAC verify on all three inbound routes (sibling convention). Future hardening across all 3 routes in one iteration.
- **SD-2 (MEDIUM):** verbose replay-path error message narrated internal schema names. **Fixed in this iteration's Docs phase** — replaced with generic operator-friendly string; structured log retains full detail.
- **SD-3 (MEDIUM):** this closure note CN-1 above.
- **SD-4 (LOW):** no body-text length cap before HMAC compute. Future global hardening.
- **SD-5 (INFO):** `metadata` payload field accepted but silently dropped — observability gap; consider persisting on the decision row in a follow-up.
