import assert from 'node:assert/strict'
import test from 'node:test'
import { assertRateLimit, resetRateLimitStoreForTests } from '@/lib/server/api/rate-limit'

function requestForIp(ip: string) {
  return new Request('https://app.noon.test/api/test', {
    headers: {
      'x-forwarded-for': ip,
    },
  })
}

test('rate limit allows requests inside the configured window', () => {
  resetRateLimitStoreForTests()
  const request = requestForIp('203.0.113.10')

  assert.doesNotThrow(() => {
    assertRateLimit(request, {
      namespace: 'unit',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1000,
    })
    assertRateLimit(request, {
      namespace: 'unit',
      limit: 2,
      windowMs: 60_000,
      nowMs: 1001,
    })
  })
})

test('rate limit blocks requests after the limit is exceeded', () => {
  resetRateLimitStoreForTests()
  const request = requestForIp('203.0.113.11')

  assertRateLimit(request, {
    namespace: 'unit',
    limit: 1,
    windowMs: 60_000,
    nowMs: 1000,
  })

  assert.throws(
    () => assertRateLimit(request, {
      namespace: 'unit',
      limit: 1,
      windowMs: 60_000,
      nowMs: 1001,
    }),
    /Too many requests/
  )
})

test('rate limit resets after the configured window', () => {
  resetRateLimitStoreForTests()
  const request = requestForIp('203.0.113.12')

  assertRateLimit(request, {
    namespace: 'unit',
    limit: 1,
    windowMs: 1000,
    nowMs: 1000,
  })

  assert.doesNotThrow(() => assertRateLimit(request, {
    namespace: 'unit',
    limit: 1,
    windowMs: 1000,
    nowMs: 2001,
  }))
})
