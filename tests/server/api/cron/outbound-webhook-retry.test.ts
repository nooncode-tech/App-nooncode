import assert from 'node:assert/strict'
import test from 'node:test'

// IMPORTANT: the cron route captures `CRON_SECRET` at module load via
// `process.env.CRON_SECRET`. We set it synchronously here (before the
// dynamic import inside each test runs) so the module-level constant in
// the route file gets the test value.
process.env.CRON_SECRET = 'test-cron-secret'

// Dynamic require via a helper so each test reads the same module
// instance, matching the singleton semantics of the production import.
async function loadRoute() {
  return (await import('@/app/api/cron/outbound-webhook-retry/route')) as typeof import(
    '@/app/api/cron/outbound-webhook-retry/route'
  )
}

function makeRequest(opts: { authorized: boolean; dryRun?: boolean; method?: 'GET' | 'POST' }): Request {
  const headers = new Headers()
  if (opts.authorized) {
    headers.set('authorization', 'Bearer test-cron-secret')
  }
  const url = new URL('https://app.local/api/cron/outbound-webhook-retry')
  if (opts.dryRun) url.searchParams.set('dryRun', 'true')
  return new Request(url, { method: opts.method ?? 'POST', headers })
}

test('outbound-webhook-retry cron returns 401 without CRON_SECRET bearer', async () => {
  const routeMod = await loadRoute()
  const response = await routeMod.POST(makeRequest({ authorized: false }))
  assert.equal(response.status, 401)
  const body = await response.json()
  assert.equal(body.error, 'Unauthorized')
})

test('outbound-webhook-retry cron returns 401 with wrong bearer', async () => {
  const routeMod = await loadRoute()
  const headers = new Headers()
  headers.set('authorization', 'Bearer not-the-secret')
  const url = new URL('https://app.local/api/cron/outbound-webhook-retry')
  const response = await routeMod.POST(new Request(url, { method: 'POST', headers }))
  assert.equal(response.status, 401)
})

test('outbound-webhook-retry cron passes authz with correct bearer (no 401)', async () => {
  const routeMod = await loadRoute()
  // Even without a real DB connection (createSupabaseAdminClient may throw
  // in this test sandbox), the contract verified here is that an
  // authorized request does NOT receive 401 — it makes it past the auth
  // gate and into the handler body. We accept any non-401 status code.
  const response = await routeMod.POST(
    makeRequest({ authorized: true, dryRun: true }),
  )
  assert.notEqual(response.status, 401)
})

test('outbound-webhook-retry cron accepts GET as well as POST', async () => {
  const routeMod = await loadRoute()
  const response = await routeMod.GET(
    makeRequest({ authorized: true, dryRun: true, method: 'GET' }),
  )
  assert.notEqual(response.status, 401)
})
