# API authentication matrix

Audited 2026-05-09 against `feature/sprint-5-hardening`.

`proxy.ts` enforces session and role policy on `/dashboard/:path*`. It does **not** cover `/api/:path*`. Each API route handles its own protection. This document catalogues the protection mechanism for every route under `app/api/`.

## Summary

- **52 route files** in `app/api/**/route.ts`.
- **36** call `requireRole(...)` directly — typical authenticated, role-gated dashboard endpoints.
- **16** use one of four other protection mechanisms (none is "public" or unauthenticated).

## Routes that do not use `requireRole`

| Route | Mechanism | Helper / source |
|---|---|---|
| `app/api/client/comments/route.ts` | Per-request token validated against `client_access_tokens` table | inline lookup + `assertRateLimit` |
| `app/api/client/resolve/route.ts` | Per-request token resolved via `resolveClientToken` | `lib/server/client-portal/repository.ts` |
| `app/api/earnings/route.ts` | Authenticated session principal | `getCurrentPrincipal` from `lib/server/auth/session.ts` |
| `app/api/earnings/history/route.ts` | Authenticated session principal | `getCurrentPrincipal` |
| `app/api/earnings/withdraw/route.ts` | Authenticated session principal | `getCurrentPrincipal` |
| `app/api/integrations/website/inbound-proposal/route.ts` | HMAC-signed payload from marketing site (contract: `docs/integrations/cross-repo-webhook-v1.md` §3) | `readSignedWebsiteJson` from `lib/server/website-webhook-auth.ts` |
| `app/api/integrations/website/payment-confirmed/route.ts` | HMAC-signed payload (contract: `docs/integrations/cross-repo-webhook-v1.md` §4) | `readSignedWebsiteJson` |
| `app/api/integrations/website/prototype-decision/route.ts` | HMAC-signed payload (contract: `docs/integrations/cross-repo-webhook-v1.md` §5; B+C slice impl 2026-05-25, ledger-backed per ADR-016/ADR-023) | `readSignedWebsiteJsonWithRawBody` |
| `app/api/leads/auto-followup/route.ts` | `Authorization: Bearer ${CRON_SECRET}` | inline `isCronAuthorized` |
| `app/api/notifications/route.ts` | Authenticated session principal | `requirePrincipal` from `lib/server/auth/guards.ts` |
| `app/api/notifications/[notificationId]/read/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/notifications/preferences/route.ts` | Authenticated session principal | `getCurrentPrincipal` |
| `app/api/rewards/route.ts` | Authenticated session principal | `getCurrentPrincipal` |
| `app/api/search/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/updates/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/wallet/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/webhooks/stripe/route.ts` | Stripe webhook signature | `stripe.webhooks.constructEvent` |

All 16 are protected. There is no unauthenticated `/api/*` endpoint in the codebase.

## Protection mechanisms in use

1. **Role guard** — `requireRole(['admin' | 'sales_manager' | ...])`. Used by 36 routes. Throws `ForbiddenError` if the session lacks the required role. Source: `lib/server/auth/guards.ts`.
2. **Authenticated principal** — `requirePrincipal()` and `getCurrentPrincipal()`. Used by 10 routes when any logged-in user is acceptable but role is irrelevant. Both return the same principal shape; they coexist for historical reasons (see follow-up below).
3. **Client portal token** — public token validated against `client_access_tokens`. Used by 2 client-portal routes that proxies cannot route through Supabase auth (the client is unauthenticated to Supabase and only holds a per-link token).
4. **HMAC signature** — `readSignedWebsiteJson` validates a signed payload sent by the public marketing site (`NOON_WEBSITE_WEBHOOK_SECRET`). Used by 2 integration routes. Signature verification + timestamp staleness check.
5. **Cron bearer token** — `Authorization: Bearer ${CRON_SECRET}`. Used by `app/api/leads/auto-followup/route.ts`. Vercel Cron sends this header; rotating `CRON_SECRET` per environment scopes who can trigger the route.
6. **Stripe webhook signature** — `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`. Used by `app/api/webhooks/stripe/route.ts`. Stripe-issued signatures, with replay protection via the same SDK call.

## Follow-up tracked for Sprint 6 (not a Sprint 5 blocker)

**Helper fragmentation.** `requireRole`, `requireAuth`, `requirePrincipal`, and `getCurrentPrincipal` overlap. `requirePrincipal` and `getCurrentPrincipal` resolve the same principal but throw / return-null with different defaults; routes choose between them inconsistently (4 routes use `getCurrentPrincipal`, 6 use `requirePrincipal`, both for the same intent: any authenticated user).

This is a refactor concern, not a security gap. Tracked as a Sprint 6 ADR (consolidate auth helpers and document the canonical pattern per route type).
