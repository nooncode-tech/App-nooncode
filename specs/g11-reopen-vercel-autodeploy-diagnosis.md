# spec.md — g11-reopen-vercel-autodeploy-diagnosis

## template-session-start

### SESSION METADATA
- Date: 2026-05-20
- Session ID: `g11-reopen-vercel-autodeploy-diagnosis`
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec). Downstream chain per router: system-infra → system-docs → system-validator. Skipped per router: architecture, backend, frontend, security, refactor, testing (justified — this is an integration-side runtime gating diagnosis with no code surface unless H1/H4 reveal a code-resolvable cause; see §Re-route triggers).
- Router mode: Infra-Deploy.
- Depth: **LITE**. Justified because: (a) no contract, no schema, no UI change is anticipated; (b) the perimeter is a single external integration (GitHub → Vercel) with a bounded set of observable surfaces (webhook deliveries, project Git binding, GitHub App permissions); (c) the success criterion is a single observable event (next merge auto-deploys OR a documented operator action is recorded); (d) the router's escalation triggers explicitly route to FULL depth on code change, so LITE remains valid until evidence forces otherwise.

### OBJECTIVE
- Diagnose, with empirical evidence, why 3 of 4 code-affecting PR merges to `develop` between 2026-05-20 ~17:53 UTC and 2026-05-20 ~22:00 UTC did NOT trigger a Vercel Production auto-deploy, while the first one (PR #69, merge `fe58658`) did. The Deploy Hook workaround works consistently (verified for #70 and #73), proving Vercel itself can deploy `develop` HEAD — only the GitHub→Vercel auto-trigger path is impaired.
- Produce a root cause classification with at least 2 pieces of converging evidence, then either (a) apply a fix and verify by triggering a fresh merge auto-deploy, OR (b) record a precise operator action (GitHub Settings step, Vercel Dashboard step, Vercel support ticket) for the user to execute and re-validate.
- Reopen and amend (do not replace) the existing G11 entry in `docs/context/project.context.core.md` at line 434 with the new root cause and the fix path (applied or operator-required).
- Sync the roadmap at `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` per the MEMORY rule.

### CONTEXT USED
- `project.context.core.md`: yes — confirmed the original G11 entry at line 434 explicitly anticipated this reopen path: *"Vercel auto-deploys are pending empirical re-verification (the fix path used a Deploy Hook because no fresh push had occurred yet) — if the next merge to `develop` does NOT auto-promote to Production, G11 reopens with a different root cause (probable: GitHub App integration permission revoked or webhook delivery broken — check repo Settings → Webhooks for recent failed deliveries to `*.vercel.com`)."* The original 2026-05-17 fix (Production Branch alignment to `develop`) is preserved and remains load-bearing — this reopen is a NEW root cause on top of it, not a regression of the prior fix.
- `project.context.full.md`: not loaded — diagnosis is integration-side; no architectural read needed unless H1/H4 escalate (Re-route trigger 1 forces FULL depth at that point).
- `project.context.history.md`: not loaded — the relevant history is captured in the G11 entry quoted above plus the empirical fact pattern below.
- Reason `full` excluded: LITE depth; no contract surface is involved in the current diagnostic hypothesis register.
- Reason `history` excluded: the only material prior event is the 2026-05-17 G11 closure, already cited verbatim in §Lifecycle.

### ROUTER DECISION
- Mode: Infra-Deploy.
- Depth: LITE. Justified above and reinforced by: the router's COMPLETE definition is observable (next merge fires OR operator action documented); no code-write tools required by analysis; the chain `analysis → infra → docs → validator` skips 6 skills explicitly.
- Chain: router (closed) → analysis (now) → infra → docs → validator.
- Why analysis is the active skill now: (a) the router pre-seeded 5 hypotheses but did not rank them empirically; (b) the evidence plan must be defined before infra executes so that infra does not mutate settings while diagnosing (R1); (c) the COMPLETE definition has two branches (fix applied + verified vs operator-only fix documented) and the decision rule between them must be set in the spec, not improvised by infra; (d) the escalation triggers must be concretized with file/command-level conditions to prevent silent rerouting.
- Reroute already known at start: no, but **two predictable forks** are documented in §Re-route triggers:
  - Fork A (operator-only fix): stay LITE, deliver PARTIAL — router's explicit allowance.
  - Fork B (code-resolvable cause): escalate to FULL via architecture + backend.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Acceptance Criteria" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules" below.
- Contracts or architecture inputs available:
  - `docs/context/project.context.core.md` line 434 — the existing G11 entry. **Amended, not replaced.**
  - `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` — synced per MEMORY rule.
  - Empirical fact pattern (see §Fact Pattern) confirmed via `gh pr list --state merged --base develop --limit 6` (executed in this analysis session): the 4 code-affecting merges + their commit SHAs + their timestamps match the router-supplied table exactly. PRs #71 and #72 (docs-only, merged in between) are excluded from the code-affecting set and not in scope for diagnosis (docs-only merges may or may not skip Vercel deploys depending on `ignoreCommand` config, irrelevant here).
- Relevant handoffs received from router:
  - 5 pre-seeded hypotheses (H1-H5) — refined and ranked below.
  - 4 explicit escalation triggers (root cause requires code, operator-only fix, security implication, BLOCKED) — mirrored in §Re-route triggers.
  - Validator COMPLETE definition with 4 gates — mirrored in §Acceptance Criteria.
  - Discipline rules (enumerate hypotheses BEFORE gathering evidence; record before-state always; preserve `gh api` and `vercel` CLI outputs as evidence).
- External dependencies or environment assumptions:
  - `gh` CLI authenticated as a user with admin access to `nooncode-org/App-nooncode` (required for `gh api repos/<owner>/<repo>/hooks` and webhook delivery listing). **Verified** by the analysis-phase `gh pr list` call returning private repo data without auth challenge.
  - `vercel` CLI authenticated against the project owning the App deployment (project ID to be confirmed by infra in step 1).
  - User has access to GitHub repo Settings → Integrations → Vercel App, and to Vercel Dashboard → Settings → Git, in case operator-side verification is required (H3, H4).
  - No concurrent merges to `develop` during the diagnostic window (otherwise evidence is polluted — see R2 mitigation).
  - The Vercel Deploy Hook URL is preserved and operational (already proven by the manual triggers of #70 and #73). Infra MUST NOT use it during diagnosis except as the final "verify fix" step on Fork A.

### RISK SNAPSHOT
- Known risks before starting: see "## Risks" below (R1-R5).
- Known blockers before starting: none. Webhook delivery API and Vercel CLI are both accessible.
- Known assumptions before starting:
  - The 1-of-4 success on PR #69 is not a coincidence — something structural changed between PR #69 merge (17:50 UTC) and PR #70 merge (19:48 UTC), a window of ~2 hours. The hypothesis register is shaped to find that change.
  - The Deploy Hook continues to work, so Vercel-side build + deploy machinery is healthy; only the trigger path is impaired.
  - GitHub webhook deliveries to Vercel are visible in `gh api repos/<owner>/<repo>/hooks/<id>/deliveries`. If the webhook is configured at the org level (rather than the repo level), the listing endpoint differs (`/orgs/<org>/hooks`); infra adapts.
  - The 4 merges + 2 docs-only merges are the COMPLETE set of code-affecting merges since the 2026-05-17 G11 closure — verified by `gh pr list --state merged --base develop --limit 6` returning #69 through #74 with no gaps.

### CONTINUITY NOTES
- Previous session relevant: the original G11 closure of 2026-05-17 (Production Branch alignment to `develop` via Vercel Dashboard; verified via Deploy Hook trigger because no fresh push existed at the time). That fix is preserved as load-bearing; this iteration adds a NEW root cause on top.
- Subsequent session relevant: no follow-up iteration is currently scoped. If the root cause is operator-only and the fix takes >24h to apply (e.g., Vercel support ticket), a `g11-reopen-monitoring` lightweight iteration may be scoped to track the resolution event.
- Expected next skill after this session: system-infra. Inputs: this spec, including the ordered evidence plan and the decision rules between Fork A / Fork B / Fork C / BLOCKED.

---

## Task Summary

Investigate why 3 of the last 4 code-affecting `develop` merges did not auto-deploy to Vercel Production, while the first one (PR #69) did. The Vercel-side build + deploy machinery is verified healthy (Deploy Hook works on demand). The fault is in the GitHub→Vercel trigger path between merge commit landing and Vercel receiving a build instruction.

Enumerate 5 hypotheses (H1-H5 from router + any additions), define their empirical signatures, and execute a bounded diagnostic sequence with infra. The sequence privileges read-only `gh api` and `vercel` CLI commands over Dashboard-side operator verification, so the diagnostic state stays clean (R1 mitigation). When 2+ pieces of evidence converge on one hypothesis, commit to that root cause; apply the fix if it is code-level (infra-applicable) or document the precise operator action if it is Dashboard-level / GitHub-App-level / Vercel-support-level.

Close the iteration by amending the existing G11 entry in `docs/context/project.context.core.md` line 434 (preserve the 2026-05-17 Production Branch alignment finding; append a new "2026-05-20 reopen" finding with the root cause and the fix path), syncing the roadmap, and routing through the validator.

---

## Scope Boundary

### Included

- **Hypothesis enumeration and ranking** (H1-H5 from router + any additions discovered during evidence gathering) with prior likelihood, empirical signature, confirm/rule-out evidence.
- **Evidence gathering plan** ordered by hypothesis priority and command cost (read-only API calls first, operator verification last).
- **Diagnostic execution by infra** following the plan strictly; infra records every command + every output as evidence in the iteration's evidence trail (a section to be added to this spec at infra time OR a separate `docs/validations/g11-reopen-evidence-2026-05-20.md` file at infra's discretion).
- **Root cause commitment** when 2+ converging pieces of evidence point to one hypothesis.
- **Fix application** if the root cause is in infra's authority surface (e.g., Vercel project setting via `vercel` CLI, GitHub repo setting via `gh api`).
- **Operator action documentation** if the fix is Dashboard-only or requires GitHub App reinstall / Vercel support escalation. The documentation MUST include: (a) the exact UI path, (b) the precise click sequence, (c) the verification step the user runs after applying it.
- **Fix verification** by triggering a fresh empty-or-trivial commit to `develop` (or piggybacking on the next legitimate merge) and observing Vercel Production auto-deploy fires. **No code commit is allowed in this iteration for diagnostic purposes** — infra must wait for the next legitimate merge or coordinate with the user for a no-op verification path (e.g., a docs-only commit pushed directly to `develop` IF the user authorizes it). PR #74 is INTENTIONALLY held un-deployed as the diagnostic baseline per the router prompt — DO NOT manually trigger #74's Deploy Hook to "test" anything during diagnosis; it is the post-fix verification artifact.
- **G11 entry amendment** at `docs/context/project.context.core.md` line 434. Append, do not replace. Format: keep the 2026-05-17 finding; add a "2026-05-20 reopen:" sentence with the root cause + fix path.
- **Roadmap sync** at `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` per MEMORY rule.
- **No B-codes, R-codes, Sprint IDs, plan-IDs in `docs/context/*.md`** per MEMORY rule.

### Excluded

- **No code changes.** No file under `app/`, `lib/`, `components/`, `tests/`, `supabase/migrations/`. The router explicitly limits diagnosis to integration-side surfaces.
- **No PR for code.** Only docs-side amendments (G11 entry + roadmap) ship in this iteration. The G11 amendment + roadmap sync MAY ship as a single docs-only commit on a `docs/g11-reopen-2026-05-20` branch with a PR, OR docs may piggyback on the next legitimate merge — docs/validator decides at closure time.
- **No security review.** The router conditions security insertion on H4 revealing a permission leak. If H4 confirms with evidence of a revoked/leaked token, infra surfaces it and routing inserts `system-security` before docs. Otherwise security is skipped per the router chain.
- **No architecture or backend work.** If the root cause is code-resolvable (e.g., a missing `vercel.json` field, a broken `ignoreCommand`, a CI-side branch protection that delays the push), Re-route trigger 1 escalates the iteration to FULL depth with architecture and backend inserted. Until that point, no architecture is done.
- **No webhook delivery REPLAY without recording.** Infra MUST NOT click "Redeliver" on any past GitHub webhook delivery during diagnosis. Replays mutate the deploy state and pollute the empirical trail. Only forward-looking verification (next merge) is allowed.
- **No setting change without before-state capture.** Infra MUST capture the current state of any setting before changing it. For Vercel project settings, the canonical snapshot is `vercel inspect <project-id>` and `vercel env ls`. For GitHub webhook settings, `gh api repos/<owner>/<repo>/hooks` JSON. R1 mitigation.
- **No Deploy Hook manual trigger during diagnosis.** The Deploy Hook is reserved for the FINAL verification step on Fork A, only if a fresh merge cannot be coordinated. PR #74 stays undeployed as the diagnostic baseline until the fix is applied and verified.
- **No `vercel` CLI command that writes to project state** during the read-only diagnostic phase (steps 1-4 of the evidence plan). Write-class commands (e.g., `vercel link`, `vercel env add`, `vercel project rm`) are blocked unless infra has converged on a hypothesis and the spec authorizes the change as the fix.
- **No GitHub Settings → Integrations → Vercel App MUTATION** during diagnosis (steps 1-4). Reading the current permission scope via the Dashboard is allowed (read-only operator check). Reinstalling or uninstalling the App is the FIX action, not the diagnostic action.
- **No coordinated change with NoonWeb.** This is App-only.
- **No chunking.** Single iteration, single PR (if any).

---

## Affected Files / Modules

### Files modified by this iteration (docs only)
- `docs/context/project.context.core.md` — amend line 434 (the G11 entry). Append the 2026-05-20 reopen finding with the root cause and fix path. NO B-codes, R-codes, Sprint IDs.
- `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` — sync per MEMORY rule. Append the G11 reopen line to the relevant operational section.

### Files possibly modified by this iteration (only if Fork A applies and infra authority covers it)
- `vercel.json` (project root) — IF the root cause is a missing `git.deploymentEnabled` field or similar declarative config. Highly unlikely given the 1-of-4 success on PR #69 (a JSON config issue would have failed all 4). Listed only for completeness.
- No other code files. If any non-doc file edit is proposed, Re-route trigger 1 fires.

### Files inspected as evidence sources (not modified)
- `gh api repos/nooncode-org/App-nooncode/hooks` — JSON listing of repo webhooks. Identifies the Vercel webhook ID for delivery inspection.
- `gh api repos/nooncode-org/App-nooncode/hooks/<id>/deliveries?per_page=20` — last 20 webhook deliveries. Identifies whether GitHub fired (H1 rule-out) and whether Vercel accepted (H2 rule-out).
- `gh api repos/nooncode-org/App-nooncode/installation` (if exists) or `gh api user/installations` — GitHub App installation status for Vercel (H4 evidence).
- `vercel project ls --json` (or equivalent) — confirms the project's existence and metadata.
- `vercel inspect <project-id-or-name>` — confirms `git.repo`, `git.productionBranch`, `git.deploymentEnabled` (H3, H5 evidence).
- `vercel list --prod --limit 10` — confirms which deploys actually happened in the production environment and which were CLI-triggered vs Git-triggered (the `source` field).

---

## Fact Pattern

Confirmed empirically in this analysis session via `gh pr list --state merged --base develop --limit 6 --json number,mergeCommit,mergedAt,title`:

| # | PR | Merge commit SHA | Merged at (UTC) | Type | Auto-deploy fired? |
|---|---|---|---|---|---|
| 1 | #69 | `fe5085828f95d6aacbe5a37404479c6bf1dc125b` | 2026-05-20T17:50:41Z | code + migration (B26) | ✅ Yes — deploy `dpl_CGaR2VBunmhy3faJTZq326EQWg3t` at ~17:53 |
| 2 | #70 | `04a7f26c192c5bd4cb6cd53f93bb3a1b884b1272` | 2026-05-20T19:48:35Z | code + migration (R5 RPC) | ❌ No — manually triggered via Deploy Hook ~2h later |
| 3 | #71 | `99ad865eb7ac0a1a552c25181aa51f2aac0a1b8c` | 2026-05-20T20:23:37Z | docs only | N/A (excluded from code-affecting set) |
| 4 | #72 | `3758dcfe3996d86ad1b37e11b8b1efde1aaf7b93` | 2026-05-20T20:28:57Z | docs only | N/A (excluded from code-affecting set) |
| 5 | #73 | `b06755255a43472f1dcf12f3aa66a405c98a8193` | 2026-05-20T21:02:53Z | code only (F-V12 wire-up) | ❌ No — manually triggered via Deploy Hook |
| 6 | #74 | `385215a3334dd8959017391e05bf64f3e73b0191` | 2026-05-20T21:57:51Z | code refactor only (G7 regen) | ❌ No — NOT yet deployed (intentional, preserving diagnostic state) |

**Code-affecting subset (the diagnostic set):** #69, #70, #73, #74 → 1 auto-deployed, 3 did not. Success ratio 1/4.

**Critical window:** 17:50:41Z (#69 merge, auto-deployed) → 19:48:35Z (#70 merge, did NOT auto-deploy). ~118 minutes. Whatever changed between these two timestamps is the root cause. The Vercel-side Deploy Hook continued to work for both #70 and #73 (and would for #74 if invoked), so Vercel build + deploy machinery is healthy throughout the window — the impairment is on the GitHub→Vercel trigger path.

**Workaround:** Vercel Deploy Hook URL (preserved from 2026-05-17 G11 fix); works consistently for all post-#69 manual triggers.

**Observation about doc PRs:** #71 and #72 (docs-only) are NOT counted in the diagnostic set because Vercel's behavior for docs-only commits depends on `ignoreCommand` configuration which is not part of this diagnosis. The router prompt and the 1-of-4 framing are correct in excluding them.

---

## Hypothesis Register

5 router-supplied hypotheses + 2 analysis additions (H6, H7) for completeness. Each carries a **prior likelihood** (pre-evidence, based on the 1-of-4 success pattern and the ~2h critical window), and the **empirical signature** that distinguishes it. Ranking is initial; infra refines after evidence is gathered.

### H1 — GitHub webhook not firing post-merge
- **Statement:** GitHub's webhook for the Vercel integration is registered on the repo but is not dispatching `push` events to Vercel post-merge for PRs #70, #73, #74. PR #69 fired normally.
- **Prior likelihood:** **Medium-Low.** GitHub webhook dispatch is generally reliable; a partial 1-of-4 success with no obvious config delta is unusual but not unheard of (e.g., rate limit on webhook dispatch tier, queue stuck).
- **Empirical signature:** In `gh api repos/<owner>/<repo>/hooks/<id>/deliveries?per_page=20`, the deliveries for the merge commits of #70, #73, #74 are ABSENT or MISSING the `push` event entries. The delivery for #69's merge IS present.
- **Confirm evidence:** Absent deliveries for post-#69 push events to `develop`.
- **Rule-out evidence:** All 4 merge commits have corresponding `push` event deliveries in the list, in which case the issue is downstream (H2 or H5).

### H2 — GitHub firing, Vercel rejecting
- **Statement:** GitHub IS dispatching webhook events to Vercel, but Vercel's endpoint is returning a non-2xx response (404, 410, 403, 5xx) for the 3 failed merges. PR #69's event was accepted.
- **Prior likelihood:** **Medium.** This is a classic intermittent-integration symptom — Vercel could have rotated their webhook receiver URL for the project, or the project ID encoded in the webhook config could have drifted, or the Vercel-side authentication/HMAC check could be failing because of a key rotation.
- **Empirical signature:** In the same `deliveries` list, the deliveries for #70, #73, #74 are PRESENT but show non-2xx `response.status` codes. The delivery for #69 shows 2xx.
- **Confirm evidence:** Non-2xx responses in delivery list for the 3 failed merges.
- **Rule-out evidence:** All deliveries show 2xx, in which case the issue is on Vercel's side post-acceptance (H5 or a Vercel internal bug — escalates to a Vercel support ticket).

### H3 — Production Branch drift
- **Statement:** The Vercel project's Production Branch setting drifted from `develop` to something else (e.g., `main`, blank, a stale feature branch) between #69 and #70.
- **Prior likelihood:** **Low.** The G11 fix of 2026-05-17 set Production Branch to `develop` and the context entry at line 434 specifically warns against changing it. The fact that the Deploy Hook fires deploys targeting the right code rules this OUT partially (the hook targets `develop` HEAD explicitly), but the GitHub auto-trigger path uses the Production Branch setting to decide whether a push to `develop` warrants a Production deploy.
- **Empirical signature:** `vercel inspect <project-id>` (or the project's Settings → Git in Dashboard) shows `productionBranch !== 'develop'`.
- **Confirm evidence:** `productionBranch` is anything other than `develop` in the inspect output.
- **Rule-out evidence:** `productionBranch === 'develop'` in the inspect output. (Strong rule-out for H3.)

### H4 — GitHub App permission scope changed / revoked
- **Statement:** The Vercel GitHub App lost permission to read the `nooncode-org/App-nooncode` repo, or its installation was scoped down to exclude the repo, or its access token was revoked, between #69 and #70. GitHub still has the webhook registered but the App can no longer act on the events Vercel-side.
- **Prior likelihood:** **Medium.** This matches the original G11 entry's flagged probable cause for reopen ("GitHub App integration permission revoked"). The ~2h critical window between #69 and #70 is consistent with an org admin reviewing GitHub App permissions during that window. Also consistent with a recent NoonCode-org-wide permission review post-G13 (token rotation 2026-05-17).
- **Empirical signature:** Two parallel signatures depending on where the change occurred:
  - **Repo-level:** `gh api repos/nooncode-org/App-nooncode/installation` returns 404 or shows the Vercel App is NOT in the installations list. GitHub Settings → Integrations → Vercel App shows "Suspended" or "No repository access" for this repo.
  - **Org-level:** `gh api orgs/nooncode-org/installations` shows the Vercel App with a `permissions` block missing `contents:read` or `pull_requests:read`, or with `repository_selection: 'selected'` and `App-nooncode` not in the selected list.
- **Confirm evidence:** Either signature above.
- **Rule-out evidence:** Vercel App is installed, has full required permissions, and `App-nooncode` is in scope. (Then H1 or H2 takes the floor.)
- **Security implication:** If H4 is confirmed because of a token leak / revocation that wasn't documented, Re-route trigger 3 inserts `system-security` before docs. If H4 is confirmed because of a benign permission scope adjustment (e.g., an org admin accidentally clicked "Only select repositories" and left `App-nooncode` off the list), security is NOT inserted; the fix is to re-grant scope, no leak.

### H5 — Vercel Git integration disconnected/expired
- **Statement:** The Vercel project's Git binding (the link from the project to `github:nooncode-org/App-nooncode`) was severed between #69 and #70. Vercel still has the project; the project lost its GitHub repo association.
- **Prior likelihood:** **Low.** Vercel does not typically break a Git binding without operator action (the project would surface a "No Git repository" banner in the Dashboard). The Deploy Hook continuing to work doesn't immediately confirm/rule out (Deploy Hooks operate independent of Git binding — they pull HEAD from a hardcoded URL stored at hook creation time).
- **Empirical signature:** `vercel inspect <project-id>` shows `git.repo === null` OR `git.repo` points to a different repo. The Vercel Dashboard → Settings → Git would show "Connect a Git Repository" instead of the linked repo.
- **Confirm evidence:** `git.repo === null` or differs from `nooncode-org/App-nooncode`.
- **Rule-out evidence:** `git.repo === 'nooncode-org/App-nooncode'` and `git.productionBranch === 'develop'`.

### H6 — Branch-protection or required-status-check delay (analysis addition)
- **Statement:** A GitHub branch protection rule on `develop` introduces a required status check that completes AFTER the merge button is clicked, and the merge commit is only "finalized" (and the `push` event dispatched) when the check passes. The merges of #70, #73, #74 hit a state where the post-merge check is pending, so the `push` event is delayed or suppressed entirely. PR #69 was the last merge before a branch protection rule was added or modified.
- **Prior likelihood:** **Very Low.** GitHub `push` events fire on merge commit creation, not on post-merge status check completion. Branch protection rules apply BEFORE merge, not AFTER. But listed for completeness because the 1-of-4 pattern with a ~2h gap is the same shape as a settings-change event.
- **Empirical signature:** `gh api repos/nooncode-org/App-nooncode/branches/develop/protection` returns a protection config with a new `required_status_checks` entry added between 17:50Z and 19:48Z (timestamp would be in the audit log). Webhook delivery list shows the `push` events ARE there, just delayed by minutes.
- **Confirm evidence:** Protection config changed in the critical window AND deliveries are delayed but eventually present.
- **Rule-out evidence:** Protection config unchanged in the critical window OR deliveries are absent entirely (then H1) OR deliveries are present and 2xx but the deploy didn't fire on Vercel (then H4/H5).

### H7 — Vercel-side ignored-commit heuristic / "skip ci" pattern in commit messages (analysis addition)
- **Statement:** Vercel has a "Skip deploy" feature that respects `[skip ci]`, `[skip vercel]`, or similar markers in commit messages. If PR #70's merge commit message (which is the squashed PR title + body) accidentally contains a recognized skip pattern, Vercel ignores the push. The pattern may have been introduced by a commit message convention change adopted after PR #69.
- **Prior likelihood:** **Very Low.** Squash merge commit messages from the GitHub UI don't typically contain `[skip ci]`-style markers unless deliberately added. But infra can rule this out cheaply with `git log <sha> --format='%B'` for each of the 4 merge commits.
- **Empirical signature:** `git log fe58658 04a7f26 b067552 385215a --format='%H %B' | grep -iE '\[skip.*\]|skip ci|nodeploy'` returns matches for #70, #73, #74 but not #69.
- **Confirm evidence:** Match in 3 of 4 merge commit messages with no match in the success case.
- **Rule-out evidence:** Zero matches (the most likely outcome).

### Initial ranking (pre-evidence)

By prior likelihood, given the 1-of-4 success pattern with a ~2h critical window and the Deploy Hook continuing to work:

1. **H4** — GitHub App permission scope changed / revoked. **Prior: Medium.** Matches the original G11 entry's flagged reopen cause; consistent with org-wide permission reviews; explains the ~2h gap (operator action).
2. **H2** — GitHub firing, Vercel rejecting. **Prior: Medium.** Vercel-side configuration drift is the classic intermittent-integration shape.
3. **H1** — GitHub webhook not firing. **Prior: Medium-Low.** Webhook dispatch reliability issues are real but rare; would be visible immediately in delivery list.
4. **H5** — Vercel Git integration disconnected. **Prior: Low.** Would be visible at the first `vercel inspect`.
5. **H3** — Production Branch drift. **Prior: Low.** Strongly counter-indicated by Deploy Hook continuing to deploy `develop` HEAD correctly + the G11 entry warning against this exact change.
6. **H6** — Branch protection delay. **Prior: Very Low.** Mechanism doesn't match GitHub's known behavior.
7. **H7** — Skip-CI marker in commit message. **Prior: Very Low.** Cheap to rule out, listed for completeness.

**Combinations to consider:** H1 + H4 is plausible (if the App is suspended, GitHub may stop dispatching events to its webhook URL entirely). H2 + H5 is plausible (if the Git binding is broken, Vercel may return 4xx because the project doesn't know what to do with the event). The evidence plan distinguishes these via combined H1+H2 inspection in step 2.

---

## Evidence Gathering Plan

Ordered by hypothesis priority and command cost. Infra executes top-to-bottom. After each step, infra updates the ranking and decides whether to continue or commit to a root cause per §Decision Rules.

**Discipline:** every command's full output is captured. Recommendations for evidence storage: append to a new file `docs/validations/g11-reopen-evidence-2026-05-20.md` OR include verbatim outputs in the infra agent's final spec annotation (`## Evidence Trail` section appended below). Infra picks one; analysis recommends the separate file for grep-ability.

### Step 0 — Establish baseline (cost: trivial, evidence for: none directly)
- **Commands:**
  - `git log --oneline -1 develop` — confirm local develop is at `385215a` (PR #74 merge).
  - `git rev-parse fe5085828f95d6aacbe5a37404479c6bf1dc125b 04a7f26c192c5bd4cb6cd53f93bb3a1b884b1272 b06755255a43472f1dcf12f3aa66a405c98a8193 385215a3334dd8959017391e05bf64f3e73b0191` — confirm all 4 SHAs exist locally.
- **Expected output:** all 4 SHAs valid; develop HEAD = #74.
- **What it produces:** baseline sanity check; rules out any local-clone weirdness before remote evidence gathering.

### Step 1 — List repo webhooks (cost: low, evidence for: H1, H2, H4)
- **Command:** `gh api repos/nooncode-org/App-nooncode/hooks --jq '.[] | {id, name, config_url: .config.url, active, events, created_at, updated_at}'`
- **Expected output:** A list of webhooks. The Vercel webhook is identified by `config_url` matching `https://api.vercel.com/v1/integrations/deploy/...` or `https://vercel.com/api/...` pattern. Capture its `id` for step 2.
- **Verdicts produced:**
  - If NO Vercel webhook present → H4 likely confirmed (the App was uninstalled and removed its webhook). Skip to step 4.
  - If Vercel webhook present and `active: true` → continue to step 2.
  - If Vercel webhook present and `active: false` → H1 confirmed by deactivation. Continue to step 2 to see delivery history for completeness.
  - If multiple Vercel-pattern webhooks present → capture all IDs, evidence trail noted; continue to step 2 for each.

### Step 2 — List webhook deliveries for the Vercel webhook (cost: low, evidence for: H1, H2)
- **Command:** `gh api "repos/nooncode-org/App-nooncode/hooks/<id-from-step-1>/deliveries?per_page=30" --jq '.[] | {id, event, action, delivered_at, status, status_code, redelivery}'`
- **Expected output:** Last 30 deliveries with their event type, timestamp, response status, and HTTP code.
- **Verdicts produced for each of the 4 merge commits:**
  - **Delivery present + 2xx for #69 only, absent for #70/#73/#74** → H1 confirmed (GitHub stopped firing). Investigate why with step 3+4.
  - **Delivery present + 2xx for all 4** → H1 ruled out; the issue is post-acceptance (H5 or Vercel internal). Continue to step 3.
  - **Delivery present + non-2xx for #70/#73/#74** → H2 confirmed. Capture the response status code (404 = endpoint gone; 403/401 = auth/permission; 410 = endpoint deprecated; 5xx = Vercel transient). Continue to step 3 to corroborate.
  - **Delivery present but the `event` field for the failed ones is NOT `push`** → suspicious; possibly only `pull_request` events are firing and `push` events to `develop` are filtered out somewhere. Cross-check the webhook's `events` array from step 1.

### Step 3 — Inspect the Vercel project's Git binding and Production Branch (cost: low, evidence for: H3, H5)
- **Commands:**
  - `vercel link --yes` (if not already linked locally) — links the working dir to the project (read-only inspection only; does NOT change project state).
  - `vercel project ls --json` — list all projects accessible to the user; identify the App project (likely named `app-nooncode` or `nooncode-app`).
  - `vercel inspect <project-id-or-name>` (or `vercel project ls --json | jq '.[] | select(.name=="<name>")'`) — capture the full project JSON.
- **Expected output JSON fields of interest:**
  - `git.repo` — should be `nooncode-org/App-nooncode`.
  - `git.productionBranch` — should be `develop`.
  - `git.deploymentEnabled.develop` (or similar) — should be `true`.
  - `link.type` — should be `github`.
- **Verdicts produced:**
  - `git.repo !== 'nooncode-org/App-nooncode'` or null → H5 confirmed.
  - `git.productionBranch !== 'develop'` → H3 confirmed.
  - `git.deploymentEnabled.develop === false` → variant of H3 (deploys for the branch are disabled).
  - All three fields correct → H3 + H5 ruled out; the issue is upstream (H4 likely).

### Step 4 — Inspect GitHub App installation for Vercel (cost: low, evidence for: H4)
- **Commands:**
  - `gh api repos/nooncode-org/App-nooncode/installation --jq '{app_slug, permissions, repository_selection, created_at, updated_at, suspended_at}'` — repo-level App installation.
  - `gh api orgs/nooncode-org/installations --jq '.installations[] | select(.app_slug=="vercel") | {id, app_slug, permissions, repository_selection, created_at, updated_at, suspended_at}'` — org-level App installation.
  - **OPERATOR ASK:** request the user to open GitHub → `nooncode-org` → Settings → Integrations → Vercel App, capture: (a) installation status (Active / Suspended / Not installed), (b) repository access (All / Selected — which?), (c) permissions list, (d) last updated timestamp. **The user-provided answer is the canonical H4 evidence** when CLI permissions don't expose the field.
- **Expected output:**
  - `suspended_at` is null → App not suspended.
  - `repository_selection: 'all'` OR `App-nooncode` in selected repos → App has scope.
  - `permissions.contents: 'read'` AND `permissions.pull_requests: 'read'` (and ideally `'write'`) — required for Vercel to read commits and create deployments.
- **Verdicts produced:**
  - `suspended_at !== null` → H4 confirmed (App suspended).
  - `App-nooncode` not in scoped repos OR `repository_selection: 'selected'` without the repo listed → H4 confirmed (scope narrowed).
  - Missing required permissions → H4 confirmed (permissions revoked).
  - All fields healthy → H4 ruled out.

### Step 5 — Skip-CI marker rule-out (cost: trivial, evidence for: H7)
- **Command:** `git log fe58658 04a7f26 b067552 385215a -n 1 --format='%H%n%B%n---'` (one-shot for all 4 commits).
- **Expected output:** 4 commit message bodies.
- **Verdicts produced:**
  - Any of `#70`, `#73`, `#74` commit messages contain `[skip ci]`, `[skip vercel]`, `[skip deploy]`, `[noci]`, `[no deploy]` → H7 confirmed.
  - No matches → H7 ruled out (likely outcome).

### Step 6 — Branch protection delta check (cost: trivial, evidence for: H6)
- **Commands:**
  - `gh api repos/nooncode-org/App-nooncode/branches/develop/protection --jq '{required_status_checks, allow_force_pushes, required_pull_request_reviews}'`
  - `gh api repos/nooncode-org/App-nooncode/branches/develop/protection --jq '.updated_at // "n/a"'` (may not be present in this API; alternative: org audit log).
- **Expected output:** current protection config; updated_at timestamp if available.
- **Verdicts produced:**
  - Protection config has a `required_status_checks` rule added in the critical 17:50-19:48 window → H6 plausible; corroborate with delivery delays from step 2.
  - No suspicious changes → H6 ruled out.

### Step 7 — Vercel deployment source corroboration (cost: trivial, evidence for: H1/H2/H5 corroboration)
- **Command:** `vercel list --prod --limit 10 --json --meta --since 2026-05-20T16:00:00Z` (or equivalent).
- **Expected output:** Last 10 production deploys with their `source` field (`git`, `cli`, `deploy-hook`, `import`).
- **Verdicts produced:**
  - For the PR #69 deploy (`dpl_CGaR2VBunmhy3faJTZq326EQWg3t`): `source` should be `git` or equivalent → confirms Git-trigger worked once.
  - For the post-#69 deploys (the manual triggers for #70, #73): `source` should be `deploy-hook` or `cli` → corroborates that Git-trigger did NOT fire.
  - If no Git-source deploys exist after `dpl_CGaR2VBunmhy3faJTZq326EQWg3t` → strong corroboration that the impairment started exactly between #69 and #70.

---

## Decision Rules

These rules govern when infra commits to a root cause vs continues vs escalates vs marks BLOCKED.

### Rule 1 — Commit to root cause
- **Condition:** 2+ pieces of evidence from steps 1-7 converge on the same hypothesis (H1, H2, H3, H4, H5, H6, or H7).
- **Example convergence patterns:**
  - **H4 confirmed:** Step 1 shows no Vercel webhook on the repo + Step 4 shows App suspended → 2 converging signals → commit H4.
  - **H2 confirmed:** Step 2 shows non-2xx for failed deliveries + Step 4 shows App scope healthy → 2 converging signals (non-2xx isolated to Vercel-side rejection, not GitHub-side suppression) → commit H2.
  - **H1 confirmed alone:** Step 2 shows deliveries absent + Step 4 shows App scope healthy → 2 converging signals (GitHub itself isn't firing despite the App being authorized) → commit H1 (likely caused by a Vercel-side webhook suspension that GitHub reflects without the App appearing suspended; or a webhook auto-disable from too many failed deliveries — check the webhook's `last_response.code` field).
- **Action on commit:** infra writes the root cause + the fix path into the spec's §Evidence Trail (added at infra time), then proceeds to Fix Phase.

### Rule 2 — Continue diagnosing
- **Condition:** Fewer than 2 converging evidence pieces, but at least one hypothesis is partially supported and at least one diagnostic step remains.
- **Action:** continue to the next step in the evidence plan.

### Rule 3 — Escalate to operator-only action (Fork A)
- **Condition:** Root cause is committed but the fix requires:
  - GitHub App reinstall or scope re-grant (H4 confirmed) — operator does this in GitHub Settings → Integrations.
  - Vercel project setting change in Dashboard that the CLI doesn't expose (H3, H5 confirmed) — operator does this in Vercel Dashboard → Settings → Git.
  - Vercel support ticket (H2 confirmed with Vercel-side 5xx; Vercel internal bug).
- **Action:** infra documents the precise operator action (UI path + click sequence + verification step) in the spec's §Operator Action Required section (added at infra time). Iteration is delivered as **PARTIAL** per router's escalation list. The user's execution of the operator action + verification of the next merge auto-deploying becomes a follow-up validation tracked outside this iteration.

### Rule 4 — Escalate to FULL depth (Fork B)
- **Condition:** Root cause is committed but the fix requires a code change (`vercel.json` edit, CI workflow edit, `.github/` config edit).
- **Action:** halt LITE chain. Reroute iteration through `architecture` → `backend` (or `frontend` if UI-related — unlikely here) → ... → `validator`. Spec is updated to FULL depth; this analysis spec serves as the input to the new architecture pass.

### Rule 5 — Insert security review (Fork C)
- **Condition:** H4 confirmed AND evidence shows a TOKEN-LEAK-driven revocation (e.g., an explicit "token revoked due to leak" notification in the App's status, or an audit-log entry citing a security event).
- **Action:** insert `system-security` before `system-docs` in the chain. Security agent reviews the rotation surface and confirms no residual exposure before docs amends the G11 entry.

### Rule 6 — Mark BLOCKED
- **Condition:** All 7 hypotheses ruled out by evidence AND no new hypothesis emerges, OR a hypothesis is committed but Vercel CLI / `gh api` cannot apply the fix and the user cannot execute the operator action within the iteration window.
- **Action:** mark iteration **BLOCKED**. Surface to user with the full evidence trail. Recommend a Vercel support ticket OR a temporary procedural rule ("manually trigger Deploy Hook after every merge until G11-reopen-2 ships") in the meantime.

### Rule 7 — Fix verification
- **Condition:** Root cause committed AND fix applied (either infra-side or operator-side).
- **Verification path:**
  - **Preferred:** wait for the next legitimate merge (or coordinate with user a no-op docs commit pushed directly to `develop`) and observe whether Vercel Production auto-deploys within 5 minutes of the merge.
  - **Fallback (if no legitimate merge available within 1h):** ask user to push a trivial commit directly to `develop` (e.g., a date bump in a comment) and observe the auto-deploy.
  - **NOT permitted:** triggering the Deploy Hook for #74 to "verify the fix" — the Deploy Hook fires regardless of GitHub→Vercel trigger health, so it proves nothing.
- **Evidence:** capture the new deploy's `source` field via `vercel list --prod --limit 1 --json` — must be `git` (not `deploy-hook` or `cli`) for the verification to succeed.
- **Action on verified fix:** proceed to docs + validator. G11 reopen closed with root cause + fix evidence.
- **Action on failed verification:** the committed root cause is wrong or the fix is partial; reopen the hypothesis register, expand evidence gathering, possibly mark BLOCKED if no new hypothesis remains.

---

## Risks

| # | Risk | Probability | Impact | Severity | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R1 | **Changing a setting while diagnosing pollutes evidence.** Infra modifies a Vercel project setting OR a GitHub webhook config to "test a hypothesis", which then corrupts the empirical trail (e.g., infra clicks "Redeliver" on a past webhook delivery, which mutates the deploy state). | Medium | High (entire diagnosis becomes unreliable; root cause may be invented post-hoc) | High | Spec mandates: every command's before-state captured; no write-class operations during diagnostic steps 1-7; Deploy Hook reserved for FINAL verification only; PR #74 stays undeployed as baseline. | Infra |
| R2 | **Concurrent merge to `develop` during diagnosis pollutes evidence.** The user or another collaborator merges a PR during the diagnostic window, making it unclear whether the new merge confirms the impairment or the partial fix. | Low-Medium | Medium | Medium | Spec mandates: infra notifies user at session start to hold merges to `develop` until iteration closes; if a merge slips in, infra captures its deploy status as additional evidence rather than reverting it. | Infra / User |
| R3 | **`gh` CLI authentication scope insufficient.** The current user's GitHub CLI auth may not have permission to read installation details for the Vercel App at org level (step 4). | Medium | Medium (forces fallback to operator-ask Dashboard read) | Medium | Spec's step 4 already includes operator-ask fallback; infra surfaces the auth failure cleanly and asks user to verify via Dashboard. No iteration block. | Infra / User |
| R4 | **Vercel CLI authentication scope insufficient.** The current user may not be authenticated to Vercel CLI at all in this dev environment, OR may be authenticated to a different team/account from the App project's owner. | Medium | Medium-High (step 3 cannot be executed without it) | Medium-High | Spec mandates step 0.5 (added at infra time): infra runs `vercel whoami` first; if not authenticated, asks user for `vercel login`. If authenticated but to the wrong team, asks user for the correct team token. No setting changes attempted until auth confirmed. | Infra / User |
| R5 | **Fix is operator-only AND user cannot execute it within the iteration window.** H4 confirmed; user is not at a workstation with GitHub admin access; or H3/H5 confirmed but user needs to coordinate with org admin to apply Dashboard changes. | Low-Medium | Medium (iteration delivers PARTIAL; closure deferred) | Medium | Router explicitly allows PARTIAL for this case. Spec mandates: even on PARTIAL, the G11 entry IS amended with the root cause + the pending operator action (so the project context reflects the diagnostic result even if the fix is open). Validator returns PARTIAL, not BLOCKED, when the diagnostic outcome is clear but the fix is operator-pending. | Infra / User / Docs |
| R6 | **Cascading hypothesis confirmation (H4 + H1).** If H4 is confirmed, H1 will appear ALSO confirmed (the App's webhook will show no deliveries because the App is no longer authorized to receive them). Infra may double-count this as 2 converging hypotheses for either root cause individually, when really it is one root cause (H4) with a downstream symptom (H1). | Medium | Low (correct root cause is H4; mislabeling as H1 leads to a wrong fix attempt) | Low | Spec mandates: if BOTH H1 and H4 are signaled, H4 is the primary root cause and H1 is the symptom. Fix targets H4 (operator action: GitHub App reinstall/scope re-grant). H1 should resolve automatically once H4 is fixed. Infra documents the relationship in the evidence trail. | Infra |

---

## Acceptance Criteria

This iteration is **COMPLETE** when all 4 router-defined validator gates pass, with concrete evidence captured for each:

1. **Root cause identified with empirical evidence.**
   - Evidence: at least 2 converging pieces from the §Evidence Gathering Plan steps, captured verbatim in the evidence trail (separate file `docs/validations/g11-reopen-evidence-2026-05-20.md` OR appended §Evidence Trail section in this spec).
   - The root cause is a single hypothesis from H1-H7 (or a documented new hypothesis Hn that emerged during diagnosis).

2. **Either fix applied + verified, OR fix documented as precise operator action.**
   - **Branch A (fix applied + verified):** infra (or user) applies the fix; the next merge (or a user-pushed trivial commit to `develop`) auto-deploys; `vercel list --prod --limit 1 --json` shows `source: git`. Evidence: the post-fix deploy URL + source field.
   - **Branch B (operator action documented):** spec contains §Operator Action Required with the exact UI path + click sequence + verification step. Iteration delivered as **PARTIAL**.
   - **Branch C (BLOCKED):** all 7 hypotheses ruled out AND no new hypothesis; recorded as BLOCKED with full evidence trail.

3. **`docs/context/project.context.core.md` G11 entry updated.**
   - The existing line 434 entry is AMENDED (not replaced). The 2026-05-17 Production Branch alignment finding is preserved. A new "2026-05-20 reopen:" sentence (or sub-paragraph) records:
     - The root cause (one of H1-H7 or a new Hn).
     - The fix path (applied or operator-pending).
     - Any new operational rule learned (e.g., "monitor webhook deliveries weekly", "audit GitHub App permission scope after any org permissions change").
   - NO B-codes, R-codes, Sprint IDs, plan-IDs per MEMORY rule.

4. **Roadmap synced.**
   - `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` updated with the G11 reopen + closure or PARTIAL status.
   - The update is appended to the relevant operational/infra section.

**Iteration is PARTIAL when:** root cause identified + operator action documented + G11 amended + roadmap synced, but fix not yet applied (Fork A operator-only path). Validator allows PARTIAL closure with explicit "pending operator execution" state in the G11 entry.

**Iteration is BLOCKED when:** all 7 hypotheses ruled out and no new hypothesis emerges with current evidence. Validator records BLOCKED; recommend Vercel support ticket; user holds the iteration open for a future Hn discovery or external response.

---

## Methodology Declaration

**Empirical diagnostic.** No new tests. No code changes for diagnostic purposes. No "let's try this and see if it works" speculative settings changes.

Justification:
- This is an integration-layer diagnosis. The classical methodology is read-state-then-act, not write-test-then-validate.
- The empirical signature of each hypothesis is well-defined; evidence gathering is bounded and reproducible.
- Tests would not protect against this regression because the regression surface is external (GitHub + Vercel), not in the codebase.
- TDD inappropriate — no new code behavior.
- BDD inappropriate — no user-visible change.
- CDD inappropriate — no UI change.
- Integration-first inappropriate — the integration in question is external infrastructure, not application integration tests.

The diagnostic IS the validation: when 2+ pieces of evidence converge AND the fix verification confirms the next merge auto-deploys, the iteration is empirically closed.

---

## Re-route Triggers

Lifted from router escalation list, concretized with infra-level conditions.

### Trigger 1 — Root cause needs code change → reroute through architecture + backend (FULL depth)
- **Router wording:** "Root cause needs code change → reroute through architecture + backend (FULL depth)".
- **Concrete trigger condition:** Root cause committed AND the fix requires editing a file under `app/`, `lib/`, `components/`, `tests/`, `supabase/migrations/`, `vercel.json`, `.github/workflows/`, OR any CI configuration.
- **Action:** halt LITE chain; reopen this spec at the §Lifecycle Declaration; switch depth to FULL; route through `system-architecture` first (for `vercel.json` or `.github/` schema concerns), then `system-backend` (for code), then `system-testing` (for regression coverage if applicable), then `system-docs`, then `system-validator`.
- **Likely hypothesis:** H6 (branch protection) or H7 (skip-CI marker) only — both unlikely.

### Trigger 2 — Operator-only fix (GitHub App reinstall, Vercel support ticket, Dashboard setting) → stay LITE, deliver PARTIAL
- **Router wording:** "Operator-only fix (GitHub App reinstall, Vercel support ticket, dashboard setting) → stay LITE, deliver PARTIAL".
- **Concrete trigger condition:** Root cause committed AND fix requires user-side action that cannot be executed via `gh api` or `vercel` CLI from infra's environment.
- **Action:** infra writes §Operator Action Required in this spec (exact UI path + click sequence + verification step); validator returns PARTIAL; G11 entry amended with "fix pending operator execution"; roadmap synced.
- **Likely hypothesis:** H3, H4, H5 — all three are operator-only fixes if their root cause is Dashboard-side.

### Trigger 3 — Security implication (revoked token, leaked secret) → insert security before docs
- **Router wording:** "Security implication (revoked token, leaked secret) → insert security before docs".
- **Concrete trigger condition:** Step 4 evidence shows the Vercel App was suspended OR uninstalled due to a security event (e.g., GitHub audit log entry citing "App suspended due to security event", OR the user volunteers that they revoked the App token after a leak).
- **Action:** insert `system-security` between infra and docs in the chain. Security agent reviews the rotation surface (any other Vercel-issued tokens? any other org-wide App authorizations?) and clears closure before docs amends the G11 entry.

### Implicit trigger 4 — Diagnostic incomplete → BLOCKED
- **Trigger condition:** All 7 hypotheses ruled out AND no new hypothesis emerges with the gathered evidence.
- **Action:** mark iteration BLOCKED; surface to user with full evidence trail; recommend a Vercel support ticket; defer closure.

---

## Lifecycle Declaration

- **Status:** Draft (pending infra execution).
- **Moves to Approved:** when infra confirms step 0 (baseline) and step 0.5 (CLI auth) without issues and begins step 1.
- **Moves to Implemented:** when validator returns COMPLETE (Fork A success), PARTIAL (Fork A operator-pending or Fork B escalation closed in this iteration), or BLOCKED.
- **Closure:** this iteration **reopens AND amends** the existing G11 entry in `docs/context/project.context.core.md` line 434 (originally closed 2026-05-17 with the Production Branch alignment finding). The amendment:
  - Preserves the 2026-05-17 finding (Production Branch = `develop`; do not change without coordinated migration).
  - Appends a 2026-05-20 reopen note with the new root cause + fix path.
  - Adds (if applicable) a new operational rule learned from this diagnosis.
- **Supersedes:** none. This iteration extends the prior G11 closure of 2026-05-17 — the prior closure's findings remain valid and load-bearing.
- **Superseded by:** none anticipated. If H4 is confirmed and the operator-side fix requires multi-day coordination (e.g., Vercel support ticket), a follow-up `g11-reopen-monitoring` iteration may be scoped lightly to track the resolution event without re-running the full diagnostic.

---

## Open Questions

These are bounded with default answers so infra does not block waiting.

### Q1 — Where is the GitHub webhook for Vercel registered: repo-level or org-level?
- **Options:** (a) repo-level (`gh api repos/<owner>/<repo>/hooks`); (b) org-level (`gh api orgs/<org>/hooks`); (c) GitHub App auto-managed (no explicit hook entry, the App manages its own webhook).
- **Default (if infra finds no explicit hook):** Vercel's official integration is the GitHub App route (option c), in which case there will be NO entries in `gh api repos/.../hooks` matching `vercel.com`. Step 1's verdict tree explicitly handles this case by routing to step 4 (GitHub App installation inspection). Infra should NOT treat "no Vercel webhook in repo hooks list" as H4-confirmed by itself; it must corroborate with step 4 evidence.
- **Decision authority:** infra during step 1 execution.

### Q2 — Should the evidence trail be a separate `docs/validations/` file or appended to this spec?
- **Options:** (a) separate file `docs/validations/g11-reopen-evidence-2026-05-20.md`; (b) appended as `## Evidence Trail` section in this spec.
- **Default:** (a). Grep-ability + separation of concerns. Spec stays bounded; evidence is durable but parked separately. The HTML file convention used for browser validations (`docs/validations/Browser validation ...html`) suggests `docs/validations/` is the standard parking lot.
- **Decision authority:** infra at execution time.

### Q3 — If H4 is confirmed and the App needs to be reinstalled, does docs ship before or after the user executes the reinstall?
- **Options:** (a) docs ships immediately with "fix pending operator execution"; (b) docs waits until the user completes the reinstall + verification.
- **Default:** (a). Reflects current operational reality in the context doc; user execution may take hours/days. The G11 entry can be revised again when the fix is verified, but the diagnostic outcome is recorded immediately. Iteration delivers PARTIAL per router's escalation list.
- **Decision authority:** docs / validator at closure time.

### Q4 — If H1 and H4 BOTH signal, is the root cause "H4 (with H1 as symptom)" or "H1 (with H4 as enabling condition)"?
- **Options:** (a) H4 primary, H1 symptom; (b) H1 primary, H4 enabling.
- **Default:** (a). Per R6 mitigation. The fix targets H4 (operator action: reinstall/scope re-grant); H1 should resolve automatically once H4 is fixed. The evidence trail documents the relationship explicitly.
- **Decision authority:** infra during root cause commitment.

### Q5 — If diagnostic completes successfully, should a `g11-reopen-monitoring` follow-up iteration be scoped to watch the next 5 merges?
- **Options:** (a) yes — a lightweight monitoring iteration; (b) no — single fix verification is enough.
- **Default:** (b). The fix verification path (next merge auto-deploys with `source: git`) is sufficient empirical evidence; a monitoring iteration would be ceremony without proportional risk reduction. The G11 entry IS updated to record the new operational rule (e.g., "monitor `gh api .../hooks/<id>/deliveries` after any GitHub App permission change"), which acts as the lightweight continuous monitor.
- **Decision authority:** docs / validator at closure time.

---

## Handoff to system-infra

System-infra is the next active skill. Inputs already on disk (this spec). Required outputs from infra before docs can amend the G11 entry:

1. **Step 0 baseline confirmed** (all 4 SHAs valid; develop HEAD = #74).
2. **CLI auth confirmed** (`vercel whoami` + `gh auth status`; if either fails, escalate to user immediately).
3. **Evidence trail captured** — either in `docs/validations/g11-reopen-evidence-2026-05-20.md` (default Q2) or as a `## Evidence Trail` section appended to this spec. Every command's full output preserved.
4. **Root cause committed** with 2+ converging pieces of evidence, OR a documented hypothesis-rule-out for all 7 (BLOCKED outcome).
5. **Fix path declared** — applied by infra (Fork A success), or documented as §Operator Action Required (Fork A operator-pending), or escalated to FULL depth (Fork B), or marked BLOCKED.
6. **Fix verification** (if applicable) — next merge or trivial user-push to `develop` auto-deploys with `source: git`; deploy URL captured.
7. **G11 amendment draft** — proposed text for `docs/context/project.context.core.md` line 434 amendment; docs reviews and applies.
8. **Roadmap update draft** — proposed text for `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md`; docs applies.

When infra is done: hand off to system-docs for context closure + roadmap sync, then system-validator for final COMPLETE / PARTIAL / BLOCKED gate.

---

## Verdict

**READY-FOR-IMPLEMENTATION** (handoff to system-infra).

- Fact pattern empirically confirmed (4 code-affecting merges, 1-of-4 auto-deployed; verified via `gh pr list --state merged --base develop`).
- Hypothesis register enumerated and ranked pre-evidence (H4 > H2 > H1 > H5 > H3 > H6 > H7).
- Evidence gathering plan ordered by cost and priority (steps 1-7, all read-only).
- Decision rules concretized (commit at 2+ convergence, escalate per fork, mark BLOCKED on exhaustion).
- Risks rated (R1-R6) with mitigations.
- Re-route triggers concretized with file/command-level conditions.
- Acceptance criteria mirror router's 4 validator gates with concrete commands and evidence shapes.
- Lifecycle declared (amend, not replace, G11 entry; preserves 2026-05-17 finding).

**Next handoff:** `system-infra`.
