# Disaster recovery runbook — NoonApp

> **Status:** DRAFT 2026-05-22. Authoring iteration for FASE 3 closure criterion "DR runbook completo + drill ejecutado en staging". Drill design landed (§6); drill execution is operator-driven and tracked separately.

## 0. Audience and purpose

This runbook is for the NoonApp operator (today: Pedro, backup: Andres Velasco) when **catastrophic events** affect production beyond what the routine runbook can address.

**Use `docs/runbooks/cutover-pilot.md` for:** bad code deploys, webhook signature mismatches, replaying failed events, rotating a single Stripe key, normal Supabase restore via the dashboard. Those procedures are short and well-rehearsed.

**Use this runbook for:** full database destruction, Supabase project deletion, Vercel account compromise, Stripe account takeover, GitHub repo or org loss, operator machine loss with secrets, or any incident that requires coordinating multi-vector secret rotation, restoring from cold backups, or rebuilding the deployment surface from scratch.

The runbook is **biased toward catastrophic optimism**: every section assumes the worst already happened and walks the operator from "we have nothing" back to "production is serving traffic". If the actual incident is less severe, downgrade to `cutover-pilot.md` mid-procedure.

It is **not** a deployment runbook and it is **not** a security incident response plan. Security response (notifying affected customers, legal disclosure under GDPR Art. 33-34, etc.) is out of scope — only the technical recovery is covered here.

---

## 1. Pre-DR state assumptions

For DR procedures to work, the following must already be true **before** the disaster:

- **Backups exist.** Supabase project `pdotsdahsrnnsoroxbfe` is on the Free plan and retains **7 days of daily backups** (no PITR — see §3.1 of `cutover-pilot.md` and §7 below). Backups are managed entirely by Supabase; no external snapshot mechanism is in place.
- **Secrets are recorded off-machine.** The current secrets inventory (Stripe live keys, HMAC cross-repo secret, Supabase service-role key, Upstash tokens) lives in:
  - **Vercel Production environment** (authoritative runtime state).
  - **Operator-side password manager** (recovery copy — Pedro's instance, shared label `noondevelop@gmail.com`).
  - **NoonWeb-side Vercel Production environment** (for the HMAC cross-repo secret only — it must match between repos).
  - If the operator-side password manager is also lost, secrets must be rolled (§4) because Vercel only displays them once.
- **DNS / aliases are documented.** The Vercel Production alias `nooncode-app-pi.vercel.app` is the canonical public surface; the Stripe webhook endpoint and the NoonWeb-side webhook URLs reference this alias.
- **GitHub access is recoverable.** The repo `nooncode-org/App-nooncode` is currently PUBLIC (post G13 + B1.3b — see core.md Active risks); a re-flip to PRIVATE is scheduled but does not change DR access posture. Org owner is the operator's GitHub account; loss of that account is covered in §2.5.
- **The runbook is reachable when production is down.** This file lives in the repo, but the repo may also be lost in a worst-case event. Keep an off-repo copy (PDF export, password-manager attachment) updated whenever this file changes materially.

If any precondition is not true, stop and fix it before continuing — DR procedures that assume backups that do not exist make incidents worse, not better.

---

## 2. Catastrophic scenarios

Each scenario follows the same shape: **trigger** → **first response** → **recovery procedure** → **verification**. Skip a section if it does not match the actual incident.

### 2.1 Full Supabase data loss inside the existing project

**Trigger:** a destructive operation against `pdotsdahsrnnsoroxbfe` corrupted or deleted significant data. The project itself still exists and is reachable; only the data inside it is wrong. Examples: `truncate` against a wrong table, mass `delete` without `where`, a migration that dropped a column with production data, a buggy admin endpoint that wiped rows.

**First response (~5 min):**

1. **Stop the bleeding.** If the destructive source is an active piece of code (a bad migration in flight, a buggy endpoint being called), disable it first.
   - Bad migration in flight → revert via Dashboard SQL Editor inverse statement if possible, otherwise let it complete and proceed to restore.
   - Buggy endpoint → revert the Vercel deploy per `cutover-pilot.md` §2.1.
   - Manual operator error in Dashboard SQL Editor → close the tab; no further harm.
2. **Capture evidence.** Screenshot the SQL Editor history, copy the failing command if known, note the timestamp. The post-mortem depends on this.
3. **Pause webhook delivery** to prevent Stripe / NoonWeb from compounding the corruption while restore is in flight. Stripe Dashboard → Webhooks → toggle off (per `cutover-pilot.md` §2.2). NoonWeb-side: temporarily disable the inbound webhook endpoint via NoonWeb's Vercel kill-switch env var (see NoonWeb runbook).

**Recovery procedure (~30 min, depending on data size):**

1. Supabase Dashboard → project `pdotsdahsrnnsoroxbfe` → **Database → Backups**.
2. Pick the most recent daily backup **before** the corruption event. Backup snap times are roughly 24h granularity — if the corruption was today, the latest pre-corruption snap is from yesterday.
3. Click **Restore**. Supabase shows a destructive warning: the entire database is overwritten with the backup state. Confirm.
4. Wait for restore to complete. For a project of NoonApp's current size (~60 migrations + ~6 real users + low transaction volume), expect 5-15 minutes.
5. **Re-apply any migrations that landed after the backup.** Compare:
   ```sql
   select version, name from supabase_migrations.schema_migrations order by version;
   ```
   against `ls supabase/migrations/`. Any local file with a prefix higher than the latest ledger row needs reapplying via Dashboard SQL Editor + manual ledger insert (per ADR-014 convention).
6. **Replay Stripe webhook events** that fired during the restore window. See `cutover-pilot.md` §4. The Stripe Dashboard Events log preserves all events for 30 days; resending is idempotent.
7. **Replay NoonWeb inbound webhooks** if any fired during the restore window. NoonWeb-side does not auto-replay; the operator must manually trigger via NoonWeb's admin surface or by re-firing the original request from logs.

**Verification:**

```sql
-- Baseline tables should have realistic row counts
select 'user_profiles' as t, count(*) from user_profiles
union all select 'leads', count(*) from leads
union all select 'lead_proposals', count(*) from lead_proposals
union all select 'payments', count(*) from payments
union all select 'seller_fees', count(*) from seller_fees
union all select 'stripe_webhook_events', count(*) from stripe_webhook_events
union all select 'wallet_accounts', count(*) from wallet_accounts;
```

Compare to the last known-good counts from `docs/context/project.context.history.md` or a recent operator screenshot. Significant gaps (>10% for any table) indicate the restore + replay was incomplete; investigate before re-enabling webhooks.

**Re-enable webhooks** only after verification passes:
- Stripe Dashboard → toggle the endpoint back on.
- NoonWeb-side: re-enable its inbound webhook env kill-switch.
- Monitor `stripe_webhook_events` for 10 minutes; any `status='failed'` rows in this window need investigation, not auto-replay.

### 2.2 Supabase project deletion or account loss

**Trigger:** the project `pdotsdahsrnnsoroxbfe` no longer exists in the Supabase Dashboard, or the Supabase account that owns it is locked / suspended / lost. This is a category worse than §2.1 because the backups themselves may be inaccessible.

**First response (~10 min):**

1. **Confirm the loss.** Log into Supabase with the owner account (Pedro's `noondevelop@gmail.com`). If the project is not visible: try the backup operator (Andres Velasco) account, in case the project was on a different login. If neither account has access: Supabase Support ticket immediately with the project ID `pdotsdahsrnnsoroxbfe` and any evidence of past activity (screenshots, billing invoices, support tickets).
2. **Pause all writers.**
   - Vercel: roll the live Stripe keys to test mode in Production env (effectively disables paid flows but keeps the deploy alive). Per `cutover-pilot.md` §2.4 + §5.4.
   - Stripe Dashboard: disable the production webhook endpoint.
   - NoonWeb: disable inbound webhook kill-switch.
3. **Communicate.** Pilot team (4 people) gets a Slack DM: "Supabase project unreachable; investigating; no new actions in NoonApp until further notice."

**Recovery procedure (depends on Support response — minutes to days):**

If Supabase Support can restore the project or its backups:

1. Coordinate with Supabase Support to restore from the most recent backup to a **new project** if the old project ID cannot be revived (Supabase typically restores to a new project URL in this case).
2. The new project has new URL + new keys. Update Vercel Production env:
   - `NEXT_PUBLIC_SUPABASE_URL` → new project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → new anon key.
   - `SUPABASE_SERVICE_ROLE_KEY` → new service role key.
3. Redeploy `develop` via Deploy Hook (G11 fallback).
4. Re-register the Stripe webhook endpoint URL if the new project requires it (URL stays `nooncode-app-pi.vercel.app/api/webhooks/stripe` so this is rarely needed — the project URL change is on the Supabase backend side, not the public-facing Stripe URL).
5. Re-establish the migrations ledger reconciliation per ADR-014 against the new project: apply any missing migrations, register the orphan ledger entries per the convention.
6. Run the §3 verification queries against the new project.

If Supabase Support cannot restore (worst case):

- The most recent off-machine snapshot becomes the new baseline. **There is no off-machine snapshot today** — this is an accepted risk (§7).
- Rebuild from the migration files in `supabase/migrations/*.sql` against a fresh Supabase project. Schema returns; data does not. The 6 real users and any persisted leads / payments / earnings are lost.
- Stripe Dashboard Events log preserves the last 30 days of webhook events — use it to reconstruct `stripe_webhook_events` ledger by manually re-firing each event against the rebuilt App. This recovers payment-side state but not pre-payment business state (leads in flight, proposals not yet paid).
- NoonWeb-side data is not directly accessible from App's recovery path; coordinate with NoonWeb on what client-side state can be cross-referenced.

**Verification:** same as §2.1 step "Verification", but the expected baseline is the rebuilt state, not the pre-disaster state. Document the data loss explicitly in the post-mortem.

### 2.3 Vercel project or account loss

**Trigger:** the Vercel project `nooncode-app` is deleted or the Vercel account is suspended / locked. Production traffic returns DNS errors (`NXDOMAIN` or `502 Bad Gateway`) at `nooncode-app-pi.vercel.app`. This is recoverable because the source of truth is the GitHub repo, not Vercel.

**First response (~5 min):**

1. Confirm the loss via `curl -i https://nooncode-app-pi.vercel.app` — expect `502`, `404`, or DNS failure.
2. Check Vercel Dashboard with the owner account. If the project is gone, check the Vercel team / billing for suspension notices.
3. Stripe Dashboard: disable the webhook endpoint (it cannot reach App anyway, but stop the retry storm).
4. NoonWeb: same — disable inbound webhook kill-switch.

**Recovery procedure (~30 min):**

1. **Create a new Vercel project** from the GitHub repo:
   - Vercel Dashboard → Add New → Project → Import Git Repository → `nooncode-org/App-nooncode`.
   - Production Branch: **`develop`** (must be explicitly set per the G11 final closure rule in core.md — Vercel defaults to `main` which does not exist).
   - Framework preset: Next.js (auto-detected).
2. **Configure environment variables.** All Production-scope env vars from the lost project must be re-entered. Source: operator-side password manager. List of required vars (current as of 2026-05-22):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_SECRET_KEY` (`sk_live_*`)
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_*`)
   - `STRIPE_WEBHOOK_SECRET` (`whsec_*`)
   - `NOON_WEBSITE_WEBHOOK_SECRET` (HMAC shared with NoonWeb)
   - `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` (NoonWeb-side endpoint)
   - `OPENAI_API_KEY`
   - `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash via Vercel Marketplace — re-link)
   - `CRON_SECRET`
   - `EARNINGS_CONSOLIDATION_COOLING_DAYS` (default 7 if unset)
   - `WEBSITE_WEBHOOK_LEDGER_ENABLED` (omit to default ON)
   - Any other env present in the lost project's snapshot.
3. **Re-link Upstash via Vercel Marketplace.** Vercel Dashboard → Storage → Add → Upstash Redis → link to the new project. This re-injects `KV_REST_API_URL` + `KV_REST_API_TOKEN` automatically.
4. **Re-set Production alias.** Vercel Dashboard → Settings → Domains → ensure `nooncode-app-pi.vercel.app` resolves to the new project. If the alias is preserved (Vercel typically allows reclaiming `.vercel.app` aliases after project deletion within a window), no change needed; otherwise pick a new alias and update Stripe + NoonWeb webhook URLs accordingly.
5. **Deploy `develop` HEAD.** Push a trivial commit or use Deploy Hook to force first deploy.
6. **Reconnect Stripe webhook.** If the alias survived: Stripe Dashboard → Webhooks → verify the endpoint URL still resolves; no change needed. If the alias changed: update the endpoint URL in Stripe Dashboard.
7. **Reconnect NoonWeb inbound.** Coordinate with NoonWeb operator: NoonWeb's env var for the App webhook URL must update if the alias changed.

**Verification:**

```bash
# App is reachable
curl -i https://nooncode-app-pi.vercel.app/api/webhooks/stripe
# Expected: HTTP 400 with {"error":"Missing stripe-signature header"}

# Admin gate works
curl -i https://nooncode-app-pi.vercel.app/api/admin/migrations-health
# Expected: HTTP 401 with {"code":"UNAUTHENTICATED"}
```

Re-enable webhooks (Stripe + NoonWeb) once the App is verified reachable + the env vars are confirmed working.

### 2.4 Stripe account compromise (full takeover, not just key leak)

**Trigger:** evidence that the Stripe account itself is compromised — not just a leaked key, but the account credentials. Examples: an unrecognized login, refunds issued without operator action, the webhook endpoint URL was changed by someone other than the operator, the bank account on file was modified, a new team member was added.

**Difference vs `cutover-pilot.md` §2.4 (key rotation):** key rotation handles a leaked key while the account is still under operator control. This scenario assumes the **account** is compromised, so rotating keys is insufficient (the attacker can re-roll them).

**First response (~10 min):**

1. **Lock the account out of attacker access.**
   - Stripe Dashboard → Settings → Team → remove any unauthorized members.
   - Settings → Personal → Two-factor authentication → enable if not already (the operator should have this on; verify).
   - Settings → Personal → Account → change password to a fresh strong value, log out all sessions.
   - Settings → Developers → API keys → roll every live key (`sk_live_*`, `pk_live_*`).
   - Settings → Webhooks → roll the signing secret on the production endpoint.
2. **Contact Stripe Support immediately** via dashboard.stripe.com/support → Chat (24/7). Explain "account compromise suspected, requesting full audit log of recent activity and lock on payouts pending investigation."
3. **Pause payouts.** Stripe Dashboard → Balance → Payout schedule → switch to "Manual" if not already, so any pending balance does not auto-transfer to the bank on file (which may have been altered).
4. **Pause webhook delivery** by disabling the endpoint (per `cutover-pilot.md` §2.2). The attacker may have changed the endpoint URL to capture sensitive event data; disabling stops that.

**Recovery procedure (depends on Stripe Support response):**

1. **Audit recent activity** with Stripe Support's help:
   - Refunds issued in the last 7 days that the operator did not initiate.
   - Payouts to bank accounts other than the verified one.
   - New API keys created that the operator does not recognize.
   - Webhook endpoint URL changes.
   - Customer data exports (Stripe logs these).
2. **Update Vercel Production env** with the rolled keys:
   - `STRIPE_SECRET_KEY` → new `sk_live_*`.
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → new `pk_live_*`.
   - `STRIPE_WEBHOOK_SECRET` → new `whsec_*`.
3. **Redeploy** `develop` via Deploy Hook.
4. **Verify Stripe webhook endpoint URL** matches the canonical production alias. If changed by attacker, restore to `https://nooncode-app-pi.vercel.app/api/webhooks/stripe`.
5. **Re-enable the webhook** only after verifying steps 1-4 are complete.
6. **Reconcile data:**
   - For any unauthorized refund, decide whether to fight it via Stripe dispute (if the original payment was legitimate and the refund was attacker-initiated) or absorb the loss.
   - For payouts to wrong bank accounts, file a fraud claim with Stripe (they may recover funds in the destination account if reported fast enough).
   - For new customer records or modified ones in the App DB, audit `payments` rows by Stripe event correlation:
     ```sql
     select id, proposal_id, amount, status, stripe_payment_intent_id, refunded_at, created_at
     from payments
     where refunded_at >= now() - interval '7 days'
       and refunded_at is not null
     order by refunded_at desc;
     ```

**Verification:** smoke-test a $1 outbound payment (per the B1.3a procedure documented in `docs/handoffs/`) against the rolled keys to confirm end-to-end flow works. The transaction can be refunded immediately to avoid actual money movement.

**Legal disclosure:** if any customer payment data was accessed by the attacker, GDPR Art. 33 (breach notification to authority within 72h) and Art. 34 (notification to affected individuals if high risk) may apply. **Out of scope for this runbook** — escalate to legal counsel immediately. The contact path for legal escalation lives in NoonWeb operator notes (Noon-Web owns customer-side data per ADR-010).

### 2.5 GitHub repo loss or org takeover

**Trigger:** the repo `nooncode-org/App-nooncode` is deleted, renamed, made inaccessible, or the org `nooncode-org` is locked / transferred / lost. CI fails to clone, Vercel cannot auto-deploy, the operator cannot push.

**First response (~5 min):**

1. Confirm via `gh repo view nooncode-org/App-nooncode` — if it 404s or auth-errors, the repo or org access is genuinely lost.
2. Check local clones — every developer machine has a recent clone of `develop` that can serve as the recovery source. `git log --all` on a local clone preserves all branches that were fetched in the last fetch operation.
3. Contact GitHub Support immediately if the loss is account-level (suspension, security event) or org-level (transfer of ownership without consent). https://support.github.com/contact

**Recovery procedure (~30 min, longer if Support involvement needed):**

1. **From the most recent local clone**, create a fresh GitHub repo:
   - Decide ownership: same org `nooncode-org` if recoverable, or a new personal account / new org if not.
   - Push every branch: `git push --all <new-remote>`.
   - Push tags: `git push --tags <new-remote>`.
   - Verify the new remote has the same commit count + heads as the lost remote.
2. **Re-point Vercel** to the new GitHub repo:
   - Vercel Dashboard → `nooncode-app` → Settings → Git → Disconnect.
   - Connect → search for the new repo → select.
   - Re-set Production Branch to `develop` (Vercel resets it on Disconnect+Reconnect — same as the G11 closure path documented in core.md).
3. **Trigger first deploy** from the new repo via Deploy Hook.
4. **Update any external references** to the old repo URL:
   - This runbook (and `cutover-pilot.md`) mention the repo by name — update if the org / name changed.
   - NoonWeb cross-repo coordination docs may reference the repo.

**Verification:** push a trivial commit to `develop` on the new remote; verify Vercel auto-deploys + the resulting deploy serves the same surface as before (`curl` smoke per §2.3).

### 2.6 Operator machine loss with `.env.local` and MCP secrets

**Trigger:** the operator's primary laptop is lost, stolen, or destroyed. The `.env.local` file contained credentials (Supabase access token in `.mcp.json`, possibly cached Stripe keys, OpenAI API key). Even though `.mcp.json` is gitignored (per the G13 closure 2026-05-17), it lived on the lost machine and the access token it contained must be considered compromised.

**First response (~30 min):**

1. **Rotate every secret** that may have been on the lost machine, treating each as compromised. The full inventory:
   - Supabase access token (`SUPABASE_ACCESS_TOKEN` in `.mcp.json`): Supabase Dashboard → Account → Access Tokens → revoke the old token + generate a new one.
   - OpenAI API key (if cached in `.env.local`): platform.openai.com → API keys → revoke + generate.
   - Any Stripe keys cached in `.env.local`: if `sk_test_*` only, no urgency; if `sk_live_*` ever made it onto the machine (per the G-fix history of `.env.local` cleanups), follow `cutover-pilot.md` §2.4 to rotate live keys.
   - HMAC cross-repo secret if cached locally: coordinate with NoonWeb operator to roll the secret on both Vercel envs simultaneously (per §4 multi-vector below).
   - GitHub personal access token if used by the operator (e.g., for `gh` CLI auth): github.com/settings/tokens → revoke old + generate new.
   - SSH keys: if used for `git push` over SSH, the private key is on the lost machine; revoke from github.com/settings/keys.
2. **Re-attest accounts.** Log into Vercel, Supabase, Stripe, GitHub from a fresh machine; if any session is still active from the lost machine, sign all sessions out.
3. **Verify gitignored secrets are still gitignored.** `git ls-files --others --ignored --exclude-standard .` from the new machine clone should show no untracked secret files in tracked state. The `.mcp.json` template (without the token) is the safe state.

**Recovery procedure:**

- Set up the new machine: clone the repo, copy `.env.example` to `.env.local`, populate with **test-mode** credentials only (not live), restore `.mcp.json` with the **new** Supabase access token, run `pnpm install`.
- Verify local dev works: `pnpm dev` → http://localhost:3000 → confirm app boots and Supabase queries succeed.
- Verify MCP tooling works: try `mcp__supabase__list_tables` or equivalent from the new machine.

**Verification:**

- Old credentials no longer authenticate: try the old Supabase access token via `curl` against the Supabase Management API — expect 401.
- New credentials work: smoke MCP tool calls.
- Production posture unchanged: `curl` against `nooncode-app-pi.vercel.app/api/webhooks/stripe` returns the expected 400 body.

### 2.7 Multi-vector breach (all secrets must rotate at once)

**Trigger:** evidence of broad credential compromise that affects multiple subsystems simultaneously. Examples: a developer machine breach with attacker exfiltration, a phishing attack against the shared inbox `noondevelop@gmail.com`, a successful credential-stuffing attempt against any account on file.

**First response (~5 min):**

1. **Decide if any active malicious actions are in flight.** Check:
   - Stripe Dashboard recent activity (refunds, payouts, key changes) — per §2.4 step 1.
   - Supabase Dashboard recent SQL Editor activity, recent migrations, recent admin user adds.
   - Vercel Dashboard recent deployments + env var changes.
   - GitHub Audit Log: github.com/organizations/nooncode-org/settings/audit-log → look for unauthorized pushes, branch deletions, secret access events.
2. **Lock down access** at the org / account level first:
   - GitHub: enable 2FA enforcement org-wide if not enforced; rotate org owner password; revoke all PATs (github.com/settings/tokens).
   - Supabase: same as 2.6 but force-revoke all active sessions and re-confirm via email.
   - Vercel: same — Settings → Security → Audit log; sign out all sessions; rotate password.
   - Stripe: same as §2.4.
3. **Pause production webhooks** until secret rotation is complete (Stripe + NoonWeb cross-repo).

**Recovery procedure:** see §4 (multi-vector secret rotation drill) for the full procedure. This is the catastrophic version of §2.4 — every secret rotates together.

**Verification:** after rotation completes, fire a synthetic transaction in test mode to validate that no leftover stale credential causes any service to fail. The drill in §6 covers this end-to-end.

---

## 3. Restore from daily backup (current capability)

The full restore procedure assuming Supabase is on the Free plan (no PITR). For PITR-enabled restore (after a Pro plan upgrade), use the procedure in `cutover-pilot.md` §3.1.

### 3.1 Restore destination decision

Before pressing Restore, decide:

- **In-place restore** (overwrite `pdotsdahsrnnsoroxbfe`): simplest. App env vars do not change. All Supabase RPC URLs stay valid. **Loses everything since the backup snap point.**
- **Restore to a new project** (Supabase typically forces this when restoring across regions or after a project deletion): App must update env vars to point at the new project URL + keys. More work but allows side-by-side comparison with the corrupted-but-still-present old project, which can be useful for selective row-level recovery.

For routine corruption, in-place. For full deletion or selective recovery, new project.

### 3.2 In-place restore procedure

1. Supabase Dashboard → project → Database → Backups → pick the daily backup before the incident → Restore.
2. Confirm the destructive warning.
3. Wait 5-15 minutes.
4. Re-apply migrations landed after the backup (§2.1 step 5).
5. Replay Stripe events (`cutover-pilot.md` §4) and NoonWeb inbound events (manual; see §5 below).

### 3.3 New-project restore procedure

1. Supabase Dashboard → request restore-to-new-project via Support if the option is not self-serve.
2. New project comes with a new URL + new keys. Update Vercel Production env:
   - `NEXT_PUBLIC_SUPABASE_URL` → new URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → new anon key.
   - `SUPABASE_SERVICE_ROLE_KEY` → new service role key.
3. Redeploy via Deploy Hook.
4. Verify schema integrity:
   ```sql
   select table_name from information_schema.tables
   where table_schema = 'public'
   order by table_name;
   ```
   Compare against `ls supabase/migrations/*.sql` to ensure every expected table is present.
5. Migration ledger reconciliation per ADR-014 (the new project starts with a clean ledger; backfill registered migrations as needed).

### 3.4 What is not restored

The backup is the Supabase DB only. The following are **not** in the backup and must be recovered separately:

- **Stripe state** (charges, payouts, customer records): Stripe is its own source of truth. The App side restores its references to Stripe IDs via the ledger replay.
- **Vercel deploy history**: Vercel keeps its own. No backup needed; restore is re-deploying `develop` HEAD.
- **GitHub repo**: not affected by Supabase restore. See §2.5 if the repo itself is lost.
- **External integrations** (OpenAI usage logs, Upstash data, etc.): each is its own source of truth. Upstash data is rate-limit counters only and rebuilds itself; OpenAI logs are read-only.

---

## 4. Multi-vector secret rotation drill

When every secret in the system must rotate at once (after a credential compromise per §2.7), follow this ordering to minimize downtime. The principle: **rotate the most-replicated secrets first** so the change windows overlap as little as possible.

### 4.1 Secret inventory

| Secret | Lives in | Coupled with |
|---|---|---|
| `STRIPE_SECRET_KEY` (`sk_live_*`) | Vercel Production env | Stripe API (read/write side) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_*`) | Vercel Production env + client bundle | Stripe Checkout (client-side) |
| `STRIPE_WEBHOOK_SECRET` (`whsec_*`) | Vercel Production env | Stripe webhook endpoint signing |
| `NOON_WEBSITE_WEBHOOK_SECRET` (HMAC shared) | Vercel Production env (App) + Vercel Production env (NoonWeb) | Cross-repo webhook authentication, both directions |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel Production env + operator MCP config (`.mcp.json` gitignored) | Supabase server-side mutations |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel Production env + client bundle | Supabase client-side RLS reads |
| `KV_REST_API_TOKEN` | Vercel Production env (auto-injected by Marketplace) | Upstash Redis (rate limiter) |
| `CRON_SECRET` | Vercel Production env + `vercel.json` cron config | Internal cron auth |
| `OPENAI_API_KEY` | Vercel Production env | Maxwell + AI surfaces |
| `SUPABASE_ACCESS_TOKEN` | Operator `.mcp.json` (gitignored) | Supabase Management API + MCP tooling |
| GitHub PAT | Operator `gh` CLI config | Repo writes from operator machine |
| SSH keys | Operator `~/.ssh/` + github.com/settings/keys | `git push` over SSH |

### 4.2 Rotation order

1. **GitHub PAT + SSH keys** first — these gate the operator's ability to push fixes during the rest of the rotation. If the operator cannot push, the rotation cannot complete.
2. **`SUPABASE_ACCESS_TOKEN`** — gates MCP tooling. If lost, the operator cannot apply migrations or inspect the DB during the rest of the rotation.
3. **`NOON_WEBSITE_WEBHOOK_SECRET`** — coordinated with NoonWeb operator (Andres Velasco). Both Vercel envs update **within the same 5-minute window** to minimize the inbound webhook failure period. The cross-repo coordination protocol (roadmap §11.7 point 6) explicitly notes "Rotacion de HMAC secret + Stripe webhook secret: ambos repos deben rotar el mismo dia. Es una operacion coordinada, no individual."
4. **`STRIPE_WEBHOOK_SECRET`** — rolling the Stripe signing secret invalidates all in-flight webhook signatures. Pause webhook delivery (Stripe Dashboard toggle) before the roll; roll on Stripe side; update Vercel env; redeploy; re-enable webhook; Stripe auto-retries any events queued during the pause.
5. **`STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** — rolling these invalidates active client-side Checkout sessions. Worst-case impact: customers mid-checkout see a 401 error on the next API call. Acceptable transient breakage during a known rotation window; communicate to pilot team before rolling.
6. **`SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`** — rotation requires generating new keys via Supabase Dashboard, updating Vercel, redeploying. Active user sessions tied to the old anon key remain valid until JWT expiry (default 60min in Supabase); no force-logout unless the threat model requires it.
7. **`KV_REST_API_TOKEN`** — Upstash rotation via Vercel Marketplace (Storage → Upstash Redis → rotate). The rate limiter falls back to in-memory mode for ~30s during rotation; not a hazard for the pilot.
8. **`OPENAI_API_KEY`** — non-critical for the core revenue path. Rotate last. Worst case: Maxwell + AI surfaces 500 during the window.
9. **`CRON_SECRET`** — rotate via Vercel env update + `vercel.json` deploy. The 4 production crons fail one or two cycles during the window; acceptable.

### 4.3 Post-rotation verification

After every secret rotates:

```bash
# 1. Stripe webhook signature works
# Trigger a $0 test event from Stripe Dashboard (account.updated) → expect stripe_webhook_events row with status='processed'

# 2. Cross-repo HMAC works
# Coordinate with NoonWeb operator: fire one inbound proposal from a NoonWeb-side test trigger → expect a leads row + a website_webhook_events row

# 3. Supabase service-role works
# Admin smoke: curl -H "Cookie: <admin session>" https://nooncode-app-pi.vercel.app/api/admin/migrations-health → expect 200 synced=true

# 4. Upstash rate limit works
# Anonymous probe: hit a rate-limited endpoint 80 times in 60s → expect first 60 to 4xx (not 5xx) and the rest to 429

# 5. Crons work
# Wait for next scheduled cron (next 06:30 UTC consolidation) → check Vercel logs for cron.consolidate_earnings entry
```

If any verification step fails, the rotation is incomplete — find the stale credential and re-rotate.

---

## 5. Cross-repo DR coordination (NoonApp ↔ NoonWeb)

Both repos share the HMAC cross-repo secret (`NOON_WEBSITE_WEBHOOK_SECRET`) and the wire contract documented in `docs/integrations/cross-repo-webhook-v1.md`. Any DR event that touches webhook authentication or the inbound flow requires coordinated action.

### 5.1 What must coordinate

- **HMAC secret rotation** (per §4 ordering step 3): App and NoonWeb roll the same value within the same window. Both env vars must be updated before either redeploys, or the receiver returns 401 on the sender's traffic.
- **Inbound webhook URL changes**: if App's Production alias changes (per §2.3 recovery), NoonWeb's env var `NOON_APP_WEBHOOK_URL` (or equivalent) must update with the new URL. Coordinate via daily sync per roadmap §11.7 point 1.
- **Schema changes during DR recovery**: if §2.1 recovery requires re-applying migrations that change the wire contract, the contract doc in **both** repos must update simultaneously. Releases must order so the receiver supports both old + new schema during the migration window (roadmap §11.7 point 7).
- **Customer-side data recovery**: NoonWeb owns customer-side PII (per ADR-010 + the runbook `gdpr-art-15-17.md` §"Cross-repo escalation to NoonWeb"). If a customer-impacting incident occurs on the App side, NoonWeb operator is the source of truth for which customers were affected.

### 5.2 Coordination protocol during an active incident

1. **Open a shared chat thread** (Slack DM or WhatsApp group with both operators) at first detection. State the symptom + initial diagnosis.
2. **Pause writers on both sides** before doing anything destructive. App pauses Stripe webhook + outbound webhook to NoonWeb; NoonWeb pauses inbound webhook to App.
3. **Designate a recovery lead.** Whichever operator initiated the diagnosis owns the timeline. The other operator stands by for cross-repo actions.
4. **Verify cross-repo handshake** after every step that touches webhook auth or URLs: fire one test event in each direction.
5. **Post-mortem includes both operators.** Append to `docs/context/project.context.history.md` (App) and the NoonWeb equivalent; cross-reference each.

### 5.3 What NoonWeb cannot help with

NoonWeb has no read access to App's Supabase project, no Stripe Connect-side state, no App-internal cron logs, and does not own the App's Vercel project. App-side DR is App-operator-led. NoonWeb similarly owns its own Vercel + Supabase + Resend recovery; App cannot help directly.

---

## 6. Staging drill plan

The drill exercises the restore + replay path in a controlled environment **before** a real incident forces it. Closes the FASE 3 criterion "DR runbook completo + drill ejecutado en staging".

### 6.1 Drill scope and objectives

- **In scope**: §3.2 in-place restore procedure + §4 webhook replay path (one Stripe event) + §4.3 verification commands. Validates the operator can execute the procedure end-to-end in <30 min.
- **Out of scope**: §2.4 (Stripe account compromise — cannot rehearse without real Stripe Support involvement) + §2.5 (GitHub takeover — same) + §2.7 (multi-vector breach — too disruptive). These remain documented but un-drilled.

### 6.2 Staging environment provisioning

Use a separate Supabase project (not `pdotsdahsrnnsoroxbfe`) and a separate Vercel project. The drill must not touch production.

1. **Create staging Supabase project.** Free tier is fine. Name suggestion: `nooncode-staging-dr-drill`.
2. **Apply migrations** to staging using the same `supabase/migrations/*.sql` files. Use `mcp__supabase__apply_migration` for each or batch via Dashboard SQL Editor.
3. **Seed minimal data.** Insert ~5 test rows in each of: `user_profiles`, `leads`, `lead_proposals`, `payments`, `seller_fees`, `stripe_webhook_events`. Use distinctive `legacy_mock_id` markers like `drill-YYYY-MM-DD` so post-drill cleanup is trivial.
4. **Trigger an initial daily backup snap.** Supabase Dashboard → Database → Backups → wait for the next daily snap (or manually trigger if the plan allows). Note the snap timestamp.

### 6.3 Drill procedure

**T+0:** the operator simulates corruption.

```sql
-- Pick a non-critical table; the leads table is fine.
delete from leads where legacy_mock_id like 'drill-%';
```

Confirm the rows are gone:

```sql
select count(*) from leads where legacy_mock_id like 'drill-%';
-- Expected: 0
```

**T+5:** operator opens this runbook and follows §3.2 in-place restore.

1. Pick the pre-corruption backup snap.
2. Click Restore. Confirm.
3. Wait for completion.

**T+20:** verify restore.

```sql
select count(*) from leads where legacy_mock_id like 'drill-%';
-- Expected: 5 (the seeded count)
```

**T+22:** simulate a webhook replay.

- Stripe Test mode → trigger one `checkout.session.completed` against a Stripe CLI listener pointed at the staging deploy.
- Verify the staging `stripe_webhook_events` ledger picks it up.

**T+30:** verify cross-repo handshake (optional — only if staging has a NoonWeb counterpart set up).

- Fire one HMAC-signed payload against the staging App's `/api/integrations/website/inbound-proposal`.
- Verify the `website_webhook_events` ledger row.

### 6.4 Drill success criteria

- Restore completes within 15 min of clicking Restore.
- All 5 seeded rows are recoverable.
- The operator does not consult any document other than this runbook during the drill (proxy for "runbook is self-contained enough").
- Total drill time end-to-end is <45 min.

### 6.5 Drill evidence to record

Append a drill summary to `docs/validations/dr-drill-staging-YYYY-MM-DD.md` (file does not exist yet; the drill creates it). Required fields:

- Drill date + operator.
- Staging Supabase project ID + Vercel project URL.
- Timestamps for each T+N checkpoint.
- Any deviations from the runbook (operator went off-script — note why).
- Any runbook ambiguities surfaced (these become PR follow-ups).
- Final verdict: PASS / PARTIAL / FAIL.

### 6.6 Drill cadence

- **First drill**: before B1.5 pilot sign-off or before any external customer exposure, whichever comes first.
- **Recurring**: every 6 months, or after any structural change to the restore path (e.g., Supabase plan upgrade to Pro that adds PITR — the drill procedure changes).
- **Triggered**: after any near-miss incident where DR would have been used but was not (i.e., the operator chose a less rigorous mitigation).

---

## 7. Known limitations and accepted risks (DR-specific)

These complement the cutover-pilot.md §7 list with DR-specific gaps.

| Gap | Impact | Why accepted |
|-----|--------|--------------|
| **PITR not enabled (Free plan)** | Restore granularity is daily backups, not arbitrary timestamps. A corruption window inside one day is unrecoverable to a fine-grained pre-event state. | Carried over from cutover-pilot §7. Recommendation: upgrade Supabase to Pro before external customer exposure. The drill in §6 exercises the daily-backup path explicitly. |
| **No off-machine DB snapshot** | If Supabase loses the project AND the daily backup index (catastrophic Supabase-side incident), the App-side has no independent restore source. | Accepted for pilot. Mitigation candidate (post-pilot): scheduled `pg_dump` export to an operator-controlled S3 bucket once a week. Out of scope for FASE 3. |
| **No cross-region replica** | A single Supabase region outage takes the pilot down for the duration of the outage. | Accepted for pilot. Mitigation candidate (post-pilot): Pro plan + multi-region read replica. Out of scope for FASE 3. |
| **HMAC secret rotation requires both repos online** | If NoonWeb is unreachable during the rotation window, App cannot complete §4 step 3 cleanly. | Coordinated by the daily sync protocol. If NoonWeb is genuinely lost, App can rotate to a placeholder secret unilaterally and re-coordinate when NoonWeb recovers — the inbound webhook fails open in App until NoonWeb returns. |
| **Single operator inbox concentration** | `noondevelop@gmail.com` is shared between Pedro and Andres. If the inbox is compromised, both on-call contacts are affected. WhatsApp is the only true out-of-band channel. | Documented in cutover-pilot §8. Accepted for B1.5 pilot; second backup with distinct inbox recommended before FASE 2 external exposure. |
| **No automated DR detection** | DR scenarios are operator-detected via Vercel logs, Stripe Dashboard, Supabase Dashboard. No alerting layer (Sentry deferred per B5). | Decision recorded in core.md Active risks: alertable observability deferred 2026-05-13. Re-evaluate before external customer exposure. |
| **Drill cadence is honor-system** | No CI hook or calendar reminder enforces the 6-month drill cycle (§6.6). | Tracked in operator's personal calendar. Drill skipping is itself a DR-readiness regression. |

---

## 8. RTO / RPO (informal targets)

These are aspirational targets, not contractual commitments. They calibrate expectations during an incident.

| Scenario | RTO (recovery time) | RPO (data loss) |
|----------|----------------------|------------------|
| Single-table corruption inside the existing project (§2.1) | <30 min | <24h (one daily snap) |
| Full Supabase project loss, recoverable via Support (§2.2) | hours to days (Support-dependent) | <24h |
| Full Supabase project loss, unrecoverable (§2.2 worst case) | days | total data loss; only Stripe + GitHub + Vercel survive |
| Vercel project loss (§2.3) | <30 min | 0 (Vercel does not store business data) |
| Stripe account compromise (§2.4) | <30 min for technical recovery | 0 for App data; financial loss depends on what attacker did |
| GitHub repo loss (§2.5) | <30 min if recent local clone exists | 0 if local clone is current; otherwise back to last fetch |
| Operator machine loss (§2.6) | <2h (machine reprovisioning + secret rotation) | 0 |
| Multi-vector breach (§2.7) | hours | depends on what attacker did |

These targets are achievable today only for `<24h` RPO and `<30 min` RTO categories. Tighter RPO (PITR / cross-region) requires the Supabase Pro upgrade.

---

## 9. Quick reference — DR commands

```bash
# Verify production alias is responding (DR liveness check)
curl -i https://nooncode-app-pi.vercel.app/api/webhooks/stripe
# Expected: HTTP 400 with {"error":"Missing stripe-signature header"}

# Verify admin gate (DR auth liveness check)
curl -i https://nooncode-app-pi.vercel.app/api/admin/migrations-health
# Expected: HTTP 401 with {"code":"UNAUTHENTICATED"}

# Count tracked migrations on disk
ls supabase/migrations/*.sql | wc -l

# (From an authenticated psql session against the production Supabase)
# Count migrations registered in the ledger
select count(*) from supabase_migrations.schema_migrations;

# Count Stripe events processed in the last hour (sanity check during recovery)
select status, count(*) from stripe_webhook_events
where received_at >= now() - interval '1 hour'
group by status;

# Verify the GDPR sentinel survived a restore (ADR-019 dependency)
select id, email, is_active, legacy_mock_id from user_profiles
where id = '00000000-0000-0000-0000-000000000000';
-- Expected: one row with legacy_mock_id='gdpr-sentinel', is_active=false
```

---

## 10. Update discipline for this runbook

Match `cutover-pilot.md` §10 conventions:

- **After every observed DR-class incident**: append a new entry under §2 or update an existing one with the new failure mode.
- **After each scheduled drill (§6.6)**: update §6 with any procedural drift the drill surfaced. Update §7 if a previously-accepted risk became unacceptable.
- **When a structural change lands** (Supabase plan upgrade, new secret added to the inventory, new external dependency): update §1 (preconditions), §4 (secret inventory), and §8 (RTO/RPO) in the same PR.
- **Do not delete entries when fixed**: strike-through and add a resolution note. Future operators may encounter the same symptom from a different cause.

Closure of the DR runbook iteration requires:

- ✅ This file exists at `docs/runbooks/disaster-recovery.md` (landed 2026-05-22).
- ✅ The §6 drill plan is detailed enough that the operator can execute without further design work.
- ⏳ The first staging drill (§6.6 "First drill") is executed and the resulting `docs/validations/dr-drill-staging-YYYY-MM-DD.md` is committed. Operator-driven; not blocking on documentation.
- ⏳ `project.context.core.md` records DR runbook closure in the Closed-in-runtime list.
- ⏳ FASE 3 closure criterion "DR runbook completo + drill ejecutado en staging" updates: `completo` ✅, `drill ejecutado` pending operator action.
