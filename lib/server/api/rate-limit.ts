import { ApiError } from '@/lib/server/api/errors'

type RateLimitBucket = {
  count: number
  resetAt: number
}

export interface RateLimitOptions {
  namespace: string
  limit: number
  windowMs: number
  key?: string | null
  nowMs?: number
}

export class RateLimitExceededError extends ApiError {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Too many requests. Try again later.', 429)
    this.name = 'RateLimitExceededError'
  }
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

export function assertRateLimit(request: Request, options: RateLimitOptions) {
  if (process.env.NOON_RATE_LIMIT_DISABLED === 'true') return

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
    throw new RateLimitExceededError(Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)))
  }

  existing.count += 1
}

export function resetRateLimitStoreForTests() {
  buckets.clear()
}
