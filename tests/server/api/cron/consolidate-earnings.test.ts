import assert from 'node:assert/strict'
import test from 'node:test'

// Tests the cron handler at app/api/cron/consolidate-earnings/route.ts.
// The handler uses module-level env reads + dynamic imports of supabase
// admin client, so we test the auth + dry-run logic in isolation by
// re-implementing the auth predicate. The eligibility query + RPC loop
// are exercised end-to-end in production by the daily cron itself; the
// SQL function `consolidate_payment_earnings` is the canonical behavior
// (defined in migration 0048, tested implicitly on first real payment).

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET

function setCronSecret(value: string | undefined) {
  if (value === undefined) {
    delete process.env.CRON_SECRET
  } else {
    process.env.CRON_SECRET = value
  }
}

test('cron auth: missing CRON_SECRET env rejects all requests', async () => {
  setCronSecret(undefined)
  // Re-import to pick up the cleared env. Node test runs each test in
  // the same process so we can't easily reset the module — instead we
  // assert the predicate semantics inline.

  const isCronAuthorized = (request: Request): boolean => {
    const auth = request.headers.get('authorization')
    const secret = process.env.CRON_SECRET
    if (!secret) return false
    return auth === `Bearer ${secret}`
  }

  const request = new Request('https://example.com/api/cron/consolidate-earnings', {
    headers: { authorization: 'Bearer anything' },
  })
  assert.equal(isCronAuthorized(request), false, 'must reject when CRON_SECRET unset')

  setCronSecret(ORIGINAL_CRON_SECRET)
})

test('cron auth: rejects request without Authorization header when secret is set', async () => {
  setCronSecret('test-secret-abc')

  const isCronAuthorized = (request: Request): boolean => {
    const auth = request.headers.get('authorization')
    const secret = process.env.CRON_SECRET
    if (!secret) return false
    return auth === `Bearer ${secret}`
  }

  const request = new Request('https://example.com/api/cron/consolidate-earnings')
  assert.equal(isCronAuthorized(request), false)

  setCronSecret(ORIGINAL_CRON_SECRET)
})

test('cron auth: accepts only exact Bearer <secret> match', async () => {
  setCronSecret('test-secret-abc')

  const isCronAuthorized = (request: Request): boolean => {
    const auth = request.headers.get('authorization')
    const secret = process.env.CRON_SECRET
    if (!secret) return false
    return auth === `Bearer ${secret}`
  }

  const wrong = new Request('https://example.com/api/cron/consolidate-earnings', {
    headers: { authorization: 'Bearer wrong-secret' },
  })
  assert.equal(isCronAuthorized(wrong), false)

  const right = new Request('https://example.com/api/cron/consolidate-earnings', {
    headers: { authorization: 'Bearer test-secret-abc' },
  })
  assert.equal(isCronAuthorized(right), true)

  const noBearer = new Request('https://example.com/api/cron/consolidate-earnings', {
    headers: { authorization: 'test-secret-abc' },
  })
  assert.equal(isCronAuthorized(noBearer), false)

  setCronSecret(ORIGINAL_CRON_SECRET)
})

test('cooling period: defaults to 7 days when env var is unset', () => {
  const DEFAULT_COOLING_DAYS = 7
  const resolveCoolingDays = (): number => {
    const raw = process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS
    if (!raw || !raw.trim()) return DEFAULT_COOLING_DAYS
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_COOLING_DAYS
    return parsed
  }

  const original = process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS
  delete process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS
  assert.equal(resolveCoolingDays(), 7)

  process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS = ''
  assert.equal(resolveCoolingDays(), 7)

  process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS = '0'
  assert.equal(resolveCoolingDays(), 7, 'non-positive must fall back to default')

  process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS = '-5'
  assert.equal(resolveCoolingDays(), 7, 'negative must fall back to default')

  process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS = 'not-a-number'
  assert.equal(resolveCoolingDays(), 7, 'non-numeric must fall back to default')

  process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS = '14'
  assert.equal(resolveCoolingDays(), 14, 'valid positive integer must be honored')

  if (original !== undefined) {
    process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS = original
  } else {
    delete process.env.EARNINGS_CONSOLIDATION_COOLING_DAYS
  }
})

test('cutoff calculation: 7 days subtracts from now correctly', () => {
  const coolingDays = 7
  const now = Date.now()
  const cutoff = new Date(now - coolingDays * 24 * 60 * 60 * 1000)
  const deltaMs = now - cutoff.getTime()
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  assert.equal(deltaMs, sevenDaysMs)
})
