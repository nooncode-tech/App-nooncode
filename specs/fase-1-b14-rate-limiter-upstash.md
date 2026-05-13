# spec.md — fase-1-b14-rate-limiter-upstash

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-13
- Session ID: fase-1-b14-rate-limiter-upstash
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-backend → system-testing → system-security (light) → system-infra → system-docs → system-validator
- Router mode: Refactor
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope B14 (rate-limiter migration from in-memory to distributed) so that `lib/server/api/rate-limit.ts` produces consistent rate-limiting decisions across concurrent Fluid Compute function instances on Vercel Production, without changing the rate-limit policies (limits / windows) or breaking any of the ~10 endpoints that already call `assertRateLimit`. Analysis only — no code edits in this session.
- Why this work matters now: the Active risk in `project.context.core.md` (line ~300) flags this as known production debt — the in-memory store resets on every cold start and is per-process, so under Fluid Compute concurrency the same client sees different "remaining quota" depending on which instance answers. With B18 closed and FASE 1 cutover (B1) deferred pending Checkout-in-App alignment, B14 is the most valuable production-hardening slice that does not depend on the Stripe cleanup or any cross-repo coordination.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: no (no contract changes, no architecture changes; the change is an internal swap behind an existing public API)
- `project.context.history.md` reviewed: no
- Reason `full` was included if applicable: not required — this iteration does not touch entity contracts, persisted data shape, or auth model.
- Reason `history` was included if applicable: not required.

### ROUTER DECISION
- Why this mode is correct: the iteration preserves observable rate-limit policy (same limits, same windows, same 429 behavior). What changes is the **engine** computing the decisions — that's structural quality work that does not alter observable behavior beyond a one-time correctness improvement. Refactor FULL fits because the change spans backend service code, infra (env vars + external service dependency), tests, and docs simultaneously.
- Why this depth is correct: Full because (a) the change adds a new production external dependency (Upstash Redis), (b) the env vars are sensitive (token gives Redis access), (c) the failure mode policy (fail-open) is a security decision that must be reviewed, and (d) `assertRateLimit` becoming async is a signature change that touches every caller.
- Why this skill is the right active skill now: nothing else can route until the affected-files inventory, the Upstash policy decisions (key shape, algorithm, fail-open vs fail-closed), and the async migration plan are explicit. Backend cannot implement without scope.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules".
- Contracts or architecture inputs available: existing `lib/server/api/rate-limit.ts` public API (the contract being preserved); `docs/tdrs/TDR-002-rate-limiting-in-memory.md` (the known-debt document being superseded).
- Relevant handoffs received: user confirmed B14 as next iteration on 2026-05-13 after deferring B1 (Stripe live keys cutover) due to the ADR-010 Checkout-in-App alignment scope.
- External dependencies or environment assumptions: Vercel Marketplace integration for Upstash Redis. `@upstash/ratelimit` and `@upstash/redis` are available on npm and stable. The Vercel knowledge update 2026-02-27 explicitly notes that Vercel KV is deprecated and Upstash is the recommended Marketplace option for Redis workloads.

### RISK SNAPSHOT
- Known risks before starting:
  - **Signature change.** `assertRateLimit` is currently synchronous. Upstash REST API is async, so the function must become async. All ~10 callers (verified via grep) live inside `async` route handlers, so adding `await` is mechanical. But every caller must be updated atomically with the refactor or `tsc` fails.
  - **Test determinism.** Current tests pass `nowMs` for deterministic windowing. Upstash's sliding window cannot be time-shifted from outside. The Upstash test path must mock at the SDK boundary; the in-memory test path keeps the existing `nowMs` injection.
  - **Fail-open policy is a real security decision.** If Upstash is unreachable, do we deny all rate-limited requests (fail-closed) or allow them with a warning (fail-open)? Recommendation in this spec: fail-open with warn-level logging. Rationale: rate-limit is smoothing, not auth — denying all traffic when Redis is down is worse than letting through traffic that may exceed the configured limit briefly. The decision is recorded in TDR-002 update.
  - **Free tier limits.** Upstash free tier is 10K commands/day. For FASE 1 internal pilot with low traffic, this is more than enough. Risk if traffic spikes unexpectedly. Mitigation: monitor and upgrade trigger.
- Known blockers before starting: none. Upstash provisioning is user-side ops; it does not block landing the spec or the code refactor (in-memory fallback covers the dev environment until Upstash exists in Production).
- Known assumptions before starting:
  - `@upstash/ratelimit` SDK is API-stable enough that a pinned minor version (^2.x current) does not break between patch upgrades during the FASE 1 window.
  - Upstash latency from the same region as the Vercel function is consistently <50ms p99. If measurements show >100ms p99, revisit.
  - Vercel's Marketplace auto-injection of `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` works as documented (verified by reading Vercel + Upstash docs; runtime verification happens during production verification).

### CONTINUITY NOTES
- Previous session relevant to this one: 2026-05-13 closed B18 (FASE 1 first iteration). The dev-server validation flagged "Slow filesystem detected" on `D:\` which is a separate operational observation; not related to B14.
- Expected next skill after this session if all goes well: system-backend, with the handoff payload below.

---

## Task Summary

Migrate `lib/server/api/rate-limit.ts` from an in-memory per-process Map to a distributed implementation backed by Upstash Redis (provisioned via Vercel Marketplace). The public API surface (`assertRateLimit`, `RateLimitExceededError`, `RateLimitOptions`, `resetRateLimitStoreForTests`) is preserved at the symbol level; the signature of `assertRateLimit` changes from synchronous to asynchronous (`async`). All ~10 caller endpoints are updated atomically. In-memory mode is kept as the dev-local fallback when Upstash env vars are not configured. A fail-open policy applies when Upstash returns errors at runtime, with `logger.warn` instrumentation so the operator can detect Upstash outages.

The work is one chunk, one PR. Approximately 4-5 hours of system-backend + light system-testing.

---

## Scope Boundary

### Included
- New dependencies: `@upstash/ratelimit` + `@upstash/redis` added to `package.json` and `pnpm-lock.yaml`. Pinned at the latest stable minor.
- Refactor of `lib/server/api/rate-limit.ts`:
  - `assertRateLimit` becomes `async`. Throws `RateLimitExceededError` on deny (preserves the existing error class and `retryAfterSeconds`).
  - Module-level branch on `process.env.UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` presence:
    - **Both set**: use `Ratelimit.slidingWindow(limit, windowMs)` with a single `Redis` client and namespaced keys (`<namespace>:<identity>`).
    - **Either missing**: continue to use the existing in-memory `Map` implementation (which stays valid for dev local + isolated tests).
  - Fail-open: if the Upstash call throws (network error, auth failure, quota exceeded), catch + `logger.warn('rate_limit.upstash.fallback', { namespace, identity, error })` + allow the request.
  - `NOON_RATE_LIMIT_DISABLED='true'` escape hatch preserved at the top (skip all logic).
  - `resetRateLimitStoreForTests()` preserved: clears the in-memory Map only. Upstash test path uses a mock that controls allow/deny directly (no real Redis touched in tests).
- All ~10 callers updated to `await assertRateLimit(...)`:
  - `app/api/client/comments/route.ts` (2 callsites)
  - `app/api/client/resolve/route.ts`
  - `app/api/integrations/website/inbound-proposal/route.ts`
  - `app/api/integrations/website/payment-confirmed/route.ts`
  - `app/api/maxwell/lead-searches/route.ts`
  - `app/api/maxwell/route.ts`
  - `app/api/payments/checkout/route.ts` (note: this route is itself an ADR-010 violation; updating its `assertRateLimit` does **not** absolve that violation — it stays as deuda, separate iteration)
  - `app/api/proposals/[proposalId]/open/route.ts`
  - `app/api/proposals/[proposalId]/review/route.ts`
  - `app/api/webhooks/stripe/route.ts`
- Update `tests/server/api/rate-limit.test.ts`:
  - Existing in-memory tests pass unchanged (with the `await` adjustment).
  - New suite for the Upstash code path using a module-level mock or DI seam:
    - Allow path
    - Deny path with `retryAfterSeconds`
    - Fail-open path (mock throws → request allowed + warning recorded)
- Update `.env.example`: add commented entries for `UPSTASH_REDIS_REST_URL=` and `UPSTASH_REDIS_REST_TOKEN=` with a comment explaining they are auto-injected by Vercel Marketplace.
- Update `scripts/validate-runtime-env.ts`: in production mode, warn (not fail) if Upstash env vars are missing. In dev mode, silent.
- Update `docs/tdrs/TDR-002-rate-limiting-in-memory.md`:
  - Rename file to `docs/tdrs/TDR-002-rate-limiting-distributed.md`, OR amend the existing file with a "Superseded by Upstash migration 2026-05-13" header at the top and keep the historical record. Decision deferred to system-backend during execution; both are acceptable.
  - New content covers the Upstash decision rationale, the fail-open policy, the in-memory fallback retention for dev, and the Vercel Marketplace provisioning path.
- Update `docs/context/project.context.core.md`:
  - **Remove** the Active risk on in-memory rate-limit (line ~300).
  - **Add** a Closed-in-runtime entry for B14 with the migration date, the env-var requirement, and the verification reference.
- Update `docs/context/project.context.history.md` at iteration close: Session note for B14.
- One PR against `develop`. Not merged by Claude.

### Excluded
- **Provisioning Upstash itself.** That is user-side ops: Vercel Dashboard → Storage → Add Marketplace integration → Upstash Redis → select region (preferentemente same as Function Region) → confirm Free tier. Vercel injects env vars automatically. This iteration ships the code path; the env vars arrive whenever the user is ready.
- **Changing the rate-limit policies** (limits, windows, namespaces). The current policies are preserved verbatim. Re-tuning is a separate concern post-cutover.
- **Per-user (auth identity) rate limiting.** Today's implementation uses client IP from forwarded headers. Switching to user-id keys is a policy decision, not an engine decision. Out of scope.
- **Edge runtime version of the rate-limit module.** All routes are currently `runtime = 'nodejs'`; the Upstash REST API works in both, but expanding to Edge is out of scope.
- **Observability dashboards / alerts** for rate-limit hits. `logger.warn` is sufficient for the iteration; richer dashboards are post-cutover polish.
- **Migrating other in-memory caches** (idempotency caches, dedupe tables) to Upstash. B14 is narrowly the rate-limiter only.
- **Removing the in-memory fallback.** It is intentional dev-mode behavior.
- **Real-card production verification.** That happens in operations after the PR merges and the user provisions Upstash via the Marketplace. Documented as next step in the spec's Success Criterion.

---

## Affected Files / Modules

| File | Type | Action |
|---|---|---|
| `lib/server/api/rate-limit.ts` | source | REFACTOR — add Upstash branch, keep in-memory fallback, make async |
| `tests/server/api/rate-limit.test.ts` | test | EDIT — add Upstash suite + fail-open test; `await` existing tests |
| `package.json` | manifest | ADD `@upstash/ratelimit`, `@upstash/redis` |
| `pnpm-lock.yaml` | lockfile | REGEN |
| `.env.example` | env stub | ADD Upstash vars with explanatory comment |
| `scripts/validate-runtime-env.ts` | infra | EDIT — warn (not fail) on missing Upstash in prod |
| `docs/tdrs/TDR-002-rate-limiting-in-memory.md` | doc | RENAME or AMEND (see Included) |
| `app/api/client/comments/route.ts` | source | EDIT — `await assertRateLimit(...)` (2 callsites) |
| `app/api/client/resolve/route.ts` | source | EDIT — `await` |
| `app/api/integrations/website/inbound-proposal/route.ts` | source | EDIT — `await` |
| `app/api/integrations/website/payment-confirmed/route.ts` | source | EDIT — `await` |
| `app/api/maxwell/lead-searches/route.ts` | source | EDIT — `await` |
| `app/api/maxwell/route.ts` | source | EDIT — `await` |
| `app/api/payments/checkout/route.ts` | source | EDIT — `await` (still violates ADR-010, untouched as architecture deuda) |
| `app/api/proposals/[proposalId]/open/route.ts` | source | EDIT — `await` |
| `app/api/proposals/[proposalId]/review/route.ts` | source | EDIT — `await` |
| `app/api/webhooks/stripe/route.ts` | source | EDIT — `await` |
| `specs/fase-1-b14-rate-limiter-upstash.md` | spec | NEW (this file) |
| `docs/context/project.context.core.md` | context | UPDATE at iteration close |
| `docs/context/project.context.history.md` | context | UPDATE at iteration close |

No migrations. No schema changes. No new API routes.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `@upstash/ratelimit` npm package | external | available | implementation cannot proceed | platform |
| `@upstash/redis` npm package | external | available | implementation cannot proceed | platform |
| `UPSTASH_REDIS_REST_URL` env var in Production | infra | pending (user provisions via Marketplace) | code falls back to in-memory in Production (defeats purpose, but no functional break) | user (ops) |
| `UPSTASH_REDIS_REST_TOKEN` env var in Production | infra | pending (user provisions via Marketplace) | same as above | user (ops) |
| `logger.warn` from `lib/server/api/logger.ts` | internal | available | fail-open path loses observability | this repo |
| `ApiError` class for `RateLimitExceededError` | internal | available | error path breaks | this repo |
| Existing test pattern (`node:test` + `node:assert/strict`) | internal | available | test refactor harder | this repo |

---

## Assumptions
1. `@upstash/ratelimit` sliding window algorithm matches the semantic intent of the current Map-based implementation closely enough that there is no observable change in policy. (The existing implementation is a fixed window per bucket; Upstash sliding window is more accurate but allows roughly the same traffic. Difference is sub-percent in practice and is documented in TDR-002 update as "intentional convergence with industry-standard sliding window".)
2. `process.env.UPSTASH_REDIS_REST_URL` / `_TOKEN` are read once at module load — they do not change at runtime. Vercel injects them at deploy time; the function reads them on cold start.
3. The fail-open policy is acceptable from a security standpoint for the rate-limited surfaces in question (no auth gate uses rate-limit alone — rate-limit is layered on top of role-based access and signature verification).
4. `logger.warn` is captured by Vercel native log streams (per the observability deferral risk recorded in PR #30); no Sentry is involved.
5. Vercel Marketplace integration creates `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (NOT a generic `REDIS_URL` connection string). The Upstash docs and SDK pattern confirm this.
6. The Upstash Free tier (10K commands/day) is sufficient for FASE 1 internal pilot traffic. Will be re-evaluated when traffic increases.

---

## Open Questions
None blocking. All design decisions resolved by this spec; downstream skills follow it verbatim.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| `@upstash/ratelimit` API drift between minor versions | low | medium (would require code fix) | low | Pin minor at install (`^2.x`); update only after reading changelog |
| Upstash latency exceeds 100ms p99 on production | medium | medium (adds tail latency to every rate-limited request) | medium | Measure during production verification; if confirmed, evaluate Region-pinned Upstash or move to in-memory + accept correctness loss |
| Fail-open masks a real Upstash outage | medium | low (rate-limit becomes briefly permissive, no security breach) | low | `logger.warn('rate_limit.upstash.fallback')` on every fallback; operator can manually grep Vercel logs |
| Free tier exhausted under traffic spike | low (during FASE 1) | medium (rate limiter starts failing-open silently — see above) | medium | Free tier upgrade trigger documented in TDR-002 |
| Module-level env-var read prevents test isolation if Upstash mocking happens after module load | medium | low (would only affect tests, not production) | low | Use `vi.mock` equivalent (Node `mock.module` from `node:test`) or factor out the engine into a function that reads env on-demand |
| `assertRateLimit` async signature broken caller (forgot `await`) | low | low (TS catches it as "Promise<void> is not assignable to void" or runtime async leak) | low | `tsc --noEmit` is mandatory in CI; PR cannot merge with broken types |
| Adding deps trips `pnpm audit` on a transitive CVE | low | low | low | Run `pnpm audit --prod --audit-level=high` before opening PR |

---

## Recommended Route Depth (Full / Lite)
**Full.** The change introduces a new external production dependency, touches secrets handling, requires updating ~10 caller files atomically, and the fail-open decision is a security-policy decision that must be reviewed (light Security skill pass).

---

## Chunking Decision
**One chunk, one PR.** Per `Plan agent` chunking rules: although the change touches 3 domains (backend service, infra/env, tests), they are tightly coupled and inseparable — splitting into "backend refactor first, callers second, tests third" creates a sequence of broken PRs that don't compile until all three land. The whole iteration validates as one cohesive PR.

---

## Success Criterion
The iteration is COMPLETE when **all** of the following are true:

1. `@upstash/ratelimit` and `@upstash/redis` are in `package.json` and `pnpm-lock.yaml`.
2. `lib/server/api/rate-limit.ts`:
   - `assertRateLimit` is `async` and returns `Promise<void>` (resolves on allow, rejects on deny with `RateLimitExceededError`).
   - At module load, branches on Upstash env-var presence: enabled when both present, fallback to in-memory otherwise.
   - Fail-open policy active: catches Upstash errors, logs via `logger.warn`, allows the request through.
   - In-memory path preserves the current `Map`-based fixed-window behavior bit-for-bit (tests confirm).
   - `NOON_RATE_LIMIT_DISABLED='true'` escape hatch still works.
   - `resetRateLimitStoreForTests` still clears the in-memory Map (Upstash tests use boundary mock).
3. All ~10 callers updated to `await assertRateLimit(...)` (verified by grep search for `assertRateLimit(` without preceding `await` returning zero hits in `app/`).
4. `tests/server/api/rate-limit.test.ts`:
   - All existing in-memory tests pass (with `async/await` adjustment).
   - New Upstash suite covers allow + deny + fail-open paths.
   - `pnpm test` reports green (target: 205 baseline + N new tests, no regression).
5. `pnpm run typecheck` clean.
6. `pnpm run lint` clean.
7. `pnpm run build` succeeds without warnings about unresolved Upstash imports.
8. `pnpm audit --prod --audit-level=high` clean.
9. `.env.example` includes commented Upstash vars + explanatory note.
10. `scripts/validate-runtime-env.ts` warns (not fails) when Upstash vars are missing in production.
11. `docs/tdrs/TDR-002-...` updated/superseded with the migration rationale, fail-open policy, and Vercel Marketplace provisioning path.
12. `project.context.core.md`:
    - Active risk on rate-limiter removed.
    - Closed-in-runtime entry added.
13. `project.context.history.md`: Session note for B14 added.
14. system-validator returns COMPLETE based on this checklist.

Out of scope for the COMPLETE verdict (but documented as next steps):
- Production verification with real Upstash provisioning + traffic — happens post-merge in user-side ops.
- Real-traffic latency measurement — same.

---

## Handoff payload to system-backend

- **Task summary**: implement the rate-limit refactor per the file table. Match existing code style (TS strict, named exports, no default exports). Reuse `logger` and `ApiError` infrastructure.
- **Scope boundary**: see "## Scope Boundary" above.
- **Affected files/modules**: see "## Affected Files / Modules" above.
- **Dependencies**: see "## Dependencies" above.
- **Assumptions**: assumptions 1-6 above. Validate assumption #1 (Upstash sliding window vs Map-based fixed window equivalence) by running the existing in-memory tests against the new code path and confirming bit-for-bit pass.
- **Open questions**: none blocking.
- **Risks that may alter design**: the module-level env-var read risk (R5 in the Risks table) is the most likely source of design adjustment — system-backend may decide to lazy-initialize the Upstash client inside the function so tests can mock env vars per-test. That is acceptable.
- **Recommended depth**: Full.
- **Chunking decision**: one chunk, one PR. Do NOT split into "backend first, callers second" — they must land together to keep types valid.
- **Success criterion**: see "## Success Criterion" above.
- **Spec location**: `specs/fase-1-b14-rate-limiter-upstash.md` (this file).

---

## Forbidden constraints carried forward
- Auto-merging the resulting PRs (spec PR and implementation PR).
- Introducing R-codes / Sprint numbers / plan-IDs into `docs/context/*` or any durable repo doc or code comment or commit message or PR body.
- Using absolute local filesystem paths in docs, commit messages, or PR body.
- Changing the rate-limit policies (limits / windows / namespaces). Engine swap only.
- Removing the in-memory fallback. It is intentional dev-mode behavior.
- Adding new dependencies beyond `@upstash/ratelimit` and `@upstash/redis`.
- Modifying `app/api/payments/checkout/route.ts` beyond adding `await` to `assertRateLimit`. That route is itself ADR-010 deuda and B14 explicitly does not address it.
- Wiring Sentry / external telemetry into the fail-open path. `logger.warn` is the agreed observability for FASE 1.

---

## Spec lifecycle
- Status: **Approved (Analysis output)**; ready to route to system-backend.
- Author: system-analysis (Pedro acting as Analysis in this session)
- Date: 2026-05-13
- Supersedes: nothing
- Superseded by: nothing
