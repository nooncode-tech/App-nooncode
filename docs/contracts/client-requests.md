# Contract: client requests

**Responsibility:** Define the durable client-request entity that captures every request a client submits from the portal, routes it directly to the assigned developer/team, and tracks its classification, prioritization, execution, and escalation against scope and membership.

## Entity

`client_request` is the conceptual entity representing a single request submitted by a client about a specific project. Each request carries its own lifecycle independent of other requests on the same project. A request may originate as a comment, a material upload, a bug report, a minor adjustment, an improvement, a new feature ask, a scope change, or an urgent incident.

The entity is **portal-owned** and **project-scoped**. It is not a generic comment thread; the existing flat-comment surface in the client portal is intentionally narrower than this contract. A client request is a first-class operational record, persisted, classified, and acted upon by the assigned developer/team with PM/Admin oversight on exception cases.

## States / lifecycle / transitions

Per spec sec. 9.4, the official request states are:

- Received
- In Review
- Needs Clarification
- Queued
- In Progress
- Completed
- Out of Scope
- Escalated

Transition rules (text):

- A new request enters **Received** at submission time. Client-facing language stays simple; internal tooling carries the canonical state.
- The assigned developer/team moves the request from **Received** to **In Review** during classification.
- If clarification from the client is needed, the request moves to **Needs Clarification**; the client responds and the request returns to **In Review**.
- After classification, the request moves to **Queued** when accepted for execution but not yet started, or to **Out of Scope** when the request falls outside the approved scope and applicable membership rules, or to **Escalated** when PM/Admin intervention is required.
- A queued request moves to **In Progress** when the assigned developer/team begins execution, then to **Completed** on successful execution.
- **Escalated** requests may resolve by transitioning into any of the other terminal or actionable states once PM/Admin decides; the escalation event itself must remain auditable on the request even after resolution.
- **Client-facing display** for Escalated may surface as `Under internal review` per spec sec. 9.4. Internal tooling uses the canonical state.

PM/Admin intervention triggers (per spec sec. 9.3): out of scope, pricing impact, conflict, developer/team overload, significant timeline impact, client/developer dispute, priority/capacity issue, or request requiring a new proposal or plan upgrade.

## Conceptual data shape

Named fields (English nouns; no DDL):

- `request id` — stable identifier for the request.
- `project reference` — the project this request belongs to.
- `client account reference` — the client account that submitted the request.
- `submitter` — the specific client user that submitted the request, if multiple users share the account.
- `request type` — one of: material/file, comment/clarification, bug/problem, minor adjustment, support, monthly improvement, new feature, scope change, urgent/critical incident.
- `client-declared priority` — what the client marked the request as (Critical, High, Normal, Low, Backlog). Spec sec. 9.6 makes operational priority a Noon decision; the client value is informational.
- `operational priority` — Noon-defined priority used for execution ordering.
- `state` — one of the states listed in Lifecycle.
- `classification reason` — short structured note recorded at the In Review transition.
- `scope decision basis` — the rule applied to evaluate the request against the project's payment model (one-time vs membership) and approved scope, per spec sec. 10.
- `payment model context snapshot` — a snapshot of whether the request is being evaluated under one-time scope, an active membership, or both, captured at classification time so later membership changes do not silently re-classify the request.
- `assignee` — the developer/team member currently responsible.
- `escalation event log` — ordered list of escalation transitions, each with reason, actor, and timestamp.
- `attachments reference` — pointer(s) to client-uploaded materials associated with the request, when applicable.
- `version reference` — when the request is feedback against a specific version, a pointer to the corresponding `project_version` record (see `project-versions.md`).
- `created at` / `updated at` — temporal markers.

Permissions concern: the client must never see seller compensation, developer earnings, Noon margin, or internal escalation notes (spec sec. 8.3). The contract therefore distinguishes client-visible fields from internal-only fields. Client-visible: state (with the optional "Under internal review" alias for Escalated), submission timestamp, attached materials, the request the client wrote. Internal-only: classification reason, scope decision basis, escalation event log, operational priority, assignee identity beyond what the client portal already exposes.

## Inputs / triggers (what causes state changes)

- **Client submits** a request from the portal → creates the record in **Received**.
- **Developer/team classifies** in the developer surface → moves through **In Review** to **Queued**, **Out of Scope**, **Escalated**, or back via **Needs Clarification**.
- **Client provides clarification** → request returns to **In Review** from **Needs Clarification**.
- **Developer/team starts work** → transitions **Queued** → **In Progress**.
- **Developer/team marks completion** → transitions **In Progress** → **Completed**.
- **PM/Admin intervention** triggers a transition into or out of **Escalated** based on the spec sec. 9.3 cases.
- **Pre-payment auth** is a prerequisite: a request can only be created against a project that has already passed payment confirmation and is linked to an authenticated client account. See OPEN markers below.

## Outputs / consumers (who reads or reacts)

- **Assigned developer/team** — primary consumer; reads new requests, classifies, executes, completes.
- **PM/Admin** — observes all requests for their projects; intervenes on the spec sec. 9.3 trigger cases; may force reclassification or reassignment.
- **Client portal** — renders client-visible fields only; surfaces state changes as portal updates per spec sec. 22.2 (`request received`, `request in progress`, `request completed`).
- **Notifications system** — emits events on state changes; channel scope is gated by the index-level OPEN marker on Q9.
- **Internal activity log** — every state transition is recorded per spec sec. 22.1 (`client request created/classified/completed`).
- **Project version surface** — when a request is feedback against a specific version, the version's feedback view (see `project-versions.md`) reads the linked requests.

## Cross-entity references

- **`project-versions.md`** — when feedback is filed against a specific version, the request links to a `project_version` record. Spec sec. 21 requires that every comment, request, or feedback item about a version is attached to that version.

## Cross-refs to ADRs / audit / spec / flows

- Audit: `docs/audits/v3-phase-0-audit.md` §3 F-08, §4.6 sec 9 + sec 10, §6 (Client requests step in the audit's recommended phase ordering).
- Spec: `docs/product/master-spec-v3.md` sec. 9 (9.1–9.6), sec. 10 (10.1, 10.2).
- Flows: `docs/product/master-spec-v3-flows.md` §7 Client request flow.
- Sibling contracts: `project-versions.md`.

## OPEN markers

- OPEN: gated by audit §7 Q2 (client portal location)
- OPEN: gated by audit §7 Q5 (pre-payment auth)
