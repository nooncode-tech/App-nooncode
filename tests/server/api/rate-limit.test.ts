import assert from 'node:assert/strict'
import test from 'node:test'
import {
  __resolveDistributedRedisCredentialsForTests,
  __setRateLimitEngineForTests,
  __withFailOpenLoggingForTests,
  assertRateLimit,
  RateLimitExceededError,
  resetRateLimitStoreForTests,
  type RateLimitEngine,
} from '@/lib/server/api/rate-limit'

function requestForIp(ip: string) {
  return new Request('https://app.noon.test/api/test', {
    headers: {
      'x-forwarded-for': ip,
    },
  })
}

// In-memory engine — auto-selected when UPSTASH_REDIS_REST_URL / _TOKEN are
// not configured (the default in tests + local dev).

test('in-memory: rate limit allows requests inside the configured window', async () => {
  resetRateLimitStoreForTests()
  const request = requestForIp('203.0.113.10')

  await assert.doesNotReject(async () => {
    await assertRateLimit(request, {
      namespace: 'unit',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1000,
    })
    await assertRateLimit(request, {
      namespace: 'unit',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1001,
    })
  })
})

test('in-memory: rate limit blocks requests after the limit is exceeded', async () => {
  resetRateLimitStoreForTests()
  const request = requestForIp('203.0.113.11')

  await assertRateLimit(request, {
    namespace: 'unit',
    limit: 1,
    windowMs: 60_000,
    nowMs: 1000,
  })

  await assert.rejects(
    () => assertRateLimit(request, {
      namespace: 'unit',
      limit: 1,
      windowMs: 60_000,
      nowMs: 1001,
    }),
    /Too many requests/
  )
})

test('in-memory: rate limit resets after the configured window', async () => {
  resetRateLimitStoreForTests()
  const request = requestForIp('203.0.113.12')

  await assertRateLimit(request, {
    namespace: 'unit',
    limit: 1,
    windowMs: 1000,
    nowMs: 1000,
  })

  await assert.doesNotReject(() => assertRateLimit(request, {
    namespace: 'unit',
    limit: 1,
    windowMs: 1000,
    nowMs: 2001,
  }))
})

// Engine-injected tests — simulate the Upstash production path by injecting
// a custom engine that controls allow/deny/throw outcomes deterministically.
// This avoids hitting a real Redis from the test suite.

test('engine injection: assertRateLimit allows when the injected engine resolves', async () => {
  resetRateLimitStoreForTests()
  let calls = 0
  const engine: RateLimitEngine = {
    async consume() {
      calls += 1
    },
  }
  __setRateLimitEngineForTests(engine)

  await assert.doesNotReject(() => assertRateLimit(requestForIp('203.0.113.20'), {
    namespace: 'inject-allow',
    limit: 10,
    windowMs: 60_000,
  }))

  assert.equal(calls, 1, 'injected engine should be consulted exactly once per call')

  __setRateLimitEngineForTests(null)
  resetRateLimitStoreForTests()
})

test('engine injection: assertRateLimit denies when the injected engine throws RateLimitExceededError', async () => {
  resetRateLimitStoreForTests()
  const engine: RateLimitEngine = {
    async consume() {
      throw new RateLimitExceededError(42)
    },
  }
  __setRateLimitEngineForTests(engine)

  await assert.rejects(
    () => assertRateLimit(requestForIp('203.0.113.21'), {
      namespace: 'inject-deny',
      limit: 10,
      windowMs: 60_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RateLimitExceededError, 'expected RateLimitExceededError')
      assert.equal((error as RateLimitExceededError).retryAfterSeconds, 42)
      return true
    }
  )

  __setRateLimitEngineForTests(null)
  resetRateLimitStoreForTests()
})

// Fail-open policy tests — verify the wrapper that the production Upstash
// engine uses internally. RateLimitExceededError is re-thrown; everything
// else is swallowed and the operator can detect the outage via the warn log.

test('fail-open: wrapped engine swallows non-rate-limit errors (Upstash outage)', async () => {
  resetRateLimitStoreForTests()
  const rawEngine: RateLimitEngine = {
    async consume() {
      throw new Error('Upstash unreachable')
    },
  }
  __setRateLimitEngineForTests(__withFailOpenLoggingForTests(rawEngine))

  await assert.doesNotReject(() => assertRateLimit(requestForIp('203.0.113.30'), {
    namespace: 'fail-open',
    limit: 5,
    windowMs: 60_000,
  }))

  __setRateLimitEngineForTests(null)
  resetRateLimitStoreForTests()
})

test('fail-open: wrapped engine re-throws RateLimitExceededError so callers can still return 429', async () => {
  resetRateLimitStoreForTests()
  const rawEngine: RateLimitEngine = {
    async consume() {
      throw new RateLimitExceededError(15)
    },
  }
  __setRateLimitEngineForTests(__withFailOpenLoggingForTests(rawEngine))

  await assert.rejects(
    () => assertRateLimit(requestForIp('203.0.113.31'), {
      namespace: 'fail-open-deny',
      limit: 5,
      windowMs: 60_000,
    }),
    (error: unknown) => {
      assert.ok(error instanceof RateLimitExceededError)
      assert.equal((error as RateLimitExceededError).retryAfterSeconds, 15)
      return true
    }
  )

  __setRateLimitEngineForTests(null)
  resetRateLimitStoreForTests()
})

// Env-var resolution tests — the rate limiter accepts either Vercel naming
// convention for the Upstash-backed Redis integration. UPSTASH_REDIS_REST_*
// is preferred; KV_REST_API_* is the same backend exposed under Vercel's KV
// product branding.

function withRedisEnv(
  values: Partial<{
    UPSTASH_REDIS_REST_URL: string | null
    UPSTASH_REDIS_REST_TOKEN: string | null
    KV_REST_API_URL: string | null
    KV_REST_API_TOKEN: string | null
  }>,
  fn: () => void
) {
  const keys = [
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
  ] as const
  const previous: Record<string, string | undefined> = {}
  for (const key of keys) {
    previous[key] = process.env[key]
    const next = values[key]
    if (next === undefined) continue
    if (next === null) {
      delete process.env[key]
    } else {
      process.env[key] = next
    }
  }
  try {
    fn()
  } finally {
    for (const key of keys) {
      const prev = previous[key]
      if (prev === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = prev
      }
    }
  }
}

test('env resolution: prefers UPSTASH_REDIS_REST_* when both pairs are set', () => {
  withRedisEnv(
    {
      UPSTASH_REDIS_REST_URL: 'https://upstash.example',
      UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
      KV_REST_API_URL: 'https://kv.example',
      KV_REST_API_TOKEN: 'kv-token',
    },
    () => {
      const creds = __resolveDistributedRedisCredentialsForTests()
      assert.deepEqual(creds, { url: 'https://upstash.example', token: 'upstash-token' })
    }
  )
})

test('env resolution: falls back to KV_REST_API_* when UPSTASH_* are absent', () => {
  withRedisEnv(
    {
      UPSTASH_REDIS_REST_URL: null,
      UPSTASH_REDIS_REST_TOKEN: null,
      KV_REST_API_URL: 'https://kv.example',
      KV_REST_API_TOKEN: 'kv-token',
    },
    () => {
      const creds = __resolveDistributedRedisCredentialsForTests()
      assert.deepEqual(creds, { url: 'https://kv.example', token: 'kv-token' })
    }
  )
})

test('env resolution: returns null when neither pair is configured', () => {
  withRedisEnv(
    {
      UPSTASH_REDIS_REST_URL: null,
      UPSTASH_REDIS_REST_TOKEN: null,
      KV_REST_API_URL: null,
      KV_REST_API_TOKEN: null,
    },
    () => {
      const creds = __resolveDistributedRedisCredentialsForTests()
      assert.equal(creds, null)
    }
  )
})

test('env resolution: empty-string UPSTASH_* values fall through to KV_REST_API_* (the .env.example default shape)', () => {
  withRedisEnv(
    {
      UPSTASH_REDIS_REST_URL: '',
      UPSTASH_REDIS_REST_TOKEN: '',
      KV_REST_API_URL: 'https://kv.example',
      KV_REST_API_TOKEN: 'kv-token',
    },
    () => {
      const creds = __resolveDistributedRedisCredentialsForTests()
      assert.deepEqual(creds, { url: 'https://kv.example', token: 'kv-token' })
    }
  )
})

test('env resolution: requires both halves of the same or mixed pair (URL alone is insufficient)', () => {
  withRedisEnv(
    {
      UPSTASH_REDIS_REST_URL: 'https://upstash.example',
      UPSTASH_REDIS_REST_TOKEN: null,
      KV_REST_API_URL: null,
      KV_REST_API_TOKEN: null,
    },
    () => {
      const creds = __resolveDistributedRedisCredentialsForTests()
      assert.equal(creds, null)
    }
  )
})

test('NOON_RATE_LIMIT_DISABLED escape hatch bypasses the engine entirely', async () => {
  resetRateLimitStoreForTests()
  let calls = 0
  const engine: RateLimitEngine = {
    async consume() {
      calls += 1
    },
  }
  __setRateLimitEngineForTests(engine)

  const previous = process.env.NOON_RATE_LIMIT_DISABLED
  process.env.NOON_RATE_LIMIT_DISABLED = 'true'

  try {
    await assertRateLimit(requestForIp('203.0.113.40'), {
      namespace: 'disabled',
      limit: 1,
      windowMs: 60_000,
    })
    assert.equal(calls, 0, 'engine must not be consulted when NOON_RATE_LIMIT_DISABLED is true')
  } finally {
    if (previous === undefined) {
      delete process.env.NOON_RATE_LIMIT_DISABLED
    } else {
      process.env.NOON_RATE_LIMIT_DISABLED = previous
    }
    __setRateLimitEngineForTests(null)
    resetRateLimitStoreForTests()
  }
})
