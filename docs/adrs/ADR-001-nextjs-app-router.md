# ADR-001: Use Next.js App Router as the primary application framework

**Status:** Accepted  
**Date:** 2026-04-01  
**Deciders:** Engineering team

---

## Context

NoonApp needs a single-codebase solution that handles:
- Server-side auth and session management (sensitive)
- Role-based route protection
- Mixed rendering: some pages need SSR, some are fully interactive client components
- API routes co-located with the application (no separate backend service)

---

## Decision

Use **Next.js 16 App Router** with React 19 as the application framework.

API routes live under `app/api/`. Server-side logic (auth, DB access) is isolated in `lib/server/`. Client components are only used where interactivity is required.

---

## Rationale

- App Router enables per-route auth guards without client-side redirects (guards run server-side via `lib/server/auth/guards.ts`).
- Co-located API routes eliminate the need for a separate Express/Fastify backend at this stage.
- Server Components reduce the client bundle for dashboard pages that are mostly read-heavy.
- Supabase SSR helpers (`@supabase/ssr`) are designed for Next.js App Router specifically.
- Vercel deployment is zero-config for Next.js.

---

## Consequences

- All data access for protected pages goes through `lib/server/` — never directly from a client component.
- `lib/data-context.tsx` is a known architectural debt: it is a large client-side provider that fetches domain data in bulk. It should be decomposed into per-domain server-fetched data as the app matures (tracked in `docs/production-readiness-audit.md`).
- Streaming and Suspense are available but not yet used. Rate limiting is per-instance (not distributed) until a production provider is chosen.
