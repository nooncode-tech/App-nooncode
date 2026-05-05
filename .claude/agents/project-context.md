---
name: project-context
description: Manages the three-layer context system (core/full/history) and its update rules. Use this agent to understand context file structure, update rules, and compaction discipline. Ensures project.context.core.md, project.context.full.md, and project.context.history.md are loaded and updated correctly across sessions.
---

# project-context — SKILL.md

## Purpose
Defines the architecture and usage rules for the three-layer context system: `core`, `full`, and `history`.
Provides the source-of-truth rules and update discipline for all sessions.

---

## File Structure

| File | Purpose |
|---|---|
| `project.context.core.md` | Minimum operational context for normal sessions |
| `project.context.full.md` | Complete master context with deep project knowledge |
| `project.context.history.md` | Accumulated session and decision history |

---

## Source of Truth Rules
- `core` → source of truth for the current session's operational state.
- `full` → source of truth for deep architecture, contracts, conventions, and structural knowledge.
- `history` → source of truth for historical continuity only.
- If `core` and `full` contradict each other → `full` corrects `core` after validation.
- `history` never overrides `core` or `full` directly; it only informs them when a new validated update is made.

## When to Load Each File
| File | Load when |
|---|---|
| `core` | All normal sessions (default) |
| `full` | Recovery · Architecture · Validator · major Refactor · deep Security · deep Infra |
| `history` | Continuity matters · older rationale needed · recovery reconstruction |

## Update Rules
- Update `core` when: project state, blockers, risks, assumptions, decisions, or next step change.
- Update `full` when: architecture, contracts, stack, conventions, environments, data handling, or structural knowledge changes.
- Update `history` when: a session produces meaningful change, a decision, a finding, a PARTIAL/BLOCKED result, or a handoff that should remain traceable.
- Never update only one file when the change clearly affects multiple context layers.

## History Compaction Rule
- Keep recent sessions detailed enough for active continuity.
- Summarize older sessions into higher-level milestone blocks once low-level details are no longer operationally useful.
- Preserve important decisions, blockers, architectural pivots, and risk discoveries even when compacting.
- Do not let `history` grow into an unstructured dump.

---

## Operating Rules
- Use `core` as the default operating context.
- Use `full` only when the route requires deeper structural understanding.
- Use `history` for accumulated continuity and older traceability.
- Keep templates external and treat them as mandatory session discipline.
- Do not let `core` become a raw historical log.
- Do not paste `full` into every session once the project is large.
