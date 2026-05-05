# Changelog

All notable changes to NoonApp are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Addedh
- Architecture documentation under `docs/` (business, features, ADRs, TDRs, ui_intention)
- `docs/business/noonapp-overview.md` — business context, roles, entities, constraints
- `docs/business/roadmap-v2.md` — full roadmap toward production with Go backend
- `docs/features/lead-lifecycle.md` — BDD scenarios for lead domain
- `docs/features/payment-and-earnings.md` — BDD scenarios for payment flow
- `docs/features/prototype-generation.md` — BDD scenarios for v0 integration
- `docs/adrs/ADR-001` through `ADR-004` — architecture decisions documented
- `docs/tdrs/TDR-001` through `TDR-003` — technical decisions documented
- `docs/ui_intention/` — component philosophy and dashboard navigation intent

### Changed
- Moved non-config files from project root to `docs/` (AGENTS.md, QA checklist, roadmap, context files)
- `.gitignore` updated to exclude `.mcp.json`, `.claude/`, `.atl/`

---

## [0.17.0] — 2026-05-04

### Added
- Structured logger (`lib/server/api/logger.ts`) with recursive secret redaction and string truncation
- In-process rate limiter (`lib/server/api/rate-limit.ts`) — sliding window, per-route
- Stripe webhook event ledger (`stripe_webhook_events` table) for idempotent processing
- Request ID propagation in hardened API responses
- Test suite via Node.js native test runner (`npm test`)
  - `tests/server/api/logger.test.ts`
  - `tests/server/api/rate-limit.test.ts`
  - `tests/server/maxwell/chat-schema.test.ts`
  - `tests/server/maxwell/lead-engine.test.ts`
  - `tests/server/stripe/webhook-events.test.ts`
  - `tests/server/website-webhook-auth.test.ts`
  - `tests/infra/env-example.test.ts`

---

## [0.16.0] — 2026-04-19

### Added
- Client portal (`/client/[token]`) — public, token-based, no login required
- `client_access_tokens` table with SHA-256 hashed tokens
- `resolve_client_token` and `touch_client_token` RPC functions
- Token generation from project detail (admin/PM)

---

## [0.15.0] — 2026-04-19

### Added
- Notification preferences stored as JSONB in `user_profiles`
- `GET/PATCH /api/notifications/preferences`
- Critical notifications always forced ON regardless of preferences
- Settings page accessible to all roles (Notifications tab)

---

## [0.14.0] — 2026-04-15

### Added
- Points ledger (`points_ledger` table) — real credit/debit tracking
- Reward store (`reward_store_items` table) with stock control
- Point redemptions (`point_redemptions` table)
- `GET/POST /api/rewards`

---

## [0.13.0] — 2026-04-15

### Added
- Earnings ledger (`earnings_ledger` table) auto-populated on payment confirmation
  - Outbound: seller gets $100 fixed + noon gets 50% of remaining
  - Inbound: developer gets 50% + noon gets 50%
- Withdrawal requests (`withdrawal_requests` table)
- `GET/POST /api/earnings/withdraw`
- Earnings dashboard: total earned, pending payout, history, withdrawal dialog

---

## [0.12.0] — 2026-04-10

### Added
- Stripe Checkout integration for client payments
- Webhook handler at `POST /api/webhooks/stripe`
  - `checkout.session.completed` → activates project
  - `payment_intent.payment_failed` and `charge.refunded` handled
- `stripe_customers` table with race-condition-safe upsert
- `payments` table with idempotency key per checkout session

---

## [0.11.0] — 2026-04-01

### Added
- v0 SDK integration for prototype generation
- `POST /api/prototypes/[workspaceId]/generate`
- Auto-built prompt from lead + proposal data
- Workspace transitions `pending_generation` → `ready` on success

---

## [0.10.0] — 2026-03-28

### Added
- Maxwell Lead Engine V1 — outbound seller search
- `POST /api/maxwell/lead-searches`
- Search by current location or manual zone
- Radius enforcement by role, deduplication, confidence scoring, batch limits

---

## [0.9.0] — 2026-03-20

### Added
- Lead locking via `locked_by_proposal_id`
- `POST /api/leads/[leadId]/claim` — atomic via DB RPC
- `POST /api/leads/[leadId]/release` — no-response release
- Auto-followup job (`POST /api/leads/auto-followup`)

---

## [0.8.0] — 2026-03-15

### Added
- PM queue (`/dashboard/pm-queue`) — proposals awaiting PM review
- Proposal review webhook (`POST /api/inbound/pm-queue/[proposalId]/review-webhook`)
- Proposal lineage tracking (`proposal-lineage.ts`)

---

## [0.7.0] — 2026-03-10

### Added
- Project activity feed (`/api/projects/[projectId]/activity`)
- Updates module (`/dashboard/updates`, `/api/updates`)
- Notifications module (`/api/notifications`, `/dashboard/notifications`)

---

## [0.6.0] — 2026-03-05

### Added
- Lead → Project conversion (`POST /api/leads/[leadId]/proposals/[proposalId]/project`)
- Tasks persistence (`/api/tasks`, `/api/tasks/[taskId]`)
- Task activity log (`/api/tasks/[taskId]/activity`)

---

## [0.5.0] — 2026-02-28

### Added
- Proposals persistence (`/api/leads/[leadId]/proposals`)
- Lead activity log (`/api/leads/[leadId]/activity`)
- Lead notes (`POST /api/leads/[leadId]/activity` with type `note_added`)

---

## [0.4.0] — 2026-02-20

### Added
- Leads persistence against Supabase (replacing mock-only mode)
- `GET/POST /api/leads`
- `GET/PATCH/DELETE /api/leads/[leadId]`
- RLS enabled on `leads` table

---

## [0.3.0] — 2026-02-10

### Added
- Website integration webhooks (`/api/integrations/website/`)
- Inbound proposal flow
- HMAC-based webhook authentication (`lib/server/website-webhook-auth.ts`)

---

## [0.2.0] — 2026-02-01

### Added
- Role-based dashboard routing and access control (`lib/server/auth/policy.ts`)
- `user_profiles` table with role field
- Dashboard middleware (`proxy.ts`) — guards all `/dashboard/*` routes

---

## [0.1.0] — 2026-01-20

### Added
- Initial Next.js 16 App Router setup
- Supabase Auth integration (real login, session, JWT)
- Mock data mode for development without infrastructure
- Base UI with shadcn/ui + Tailwind CSS v4
