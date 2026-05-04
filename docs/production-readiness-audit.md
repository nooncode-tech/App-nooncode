# NoonApp production readiness audit

Last updated: 2026-05-04

## Current verdict

NoonApp is a recoverable production candidate, not a production-complete system. The app compiles and has real Supabase-backed flows, but production readiness is still blocked by limited automated coverage, incomplete abuse protection, weak observability, and several sensitive paths that need staged hardening.

## Verified state

- Stack: Next.js 16 App Router, React 19, TypeScript, pnpm, Tailwind v4, Supabase, Stripe, OpenAI and v0 SDK.
- Current executable checks before this hardening slice: `typecheck`, `lint`, and `build` pass.
- Test surface before this slice: no `npm test` script and no App-owned test files.
- Database surface: 44 migrations before `0041`, with RLS broadly enabled and remaining authenticated RPC warnings documented as security debt.
- Repo boundary: NoonApp and Noon Website remain separate products. Website owns public inbound/client/payment UI; App owns collaborator operations.

## Production blockers

- Testing: critical business paths did not have automated regression coverage.
- Security: public/token/AI/webhook surfaces lacked app-level rate-limit guards.
- Observability: server logs were not structured around request IDs or sanitized context.
- Stripe: webhook processing had signature verification and downstream idempotency, but no first-class event ledger to prevent duplicate side effects across retries.
- Architecture: `lib/data-context.tsx` remains a large client-side provider and should be split by domain.
- RPC hardening: direct authenticated RPC exposure remains intentional short-term debt and should be moved behind service-role-backed Next routes only in a dedicated security iteration.

## This slice

- Adds a reusable in-memory rate-limit foundation for high-risk API routes. This is a per-instance guard, not a distributed WAF replacement.
- Adds request IDs to hardened API responses.
- Adds a structured logger with recursive redaction for secrets, tokens, signatures, cookies and keys.
- Adds a Stripe webhook event ledger migration and server-side processing guard.
- Adds an initial `npm test` command using Node's test runner through `tsx`.
- Adds tests for rate limiting, log sanitization, Maxwell chat request validation, and Maxwell Lead Engine boundaries.

## Next hardening order

1. Expand automated tests around proposal review, payment activation, developer queue, wallet/earnings and auth/role negatives.
2. Replace in-memory rate-limit storage with a distributed production provider before high traffic.
3. Move Stripe event ledger review into an admin-only operational surface or alerting pipeline.
4. Split `lib/data-context.tsx` by domain and reduce global dashboard payloads.
5. Move authenticated RPCs behind dedicated Next routes with `service_role`, one flow at a time, with regression tests.
6. Add production monitoring/alerting provider integration once the provider is chosen.

## Manual production tasks

- Enable leaked password protection in Supabase Auth.
- Apply migration `0041_phase_17a_stripe_webhook_event_ledger.sql` to the real App Supabase only after preview validation.
- Confirm Vercel production env vars before rollout: Supabase, Stripe, OpenAI, v0, Website webhook secret and app URLs.
