# ADR-004: Defer ports and adapters — accept infrastructure coupling at current scale

**Status:** Accepted (with documented debt)  
**Date:** 2026-05-04  
**Deciders:** Engineering team

---

## Context

The system accesses external infrastructure (Supabase, Stripe, OpenAI, v0) directly from repository and service functions. There are no interface abstractions (ports) separating domain logic from infrastructure drivers.

The naming conventions (`repository.ts`, `service.ts`, `mappers.ts`) suggest awareness of layering, but the actual types that flow through the system are concrete SDK types (`SupabaseClient<Database>`, `Stripe`) — not domain interfaces.

---

## Decision

**Defer full hexagonal architecture (ports and adapters) until the domain stabilizes.**

The current approach is: repository functions accept the infrastructure client as a parameter (manual injection at call site) without defining an interface contract.

---

## Rationale

- The domain model is still evolving (features added every sprint). Premature port extraction would be refactored repeatedly as the model changes.
- The test suite currently validates behavior at the function level, not via mocked ports. Adding ports without tests that exercise them provides false confidence.
- The team size and velocity favor shipping working features over architectural purity at this stage.
- The Logger is the only infrastructure concern that is already abstracted cleanly (`lib/server/api/logger.ts`) — this can serve as the pattern when port extraction begins.

---

## When to revisit

This decision should be revisited when:
1. A second database provider becomes a real requirement.
2. Unit tests for domain logic need to mock infrastructure (currently not required).
3. The `stripe/service.ts` module becomes a maintenance burden (it currently mixes business logic and infrastructure calls in a single function).

---

## Consequences

- `SupabaseClient<Database>` is a concrete infrastructure type that appears throughout `lib/server/`. Replacing Supabase requires touching all repositories.
- `stripe/service.ts` cannot be unit-tested without network access or a Stripe mock.
- New infrastructure integrations (OpenAI, v0) follow the same pattern: direct SDK usage with no port abstraction.
- This is **explicit accepted debt**, not an oversight. It is tracked here and in `docs/production-readiness-audit.md`.
