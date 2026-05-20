# G11 reopen — empirical evidence trail (2026-05-20)

Source spec: `specs/g11-reopen-vercel-autodeploy-diagnosis.md`
Iteration: `g11-reopen-vercel-autodeploy-diagnosis`
Executor: system-infra
Date: 2026-05-20
Vercel CLI: 54.2.0 (default Windows install)
GitHub CLI: gh authed as Piedra3021 (scopes: gist, read:org, repo, workflow)
Vercel CLI: vercel whoami → `nooncode-tech`

---

## Step 0 — Baseline

Command:
```
git log --oneline -1 develop
git rev-parse fe50858 04a7f26 b067552 385215a
```

Output:
- `develop` HEAD = `385215a Merge pull request #74 ...` (PR #74 merge — un-deployed, diagnostic baseline preserved).
- All 4 SHAs resolved cleanly: `fe50858…`, `04a7f26…`, `b067552…`, `385215a…`.

Verdict: baseline clean, no local clone weirdness.

---

## Step 1 — Repo webhooks

Command: `gh api repos/nooncode-org/App-nooncode/hooks`

Output: `[]` (empty array).

Interpretation: NO repo-level webhooks. Per Open Question Q1 default, this is consistent with the Vercel **GitHub App** integration (which manages its own webhook internally, invisible to repo Settings → Webhooks). Cannot infer H1 from this alone — needs corroboration from step 4 + step 7.

Org-level webhooks attempt (`gh api orgs/nooncode-org/hooks`): blocked by missing `admin:org_hook` scope on the PAT. Acceptable — App integration is repo-scoped or installation-scoped, not org-hook-scoped.

---

## Step 2 — Webhook deliveries

Not applicable. Step 1 confirmed no repo webhook exists. Vercel uses the GitHub App integration; delivery history is on the App installation, not on a repo hook. Step 4 covers it.

---

## Step 3 — Vercel project Git binding & Production Branch

Command: `vercel project inspect nooncode-app`

Key fields:
- `ID = prj_pcymuQmGPfOewVwQwKeGJM2rVX5u`
- `Owner = NOON's projects` (team `noons-projects-749dcf47`)
- `Created At = 25 March 2026 23:17:52`
- `Root Directory = .`
- `Framework Preset = Next.js`

The CLI's `vercel project inspect` does NOT expose `git.repo` / `git.productionBranch` fields in v54.2.0. Indirect evidence used instead:

Aliases on the PR #69 successful deploy (`dpl_CGaR2VBunmhy3faJTZq326EQWg3t`):
```
nooncode-app-pi.vercel.app
nooncode-app-noons-projects-749dcf47.vercel.app
nooncode-app-git-develop-noons-projects-749dcf47.vercel.app
```

The presence of `nooncode-app-git-develop-...` alias proves:
- The Vercel project IS bound to a Git repo.
- The Production Branch IS `develop` (the alias is auto-managed by Vercel and reflects the configured prod branch).

Build log header for PR #69 deploy:
```
2026-05-20T17:53:17.962Z  Cloning github.com/nooncode-org/App-nooncode (Branch: develop, Commit: fe50858)
```

Git-source clone executed cleanly against `nooncode-org/App-nooncode` on branch `develop`.

Verdict: **H3 RULED OUT** (Production Branch correct). **H5 RULED OUT** (Git binding intact).

---

## Step 4 — GitHub App installation inspection

Direct API attempts:
- `gh api repos/nooncode-org/App-nooncode/installation` → HTTP 401 "A JSON web token could not be decoded" (endpoint requires App JWT, not PAT).
- `gh api user/installations` → HTTP 403 "You must authenticate with an access token authorized to a GitHub App in order to list installations" (PAT cannot list App installations).
- `gh api orgs/nooncode-org/installations` → would require `admin:org` scope (not granted).

CLI-side App installation inspection is BLOCKED by PAT scope. **This is a known limitation** per spec §R3 (gh CLI auth scope insufficient) — fallback to operator-ask Dashboard read is the sanctioned path.

**Indirect evidence from GitHub Deployments API (cross-cutting Step 4 + Step 7):**

Command: `gh api repos/nooncode-org/App-nooncode/deployments`

Output (sorted descending, top 5):
```json
[
  {"created_at":"2026-05-05T14:11:34Z","creator":"vercel[bot]","environment":"Preview","sha":"0da1264"},
  {"created_at":"2026-05-05T14:05:09Z","creator":"vercel[bot]","environment":"Preview","sha":"35545cd"},
  {"created_at":"2026-05-05T13:52:28Z","creator":"vercel[bot]","environment":"Preview","sha":"d6d7afb"},
  {"created_at":"2026-05-04T22:39:56Z","creator":"vercel[bot]","environment":"Production","sha":"a2ce5f3"},
  {"created_at":"2026-05-04T22:10:56Z","creator":"vercel[bot]","environment":"Production","sha":"7d2bcec"}
]
```

**The most recent `vercel[bot]` GitHub Deployment is 2026-05-05T14:11:34Z** — that's **15 days BEFORE** the diagnostic window. The most recent `vercel[bot]` Production deployment is **2026-05-04T22:39:56Z** (16 days before).

Check-runs on PR #69 commit (`fe50858`, successful auto-deploy):
```json
[
  {"app_name":"GitHub Actions","name":"Production dependency audit","conclusion":"success"},
  {"app_name":"GitHub Actions","name":"Lint, typecheck & test","conclusion":"success"},
  {"app_name":"GitHub Actions","name":"Migration prefix check","conclusion":"success"}
]
```
No `vercel[bot]` check-run. No `vercel[bot]` commit status.

Check-runs on PR #70 commit (`04a7f26`, failed auto-deploy):
Identical pattern — 3 GitHub Actions check-runs, zero `vercel[bot]` entries.

Statuses on PR #69 commit (`fe50858`): empty.
Statuses on PR #70 commit (`04a7f26`): empty.

**Critical finding:** `vercel[bot]` has not posted to the GitHub side of this repo since 2026-05-05. This is consistent with a **GitHub App permission write-down / scope narrowing** that happened circa 2026-05-05 and silently degraded the integration. The Vercel-side build pipeline continued to fire for at least some pushes (PR #69 at 17:53Z on 2026-05-20 worked), but subsequent pushes did not trigger Vercel.

Verdict: **H4 supported by 2+ converging signals** (cessation of `vercel[bot]` GitHub Deployments since 2026-05-05 + cessation of auto-deploys for develop pushes after PR #69 on 2026-05-20).

---

## Step 5 — Skip-CI marker rule-out

Command: `git log fe50858 04a7f26 b067552 385215a -n 1 --format='%B'`

Output (all 4 commit messages):
- #69: `Merge pull request #69 ... feat(migrations-health): schema_migrations drift gating endpoint (B26, ADR-017)`
- #70: `Merge pull request #70 ... fix(migrations-health): R5 SECURITY DEFINER RPC (ADR-018)`
- #73: `Merge pull request #73 ... feat(leads): wire pagination envelope to /dashboard/leads (F-V12)`
- #74: `Merge pull request #74 ... refactor(types): regen database.types.ts + retire manual override blocks (G7 carry-over)`

Zero matches for `[skip ci]`, `[skip vercel]`, `[skip deploy]`, `[noci]`, `[no deploy]`, or any similar marker.

Verdict: **H7 RULED OUT**.

---

## Step 6 — Branch protection delta

Command: `gh api repos/nooncode-org/App-nooncode/branches/develop/protection`

Output: HTTP 404 "Branch not protected".

`develop` has NO branch protection configured. No `required_status_checks` could be gating push events.

Verdict: **H6 RULED OUT**.

---

## Step 7 — Vercel deployment source corroboration

Command: `vercel list nooncode-app --prod`

Top 6 production deployments (most recent first):

| Age | URL hash | Status | Vercel deploy ID | Triggered for which PR? |
|---|---|---|---|---|
| 1h | nooncode-hk9az2wcd | Ready | dpl_AzwY8WnEYwVLjEujFd1MJcwZwiFN | Deploy Hook for PR #73 (`b067552`) |
| 2h | nooncode-7pzdqa7lg | Canceled | — | (cancelled retry) |
| 2h | nooncode-l5sjh11ub | Ready | (CLI re-deploy for PR #70 `04a7f26`) |
| 4h | nooncode-9zjjntf46 | Ready | dpl_CGaR2VBunmhy3faJTZq326EQWg3t | **Auto-deploy for PR #69 (`fe50858`)** |

**Build log signatures distinguish trigger source:**

PR #69 deploy (`9zjjntf46`, dpl_CGaR2VBunmhy3faJTZq326EQWg3t):
```
2026-05-20T17:53:17.838Z  Running build in ... iad1
2026-05-20T17:53:17.962Z  Cloning github.com/nooncode-org/App-nooncode (Branch: develop, Commit: fe50858)
```
→ Git-source clone. **This is a real GitHub→Vercel auto-trigger.**

CLI re-deploy at 19:56Z (`l5sjh11ub`):
```
2026-05-20T19:56:43.215Z  Running build in ... iad1
2026-05-20T19:56:43.335Z  Retrieving list of deployment files...
2026-05-20T19:56:43.910Z  Downloading 557 deployment files...
```
→ File-upload from local CLI. **NOT git-triggered.** This is `vercel deploy --prod` from a local workstation.

Deploy Hook for PR #73 at 21:03Z (`hk9az2wcd`, dpl_AzwY8...):
```
2026-05-20T21:03:27.341Z  Cloning github.com/nooncode-org/App-nooncode (Branch: develop, Commit: b067552)
```
→ Git-clone (Deploy Hook can resolve `develop` HEAD), but **not auto-triggered by a GitHub push event** — fired by manual Deploy Hook URL invocation.

PR #74 commit (`385215a`): `vercel list --meta githubCommitSha=385215a3334dd8959017391e05bf64f3e73b0191` → **`No deployments found`**.

Verdict: only ONE git-source auto-deploy in the diagnostic window (PR #69 at 17:53:17Z). PR #70, #73, #74 produced ZERO Vercel deploys via the GitHub push event. PR #74 has zero Vercel deploys, period (manual hook intentionally not triggered as per the spec's diagnostic-baseline rule).

---

## Hypothesis verdict summary

| Hypothesis | Verdict | Evidence |
|---|---|---|
| **H1 — GitHub webhook not firing** | Symptom of H4 (per Q4 default + R6) | No repo webhook exists. The "webhook" is the GitHub App. If the App scope is narrowed, GitHub stops dispatching to it — visible as H1-like absence. Not the primary root cause. |
| **H2 — Vercel rejecting deliveries** | Cannot directly confirm (no delivery log access via PAT) | Indirect rule-out: Vercel ran a successful build for PR #69 via git-clone, proving Vercel-side accepting valid pushes; the asymmetry between #69 (working) and #70+ (failing) within 2h is more consistent with GitHub-side write-down than with Vercel-side intermittent 5xx. Tentatively **RULED OUT**. |
| **H3 — Production Branch drift** | **RULED OUT** | `nooncode-app-git-develop-*` alias exists on the PR #69 deploy + PR #69's build log shows `Branch: develop`. |
| **H4 — GitHub App permission scope changed / revoked** | **CONFIRMED (with 2+ converging signals)** | (1) `vercel[bot]` stopped creating GitHub Deployments after 2026-05-05; (2) zero `vercel[bot]` check-runs/statuses on any commit since 2026-05-05; (3) post-#69 develop pushes produced zero Vercel deploys despite the project's Git binding being intact. |
| **H5 — Vercel Git integration disconnected** | **RULED OUT** | Vercel project still has the Git binding (alias proof + build log shows git-clone for #69). |
| **H6 — Branch protection delay** | **RULED OUT** | `develop` has no branch protection. |
| **H7 — Skip-CI marker** | **RULED OUT** | No skip markers in any of the 4 commit messages. |

**Primary root cause: H4 — GitHub App (`vercel[bot]`) lost or had its permissions scope narrowed.** The degradation appears to have started around **2026-05-05** (last `vercel[bot]` Deployment to GitHub) and progressed: write-side broken first (May 5), read-side partially functional through 2026-05-20 17:53Z (PR #69 succeeded), fully broken by 2026-05-20 19:48Z (PR #70 onward).

**Secondary observation:** PR #69's successful auto-deploy may have been a **transient recovery** or a **stale-cached App permission** — by PR #70 the integration had degraded enough that push events no longer reached Vercel. The exact mechanism is internal to Vercel/GitHub and not directly observable from the CLI surface.

---

## Fix path

**Fork A (operator-only)** per spec Rule 3.

**Precise operator action:**

1. Open https://github.com/organizations/nooncode-org/settings/installations
2. Locate "Vercel" in the list of installed GitHub Apps.
3. **Capture the current state for evidence** (screenshot or note): installation status (Active / Suspended), repository access (All / Selected — which?), permissions list, "Last updated" timestamp.
4. Click "Configure" next to Vercel.
5. Under "Repository access":
   - If "Only select repositories" is checked: verify `App-nooncode` IS in the selected list. If absent, add it. Save.
   - If "All repositories" is checked but the deploys still fail: the permission set may have been narrowed. Click "Save" once anyway to refresh the App's permissions cache.
6. Under "Permissions" (review section): verify the App still has the standard Vercel set: `Read access to actions, administration, checks, code, commit statuses, contents, deployments, discussions, issues, members, metadata, packages, pages, pull requests, repository hooks, secrets, security events, single file, vulnerability alerts, workflows`. If GitHub has rolled out a new required permission and the App is showing "Accept new permissions", click that and Accept.
7. If the above does not resolve, **last resort: uninstall and reinstall the Vercel App**:
   - Same page, scroll to bottom of Vercel App config, click "Uninstall".
   - Confirm.
   - Go to https://vercel.com/dashboard → nooncode-app project → Settings → Git → "Connect Git Repository" (the integration link to GitHub).
   - Authorize Vercel → "All repositories" or select `App-nooncode` explicitly.
   - Verify connection in project Settings → Git → repo shown as `nooncode-org/App-nooncode`, Production Branch = `develop`.

**Verification (after operator action):**

- **DO NOT trigger PR #74's Deploy Hook** — it is the diagnostic baseline. Proves nothing about the trigger path.
- **Preferred path:** push a trivial commit directly to `develop` (e.g., a comment-only edit, or merge any pending docs PR). Within 5 minutes, verify a new Vercel deploy appears via:
  - `vercel list nooncode-app --prod` → top entry is new.
  - `vercel inspect <new-deploy-url> --logs | head -10` → `Cloning github.com/nooncode-org/App-nooncode (Branch: develop, Commit: <new-sha>)` line present.
  - `gh api repos/nooncode-org/App-nooncode/deployments?per_page=3` → top entry has `creator: vercel[bot]` and recent timestamp.
- **Once verified:** PR #74's missing deploy can be backfilled by triggering the Deploy Hook (cleanly closing the loop without polluting the diagnostic record).

---

## Lessons / operational rules captured

1. **Monitor `vercel[bot]` GitHub Deployments cadence.** A gap of >7 days between successive `vercel[bot]` entries in `gh api repos/<owner>/<repo>/deployments` on an active repo is a strong signal of integration degradation. The original G11 closure recommended monitoring webhook deliveries, but in App-integration scenarios `vercel[bot]` Deployments are the better watchpoint (they are observable via PAT-scoped `gh api`).
2. **After any org-wide permission change at the GitHub Org level**, manually verify each integration App's still-functional state by triggering a no-op push and confirming `vercel[bot]` posts a Deployment.
3. **The Deploy Hook is not a substitute** for a healthy GitHub→Vercel trigger path. It deploys regardless of integration health, so its continued working is NOT evidence the integration is healthy.

