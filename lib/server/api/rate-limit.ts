import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { ApiError } from '@/lib/server/api/errors'
import { logger } from '@/lib/server/api/logger'

type RateLimitBucket = {
  count: number
  resetAt: number
}

export interface RateLimitOptions {
  namespace: string
  limit: number
  windowMs: number
  key?: string | null
  /**
   * Test-only deterministic clock for the in-memory engine. The Upstash
   * engine ignores this value and always uses real Redis-side time.
   */
  nowMs?: number
}

export class RateLimitExceededError extends ApiError {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Too many requests. Try again later.', 429)
    this.name = 'RateLimitExceededError'
  }
}

export interface RateLimitEngine {
  consume(request: Request, options: RateLimitOptions): Promise<void>
}

const buckets = new Map<string, RateLimitBucket>()

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (
    forwardedFor ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  )
}

function cleanupExpiredBuckets(nowMs: number) {
  if (buckets.size < 1000) return

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= nowMs) {
      buckets.delete(key)
    }
  }
}

const inMemoryEngine: RateLimitEngine = {
  async consume(request, options) {
    const nowMs = options.nowMs ?? Date.now()
    cleanupExpiredBuckets(nowMs)

    const identity = options.key?.trim() || getClientIp(request)
    const bucketKey = `${options.namespace}:${identity}`
    const existing = buckets.get(bucketKey)

    if (!existing || existing.resetAt <= nowMs) {
      buckets.set(bucketKey, {
        count: 1,
        resetAt: nowMs + options.windowMs,
      })
      return
    }

    if (existing.count >= options.limit) {
      throw new RateLimitExceededError(
        Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000))
      )
    }

    existing.count += 1
  },
}

/**
 * Wraps an engine so non-rate-limit errors are caught and logged instead of
 * propagating to the caller. Fail-open policy: rate-limit is smoothing, not
 * auth. If the underlying store is unreachable we allow the request through
 * and log a warning so the operator can detect the outage in Vercel native
 * log streams.
 *
 * `RateLimitExceededError` is always re-thrown so callers can return 429 as
 * usual when the limit is genuinely exceeded.
 */
function withFailOpenLogging(inner: RateLimitEngine): RateLimitEngine {
  return {
    async consume(request, options) {
      try {
        await inner.consume(request, options)
      } catch (error) {
        if (error instanceof RateLimitExceededError) throw error

        logger.warn('rate_limit.upstash.fallback', {
          namespace: options.namespace,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}

function makeUpstashEngine(url: string, token: string): RateLimitEngine {
  const redis = new Redis({ url, token })
  const limiters = new Map<string, Ratelimit>()

  function getLimiter(limit: number, windowMs: number): Ratelimit {
    const cacheKey = `${limit}:${windowMs}`
    let limiter = limiters.get(cacheKey)
    if (!limiter) {
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
        prefix: '@noon/ratelimit',
        analytics: false,
      })
      limiters.set(cacheKey, limiter)
    }
    return limiter
  }

  const rawEngine: RateLimitEngine = {
    async consume(request, options) {
      const identity = options.key?.trim() || getClientIp(request)
      const bucketKey = `${options.namespace}:${identity}`

      const limiter = getLimiter(options.limit, options.windowMs)
      const result = await limiter.limit(bucketKey)

      if (!result.success) {
        const retryAfterMs = result.reset - Date.now()
        throw new RateLimitExceededError(
          Math.max(1, Math.ceil(retryAfterMs / 1000))
        )
      }
    },
  }

  return withFailOpenLogging(rawEngine)
}

let activeEngine: RateLimitEngine | null = null

function getEngine(): RateLimitEngine {
  if (activeEngine !== null) return activeEngine

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()

  activeEngine = url && token ? makeUpstashEngine(url, token) : inMemoryEngine
  return activeEngine
}

export async function assertRateLimit(
  request: Request,
  options: RateLimitOptions
): Promise<void> {
  if (process.env.NOON_RATE_LIMIT_DISABLED === 'true') return

  await getEngine().consume(request, options)
}

/**
 * Clear test state. Resets the in-memory Map and forces engine re-detection
 * on the next call (so changes to UPSTASH_REDIS_REST_URL / _TOKEN env vars
 * between tests are picked up).
 */
export function resetRateLimitStoreForTests() {
  buckets.clear()
  activeEngine = null
}

/**
 * Test-only seam. Injects a custom engine that overrides automatic detection.
 * Pass `null` to clear the override and let the next call re-detect from env.
 */
export function __setRateLimitEngineForTests(engine: RateLimitEngine | null) {
  activeEngine = engine
}

/**
 * Test-only seam. Exposes the fail-open wrapper so tests can verify the
 * production policy (RateLimitExceededError re-thrown, other errors logged
 * and swallowed) without needing to mock `@upstash/ratelimit` at the module
 * boundary.
 */
export function __withFailOpenLoggingForTests(inner: RateLimitEngine): RateLimitEngine {
  return withFailOpenLogging(inner)
}
