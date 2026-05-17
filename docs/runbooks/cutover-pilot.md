# Cutover pilot runbook — NoonApp production

> **Status:** DRAFT 2026-05-17. Authored after B1.0–B1.2 + B1.3a (partial — Scenarios 1-4 PASS, 5-9 deferred awaiting card). Sections marked `[verify-on-first-real-transaction]` are placeholders that the operator updates once B1.3a Scenarios 5-9 actually run end-to-end. Remove the marker once observed behavior matches the documented procedure.

## 0. Audience and purpose

This runbook is for the NoonApp operator (today: Pedro) and any future on-call responder. It captures the rollback, restore, replay, and failure-mode procedures needed to keep production safe during the 4-person internal pilot (FASE 1) and the broader internal production window (FASE 2).

It is **not** a deployment runbook. Standard deploys go through PRs against `develop` → merge → manual Vercel redeploy until G11 (auto-deploy regression) is diagnosed. This runbook covers what to do when something goes wrong **after** a deploy is live or during the smoke + pilot.

The runbook is intentionally short. Bias toward verbatim commands and concrete checkpoints. When in doubt, refund via Stripe Dashboard first and ask later.

---

## 1. Pre-incident state assumptions

Before this runbook is useful, the following must be true:

- Vercel project `App-nooncode` has the production alias `nooncode-app-pi.vercel.app` pinned.
- Stripe live mode keys present in Vercel **Production scope only**: `STRIPE_SECRET_KEY` (`sk_live_*`), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_*`), `STRIPE_WEBHOOK_SECRET` (`whsec_*`). Preview scope has **zero** live values.
- Stripe Dashboard Live mode has the endpoint `NoonApp production webhook` (`we_1TXpLvRC5LvlmWeuVxdXmOoh`) → `https://nooncode-app-pi.vercel.app/api/webhooks/stripe`, listening for 6 events: `checkout.session.completed`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`, `transfer.paid`, `transfer.reversed`.
- Supabase project `pdotsdahsrnnsoroxbfe` is live, the 9 payment-adjacent tables exist (`stripe_webhook_events`, `seller_fees`, `payments`, `earnings_ledger`, `wallet_accounts`, `wallet_ledger_entries`, `points_ledger`, `withdrawal_requests`, `payouts`), and the rate limiter (Upstash via Vercel Marketplace) injects `KV_REST_API_URL` + `KV_REST_API_TOKEN` into Production.
- The `develop` branch head is currently deployed to production. **Caveat (G11):** Vercel auto-deploys do not fire reliably on merges to `develop`; verify the deployed commit matches `develop` head before declaring rollback or new-deploy state.

If any of those is not true, fix the precondition before consulting the procedures below.

---

## 2. Rollback procedures

Pick the smallest rollback that returns the system to a safe state. Reverting a code deploy is preferred over disabling Stripe; disabling Stripe is preferred over emergency SQL.

### 2.1 Revert a bad code deploy (most common)

Trigger: error spike post-deploy (5xx on `/api/webhooks/stripe`, 5xx on `/api/payments/checkout`, broken `/dashboard/leads`, etc.).

**Procedure (~2 minutes):**

1. Vercel Dashboard → project `App-nooncode` → Deployments tab.
2. Find the last known-good deployment **before** the problematic one. The deployed commit SHA appears under the deployment time.
3. Click the `⋯` menu on that row → **Promote to Production**.
4. Confirm. Vercel re-aliases `nooncode-app-pi.vercel.app` to the older deployment within ~30s.
5. Verify rollback:
   ```bash
   curl -i -X POST https://nooncode-app-pi.vercel.app/api/webhooks/stripe
   ```
   Expected body: `{"error":"Missing stripe-signature header"}` (HTTP 400). Anything else (500, hanging, different error) means the rollback did not land.
6. Open a tab with Vercel logs (Deployments → the promoted one → Logs) and watch for the next minute. The 5xx storm should taper to baseline (~zero errors).

**Important:**
- Do **not** revert `develop` in git. The rollback is a Vercel alias change only. The bad commit stays on `develop`; the fix or revert PR comes next.
- After the rollback is stable, open a fix PR against `develop`, get CI green, merge, manual redeploy. Until then, keep the older deployment as production.

**G11 caveat:** because auto-deploys are unreliable (registered 2026-05-15), after a rollback if you push another fix to `develop` you must manually Redeploy from the Deployments tab with "Use existing Build Cache" **unchecked**, or the new commit won't go live.

### 2.2 Disable Stripe webhook (without losing the signing secret)

Trigger: webhook handler is broken in a way that a code rollback won't fix in time, AND the symptom is data corruption (wrong earnings, double credits, etc.) — Stripe will keep retrying failed events with backoff and amplify the bug.

**Procedure (~1 minute):**

1. Stripe Dashboard → switch to **Live mode** (top-right toggle).
2. Developers → Webhooks → click the `NoonApp production webhook` endpoint.
3. Click the toggle in the top-right corner to **disable**. **Do not click Delete.**
4. Stripe stops delivering new events to this endpoint. Events fired during the outage queue in Stripe Dashboard → Events with delivery status `pending`.
5. To re-enable later: same toggle. Stripe attempts to redeliver queued events automatically.

**Important:**
- The signing secret (`whsec_*`) does **not** change when you toggle off/on. It only changes if you delete the endpoint or click "Roll secret" explicitly. Keep the secret stable so the Vercel env var doesn't need re-uploading.
- Do not toggle off if the symptom is signature mismatch. That is a Vercel env var issue (Section 5.1), not a webhook issue.

### 2.3 Pause specific payment flows

Right now no per-flow feature flag exists. If a specific Stripe Checkout endpoint needs to be disabled without rolling back the whole deploy, the only option is a hotfix PR that hard-returns 503 from the relevant route handler, then a redeploy.

Affected routes that move money:
- `app/api/payments/checkout/route.ts` — operator-driven outbound Checkout (legitimized by ADR-010 amendment 2026-05-14).
- `app/api/webhooks/stripe/route.ts` — Stripe → App webhook receiver.

For a faster mitigation, prefer 2.1 (revert deploy) over 2.3 (hotfix flag).

### 2.4 Revoke or rotate live Stripe keys

Trigger: `sk_live_*` or `whsec_*` leaked, or strong suspicion of compromise (committed to a public PR, screenshot leaked, contractor laptop stolen, etc.).

**Procedure (~10 minutes):**

1. Stripe Dashboard → Developers → API keys → Live → **Roll** the secret key. Stripe issues a new `sk_live_*` and revokes the old one immediately.
2. Vercel Dashboard → Settings → Environment Variables → edit `STRIPE_SECRET_KEY` for Production scope only → paste the new value → save.
3. Redeploy `develop` (Deployments tab, no build cache).
4. For the webhook secret: Stripe Dashboard → Webhooks → endpoint → "Signing secret" → **Roll** → new `whsec_*`. Update Vercel `STRIPE_WEBHOOK_SECRET` Production scope. Redeploy.
5. Smoke-test a webhook delivery from Stripe Dashboard ("Send test webhook" → `account.updated` works without touching money) and verify `stripe_webhook_events` has a fresh row with `status='processed'`.

**Important:**
- Rotate **both** keys if either may have been exposed. They're independent in Stripe but adjacent in attacker workflows.
- Old `sk_live_*` immediately stops authenticating, so any in-flight checkout-session creates from the old deploy will start 401-ing. Acceptable transient breakage during rotation.

---

## 3. Restore procedures

### 3.1 Supabase point-in-time recovery (PITR)

**`[verify-on-first-real-transaction]` — confirm PITR is enabled for `pdotsdahsrnnsoroxbfe` before relying on this section.**

Procedure to verify:
1. Supabase Dashboard → project `pdotsdahsrnnsoroxbfe` → Settings → Database → Backups.
2. Look for "Point-in-Time Recovery". Free plan: not available. Pro plan: 7-day retention by default. Higher tiers extend.
3. If active: section continues below. If not: see 3.2 (limitation documented, daily backup is the only restore path).

If PITR is enabled:

**Procedure (~15-30 minutes, downtime applies):**

1. Supabase Dashboard → project → Backups → PITR tab.
2. Pick a timestamp **before** the corruption event. Add a 30-60 second safety margin.
3. Click Restore. Confirm the warning that this **overwrites the current database state** — there is no automatic forward-merge after restore.
4. Wait for restore to complete (varies with DB size; small project ~10 min).
5. Verify schema and key tables post-restore:
   ```sql
   select count(*) from stripe_webhook_events;
   select count(*) from payments where status = 'succeeded';
   select count(*) from leads;
   ```
   Counts should match the pre-corruption baseline.
6. App is automatically reconnected to the restored DB (Supabase keeps the same project URL + keys); no code change needed.

**Important:**
- Restoring loses all writes between the chosen timestamp and the restore. Capture any in-flight evidence (export the affected rows to a staging table or CSV) **before** restoring.
- After restore, Stripe events that landed during the gap need replay (Section 4). Use the Stripe Dashboard Events log to identify gap events.

### 3.2 If PITR is not available

Fall back to:
1. **Daily backup** — Supabase free plan retains 7 days of daily backups. Same restore UI, but you snap to the day boundary, not an arbitrary timestamp. Acceptable for catastrophic corruption, unacceptable for fine-grained recovery.
2. **Manual table recovery** — pull the affected rows from logs (`stripe_webhook_events.event_data` jsonb has the Stripe event body) or rebuild from Stripe Dashboard Events log + business logic. Slow, error-prone, last resort.

The risk this introduces is recorded in §7.

### 3.3 Rebuild local development env from production state

**Not needed for incident response.** Listed here only because the temptation is real: do **not** point local dev against the production Supabase URL during recovery. Use a staging project or the Supabase CLI local stack. Touching production accidentally from `pnpm dev` is the most common way to make a bad situation worse.

---

## 4. Replay webhook events

The Stripe webhook event ledger (`stripe_webhook_events`) is idempotent by `event_id`. Every replay is safe.

### 4.1 When to replay

Replay when:
- A code rollback (2.1) or schema fix recovered the system, and events fired during the outage went to `status='failed'` in the ledger.
- Stripe Dashboard shows queued/failed deliveries that need to be processed.
- After a Supabase restore (3.1), any Stripe events that landed during the gap are now missing from the ledger.

### 4.2 Replay from Stripe Dashboard (preferred)

**Procedure:**

1. Stripe Dashboard → Live mode → Developers → Events.
2. Filter by date range or specific event types (e.g., `checkout.session.completed` between the failure window).
3. Click an individual event → top-right `⋯` → **Resend webhook** → pick `NoonApp production webhook` as the destination.
4. Verify in Supabase:
   ```sql
   select event_id, event_type, status, attempts, last_failed_message
   from stripe_webhook_events
   where event_id = 'evt_...';
   ```
   The row should transition from `failed` to `processed` (or insert fresh if it never landed) within seconds.

**Important:**
- Stripe Dashboard rate-limits resends. If replaying many events, batch with ~1-2s spacing.
- Resending an already-processed event is safe: `beginStripeWebhookEvent` checks `event_id` uniqueness and short-circuits with `duplicate_ignored` log line. No double-spending.

### 4.3 Identify failed events to replay

```sql
select event_id, event_type, attempts, last_failed_message, created_at
from stripe_webhook_events
where status = 'failed'
order by created_at desc
limit 50;
```

For each failed `event_id`, look up the same event in Stripe Dashboard Events and Resend (4.2).

### 4.4 What replay does NOT do

- Does **not** recreate Stripe API state. If the underlying Stripe charge was refunded or canceled in the meantime, replay will not un-refund it.
- Does **not** revert any incorrect business logic outcome from the original processing. If the bug stored wrong earnings, replaying without fixing the bug stores wrong earnings again. **Fix code first, redeploy, then replay.**

---

## 5. Failure-mode catalogue

Each entry is `Symptom → Likely cause → Mitigation`. Use it as a triage cheatsheet.

### 5.1 Stripe webhook signature mismatch (`Invalid webhook signature`, HTTP 400)

**Symptom:** Stripe Dashboard → Events → endpoint shows repeated `400` deliveries. `stripe_webhook_events` does not get new rows. Vercel logs show no `stripe.webhook.processed` for the events.

**Likely cause:**
- `STRIPE_WEBHOOK_SECRET` in Vercel does not match the endpoint's signing secret in Stripe Dashboard.
- The endpoint was deleted + recreated, which rolled the secret.
- The secret was rolled manually but Vercel was not redeployed (env var changes need redeploy to land).

**Mitigation:**
1. Stripe Dashboard → Webhooks → endpoint → Reveal signing secret. Compare to Vercel Production env `STRIPE_WEBHOOK_SECRET`. If they differ, update Vercel and redeploy.
2. After redeploy: Stripe Dashboard → Events → pick any 400'd event → Resend. Should now return 200.

**Do not:** delete the endpoint and recreate to "fix" the secret. That rolls it again; you end up worse off.

### 5.2 Webhook handler throws (`stripe.webhook.failed` in Vercel logs)

**Symptom:** Stripe Dashboard shows deliveries returning 500 or 400 with our error body. Vercel logs have `stripe.webhook.failed` entries. `stripe_webhook_events` has rows with `status='failed'` and a populated `last_error`.

**Likely cause:**
- Schema drift (column or RPC missing because a migration was applied OOB with the wrong shape, or G7 left a piece behind).
- Logic bug in `handleCheckoutSessionCompleted`, `activatePaidProposal`, or related.
- Missing `seller_fees` row for an outbound proposal (recent guarantee since B3 Chunk 5 closure 2026-05-12 — every outbound proposal has one; missing row indicates a bypass path that didn't route through the proposal API).

**Mitigation:**
1. Check `last_error` in the ledger row for the specific failure message.
2. If "relation does not exist" / "column does not exist": schema drift. Apply the missing migration via `mcp__supabase__apply_migration` if MCP auth is live, or via Supabase Dashboard SQL Editor with the verbatim migration body. Verify the table/column appears in `information_schema.tables` / `information_schema.columns`. Replay the failed event.
3. If "seller_fees row missing for outbound proposal": data integrity breach. Inspect how the proposal was created. Reconcile by inserting the missing `seller_fees` row in `state='potential'` with the appropriate amount, then replay the event.
4. If something else: read the actual error, fix root cause, deploy fix, replay.

**Do not:** mass-update `stripe_webhook_events.status='processed'` to silence the dashboard. That hides the bug and the next webhook for the same event still fails.

### 5.3 Stale Vercel deploy after merge to `develop` (G11)

**Symptom:** A PR merged to `develop`, but the live site behaves as if the new code is not present. Specifically: F-V08 columns (`stripe_checkout_url`, `stripe_checkout_expires_at`) stay NULL after creating a checkout link from `/api/payments/checkout` (because pre-F-V08 code does not write them); or a code change that should be visible in the UI is not visible.

**Likely cause:**
- Vercel auto-deploys on `develop` are not firing (regression registered 2026-05-15 as G11). The last deploy is older than `develop` HEAD.

**Mitigation:**
1. Confirm: Vercel Dashboard → Deployments tab. Compare the SHA of the most recent Production deployment to `git rev-parse origin/develop` locally.
2. If they differ, click `⋯` on the latest `develop` commit in the Deployments tab → Redeploy → uncheck "Use existing Build Cache" → confirm.
3. Wait ~2 minutes for status Ready. Verify via the symptom that originally surfaced the gap (e.g., a new checkout session now writes both F-V08 columns).

**Workaround until G11 is fixed:** every merge to `develop` requires a manual redeploy from the Deployments tab. Document in PR descriptions so the next operator does not forget.

**Diagnosis path for G11 itself (when calmer):** Vercel project Settings → Git → confirm "Production Branch" is `develop`, no "Ignored Build Step" command is set, GitHub App integration is connected and has access to the repo, no recent revoke of the Vercel GitHub App permissions.

### 5.4 `sk_live_*` accidentally in local `.env.local`

**Symptom:** clicking "Crear link de pago" from `pnpm dev` on a developer machine creates a real Stripe Live session (`cs_live_*`), pagable by anyone with the URL. Surfaced 2026-05-16 during F-V08 validation — Pedro's local `.env.local` had the live `sk_live_*` from before the B1.1 rotation (the rotation only touched Vercel Production env, not local dev files).

**Likely cause:**
- The `.env.local` was set up before the live-keys-in-Production-only convention existed, and never rotated to `sk_test_*`.
- The B1.1 audit (Vercel scope) did not include a parallel audit of every developer's local `.env.local`.

**Mitigation (immediate):**
1. Stop. Do not click any "Crear link de pago", "Pagar", or similar in local dev until the env is fixed.
2. Edit `.env.local` on the developer machine:
   - `STRIPE_SECRET_KEY` → `sk_test_*` from Stripe Dashboard Test mode → API keys.
   - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → `pk_test_*` from the same place.
   - `STRIPE_WEBHOOK_SECRET` → only meaningful if running `stripe listen` locally; set to the local listener's `whsec_*` or leave unset.
3. Restart `pnpm dev`.
4. If a real `cs_live_*` was created during the incident: Stripe Dashboard Live → Payments → Checkout sessions → find the session → **Expire**. Or via Workbench Shell: `stripe checkout sessions expire <id>`. Or wait 24h for natural expiry (default checkout session lifespan).

**Mitigation (durable):** add a pre-flight check to the cutover runbook that confirms local keys are test-mode before any local-dev validation against Stripe. Add a `npm run check:env-mode` script that fails if `STRIPE_SECRET_KEY` starts with `sk_live_`.

### 5.5 Amount confusion (USD vs cents)

**Symptom:** a payment is created for what looks like a small amount but the actual Stripe charge is for 100× more. Surfaced 2026-05-16 during F-V08 validation — Pedro interpreted `amount: 35000` in the wire payload as $350; it was actually $35,000 because `createCheckoutSession` multiplies × 100 internally for Stripe (which expects cents).

**Likely cause:**
- The `lead_proposals.amount` and `payments.amount` columns store **USD dollars** (not cents).
- The Stripe API expects cents.
- `createCheckoutSession` does the × 100 conversion. Visually inspecting the wire payload sent to Stripe (e.g., from DevTools Network) shows the cents value, which can be misread as dollars.

**Mitigation:**
1. **Always read `amount` columns from `payments` / `lead_proposals` as USD dollars.** If the column shows `35000.00`, that is $35,000 USD, not $350.
2. When inspecting Stripe Dashboard Payments, the displayed amount is the human-readable currency (Stripe formats from cents). $35,000 in the Dashboard = $35,000 in our DB.
3. If a high-value session is created accidentally: Stripe Dashboard Live → Payments → Checkout sessions → Expire **immediately**. Sessions are pagable until they expire or are manually expired.

**Mitigation (durable):** consider adding a confirmation modal in the UI for any "Crear link de pago" where `amount > 1000 USD`, with the dollar value spelled out ("$35,000 — confirmas?"). Tracked separately, not part of this runbook.

### 5.6 Stripe Connect account not active for a seller

**Symptom:** seller tries to withdraw via `/dashboard/earnings` → "Retirar" → fails. Or: `transfer.create` returns an API error like "Your destination account needs to have at least one of the following capabilities enabled: transfers".

**Likely cause:**
- The seller's `user_profiles.stripe_connect_account_id` is NULL (Connect onboarding not started).
- The Connect account exists but is in `pending` or `restricted` state (onboarding incomplete; Stripe blocks `transfer.create`).

**Mitigation:**
1. Check the seller's profile:
   ```sql
   select id, email, stripe_connect_account_id, stripe_connect_status
   from user_profiles
   where email = '<seller-email>';
   ```
2. If `stripe_connect_account_id` is NULL: seller must complete onboarding via `/dashboard/earnings` → "Conectar Stripe" (or whatever the Connect onboarding entry point is). Defer the withdraw until onboarding is `active`.
3. If `stripe_connect_status != 'active'`: seller has started but not completed. Stripe Dashboard → Connect → Accounts → search by account ID → see what's pending (verification docs, bank account, etc.). Operator can prompt the seller to finish onboarding.
4. As of 2026-05-16, **no seller in production has `stripe_connect_account_id`**. Step 7 of B1.3 (withdraw smoke) is deferred to B1.3b until at least one seller is onboarded.

### 5.7 Webhook URL drift (Stripe stops delivering)

**Symptom:** Stripe Dashboard Webhooks shows the endpoint with delivery failure rate near 100%. `stripe_webhook_events` ledger gets no new rows. Vercel logs do not show any webhook traffic.

**Likely cause:**
- The Vercel production alias changed (project rename, team transfer, custom domain migration that broke the `*.vercel.app` alias).
- Stripe keeps delivering to the old URL; the new URL isn't registered.

**Mitigation:**
1. Confirm the production alias:
   ```bash
   curl -i -X POST https://nooncode-app-pi.vercel.app/api/webhooks/stripe
   ```
   Expected: HTTP 400 with `{"error":"Missing stripe-signature header"}`. If anything else (timeout, NXDOMAIN, redirect), the alias is broken.
2. Stripe Dashboard → Webhooks → endpoint → Update → change the URL to the new alias. Keep all other settings (events, signing secret) intact.
3. Stripe Dashboard → Events → filter to recent deliveries → Resend the ones that failed during the gap.

**Mitigation (durable):** if the production alias changes intentionally (custom domain migration, etc.), update Stripe Dashboard **before** the cutover, not after.

### 5.8 `stripe trigger` does not work in live mode (test-event limitation)

**Symptom:** Operator runs `stripe trigger checkout.session.completed` from the Stripe Workbench Shell while in Live mode and gets `stripe trigger is disabled in live mode`.

**Likely cause:**
- Stripe disables `trigger` in live mode by design to prevent accidental fake events in production.

**Mitigation:**
- This is intended behavior, not a bug. There is no workaround on the Stripe side.
- To test the webhook handler with a fake event for B1.2: use **`stripe listen` against a localhost dev server in test mode** with `STRIPE_SECRET_KEY=sk_test_*`. Run `stripe trigger <event-type>` against the local listener. This validates the handler code path but does **not** exercise the production endpoint.
- The only way to validate the production webhook end-to-end is a real card charge (B1.3 Scenarios 5-9).

### 5.9 Stripe Dashboard "Send test webhook" sends but ledger does not record

**Symptom:** Stripe Dashboard → Webhooks → endpoint → "Send test webhook" returns `200 OK` for the delivery, but `stripe_webhook_events` does not get a new row.

**Likely cause:**
- The test webhook button is documented as available on the endpoint detail page but the UI sometimes hides it depending on Stripe Dashboard version / endpoint configuration. If the button is not visible (as observed 2026-05-16), there is no test-event path from the live Dashboard UI other than triggering a real event by changing a setting (e.g., account name nudge → `account.updated`).

**Mitigation:**
- If you see `200 OK` but no ledger row: check Vercel logs for `stripe.webhook.duplicate_ignored` — the test event may have a recycled `event_id` that the ledger already saw. Otherwise, check `stripe.webhook.failed`.
- If the "Send test webhook" button is not visible: skip the explicit test step and rely on the first real-card smoke (B1.3 Scenario 6) as implicit B1.2 verification. This is the path taken 2026-05-16 — accepted compromise.

### 5.10 PR encadenada with `base != develop` (G9)

**Symptom:** PR #X is merged but the changes don't appear in `develop`. `git log origin/develop` does not show the PR's commits.

**Likely cause:**
- The PR was opened with `base = some-other-feature-branch` instead of `base = develop`. Merging targets the feature branch, not develop. GitHub auto-retargets dependent PRs only when the base branch is **deleted**, not when its parent PR is merged.

**Mitigation:**
1. Verify the PR's actual merge target:
   ```bash
   gh pr view <number> --json baseRefName,headRefName
   ```
2. If `baseRefName != "develop"`: open a fresh PR with the missing changes against `develop` directly. Cherry-pick the lost commits if needed.
3. For future chained PRs: **always open with `base = develop` from the start**, even if it makes the diff include unrelated parent-branch changes. The cleaner review surface is not worth the merge-order risk.

(Convention adopted 2026-05-12 after this surfaced twice during B3.)

---

## 6. Incident response checklist

Use this when a real incident is in flight. Work top-to-bottom; skip steps that are clearly N/A.

- [ ] **Confirm the incident.** Reproduce or observe directly. False alarms cost less than a bad mitigation.
- [ ] **Capture evidence first.** Vercel logs (filter to the incident window), `stripe_webhook_events` rows with `status='failed'`, Stripe Dashboard Events log for the same window. Screenshot the relevant Stripe Dashboard pages — Stripe rotates and tombstones data eventually.
- [ ] **Stop the bleeding.** Rollback deploy (2.1) is almost always the fastest. Disable webhook (2.2) if data corruption is in progress.
- [ ] **Communicate.** Notify the pilot team (Slack DM is fine; pilot is 4 people). Mention "rolling back, payments paused for ~X minutes."
- [ ] **Diagnose root cause.** Read `last_error`, Vercel logs, Stripe error details. Do not skip this step; without it, the fix is a guess.
- [ ] **Fix.** PR against `develop`, CI green, manual redeploy.
- [ ] **Replay queued/failed events** (Section 4).
- [ ] **Verify recovery.** Reproduce the original symptom; it must now be absent. Sample a few `stripe_webhook_events` rows post-replay; all should be `processed`.
- [ ] **Re-enable Stripe webhook** if it was disabled (2.2).
- [ ] **Post-mortem note.** Append a short summary to `docs/context/project.context.history.md` under the current session. Include timeline, root cause, mitigation, follow-ups.

---

## 7. Known limitations and accepted risks

These are explicit gaps the team has decided to live with during the pilot. They are not in scope of this runbook to fix, but the runbook references them so the operator does not waste time chasing solutions that do not exist yet.

| Gap | Impact | Why accepted |
|-----|--------|--------------|
| **Sentry not installed (B5)** | No real-time alerting on 5xx. Operator must watch Vercel logs and Stripe Dashboard manually. | Deferred per PR #30 + ADR-009. Operator-in-the-loop is the explicit observability strategy for the pilot. Re-evaluable before external client exposure. |
| **G7 — migration ledger desync** | 15 local migrations not registered in `supabase_migrations.schema_migrations`; 6 orphan ledger rows. Tables physically exist and work. `supabase db push` from CLI would re-apply migrations and fail. | Tracked as `fase-0-b4b-ledger-reconciliation` iteration. Workaround: use `mcp__supabase__apply_migration` or Dashboard SQL Editor for any new migration. Does not block runtime. |
| **G11 — Vercel auto-deploys broken** | Every merge to `develop` requires a manual Redeploy. Easy to forget. | Workaround validated 2026-05-15. Diagnosis deferred to calmer ops window. Mentioned in every PR description for the duration. |
| **PITR status unverified** | If PITR is not enabled, restore granularity is daily backups, not arbitrary timestamps. | `[verify-on-first-real-transaction]` — check Supabase Dashboard → Database → Backups before the first real transaction. Upgrade to Pro plan if PITR is required and not present (cost: small, value: high during pilot). |
| **Single-region Supabase** | A regional outage takes the pilot down. No cross-region replica. | Acceptable for 4-person internal pilot. Re-evaluate before external customer exposure. |
| **No Stripe webhook delivery alert** | If Stripe stops delivering events (URL drift, signing secret mismatch), operator only sees it by manually checking Stripe Dashboard. | Mitigation: add a Stripe-side delivery failure alert. Stripe Dashboard → Developers → Webhooks → endpoint → notification settings. **Configure this during pilot day 1.** |
| **No Connect-onboarded seller** | Step 7 of B1.3 (withdraw via Stripe Connect) cannot run. Deferred to B1.3b. | Onboarding flow exists in the app but no seller has completed it. Pilot can validate steps 1-6 standalone. |
| **`STRIPE_WEBHOOK_SECRET` rotated → Vercel redeploy required** | After rolling the signing secret in Stripe, Vercel needs a redeploy to pick up the new env var. | Standard env-var lifecycle. Documented in 2.4. |

---

## 8. On-call contact list

**`[fill-in-before-pilot]`** — operator inserts contacts before B1.5 sign-off window starts.

| Role | Contact | Hours | Escalation |
|------|---------|-------|------------|
| Primary on-call (NoonApp) | Pedro `noondevelop@gmail.com` | TBD | TBD |
| Backup on-call (NoonApp) | TBD | TBD | TBD |
| NoonWeb dev (cross-repo issues, inbound webhook) | TBD | TBD | TBD |
| Stripe Support | dashboard.stripe.com/support | 24/7 | tier varies by plan |
| Supabase Support | supabase.com/support | 24/7 | tier varies by plan |
| Vercel Support | vercel.com/support | 24/7 | tier varies by plan |

---

## 9. Quick reference — SQL queries

Pre-baked queries the operator can paste into Supabase Dashboard SQL Editor during an incident.

### 9.1 Last 20 webhook events

```sql
select
  event_id,
  event_type,
  livemode,
  status,
  attempts,
  last_failed_message,
  received_at,
  processed_at
from stripe_webhook_events
order by received_at desc
limit 20;
```

### 9.2 Failed events to investigate / replay

```sql
select event_id, event_type, attempts, last_failed_message, received_at
from stripe_webhook_events
where status = 'failed'
order by received_at desc
limit 50;
```

### 9.3 Payments stuck in `pending` more than 1 hour

```sql
select id, proposal_id, amount, status, stripe_checkout_session_id, created_at
from payments
where status = 'pending'
  and created_at < now() - interval '1 hour'
order by created_at asc;
```

(Stripe Checkout sessions expire after 24h by default; payments older than that with `status='pending'` are stranded and need cleanup.)

### 9.4 Seller fees state distribution

```sql
select state, count(*)
from seller_fees
group by state
order by state;
```

(Expected: `potential` for unpaid, `confirmed` after webhook fires, `pending_payout` after admin consolidation, `paid_out` after withdraw, `cancelled` for refunded/canceled.)

### 9.5 Earnings created in the last day, by actor

```sql
select actor_role, count(*), sum(amount) as total_amount
from earnings_ledger
where created_at >= now() - interval '1 day'
group by actor_role
order by actor_role;
```

### 9.6 Identify a payment row by Stripe session ID

```sql
select id, proposal_id, amount, status, stripe_payment_intent_id, stripe_customer_id, created_at, refunded_at
from payments
where stripe_checkout_session_id = 'cs_live_...';
```

### 9.7 Identify everything tied to a proposal (incident triage)

```sql
select
  lp.id as proposal_id,
  lp.title,
  lp.amount as proposal_amount,
  lp.review_status,
  lp.payment_status,
  lp.paid_at,
  sf.amount as seller_fee_amount,
  sf.state as seller_fee_state,
  p.id as payment_id,
  p.status as payment_status,
  p.stripe_checkout_session_id,
  pr.id as project_id,
  pr.status as project_status
from lead_proposals lp
left join seller_fees sf on sf.proposal_id = lp.id
left join payments p on p.proposal_id = lp.id
left join projects pr on pr.source_proposal_id = lp.id
where lp.id = '<proposal-id>';
```

---

## 10. Update discipline for this runbook

This runbook is a living document. The expected update cadence:

- **After every observed incident:** append a new entry under §5 if the failure mode is new, or update an existing entry with new context.
- **After each FASE 1 sub-iteration that lands new behavior in production:** verify §1 assumptions and §3 procedures still hold.
- **When any `[verify-on-first-real-transaction]` marker is resolved by observed behavior:** remove the marker and lock in the procedure as documented.
- **When a known limitation in §7 is closed (e.g., Sentry installed, G11 diagnosed):** strike the row and add a brief note explaining the resolution.

Do **not** delete entries when fixed. Keep historical context — the next operator may face the same symptom from a different cause.

Closure of B1.4 (the iteration that produced this runbook) requires:
- This file exists at `docs/runbooks/cutover-pilot.md`.
- All `[verify-on-first-real-transaction]` markers are resolved (i.e., B1.3a Scenarios 5-9 have run end-to-end).
- §8 on-call list is filled before B1.5 pilot window starts.
- `project.context.core.md` records B1.4 closure in the Closed-in-runtime list.
