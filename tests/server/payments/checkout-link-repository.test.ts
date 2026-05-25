import assert from 'node:assert/strict'
import test from 'node:test'

import { listActiveCheckoutLinksByProposalIds } from '@/lib/server/payments/checkout-link-repository'

// ---------------------------------------------------------------------------
// Chainable Supabase test-double
// ---------------------------------------------------------------------------

type MockResult = { data: unknown[] | null; error: { message: string } | null }

function makeMockClient(result: MockResult) {
  const calls: Record<string, unknown[][]> = {
    from: [],
    select: [],
    in: [],
    eq: [],
    not: [],
    order: [],
  }

  const chain = {
    select: (...args: unknown[]) => { calls.select.push(args); return chain },
    in: (...args: unknown[]) => { calls.in.push(args); return chain },
    eq: (...args: unknown[]) => { calls.eq.push(args); return chain },
    not: (...args: unknown[]) => { calls.not.push(args); return chain },
    order: (...args: unknown[]) => { calls.order.push(args); return Promise.resolve(result) },
  }

  return {
    from: (table: string) => { calls.from.push([table]); return chain },
    _calls: calls,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('listActiveCheckoutLinksByProposalIds returns empty Map when no proposal ids', async () => {
  const client = makeMockClient({ data: [], error: null })
  const result = await listActiveCheckoutLinksByProposalIds(client as never, [])

  assert.equal(result.size, 0)
  assert.equal(client._calls.from.length, 0, 'no DB call when empty input')
})

test('listActiveCheckoutLinksByProposalIds excludes rows with null url and keeps most recent per proposal', async () => {
  const client = makeMockClient({
    data: [
      {
        proposal_id: 'proposal-a',
        stripe_checkout_session_id: 'cs_live_a2',
        stripe_checkout_url: 'https://checkout.stripe.com/c/pay/cs_live_a2',
        stripe_checkout_expires_at: '2026-05-17T12:00:00Z',
        created_at: '2026-05-16T10:00:00Z',
      },
      {
        proposal_id: 'proposal-a',
        stripe_checkout_session_id: 'cs_live_a1',
        stripe_checkout_url: 'https://checkout.stripe.com/c/pay/cs_live_a1',
        stripe_checkout_expires_at: '2026-05-16T10:00:00Z',
        created_at: '2026-05-15T10:00:00Z',
      },
      {
        proposal_id: 'proposal-b',
        stripe_checkout_session_id: 'cs_live_b1',
        stripe_checkout_url: null,
        stripe_checkout_expires_at: null,
        created_at: '2026-05-16T11:00:00Z',
      },
    ],
    error: null,
  })

  const result = await listActiveCheckoutLinksByProposalIds(
    client as never,
    ['proposal-a', 'proposal-b'],
  )

  assert.equal(result.size, 1, 'only proposal-a should be in the map')
  const a = result.get('proposal-a')
  assert.ok(a, 'proposal-a present')
  assert.equal(a?.sessionId, 'cs_live_a2', 'most recent row by order ASC retained first')
  assert.equal(a?.url, 'https://checkout.stripe.com/c/pay/cs_live_a2')
  assert.equal(a?.expiresAt, '2026-05-17T12:00:00Z')
})

test('listActiveCheckoutLinksByProposalIds filters by status=pending and non-null url', async () => {
  const client = makeMockClient({ data: [], error: null })
  await listActiveCheckoutLinksByProposalIds(client as never, ['p1'])

  // Verify the chain applies status=pending and excludes null urls.
  const eqCalls = client._calls.eq
  assert.ok(
    eqCalls.some((call) => call[0] === 'status' && call[1] === 'pending'),
    'should filter by status=pending',
  )
  const notCalls = client._calls.not
  assert.ok(
    notCalls.some((call) => call[0] === 'stripe_checkout_url' && call[1] === 'is' && call[2] === null),
    'should exclude rows where stripe_checkout_url is null',
  )
  const inCalls = client._calls.in
  assert.ok(
    inCalls.some((call) => call[0] === 'proposal_id'),
    'should narrow by proposal_id list',
  )
})

test('listActiveCheckoutLinksByProposalIds surfaces DB errors', async () => {
  const client = makeMockClient({ data: null, error: { message: 'boom' } })

  await assert.rejects(
    () => listActiveCheckoutLinksByProposalIds(client as never, ['p1']),
    /Failed to load active checkout links: boom/,
  )
})
