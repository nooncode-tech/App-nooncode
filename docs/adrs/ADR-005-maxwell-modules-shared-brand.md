# ADR-005: Maxwell as two functionally separate modules under a shared brand identity

**Status:** Accepted
**Date:** 2026-05-10
**Deciders:** Engineering team

---

## Context

The v3 master spec at `docs/product/master-spec-v3.md` sec. 5.1 frames `Maxwell` at the website as a single inbound entity that owns the public conversation, the prototype generation, and (post-payment) the AI MVP pipeline (sec. 15–22).

The current repository ships an App-side, outbound-only system also named Maxwell:

- `Maxwell Lead Engine V1` lives in App internal at `lib/server/maxwell/lead-engine.ts`, exposes `POST /api/maxwell/lead-searches`, persists state in `supabase/migrations/0038_phase_16a_maxwell_lead_engine_v1.sql` (table `maxwell_search_runs` + `maxwell_lead_feedback`), and is fully documented in `docs/product/maxwell-lead-engine-v1.md`.
- It powers seller-side outbound lead discovery (Map/List view, "Buscar leads en esta zona", GPT-first audit, `salesSpeech` variants, etc.).
- The existing operating rule in `docs/context/project.context.core.md` line 40 reads: *"Maxwell Lead Engine V1 is App/outbound/seller-only. It must not be treated as the website inbound Maxwell, and it must not modify website, inbound, payments, workspace, developer board, post-payment handoff, earnings rules, or sensitive permissions unless explicitly scoped."*

Additionally, the App ships a third independent surface called Maxwell — the dashboard chat copilot (`/api/maxwell` + `components/maxwell-chat.tsx`) — explicitly framed in `project.context.core.md` as a general assistant *without* automatic workspace grounding.

This naming overlap was catalogued as audit finding **F-01 (Critical)** in `docs/audits/v3-phase-0-audit.md` §3 row F-01, §4.1 (full conflict register), §5.1 (Pre-Phase blocker PR0a), and §7 Q1 (gating user question). It blocks scoping of every spec phase that references `Maxwell` (sec. 5–10, 15–22) until the naming and ownership are resolved.

---

## Decision

Maxwell is a **shared brand identity / persona** under which **two functionally separate modules** operate inside the same ecosystem. Verbatim from the product owner: *"dos sistemas (o módulos) funcionalmente separados que operan bajo un mismo ecosistema y comparten identidad de marca (persona)"*.

- **Maxwell Lead Engine V1** — App / outbound / seller-only. Existing implementation. No change.
- **Maxwell Inbound** — website-side, owns public inbound conversation and the post-payment AI MVP pipeline (future v3 sec. 15–22 work). Not yet scoped, not yet implemented.

A third surface, **Maxwell Chat (App copilot)**, is preserved as an independent App-internal copilot under the same brand. It is neither Lead Engine V1 nor Inbound, and it does not host any v3 sec. 15–22 work.

---

## Rationale

- Preserves the already-shipped Lead Engine V1 contract (route, table, docs, runtime evidence) without forcing a rename, schema change, or rewrite.
- Lets website-side v3 work (sec. 15–22) ship as `Maxwell Inbound` without colliding with App outbound responsibilities.
- The shared brand keeps the user-visible persona unified across surfaces (sellers, clients, App users all interact with "Maxwell").
- Reconciles the spec sec. 5.1 ambiguity by naming subsystems explicitly rather than collapsing identity. Where the spec writes bare `Maxwell` in inbound or post-payment context, this ADR resolves it as `Maxwell Inbound`, not `Maxwell Lead Engine V1`.
- Formalizes the existing operating rule on `project.context.core.md` line 40 as a project-wide invariant rather than a transient note.

---

## Consequences

The following are **hard rules** introduced by this ADR. Violations should be treated as architectural defects and blocked in review.

1. **No module-level coupling between the two Maxwell modules.** They share brand only — not code, schema, runtime, or contracts. `Maxwell Lead Engine V1` source must not import from a future `Maxwell Inbound` module, and vice versa. They may share generic infrastructure (logger, rate limiter, GPT/v0 SDK clients) but never domain types or business functions.
2. **Future v3 sec. 15–22 work belongs to website-side Maxwell Inbound, NOT to `Maxwell Lead Engine V1`.** Nothing in App outbound code (`lib/server/maxwell/lead-engine.ts`, the `/api/maxwell/lead-searches` route, the `maxwell_*` tables) may be repurposed to host post-payment AI MVP pipeline behavior. New AI MVP work creates new modules under the `Maxwell Inbound` namespace on the website product.
3. **The operating rule in `project.context.core.md` line 40 is preserved and formalized by this ADR.** That rule now has an authoritative anchor; do not weaken or contradict it without a follow-up ADR.
4. **Spec sec. 5.1 reconciliation.** When the spec text says `Maxwell` without a subsystem qualifier in inbound or post-payment context, it refers to `Maxwell Inbound`. When it appears in outbound / seller / lead-engine context, it refers to `Maxwell Lead Engine V1`. When it appears in App copilot / dashboard chat context, it refers to `Maxwell Chat`. The spec text itself does not need to be edited; this ADR is the canonical reconciliation reference.
5. **`Maxwell Chat` (App copilot)** stays a third independent surface under the same brand. It is currently honesty-first (general assistant, no auto workspace grounding); if it ever gains real grounding, that work is scoped separately and does not move it into either of the other two modules.
6. The Active risk on `project.context.core.md` for the Maxwell terminology conflict remains **active** until `Maxwell Inbound` is actually scoped and implemented on the website product. The conflict's *naming* is resolved here; the *implementation* still has not landed, and the risk reflects that gap.

---

## Cross-references

- Audit: `docs/audits/v3-phase-0-audit.md` §3 row F-01, §4.1 (Maxwell terminology conflict register), §5.1 (Pre-Phase blocker PR0a), §7 Q1 (gating question).
- Spec: `docs/product/master-spec-v3.md` sec. 5.1 (the ambiguous wording this ADR reconciles).
- Context: `docs/context/project.context.core.md` line 40 (operating rule preserved by this ADR) and the Active risk line for Maxwell terminology (now anchored to this ADR).
- Sister ADR: `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` (other Pre-Phase decision).
- Lead Engine V1 product context: `docs/product/maxwell-lead-engine-v1.md`.
- Source PDFs: `docs/product/source/LeadEngine_Codex_FIXED.pdf`, `docs/product/source/NoonApp_Seller_Speech_Codex_Addendum.pdf`.
