# Skill Registry — nooncode-app

## Project Conventions

| File | Purpose |
|------|---------|
| CLAUDE.md | Project agent system, session discipline, context files |
| .claude/agents/ | Agent definitions (router, system-*, project-context, session-templates) |
| project.context.core.md | Default operating context |
| project.context.full.md | Deep architecture + contracts |
| project.context.history.md | Session history + prior decisions |

## User Skills

| Skill | Triggers |
|-------|---------|
| branch-pr | Creating PRs, pull request workflow |
| dependency-updater | Updating dependencies with target versions |
| go-testing | Go tests, Bubbletea TUI testing |
| judgment-day | Adversarial dual review |
| req-analysis | Analyze requirements, generate TDR/feature files, update Jira |
| skill-creator | Create new AI skills |
| sdd-explore / sdd-propose / sdd-spec / sdd-design / sdd-tasks / sdd-apply / sdd-verify / sdd-archive | SDD phases |
| issue-creation | Create GitHub issues |
| release-summary | Build release messages |

## Compact Rules

### API Routes (app/api/**/*.ts)
- All GET handlers MUST validate session via `getAuthenticatedPrincipal` or equivalent
- Return `NextResponse.json` with consistent shape `{ data, meta }` or error `{ error }`
- Zod-validate all query params before use
- Rate-limit write routes via `assertRateLimit`

### Server lib (lib/server/**/*.ts)
- Repository functions accept a Supabase client as first arg
- Never import from `lib/data-context` in server code
- All DB queries go through `lib/server/` — no raw supabase calls in route handlers

### Tests (tests/**/*.test.ts)
- Use Node built-in `node:test` + `node:assert`
- Test files mirror the source path under `tests/`
- No mocking of Supabase client — use real client with test credentials or fixtures
