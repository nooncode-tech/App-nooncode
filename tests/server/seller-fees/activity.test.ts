import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activityTypeForTransition,
  logSellerFeeTransition,
} from '@/lib/server/seller-fees/activity'
import type {
  SellerFeeRow,
  SellerFeeState,
} from '@/lib/server/seller-fees/types'

// ---------------------------------------------------------------------------
// Chainable Supabase test-double for lead_activities inserts
// ---------------------------------------------------------------------------

function makeMockClient(opts: {
  data?: unknown
  error?: { message: string } | null
}) {
  const result = {
    data: opts.data ?? { id: 'activity-id' },
    error: opts.error ?? null,
  }

  const ops: Record<string, unknown[][]> = {
    from: [],
    insert: [],
    select: [],
    single: [],
  }

  const chain: Record<string, (...args: unknown[]) => unknown> = {}
  chain.insert = (...args: unknown[]) => {
    ops.insert.push(args)
    return chain
  }
  chain.select = (...args: unknown[]) => {
    ops.select.push(args)
    return chain
  }
  chain.single = (...args: unknown[]) => {
    ops.single.push(args)
    return Promise.resolve(result)
  }

  return {
    from: (...args: unknown[]) => {
      ops.from.push(args)
      return chain
    },
    _ops: ops,
  }
}

const ROW: SellerFeeRow = {
  id: '11111111-1111-4111-8111-111111111111',
  proposal_id: '22222222-2222-4222-8222-222222222222',
  lead_id: '33333333-3333-4333-8333-333333333333',
  seller_profile_id: '44444444-4444-4444-8444-444444444444',
  amount: 300,
  currency: 'USD',
  state: 'confirmed',
  payment_id: 'payment-1',
  payout_id: null,
  cancellation_reason: null,
  formula_context_snapshot: { base: 199 },
  selected_at: '2026-05-11T00:00:00.000Z',
  confirmed_at: '2026-05-12T00:00:00.000Z',
  pending_payout_at: null,
  paid_out_at: null,
  cancelled_at: null,
  created_at: '2026-05-11T00:00:00.000Z',
  updated_at: '2026-05-12T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// activityTypeForTransition
// ---------------------------------------------------------------------------

test('activityTypeForTransition maps each state to the right enum value', () => {
  const cases: Array<[SellerFeeState, string]> = [
    ['potential', 'seller_fee_selected'],
    ['confirmed', 'seller_fee_confirmed'],
    ['pending_payout', 'seller_fee_pending_payout'],
    ['paid_out', 'seller_fee_paid_out'],
    ['cancelled', 'seller_fee_cancelled'],
  ]
  for (const [state, expected] of cases) {
    assert.equal(activityTypeForTransition(state), expected, `state=${state}`)
  }
})

// ---------------------------------------------------------------------------
// logSellerFeeTransition
// ---------------------------------------------------------------------------

test('logSellerFeeTransition writes to lead_activities with the right activity_type', async () => {
  const client = makeMockClient({ data: { id: 'activity-1' }, error: null })

  await logSellerFeeTransition(client as never, {
    sellerFee: ROW,
    priorState: 'potential',
    newState: 'confirmed',
    actorProfileId: null,
  })

  assert.deepEqual(client._ops.from[0], ['lead_activities'])
  assert.equal(client._ops.insert.length, 1)
  const insertedRow = client._ops.insert[0][0] as Record<string, unknown>
  assert.equal(insertedRow.activity_type, 'seller_fee_confirmed')
  assert.equal(insertedRow.lead_id, ROW.lead_id)
  assert.equal(insertedRow.actor_profile_id, null)
})

test('logSellerFeeTransition default note body reflects the new state and amount', async () => {
  const client = makeMockClient({ data: { id: 'activity-1' }, error: null })

  await logSellerFeeTransition(client as never, {
    sellerFee: ROW,
    priorState: 'potential',
    newState: 'confirmed',
    actorProfileId: null,
  })

  const insertedRow = client._ops.insert[0][0] as Record<string, unknown>
  const note = insertedRow.note_body as string
  assert.match(note, /Seller fee \$300/)
  assert.match(note, /confirmed/i)
})

test('logSellerFeeTransition metadata includes seller_fee_id, states, and amount', async () => {
  const client = makeMockClient({ data: { id: 'activity-1' }, error: null })

  await logSellerFeeTransition(client as never, {
    sellerFee: ROW,
    priorState: 'potential',
    newState: 'confirmed',
    actorProfileId: null,
  })

  const insertedRow = client._ops.insert[0][0] as Record<string, unknown>
  const metadata = insertedRow.metadata as Record<string, unknown>
  assert.equal(metadata.seller_fee_id, ROW.id)
  assert.equal(metadata.proposal_id, ROW.proposal_id)
  assert.equal(metadata.prior_state, 'potential')
  assert.equal(metadata.new_state, 'confirmed')
  assert.equal(metadata.amount, 300)
  assert.equal(metadata.payment_id, 'payment-1')
})

test('logSellerFeeTransition extraMetadata is merged into the metadata payload', async () => {
  const client = makeMockClient({ data: { id: 'activity-1' }, error: null })

  await logSellerFeeTransition(client as never, {
    sellerFee: ROW,
    priorState: 'confirmed',
    newState: 'cancelled',
    actorProfileId: 'admin-1',
    extraMetadata: { triggered_by: 'refund', stripe_dispute_id: 'dp_123' },
  })

  const insertedRow = client._ops.insert[0][0] as Record<string, unknown>
  const metadata = insertedRow.metadata as Record<string, unknown>
  assert.equal(metadata.triggered_by, 'refund')
  assert.equal(metadata.stripe_dispute_id, 'dp_123')
  assert.equal(metadata.new_state, 'cancelled')
})

test('logSellerFeeTransition uses provided noteBody when given', async () => {
  const client = makeMockClient({ data: { id: 'activity-1' }, error: null })

  await logSellerFeeTransition(client as never, {
    sellerFee: ROW,
    priorState: 'potential',
    newState: 'cancelled',
    actorProfileId: 'admin-1',
    noteBody: 'Cancelled because lead released.',
  })

  const insertedRow = client._ops.insert[0][0] as Record<string, unknown>
  assert.equal(insertedRow.note_body, 'Cancelled because lead released.')
})

test('logSellerFeeTransition throws when Supabase returns an error', async () => {
  const client = makeMockClient({
    data: null,
    error: { message: 'invalid input value for enum' },
  })

  await assert.rejects(
    () =>
      logSellerFeeTransition(client as never, {
        sellerFee: ROW,
        priorState: 'potential',
        newState: 'confirmed',
        actorProfileId: null,
      }),
    /Failed to log seller_fee activity.*invalid input value/
  )
})
