---
name: session-templates
description: Provides mandatory opening and closing templates for all formal sessions. Use this agent to structure session metadata, scope, context used, router decision, risk snapshot, work completed, findings, and next steps. Both templates are required for formal sessions — the start template before work begins, the close template before declaring the session done.
---

# session-templates — SKILL.md

## Purpose
Provides the standard opening and closing templates for all formal sessions.
Both templates are mandatory when running a formal session. They are aligned with the refined context model (`core` / `full` / `history`), router mode, Full/Lite depth, skill ownership, reroute discipline, and Validator outcomes.

Opening and closing a session do not serve the same purpose:
- **Start template** → defines scope, mode, depth, context used, and risks before work begins.
- **Close template** → defines outcome, what changed, what remains open, and how context files must be updated.

---

## template-session-start.md

```markdown
# template-session-start.md
> Use this when opening a formal session.

## SESSION METADATA
- Date:
- Session ID:
- Developer:
- Main active skill:
- Router mode: New Build / Recovery / Bugfix / Refactor / Infra-Deploy
- Depth: Full / Lite

## OBJECTIVE
- What must be achieved in this session:
- Why this work matters now:

## CONTEXT USED
- `project.context.core.md` reviewed: yes / no
- `project.context.full.md` reviewed: yes / no
- `project.context.history.md` reviewed: yes / no
- Reason `full` was included if applicable:
- Reason `history` was included if applicable:

## ROUTER DECISION
- Why this mode is correct:
- Why this depth is correct:
- Why this skill is the right active skill now:
- Reroute already known at start: yes / no
- If yes, explain:

## SCOPE
- In scope:
- Explicitly out of scope:
- Success criterion:

## INPUTS
- Files/modules involved:
- Contracts or architecture inputs available:
- Relevant handoffs received:
- External dependencies or environment assumptions:

## RISK SNAPSHOT
- Known risks before starting:
- Known blockers before starting:
- Known assumptions before starting:

## CONTINUITY NOTES
- Previous session relevant to this one:
- Expected next skill after this session if all goes well:
```

---

## template-session-close.md

```markdown
# template-session-close.md
> Use this when closing a formal session.

## SESSION METADATA
- Date:
- Session ID:
- Developer:
- Main active skill:
- Router mode used:
- Depth used: Full / Lite

## FINAL OUTCOME
- Outcome: COMPLETE / PARTIAL / BLOCKED
- Why this outcome is correct:

## WORK COMPLETED
- Main work completed:
- Files changed:
- Modules/screens/services/endpoints/contracts touched:
- Skills involved through handoff or escalation:

## FINDINGS AND DEBT
- Risks discovered or updated:
- Blockers discovered or updated:
- Technical debt discovered or updated:
- Security debt or documentation debt if relevant:
- Test debt if relevant:

## REROUTES / ESCALATIONS
- Did this session require reroute: yes / no
- If yes, to which skill(s):
- Why:

## TRUTH CHANGES
- Did architecture truth change? yes / no
- Did contracts change? yes / no
- Did env/runtime assumptions change? yes / no
- Did operational usage/setup truth change? yes / no

## CONTEXT UPDATE PLAN
- Update `project.context.core.md`: what changes go there?
- Update `project.context.full.md`: what changes go there?
- Update `project.context.history.md`: what changes go there?

## NEXT STEP
- Recommended next skill:
- Recommended next router mode:
- Recommended next depth:
- Inputs the next session will need:
- What must be true before the next session begins:

## HANDOFF SUMMARY
- One short summary another developer can use immediately:
```

---

## Operating Rules
- Both templates are mandatory for formal sessions.
- The start template must be filled before the active skill begins.
- The close template must be filled before declaring the session done.
- Context files (`core`, `full`, `history`) must be updated based on the close template's Context Update Plan.
- These templates are kept outside the main context files to avoid adding instructional boilerplate to operational memory.
