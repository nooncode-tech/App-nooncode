# ADR-026: Maxwell Lead Engine V1 auditor migrates from `gpt-4o-mini` to `gpt-5.5` — scoped, reversible model swap

**Status:** Accepted
**Date:** 2026-05-25
**Deciders:** Pedro (Engineering owner), system-architecture
**Supersedes:** None
**Related:**
- ADR-022 (Stripe Connect dormant — precedent for reversible decisions parked behind a single-line flip)
- `specs/fase-23a-maxwell-niche-system.md` (iteration spec — niche system bundles the model swap)
- `docs/architecture/fase-23a-maxwell-niche-system-architecture.md` §C3 (this ADR is the binding reference)
- `docs/product/maxwell-lead-engine-v1.md` (model table updated in the same iteration)

---

## Context

The Maxwell Lead Engine V1 audits OpenStreetMap business candidates through OpenAI `generateObject`. Today (pre-ADR), the auditor is hardcoded to `openai('gpt-4o-mini')` in two sites inside `lib/server/maxwell/lead-engine.ts` (the `auditCandidates` function body and any companion `generateObject` call inside the file).

The user requested, as part of the niche-system iteration (`fase-23a-maxwell-niche-system`), that the auditor switch to `openai('gpt-5.5')`. The motivation is two-fold:

1. **Niche-specialized prompts demand higher reasoning quality.** With the addition of `auditHint` injected into the system prompt per micro-niche (126 distinct hints), the audit task becomes more nuanced: the model must reconcile a generic "Maxwell Lead Engine V1" instruction with niche-specific pain signals while still emitting the byte-identical Zod-validated output shape. A stronger model reduces the risk of schema-validation failures and improves the relevance of `salesSpeech`, `mainPain`, and `suggestedSolution` for the seller.
2. **The cost / latency delta is acceptable at pilot scale.** ADR-008's internal-pilot scope means daily audit volume is bounded (≤3 searches/day/seller, ≤60 candidates/search, ≤2 niches/search). The marginal cost of `gpt-5.5` over `gpt-4o-mini` per audit run remains small in absolute terms at this volume.

The model id `gpt-5.5` is treated as a literal string. Architecture does not validate at design time that OpenAI exposes this id with current credentials; that validation is a runtime smoke obligation for the operator before merging to `develop`.

---

## Decision

**Replace the literal `'gpt-4o-mini'` with `'gpt-5.5'` in every `openai(...)` call inside `lib/server/maxwell/lead-engine.ts`. No other file changes its model id in this ADR.**

Concretely:

1. The `auditCandidates(...)` function body's `model: openai('gpt-4o-mini')` becomes `model: openai('gpt-5.5')`.
2. Any other `openai('gpt-4o-mini')` call site inside `lib/server/maxwell/lead-engine.ts` (presently zero or one, depending on companion helpers) changes identically.
3. Backend records the exact line numbers of each replacement in the PR description so a future rollback PR can revert atomically.
4. **Out of scope by design:** any `gpt-4o-mini` usage in other files of the repo (e.g., `lib/server/maxwell/chat.ts` if it exists, summarization helpers, content-generation paths elsewhere) is **not** touched. Each such site keeps its current model and may be migrated in a future ADR if and when the same evidence applies.

---

## Acceptance criteria

The decision is considered correct if **all** of the following hold after the iteration's merge:

- `pnpm build` and `pnpm test` pass with the new model literal in place.
- A runtime smoke against staging (operator-driven, post-merge) shows at least one successful Maxwell search ending in `status: 'completed'` with the new model, where the published lead's `maxwell_snapshot.salesSpeech` validates against `maxwellAuditSchema` and reads coherently for the chosen niche.
- The error rate on `auditCandidates` does not regress observably compared to the `gpt-4o-mini` baseline (operator judgment over the first week post-merge; no formal SLO).
- Per-search cost reported by the OpenAI billing dashboard stays within an acceptable operational envelope (operator judgment; pilot scale makes this dominated by fixed costs rather than per-token costs).

If any of the above fails, execute the rollback below.

---

## Rollback plan

Rollback is intentionally trivial:

1. Open a new PR that reverts the literal swap: change every `openai('gpt-5.5')` inside `lib/server/maxwell/lead-engine.ts` back to `openai('gpt-4o-mini')`. This is a one-line change per site (typically 1–2 sites).
2. Document the rollback reason in the PR description and link back to this ADR.
3. No schema migration needed. No data migration needed. Existing leads stored in `maxwell_snapshot` JSONB are not affected (the schema validated them at write time; the model that produced them is irrelevant to read-back).
4. Update the §Status of this ADR to `Superseded by ADR-XXX` and capture the lessons learned in the new ADR.

Rollback time budget: under 15 minutes from PR open to merge once the issue is observed.

---

## Consequences

### Positive

- **Higher-quality niche-specialized speech.** The auditor receives the niche `auditHint` and is expected to produce `salesSpeech` and `mainPain` content that aligns with the niche reality.
- **Single source of truth for the auditor model.** Co-located with the niche refactor, so any future model decision for the Lead Engine has one file to grep.
- **No contract change.** The Zod-validated output schema `maxwellAuditSchema` remains byte-identical (per §C2 of the architecture doc). All downstream consumers (`buildLeadInsert`, `components/lead-detail.tsx`, the `maxwell_lead_feedback` table) are unaffected.

### Negative / risks

- **Runtime availability of `gpt-5.5` is not pre-validated.** Architecture explicitly delegates this check to the operator's runtime smoke. If the model id is unavailable, every Maxwell search fails with a 5xx (caught by the existing try/catch and recorded as `status: 'failed'`). Mitigation: rollback plan above.
- **Cost / latency drift.** `gpt-5.5` is presumed slower and more expensive per call than `gpt-4o-mini`. At pilot scale (≤9 audit chunks/seller/day), this is tractable. If volume grows, the rollback (or a tiered routing decision) becomes worth revisiting.
- **Inconsistent model choices across the repo.** Other files keep `gpt-4o-mini`. This is intentional (scoped ADR) but the asymmetry is a foot-gun for future engineers grepping for a single source of truth. Mitigated by this ADR explicitly enumerating the scope.

### Neutral

- No schema migration, no data migration, no env var, no infra change. The model literal is the only diff.

---

## Open questions / explicit non-decisions

- **Whether `gpt-5.5` exists at runtime with the platform's current OpenAI credentials.** Architecture does not assert this. Validation is delegated to the operator before merging to `develop`. If the runtime smoke fails, execute the rollback.
- **Whether other Lead Engine companions (chat helpers, summarizers elsewhere) should also migrate.** Deferred to evidence. Each such migration is its own ADR if and when justified.
- **Whether to gate the model behind an env var.** Rejected — the same rationale as ADR-022 §"Why not gate via env var" applies: a hardcoded literal with a clear ADR reference is more self-documenting than a per-environment variable that drifts. When (if) we need per-environment model overrides, that is a new ADR.

---

## Scope

This ADR scopes the model change to **`lib/server/maxwell/lead-engine.ts` only**. Every other file in the repo that references `gpt-4o-mini` (or any other OpenAI model id) is explicitly outside this ADR's authority. Future ADRs may extend the scope; this ADR will not silently broaden.
