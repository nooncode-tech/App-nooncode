# TDR-002: In-process rate limiting via sliding window counter

**Status:** Implemented  
**Date:** 2026-05-04  
**File:** `lib/server/api/rate-limit.ts`

---

## Problem

High-risk API routes (Maxwell AI, public webhooks, auth-adjacent endpoints) have no protection against abuse. A single actor can flood the server with requests at no cost.

---

## Decision

Implement a per-process sliding window rate limiter using an in-memory `Map`. The limiter tracks request timestamps per identifier (IP, userId, or any string key) and rejects requests that exceed the configured limit within the window.

---

## Implementation details

- Storage: `Map<string, number[]>` — entries are request timestamps per key
- Algorithm: sliding window (timestamps older than `windowMs` are pruned on each check)
- No external dependency (Redis, Upstash, etc.)
- Resets on server restart — this is intentional for the current deployment model

**Usage:**
```ts
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 })
const result = limiter.check('userId:abc')
if (!result.allowed) return new Response('Too Many Requests', { status: 429 })
```

---

## Tradeoffs

| Concern | Decision |
|---|---|
| Distributed rate limiting (multiple instances) | Not supported — in-memory only. Documented as pre-production debt. |
| Persistence across restarts | Not supported — intentional at this scale |
| Per-route vs global limits | Per-route. Each high-risk route creates its own limiter instance. |
| Redis / Upstash integration | Deferred until production traffic patterns are known |

---

## Test coverage

`tests/server/api/rate-limit.test.ts` verifies:
- Requests within the limit are allowed
- Requests exceeding the limit are rejected
- The window slides correctly (old timestamps are pruned)

---

## Known gaps

- Does not survive horizontal scaling. A Vercel deployment with multiple instances would have independent counters per instance.
- No admin visibility into current rate limit state.
- No alerting when the limit is hit in production.
- Must be replaced with a distributed provider before high traffic.
