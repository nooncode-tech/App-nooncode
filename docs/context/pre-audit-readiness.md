# NoonApp Pre-Audit Readiness

## Current local baseline

- Local runtime uses Supabase auth with `.env.local`.
- Core validation commands are expected to pass before audit:
  - `pnpm validate:env`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm build`
  - `pnpm audit --prod`
- Stripe is intentionally allowed to run with live keys in this workspace, but live payment side effects require explicit action-time approval.

## Environment status

Required core variables:

- `NOON_ENABLE_SUPABASE_AUTH`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `V0_API_KEY`

Integration variables that block full smoke coverage when absent:

- `NOON_WEBSITE_WEBHOOK_SECRET`: required for signed website inbound/payment webhooks.
- `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL`: required to notify the website after PM proposal review decisions.
- `CRON_SECRET`: required to run `/api/leads/auto-followup` outside manual development checks.

## Stripe live protocol

- Read-only account checks are allowed.
- Creating checkout sessions, payment intents, transfers, refunds, payouts, or replaying live webhook events is not allowed without explicit confirmation immediately before the action.
- Prefer a controlled low-value live checkout only after the wallet RPC migration has been applied to the target Supabase project.
- Webhook validation should use a known Stripe event payload and signature. Do not bypass signature verification.

## Database migration note

- `0036_phase_15a_wallet_atomic_credit.sql` adds the transactional `credit_wallet_bucket` RPC.
- The same migration adds idempotency keys for `earnings_ledger`, `points_ledger`, and wallet ledger entries so Stripe retries do not double-credit users.
- The migration is committed as code but must be applied to Supabase deliberately. Do not run `supabase db push` against the real project without confirmation.
- `0038_phase_16a_maxwell_lead_engine_v1.sql` adds the Maxwell Lead Engine V1 outbound schema and search/feedback foundation.
- `0039_phase_16b_rpc_and_client_portal_security.sql` and `0040_phase_16c_trigger_rpc_security_hardening.sql` harden service-only and trigger/helper RPC exposure, but they intentionally leave selected auth-aware RPCs callable by `authenticated`.

## Supabase Advisor pending items

- Manual: enable leaked password protection in Supabase Auth settings.
- Intentional hardening debt: remaining authenticated RPC warnings for proposal review, lead claim/release, wallet/prototype flows, prototype handoff, and Maxwell radius calculation.
- Strict audit closure should be a separate security iteration: move selected RPC actions behind Next.js server routes using `service_role`, revoke direct `authenticated` execute, then validate every affected flow.

## Audit entry criteria

- All core gates pass.
- The wallet RPC migration is applied in the target Supabase environment or explicitly deferred.
- Missing integration variables are either configured or marked out of scope for the audit.
- Browser smoke passes for dashboard, leads, projects, tasks, settings, earnings, and rewards.
- Maxwell smoke passes for `/dashboard/leads`: current-location search, manual-zone fallback, insufficient result handling, lead detail audit, speech play/stop/copy, feedback, and prototype request path.
- Any remaining lint warnings are documented as React Compiler debt, not hidden by disabling the quality gate.
