# ADR-003: Use Stripe Checkout for client payments

**Status:** Accepted  
**Date:** 2026-04-10  
**Deciders:** Engineering team

---

## Context

NoonApp needs to collect payments from clients (non-technical users, single-payment flow). The payment must:
- Be secure (PCI compliant)
- Require no client account
- Trigger automatic downstream effects (project activation, earnings distribution)
- Handle retries and duplicate events without double-processing

---

## Decision

Use **Stripe Checkout** (hosted payment page) with a webhook handler for downstream effects.

A Stripe event ledger (`stripe_webhook_events` table) records every processed event. Side effects (payment confirmation, project activation, earnings) only execute if the event is not already in the ledger.

---

## Rationale

- Stripe Checkout is PCI-compliant out of the box — no card data touches our servers.
- The hosted page works without client registration (token-based portal).
- Idempotency key per checkout session prevents duplicate session creation.
- The event ledger pattern (record-then-act) makes webhook processing safe under retry storms.
- Stripe's test mode allows full integration testing without real money.

---

## Consequences

- Checkout sessions are created server-side only (`lib/server/stripe/service.ts`). No Stripe keys are exposed to the browser.
- The `stripe/service.ts` module currently mixes business logic with infrastructure calls (Supabase + Stripe). This should be refactored into separate port/adapter layers in a future hardening iteration.
- Withdrawal approval is manual — the platform has no automated payout mechanism. Admin marks withdrawals as paid externally.
- Production webhook registration must be done via the Stripe dashboard (not CLI). This is a manual deployment step.
