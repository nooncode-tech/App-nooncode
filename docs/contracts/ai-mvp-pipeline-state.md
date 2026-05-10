# Contract: AI MVP pipeline state

**Responsibility:** Define the post-payment Maxwell AI MVP pipeline run as a stateful, bounded entity that orchestrates GPT specification → V0 base → Opus technical improvement → minimum validation, with up to 5 auto-fix cycles before escalation, and emits a `project_version` as its outcome.

## Entity

`ai_mvp_pipeline_run` is the conceptual entity representing one execution of the post-payment AI MVP pipeline for a specific project. A project typically has exactly one such run (the first usable AI MVP after payment confirmation), but the contract allows additional runs in cases where escalation, rollback, or PM/Admin re-trigger requires a fresh pipeline pass.

Per `docs/adrs/ADR-005-maxwell-modules-shared-brand.md`, this pipeline belongs to **Maxwell Inbound** (the website-side surface that owns the post-payment AI orchestration). It is **not** part of `Maxwell Lead Engine V1`, which is App / outbound / seller-only and must not be repurposed for post-payment AI MVP behavior. Per ADR-005 Consequences §2, future v3 sec 15–22 work creates new modules under the Maxwell Inbound namespace on the website product. The third surface, **Maxwell Chat** (App copilot), is also explicitly **not** involved in this pipeline; it is an independent App-internal copilot.

This entity is not the existing single sales-triggered v0 prototype generation. The existing surface remains a sales-time prototype and is not the foundation of the post-payment pipeline (per audit §5.3 architecturally load-bearing assumption 6). Any future migrations introduced to support this contract must follow `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` and use prefixes above the current highest applied prefix.

## States / lifecycle / transitions

States (text):

- Pending Trigger
- GPT Specification
- V0 Generation
- Opus Improvement
- Validation
- Auto-Fix
- Escalated
- Completed
- Cancelled

Transition rules (text):

- A run begins as **Pending Trigger** when payment confirmation creates the project (spec sec. 7.2 step 5, sec. 16.1). The trigger is automatic; the client must not wait for a manual click.
- The run advances to **GPT Specification**: structures client context, understands requirements, defines product direction, extracts scope, prepares the prompt for generation (spec sec. 15.2). Context sources are prioritized per spec sec. 17 (approved proposal > approved prototype > Maxwell conversation > materials > AI inference).
- On GPT completion, the run advances to **V0 Generation**: produces the first base/prototype.
- On V0 completion, the run advances to **Opus Improvement**: organizes architecture, improves logic, scalability, and applies better development practices.
- On Opus completion, the run advances to **Validation**: runs the minimum validation per spec sec. 19.1 (preview loads, no critical visible crash, main routes work, no severe placeholder content, no sensitive internal data exposed, result matches approved scope, basic security/coherence checks pass).
- If validation **passes**, the run advances to **Completed** and emits a `project_version` in `Ready for Client Preview` (see `project-versions.md`).
- If validation **fails**, the run advances to **Auto-Fix**. The auto-fix attempt re-enters Validation. The pipeline allows up to **5** auto-fix cycles total (spec sec. 19.2).
- After 5 failed cycles, or upon any of the early-escalation conditions in spec sec. 19.2 (security risk, sensitive data exposure, out-of-scope result, blocking conflict between proposal/prototype/requirements, critical technical failure, missing critical client material, incoherent generation), the run transitions to **Escalated**. Escalated requires human intervention by PM or developer principal.
- **Cancelled** is reachable from any state when PM/Admin intentionally aborts the run (e.g. payment reversal, scope rescoping, project cancellation).
- Project-type branching (spec sec. 18.1–18.8) influences what the pipeline generates within each stage but does not change the state machine itself. Project type is read at GPT Specification time and informs all subsequent stages.

## Conceptual data shape

Named fields (English nouns; no DDL):

- `pipeline run id` — stable identifier for the run.
- `project reference` — the project this run belongs to.
- `triggered by` — actor or system event that triggered the run (typically a payment confirmation event id).
- `state` — one of the states listed in Lifecycle.
- `project type snapshot` — the project type read at GPT Specification time (website/landing, web app/SaaS, e-commerce, booking/reservations, CRM/dashboard, mobile app, automation/AI workflow, backend/API/integration), driving the spec sec. 18 branching.
- `context sources snapshot` — references to the approved proposal, the approved/current prototype, the Maxwell conversation context, and the client materials considered, with the priority order recorded so re-runs do not silently change inputs.
- `auto-fix attempt count` — current attempt number, bounded at 5.
- `validation history` — ordered list of validation outcomes per attempt, each with the failing checks enumerated.
- `escalation reason` — short structured note when state is Escalated, distinguishing exhaustion of auto-fix attempts from early-escalation triggers.
- `cost ceiling snapshot` — bounded LLM cost budget the run was authorized for, recorded so escalation can reference budget exhaustion if applicable.
- `output version reference` — pointer to the `project_version` record emitted on Completed (see `project-versions.md`).
- `started at` / `completed at` / `escalated at` / `cancelled at` — temporal markers.
- `runtime mode` — the runtime placement that executed this run. The exact runtime choice is not yet decided. See OPEN marker below.

Permission concern: the client must not see technical errors. Per spec sec. 19.3, the portal exposes only clean messages (`Preparing your project`, `Preparing your first version`, `First version available`, `Our team is preparing your project`). Internal-only fields include validation history details, escalation reason internals, cost ceiling, and auto-fix attempt count.

## Inputs / triggers (what causes state changes)

- **Payment confirmation event** for an outbound or inbound project → creates a run in `Pending Trigger`, immediately advances to `GPT Specification` (per spec sec. 7.2 step 5; the trigger must be automatic per sec. 16.1).
- **Stage completion** for each pipeline stage → advances the run to the next stage.
- **Validation pass** → advances to `Completed` and emits the version.
- **Validation fail** with attempts remaining → advances to `Auto-Fix`, then back to `Validation`.
- **Validation fail** with attempts exhausted, or **early-escalation trigger** → advances to `Escalated`.
- **PM/Admin cancellation** (e.g. payment reversal, rescoping) → advances to `Cancelled` from any non-terminal state.
- **Re-trigger from PM/Admin** after escalation/cancellation may create a fresh run (new `pipeline run id`); it does not mutate a terminal run.

## Outputs / consumers (who reads or reacts)

- **`project_version` record** — the run emits exactly one version on `Completed`, in `Ready for Client Preview`. See `project-versions.md`.
- **Developer principal** — receives notification on `Completed` (`AI MVP ready` per spec sec. 33.2) and on `Escalated` (`AI MVP escalated`); reviews, hardens, connects, completes per spec sec. 16.4.
- **PM/Admin** — receives notification on `Escalated` (spec sec. 33.3); intervenes per spec sec. 19.2 escalation cases.
- **Client portal** — surfaces only the clean status messages from spec sec. 19.3; never the internal state or validation details.
- **Internal activity log** — records pipeline lifecycle events per spec sec. 22.1 (`AI MVP generated`, `AI MVP validation/fix/escalation`).
- **Notifications system** — emits events on `Completed` and `Escalated`; channel scope is gated by the index-level OPEN marker on Q9.

## Cross-entity references

- **`project-versions.md`** — the run's `output version reference` points to a `project_version`. The version's `originating pipeline run reference` points back here.

## Cross-refs to ADRs / audit / spec / flows

- ADR: `docs/adrs/ADR-005-maxwell-modules-shared-brand.md` Consequences §2 — Maxwell Inbound owns this pipeline; `Maxwell Lead Engine V1` does not. The third surface `Maxwell Chat` is not involved.
- ADR: `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` — any future migrations introduced from this contract must use prefixes above the current highest applied prefix (above 0042 at the time of this contract).
- Audit: `docs/audits/v3-phase-0-audit.md` §3 F-06, §4.6 sec 15–19, §5.3 assumption 6, §6 (Maxwell AI MVP pipeline step in the audit's recommended phase ordering).
- Spec: `docs/product/master-spec-v3.md` sec. 15 (15.1–15.3), sec. 16, sec. 17, sec. 18 (18.1–18.8), sec. 19 (19.1–19.3).
- Flows: `docs/product/master-spec-v3-flows.md` §5 Post-payment Maxwell AI pipeline, §11.3 AI does not replace developer.
- Sibling contracts: `project-versions.md`.

## OPEN markers

- OPEN: gated by audit §7 Q6 (AI MVP pipeline runtime)
