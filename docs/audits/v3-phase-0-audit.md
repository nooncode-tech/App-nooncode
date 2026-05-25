# NoonApp v3 — Phase 0 Audit

Branch: `feature/v3-phase-0-audit`
Date: 2026-05-10
Author skill: `system-audit`
Scope: Read-only audit of the current `App-nooncode` repo against `docs/product/master-spec-v3.md` (38 sections) and `docs/product/master-spec-v3-flows.md` (9 diagrams). Six chunks (C1–C6).

This document is the diagnostic input for the next iteration's Plan ADR. It does not author plans, ADRs, code changes, migrations, or context updates. It records what is and what is not, with severities and routing recommendations.

---

## 1. Executive summary and recoverability verdict

### 1.1 What this repo actually is, today

`App-nooncode` is the **internal NoonApp platform only** (sales, delivery, PM, admin, developer). It is a Next.js 16 / React 19 / Supabase app with:

- Real Supabase auth + RLS, mature middleware (`proxy.ts`), role-aware routing.
- Real persistence for leads, lead activity, proposals, proposal review, payments, projects, project activity, tasks, task activity, internal updates feed, in-app notifications, prototype workspaces (sales-side request + delivery handoff), commercial wallet (credits) plus a parallel monetary wallet (`wallet_accounts` + `wallet_ledger_entries`), earnings ledger, withdrawal requests, points ledger, Stripe payments + Connect + webhooks with idempotent event ledger, outbound Maxwell Lead Engine V1 (Overpass/Nominatim + GPT audit), and a website inbound integration (signed webhooks + PM queue + review-decision callback).
- Two separate website-facing surfaces:
  - `/api/integrations/website/inbound-proposal` and `/api/integrations/website/payment-confirmed` (HMAC-signed webhooks consumed by the App).
  - `/client/[token]` token-gated client portal page rendered inside this repo, backed by `client_access_tokens` table, public RPC `resolve_client_token`, and `/api/client/{resolve,comments,resolve}`.
- A v0-backed prototype generation route at `/api/prototypes/[id]/generate` calling `v0-sdk` (sync mode), saving result as a prototype workspace `ready` state. No GPT/Opus/auto-fix loop is implemented.
- A general-purpose Maxwell chat at `/api/maxwell` (OpenAI gpt-4o-mini, optional `create_proposal` tool when scoped to a lead). This is the App-side outbound copilot.

### 1.2 What this repo is **not**

- It is **not** the website inbound Maxwell. The website is a separate product. This App only consumes signed inbound webhooks from it.
- It is **not** a navigable seller map. There is no MapLibre / OpenFreeMap surface; the leads list page only uses geolocation (`navigator.geolocation`) to seed Maxwell Lead Engine searches and to filter by distance. Pins, recommended-lead card, radius circle, "Buscar leads en esta zona", external navigation hand-off are not implemented.
- It is **not** a client-controlled Publish / Update Published Version / Version history / Rollback surface. The `/client/[token]` portal exposes status, latest update, comments — not previews, not publish, not version history.
- It does **not** implement the post-payment Maxwell AI MVP pipeline as defined in spec sec 15–22 (GPT/specification → V0 → Opus → Developer with up to 5 auto-fix cycles, escalation, project-type-specific generation, Private Preview vs Published). The current v0 generate route is a single sales-triggered prototype call, not a post-payment automatic pipeline.
- It does **not** offer 100/300/500 selectable seller fee. The pricing engine and webhook hard-code `sellerFee = 100` for outbound and split commissions on a fixed `(activationAmount - 100)` base.

### 1.3 Spec vs repo terminology — known load-bearing conflict

The v3 spec defines exactly **one Maxwell**: the unified AI orchestration identity that does inbound conversation, prototype, post-payment AI MVP, and lives on the website. `project.context.core.md` carries an explicit operating rule that **Maxwell V1 is App/outbound-only and must NOT be treated as the website inbound Maxwell**, because the v3 work is being scoped on top of an already-shipped Lead Engine V1 with different responsibilities. This conflict is documented in §4 and is the highest-priority resolution required before Phase 1 planning.

### 1.4 Recoverability verdict — program level

**Recoverable with effort.** The repo is structurally sound for the App-internal half of v3 spec and the website ↔ App handoff. It is materially incomplete for the client-portal experience (sec 8–10, 20–22), the post-payment AI MVP pipeline (sec 15–22), the seller map (sec 27–31), and the 100/300/500 seller fee model (sec 24).

The repo carries non-trivial debt: a parallel commercial wallet (`user_wallets` integer credits) bridged 1:1 to a monetary wallet (`wallet_accounts` USD) via migration `0025_phase_3a_bridge_wallet_compatibility.sql`; two competing migrations under the same number (`0024`, `0025`, `0026`, `0027`) — see §4; mock/real mixed delivery surfaces; rewards still partially mock-seeded; a Maxwell chat that is honest in `supabase` but cannot ground itself; v0 generation that is not version-controlled, not validated, not auto-fixed.

**Recommendation: do not rebuild. Recover module-by-module along the order in §6, with the Maxwell terminology resolution as the gating Phase 1 step.**

---

## 2. Module classification table

Decisions: **Recover** (mostly sound, bounded gap) · **Refactor** (functionally present but structurally risky) · **Rebuild** (too broken/misleading/expensive to salvage) · **Defer** (not on critical path now).

Mapping: `Spec sec` references the v3 master spec. Modules reflect the actual file/folder grouping in the repo.

| Module | Spec sec | Decision | Rationale |
|---|---|---|---|
| **Auth + RLS + middleware** (`lib/auth-context.tsx`, `proxy.ts`, `lib/server/auth/*`, `0001_phase_1a_auth_profiles.sql`) | 6, 35 | Recover | Real Supabase auth, role-aware route policy, dual-source rule (`lib/auth-context.tsx` and `lib/server/auth/policy.ts` keep parallel rule arrays — minor refactor) |
| **Roles model** (`admin`, `sales_manager`, `sales`, `pm`, `developer`) | 4 | Recover | Aligned with v3 internal-platform roles. v3 introduces no new internal roles in sec 4 beyond what exists. |
| **Client account / portal-side auth** (Google + magic link before payment, sec 6) | 6 | Rebuild | No client-account model exists. Payment is initiated by App roles via Stripe Checkout against a `lead.email`. The website is currently the only client surface; the App does not own pre-payment client auth. |
| **Inbound Maxwell on website** | 5.1, 7 | Defer | Lives in the separate website product, not this repo. App side (signed webhooks + PM queue) is Recover. |
| **Website → App signed inbound** (`/api/integrations/website/{inbound-proposal,payment-confirmed}`, `lib/server/website-integration.ts`, `lib/server/website-webhook-auth.ts`, `0034_phase_14a_website_inbound_integration.sql`, `0035_phase_14b_request_changes_review_action.sql`) | 5.1, 7 | Recover | HMAC sha256 with timestamp + 5-minute skew window, idempotent by `external_session_id` / `external_proposal_id` / `external_payment_id`, PM-approval gate before payment activation. Documented gap: no replay-protection nonce store; relies on uniqueness constraints. |
| **PM queue UI** (`/dashboard/pm-queue`, `/api/inbound/pm-queue/*`, `/api/proposals/[proposalId]/review`) | 5.1 | Recover | Approve / reject / request_changes / cancel actions wired to `review_proposal` RPC, plus retry of webhook callback. |
| **Review-decision callback to website** (`sendProposalReviewDecisionToWebsite`, `0035`) | 5.1 | Recover | Signed POST to `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL`, persists send/skip/fail states on `website_inbound_links`. |
| **Payment activation pipeline** (`activate_paid_proposal` RPC, `lib/server/payments/activation.ts`, `0037_phase_15b_payment_activation_and_payout_safety.sql`) | 7 | Recover | Atomic activation of payment + project + lead linkage. Used by both Stripe webhook and website payment-confirmed path. |
| **Stripe Checkout + Connect + Payouts** (`lib/server/stripe/*`, `/api/payments/checkout`, `/api/connect/*`, `/api/payouts/initiate`, `/api/webhooks/stripe`, `0026_phase_9a_stripe_payments.sql`, `0028_phase_9b_payments_insert_policy.sql`, `0041_phase_17a_stripe_webhook_event_ledger.sql`) | 7, 24 | Refactor | Functioning end-to-end with idempotent webhook ledger. Hard-coded $100 seller fee + fixed split inside webhook handler — incompatible with sec 24's 100/300/500 selector. Live keys not on Vercel (see §4). |
| **Outbound seller fee logic** (`lib/maxwell/pricing.ts` + Stripe webhook split) | 24 | Rebuild | Current implementation: `sellerFee = isOutbound ? 100 : 0`, no UI for 100/300/500 selection, no `Potential / Confirmed / Pending payout / Paid out / Cancelled` state machine on the seller fee specifically (earnings ledger has buckets but is generic). |
| **Lead persistence + assignment + lock/claim/release** (`/api/leads/*`, `lib/server/leads/*`, migrations 0002, 0003, 0004, 0010, 0011, 0012, 0019, 0027) | 23 | Recover | Real CRUD, activity timeline, proposals, follow-up, locking, sales-manager read alignment. Geo columns added in `0025_phase_3a_leads_geo_location.sql`. |
| **Outbound Maxwell Lead Engine V1** (`/api/maxwell/lead-searches`, `lib/server/maxwell/lead-engine.ts`, `0038_phase_16a_maxwell_lead_engine_v1.sql`) | (App-only, not in v3 sec mapping) | Recover | Real Overpass/Nominatim sourcing, GPT-first audit, dedupe, score/priority, speech generation. v3 spec mentions Maxwell Lead Engine in sec 23.1 once; otherwise the App-only spec governs it. |
| **Lead detail Maxwell affordances** (audit, speech, TTS, feedback) | 26 | Recover | Browser-validated. Honest in `supabase`. |
| **Seller map** (MapLibre/OpenFreeMap, pins, recommended lead, radius, "Buscar leads en esta zona", external navigation, real-time location) | 27–31 | Rebuild | Not implemented. Only `navigator.geolocation` reads inside `app/dashboard/leads/page.tsx` for Lead Engine seeding and distance filter. No map dependency in `package.json`. |
| **Lead source enum** | 23.1 | Recover | Already includes `maxwell`. Includes `website`. |
| **Proposal review + lifecycle** (`review_proposal` RPC, `0027_phase_3_proposal_lifecycle.sql`, `0035`) | 5.1, 9.1 | Recover | `pending_review / approved / rejected / changes_requested / cancelled / expired`, expiry on first open, version_number, superseded_by, special_case flag, reviewer audit. |
| **Projects + project activity + lineage + deep links** (`/api/projects/*`, `0005`, `0008`, `0009`, `0014–0017`, `0019`, `0023`) | 11, 22 | Recover | Trigger-backed project activity for status / pm / team / schedule events; activity rollup; sales-to-delivery lineage; deep links from feeds/notifications. |
| **Tasks + task activity** (`/api/tasks/*`, `0006`, `0007`, `0013`) | 11 | Recover | Persisted, RLS-scoped to PM/admin and assigned developer. |
| **Internal updates feed** (`/api/updates`, `/dashboard/updates`, `lib/server/updates/*`) | 22.1 | Recover | Honest, role-scoped. Bounded relative to "Modulo de actualizaciones" PDF scope. |
| **In-app notifications** (`/api/notifications/*`, `0018`, `0031_phase_12a_notification_preferences.sql`) | 33.1, 33.2 | Recover | Per-user inbox, dedupe, deep links resolved server-side. Notification preferences table exists; client preference UI is not surfaced (see §3). Push and email channels are out of scope. |
| **Client portal — token-gated** (`app/client/[token]`, `/api/client/{resolve,comments,resolve}`, `client_access_tokens`, `0032_phase_13a_client_portal.sql`) | 8 | Refactor | Project status, latest update, comments. No auth-before-payment, no preview, no publish, no versions, no rollback, no requests typology, no materials upload. Useful as starting scaffold for sec 8 minimum subset; not enough to satisfy sec 8.2/8.3 alone. |
| **Client requests inbox in the portal** (types, states, priorities, direct-to-developer, PM intervention) | 9 | Rebuild | No durable client request entity, no request_type enum, no request_status enum, no priority enum, no direct-to-developer routing, no PM intervention escalation. The `/api/client/comments` endpoint is a flat comment thread, not a request system. |
| **Materials/files upload in client portal** | 8.2 | Defer | No file storage path wired in this repo. Supabase Storage not referenced from client portal code. |
| **Versioning, Publish, Update Published, Rollback** | 20 | Rebuild | No project version table. No `Private Preview / Published / Previous Published / Rolled Back / Delivered` state machine. v0 generation writes a single `generated_content` field on `prototype_workspaces`. |
| **Post-payment Maxwell AI MVP pipeline** (GPT spec → V0 → Opus → Developer + 5-cycle auto-fix + min validation + escalation) | 15–19 | Rebuild | Not implemented. Closest existing capability is the manual sales-triggered v0 prototype call. Auto-trigger on payment confirmation does not exist. |
| **AI MVP project-type adaptation** (sec 18.1–18.8) | 18 | Rebuild | The current v0 prompt is generic React/Tailwind dashboard. No project-type branching. |
| **Wallet (credits)** (`user_wallets`, `user_wallet_entries`, `0020_phase_2o_wallet_prototype_credits_foundation.sql`, `0036_phase_15a_wallet_atomic_credit.sql`, `0042_phase_17b_wallet_maxwell_rpc_hardening.sql`) | (App-internal commercial credits) | Refactor | Functional integer-credit wallet for prototype debits. Bridged 1:1 to monetary wallet — see §4. |
| **Wallet (monetary USD)** (`wallet_accounts`, `wallet_ledger_entries`, payout methods, payout batches, payouts, `0024_phase_3a_monetary_wallet_foundation.sql`) | 7 (operational), 24 (visibility) | Refactor | 4-bucket model (`available_to_spend / available_to_withdraw / pending / locked`). Atomic credit RPC exists. Bridge to credits wallet is fragile and explicitly declared as debt. |
| **Earnings ledger + admin credit + commissions** (`earnings_ledger`, `0026_phase_3b_earnings_backend.sql`, `0027_phase_10a_commissions.sql`, `/api/earnings/*`, `/api/admin/earnings/*`) | 24 | Refactor | Real ledger plus generic commission seeds. Coupled to a hardcoded $100 seller-fee assumption inside Stripe webhook handler. |
| **Withdrawal requests** (`0029_phase_10b_withdrawal_requests.sql`, `/api/earnings/withdraw`, `/api/payouts/initiate`) | (sec 24 by extension) | Recover | Real flow exists for sellers/admins. |
| **Rewards / points** (`/api/rewards`, `0030_phase_11a_points_ledger.sql`) | (App-internal) | Recover | Real ledger, real surface in `/dashboard/rewards`. The previous "points are mock-only at `lib/data-context.tsx:442-443`" debt is now narrower than the router note implies — see §4.3. |
| **Notification preferences** (`0031_phase_12a_notification_preferences.sql`) | 33 | Refactor | Table exists; user preference UI is not surfaced; channel delivery (email/push) not implemented. |
| **Web analysis** (`/api/web-analysis`, `/dashboard/web-analysis`) | (not in v3 spec) | Defer | Outside v3 spec scope; record as scope-adjacent existing surface. |
| **i18n** (`<html lang="es">`, no detection) | 32 | Rebuild | Static `lang="es"`; no device/browser language detection, no Spanish/English fallback rule wired. |
| **Build / deploy / observability** (`next.config.mjs` w/ security headers, `vercel.json`, `scripts/validate-runtime-env.ts`) | 34 | Recover | Recent work added security headers, prod dependency audit, postcss override, dropped pnpm version mismatch. Logger is structured. |

---

## 3. Findings

Format: `ID | Severity | Type | Owner Skill | Description | Impact | Recommended Action`.
Severity: Critical / High / Medium / Low. Type: code / contract / infra / security / docs / testing / data.

| ID | Sev | Type | Owner | Description | Impact | Recommended Action |
|---|---|---|---|---|---|---|
| F-01 | Critical | docs | system-analysis | Maxwell terminology conflict between v3 spec sec 5.1 ("single Maxwell" — orchestration identity covering inbound, prototype, post-payment AI MVP) and `project.context.core.md` operating rule ("Maxwell V1 is App/outbound-only and must NOT be treated as the website inbound Maxwell"). | Blocks scoping of every spec phase that references Maxwell (5–10, 15–22). Risk of either silently overwriting the App outbound Lead Engine V1 or shipping a second AI identity that contradicts spec. | Resolve in next iteration via Analysis: either (a) keep Maxwell as the umbrella identity with subsystems `Maxwell Inbound (website)`, `Maxwell Lead Engine (App outbound)`, `Maxwell AI MVP (post-payment)`, `Maxwell Chat (App copilot)`, or (b) rename the App-side outbound surface. Document in spec sec 4.2 + a focused ADR. |
| F-02 | Critical | data | system-architecture | Bridge wallet 1:1: migration `0025_phase_3a_bridge_wallet_compatibility.sql` seeds `wallet_accounts.available_to_spend` from `(free_credits_balance + earned_credits_balance)` and dual-writes both wallets on every prototype debit. Inline comment: "Conversión del bridge: 1 crédito = $1.00 USD (temporal hasta Fase 2)". | Two sources of truth for the same balance. Drift risk on any mutation that touches only one wallet. Already a known debt; must be retired before any commercial monetary feature ships. | Schedule a dedicated wallet-unification iteration (Architecture-led). Decide: keep credits as a UX abstraction over the monetary wallet, or fully retire credits. Until then, freeze direct writes to `user_wallets` outside the bridged RPCs. |
| F-03 | Critical | infra | system-infra | Stripe live keys are not on Vercel (per router handoff; not visible from repo). `.env.example` lists `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and notes "live keys ONLY on production Vercel". | Blocks any production payment activation, blocks production seller-fee work, blocks v3 sec 7 acceptance in production. | Provision live + webhook secrets in Vercel `production` env (Infra), confirm the webhook event ledger is healthy, then validate one end-to-end flow against live Stripe before opening Phase 7+. |
| F-04 | Critical | code | system-architecture | Migration numbering collisions: four pairs reuse the same prefix — `0024_phase_3a_monetary_wallet_foundation` vs `0024_phase_5a_prototype_settings_admin_write`, `0025_phase_3a_bridge_wallet_compatibility` vs `0025_phase_3a_leads_geo_location`, `0026_phase_3b_earnings_backend` vs `0026_phase_9a_stripe_payments`, `0027_phase_10a_commissions` vs `0027_phase_3_proposal_lifecycle`. Apply order is filename-sort dependent. | Risk of inconsistent apply order across environments; future renumbering is risky once applied to prod. Confuses any tool that assumes monotonic prefixes. | Architecture: decide whether to renumber (and re-baseline) or freeze the convention to allow same-prefix concurrency with explicit dependencies documented. Do **not** silently rewrite history on remote. |
| F-05 | Critical | contract | system-architecture | Spec sec 24 mandates seller selectable fee 100 / 300 / 500 USD with state machine `Potential / Confirmed / Pending payout / Paid out / Cancelled`. Repo hard-codes $100 in two places: `lib/maxwell/pricing.ts:56` and `app/api/webhooks/stripe/route.ts` (`base = activationAmount - 100`, `seller earning = 100`). | The current outbound monetization is structurally incompatible with spec sec 24. Cannot be patched in place; needs a dedicated slice covering UI selector, persisted choice on proposal, webhook split, earnings state. | Phase 8 owner: Architecture defines the selectable-fee contract before Backend changes. Webhook split must read the persisted seller-fee from the proposal/payment record, not from a code constant. |
| F-06 | High | contract | system-architecture | Post-payment Maxwell AI MVP pipeline (sec 15–19) is not implemented. Existing `/api/prototypes/[id]/generate` is a single sync v0 call, no GPT spec layer, no Opus improvement, no validation, no auto-fix loop, no escalation, no project-type branching, no Private Preview wiring. | Blocks v3 sec 7 acceptance ("payment confirmed → AI MVP pipeline starts automatically") and sec 15–22 entirely. | Architecture: design pipeline as a queued worker (cron + queue table, or external runner) with explicit state machine and bounded LLM cost; introduce `project_versions` and validation step before client visibility. |
| F-07 | High | contract | system-architecture | Versioning / Publish / Update Published / Rollback (sec 20) is not implemented. No `project_versions` table, no Private Preview vs Published distinction, no client publish action. | Blocks sec 20–21 entirely. Required by client-portal acceptance. | Architecture: design version model + publish event + rollback path, with permission rules per role. |
| F-08 | High | contract | system-architecture | Client requests typology + states + priorities + direct-to-developer routing (sec 9–10) does not exist. The portal currently exposes a single comment thread. | Blocks sec 9 acceptance and the membership/one-time scope rules in sec 10. | Architecture: design `client_requests` (type / state / priority / membership-aware), wired to developer board and PM intervention rules. |
| F-09 | High | contract | system-architecture | Seller map (sec 27–31) does not exist in any form. Only `navigator.geolocation` reads exist on `/dashboard/leads` for Maxwell Lead Engine seeding. | Blocks sec 27–31 entirely (Phase 7). | Architecture: pick MapLibre + OpenFreeMap (per sec 28.1), define lead-pin contract, recommended-lead selection rule, "Buscar en esta zona" Lead Engine integration, external navigation hand-off, list/map sync. |
| F-10 | High | code | system-architecture | Client portal is App-resident (`app/client/[token]`) but the v3 spec model is "client portal lives in the website / client portal product, not in the internal NoonApp" (sec 2, 8.1). | Architectural drift: every future client-portal feature added in this repo widens the coupling and contradicts spec. | Decide explicitly: either move the client portal out of this repo into the website product, or amend spec sec 2.1/8.1 to acknowledge App-hosted portal subset. Document outcome in an ADR. |
| F-11 | High | security | system-security | Webhook signing infrastructure exists for the website link (`x-noon-signature`, timestamped HMAC, 5-minute skew) but there is **no nonce / replay-id store**: replay protection relies entirely on uniqueness constraints (`external_session_id`, `external_proposal_id`, `external_payment_id`). A replay carrying a different external id would not be detected. | Medium-impact replay risk on the inbound contract. | Add a small `webhook_event_seen(event_id, source)` ledger or extend `stripe_webhook_events` style ledger to cover website inbound. Out of scope for Phase 0; record for Security review. |
| F-12 | High | data | system-architecture | `lib/data-context.tsx` still hosts large amounts of mixed mock/persisted state in client memory (leads/projects/tasks merged with `mockProjects` / `mockTasks`, `users` from `mockUsers`, `userPoints` seeded from `mockUsers`, `pointsHistory` empty in client). | Future client-portal and AI MVP work will keep paying the cost of the centralised client store. | Architecture: stage progressive de-mocking iterations (already noted in `project.context.full.md`). |
| F-13 | High | code | system-architecture | Two parallel definitions of dashboard route policy: `lib/auth-context.tsx` and `lib/server/auth/policy.ts` both declare `dashboardRouteAccessRules` with identical entries. | Drift risk: a future spec route added to one will silently bypass middleware in the other. | Refactor to a single source of truth shared by both contexts. Tag for Refactor in the next stable iteration. |
| F-14 | High | docs | system-docs | `docs/context/project.context.full.md` carried a stale absolute developer-local repo path and referred to past phase numbering. **Cleanup applied 2026-05-14 as part of F-V03 closure** (absolute paths removed from `project.context.core.md` line 7 and `project.context.full.md` line 10). Past-phase-numbering note remains as standing cleanup item if it ever resurfaces. | Risk of confusion for new contributors and for AI agents loading deep context. | Resolved 2026-05-14 for the absolute-path portion; phase-numbering note deferred. |
| F-15 | Medium | contract | system-architecture | i18n (sec 32). `app/layout.tsx` hard-codes `<html lang="es">`; no detection, no English fallback. | Blocks sec 32 acceptance. | Architecture: design language detection (Accept-Language / device locale) with explicit fallback to English. |
| F-16 | Medium | code | system-frontend | Client portal `app/client/[token]/page.tsx` mixes Spanish UI and `'es-MX'` locale literals; no i18n abstraction even for portal text. | Couples client-facing copy to single locale. | Frontend: introduce minimal locale boundary on the client portal before adding more surfaces. |
| F-17 | Medium | code | system-architecture | `next.config.mjs` security headers are recently added (commit `a389507`) but were not reviewed against website ↔ App cross-origin requirements (signed webhook origin, client portal token URLs, Stripe redirect URLs). | Possible production friction once live keys are added. | Infra/Security review during Phase 7 deploy prep. |
| F-18 | Medium | code | system-frontend | `/dashboard/prototypes` exposes commercial workspace surface but does not yet show v0 generation output; `/api/prototypes/[id]/generate` route writes `generated_content` but no surface renders it. | Live preview surface is missing; satisfies neither sec 19.3 nor sec 20.1. | Frontend, after Architecture lands the AI MVP pipeline contract. |
| F-19 | Medium | data | system-architecture | `prototype_workspaces` carries only `current_stage` (`sales` / `delivery`) and `status` (`pending_generation` / `ready` / `delivery_active` / `archived`). Sec 20.6 needs `Draft / Ready for Client Preview / Client Preview / Published / Previous Published / Rolled Back / Delivered Version` per project, not per prototype. | Cannot satisfy sec 20.6 by extending prototype_workspaces; needs a new entity. | Architecture: introduce `project_versions` independent of `prototype_workspaces`. |
| F-20 | Medium | contract | system-architecture | Notification preferences table exists (`0031`), but no UI surface and no channel delivery (email/push). Spec sec 33 requires per-role notifications. | Partial implementation hides risk: user can think a preference is honored. | Architecture: scope sec 33 explicitly — keep in-app only for now or expand to email/push with an Infra dependency. |
| F-21 | Medium | code | system-architecture | `lib/server/maxwell/lead-engine.ts` is a single ~1000+-line file (audit schema, Overpass/Nominatim, GPT call, scoring, persistence, speech). | Maintainability risk; harder to test in isolation. | Refactor into module boundary (`audit-schema`, `sources`, `scoring`, `persistence`) when next Maxwell iteration touches it. |
| F-22 | Medium | testing | system-testing | `package.json` test script exists (`tsx --test tests/**/*.test.ts`) but the only tests in `tests/` are minimal; no integration coverage on the high-risk surfaces (Stripe webhook, website inbound, payment activation, wallet bridge, prototype generation). | High-risk paths regress silently. | Testing: prioritise contract tests for webhook handlers and `activate_paid_proposal`; defer broader coverage to per-iteration scope. |
| F-23 | Medium | docs | system-docs | `docs/api-auth-matrix.md` is recent (commit `99d3297`) and is the right place to absorb v3 contracts as they land. | None as written; risk if not maintained. | Docs maintenance ongoing. |
| F-24 | Medium | code | system-architecture | `client_access_tokens` are issued via authenticated insert by sales/admin/pm/sales_manager but the table has only `select` policies plus `insert` for those roles; no rotation, no revocation, no per-event scope. | Long-lived tokens with broad scope. | Architecture: when client-portal sec 8 work lands, add token rotation/expiry/revocation. |
| F-25 | Medium | code | system-frontend | `components/maxwell-chat.tsx` is honest in `supabase` mode about lacking workspace context, but the App copilot has no contract for grounding into leads/pipeline/reports. | Limits Maxwell App-copilot usefulness; not a v3 spec gap directly, but tied to F-01 outcome. | Defer to Maxwell-resolution iteration. |
| F-26 | Low | docs | system-docs | Spec sec 35 lists a Phase 1 ("Documentation/context") but the repo's docs pipeline is already mature (`docs/context/*`, `docs/adrs/*`, `docs/tdrs/*`, `docs/api-auth-matrix.md`, `docs/business/*`). | None. The next iteration should reuse, not create, docs structure. | Docs: keep current structure, plug v3 contracts into it. |
| F-27 | Low | code | system-frontend | `app/page.tsx` shows demo accounts only in `mock` auth mode; otherwise routes to `/dashboard`. Login UX uses email + password. Spec sec 6.1 specifies Google + magic-link fallback. | Out-of-scope for App-internal users (existing seller/dev/PM/admin users authenticate with passwords). Becomes blocking only when client-portal auth (sec 6) lands. | No action in Phase 0; flag for sec 6 architecture. |
| F-28 | Low | docs | system-docs | The `docs/context/project.context.full.md` history mixes commit-style narrative with operating rules. | Increases the cost of every context load. | Docs: split into runtime truth vs change history, or compact periodically. Out of scope for Phase 0. |
| F-29 | Low | code | system-frontend | `/dashboard/web-analysis` exists but is outside v3 spec scope. | None directly. | Defer; document as out-of-scope existing surface. |
| F-30 | Low | data | system-architecture | `lead_origin` enum (`inbound` / `outbound`) is referenced by Stripe webhook to drive seller-vs-noon split. Adding a third channel (e.g. `referral`) would silently fall into the inbound branch. | Forward compatibility risk only. | Architecture, on next channel addition. |

---

## 4. Spec-vs-reality conflict register

This section records every place where the v3 spec and the actual repository disagree, in spec section order plus any cross-cutting items. Mandatory items requested by router are flagged ★.

### 4.1 ★ Maxwell name conflict (sec 5.1 vs `project.context.core.md`)

- **Spec sec 5.1** describes a single Maxwell that drives website inbound conversation, generates prototypes, asks necessary questions, and (sec 15) orchestrates the post-payment AI MVP pipeline.
- **`project.context.core.md`** carries an operating rule that Maxwell V1 is App/outbound/seller-only and must NOT be treated as the website inbound Maxwell.
- **Repo evidence**: `app/api/maxwell/route.ts` (App copilot), `app/api/maxwell/lead-searches/route.ts` (App outbound Lead Engine V1), `lib/server/maxwell/lead-engine.ts`, `components/maxwell-chat.tsx`, `docs/product/maxwell-lead-engine-v1.md`. There is no website-side Maxwell surface in this repo, by design.
- **Conflict**: Phase 1 cannot proceed without naming and ownership clarity. Recording only — resolution is the next iteration's user-decision.

### 4.2 ★ Bridge wallet 1:1 declared as debt

- **Spec**: sec 7 requires that payment confirmation atomically activates project + earnings; sec 24 separates seller-fee earning from membership and from any internal credits system.
- **Repo evidence**: `0020_phase_2o_wallet_prototype_credits_foundation.sql` (credits wallet), `0024_phase_3a_monetary_wallet_foundation.sql` (USD wallet), `0025_phase_3a_bridge_wallet_compatibility.sql` (1 credit = $1.00 USD bridge — explicit "temporal hasta Fase 2" comment), `0036_phase_15a_wallet_atomic_credit.sql` (atomic credit RPC).
- **Conflict**: dual source of truth for the same balance; bridge writes USD on every credit debit. Acceptable as transitional debt only.

### 4.3 ★ Mock rewards / points

- **Router note**: "Rewards/points mock-only at `lib/data-context.tsx:442-443`".
- **Repo evidence**:
  - `lib/data-context.tsx:442-443`: `const [rewards] = useState<Reward[]>(mockRewards)` and `const [users] = useState<User[]>(mockUsers)`.
  - `userPoints` and `pointsHistory` in `lib/data-context.tsx` are also seeded from mock.
  - `0030_phase_11a_points_ledger.sql` and `/api/rewards/route.ts` exist; `app/dashboard/rewards/page.tsx` consumes the real `/api/rewards` endpoint in `supabase` mode (loads `balance`, `ledger`, `storeItems` from server).
- **Reality**: rewards/points are real on the server side and on the rewards page. The remaining mock dependency is in `lib/data-context.tsx` (legacy seed for non-rewards surfaces and for the user dropdown). Treat as **partial** mock debt, not full mock-only.

### 4.4 ★ Stripe live keys absent (Vercel)

- **Repo evidence**: `.env.example` documents the required keys but explicitly says "live keys ONLY on production Vercel". No production validation in this repo can confirm presence; router handoff confirms absence.
- **Impact**: blocks any v3 sec 7 / sec 24 production validation.

### 4.5 Migrations 0020–0022, 0024–0026, 0034–0035, 0038, 0041 reconciliation

| Migration | Maps to v3 sec | Status |
|---|---|---|
| `0020_phase_2o_wallet_prototype_credits_foundation` | (App-internal credits, support sec 15) | Recover; coupled to F-02. |
| `0021_phase_2p_prototype_delivery_handoff` | sec 11 (Take project), sec 15 (delivery validation) | Recover. |
| `0022_phase_2q_prototype_project_linkage_foundation` | sec 11, sec 15 | Recover. |
| `0024_phase_3a_monetary_wallet_foundation` | sec 7, sec 24 | Refactor; numbering collision with `0024_phase_5a_prototype_settings_admin_write`. |
| `0024_phase_5a_prototype_settings_admin_write` | sec 15 (admin-controlled prototype cost) | Recover; numbering collision. |
| `0025_phase_3a_bridge_wallet_compatibility` | sec 7, sec 24 | F-02 critical debt. |
| `0025_phase_3a_leads_geo_location` | sec 27, sec 30 (lead lat/lng) | Recover; numbering collision. |
| `0026_phase_3b_earnings_backend` | sec 24 | Refactor (coupled to fixed-$100 split). |
| `0026_phase_9a_stripe_payments` | sec 7 | Recover; numbering collision with `0026_phase_3b_earnings_backend`. |
| `0034_phase_14a_website_inbound_integration` | sec 5.1, 7 | Recover. |
| `0035_phase_14b_request_changes_review_action` | sec 5.1, 9.1 | Recover. |
| `0038_phase_16a_maxwell_lead_engine_v1` | App outbound (not in v3 phase mapping) | Recover; F-01 affects naming. |
| `0041_phase_17a_stripe_webhook_event_ledger` | sec 7 | Recover. |

### 4.6 Other recorded conflicts

- **Sec 2.1 / 8.1 vs repo**: spec puts the client portal in the website product; this repo hosts `app/client/[token]`. See F-10.
- **Sec 6 (auth before payment, Google + magic link)**: not implemented; the App login is email+password for internal users. See F-27.
- **Sec 9 (client requests typology / states / priorities / direct-to-developer)**: not implemented. See F-08.
- **Sec 10 (one-time vs membership scoping rules)**: payments and earnings exist; the rule engine that classifies a request against scope/membership does not. See F-08.
- **Sec 11.3 SLA for unclaimed projects (2h / 4h / 8h / 24h)**: no SLA timer or escalation cron exists.
- **Sec 12 permanent project context**: `projects` row has metadata fields, but no first-class "permanent project context" entity covering proposal + prototype + materials + history + decisions.
- **Sec 14 developer principal replacement flow**: no formal flow, no audit trail entry type.
- **Sec 15–19 Maxwell AI MVP pipeline**: not implemented. See F-06.
- **Sec 20 versions / publish / rollback**: not implemented. See F-07, F-19.
- **Sec 21 feedback per version**: requires sec 20 first.
- **Sec 22.1 internal activity log**: largely covered by `lead_activities`, `task_activities`, `project_activities`; AI MVP / version events are missing because sec 15–20 are missing.
- **Sec 22.2 client-visible updates**: client portal shows latest update; no `Project delivered`, `Membership update`, `New version available` events.
- **Sec 24 100/300/500 selectable seller fee**: hard-coded $100. See F-05.
- **Sec 25 seller promises and disputes**: no formal dispute path on proposals.
- **Sec 26 commercial activity logging**: lead activity exists; many automatic event types from sec 26 (`prototype_generated`, `proposal_viewed`, `payment_confirmed`, `lead_released`) are partially covered; explicit naming and full coverage are not audited here.
- **Sec 27–31 seller map**: not implemented. See F-09.
- **Sec 32 i18n**: not implemented. See F-15, F-16.
- **Sec 33.1 / 33.2 / 33.3 notifications**: in-app inbox is real; channel delivery and per-role full coverage are partial. See F-20.
- **Sec 34 infra audit before adding services**: respected in current state.

### 4.7 Mermaid flow reconciliation (master-spec-v3-flows.md)

| Diagram | Sec | Status in repo |
|---|---|---|
| 2 Macro flow | macro | Inbound branch real on App side from website handoff onward. Outbound branch real except seller-fee selection and map. |
| 3 Inbound flow | sec 5.1 / 7 | App receives signed webhooks; pre-payment client experience is in the website product (out of scope for this repo). |
| 4 Outbound flow | sec 5.2 | Real except sec 5.2 step 7 ("seller chooses fee 100/300/500"), step 5/8 map context. |
| 5 Post-payment AI pipeline | sec 15–19 | Not implemented. |
| 6 Client portal versioning | sec 20 | Not implemented. |
| 7 Client request flow | sec 9 | Not implemented. |
| 8 Developer responsibility | sec 11–14 | "Take project" not implemented as an explicit affordance. SLA escalation not implemented. Replacement flow not implemented. |
| 9 Seller map | sec 27–31 | Not implemented. |
| 10 Seller fee financial visibility | sec 24 | Not implemented as selectable fee. |

---

## 5. Critical blockers and unsafe assumptions

### 5.1 Blockers (cannot start Phase 1 without addressing)

1. **F-01 Maxwell terminology resolution.** Until decided by the user, every Phase 5+ slice is structurally ambiguous.
2. **F-04 Migration numbering collisions.** Architecture must decide whether to renumber locally-only future migrations or formally accept the convention. Either way, document before adding more migrations.

### 5.2 Production-blocking

3. **F-03 Stripe live keys.** Required before any v3 sec 7 / sec 24 production behavior is validated. Infra task.
4. **F-02 Bridge wallet.** Required before any v3 sec 24 monetization slice can be safely extended.
5. **F-05 Hardcoded $100 seller fee.** Required before opening sec 24 work.

### 5.3 Architecturally load-bearing assumptions

6. The current v0 generation code path is **not** the foundation of the v3 AI MVP pipeline. Treat it as a sales-time prototype only, and design the post-payment pipeline as a separate worker (F-06).
7. The client portal (`app/client/[token]`) is a transitional surface in this repo only. The v3 spec puts it in the website product (sec 2.1, 8.1). Either accept the divergence in an ADR or migrate (F-10).
8. The website ↔ App integration is the App's only contract with the website. All v3 inbound additions should extend `lib/server/website-integration.ts` and `0034`/`0035` rather than re-inventing.
9. `lib/data-context.tsx` will continue to be the client-state shape for App surfaces; no rewrite is in scope.
10. Roles in v3 sec 4 do not introduce new internal role types (developer principal is a per-project attribute, not a role). The repo's role enum is sufficient.
11. The Maxwell App-copilot route (`/api/maxwell`) and the Maxwell Lead Engine route (`/api/maxwell/lead-searches`) are independent. Neither replaces the other. Any unification or rename is a F-01 outcome.

---

## 6. Proposed phase ordering for spec phases 1–8

This is **recommendation only** for the next iteration's planning skill. It is not a plan, not an ADR, not a contract.

### Pre-Phase: resolve before Phase 1 starts

- **PR0a — Maxwell terminology decision** (Analysis output): pick the umbrella-vs-rename outcome from F-01. Update spec sec 4.2 and add ADR.
- **PR0b — Migration numbering decision** (Architecture output): pick renumber-vs-accept-convention. No code change to applied migrations on remote.
- **PR0c — Stripe live keys provisioning** (Infra): can run in parallel with PR0a/PR0b.

### Phase 1 — Documentation and contracts (spec sec 35 Phase 1)

- Propagate PR0a/PR0b decisions into `docs/context/*` (without R-codes / Sprint refs / plan-IDs, per memory rule).
- Land a contracts skeleton for: client requests, project versions, AI MVP pipeline state, seller fee state machine.

### Phase 2 — Auth before payment + portal activation (spec sec 6, 7)

- Decide F-10 (portal location). If portal stays in this repo, design Google + magic link client auth (sec 6.1). If portal moves to website, this Phase 2 reduces to the App-side activation contract (already present via `activate_paid_proposal`).

### Phase 3 — Client requests (sec 9–10)

- Land `client_requests` entity, types, states, priorities, direct-to-developer routing, PM intervention. Honor membership rules (sec 10).

### Phase 4 — Developer board responsibility (sec 11–14)

- Add explicit `Take project` action, SLA timer (2h/4h/8h/24h), developer principal attribute on project, replacement flow, handoff entity.

### Phase 5 — Maxwell AI MVP pipeline (sec 15–19)

- Implement post-payment automatic trigger, GPT specification layer, V0 base generation (reuse current v0 client), Opus improvement step, validation (sec 19.1), 5-cycle auto-fix (sec 19.2), escalation, project-type branching (sec 18.1–18.8).
- Depends on PR0a Maxwell decision.

### Phase 6 — Versioning and publish (sec 20–22)

- Introduce `project_versions`, Private Preview vs Published distinction, Update Published, Rollback, version history, feedback per version.
- Depends on Phase 5.

### Phase 7 — Seller map (sec 27–31)

- Add MapLibre + OpenFreeMap, pins, recommended-lead card, "Buscar leads en esta zona", external navigation, list/map sync.
- Independent of Phase 5/6; can run in parallel if capacity allows.

### Phase 8 — Seller fee 100/300/500 (sec 24)

- Persist seller-fee selection on proposal, drive Stripe webhook split from persisted value, surface seller-fee state machine.
- Depends on PR0c (Stripe live keys).

### Cross-cutting

- i18n (sec 32) — slot before Phase 5 if client-portal expansion happens here, otherwise after Phase 7.
- Notifications expansion (sec 33) — slot when channel delivery is needed.
- Wallet unification (F-02) — schedule before Phase 8.

---

## 7. Open questions for the user

These are decisions the next iteration's Analysis skill will need before scoping Phase 1.

1. **Maxwell naming and ownership** (F-01): umbrella with subsystems, or rename App-side outbound? This decision changes how every subsequent Phase 5 slice is scoped.
2. **Client portal location** (F-10): keep `app/client/[token]` in this repo as a transitional surface, or move client-portal work to the website product per spec sec 2.1/8.1?
3. **Migration numbering** (F-04): renumber locally-pending migrations, or accept multi-suffix convention with explicit dependency notes?
4. **Wallet model** (F-02): keep credits as a UX abstraction over the monetary wallet, or retire credits entirely? When?
5. **Pre-payment client auth** (sec 6): Google + magic link is mandated by spec — is that work owned by the website product or by this repo?
6. **AI MVP pipeline runtime**: Vercel cron + queue table, or external worker? This affects Phase 5 design and Infra cost.
7. **Seller-fee state machine ownership** (sec 24): is the state machine on the seller-fee row inside `earnings_ledger`, or a new `seller_fees` entity?
8. **i18n scope** (sec 32): client portal only, App internal only, or both? English fallback rule confirmed?
9. **Notifications channels** (sec 33): keep in-app only for now, or open email/push as part of v3?
10. **Versioning entity scope** (sec 20): per-project version history with explicit Published / Previous Published rows, or only "current Published + last preview"?

---

End of audit deliverable.
