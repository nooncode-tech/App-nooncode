# Contract: project versions

**Responsibility:** Define the per-project version entity that owns the Draft / Ready for Client Preview / Client Preview / Published / Previous Published / Rolled Back / Delivered Version lifecycle, anchors client feedback to a specific version, and keeps client-controlled publishing separate from formal delivery.

## Entity

`project_version` is the conceptual entity representing a single, immutable snapshot of a project's deliverable at a point in time. A project has many versions over its life. Versions originate either from the Maxwell AI MVP pipeline (the first usable AI MVP version after payment) or from the developer principal (subsequent corrected/updated versions sent to the portal). Versions are the unit the client interacts with in the portal: previewed, optionally published, optionally rolled back, and ultimately delivered.

This entity is **independent of `prototype_workspaces`**. The existing `prototype_workspaces` row carries `current_stage` and `status` for the operational sales/delivery handoff and does not satisfy spec sec. 20.6 by extension. Versioning belongs on this new entity. A `project_version` may reference an originating prototype workspace for lineage but is not a column inside it.

The Maxwell-Inbound boundary anchored by `docs/adrs/ADR-005-maxwell-modules-shared-brand.md` applies: AI-generated initial versions belong to the post-payment Maxwell Inbound surface (the website-side AI MVP pipeline). Versions arriving from `Maxwell Lead Engine V1` are out of scope; that module does not produce project versions.

## States / lifecycle / transitions

Per spec sec. 20.6, the version states are:

- Draft
- Ready for Client Preview
- Client Preview
- Published
- Previous Published
- Rolled Back
- Delivered Version

Transition rules (text):

- A version begins as **Draft** when generation or developer authoring starts. **Draft** is internal-only; the client does not see it.
- A version moves to **Ready for Client Preview** once it passes the minimum validation per spec sec. 20.8 (and, for AI-generated versions, the validation defined in `ai-mvp-pipeline-state.md`). Validation failure keeps the version in **Draft** until corrected.
- A version moves from **Ready for Client Preview** to **Client Preview** when it becomes the active private preview surface in the portal (spec sec. 20.1, 20.4). Multiple historical versions may have passed through Client Preview; only one is the current active preview at a time per project.
- For website / web app project types only, the client may transition the active preview to **Published**. Per spec sec. 20.2, public publishing is client-controlled and is not automatic.
- When a new preview is published over an existing **Published** version, the prior public version becomes **Previous Published** and the new one becomes **Published** (spec sec. 20.5).
- **Rolled Back** is set on a version that was previously Published and has been retired by client request, developer authorized action, or PM/Admin action (spec sec. 20.7). Rollback events must be logged.
- **Delivered Version** is set when Noon validates the agreed scope is complete (spec sec. 16.3, 20.3). Delivered is a Noon-validated state; it is **not** the same as Published. A project may be Published but not Delivered, or Delivered but never publicly Published (e.g. internal/backend project types — spec sec. 18.8).
- All transitions are auditable; rollback and publish/update-published events are recorded both in the internal activity log (spec sec. 22.1) and surfaced in client-facing updates (spec sec. 22.2) at appropriate granularity.

Per spec sec. 11.1 in the flows file: **Published is not Delivered**. The contract preserves this distinction by keeping `Published` and `Delivered Version` as separate states rather than collapsing them.

## Conceptual data shape

Named fields (English nouns; no DDL):

- `version id` — stable identifier for the version.
- `project reference` — the project this version belongs to.
- `version sequence number` — monotonic per-project ordering.
- `state` — one of the states listed in Lifecycle.
- `origin` — how this version came to exist: `ai_pipeline_initial`, `developer_authored`, `developer_correction`, or `rollback_restoration`.
- `originating pipeline run reference` — when origin is AI, a pointer to the corresponding `ai_mvp_pipeline_run` record (see `ai-mvp-pipeline-state.md`).
- `created by` — actor (developer principal, AI pipeline, or PM/Admin in rollback cases).
- `validation outcome` — pass/fail summary of the minimum validation gate, with the failing checks enumerated when applicable.
- `client preview activation timestamp` — when the version became the active Client Preview, if ever.
- `published timestamp` — when the client published this version, if ever.
- `previous-published-from reference` — when this version replaced a prior Published version, a pointer to that prior version.
- `rollback reason` — short structured note when state is Rolled Back.
- `delivered timestamp` — when this version was marked as the Delivered Version.
- `feedback links` — collection of `client_request` references that are feedback against this version (see `client-requests.md` and spec sec. 21).
- `materials snapshot reference` — pointer to the materials/files set considered at generation time, when applicable.
- `created at` / `updated at` — temporal markers.

Permission concern: the client portal must surface only the versions and fields appropriate to the client. Internal-only fields include validation outcome details, originating pipeline run internals, and rollback reason internals. Client-facing fields include version sequence/label, current state (with portal-friendly wording), preview availability, and the feedback the client themselves attached.

## Inputs / triggers (what causes state changes)

- **AI MVP pipeline produces a version** → creates a `Draft` version with origin `ai_pipeline_initial`. Validation gate moves it to `Ready for Client Preview` on pass.
- **Developer principal sends a corrected/updated version** → creates a `Draft` version with origin `developer_correction` (or `developer_authored` for non-correction authoring). Validation gate moves it to `Ready for Client Preview` on pass.
- **Portal activates the version as preview** → transitions `Ready for Client Preview` → `Client Preview`.
- **Client clicks Publish / Publicar** (web/web-app project types only) → transitions `Client Preview` → `Published`; demotes prior `Published` to `Previous Published`.
- **Client confirms Update Published Version** → equivalent to publishing a new preview over the current published version.
- **Rollback action** (client request, developer authorized, or PM/Admin) → transitions `Published` → `Rolled Back` and may re-elevate a prior version per the rollback target.
- **Noon completes formal delivery** (developer/team validated approved scope) → marks the corresponding version as `Delivered Version`.

## Outputs / consumers (who reads or reacts)

- **Client portal** — renders the active preview, the published version (if any), the version history, and version-anchored feedback.
- **Developer principal** — reads validation outcomes, sends new versions, authorizes rollbacks within permission rules.
- **PM/Admin** — has rollback authority and intervenes per spec sec. 20.7; sees full version metadata.
- **AI MVP pipeline** (see `ai-mvp-pipeline-state.md`) — emits a version into Draft and writes the validation outcome.
- **Internal activity log** — records every transition (spec sec. 22.1).
- **Client-facing updates** — surfaces transitions to the client at appropriate granularity (spec sec. 22.2): `first version available`, `new version available`, `public version updated`, `project delivered`.

## Cross-entity references

- **`ai-mvp-pipeline-state.md`** — pipeline runs produce versions; the version's `originating pipeline run reference` links here.
- **`client-requests.md`** — feedback per version (spec sec. 21) is filed as `client_request` records that link back to this version.

## Cross-refs to ADRs / audit / spec / flows

- ADR: `docs/adrs/ADR-005-maxwell-modules-shared-brand.md` — AI-generated versions originate from Maxwell Inbound on the website product, not from `Maxwell Lead Engine V1`.
- Audit: `docs/audits/v3-phase-0-audit.md` §3 F-07 + F-19, §4.6 sec 20–22, §6 (Versioning and publish step in the audit's recommended phase ordering).
- Spec: `docs/product/master-spec-v3.md` sec. 20 (20.1–20.8), sec. 21, sec. 22 (22.1, 22.2).
- Flows: `docs/product/master-spec-v3-flows.md` §6 Client portal and versioning flow, §11.1 Publish is not Delivered.
- Sibling contracts: `ai-mvp-pipeline-state.md`, `client-requests.md`.

## OPEN markers

- OPEN: gated by audit §7 Q2 (client portal location)
- OPEN: gated by audit §7 Q10 (per-project version history scope)
