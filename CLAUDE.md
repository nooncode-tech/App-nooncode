# CLAUDE.md — nooncode-app

## Agent skill system

This project uses a structured multi-agent workflow. All agents live in `.claude/agents/`. Each agent defines its own purpose, authority, rules, and handoff payload.

| Agent | Role |
|---|---|
| `router` | Entry point — decides mode, depth, route, and order |
| `system-analysis` | Scopes the iteration before architecture or implementation |
| `system-architecture` | Converts bounded scope into implementable technical design |
| `system-audit` | Diagnoses inherited, incomplete, or unclear repositories |
| `system-backend` | Implements server-side behavior against defined contracts |
| `system-frontend` | Implements UI behavior against defined contracts |
| `system-refactor` | Cleans implementation without changing observable behavior |
| `system-testing` | Validates changed behavior and protects regression paths |
| `system-security` | Reviews risk surfaces and gates release readiness |
| `system-infra` | Ensures build, runtime, and deploy behavior is explicit and safe |
| `system-docs` | Keeps documentation aligned with implemented reality |
| `system-validator` | Final gate — produces COMPLETE, PARTIAL, or BLOCKED verdict |
| `project-context` | Defines the three-layer context system and its update rules |
| `session-templates` | Mandatory start/close templates for formal sessions |

## Session discipline

1. Start every session by reading `project.context.core.md` as default context.
2. Load `project.context.full.md` only for Recovery, Architecture, Validator, deep Security, or deep Infra.
3. Use the `router` agent to select the correct execution route.
4. Follow the active agent's rules strictly — do not invent contracts or expand scope.
5. No iteration is complete until `system-validator` has run and `project.context.core.md` is updated.

## Local source of truth

| File | Purpose |
|---|---|
| `project.context.core.md` | Default operating context for normal sessions |
| `project.context.full.md` | Deep architecture, contracts, conventions, and structural truth |
| `project.context.history.md` | Accumulated session history and prior decisions |

If these files are missing, stale, or contradictory — surface that explicitly instead of guessing.

## Completion policy

No work is COMPLETE unless:
- The scoped success criterion is satisfied.
- `system-validator` has run and returned COMPLETE.
- `project.context.core.md` is updated.
- Unresolved risks are explicitly recorded.

If evidence is incomplete, mark the work PARTIAL or BLOCKED.
