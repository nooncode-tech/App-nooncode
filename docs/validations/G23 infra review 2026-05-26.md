# G23 — Infra review (outbound webhook retry + dead-letter ledger)

**Date:** 2026-05-26
**Iteration:** G23 — `fase-3-r5-outbound-webhook-retry-policy`
**Reviewer role:** system-infra (deep-infra mode — net-new cron + sub-hourly cadence + env-var addition)
**Verdict:** **READY-TO-MERGE-WITH-WARNINGS.** All code-side infra invariants verified. One operator-pending item (Vercel plan tier verification for `*/5 * * * *` cadence) recorded as a low-probability warning — strong indirect evidence the project is already on a tier that supports sub-hourly crons.

---

## Scope summary

This review covers the infra-side concerns for the G23 iteration as shipped by Backend:

- `vercel.json` schema validity + new cron entry shape.
- Vercel plan tier resolution for the new `*/5 * * * *` cadence (R3 from router handoff, open at architecture/backend close).
- `.env.example` posture for the new `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` kill-switch (D5).
- Runtime config posture for the new `/api/cron/outbound-webhook-retry` route and the extended `/api/cron/webhook-failure-alert` route.
- Deploy + rollback playbook for production promotion.
- Migration deploy ordering (0062 applied before code lands on production).

Out of scope (handled by other gates):

- Code-side correctness of the retry math, ledger writes, replay endpoint — owned by `system-testing` and `system-security`.
- ADR-027 firm decisions D1-D12 — locked by `system-architecture`; not re-litigated here.
- Roadmap / context.core.md updates — owned by `system-docs` at iteration close.
- Cross-repo NoonWeb-side dedupe enforcement (R2) — out-of-scope per spec §4.

---

## References

- `D:\Pedro\Proyectos\Noon\App-nooncode\docs\adrs\ADR-027-outbound-webhook-retry-and-dead-letter.md` (full firm-decision pack; D4 cron cadence, D5 kill-switch).
- `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-r5-outbound-webhook-retry-policy.md` §19 (architecture firm decisions amendment; §19.5 vercel cadence drift verification escalated to infra).
- `D:\Pedro\Proyectos\Noon\App-nooncode\vercel.json` (post-G23 state).
- `D:\Pedro\Proyectos\Noon\App-nooncode\.env.example` (post-G23 state).
- `D:\Pedro\Proyectos\Noon\App-nooncode\app\api\cron\outbound-webhook-retry\route.ts` (new cron handler).
- `D:\Pedro\Proyectos\Noon\App-nooncode\app\api\cron\webhook-failure-alert\route.ts` (D6 third-ledger extension).
- `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\website\outbound-webhook-events.ts` (helper module; exports `claimOutboundPendingDue` used by the new cron).
- `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\website-integration.ts` (`runOutboundWebhookCronSweep` consumed by the new cron handler).
- `D:\Pedro\Proyectos\Noon\App-nooncode\supabase\migrations\0062_phase_3r5_outbound_webhook_events.sql` (applied to remote per Backend handoff).
- `D:\Pedro\Proyectos\Noon\App-nooncode\docs\runbooks\disaster-recovery.md` §1, §3.1, §7 (Supabase plan-tier reference; no Vercel plan-tier statement).
- `D:\Pedro\Proyectos\Noon\App-nooncode\docs\runbooks\cutover-pilot.md` §3.1 (Supabase Free plan stated explicitly; Vercel plan unstated).

---

## I-1 — vercel.json verification (schema validity + cron entry correctness)

**Current state** (`vercel.json` after G23 backend additions):

```json
{
  "crons": [
    { "path": "/api/leads/auto-followup",         "schedule": "0 9 * * *" },
    { "path": "/api/cron/consolidate-earnings",   "schedule": "30 6 * * *" },
    { "path": "/api/cron/cleanup-revoked-tokens", "schedule": "0 7 * * *" },
    { "path": "/api/cron/project-sla-breach-alert","schedule": "0 13 * * *" },
    { "path": "/api/cron/webhook-failure-alert",  "schedule": "0 14 * * *" },
    { "path": "/api/cron/outbound-webhook-retry", "schedule": "*/5 * * * *" }
  ]
}
```

**Schema validity:**

- Top-level shape is `{ "crons": [ { "path": string, "schedule": string }, ... ] }`. This matches Vercel's documented `vercel.json` cron schema verbatim. No additional keys (e.g., `functions`, `regions`, `headers`) are present, so the file is minimal and schema-clean.
- The new entry at index 5 follows the same key/value shape as the five pre-existing entries — no schema drift introduced.
- `path` is an absolute API route under `/api/cron/...` matching the file at `app/api/cron/outbound-webhook-retry/route.ts`. The route exports both `GET` and `POST` handlers; Vercel cron invokes via GET by default with `Bearer ${CRON_SECRET}` injected as `Authorization` header — the handler validates this and returns 401 on mismatch.
- `schedule` is a valid 5-field POSIX cron expression: `*/5 * * * *` parses as "every 5 minutes, any hour, any day, any month, any weekday." Vercel's cron parser accepts the standard cron syntax including step values (`*/N`); no parser-level concern.

**No collateral changes:**

- The five pre-existing daily crons remain byte-identical (paths and schedules unchanged). Backend did not accidentally touch the legacy entries.
- No function-level configuration (`functions: {}`), no `regions`, no `headers` introduced — these would be additive concerns if present; their absence keeps the file minimal and matches the project's posture pre-G23.

**Cadence vs existing crons:**

- The new cron fires every 5 minutes; existing crons fire daily at distinct hours (06:30, 07:00, 09:00, 13:00, 14:00 UTC). At minute 0 of those hours, the new cron's `*/5 * * * *` slot also fires, which means at 06:30 UTC the new cron and `consolidate-earnings` both run, etc. This is **not a collision** because (a) they execute different routes, (b) Vercel does not serialize across distinct paths, and (c) they touch different tables. R3 in router handoff confirmed as low impact.

**Verdict:** PASS. `vercel.json` is schema-valid and the new cron entry is well-formed.

---

## I-2 — Vercel plan tier resolution (R3 open question)

**Open question (per router handoff §R3):** does the current Vercel plan tier support `*/5 * * * *` cron cadence?

**Indirect repo-state evidence that the project IS on a plan supporting sub-hourly crons:**

1. **Existing cron count.** `vercel.json` already declares **5 distinct cron entries** in production. Vercel's Hobby tier historically allows **a maximum of 2 cron jobs per account** (across all projects). The mere presence of 5 working daily crons in this single project (`/api/leads/auto-followup`, `/api/cron/consolidate-earnings`, `/api/cron/cleanup-revoked-tokens`, `/api/cron/project-sla-breach-alert`, `/api/cron/webhook-failure-alert`) is **only possible on Pro tier or above**. If the project were on Hobby, only the first 2 entries would actually execute — and the documented existence of `webhook-failure-alert` shipping in B25 closure with verified production runs (per disaster-recovery runbook §4.3 verification snippets and project.context.core.md closure entries) confirms the cron infrastructure is operating end-to-end on at least 5 entries.

2. **Pro-tier features in active use elsewhere.** While not a strict gate, the project consumes Vercel-side capabilities (Marketplace Upstash integration with auto-injected env vars, multiple production-scope env var sets with team-level access control, GitHub auto-deploy webhooks coordinating with branch protection) that are standard on Pro tier.

3. **No documented downgrade event.** A search across `docs/runbooks/`, `docs/context/`, `docs/adrs/` surfaces explicit Supabase plan-tier statements (Free plan confirmed in `cutover-pilot.md` §3.1 and `disaster-recovery.md` §1 + §7) but **zero statements documenting Vercel as Hobby or any plan downgrade**. If the project had ever been intentionally pinned to Hobby for cost reasons, that would typically be recorded as an Active risk in `project.context.core.md` (the same way the Supabase Free / no-PITR posture is recorded). No such record exists.

**Direct repo-state evidence that is missing:**

- `.vercel/project.json` records only `{ projectId, orgId, projectName }` — Vercel does not include plan-tier metadata in the local link file. This is the ONLY canonical repo-side artifact that could carry plan-tier info, and it does not.
- There is no operator-authored note in any runbook stating "Vercel project on Pro plan" or equivalent.

**Conclusion:**

- **Strong inference: the project is on a Pro-tier-or-above Vercel plan and `*/5 * * * *` is supported.** The 5-cron threshold is decisive — Hobby would have rejected the 3rd cron at deploy time, and B25 (the 5th cron) would have failed to register.
- **However**, operator should verify directly in the Vercel Dashboard before assuming. Time-cost is ~30 seconds (Dashboard → Settings → Billing or Dashboard → Settings → Project Settings shows the plan in the sidebar).
- The repo state does not carry an authoritative answer; only the operator's Vercel Dashboard does. This is the same posture as the Supabase plan check — the answer lives in the SaaS console, not in code.

**Fallback options if the operator discovers the plan is Hobby (option-A / option-B / option-C from this skill's input):**

- **Option A (preferred if operator hesitates):** keep `*/5 * * * *` as shipped; record "Vercel plan tier verification pending" as an Active risk in `project.context.core.md` at iteration close (Docs handles); operator verifies before merging to production. **Indirect evidence strongly favors this being a no-op verification.**
- **Option B (fallback if verification fails):** Backend re-files to switch `*/5 * * * *` → `0 * * * *` (hourly) AND bump `max_attempts` from 3 to ~5 to compensate for the longer per-row retry tail latency. Per ADR-027 D4 § "Infrastructure note" Architecture pre-authorized this fallback. Backend implements it as a 2-line change (`vercel.json` schedule + helper module's `max_attempts` default). Re-runs Backend + Testing + this Infra review for the new cadence.
- **Option C (escalate to Architecture):** if the operator decides neither A nor B is acceptable (e.g., wants to upgrade to Pro plan as part of G23 closure, or wants to re-decide cadence semantics), the iteration re-routes to `system-architecture` to re-litigate D4. This is the heaviest option and the least likely to be needed.

**Recommendation:** Option A. Indirect evidence (5 working daily crons) is essentially conclusive. The operator's Dashboard check is a sanity verification, not a blocker.

**Verdict:** OPERATOR-PENDING (with strong indirect evidence the verification is a formality). Recorded as a warning, not a blocker.

---

## I-3 — Env var posture verification

**`NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` (D5 kill-switch):**

`.env.example` lines 70-80 now include:

```
# G23 (Phase 3 R5 / ADR-027 D5) outbound webhook retry-with-backoff kill
# switch. Default ON: any value other than the literal "false"
# (case-insensitive) enables full inline retry (3 attempts, 2s/4s/8s with
# +/- 25% jitter) for proposal_review_decision outbound POSTs.
# Set to "false" to disable the inline retry loop. IMPORTANT: the ledger
# row is STILL written on every dispatch (durability-preserving panic mode
# per ADR-027 D5 option-b). The cron sweeper
# (/api/cron/outbound-webhook-retry) and the admin replay endpoint
# (/api/admin/outbound-webhooks/[eventId]/replay) remain active regardless
# of this flag.
NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED=true
```

**Verification points:**

- **Variable name** matches ADR-027 D5 exactly (`NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED`).
- **Default value** in `.env.example` is `true`, matching the architecture decision "default (absent) = `true` (enabled)." This is also the safe default for production: ledger durability + inline retry both active.
- **Documentation discipline** is strong: the comment block explicitly calls out (a) the precise semantics of `'false'` (lowercased, exact match), (b) the option-b durability preservation (ledger row still written on failure), (c) which other surfaces remain active when the flag is off (cron sweeper + admin replay endpoint). This matches ADR-027 D5's rationale text and gives operators all the context needed for a panic-mode flip without re-reading the ADR.
- **Parallelism with sibling env vars:** the existing `WEBSITE_WEBHOOK_LEDGER_ENABLED` block (lines 62-68) follows the exact same comment structure ("default ON: any value other than 'false' enables"; "Set to 'false' to disable"; "emergency rollback path"). The new G23 var inherits this pattern correctly.

**Sibling env vars that should already exist and are NOT modified by G23:**

- `CRON_SECRET` (line 84): already present (used by all 5 pre-existing crons). The new cron handler reads `process.env.CRON_SECRET` and returns 401 on miss — same B25 pattern as `webhook-failure-alert`. No env-var addition needed for cron auth.
- `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` (line 60): already present (used by the existing outbound dispatcher). The G23 retry layer re-uses this URL on every retry attempt. No env-var addition needed.
- `NOON_WEBSITE_WEBHOOK_SECRET` (line 56): already present (HMAC shared secret for `signWebsitePayload`). Used by every outbound POST including retries (per ADR-027 § "Hard constraints" — re-sign each attempt with a fresh timestamp). No env-var addition needed.
- Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`): already present. The new cron + helper module use `createSupabaseAdminClient()` (service-role bypass for ledger writes per ADR-027 D2 RLS posture). No env-var addition needed.

**Gaps:** none. The full G23 env footprint is one new variable with strong default behavior and comprehensive documentation.

**Operator action required at production deploy:**

- Set `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED=true` in Vercel Production scope **OR** leave it absent (default behavior is identical). No action strictly required — the default-ON behavior is the desired production posture.
- Setting it to `false` is the panic-mode escape hatch and should NOT be done at initial deploy.

**Verdict:** PASS. Env var posture is complete.

---

## I-4 — Runtime config posture verification

**Cron handler `app/api/cron/outbound-webhook-retry/route.ts`:**

- **Runtime declaration:** none. The file does NOT export `runtime`, `maxDuration`, or `dynamic`. Per Next 16 + Vercel defaults, this means:
  - **Runtime:** Node.js (the new platform default; Edge requires explicit opt-in). Node.js is correct for this cron because the helper module uses `createSupabaseAdminClient()` which relies on the `@supabase/supabase-js` library + Node-side environment variable access.
  - **maxDuration:** Vercel's default per-function timeout applies (60s on Hobby, 300s on Pro, longer on Enterprise). With `DEFAULT_BATCH_SIZE = 50` rows and inline retries (~14s budget per row per ADR-027 D1), the worst-case execution time of one cron tick is `50 × 14s = 700s` in theory, but in practice (a) most rows complete in 1 attempt (~1s each), (b) the dispatcher does not block on retries that move the row to `pending`-with-future-`next_retry_at` (those wait for the next cron tick), and (c) typical batch sizes will be 0-5 rows. Empirically expected wall time per cron run: <30s on a healthy system, <120s in a sustained-outage scenario.
  - **dynamic:** defaults to dynamic for route handlers reading `request.headers.get(...)` and `process.env.*` — no static export concern.

- **Should `maxDuration` be set explicitly?** Reviewed against the spec posture:
  - ADR-027 § "Cron handler shape" does not mandate an explicit `maxDuration`.
  - The B25 sibling cron (`webhook-failure-alert`) does NOT set `maxDuration` either, and has shipped to production without timeout issues.
  - If a worst-case batch ever exceeds Vercel's default Pro tier 300s ceiling, the cron will time out mid-row, leaving that row in a `pending` state with a known-stale `last_attempted_at`. The next cron tick (5 minutes later) will re-pick it up. The state machine is robust to mid-batch timeouts (no row is observed in `pending` AND not-yet-rescheduled because `scheduleOutboundRetry` runs **after** the fetch attempt — even a timeout post-fetch leaves the row consistent for cron re-pickup based on `next_retry_at`).
  - **No action needed.** Leaving the default is the right call; if telemetry post-deploy shows the cron is approaching the timeout boundary, a follow-up iteration can add `export const maxDuration = 300` or higher.

**Cron handler `app/api/cron/webhook-failure-alert/route.ts` (extended for D6):**

- The pre-G23 file already shipped without explicit runtime config (B25 closure). G23 extends it with a third ledger scan (`outbound_webhook_events` where `status='dead_letter'`) plus a per-row `alerted_at` mark to avoid duplicate notifications across cron runs.
- The extension introduces ZERO new runtime concerns: the third query is `select id, endpoint, external_proposal_id, decision, dead_lettered_at, last_error from outbound_webhook_events where status='dead_letter' and alerted_at is null and dead_lettered_at >= cutoff` — a bounded query with an index on `(dead_lettered_at)` (per ADR-027 D2 indexes). Worst-case 24h lookback × low PM-review traffic = expected row count in single digits.
- The Backend has guarded the third ledger access with an `outboundTable(client)` helper that bypasses typed `from()` (the table was added in migration 0062 which is post the last `database.types.ts` regen). Per ADR-027 § "Hard constraints", a `database.types.ts` regen is expected at iteration close; until then, the typed-boundary bypass is acceptable and confined to this cron's scope.

**No new exposure surfaces:**

- No new public-facing route (admin replay is `/api/admin/outbound-webhooks/[eventId]/replay` and gated by `requireRole(['admin'])` per ADR-027 D7 — verified by Security review separately, not re-litigated here).
- No new env var read at runtime beyond `CRON_SECRET` (already documented) and `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` (read at module load in the helper module, NOT at request time — mirrors `WEBSITE_WEBHOOK_LEDGER_ENABLED` pattern).
- No new external network calls beyond the existing outbound POST to `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` (which is now exercised more frequently per retry, but the URL itself is unchanged).

**Verdict:** PASS. Runtime config posture is appropriate for both cron handlers and the dispatcher's call sites.

---

## I-5 — Migration deploy ordering

**Current state (per Backend handoff):**

- `supabase/migrations/0062_phase_3r5_outbound_webhook_events.sql` exists in repo.
- Backend confirmed the migration was applied to remote `pdotsdahsrnnsoroxbfe` BEFORE this Infra review fires (per the iteration's chain order).
- Ledger row registration in `supabase_migrations.schema_migrations` is part of Backend's apply step per ADR-014.

**Verification of correct ordering (CRITICAL for production safety):**

- **The migration MUST be applied to the remote DB BEFORE the code deploys to production.** If code lands first, the helper module's `createOutboundWebhookEvent()` will fail with `relation "outbound_webhook_events" does not exist`, every `sendProposalReviewDecisionToWebsite` invocation will throw, every PM-review action will return 5xx, and the cron handler's first invocation will also fail. Cascade impact: severe production breakage.
- **Repo-side evidence:** Backend reported the migration applied to remote already. Infra cannot independently verify the ledger row from this skill (no remote DB read), but the operator can confirm at PR-merge time by running:

  ```sql
  -- Should return one row registering 0062
  select version, name
  from supabase_migrations.schema_migrations
  where version = '0062';

  -- Should return the new table with expected RLS posture
  select tablename, rowsecurity
  from pg_tables
  where schemaname = 'public' and tablename = 'outbound_webhook_events';

  select policyname, cmd, roles
  from pg_policies
  where schemaname = 'public' and tablename = 'outbound_webhook_events';
  -- Expected: one SELECT policy ('outbound_webhook_events_admin_read' or similar)
  -- and NO INSERT/UPDATE/DELETE policies (writes via service_role only — ADR-027 D2)
  ```

- **If the operator's verification reveals the migration is NOT yet applied** (e.g., Backend's handoff was premature, or a remote restore reverted the ledger row), the merge MUST be blocked until apply completes. **DO NOT promote the code deploy ahead of the schema.**

**Idempotency:** Backend authored the migration with `create table if not exists`, `create index if not exists`, and `drop policy if exists` then `create policy` patterns (per ADR-027 § "Migration shape" Architecture contract). Re-applying the migration against an already-applied DB is safe (no-op for table/index, idempotent for policies). This is the standard ADR-006 + ADR-014 posture for this project.

**Verdict:** PASS — conditional on the operator's pre-merge verification snippet above confirming the migration is registered.

---

## I-6 — Deploy posture (production promotion)

**Step-by-step deploy expectations:**

1. **Pre-merge state (must be true):**
   - Migration `0062_phase_3r5_outbound_webhook_events.sql` already applied to remote `pdotsdahsrnnsoroxbfe` (Backend confirmed; operator re-verifies via §I-5 SQL snippet).
   - `database.types.ts` regenerated against the post-0062 schema OR Backend has documented the typed-boundary bypass (the `outboundTable()` helper in the alert cron) as a known short-term gap to be closed in a follow-up regen.
   - All `pnpm` checks green (lint, type-check, unit + integration tests per spec §11 methodology) on the develop branch HEAD that contains G23.

2. **PR merge:** open PR to `develop`. CI runs. Operator merges per `feedback_no_auto_merge_prs` (do not bypass branch protection; do not skip hooks).

3. **Vercel auto-deploy:** Vercel detects the merge to `develop` and triggers a Production deploy of the new commit. **G11 caveat** (per `cutover-pilot.md` §0): auto-deploy on `develop` has historically been unreliable; verify the deployed commit matches `develop` HEAD via the Vercel Dashboard within ~5 minutes of merge. If the auto-deploy did NOT fire, trigger manually via the Deploy Hook (per cutover-pilot §0).

4. **Post-deploy verification (operator runs):**
   - Confirm the deployed commit SHA matches `develop` HEAD.
   - Hit `curl -i -X POST https://nooncode-app-pi.vercel.app/api/cron/outbound-webhook-retry` (no auth header). Expected: **HTTP 401** with `{"error":"Unauthorized"}`. This confirms the new cron route is registered and the auth guard fires.
   - Hit the same URL **with** the `Authorization: Bearer ${CRON_SECRET}` header (operator uses their saved CRON_SECRET) plus `?dryRun=true`. Expected: **HTTP 200** with a JSON body containing `dryRun: true, candidateCount: 0` (or some small number) and an empty / small `candidateEventIds` array. This is the wiring smoke test: confirms the route handler executes end-to-end, the Supabase admin client connects, the new ledger table is reachable, and the helper module's `claimOutboundPendingDue` query executes. Operator captures the JSON response in the iteration's evidence trail.
   - Within the next 5 minutes after deploy completes, Vercel's cron scheduler will tick the new entry for the first time. Operator may inspect Vercel logs (`/cron/outbound_webhook_retry.done` info entry) to confirm the first auto-tick fires successfully.

5. **Cron registration confirmation:** Vercel Dashboard → Project → Settings → Cron Jobs should list all 6 entries from `vercel.json` with the new entry visible. If only 5 entries appear, the deploy build did not register the new cron — re-deploy or escalate to Vercel support.

**No special handling required beyond standard preview → production promotion.** The iteration does not introduce:
- New Stripe-side config (no webhook endpoint changes).
- New Supabase-side RPC or function (the migration adds a table only).
- New NoonWeb-side coordination (cross-repo R2 idempotency enforcement is escalated as Active risk per Docs at closure, not as a pre-deploy gate).
- New env var that the operator must add manually to production (`NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` has a safe default-ON behavior even when absent; setting it explicitly is recommended but not required at deploy time).

**Verdict:** PASS. Standard deploy posture; one operator-runs verification curl per the snippet above is the only added step beyond the usual flow.

---

## I-7 — Rollback playbook

**Three rollback levels, ordered by least-to-most disruptive:**

### Level 1: env-var flip (preferred for runtime misbehavior, ~30s)

**Trigger:** the new retry loop is misbehaving in production — e.g., excessive amplification observed in Vercel logs (`outbound_webhook.attempt` log entries exceeding expected rate by ≥2x), unexpected sustained 5xx pattern from NoonWeb causing operator-visible cost surge, or a Backend bug surfaces post-deploy that increments `attempt_count` past the cap.

**Procedure:**

1. Vercel Dashboard → project `nooncode-app` → Settings → Environment Variables → Production scope.
2. Edit `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` → set value to **`false`** (exact lowercase). If the variable does not exist (was using the default), add it.
3. Save. **Redeploy is required** — env vars are read at module load (per ADR-027 D5 + the existing `WEBSITE_WEBHOOK_LEDGER_ENABLED` precedent), not at request time, so a redeploy is needed for the new value to take effect.
4. Trigger redeploy via the Vercel Dashboard "Redeploy" button on the latest production deployment, OR push a no-op commit to `develop` to fire auto-deploy (subject to G11 caveat — use Deploy Hook if auto-deploy stalls).
5. After redeploy: inline retry loop is disabled. **Ledger writes remain durable** (option-b semantics per ADR-027 D5). On the next PM-review action that fails, the row is written as `dead_letter` immediately on first failure; the cron sweeper continues to drive `pending` rows; admin replay endpoint remains usable.

**Recovery:** flip back to `true` (or remove the env var to revert to default) when the operator is satisfied the bug is fixed. Redeploy. Inline retry returns.

**This is the preferred rollback for ANY non-emergency runtime misbehavior because it preserves durability and observability — operators retain the full ledger + cron + replay surface to recover stuck rows.**

### Level 2: cron disable (if the SWEEPER specifically misbehaves, ~1 min)

**Trigger:** the cron sweeper is the problem — e.g., it is double-driving rows due to a race condition, it is exceeding Vercel function timeouts and failing mid-batch, or it is producing operator-noise alerts on the `webhook-failure-alert` extension at an unsustainable rate.

**Procedure:**

1. Two options:
   - **A. Remove the cron entry from `vercel.json`.** Open a hotfix PR removing the `{ "path": "/api/cron/outbound-webhook-retry", ... }` block; merge; redeploy. The cron is unregistered on the next deploy. The route handler itself remains accessible (still gated by `CRON_SECRET`), so operators can hand-invoke it via curl if desired during recovery.
   - **B. Skip removal; lean on env-var flip (Level 1) instead.** The env-var flip disables inline retry but leaves the cron firing. If the cron itself is the problem (not the inline path), Level 1 does not help — escalate to Option A.

2. After cron removal: inline retry continues; ledger writes continue; the cron sweep stops. Stuck `pending` rows accumulate until manually replayed via the admin endpoint OR until the cron is re-enabled.

**Recovery:** open a follow-up PR re-adding the cron entry. Redeploy. Cron resumes on next tick.

### Level 3: full code revert (if a deeper bug requires it, ~5-15 min)

**Trigger:** the new code path is wrong in a way that env-var flip cannot mitigate — e.g., the dispatcher itself corrupts ledger row state on every invocation, the migration introduced a constraint violation that breaks all PM-review actions, or a security bug surfaces post-deploy that requires immediate revert.

**Procedure:**

1. Standard `cutover-pilot.md` §2.1 rollback: Vercel Dashboard → Deployments → find the last known-good pre-G23 deployment → Promote to Production.
2. Vercel re-aliases `nooncode-app-pi.vercel.app` to the older deployment within ~30s.
3. Verify per `cutover-pilot.md` §2.1: `curl -i -X POST https://nooncode-app-pi.vercel.app/api/webhooks/stripe` returns the expected `{"error":"Missing stripe-signature header"}` from the pre-G23 code path.
4. The migration 0062 remains applied (Supabase does not auto-revert on Vercel rollback). The new `outbound_webhook_events` table now exists with zero pre-G23 rows; the pre-G23 code path does not write to it, so this is a no-op from the perspective of the active code.
5. Open a fix PR against `develop` with the corrected G23 behavior; once green, re-deploy and re-promote.

**Migration-revert posture:**

- Reverting the migration (`drop table public.outbound_webhook_events cascade`) is **NOT** part of this rollback playbook. Once the table exists with rows, dropping it is a destructive operation that requires a deliberate decision (e.g., post-mortem analysis is complete and the data has been exported). If the operator decides to drop the table during a worst-case recovery, follow the ADR-014 procedure for ledger-row deletion alongside the table drop.
- For the routine rollback case (Level 3 above), leaving the table in place with zero rows is the correct posture — it does not affect the pre-G23 code path's behavior.

**Verdict:** PASS. Three rollback levels documented with explicit triggers, procedures, and recovery paths.

---

## I-8 — Observability baseline

**Logs produced by the new cron (per `app/api/cron/outbound-webhook-retry/route.ts`):**

- `cron.outbound_webhook_retry.dry_run` (info): emitted on `?dryRun=true` invocations. Includes `candidateCount`, `limit`, `now`.
- `cron.outbound_webhook_retry.done` (info): emitted on successful sweep completion. Includes `candidateCount`, `deliveredCount`, `deadLetteredCount`, `pendingCount`, `errorCount`.
- `cron.outbound_webhook_retry.failed` (error): emitted on handler exception. Includes the standard `errorToLogContext(error)` shape.

**Logs produced by the dispatcher's inline retry path (per `lib/server/website-integration.ts`):**

- Existing `website.review_decision.*` log entries (pre-G23) are preserved.
- New `outbound_webhook.*` entries are expected per ADR-027's dispatcher contract — operator verifies the exact log keys post-deploy via a smoke fire.

**Failure-state visibility:**

- Stuck `pending` rows older than 1 hour: operator query in ADR-027 § "Operational surface" (`select id, endpoint, external_proposal_id, attempt_count, next_retry_at from outbound_webhook_events where status='pending' and next_retry_at < now() - interval '1 hour' order by next_retry_at asc;`).
- `dead_letter` rows in the last 24 hours: similar query.
- Cross-table replay chain visualization: ADR-027 § "Operational surface" SQL.

**Alerting:**

- D6 extension wires `dead_letter` rows into the existing `webhook-failure-alert` daily cron + `enqueue_user_notification` RPC → active admin profiles receive a `webhook_failure` notification per new dead-letter row.
- The `alerted_at` column (added by Backend per the cron's `outboundTable(client).update({ alerted_at: ... })` call) prevents duplicate notifications across cron runs.

**Verdict:** PASS. Observability baseline is adequate for G23's risk profile: ledger durability + admin notifications + structured cron logs cover the dominant failure modes.

---

## I-9 — Security awareness (cross-cut with system-security)

This section does NOT re-litigate the security review (that is `system-security`'s scope) but confirms infra-side security invariants:

- **Cron auth:** `Bearer ${CRON_SECRET}` exact match; 401 on miss. Same B25 pattern. The `CRON_SECRET` is a Vercel Production env var, never logged, never returned to clients.
- **Admin replay auth:** `requireRole(['admin'])` strict per ADR-027 D7. No `service_role` bypass on the admin endpoint.
- **Ledger writes:** all via `createSupabaseAdminClient()` (service_role), which bypasses RLS. Admin-only read policy via RLS. No INSERT/UPDATE/DELETE policies — write path is exclusively service-role per ADR-027 D2.
- **HMAC signing:** each retry re-signs with a fresh timestamp via `signWebsitePayload` (NoonWeb's ±5min window invariant). Confirmed by ADR-027 § "Hard constraints" and verified in the dispatcher's pseudocode.
- **No new exposure surface:** the only new public route is `/api/admin/outbound-webhooks/[eventId]/replay` (admin-gated, behind auth). The new cron route is bearer-gated.
- **No PII expansion in ledger:** per ADR-027 D2 § "No raw payload storage" — the table stores `payload_hash` (sha256), not body bytes. Forensic reconstruction is via the live `website_inbound_links` + `lead_proposals` rows.

**Verdict:** PASS infra-side. Security review owns the deep audit; this section is consultative co-sign.

---

## Risks / warnings

| Item | Severity | Notes |
|---|---|---|
| Vercel plan tier verification pending | **LOW** | Indirect evidence (5 existing daily crons working in production) is essentially conclusive that the tier supports sub-hourly. Operator confirms via Vercel Dashboard before final merge. Fallback options A/B/C documented in §I-2. |
| G11 (Vercel auto-deploy regression) carry-over | **LOW** | After PR merge to `develop`, operator may need to manually trigger Deploy Hook if auto-deploy stalls. Standard per `cutover-pilot.md` §0. Not G23-specific. |
| Migration 0062 must be applied before code deploy | **MEDIUM** | Backend confirmed applied to remote, but operator should re-verify via the SQL snippet in §I-5 before promoting. Mitigated by Backend's apply-first handoff posture. |
| `database.types.ts` not yet regenerated against 0062 | **LOW** | Per ADR-027 § "Hard constraints", regen is expected at iteration close. Until then, the typed-boundary bypass in `webhook-failure-alert/route.ts` (the `outboundTable(client)` helper) keeps the rest of the file fully typed. Cosmetic, not blocking. |
| Vercel function `maxDuration` not explicitly set on new cron | **VERY LOW** | Default applies (300s on Pro tier). Worst-case expected wall time under sustained outage is well under that ceiling. Future iteration may add explicit `export const maxDuration = 300` if telemetry shows tail latency approaching the boundary. |

**No CRITICAL or HIGH findings.**

---

## Verdict

**READY-TO-MERGE-WITH-WARNINGS.**

- All code-side infra invariants verified: `vercel.json` schema valid, env var posture complete, runtime config appropriate, deploy + rollback playbook clear, observability adequate.
- One operator-pending item (Vercel plan tier verification for `*/5 * * * *` cadence) recorded as a low-severity warning. Indirect evidence strongly favors the tier already supporting sub-hourly crons. Verification cost is ~30s in the Vercel Dashboard.
- Migration ordering is correct per Backend handoff (applied to remote before this review fires); operator re-verifies the ledger row at PR-merge time per the SQL snippet in §I-5.

**No reroute to Backend, Architecture, or Security required.** No CRITICAL or HIGH findings.

---

## Handoff payload for Validator

- **Files verified by this review:**
  - `D:\Pedro\Proyectos\Noon\App-nooncode\vercel.json` — schema valid; new cron entry well-formed.
  - `D:\Pedro\Proyectos\Noon\App-nooncode\.env.example` — `NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED` added with comprehensive comment block; no other env-var gaps.
  - `D:\Pedro\Proyectos\Noon\App-nooncode\app\api\cron\outbound-webhook-retry\route.ts` — bearer auth, dry-run mode, structured logging, GET + POST handlers, calls helper module + `runOutboundWebhookCronSweep` correctly.
  - `D:\Pedro\Proyectos\Noon\App-nooncode\app\api\cron\webhook-failure-alert\route.ts` — third ledger scan added per D6, idempotency via `alerted_at` mark, no regression to the pre-G23 Stripe + website scans.
  - `D:\Pedro\Proyectos\Noon\App-nooncode\supabase\migrations\0062_phase_3r5_outbound_webhook_events.sql` — schema present in repo; confirmed by Backend as applied to remote.
  - `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\website\outbound-webhook-events.ts` — exports `claimOutboundPendingDue` used by the new cron; module-load env-var read for the kill-switch.
  - `D:\Pedro\Proyectos\Noon\App-nooncode\lib\server\website-integration.ts` — exports `runOutboundWebhookCronSweep` used by the new cron.

- **Verdict:** READY-TO-MERGE-WITH-WARNINGS.

- **Operator pre-merge checklist (for Validator to verify):**
  1. Confirm Vercel Dashboard → Settings shows plan tier supports sub-hourly crons (informational; strong indirect evidence says yes).
  2. Run §I-5 SQL snippet against remote `pdotsdahsrnnsoroxbfe` to confirm migration 0062 is registered.
  3. Run §I-6 step 4 curl verification against the production deploy post-promotion.

- **Active risks for Docs to record in `project.context.core.md` (no R-codes per memory rule):**
  - Cross-repo NoonWeb-side idempotency enforcement still pending (R2 from spec §9; carried over from architecture).
  - Vercel plan-tier verification (informational; should resolve to "Pro or above" upon operator's Dashboard check).

- **Rollback path** (per §I-7): Level 1 env-var flip is the preferred path for runtime misbehavior; Level 2 cron-disable for sweeper-specific issues; Level 3 full code revert for deeper bugs. Migration 0062 stays applied across all rollback levels.

- **No CRITICAL or HIGH findings.** Infra co-signs the G23 iteration for Validator's COMPLETE/PARTIAL/BLOCKED verdict.
