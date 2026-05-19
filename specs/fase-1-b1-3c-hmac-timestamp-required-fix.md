# spec.md — fase-1-b1-3c-hmac-timestamp-required-fix

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-18
- Session ID: fase-1-b1-3c-hmac-timestamp-required-fix
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec). Downstream chain prescribed by router: system-backend (surgical patch) → system-testing (regression test + full suite) → system-security (HMAC surface review, mandatory because this is an auth change) → system-docs (context.core + roadmap update + B1.5 unblock notice) → system-validator (COMPLETE / PARTIAL / BLOCKED). Architecture skipped — no contract change. Refactor skipped — fix REMOVES dead conditional branches; no separate refactor pass needed. Infra skipped — no env, no migration, no deploy changes beyond merging the PR.
- Router mode: Bugfix.
- Depth: Full.

### OBJECTIVE
- What must be achieved in this session: produce the authoritative spec for the **surgical fix** of the HMAC timestamp-required bug surfaced as Finding F-1 in the B1.3b inbound smoke (2026-05-18). The fix forces `lib/server/website-webhook-auth.ts` to reject requests missing `x-noon-timestamp` per cross-repo contract §2.3 step 2, instead of silently falling back to signing/verifying over `bodyText` alone. Spec only — no code, no tests, no security review in this session. The spec is the input artifact for system-backend to pick up.
- Why this work matters now: B1.3b closure (2026-05-18) returned COMPLETE-WITH-FOLLOW-UPS with **B1.5 pilot sign-off explicitly BLOCKED on this fix landing**. Scenario 3d empirically demonstrated that a NoonWeb-side sender (or any attacker who learned the shared secret transiently) can omit the timestamp header, sign over raw body only, and have the App accept the request with HTTP 201. That defeats the §2.3-mandated ±5-minute replay window for any actor that knows the secret, and silently violates the documented contract. Patching the receiver is a one-file, two-line change; the cost of NOT shipping it before B1.5 is leaving a known auth divergence in production with audit evidence already published in `docs/validations/`.

### CONTEXT USED
- `project.context.core.md` reviewed: yes (Closed-in-runtime B1.3b entry + Active risks F-1 entry + Operating rule for HMAC auth + spec-as-contract discipline).
- `project.context.full.md` reviewed: no — this iteration changes neither the contract nor the architecture. The contract (`cross-repo-webhook-v1.md` §2.3) ALREADY mandates the correct behavior; the code is what is wrong. Full context is not required for a code-side conformance fix.
- `project.context.history.md` reviewed: partial (B1.3b closure 2026-05-18 is the predecessor session whose Finding F-1 is the bug under repair).
- Reason `full` was included if applicable: not required.
- Reason `history` was included if applicable: B1.3b is the iteration that empirically surfaced F-1; its evidence document is the load-bearing input for "why this fix exists." Without referencing the B1.3b Scenario 3d row evidence, the spec would have to invent a justification — and that would violate the Analysis Ambiguity Rule.

### ROUTER DECISION
- Why this mode is correct: Bugfix because (a) the code path is documented as wrong vs the existing v1 contract — the contract is the authority and the code is the deviation; (b) no new feature, no contract change, no design decision is required (Architecture skip); (c) the fix is bounded to one file with two mechanical changes; (d) the failure is reproducible and the fix is verifiable by a single new unit test plus the existing suite staying green.
- Why this depth is correct: Full because (a) the change is in the auth/security boundary of an integration receiver, which triggers system-security as MANDATORY (per skill description: "Mandatory when auth, permissions, endpoints, validation, file uploads, secrets, payments, or sensitive data change"); (b) the fix unblocks B1.5 pilot sign-off, so docs propagation must happen; (c) Lite would skip the security pass and lose traceability of the auth-surface change.
- Why this skill is the right active skill now: nothing else can route until (a) the bug is restated in operational terms vs the contract reference, (b) the affected files are mapped, (c) the test approach is decided (TDD-friendly because the new failing test exists in concept before the patch), (d) the regression-protection criteria are explicit, (e) the rollout (merge + Vercel auto-deploy) is acknowledged as the post-validator step. system-backend cannot start before this spec is Approved per Definition of Ready.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules" below.
- Contracts or architecture inputs available:
  - `docs/integrations/cross-repo-webhook-v1.md` §2.3 — "The receiver MUST: 2. Verify `x-noon-signature` header is present. Reject `401` if missing. 3. Verify `x-noon-timestamp` is within ±5 minutes of receiver's current time (`MAX_CLOCK_SKEW_SECONDS = 300`). Reject `401` if outside window." AND "The receiver MUST NOT: Accept requests without the timestamp header (even if signature alone matches)." This is the binding obligation.
  - `specs/fase-1-b1-3b-inbound-smoke-cross-repo.md` §Open Questions Q2 — divergence already pre-registered before the smoke executed; the smoke confirmed it.
  - `docs/validations/B1.3b inbound smoke 2026-05-18.md` §Finding F-1 — empirical evidence (HTTP 201 row created in production with `external_session_id='sess_b13b_smoke_3d_002'`, link id `9f5d15ee-73e4-4554-baa7-e399466d6815`).
- Relevant handoffs received from router:
  - Bugfix mode, Full depth, single iteration.
  - Mandatory chain: Analysis → Backend → Testing → Security → Docs → Validator.
  - Spec must enumerate the exact code surface to be patched without designing the fix in full detail (Backend authority).
  - Spec must explicitly EXCLUDE: NoonWeb-side patch (different repo), contract amendment (§2.3 already correct), HMAC helper refactor beyond the surgical fix, operative tasks post-merge.
  - Success criterion must include: request without `x-noon-timestamp` → HTTP 401 with `code=WEBSITE_WEBHOOK_AUTH_FAILED` and body `error: 'Missing webhook timestamp.'`; existing tests stay green; type-check + lint + build clean.
- External dependencies or environment assumptions: none. No env var, no migration, no infra change. The Vercel auto-deploy on PR merge is the standard release path — not load-bearing on this spec.

### RISK SNAPSHOT
- Known risks before starting: see "## Risks" below for the classified register.
- Known blockers before starting: none. The bug is reproduced, the code path is identified, the fix shape is mechanical, and the existing test infrastructure (`node:test` + `tsx --test`) is already in place per `tests/server/website-webhook-auth.test.ts`.
- Known assumptions before starting:
  - The current `lib/server/website-webhook-auth.ts` HEAD on develop matches the file inspected during B1.3b code review (verified at the start of this spec session via Read). If develop has moved between B1.3b closure and this spec session, the patch surface remains the same because no merged PR touched this file.
  - The existing test suite passes on develop pre-patch (last verified green by B1.4 closure 2026-05-17 with 231/231). The patch must keep all existing tests passing AND add one new test.
  - The NoonWeb-side sender (callers in production) always sets `x-noon-timestamp` when signing (because `signWebsitePayload` in this same file always emits it). The patch rejecting null timestamps therefore does NOT regress any legitimate inbound traffic — only requests that are already non-conformant to §2.3.

### CONTINUITY NOTES
- Previous session relevant to this one: B1.3b closure 2026-05-18 (`docs/validations/B1.3b inbound smoke 2026-05-18.md`) surfaced F-1 via Scenario 3d and explicitly scoped a child iteration with this exact name. The Recommended reroute line in F-1's findings table says verbatim: "Child iteration `fase-1-b1-3c-hmac-timestamp-required-fix` (task #14 pending) — patch `assertRecentTimestamp` to reject null, force `signedPayload = ${timestamp}.${bodyText}` always, regression-test in `tests/server/website-webhook-auth.test.ts`. MUST land before B1.5 pilot sign-off."
- Expected next skill after this session if all goes well: system-backend applies the surgical patch per `## Affected Files / Modules` below. Then system-testing adds the unit test and runs the full suite. Then system-security reviews the auth surface change (~10 minutes review). Then system-docs updates context.core + roadmap. Then system-validator gates COMPLETE.

---

## Task Summary

Patch `lib/server/website-webhook-auth.ts` so that an inbound webhook request whose `x-noon-timestamp` header is absent is rejected with HTTP 401 and a `WebsiteWebhookError('Missing webhook timestamp.')`, instead of silently signing/verifying over `bodyText` alone. The fix is the App-side conformance correction to `cross-repo-webhook-v1.md` §2.3 step 2, which already mandates the correct behavior. The patch is two surgical edits in one file plus one new unit test asserting the rejection path. No contract change, no architecture change, no NoonWeb-side change. The deliverable of this iteration is the PR + merge + Vercel auto-deploy that closes Finding F-1 from the B1.3b inbound smoke (2026-05-18) and unblocks B1.5 pilot sign-off.

---

## Scope Boundary

### Included
- **Patch 1 — `assertRecentTimestamp` rejects null/empty timestamp.**
  - File: `lib/server/website-webhook-auth.ts`, function at lines 30-42.
  - Current behavior: `if (!timestamp) return` — silently allows callers without the header to bypass the recent-timestamp guard.
  - Required behavior post-patch: throw `WebsiteWebhookError('Missing webhook timestamp.')` (status 401, the class default) when `timestamp` is null or empty. The remainder of the function (parse Number, finite check, ±300s window) stays unchanged.
  - Constraint: function signature `(timestamp: string | null)` can stay as-is OR be tightened to `(timestamp: string)` with the null guard moved to the caller. Backend authority to choose the cleaner of the two; both achieve the contract. Spec does NOT prescribe.
- **Patch 2 — `verifyWebsiteWebhookSignature` simplifies signedPayload computation.**
  - File: same, function at lines 55-71.
  - Current behavior: `const signedPayload = timestamp ? `${timestamp}.${bodyText}` : bodyText` — defensive ternary that becomes dead code once Patch 1 lands (because `assertRecentTimestamp` will have thrown if timestamp is null).
  - Required behavior post-patch: signedPayload is unconditionally `${timestamp}.${bodyText}`. The ternary is removed. If Backend chose to tighten `assertRecentTimestamp`'s signature in Patch 1 (string-only param), a non-null assertion or local re-bind may be needed here for the type-checker — Backend authority on style; only the runtime behavior is specified.
- **Test 1 — new unit test in `tests/server/website-webhook-auth.test.ts`.**
  - Asserts: a `Headers` object containing `x-noon-signature` (computed over `bodyText` alone, no timestamp prefix) but NOT containing `x-noon-timestamp` causes `verifyWebsiteWebhookSignature` to throw `WebsiteWebhookError` with `message === 'Missing webhook timestamp.'`.
  - Optional sub-assertion: the thrown error's `status` property equals `401`. (Already implied by the default in the class constructor, but explicit-better-than-implicit.)
  - The test sets `process.env.NOON_WEBSITE_WEBHOOK_SECRET = 'unit-secret'` consistently with the existing tests in the file (lines 19, 27, 47, 64). It does NOT touch any other test or any test infrastructure.
- **Test suite stays green.** All 5 existing tests in `tests/server/website-webhook-auth.test.ts` must continue to pass post-patch:
  - "website webhook signature verifies signed payloads"
  - "website webhook signature rejects tampered payloads"
  - "website webhook signature requires the shared secret"
  - "website webhook signature rejects stale timestamps"
  - "readSignedWebsiteJson validates JSON through the supplied schema"
  - And the full project test suite (231/231 from B1.4 closure) must remain green or +1 new test = 232/232.
- **PR description includes:**
  - Reference to spec path `specs/fase-1-b1-3c-hmac-timestamp-required-fix.md`.
  - Reference to bug Finding F-1 in `docs/validations/B1.3b inbound smoke 2026-05-18.md`.
  - Reference to contract §2.3 of `docs/integrations/cross-repo-webhook-v1.md`.
  - Note that B1.5 pilot sign-off was blocked on this fix.

### Excluded
- **NoonWeb-side mirror of this fix.** The NoonWeb repo (`noon-main`) very likely has a symmetric bug in its `proposal-review-decision` receiver because both sides of the wire were written against the same (loose) interpretation. Patching the NoonWeb side is the responsibility of the NoonWeb dev in the `noon-main` repo and is NOT in scope for this iteration. system-security may emit a finding recommending a parallel NoonWeb-side fix; that finding becomes a follow-up task, not part of this spec's completion.
- **Contract amendment to `cross-repo-webhook-v1.md`.** §2.3 already says the correct thing. The contract is not edited in this iteration.
- **Refactor of the HMAC helper module beyond the surgical fix.** Renaming functions, splitting the module, introducing a Zod schema for headers, adding rate-limiter integration to this file, or any other "while we're here" cleanup is explicitly out of scope. If Refactor judgment is warranted, the Refactor skill opens its own iteration after this one closes.
- **Operational tasks post-merge:**
  - Opening / merging the PR (operator's call, not the spec's concern).
  - Re-firing Scenario 3d against production post-deploy to verify the fix landed (that is a runtime validation, optional, owner = Pedro; system-validator may require evidence of the re-test OR accept the unit-test evidence as sufficient — see §Success Criterion below for what validator gates on).
  - Deploy monitoring, log inspection, or rollback procedure (no rollback procedure is defined because the patch cannot regress legitimate traffic — all production callers already send the timestamp).
- **Cleanup of the B1.3b smoke evidence row `9f5d15ee-...` from Scenario 3d.** That row is part of the B1.3b evidence trail and was explicitly left in DB for traceability per B1.3b §Observations 1. Removing it is a separate operational decision, not part of this fix.
- **B1.5 pilot sign-off itself.** This iteration UNBLOCKS B1.5 (by closing the blocking F-1 finding); it does not execute B1.5. B1.5 is its own future iteration with its own spec.
- **Documentation of the HMAC protocol elsewhere** (e.g., `docs/architecture/`, ADRs). The protocol is already documented in `cross-repo-webhook-v1.md`. No new ADR is required because no architectural decision is being made — the code is being made conformant to a documented decision.
- **Migration changes.** None. The patch is pure code in TypeScript; no schema touches.

---

## Affected Files / Modules

### Files modified (Backend skill)
- `lib/server/website-webhook-auth.ts` — exact change surface:
  - **Lines 30-42** — `assertRecentTimestamp` early-return on null replaced with a throw.
  - **Line 65** — `signedPayload` ternary simplified to unconditional `${timestamp}.${bodyText}`.
  - Function signature of `assertRecentTimestamp` may be tightened from `(timestamp: string | null)` to `(timestamp: string)` at Backend discretion; if so, the corresponding call site at line 63 must move the null-check there. Net behavior identical either way.
  - No other line in the file is touched. `readSharedSecret`, `normalizeSignature`, `timingSafeEquals`, `readSignedWebsiteJson`, `getProposalReviewDecisionWebhookUrl`, `signWebsitePayload` are all unchanged.

### Files modified (Testing skill)
- `tests/server/website-webhook-auth.test.ts` — append one new test case asserting the rejection-on-missing-timestamp behavior. Existing 5 test cases remain untouched (no edits to their bodies, no renames).

### Files NOT modified (explicit non-touch list, for the avoidance of doubt)
- `app/api/integrations/website/inbound-proposal/route.ts` — caller of `readSignedWebsiteJson`; behavior change is transparent to it (a different reject reason flows through the existing 401 path).
- `app/api/integrations/website/payment-confirmed/route.ts` — same as above.
- `app/api/proposals/[proposalId]/review/route.ts` — outbound sender path; not affected.
- `lib/server/website-integration.ts` — schemas and handlers; outbound sender uses `signWebsitePayload` which always emits the timestamp; not affected.
- `docs/integrations/cross-repo-webhook-v1.md` — contract; says the correct thing already; not touched.
- Any test file other than `tests/server/website-webhook-auth.test.ts` — no other suite needs adjustment.
- Any migration in `supabase/migrations/` — none.
- Any env var, deploy hook, or Vercel project setting — none.

### Database surfaces
- No reads, no writes. The fix is in-memory request validation only.

### External systems touched
- None during this iteration. The Vercel auto-deploy on PR merge is the standard release path, owned outside the spec.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `docs/integrations/cross-repo-webhook-v1.md` §2.3 contract clause | contract | Stable, last verified 2026-05-18 in B1.3b smoke | Without §2.3 as authority, the fix has no justification. The contract IS the spec for what the code must do. | Both repos (App + NoonWeb) |
| `docs/validations/B1.3b inbound smoke 2026-05-18.md` F-1 finding | data (evidence) | Locked 2026-05-18 | Empirical proof the bug exists. If absent, this spec would have to either re-reproduce the bug (extra cost) or claim it on theory (weaker). | system-testing (B1.3b) |
| Existing `tests/server/website-webhook-auth.test.ts` test harness | internal | In place since well before B1.3b | Without the harness, the new regression test cannot be wired. Cost: minor — extending an existing pattern is trivial. | App test suite owner |
| Node `node:test` runner + `tsx --test` script in `package.json` | infra | Stable per B1.4 (231/231 passing) | If the runner is broken (it is not), test execution is impossible and Validator cannot gate on green tests. | App test infra |
| `lib/server/website-webhook-auth.ts` current source matches the version inspected for this spec | internal | Verified at spec-session start | If the file has moved on develop between spec-write and Backend pickup, the line numbers shift; Backend re-reads the file before patching (standard discipline). The patch surface is described semantically (function names + behavior), not by line numbers alone, so this is not load-bearing. | Backend skill |

---

## Assumptions

- The current `develop` HEAD of `lib/server/website-webhook-auth.ts` matches what was inspected at the start of this spec session. If a PR lands on develop between spec close and Backend pickup that touches this file, Backend re-reads it and adapts; the patch surface remains semantically the same.
- All production senders (NoonWeb dev's outbound + App's own `signWebsitePayload` for outbound `proposal-review-decision`) currently emit `x-noon-timestamp`. This is verified by code inspection: `signWebsitePayload` at lines 97-109 always sets the header. The patch therefore cannot regress any legitimate traffic.
- The existing test suite is green at the time Backend picks this up. Last verified green by B1.4 closure (2026-05-17, 231/231). If a test has gone red since then for unrelated reasons, that is a separate incident that does not gate this iteration — but Validator must explicitly note any pre-existing red tests in its report.
- The Vercel auto-deploy on `develop` PR merge will pick up the patch within the usual ~2 minutes after merge. This iteration does NOT require operational verification of the deploy as part of its completion gate (see §Success Criterion below); a post-merge runtime sanity check is operator-discretion.
- The PR will be merged by Pedro (per CLAUDE.md memory rule "Do not auto-merge PRs"). The PR is not auto-merged by Claude.

---

## Open Questions

These do not block bounded progress; they are noted for downstream skill awareness.

### Q1 — Should `assertRecentTimestamp`'s parameter type be tightened to `string`?
The current signature `(timestamp: string | null)` becomes redundant once null is rejected at the first line. Two equally valid implementations:
- Keep the signature loose and let the throw at the top handle null; future callers stay flexible.
- Tighten to `string` and move the null check to the call site in `verifyWebsiteWebhookSignature`.

**Decision:** out of scope for this spec. Backend authority. Either is acceptable. Refactor skill may choose the cleaner of the two in a separate iteration if warranted.

### Q2 — Does the new test verify the 401 status property in addition to the message?
The existing tests assert only on the thrown error class (or its message via regex). Adding `assert.strictEqual(err.status, 401)` to the new test makes the contract-shape assertion explicit. Spec recommends including it for traceability; Testing skill final call.

**Decision:** Testing skill authority. Recommended (explicit-better-than-implicit) but not gating.

### Q3 — Should a parallel NoonWeb-side fix be requested?
NoonWeb's `proposal-review-decision` receiver was very likely written from the same code template and may have the same bug. App-side cannot patch NoonWeb code. system-security may emit a Medium-severity finding recommending a cross-repo coordination message to the NoonWeb dev. The recommendation becomes a follow-up task (analogous to F-2 from B1.3b which was patched in-session on NoonWeb side).

**Decision:** out of scope for this iteration. Captured for system-security awareness. The fix is itself unilateral and complete from the App-side perspective.

### Q4 — Should the post-deploy re-fire of Scenario 3d be part of completion?
Two options:
- **(a)** Unit-test evidence is sufficient for system-validator → COMPLETE; runtime re-test is operator-optional.
- **(b)** A live re-fire of Scenario 3d against production post-deploy returning HTTP 401 is the binding gate.

**Decision recommended in spec:** option **(a)**. Justification: the unit test exercises the exact same code path with the same constructor inputs, and the production deploy is a mechanical PR merge with no environmental variability. Demanding option (b) would couple this iteration's completion to operator scheduling and to NoonWeb-side coordination (firing a malformed signed request from outside is non-trivial). If the operator wants runtime confirmation, they can run a `curl` from any machine against production post-merge — but it is not part of the spec's success gate.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| Patch accidentally tightens signature validation for legitimate inbound traffic (e.g., NoonWeb stops sending timestamp for some reason) | Very Low | High (production traffic 401s) | Medium | Code inspection confirms `signWebsitePayload` always emits the header. NoonWeb's sender uses the same pattern. Cross-repo communication channel exists (NoonWeb dev's verbal availability) if a regression were to surface. |
| The line-number references in this spec drift before Backend picks up (a PR touches `website-webhook-auth.ts`) | Low | Low | Low | Spec describes the patch semantically (function names + behavior), not by exact line numbers. Backend re-reads the file before patching. |
| New unit test is brittle (e.g., over-asserts on internal error message text) | Low | Low | Low | Testing skill discretion to assert on either class+message regex or class+status+exact message. Spec recommends class+exact-message+status but does not gate on the exact form. |
| Existing test "website webhook signature requires the shared secret" interacts with new test via shared `process.env` mutation | Low | Low | Low | Existing pattern in the test file already mutates `process.env.NOON_WEBSITE_WEBHOOK_SECRET` per-test and the `test.after()` hook restores it. New test follows the same pattern. |
| TypeScript type-checker rejects the simplified ternary at line 65 because `timestamp` is still typed `string \| null` after `assertRecentTimestamp` (function does not narrow the outer scope) | Medium | Low | Low | Backend resolution: either (a) tighten `assertRecentTimestamp` parameter to `string` and move the null check to the caller, (b) use a non-null assertion at line 65, (c) re-bind via `if (!timestamp) throw …; const ts = timestamp;` at the top of `verifyWebsiteWebhookSignature`. All three are acceptable; spec does not dictate. |
| NoonWeb side has the same bug symmetrically and the App-side patch silently exposes it (App fires outbound to NoonWeb which accepts a missing-timestamp request and creates state) | Medium | Medium (only affects outbound App→Web `proposal-review-decision` which is App-initiated and always emits timestamp) | Low | App-side `signWebsitePayload` always emits the timestamp, so the App never produces a request that exploits the symmetric NoonWeb bug. The risk is theoretical for App-initiated traffic. Cross-repo recommendation captured as Q3. |
| Patch ships but `docs/context/project.context.core.md` is not updated to reflect F-1 closure and B1.5 unblock | Medium | Medium | Medium | system-docs is mandatory in the chain. system-validator gates on context update. CLAUDE.md completion policy makes this non-negotiable. |
| Patch ships but unrelated regression elsewhere in the test suite was already red on develop pre-patch, and Backend mistakenly attributes it to this change | Low | Medium | Low | Backend must run the full suite on develop BEFORE applying the patch to baseline. If pre-patch suite is red, that is a separate incident; this iteration does not own it. |
| Security finding from system-security surfaces a deeper auth issue that requires re-scoping (e.g., recommend rate limit on 401 spam, or recommend nonce store from contract §13) | Low | Medium | Medium | Out-of-scope findings become follow-up tasks (e.g., audit B15 nonce store is already v2-deferred per contract §9 and is registered there). This iteration does not absorb them. |

---

## Chunking Decision

**Single iteration, not chunked.** The fix is two mechanical changes in one file + one new test. The chain Analysis → Backend → Testing → Security → Docs → Validator is sequential but each step is bounded enough that splitting into chunks would add ceremony without value. Each downstream skill is its own session bounded by its own scope, but the spec covers all of them in one continuous iteration.

---

## Recommended Testing Methodology

**TDD (red-green-refactor variant — test added in same iteration as the patch, not before).** Justification:

- A pure-BDD approach would require writing a Gherkin/feature spec around the auth surface, which is already documented in `cross-repo-webhook-v1.md` §2.3 — duplication adds no value.
- A pure-TDD approach (write test first, watch it fail, then write code) is conceptually correct here but operationally indistinguishable from "TDD-aware order of work within the same iteration" because the test and the patch are both small enough to land in one PR. The discipline that matters is: **the new test exercises the exact code path the patch fixes**, and it fails against the unpatched file and passes against the patched file. Backend + Testing should coordinate to confirm both states (red on unpatched, green on patched) before final PR push.
- Contract-driven testing (CDD) is already implicit: the contract `cross-repo-webhook-v1.md` §2.3 IS the assertion. The unit test is the executable form of that contract clause.
- Integration testing against live infrastructure was already done in B1.3b Scenario 3d (which is what surfaced the bug). Re-running Scenario 3d post-deploy is an OPTIONAL runtime validation per Q4 above; it is not the binding methodology.

**Concretely:** one new `node:test` case in `tests/server/website-webhook-auth.test.ts` with the assertion shape described in §Scope Boundary §Test 1.

---

## Recommended Route Depth

**Full.** Justified above in `### ROUTER DECISION`. The auth-surface change triggers mandatory system-security review per the security skill's description. Lite depth would skip security, which is unacceptable for an auth-surface change.

---

## Success Criterion

This iteration is **COMPLETE** when **all** of the following hold:

1. **Patch landed on develop.** `lib/server/website-webhook-auth.ts` no longer contains `if (!timestamp) return` in `assertRecentTimestamp`; the function now throws `WebsiteWebhookError('Missing webhook timestamp.')` when timestamp is null/empty. The `signedPayload` line in `verifyWebsiteWebhookSignature` no longer contains the `timestamp ? ... : bodyText` ternary; it unconditionally uses `${timestamp}.${bodyText}`.
2. **New regression test added.** `tests/server/website-webhook-auth.test.ts` contains a new test case that constructs a `Headers` object with only `x-noon-signature` (no `x-noon-timestamp`) and asserts `verifyWebsiteWebhookSignature` throws `WebsiteWebhookError` with `message === 'Missing webhook timestamp.'`. (Status-property assertion is recommended but not gating, per Q2.)
3. **Full test suite green.** All existing tests pass + the new test passes. Net: 231 prior + 1 new = 232 tests passing (or whatever the new total is on develop at merge time, with no regressions attributable to this change).
4. **Type-check clean.** `npm run typecheck` (or equivalent) returns no errors. No new `any` or `unknown` is introduced anywhere by the patch.
5. **Lint clean.** `npm run lint` returns no errors / no new warnings attributable to this change.
6. **Build clean.** `npm run build` succeeds.
7. **system-security passes.** The security skill reviews the auth-surface change and either (a) returns clean / no findings, or (b) returns findings that are explicitly downgraded to follow-up tasks (e.g., Q3 NoonWeb-side parallel fix recommendation). No CRITICAL or HIGH findings remain unresolved at validator gate per CLAUDE.md completion policy.
8. **`docs/context/project.context.core.md` updated.** B1.3b's F-1 entry in Active risks is moved to Closed-in-runtime (or equivalent transition per the docs convention), and B1.5 pilot sign-off is no longer listed as BLOCKED by F-1.
9. **system-validator returns COMPLETE.** Per CLAUDE.md completion policy.

If any of (1)-(8) is incomplete: validator returns **PARTIAL** with the explicit list of missing items.
If patch landed but unit test fails OR a regression surfaces in the existing suite: validator returns **BLOCKED**, the patch is reverted, and a follow-up iteration triages the regression.
If system-security surfaces a HIGH or CRITICAL finding not anticipated in this spec: validator returns **BLOCKED** until the finding is resolved or explicitly accepted by the operator with a dated risk register entry.

The post-deploy runtime re-fire of Scenario 3d against production is **OPTIONAL** per Q4 and is NOT a gate for COMPLETE.

---

## Definition of Done

- All 9 success criteria above satisfied.
- PR description references this spec, the B1.3b F-1 finding, the contract §2.3 clause, and the B1.5 unblock implication.
- No file outside the explicit modify-list in §Affected Files / Modules is touched.
- No contract document, no migration, no env var, no infra setting is modified in this iteration.
- system-validator returns COMPLETE.

---

## Notes for downstream skills

### For system-backend (next in chain)
- Read `lib/server/website-webhook-auth.ts` fresh to confirm the file has not drifted from the version in this spec.
- Apply Patch 1 (assertRecentTimestamp throw on null) and Patch 2 (unconditional signedPayload). Backend chooses whether to tighten the function signature; either approach is acceptable per Q1.
- Do NOT touch any other function in the file.
- Run the test suite locally BEFORE writing the new test, to baseline green. Then run again post-patch (without the new test) to confirm no existing test regresses. Then add the new test and confirm 232/232 (or current+1).
- Push to a feature branch with a name matching the spec session id: e.g., `feature/fase-1-b1-3c-hmac-timestamp-required`. Do not auto-merge per CLAUDE.md memory rule.

### For system-testing (after Backend)
- Add one new test case to `tests/server/website-webhook-auth.test.ts` per §Scope Boundary §Test 1.
- Use the same `process.env.NOON_WEBSITE_WEBHOOK_SECRET = 'unit-secret'` pattern as the existing tests in the file. The pre-existing `test.after()` hook at line 14 already handles env cleanup.
- Assert on both the thrown error class AND the exact message string. Optionally assert on the status property (recommended per Q2).
- Run the full suite and confirm green.
- Optionally: run the local dev server, fire a `curl` with `x-noon-signature` but no `x-noon-timestamp` against the local inbound-proposal route, and confirm HTTP 401 with the new body. This is integration sanity beyond unit-level and is NOT required for the spec's success criterion — operator discretion.

### For system-security (mandatory after Testing)
- Review the auth-surface change: the patch tightens the guard at `assertRecentTimestamp` from "permissive on null" to "strict reject." This is a net reduction in attack surface; no new surface is added. Confirm:
  - No new code path that bypasses signature verification.
  - No new env var, secret, or credential.
  - `timingSafeEquals` still in use (line 44-53 unchanged).
  - Raw body still read before JSON parse (unchanged in `readSignedWebsiteJson` line 77).
  - HMAC-SHA256 algorithm unchanged.
- Emit Q3 (NoonWeb-side parallel fix recommendation) as a follow-up finding if warranted. Severity recommendation: Medium. Owner: cross-repo coordination with NoonWeb dev.
- Confirm no CRITICAL or HIGH findings remain unresolved before passing to Docs.

### For system-docs (after Security)
- Update `docs/context/project.context.core.md`:
  - Move B1.3b's F-1 entry from Active risks to Closed-in-runtime (or the equivalent transition per the doc's convention at the time of update).
  - Remove the "B1.5 pilot sign-off BLOCKED on F-1 fix" reference; B1.5's only remaining blocker (per B1.3b closure) was this fix.
  - Add an entry recording the F-1 closure: code-conformance fix to §2.3 of the cross-repo webhook v1 contract, no contract change required.
  - NOTE: No R-codes, no Sprint numbers, no plan-IDs per user MEMORY rule.
- Append a session note to `docs/context/project.context.history.md` recording the iteration close.
- Update `C:\Users\pbu50\Desktop\Noon App\roadmap\NoonApp Roadmap.md` (or wherever the roadmap lives — operator clarifies if path differs):
  - B1.3c marked closed.
  - B1.5 marked unblocked.
- Do NOT touch `docs/integrations/cross-repo-webhook-v1.md`. The contract is unchanged.
- Do NOT touch `docs/validations/B1.3b inbound smoke 2026-05-18.md`. The B1.3b evidence is locked.

### For system-validator (final gate)
- Verify 9 success criteria above.
- Verify scope match (no surprises beyond §Scope Boundary §Included).
- Verify conflict-free outputs from Backend / Testing / Security / Docs.
- Verify `docs/context/project.context.core.md` is updated and reflects F-1 closure + B1.5 unblock.
- Verify no Critical/High security finding outstanding.
- Decide COMPLETE / PARTIAL / BLOCKED per the spec.

---

## Reference: closure criterion mapping to router handoff (verbatim)

The router prescribed the following success conditions for this iteration; this spec maps them 1:1 to §Success Criterion above. For audit trail:

| Router handoff item | Spec criterion # |
|---|---|
| Request without `x-noon-timestamp` → HTTP 401 with `code=WEBSITE_WEBHOOK_AUTH_FAILED` and `error: 'Missing webhook timestamp.'` | 1 + 2 (patch + test that proves it) |
| Existing test suite green post-fix | 3 |
| Type-check clean (no new any/unknown) | 4 |
| Lint clean | 5 |
| Build clean | 6 |
| Mandatory system-security pass (auth change) | 7 |
| F-1 closure recorded in context.core; B1.5 unblock recorded | 8 |
| system-validator COMPLETE per CLAUDE.md completion policy | 9 |

No criterion is invented in this spec.

---

## Lifecycle

- Status: **Draft** at write time. Promotes to **Approved** when Definition of Ready is satisfied (criteria testable, scope bounded, methodology decided, deps classified, risks rated — already satisfied at spec close).
- Supersedes: nothing.
- Superseded by: nothing.
- Relationship to predecessor specs: child of `specs/fase-1-b1-3b-inbound-smoke-cross-repo.md` (closed 2026-05-18). The predecessor explicitly scoped this child in its Finding F-1 "Recommended reroute" line.
- Relationship to parent program: `specs/fase-1-b1-stripe-live-cutover.md` (B1). B1.3a closed outbound smoke; B1.3b closed inbound smoke with F-1 surfaced; B1.3c (this iteration) closes F-1; B1.5 pilot sign-off is the next sibling.
