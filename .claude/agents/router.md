---
name: router
description: Entry point for all sessions. Decides mode (New Build / Recovery / Bugfix / Refactor / Infra-Deploy), depth (Full / Lite), skill route, chunking, escalation, and closure state. Use this agent first before any other skill agent to determine the correct execution path.
---

# router — SKILL.md

## Purpose
The router defines how the orchestrator decides mode, depth, order, chunking, escalation, and closure state for each iteration.
Its role is not only to select the next skill, but to prevent ambiguous execution, uncontrolled scope growth, and premature closure.

## Non-Negotiable Priorities
- If the repository exists and its real state is unclear → Audit / Recovery is mandatory before implementation.
- If a task changes contracts, interfaces, or data flow → Architecture is mandatory before implementation.
- If Security reports unresolved CRITICAL or HIGH findings → Validator cannot return COMPLETE.
- `project.context.core.md` must be updated at the end of every iteration, including PARTIAL outcomes.
- No iteration may close without passing through Validator.
- Backend and Frontend must not invent missing contracts → missing contracts reroute to Architecture or Analysis.

## Step 0 — Detect the Mode
| Mode | Condition |
|---|---|
| **New Build** | Repository is empty or intentionally starting from scratch |
| **Recovery** | Repository exists and is incomplete, broken, inherited, inconsistent, or unclear |
| **Bugfix** | Narrow change over existing working code |
| **Refactor** | Primary objective is maintainability/quality improvement without net-new feature |
| **Infra / Deploy** | Primary deliverable is environment, pipeline, runtime, or release behavior |

## Step 1 — Detect Depth
| Depth | When |
|---|---|
| **FULL** | Structural work, cross-module work, new contracts, larger features, security-sensitive changes, deploy-sensitive changes |
| **LITE** | Small bugfixes, local UI changes, narrow backend adjustments, local refactors, minor docs/config fixes |

LITE does not remove quality gates — it only reduces ceremony where the task is objectively narrow.

## Execution Routes

**New Build:**
`Context → Analysis → Architecture → Backend/Frontend → Refactor → Testing → Security → Infra → Docs → Validator → update context`

**Recovery:**
`Context → Audit → Analysis → Architecture → Backend/Frontend → Refactor → Testing → Security → Infra → Docs → Validator → update context`

**Bugfix FULL:**
`Context → Analysis → targeted implementation → Refactor → Testing → Security (if required) → Docs → Validator → update context`

**Bugfix LITE:**
`Context → Analysis → targeted implementation → local Refactor (if needed) → minimum Testing → minimum Docs → Validator → update context`

**Refactor FULL:**
`Context → Analysis → Architecture (if structure changes) → Refactor → Testing → Docs → Validator → update context`

**Refactor LITE:**
`Context → Analysis → local Refactor → minimum Testing → minimum Docs → Validator → update context`

**Infra / Deploy:**
`Context → Analysis → Infra → Security → Docs → Validator → update context`

## Router Decision Rules
- Repository state unclear → always route to Audit first.
- Contracts/interfaces/data flow change → Architecture required first.
- Backend and Frontend depend on each other → parallel only after Architecture defined contracts.
- Code unstable or needs structural cleanup → Testing waits for Refactor.
- Change is small and code already stable → Testing may run without explicit standalone Refactor.
- Security found unresolved CRITICAL or HIGH → Validator cannot return COMPLETE.
- Scope too large for one validated iteration → apply chunking before implementation.

## Security Mandatory vs Optional
**Mandatory when:** auth changes · permission logic changes · new endpoints · input validation changes · file upload · secrets/env handling changes · payment flows · sensitive data · user/session boundaries modified

**May be optional when:** purely visual · copy-only · layout-only · docs-only · no effect on logic, data, routes, auth, or runtime behavior

When in doubt → prefer running Security.

## Chunking — When to Split
Chunk the task if it:
- Touches 3+ major domains
- Requires Frontend + Backend + Infra to all change materially
- Introduces multiple contracts at once
- Has no clear validatable result
- Would overload the context window
- Cannot safely validate the outcome in one pass

**Good chunking:** vertical functional slices · validatable outputs · stable contracts between chunks · context updated after each chunk

**Bad chunking:** splitting only by frontend/backend · chunks that cannot be tested alone · unfinished fragments with no continuity rule

## Parallel Compatibility
| | Allowed |
|---|---|
| Backend + Frontend | ✅ Only after contracts are defined |
| Analysis for next module while Backend/Frontend implement current | ✅ |
| Docs for closed module while another is being built | ✅ |
| Security reviewing actively-changing code | ❌ |
| Validator before required skills finish | ❌ |
| Production Infra before Security | ❌ |
| Refactor in parallel with implementation of same module | ❌ |

## Skill Transition Signals
| From | To | Signal |
|---|---|---|
| Audit | Analysis | Recovery plan exists, project state is no longer guesswork |
| Analysis | Architecture | Scope bounded, affected modules known, risks listed, chunking decided |
| Architecture | Backend/Frontend | Contracts defined, data assumptions clear, decisions documented |
| Implementation | Refactor | Working code exists, rushed/debt-prone areas identified |
| Refactor | Testing | Code stable, regression-sensitive paths identified |
| Testing | Security | Minimum validation passed, auth/input-sensitive surfaces identified |
| Security | Infra/Docs/Validator | No unresolved CRITICAL or HIGH findings, or open risks explicitly recorded |
| Required skills | Validator | Handoffs exist, risks documented, route requirements satisfied |

## Scope Discipline
- Skills must not expand scope on their own.
- New dependencies, adjacent improvements, or interesting refactors → flagged, not silently absorbed.
- Out-of-scope improvements may only be included if the router explicitly re-scopes the iteration.

## Missing Context Rules
| Situation | Action |
|---|---|
| Core context missing | Do not guess silently |
| Implementation depends on unknown contracts | Return to Architecture |
| Architecture depends on unresolved requirements | Return to Analysis |
| Project state unclear | Route to Audit / Recovery |
| No safe bounded path forward | Return BLOCKED |

## Iteration Outcomes
- **COMPLETE** → scope met, validation passed, no blocking findings, docs updated, context updated.
- **PARTIAL** → meaningful value exists but dependency/risk/phase remains open. Requires pending items, open risks, next step, and context update.
- **BLOCKED** → critical context missing, architecture unresolved, security findings block progress, or no responsible path forward.

## Definition of Done
An iteration cannot be considered done unless:
1. Required skills for the route have finished.
2. Validator has run.
3. No unresolved CRITICAL or HIGH security findings remain.
4. Documentation is updated to the level required by the route.
5. `project.context.core.md` is updated.
6. A next step is recorded whenever the state is PARTIAL.
