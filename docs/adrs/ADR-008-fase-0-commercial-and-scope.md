# ADR-008: FASE 0 commercial scope and team posture

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Pedro (Engineering owner)
**Closes:** roadmap §2 decisions #1 and #7
**Related:** ADR-010 (portal lives in NoonWeb), `docs/business/noonapp-roadmap.md` §2

---

## Context

The roadmap at `C:\Users\pbu50\Desktop\Noon App\roadmap\NoonApp Roadmap.md` §2 lists seven gating decisions that must be closed before FASE 1 (cutover pilot) can be safely scoped. Two of those decisions define the operational scope of the next 4-6 weeks:

- **Decision 1** — what was promised to the client final. This is the gating commercial question: if the sales path has already committed to delivering the v3 client portal (auth pre-pago + post-payment self-service portal), the hybrid A→B route described in roadmap §3 is unsafe because clients are expecting a feature that does not exist yet.
- **Decision 7** — team availability. Roadmap timing estimates assume 1 senior developer full-time. With 2 devs and contract-first discipline (roadmap §10.1), the FASE 1-3 path compresses ~30%.

Both decisions were left open at the close of B3 (seller-fee state machine) and B4 (ADR-006 migration prefix reconciliation), which executed during the FASE 0 window but did not formally close §2.

---

## Decision

**Mode of operation through FASE 1-3 is "internal-only" (Option A in roadmap §3):** NoonApp is operated as an internal workspace by sellers, PMs, developers, and admins. The client final has **no portal access during FASE 1-3**. Communication with the client is operator-mediated (the operator inside NoonApp manages the relationship out-of-band — email, phone, WhatsApp).

**Team posture is "variable":** Pedro is full-time on NoonApp. Occasional collaboration with other developers may happen for specific blocks (e.g. B2 bridge wallet retiro, cross-repo coordination with NoonWeb), but the roadmap estimates are computed as the 1-dev floor. Acceleration when additional help arrives is opportunistic, not planned.

---

## Rationale

### Why internal-only is safe today

As of 2026-05-13, **no client has an active account in `noon-web-main` that is expecting the portal to be live**. The v3 client portal at `/portal/[projectId]` does not yet exist in NoonWeb's repo (verified 2026-05-13 against `nooncode-org/noon-web-main` — only `/app/[locale]/maxwell/proposal/[token]/page.tsx` exists for proposal review/payment). No client has been told to wait for a self-service portal.

Operating internally now lets the team:

- Process inbound from NoonWeb (already wired via signed webhook).
- Run outbound from Maxwell Lead Engine V1 (seller-side).
- Charge real money via Stripe Checkout (B1 in FASE 1 Día 1).
- Earn real seller fees via the state machine landed in B3.

All of that delivers real revenue and real product learning **months before** v3 ships. The hybrid A→B route in roadmap §3 is the cheapest path to that outcome.

### Why the 1-dev assumption is conservative

Pedro is the only developer guaranteed to be on the project full-time during FASE 1-3. Treating the roadmap estimates as 1-dev figures avoids the planning trap of assuming help that may or may not arrive. If a second developer joins for a discrete block (e.g. helps with B14 rate limiter Upstash migration), the estimates compress organically but the floor stays honest.

---

## Consequences

### What this enables

- FASE 1 cutover pilot can be scoped immediately. Decisions 2-6 of §2 are independently closed (see ADR-007 for #2, ADR-009 for #3, ADR-010 for #4, ADR-011 for #5 and #6).
- The commercial messaging is unambiguous: NoonApp is sold as **internal tooling for the Noon team**, not as a self-service product for end clients.
- The cross-repo coordination with NoonWeb (roadmap §11) can proceed without portal-related pressure: NoonApp is the operator workspace, NoonWeb owns the future client portal.

### What this forbids

- No commercial conversation may promise the v3 client portal as an imminent deliverable. If sales/marketing wants to mention v3, the messaging must be roadmap-visible ("we are building a client portal that will ship in v3, expected mes 3-7") not commitment-binding.
- No code in App-nooncode may surface a client-facing UI that pretends the portal is operational. The existing `/client/[token]` route is legacy debt (see ADR-010 §Consequences) and is not the v3 portal.

### Re-evaluation triggers

This ADR must be revisited when **any** of the following happen:

- The first client signs up in `noon-web-main` with an active account and expects portal access.
- A second developer joins full-time → revise team posture and shorten the FASE 1-3 estimates per roadmap §10.6.
- A commercial conversation makes a portal-related commitment that has not been authorized → escalate to revise this ADR before the commitment becomes a hard expectation.

---

## Alternatives considered

- **Option B (skip cutover, go straight to v3):** rejected. Adds 4-6 months of opportunity cost with zero revenue or learning during that window.
- **Option A with portal placeholder in App:** rejected via ADR-010. Placing the portal in App contradicts the v3 architecture and creates migration debt to be paid twice.

---

## Lifecycle

- **Author:** Pedro (system-docs)
- **Supersedes:** nothing
- **Superseded by:** nothing
