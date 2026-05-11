# spec.md — fase-0-b4-adr-006-execution

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-10
- Session ID: fase-0-b4-adr-006-execution
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-infra → system-validator
- Router mode: Infra-Deploy
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope the execution of ADR-006 (migration prefix collisions for 0024/0025/0026/0027) into a bounded iteration; verify the remote `supabase_migrations.schema_migrations` ledger; decide branch A (safe to rename) vs branch B (ledger already contains one or more colliding filenames → reconciliation required, no rename). Analysis only — no file moves, no script edits, no context updates, no PR.
- Why this work matters now: ADR-006 records the decision but defers execution pending ledger verification. The Active risk for migration collisions in `docs/context/project.context.core.md` cannot be removed until execution ships. The CI guard at `scripts/check-migrations.mjs` still carries a grandfathered allowlist and a comment referencing internal plan codes ("R1.1 (Sprint 2)") which violate the durable-truth memory rule.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: no (per router handoff `load_full_context: false`)
- `project.context.history.md` reviewed: no
- Reason `full` was included if applicable: not required for an infra-deploy iteration touching only filenames and one script.
- Reason `history` was included if applicable: not required.

### ROUTER DECISION
- Why this mode is correct: the work changes runtime apply-order semantics for migrations on every environment that talks to Supabase and updates CI behavior; that is infra-shaped, not contract-shaped.
- Why this depth is correct: full because the decision branches on remote state and a wrong call corrupts the migration ledger across environments.
- Why this skill is the right active skill now: the iteration cannot route to infra until the ledger-state precondition is verified and the rename/reconcile branch is chosen. Analysis is the gating step.
- Reroute already known at start: yes (partial)
- If yes, explain: ledger verification access path is not currently available autonomously (see Risks). If MCP cannot be authorized by the user during this session, Analysis exits with a clear handoff to system-infra plus an explicit precondition that infra must satisfy before doing anything destructive.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules".
- Contracts or architecture inputs available: `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` (the decision being executed), `docs/audits/v3-phase-0-audit.md` §3 F-04 + §4.5 (the catalogued conflict).
- Relevant handoffs received: router handoff verbatim in the user message that opened this iteration.
- External dependencies or environment assumptions: Supabase project `pdotsdahsrnnsoroxbfe` (per core context) is the remote primary. Whether a staging Supabase project exists is unconfirmed; investigated below.

### RISK SNAPSHOT
- Known risks before starting: ledger may already contain one or more of the 8 filenames, in which case rename is unsafe; access to ledger via MCP, PAT, or linked CLI is not currently available autonomously; staging project existence is unconfirmed.
- Known blockers before starting: ledger verification is the hard precondition. Without it, branch decision cannot be finalized.
- Known assumptions before starting: the 8 filenames are exactly the ones listed in ADR-006 and `scripts/check-migrations.mjs`; the highest applied prefix is `0042`.

### CONTINUITY NOTES
- Previous session relevant to this one: ADR-006 land iteration (commit `051db2f`, merged via PR #11) recorded the decision and the deferred-execution conditions. Sister ADR-005 landed in the same Pre-Phase batch.
- Expected next skill after this session if all goes well: system-infra (if branch A is feasible and ledger access is available) or system-validator with a BLOCKED verdict (if no access path is restored in this session).

---

## Task Summary

Execute the deferred portion of ADR-006: either (A) rename the 8 colliding migration filenames in `supabase/migrations/` to fresh monotonic prefixes starting at `0043` in their actual temporal apply order, atomically update every repo reference plus `scripts/check-migrations.mjs` (empty `KNOWN_COLLISION_FILES`, rewrite the "R1.1 (Sprint 2)" comment to ADR-006 only), open a PR (no auto-merge), confirm CI green, then update ADR-006 status to "Executed" and remove the Active risk for migration collisions from `docs/context/project.context.core.md`; or (B) if any of the 8 filenames is already registered in `supabase_migrations.schema_migrations` in any environment, block the rename, leave the Active risk in place, and amend ADR-006 with a `Reconciliation required` section that lists exactly which (`version`, `name`) rows exist in which environment plus the recommended reconciliation path.

Analysis output here is the gated spec, the branch decision (or the BLOCKED verdict if the precondition cannot be verified in this session), and a complete handoff payload for `system-infra`. **Analysis itself performs no rename, no script edit, no context update, and opens no PR.**

---

## Scope Boundary

### Included
- The 8 migration filenames already enumerated in ADR-006 and in `scripts/check-migrations.mjs` `KNOWN_COLLISION_FILES`.
- The CI guard `scripts/check-migrations.mjs` (clearing `KNOWN_COLLISION_FILES`, rewriting the plan-ref comment, no behavioral change for the new-collision detection branch).
- ADR-006 status section (the "Currently BLOCKED" subsection becomes the executed-state record, OR a new "Reconciliation required" subsection if branch B).
- `docs/context/project.context.core.md` Active risk line for migration prefix collisions (removed under branch A; left in place with a one-line state update under branch B).
- Every other repo location that references any of the 8 filenames by name and must move in lockstep with a rename (catalogued under "Affected Files / Modules" below).
- One PR against `develop`. Not merged by Claude. User merges per memory rule.

### Excluded
- **Migration contents.** Only filenames change. SQL inside the 8 files is not touched.
- **All non-colliding migrations** `0001`–`0023`, `0028`–`0042`. Untouched.
- **Remote ledger state.** The remote `supabase_migrations.schema_migrations` table is never rewritten. The whole conditional in ADR-006 exists to prevent that. If the ledger registered any of the 8 filenames already, the rename is blocked.
- **CI workflow** `.github/workflows/ci.yml`. The migration check step continues to run unchanged; only the script the step invokes is edited.
- **Wallet bridge unification (F-02), seller-fee selector (F-05), AI MVP pipeline (F-06), seller map (F-09), and any v3 spec phase work.** All deferred. This iteration is bounded to the prefix-rename mechanics.
- **Renaming files that share a phase code in their filename but do not collide on prefix** (e.g. `0027_phase_3_proposal_lifecycle` and `0028_phase_9b_payments_insert_policy`). Out of scope.
- **Reintroducing R-codes, Sprint numbers, or plan-IDs into durable docs, code comments, or commit messages.** Forbidden by router handoff and by user memory rule. The script comment rewrite must reference only ADR-006.
- **Auto-merging the resulting PR.** Forbidden by router handoff and by user memory rule.
- **Absolute local filesystem paths in any committed file** (docs, code comments, commit message, PR body). Forbidden by router handoff.
- **The `docs/business/archive/ROADMAP_NOON_APP.md` reference and the two `docs/context/delivery-summary.md` references** can be optionally aligned during the rename PR, but they are archived/derivative docs, not active operational truth. Treated as "update if cheap, defer otherwise". They are out of the success criterion.

---

## Affected Files / Modules

Inventory of every repo location that names one or more of the 8 colliding filenames by full filename. Paths are relative to repo root.

| Location | Refs | Branch A action | Branch B action |
|---|---|---|---|
| `supabase/migrations/0024_phase_3a_monetary_wallet_foundation.sql` | the file itself | rename to fresh prefix (see prefix-mapping note below) | leave |
| `supabase/migrations/0024_phase_5a_prototype_settings_admin_write.sql` | the file itself | rename to fresh prefix | leave |
| `supabase/migrations/0025_phase_3a_bridge_wallet_compatibility.sql` | the file itself | rename to fresh prefix | leave |
| `supabase/migrations/0025_phase_3a_leads_geo_location.sql` | the file itself | rename to fresh prefix | leave |
| `supabase/migrations/0026_phase_3b_earnings_backend.sql` | the file itself | rename to fresh prefix | leave |
| `supabase/migrations/0026_phase_9a_stripe_payments.sql` | the file itself | rename to fresh prefix | leave |
| `supabase/migrations/0027_phase_10a_commissions.sql` | the file itself | rename to fresh prefix | leave |
| `supabase/migrations/0027_phase_3_proposal_lifecycle.sql` | the file itself | rename to fresh prefix | leave |
| `scripts/check-migrations.mjs` | 8 filename entries in `KNOWN_COLLISION_FILES`; 1 comment block with "R1.1 (Sprint 2)"; 1 console message with "pending R1.1" | empty `KNOWN_COLLISION_FILES`, rewrite comment to reference only ADR-006, replace `pending R1.1` console string with a durable-truth phrasing (e.g. `pending ADR-006 execution`) — note: after `KNOWN_COLLISION_FILES` is empty, the grandfathered branch becomes dead code; either remove the branch or keep it as a no-op with a comment that future collisions are forbidden | no edit |
| `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` | 4 filename pairs in §Context; references in §Conditions, §When executed, §Cross-references | update "Status" line; rewrite "Currently BLOCKED" subsection to an "Executed on YYYY-MM-DD" subsection; record the actual `0043..0050` mapping in temporal order with the ledger evidence that justifies it | update "Status" line to record reconciliation-required; add a "Reconciliation required" subsection that lists the registered (`version`, `name`) rows per environment and the recommended reconciliation path |
| `docs/context/project.context.core.md` | Active risk line for migration prefix collisions; one operating note in "Confirmed product/data posture" referencing migrations 0024+0025 in FASE 1; one note for migration 0024+0025 evidence; bridge-wallet line referencing 0025; one bullet for 0023 (unrelated) | remove the Active risk line for migration prefix collisions; update the FASE 1 narrative to use the new filenames; update the bridge-wallet line accordingly | leave Active risk; append a one-line state update noting which environment registered which colliding filenames |
| `docs/audits/v3-phase-0-audit.md` | F-04 finding row + §4.5 reconciliation table with 8 entries + §5.1 PR0b bullet + §6 Pre-Phase note + §7 Q3 + cross-references in module-classification rows for wallet, earnings, payments, proposals, leads-geo | this is an audit snapshot; the audit is read-only by design and the rename does not invalidate its findings — the post-rename names will replace the pre-rename names in any new audit, but the current audit is a dated record. Leave audit unmodified unless infra step explicitly elects to amend it (out of success criterion either way) | leave audit unmodified |
| `docs/business/archive/ROADMAP_NOON_APP.md` | 1 filename reference (`0024_phase_3a_monetary_wallet_foundation.sql`) | archived doc — update if trivial, otherwise defer (out of success criterion) | no edit |
| `docs/context/delivery-summary.md` | 2 filename references (`0026_phase_9a_stripe_payments.sql`, `0027_phase_10a_commissions.sql`) | derivative doc — update if trivial, otherwise defer (out of success criterion) | no edit |
| `supabase/all_migrations.sql` | depends on whether it's a generated concatenation or hand-maintained — infra step must inspect before committing | regenerate if generated, otherwise update names in lockstep | no edit |
| `.github/workflows/ci.yml` | no filename references; the `Migration prefix check` job invokes `scripts/check-migrations.mjs` | no edit | no edit |

**Note on prefix-mapping**: The exact `0024_xxx → 0043_xxx` mapping cannot be finalized in Analysis because the handoff explicitly requires temporal order to come from the ledger's `executed_at`, not from filename order or git-add time. Git-add timeline (informational only, not authoritative):
- `2026-04-18 23:42:50 -0600` (commit `17a8a51` "primera versión"): `0024_phase_5a_prototype_settings_admin_write`, `0025_phase_3a_leads_geo_location`, `0026_phase_9a_stripe_payments`, `0027_phase_10a_commissions`
- `2026-04-19 22:48:39 -0600` (commit `9d659f4` "FASE 1 + FASE 2"): `0024_phase_3a_monetary_wallet_foundation`, `0025_phase_3a_bridge_wallet_compatibility`, `0026_phase_3b_earnings_backend`
- `2026-04-20 00:08:55 -0600` (commit `2c27557` "FASE 3"): `0027_phase_3_proposal_lifecycle`

Git-add time is not the same as apply time. The `0024_phase_5a` / `0025_phase_3a_leads_geo` / `0026_phase_9a` / `0027_phase_10a` group was imported wholesale in one commit and almost certainly does not reflect the order in which they were first applied to the dev database. Infra must use ledger `version` ordering (and any `executed_at`-equivalent column the supabase ledger exposes) as the only authoritative input.

---

## Dependencies

| Dependency | Class | Status | Impact if missing | Owner |
|---|---|---|---|---|
| Read access to `supabase_migrations.schema_migrations` on project `pdotsdahsrnnsoroxbfe` | infra | **Not currently available autonomously**; see Risks | Branch decision cannot be finalized; iteration verdict is BLOCKED until restored | Pedro (user) — must either complete the Supabase MCP OAuth flow, paste a Supabase PAT into env, link the Supabase CLI to the project, or paste the SQL Editor query result |
| Same access for any staging Supabase project | infra | **Existence unconfirmed**; see Open Questions | Branch B reconciliation could miss an env-specific row, leaving the rename unsafe in that env | Pedro (user) |
| Existing CI guard script `scripts/check-migrations.mjs` | internal | Present, working, runs on every PR/push to `develop`/`master` | None for verification; this is what we are editing in branch A | n/a |
| GitHub `gh` CLI for PR opening | infra | Available (`gh` is in `$PATH` per environment) | PR cannot be opened without `gh` or browser-side creation; not relevant for Analysis | system-infra |
| Project memory rule against R-codes / Sprint numbers / plan-IDs in durable docs and code comments | contract | Active | The script comment rewrite must honor this — Analysis records it as a hard constraint | n/a |
| Project memory rule against auto-merging PRs | contract | Active | Infra must stop after opening the PR; user merges | n/a |
| Project rule against absolute local filesystem paths in committed files | contract | Active (router handoff) | Infra commit message, PR body, and any updated context must use relative paths | n/a |
| ADR-006 itself | contract | Landed at commit `051db2f` | The execution decision and conditions live in this ADR; infra updates the status section atomically with the rename or with the reconciliation record | n/a |

---

## Assumptions

1. The exhaustive set of colliding filenames is exactly the 8 in `KNOWN_COLLISION_FILES`. If a new collision is introduced between this spec being authored and infra executing, the CI guard will reject it and infra will pause to amend scope.
2. The current highest applied prefix on every environment is `0042`. Any environment whose ledger has rows beyond `0042` will require infra to pick a fresh starting prefix above the highest observed `version`, not a hardcoded `0043`. (Analysis assumes `0043` because the repo top is `0042_phase_17b_wallet_maxwell_rpc_hardening.sql` and no migrations have been added since.)
3. The Supabase migration ledger uses the filename's 4-digit prefix as the `version` column value (e.g. `version='0024'`). This is the standard Supabase CLI behavior. If the local installation uses a different versioning style (timestamp-based, etc.), the verification query has to be adjusted. Analysis assumes the standard prefix-based versioning because that is what every `0001`–`0042` filename in this repo uses.
4. The migration files were authored in a setting where the developer was alone in the dev database (i.e., no other contributor applied any of these 8 against the remote between authoring and now). Analysis treats this as likely true given the single-contributor pattern visible in `git log`, but ledger query is still the only safe verification.
5. The infra step's prefix mapping `(old_filename → new_prefix)` will be a strict bijection — exactly one new prefix per old filename, in strict ascending order from a fresh starting prefix. No prefix is reused, no prefix is skipped, and the relative apply order of the 8 files in the new prefix sequence equals their relative apply order in the ledger.
6. `supabase/all_migrations.sql` either is a generated concatenation (regenerated as part of the rename) or it does not exist as a load-bearing artifact. Infra must inspect and decide.

---

## Open Questions

These do not block bounded progress (Analysis can still scope and route), but they will be answered by infra before any rename ships:

1. **Is there a staging Supabase project for this app, or only one prod-shaped remote (`pdotsdahsrnnsoroxbfe`) plus local dev?** Core context lists only the one remote. Branch B's reconciliation must enumerate every env that has ever run `supabase db push`; if staging exists, its ledger must be checked too. Best evidence in repo: `.env.local` references `pdotsdahsrnnsoroxbfe`, `.env.example` documents a single set of `NEXT_PUBLIC_SUPABASE_URL`/keys, and there is no `supabase.staging.*` or equivalent. Default assumption: one remote primary + local developer machines.
2. **Will the local developer machine's ledger ever have been independently populated against a different Supabase project (e.g. an early-stage project before the current one)?** Old local applications can leave rows that don't exist on the current remote. Branch B's reconciliation must also check `supabase_migrations.schema_migrations` on whatever Supabase the developer last ran `supabase db push` against.
3. **Does the `supabase_migrations.schema_migrations` table on `pdotsdahsrnnsoroxbfe` have an `executed_at`-equivalent column?** Supabase has historically called this `version` (sortable) plus optionally `inserted_at`. Infra must capture both for the temporal-order derivation.
4. **Should the `supabase/all_migrations.sql` concatenation be regenerated post-rename, kept manually in sync, or retired?** This is an infra decision and out of Analysis scope.
5. **After `KNOWN_COLLISION_FILES` is empty, should the grandfathered branch in `scripts/check-migrations.mjs` be deleted entirely (dead code) or left as a no-op with a forward-compat comment?** Either choice satisfies the success criterion. Infra picks.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| Remote ledger already registered one or more of the 8 filenames, making rename unsafe | Medium | High | **High** | Branch B is the explicit path. Do not rename. Record the registered (`version`, `name`) rows in ADR-006 and propose reconciliation. |
| Ledger access cannot be obtained in this session (MCP OAuth requires user browser, no PAT in env, no linked CLI) | **High right now** | High | **High** | Analysis cannot finalize the branch decision; infra must satisfy the precondition before doing anything destructive. If infra also cannot obtain access, the iteration closes BLOCKED and the Active risk stays in core context. |
| Renaming a file that has a `version='0024'` row on remote desynchronizes the ledger and breaks `supabase db push` (orphan row + duplicate "new" row) | Low (if branch A is chosen correctly) | Critical (production migration ledger corruption) | **Critical** | Hard precondition: do not enter branch A unless the ledger has been queried and confirmed empty of the 8 filenames. ADR-006 §Conditions already encodes this. |
| Renaming changes apply order in a fresh local clone that does not yet have any ledger rows | Low | Medium — apply order becomes monotonic by new prefix; this is the explicit fix the ADR wants, but the order chosen must match the original apply order so fresh clones replay the schema identically | **Medium** | Use ledger `version` order (and any `inserted_at`-style column) as the source of truth for the new-prefix ordering. Do not assume git-add order. |
| Two pairs share a "Phase 3A" string in the filename and one pair shares "Phase 5A" / "Phase 3B" / "Phase 9A" / "Phase 10A" / "Phase 3" — these phase-tags in the filenames are not load-bearing for any code path, but renaming will produce a filename whose internal phase tag is preserved while only the numeric prefix changes; future readers may find the phase tag confusing once the prefix and the in-file `Phase NA` comment are out of step | Medium | Low | **Low** | The phase tag is informational. The rename is mechanical (prefix only). Phase-tag cleanup is not in scope. Note in ADR-006 update. |
| Editing `scripts/check-migrations.mjs` comment without a code change could be missed in code review | Low | Low | **Low** | Make the comment and `KNOWN_COLLISION_FILES` emptying part of the same commit as the file renames. CI will then run the post-state script against the post-state filenames. |
| `docs/context/project.context.core.md` carries an internal absolute path on line 7 (`C:\Users\white\Documents\Codex\...`) — this is a pre-existing finding (F-14) and not in this iteration's scope, but infra editing this file must be careful not to introduce a new absolute path elsewhere | Low | Low | **Low** | Infra updates only the Active risk line + the FASE 1 + bridge-wallet narrative bullets, using relative paths. F-14 cleanup remains deferred. |
| A future contributor adds a new migration with a colliding prefix between Analysis and Infra, in a way the spec did not foresee | Low | Medium | **Low** | CI guard already rejects this on PR. Infra rebases before opening the PR. |
| The handoff carries an instruction not to re-introduce the grandfathered allowlist after branch A — but if branch B is taken, the grandfathered allowlist stays as-is | n/a | n/a | n/a (informational) | Branch B path explicitly leaves `KNOWN_COLLISION_FILES` populated, and the "do not re-introduce" rule applies only to branch A's post-execution future state. |

---

## Recommended Route Depth (Full / Lite)
- **Full.** Branch decision rests on remote ledger state; a wrong call corrupts the migration ledger. The CI guard edit is small but load-bearing. The downstream PR touches docs that Validator measures against. None of this fits Lite depth.

---

## Chunking Decision
- **Single iteration, two-skill chain.** Infra performs everything in one PR: file renames + script edit + ADR-006 status update + core context Active risk removal (branch A), or ADR-006 reconciliation amendment + core context state update (branch B). Validator gates the final verdict.
- If during Infra a new structural risk surfaces (e.g. `all_migrations.sql` turns out to require manual reordering, or the ledger reveals partial registration for some but not all 8 filenames), Infra must stop and reroute back to Analysis for a chunking decision instead of forcing the iteration through.

---

## Branch decision (this Analysis)

**BLOCKED on hard precondition.**

The ledger verification query against project `pdotsdahsrnnsoroxbfe` could not be executed autonomously in this session. Evidence:

- Supabase MCP server is installed but unauthorized. Calling `mcp__supabase__list_projects` returned `Unauthorized. Please provide a valid access token to the MCP server via the --access-token flag or SUPABASE_ACCESS_TOKEN.`
- `.env.local` contains `SUPABASE_SERVICE_ROLE_KEY` but does **not** contain a `SUPABASE_ACCESS_TOKEN` (PAT). The service-role key authenticates against PostgREST, not the Supabase Management API or the MCP server.
- PostgREST schema-allowlist blocks direct REST reads against `supabase_migrations`: `GET /rest/v1/schema_migrations` with `Accept-Profile: supabase_migrations` returns `PGRST106 — Only the following schemas are exposed: public, graphql_public.`
- The Supabase CLI is not linked to the remote project. `supabase/.temp/` contains only `cli-latest`; no `project-ref` file. The handoff explicitly listed this as one of the "if no access path works, BLOCKED" conditions.
- No `psql` is available on this Windows shell.
- The MCP OAuth start tool produced an authorization URL but completing OAuth requires user-side browser interaction that cannot be done from within this Analysis. Authorization URL (handed off to user): `https://api.supabase.com/v1/oauth/authorize?response_type=code&client_id=c0902024-9fd1-4494-84ce-4720a1a31b08&...&redirect_uri=http%3A%2F%2Flocalhost%3A45777%2Fcallback&...`. After completing it in the browser, the callback URL can be pasted into `mcp__plugin_supabase_supabase__complete_authentication`.

Per the router handoff: *"if no access path works, iteration verdict is BLOCKED."* Analysis returns BLOCKED on the branch decision, not on the spec itself. The spec is complete and the downstream skill chain is ready to execute the moment ledger access exists.

If/when ledger access is restored — either by completing the MCP OAuth flow, pasting a Supabase PAT into `.env.local`, linking the Supabase CLI to `pdotsdahsrnnsoroxbfe`, or pasting the result of `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version` from the Supabase Dashboard SQL Editor — infra can immediately read the ledger, finalize branch A vs branch B, and execute. This Analysis spec is the authoritative input to that step; it does not need to be re-derived.

---

## Branch A — execution playbook (for system-infra, if precondition is satisfied and ledger is clean)

This section is the handoff content for the rename branch. Analysis does not execute it.

1. **Verify ledger.** Run `SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version` against `pdotsdahsrnnsoroxbfe`. Confirm no row has `version` in `{'0024','0025','0026','0027'}` with `name` matching any of the 8 colliding filenames (or any other indicator of registration; on some Supabase CLI versions the `name` column carries the suffix after the prefix). If staging exists, repeat the query there. Capture the full output (sanitized of any secret-bearing column) and quote it in the PR body.
2. **Derive temporal apply order** strictly from the ledger's `version` plus any `inserted_at`-equivalent column. Do not use git-add time, do not use filename order. Produce the explicit bijection:
   - `old_filename_1` → `0043_<same_suffix>.sql`
   - `old_filename_2` → `0044_<same_suffix>.sql`
   - ... through `0050_<same_suffix>.sql`
   The suffix (everything after the 4-digit prefix and underscore) is preserved verbatim. Only the prefix changes.
3. **Pick fresh starting prefix.** If the ledger top `version` is `>'0042'`, use the next free prefix above the highest observed `version`. If it is `'0042'`, use `0043` as the first new prefix.
4. **Rename the 8 files** atomically in one commit. Use `git mv` to preserve history.
5. **Edit `scripts/check-migrations.mjs`** in the same commit: empty `KNOWN_COLLISION_FILES` (replace with `new Set()` or remove the constant entirely), rewrite the comment block (lines 12–14) to reference only ADR-006, and replace the `pending R1.1` string in the `console.log` (line 55) with a durable-truth phrasing (e.g. `pending ADR-006 execution`) — though after the rename ships, the grandfathered branch becomes unreachable; infra picks whether to delete the branch entirely or leave it as a no-op with a forward-compat comment. The new-collision detection branch must continue to function unchanged.
6. **Update ADR-006 in the same commit.** Change `Status: Accepted (decision); execution deferred pending ledger verification` to `Status: Accepted; executed YYYY-MM-DD`. Replace the "Currently BLOCKED" subsection with an "Executed on YYYY-MM-DD" subsection that records the bijection (`old_filename → new_prefix`), the ledger query evidence (the query output as quoted SQL result), the environment(s) verified, and the date. Cross-references stay as-is.
7. **Update `docs/context/project.context.core.md` in the same commit.** Remove the `Active risk` bullet for migration prefix collisions. Update the FASE 1 narrative bullets that reference `0024`, `0025`, `0026` to the new prefixes. Update the bridge-wallet bullet that references `0025`. No new absolute paths anywhere.
8. **Inspect `supabase/all_migrations.sql`.** If it concatenates the 8 files, regenerate or hand-update in the same commit. If it doesn't reference them by filename, leave it.
9. **Open the PR** against `develop` with a clear title (`infra(migrations): execute ADR-006 — rename 8 colliding prefixes to 0043–0050`) and a body that quotes the ledger evidence and lists the bijection. **Do not merge.** Wait for CI green; user merges.
10. **Validator** then runs to confirm: (a) CI green, (b) `scripts/check-migrations.mjs` reports `0 collisions` instead of `8 grandfathered`, (c) ADR-006 status reflects executed, (d) Active risk for migration collisions is gone from `project.context.core.md`, (e) no absolute filesystem paths or plan-codes leaked into the diff, (f) the PR is open and not merged.

---

## Branch B — reconciliation playbook (for system-infra, if precondition is satisfied and ledger has any of the 8 filenames registered)

This section is the handoff content for the no-rename branch. Analysis does not execute it.

1. **Capture ledger evidence verbatim.** For each environment queried, record every row whose `name` matches any of the 8 filenames. Output should be a small table per environment showing `(version, name, inserted_at if available)`.
2. **Do not rename anything.** Leave `supabase/migrations/`, `scripts/check-migrations.mjs`, and the grandfathered allowlist exactly as-is.
3. **Amend ADR-006** in the same commit. Add a `## Reconciliation required` section that lists the ledger findings per environment and at least 2 viable reconciliation options with a recommended one. Suggested options Analysis surfaces (infra refines):
   - **Option B1 — ledger rewrite (high risk).** Manually update `supabase_migrations.schema_migrations` on each env to match new filenames after a local rename. Requires service-role SQL on production. Rejected unless every env can be quiesced. Risk is irrecoverable on a partial failure.
   - **Option B2 — additive convention only (low risk, status quo + freeze).** Accept the 4 historical collisions permanently. Keep the CI guard's `KNOWN_COLLISION_FILES` as a hard frozen set. Document in ADR-006 that the collisions are permanent. Active risk stays in context but downgrades from "execution pending" to "permanent convention; no new collisions allowed." Recommended.
   - **Option B3 — defer until a planned migration-history reconciliation iteration.** Status quo. ADR-006 reconciliation section records that the rename remains the preferred outcome but is now contingent on a dedicated reconciliation iteration that hasn't been scoped. Active risk stays ACTIVE.
4. **Update `docs/context/project.context.core.md` Active risk** with a one-line state update noting which environment registered which colliding filenames and which reconciliation option was selected (or that none was selected and the risk remains ACTIVE).
5. **Open the PR** against `develop` with title `docs(adrs): ADR-006 reconciliation required — ledger has registered colliding filenames`. **Do not merge.** User merges.
6. **Validator** confirms: (a) CI green (no script changes, so identical CI behavior expected), (b) ADR-006 status reflects reconciliation-required, (c) Active risk updated honestly, (d) no rename was performed, (e) PR is open and not merged.

---

## Success Criterion
The iteration succeeds when **either**:
- **Branch A**: the 8 colliding files in `supabase/migrations/` are renamed to fresh monotonic prefixes (≥ `0043`) in actual temporal apply order derived from the remote ledger; all repo references to those 8 filenames are updated in the same commit; `scripts/check-migrations.mjs` `KNOWN_COLLISION_FILES` is empty and its comment + console string no longer reference plan-codes or sprint names; ADR-006 status is `Executed YYYY-MM-DD` with the bijection recorded inline; `docs/context/project.context.core.md` Active risk for migration prefix collisions is removed; a PR is open against `develop` with CI green; the PR is **not merged** (user merges). **Or**
- **Branch B**: the ledger query is recorded in ADR-006's new `Reconciliation required` subsection naming the environment(s) and the (`version`, `name`) rows registered; no rename is performed; `docs/context/project.context.core.md` Active risk remains in place with a one-line state update; a PR is open against `develop` with CI green; the PR is **not merged**. Iteration verdict in this case is **PARTIAL** with an explicit next step recorded.

The success criterion is identical to the one in the router handoff. Analysis does not modify it.

---

## Recommended testing methodology
- **Integration-first** — there is no new application code path to drive with TDD or BDD. The verification surface is: (a) `node scripts/check-migrations.mjs` against the post-rename filesystem (must report `0 collisions`, `46 migration file(s) checked. No collisions.`), and (b) `git mv` history preservation on the 8 files, validated by `git log --follow` against any one of the new filenames. Validator inspects both. No new unit tests are required for this iteration.

---

## Definition of Done (this iteration)
- [ ] Branch decision is finalized (A or B) with quoted ledger evidence in the PR body.
- [ ] Branch A only: all 8 files renamed atomically; `KNOWN_COLLISION_FILES` empty; CI guard comment + console string rewritten to durable-truth phrasing; ADR-006 status `Executed`; Active risk removed from core context; FASE 1/bridge-wallet narrative bullets updated to new prefixes; `supabase/all_migrations.sql` inspected and aligned if it concatenates.
- [ ] Branch B only: ADR-006 reconciliation subsection records ledger findings per env and the chosen option; core context Active risk updated with one-line state note; no rename performed; no script edit performed.
- [ ] No R-codes / Sprint numbers / plan-IDs anywhere in the diff (docs or code comments).
- [ ] No absolute local filesystem paths anywhere in the diff.
- [ ] PR opened against `develop`, CI green, **not merged**.
- [ ] Validator returns COMPLETE (branch A) or PARTIAL with explicit next step (branch B).

---

## Chunking decision
Single iteration, two-skill chain (system-analysis → system-infra → system-validator). No chunking required because branch A is mechanically small (8 file renames + 1 script edit + 2 doc updates) and branch B is a single ADR amendment + 1 context line. Both fit one PR safely.

---

## Handoff payload to system-infra

- **Task summary**: execute ADR-006 (rename 8 colliding migration prefixes) conditioned on remote ledger state.
- **Scope boundary**: see "## Scope Boundary" above; the only files modifiable in branch A are the 8 migrations under `supabase/migrations/`, `scripts/check-migrations.mjs`, `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md`, `docs/context/project.context.core.md`, and optionally `supabase/all_migrations.sql`.
- **Included/excluded**: as enumerated above.
- **Affected files/modules**: as tabulated above.
- **Dependencies**: ledger access (currently unavailable autonomously; user-side action required to unblock); `gh` CLI; project memory rules (no R-codes, no auto-merge, no absolute paths).
- **Assumptions**: highest applied prefix is `0042`; the 8 filenames are exhaustive; Supabase uses prefix-based ledger versioning; one prod-shaped remote (`pdotsdahsrnnsoroxbfe`); see "## Assumptions".
- **Open questions**: staging existence; local-developer ledger history against past projects; column structure of `supabase_migrations.schema_migrations`; fate of `supabase/all_migrations.sql`; dead-code disposition of the grandfathered branch in the CI guard.
- **Risks that may alter design**: ledger may already register one or more of the 8 — that flips A to B; access path may not be restored — that closes the iteration BLOCKED; staging may exist and disagree with prod — that complicates B.
- **Recommended depth**: Full.
- **Chunking decision**: single iteration, no further splits required.
- **Success criterion**: see "## Success Criterion".
- **Spec location**: `specs/fase-0-b4-adr-006-execution.md` (this file).

---

## Forbidden constraints carried forward
- Auto-merging the resulting PR.
- Introducing R-codes / Sprint numbers / plan-IDs into `docs/context/*` or any durable repo doc or code comment.
- Using absolute local filesystem paths in docs, commit messages, or PR body.
- Modifying migration contents (only filenames change).
- Re-introducing the grandfathered allowlist after branch A.
- Rewriting the remote `supabase_migrations.schema_migrations` ledger under any branch.

---

## Spec lifecycle
- Status: **Approved (Analysis output)**; precondition for moving into Infra is ledger access.
- Author: system-analysis
- Date: 2026-05-10
- Supersedes: nothing
- Superseded by: nothing
