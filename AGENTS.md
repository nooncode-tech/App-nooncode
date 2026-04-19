# AGENTS.md

This repository uses a structured multi-agent skill system defined in `.claude/agents/`.
Project-specific truth lives locally in this repo and must take precedence over generic assumptions.

## Agent index

| Agent | File | Role |
|---|---|---|
| router | `.claude/agents/router.md` | Entry point — decides mode, depth, route, and order |
| system-analysis | `.claude/agents/system-analysis.md` | Scopes the iteration before architecture or implementation |
| system-architecture | `.claude/agents/system-architecture.md` | Converts bounded scope into implementable technical design |
| system-audit | `.claude/agents/system-audit.md` | Diagnoses inherited, incomplete, or unclear repositories |
| system-backend | `.claude/agents/system-backend.md` | Implements server-side behavior against defined contracts |
| system-frontend | `.claude/agents/system-frontend.md` | Implements UI behavior against defined contracts |
| system-refactor | `.claude/agents/system-refactor.md` | Cleans implementation without changing observable behavior |
| system-testing | `.claude/agents/system-testing.md` | Validates changed behavior and protects regression paths |
| system-security | `.claude/agents/system-security.md` | Reviews risk surfaces and gates release readiness |
| system-infra | `.claude/agents/system-infra.md` | Ensures build, runtime, and deploy behavior is explicit and safe |
| system-docs | `.claude/agents/system-docs.md` | Keeps documentation aligned with implemented reality |
| system-validator | `.claude/agents/system-validator.md` | Final gate — produces COMPLETE, PARTIAL, or BLOCKED verdict |
| project-context | `.claude/agents/project-context.md` | Defines the three-layer context system and its update rules |
| session-templates | `.claude/agents/session-templates.md` | Mandatory start/close templates for formal sessions |

## Repository rules

- Follow the real project stack, file structure, and conventions already present in this repository.
- Do not invent architecture, contracts, or flows that are not supported by the code or project context.
- Prefer small, bounded iterations over broad speculative changes.
- Keep user-visible behavior, auth rules, and data semantics explicit.
- If scope is unclear, route to `system-analysis` or `system-audit` before implementation.
- If contracts, boundaries, or data flow are unclear, route to `system-architecture` before implementation.
- If behavior changes, validation is required via `system-validator` before claiming completion.
- If auth, permissions, secrets, sensitive data, runtime, or deploy behavior changes, `system-security` and/or `system-infra` review are required.
- Docs must reflect implemented reality, not intention.

## Local source of truth

Use these local files as the primary repo-specific context:

- `project.context.core.md`
- `project.context.full.md`
- `project.context.history.md`

## Context usage

- Use `project.context.core.md` as the default operating context for normal work.
- Use `project.context.full.md` when architecture, contracts, infra, security, or deeper repository truth is needed.
- Use `project.context.history.md` for continuity across sessions, prior decisions, and deferred work.
- If these files are missing, stale, or contradictory, surface that explicitly instead of guessing.

## Skill routing policy

- Use one primary agent per session or phase.
- Reroute when the nature of the work materially changes.
- Do not mix architecture, implementation, validation, and audit into one blurred pass unless the route explicitly requires it.

## Completion policy

No work should be considered COMPLETE unless the scoped success criterion is satisfied and the relevant validation evidence exists.
If evidence is incomplete, mark the work PARTIAL or BLOCKED rather than overstating progress.

