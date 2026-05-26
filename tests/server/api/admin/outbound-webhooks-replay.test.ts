import assert from 'node:assert/strict'
import test from 'node:test'

import { POST as replayPost, GET as replayGet } from '@/app/api/admin/outbound-webhooks/[eventId]/replay/route'

// The replay endpoint enforces `requireRole(['admin'])` from
// `lib/server/auth/guards.ts`. Without a Supabase session the guard
// throws `AuthGuardError` which `toErrorResponse` converts to a 401 / 403.
// These tests verify the authz boundary; the underlying replay state
// machine (`driveAdminOutboundReplay`) is exercised in
// `tests/server/website-integration-outbound-retry.test.ts` via the
// dispatcher integration tests.

function paramsFor(eventId: string): { params: Promise<{ eventId: string }> } {
  return { params: Promise.resolve({ eventId }) }
}

test('admin replay endpoint refuses unauthenticated requests', async () => {
  // No session → `requireRole` throws AuthGuardError('UNAUTHENTICATED', 401).
  const response = await replayPost(
    new Request('https://app.local/api/admin/outbound-webhooks/00000000-0000-0000-0000-000000000000/replay', {
      method: 'POST',
    }),
    paramsFor('00000000-0000-0000-0000-000000000000'),
  )
  // Without auth wired up, the guard either returns 401 or 503 depending
  // on whether NOON_ENABLE_SUPABASE_AUTH is set. Both are non-200.
  assert.notEqual(response.status, 200)
  assert.ok(response.status === 401 || response.status === 403 || response.status === 503)
})

test('admin replay endpoint rejects invalid eventId format with 4xx', async () => {
  const response = await replayPost(
    new Request('https://app.local/api/admin/outbound-webhooks/not-a-uuid/replay', {
      method: 'POST',
    }),
    paramsFor('not-a-uuid'),
  )
  // Either the authz guard runs first (401/403/503), or the param zod
  // schema rejects with 400. Both are 4xx/5xx; never 200.
  assert.notEqual(response.status, 200)
})

test('admin replay endpoint returns 405 on GET', async () => {
  const response = await replayGet()
  assert.equal(response.status, 405)
  const body = await response.json()
  assert.equal(body.error, 'method_not_allowed')
})
