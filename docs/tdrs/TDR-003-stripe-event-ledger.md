# TDR-003: Stripe webhook event ledger for idempotent processing

**Status:** Implemented  
**Date:** 2026-05-04  
**Migration:** `0041_phase_17a_stripe_webhook_event_ledger.sql`

---

## Problem

Stripe delivers webhooks at-least-once. Without a deduplication mechanism, the same event (e.g., `checkout.session.completed`) could be processed multiple times, causing:
- Double earnings distribution
- Multiple project activations
- Duplicate point awards

---

## Decision

Introduce a `stripe_webhook_events` table that records every processed Stripe event ID before executing side effects.

On every webhook call:
1. Verify Stripe signature
2. Attempt to insert the event ID into `stripe_webhook_events`
3. If the insert succeeds → process the event (earnings, project activation, points)
4. If the insert fails (unique constraint) → return 200 immediately, skip side effects

---

## Implementation details

```sql
-- stripe_webhook_events table (simplified)
CREATE TABLE stripe_webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);
```

The webhook handler at `app/api/webhooks/stripe/route.ts` follows this exact pattern.

---

## Tradeoffs

| Concern | Decision |
|---|---|
| Distributed transaction (insert + side effects) | Not atomic — a crash after insert but before side effects would leave the event recorded but unprocessed. Accepted as an edge case at current scale. |
| Event visibility for ops | Not implemented — no admin UI to view the ledger. Tracked as next hardening step. |
| Replay mechanism | Not implemented — manual intervention required if an event is missed. |

---

## Test coverage

`tests/server/stripe/webhook-events.test.ts` verifies:
- First delivery executes side effects
- Second delivery with same event ID is a no-op

---

## Known gaps

- The ledger has no TTL or archival strategy. It will grow unbounded in production.
- No alerting when an event fails processing (crash after ledger insert).
- No admin UI to inspect the ledger or manually replay events.
