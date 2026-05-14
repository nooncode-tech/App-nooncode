# TDR-002: Distributed rate limiting via Upstash Redis with in-memory dev fallback

**Status:** Implemented
**Date:** 2026-05-13 (supersedes in-memory-only design from 2026-05-04)
**File:** `lib/server/api/rate-limit.ts`
**Supersedes:** TDR-002 (in-memory-only) — historical context preserved in §History.

---

## Problem

High-risk API routes (Maxwell AI, Stripe + NoonWeb webhooks, payments checkout, client portal, proposal review) need rate limiting to protect against abuse and accidental request loops. The original implementation (2026-05-04) used a per-process in-memory `Map` which has a known weakness flagged as an Active risk in `project.context.core.md`: under Vercel Fluid Compute, the same client gets inconsistent quota decisions across concurrent function instances, and any cold start resets the entire bucket store.

For FASE 1 (internal pilot) the in-memory limiter has been "good enough" because traffic is single-digit RPS. Once external traffic enters the picture, the limiter must give consistent decisions cluster-wide.

---

## Decision

Migrate to a **distributed rate limiter backed by Upstash Redis (Vercel Marketplace)**, with the in-memory implementation preserved as a **dev-local fallback** when Upstash env vars are not present.

The public API of `lib/server/api/rate-limit.ts` is preserved at the symbol level. `assertRateLimit` is now async (`Promise<void>`). All ~10 callers were updated to `await` atomically.

Engine selection happens at module load (and again after `resetRateLimitStoreForTests`):
- **Production** (Upstash env vars set): `@upstash/ratelimit` with sliding window algorithm, REST API to Upstash Redis instance.
- **Local dev** (env vars absent): existing Map-based fixed-window implementation, identical behavior to the pre-2026-05-13 module.

---

## Implementation details

### Engine interface

```ts
interface RateLimitEngine {
  consume(request: Request, options: RateLimitOptions): Promise<void>
}
```

Two implementations: `inMemoryEngine` (constant) and `makeUpstashEngine(url, token)` (factory). The Upstash factory caches `Ratelimit` instances per `(limit, windowMs)` config inside a Map so each unique policy gets its own SDK instance backed by the same `Redis` client.

### Storage

- **Upstash branch:** keys are `@noon/ratelimit:${namespace}:${identity}` (prefix from `Ratelimit` constructor's `prefix` option). Each key holds the sliding-window state internally managed by `@upstash/ratelimit`.
- **In-memory branch:** `Map<string, { count: number; resetAt: number }>` with `cleanupExpiredBuckets()` periodically pruning when the map grows past 1000 entries.

### Algorithm

- **Upstash:** `Ratelimit.slidingWindow(tokens, windowMs as Duration)` — true sliding window. Smoothes traffic more accurately than fixed-window. The `Duration` type accepts string literals like `"60000 ms"`.
- **In-memory:** fixed-window per bucket (count + resetAt timestamp). Algorithmically less precise but kept identical to the pre-migration behavior so existing tests pass bit-for-bit.

The semantic divergence between the two algorithms is sub-percent for the limits in use (8 to 600 req per minute) and is intentional. Dev local does not need production-accurate rate limiting; production needs Upstash for correctness across instances.

### Fail-open policy

Wrapped inside `withFailOpenLogging`:

- `RateLimitExceededError` from the inner engine is **re-thrown** so the API route can return HTTP 429 as designed.
- Any other error from the inner engine (Upstash unreachable, timeout, quota exceeded, auth failure on the Redis side, etc.) is **swallowed** and the request is allowed through. A `logger.warn('rate_limit.upstash.fallback', { namespace, error })` records the event so the operator can detect the outage in Vercel native log streams.

**Rationale.** Rate-limit is a smoothing mechanism, not an authentication gate. If Upstash is unreachable, denying all rate-limited traffic would convert a Redis outage into a full-service outage. Fail-open accepts a brief window of unbounded traffic in exchange for service continuity. Real auth/permission checks (`requireRole`, signature verification) run independently and are not affected.

### Test seams

Two `__`-prefixed exports for tests:

- `__setRateLimitEngineForTests(engine | null)` — replace the auto-detected engine with a custom one (allow / deny / throw). Used for testing the `assertRateLimit` contract without hitting real Redis.
- `__withFailOpenLoggingForTests(inner: RateLimitEngine)` — wrap a custom engine with the production fail-open logic so the wrapper can be tested in isolation.

Test coverage in `tests/server/api/rate-limit.test.ts`:
- In-memory: allow / deny / window reset (3 tests, unchanged contract)
- Engine injection: allow path, deny path with `retryAfterSeconds`
- Fail-open: wrapper swallows non-rate-limit errors, re-throws `RateLimitExceededError`
- `NOON_RATE_LIMIT_DISABLED='true'` escape hatch bypasses the engine entirely

---

## Tradeoffs

| Concern | Decision |
|---|---|
| Distributed rate limiting (multiple Fluid Compute instances) | **Supported** via Upstash Redis. Consistent decisions cluster-wide. |
| Persistence across restarts | **Supported** in Upstash (Redis-backed). In-memory branch still resets on restart, but that branch is dev-only. |
| Per-route vs global limits | Per-route (same as before). Each `assertRateLimit` call passes its own `namespace`/`limit`/`windowMs`. |
| External dependency | New: Upstash Redis. Provisioned via Vercel Marketplace, auto-injecting env vars. Free tier (10K commands/day) covers FASE 1 pilot traffic. |
| Tail latency added to every rate-limited request | ~10-30ms p99 to Upstash REST API from the same region. To be measured in production verification. If unacceptable, consider moving to region-pinned Upstash or accepting the in-memory regression for specific routes. |
| Failure mode of the new dependency | Fail-open with `logger.warn`. Service stays up; operator detects via log inspection. |
| API signature change (sync → async) | All ~10 callers updated atomically in the same PR. `tsc` enforces correctness. |
| Existing tests broken by async signature | All tests updated to `async` + `await`; existing in-memory behavior preserved bit-for-bit. |

---

## Provisioning (operator runbook)

1. Vercel Dashboard → project `App-nooncode` → Storage tab → Add → Upstash → Upstash Redis.
2. Pick a region close to the function region (typically `us-east-1` / `iad1`). Free plan is sufficient for FASE 1.
3. Vercel auto-injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into the project's env vars (Production + Preview scopes).
4. (Optional) `vercel env pull` to populate `.env.local` if you want dev to also use Upstash. Otherwise dev keeps using the in-memory fallback.
5. Trigger a redeploy. Subsequent function invocations pick up the engine on cold start.

To verify in production:
- Send rapid requests to a rate-limited endpoint (e.g. `/api/maxwell/lead-searches`, limit 8 per 15 min); requests beyond the limit should return HTTP 429.
- Check Vercel logs for the absence of `rate_limit.upstash.fallback` warnings — their presence means Upstash is failing and the limiter is fail-open.
- Check Upstash dashboard for command count / latency.

---

## Known gaps (post-migration)

- No admin visibility into current rate-limit state from the App UI.
- No alerting when the limit is hit in production (only `logger.warn` to Vercel native logs).
- Per-user-id keying not implemented — limiter uses client IP from forwarded headers.
- Free tier exhaustion would silently shift the limiter into fail-open mode. Upgrade trigger: operator monitors Upstash dashboard; when monthly command count crosses ~70% of free tier ceiling, upgrade to paid plan.
- Region-pinning not configured: if function region and Upstash region drift apart (e.g. multi-region deploy), tail latency may increase. Out of scope for B14; would be a separate iteration if it becomes a problem.

---

## History

The original TDR-002 (2026-05-04) recorded the in-memory-only design as transitional debt. The recommendation explicitly said "must be replaced with a distributed provider before high traffic" and the Active risk in `project.context.core.md` flagged it as work to be picked up. B14 (this iteration) closes that debt and supersedes the original TDR. The file was renamed from `TDR-002-rate-limiting-in-memory.md` to `TDR-002-rate-limiting-distributed.md` in the same commit that landed the migration. The previous content lives in git history.
