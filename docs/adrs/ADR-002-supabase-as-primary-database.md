# ADR-002: Use Supabase as the primary database and auth provider

**Status:** Accepted  
**Date:** 2026-04-01  
**Deciders:** Engineering team

---

## Context

NoonApp needs:
- A relational database (leads, proposals, projects, tasks, payments, earnings — all relational)
- Row-Level Security (multi-role access control at the DB layer)
- Authentication without building it from scratch
- A managed service (no infra ops at this stage)

---

## Decision

Use **Supabase** (PostgreSQL) as the primary database, auth provider, and RPC host.

The Supabase client is instantiated server-side only (`lib/server/supabase/`). The admin client (service role) is used only for privileged operations. The browser client exists for real-time subscriptions if needed.

---

## Rationale

- RLS enforces access control at the DB layer, reducing the risk of logic bugs exposing data across roles.
- Supabase Auth provides session management (JWT + cookies) with Next.js SSR helpers out of the box.
- SQL migrations (`supabase/migrations/`) give a full audit trail of schema evolution.
- PostgreSQL RPCs (`claim_released_lead`, `release_lead_as_no_response`) allow atomic operations that would be unsafe as multi-step application logic.
- The managed service eliminates infra ops burden at the current team size.

---

## Consequences

- All repositories accept `SupabaseClient<Database>` as a parameter — this is dependency injection at the call site, but there are **no interface abstractions (ports)** over the DB layer. Switching DB providers would require rewriting all repository functions. This is accepted as a tradeoff for speed at the current scale.
- Authenticated RPCs remain exposed as a known security debt. They should be moved behind service-role-backed Next.js API routes in a dedicated hardening iteration.
- Type safety is provided via generated `database.types.ts` — this file must be regenerated after every schema change.
- The `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to the browser. All admin client usage is gated to `lib/server/`.
