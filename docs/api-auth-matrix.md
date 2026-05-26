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
| `app/api/earnings/route.ts` | Authenticated session principal | `requirePrincipal` from `lib/server/auth/guards.ts` |
| `app/api/earnings/history/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/earnings/withdraw/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/integrations/website/inbound-proposal/route.ts` | HMAC-signed payload from marketing site (contract: `docs/integrations/cross-repo-webhook-v1.md` §3) | `readSignedWebsiteJson` from `lib/server/website-webhook-auth.ts` |
| `app/api/integrations/website/payment-confirmed/route.ts` | HMAC-signed payload (contract: `docs/integrations/cross-repo-webhook-v1.md` §4) | `readSignedWebsiteJson` |
| `app/api/integrations/website/prototype-decision/route.ts` | HMAC-signed payload (contract: `docs/integrations/cross-repo-webhook-v1.md` §5; B+C slice impl 2026-05-25, ledger-backed per ADR-016/ADR-023) | `readSignedWebsiteJsonWithRawBody` |
| `app/api/integrations/website/prototype-signed-read/[token]/route.ts` | HMAC-signed GET with zero-body signing input (`${timestamp}.`); contract: `docs/integrations/cross-repo-webhook-v1.md` §6 + ADR-024 (impl 2026-05-26); rate-limit 60/min combined key `${token}:${ip}`; `Cache-Control: private, max-age=30, stale-while-revalidate=60` on 200, `no-store` on 4xx/5xx; transport ledger declined-by-design per ADR-024 D1 | `verifyWebsiteWebhookSignature` |
| `app/api/leads/auto-followup/route.ts` | `Authorization: Bearer ${CRON_SECRET}` | inline `isCronAuthorized` |
| `app/api/notifications/route.ts` | Authenticated session principal | `requirePrincipal` from `lib/server/auth/guards.ts` |
| `app/api/notifications/[notificationId]/read/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/notifications/preferences/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/rewards/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/search/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/updates/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/wallet/route.ts` | Authenticated session principal | `requirePrincipal` |
| `app/api/webhooks/stripe/route.ts` | Stripe webhook signature | `stripe.webhooks.constructEvent` |

All 16 are protected. There is no unauthenticated `/api/*` endpoint in the codebase.

## Protection mechanisms in use

1. **Role guard** — `requireRole(['admin' | 'sales_manager' | ...])`. Used by 36 routes. Throws `ForbiddenError` if the session lacks the required role. Source: `lib/server/auth/guards.ts`.
2. **Authenticated principal** — `requirePrincipal()`. Used by 11 routes when any logged-in user is acceptable but role is irrelevant. Throws `AuthGuardError('UNAUTHENTICATED', 401)` on missing session; the outer try/catch + `toErrorResponse` maps to a uniform `{ error, code: 'UNAUTHENTICATED' }` 401 body. `getCurrentPrincipal()` is the **null-returning sibling** used by server components / layouts that render conditionally on auth state (`app/layout.tsx`, `app/not-found.tsx`, `app/global-error.tsx`); it is NOT used in `app/api/**/route.ts` per the canonical pattern documented below.
3. **Client portal token** — public token validated against `client_access_tokens`. Used by 2 client-portal routes that proxies cannot route through Supabase auth (the client is unauthenticated to Supabase and only holds a per-link token).
4. **HMAC signature** — `readSignedWebsiteJson` validates a signed payload sent by the public marketing site (`NOON_WEBSITE_WEBHOOK_SECRET`). Used by 2 integration routes. Signature verification + timestamp staleness check.
5. **Cron bearer token** — `Authorization: Bearer ${CRON_SECRET}`. Used by `app/api/leads/auto-followup/route.ts`. Vercel Cron sends this header; rotating `CRON_SECRET` per environment scopes who can trigger the route.
6. **Stripe webhook signature** — `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`. Used by `app/api/webhooks/stripe/route.ts`. Stripe-issued signatures, with replay protection via the same SDK call.

## Canonical pattern (G24 closure 2026-05-26)

**API routes (`app/api/**/route.ts`):** use `requirePrincipal()` (throws). The outer `try { ... } catch (err) { return toErrorResponse(err, ...) }` wrapper maps `AuthGuardError('UNAUTHENTICATED', ...)` to a 401 with body `{ error: 'An active session is required.', code: 'UNAUTHENTICATED' }`. Do NOT use `getCurrentPrincipal()` + manual null-check + `NextResponse.json({error:'Unauthorized'},{status:401})` — that pattern produced inconsistent 401 body shapes across routes and was migrated to `requirePrincipal()` in branch `chore/g24-auth-principal-helpers-consolidation` (2026-05-26).

**Server components / layouts (`app/layout.tsx`, `app/not-found.tsx`, `app/global-error.tsx`):** use `getCurrentPrincipal()` from `lib/server/auth/session.ts` (returns null). Layouts must render anonymously when no session exists — they cannot throw 401 because that breaks rendering. This is the legitimate use case for the null-returning variant.

**Role-gated dashboard endpoints:** use `requireRole(['admin', 'pm', ...])` from `lib/server/auth/guards.ts`. Wraps `requirePrincipal()` + role allowlist check.

**Path-policy-gated:** use `requireDashboardAccess(pathname)` from `lib/server/auth/guards.ts`. Wraps `requirePrincipal()` + `canAccessDashboardPath(role, path)` policy check.

### Phantom reference clarification

The Lista-App originally tracked "consolidar 4 helpers (requireRole, requireAuth, requirePrincipal, getCurrentPrincipal)". On investigation, **`requireAuth` does not exist** in this codebase — never has. The real helpers and their roles:

- `requireSession()` — `Session` or throw (raw Supabase session, rarely used directly)
- `requireProfile()` — `UserProfile` or throw (profile + active check, rarely used directly)
- `requirePrincipal()` — `AuthenticatedPrincipal` or throw (**canonical for API routes**)
- `requireRole(roles)` — `AuthenticatedPrincipal` or throw (role-gated wrapper)
- `requireDashboardAccess(path)` — `AuthenticatedPrincipal` or throw (path-gated wrapper)
- `getCurrentPrincipal()` — `AuthenticatedPrincipal | null` (**canonical for server components**)
- `getCurrentSession()`, `getCurrentUser()`, `getCurrentProfile()` — null-returning getters at lower abstraction layers

The consolidation completed in G24 was the **5 routes** that incorrectly used `getCurrentPrincipal` in `app/api/**/route.ts`. They were migrated to `requirePrincipal` to unify the 401 body shape across all API routes.
