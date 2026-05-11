import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getSellerFeeById,
  getSellerFeeByPaymentId,
  getSellerFeeByProposalId,
  insertSellerFee,
  updateSellerFeeState,
} from '@/lib/server/seller-fees/repository'
import type { SellerFeeRow } from '@/lib/server/seller-fees/types'

// ---------------------------------------------------------------------------
// Chainable Supabase test-double
// ---------------------------------------------------------------------------

interface MockOps {
  select: unknown[][]
  insert: unknown[][]
  update: unknown[][]
  eq: unknown[][]
  maybeSingle: unknown[][]
  single: unknown[][]
}

function makeMockClient(opts: {
  data?: unknown
  error?: { message: string } | null
  resolveOn?: 'maybeSingle' | 'single'
}) {
  const result = {
    data: opts.data ?? null,
    error: opts.error ?? null,
  }

  const ops: MockOps = {
    select: [],
    insert: [],
    update: [],
    eq: [],
    maybeSingle: [],
    single: [],
  }

  const chain: Record<string, (...args: unknown[]) => unknown> = {}
  chain.select = (...args: unknown[]) => {
    ops.select.push(args)
    return chain
  }
  chain.insert = (...args: unknown[]) => {
    ops.insert.push(args)
    return chain
  }
  chain.update = (...args: unknown[]) => {
    ops.update.push(args)
    return chain
  }
  chain.eq = (...args: unknown[]) => {
    ops.eq.push(args)
    return chain
  }
  chain.maybeSingle = (...args: unknown[]) => {
    ops.maybeSingle.push(args)
    return Promise.resolve(result)
  }
  chain.single = (...args: unknown[]) => {
    ops.single.push(args)
    return Promise.resolve(result)
  }

  return {
    from: () => chain,
    _ops: ops,
  }
}

const SAMPLE_ROW: SellerFeeRow = {
  id: '11111111-1111-4111-8111-111111111111',
  proposal_id: '22222222-2222-4222-8222-222222222222',
  lead_id: '33333333-3333-4333-8333-333333333333',
  seller_profile_id: '44444444-4444-4444-8444-444444444444',
  amount: 300,
  currency: 'USD',
  state: 'potential',
  payment_id: null,
  payout_id: null,
  cancellation_reason: null,
  formula_context_snapshot: {},
  selected_at: '2026-05-11T00:00:00.000Z',
  confirmed_at: null,
  pending_payout_at: null,
  paid_out_at: null,
  cancelled_at: null,
  created_at: '2026-05-11T00:00:00.000Z',
  updated_at: '2026-05-11T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// insertSellerFee
// ---------------------------------------------------------------------------

test('insertSellerFee inserts with defaults (currency=USD, empty snapshot)', async () => {
  const client = makeMockClient({ data: SAMPLE_ROW, error: null })

  const result = await insertSellerFee(client as never, {
    proposal_id: SAMPLE_ROW.proposal_id,
    lead_id: SAMPLE_ROW.lead_id,
    seller_profile_id: SAMPLE_ROW.seller_profile_id,
    amount: 300,
  })

  assert.equal(result.id, SAMPLE_ROW.id)
  assert.equal(client._ops.insert.length, 1)
  const insertedRow = client._ops.insert[0][0] as Record<string, unknown>
  assert.equal(insertedRow.proposal_id, SAMPLE_ROW.proposal_id)
  assert.equal(insertedRow.amount, 300)
  assert.equal(insertedRow.currency, 'USD')
  assert.deepEqual(insertedRow.formula_context_snapshot, {})
})

test('insertSellerFee passes through explicit currency and snapshot', async () => {
  const client = makeMockClient({ data: SAMPLE_ROW, error: null })
  const snapshot = { base: 199, fee: 300, total: 499 }

  await insertSellerFee(client as never, {
    proposal_id: SAMPLE_ROW.proposal_id,
    lead_id: SAMPLE_ROW.lead_id,
    seller_profile_id: SAMPLE_ROW.seller_profile_id,
    amount: 300,
    currency: 'USD',
    formula_context_snapshot: snapshot,
  })

  const insertedRow = client._ops.insert[0][0] as Record<string, unknown>
  assert.deepEqual(insertedRow.formula_context_snapshot, snapshot)
})

test('insertSellerFee throws when Supabase returns an error', async () => {
  const client = makeMockClient({
    data: null,
    error: { message: 'duplicate key value violates unique constraint' },
  })

  await assert.rejects(
    () =>
      insertSellerFee(client as never, {
        proposal_id: SAMPLE_ROW.proposal_id,
        lead_id: SAMPLE_ROW.lead_id,
        seller_profile_id: SAMPLE_ROW.seller_profile_id,
        amount: 300,
      }),
    /Failed to insert seller_fees row.*duplicate key/
  )
})

// ---------------------------------------------------------------------------
// getSellerFeeById / ByProposalId / ByPaymentId
// ---------------------------------------------------------------------------

test('getSellerFeeById uses .eq("id", …) and maybeSingle', async () => {
  const client = makeMockClient({ data: SAMPLE_ROW, error: null })

  const result = await getSellerFeeById(client as never, SAMPLE_ROW.id)

  assert.equal(result?.id, SAMPLE_ROW.id)
  assert.deepEqual(client._ops.eq[0], ['id', SAMPLE_ROW.id])
  assert.equal(client._ops.maybeSingle.length, 1)
})

test('getSellerFeeById returns null when no row exists', async () => {
  const client = makeMockClient({ data: null, error: null })

  const result = await getSellerFeeById(client as never, 'nonexistent')

  assert.equal(result, null)
})

test('getSellerFeeByProposalId filters by proposal_id', async () => {
  const client = makeMockClient({ data: SAMPLE_ROW, error: null })

  await getSellerFeeByProposalId(client as never, SAMPLE_ROW.proposal_id)

  assert.deepEqual(client._ops.eq[0], ['proposal_id', SAMPLE_ROW.proposal_id])
})

test('getSellerFeeByPaymentId filters by payment_id', async () => {
  const client = makeMockClient({ data: null, error: null })

  await getSellerFeeByPaymentId(client as never, 'payment-xyz')

  assert.deepEqual(client._ops.eq[0], ['payment_id', 'payment-xyz'])
})

test('getSellerFeeById throws on Supabase error', async () => {
  const client = makeMockClient({
    data: null,
    error: { message: 'permission denied' },
  })

  await assert.rejects(
    () => getSellerFeeById(client as never, 'anything'),
    /Failed to load seller_fees row.*permission denied/
  )
})

// ---------------------------------------------------------------------------
// updateSellerFeeState
// ---------------------------------------------------------------------------

test('updateSellerFeeState applies patch via .update(...)', async () => {
  const confirmed: SellerFeeRow = {
    ...SAMPLE_ROW,
    state: 'confirmed',
    confirmed_at: '2026-05-12T00:00:00.000Z',
    payment_id: 'payment-1',
  }
  const client = makeMockClient({ data: confirmed, error: null })

  const result = await updateSellerFeeState(client as never, SAMPLE_ROW.id, {
    state: 'confirmed',
    payment_id: 'payment-1',
    confirmed_at: '2026-05-12T00:00:00.000Z',
  })

  assert.equal(result.state, 'confirmed')
  assert.equal(client._ops.update.length, 1)
  const patch = client._ops.update[0][0] as Record<string, unknown>
  assert.equal(patch.state, 'confirmed')
  assert.equal(patch.payment_id, 'payment-1')
  assert.deepEqual(client._ops.eq[0], ['id', SAMPLE_ROW.id])
})

test('updateSellerFeeState throws on Supabase error', async () => {
  const client = makeMockClient({
    data: null,
    error: { message: 'foreign key violation' },
  })

  await assert.rejects(
    () =>
      updateSellerFeeState(client as never, SAMPLE_ROW.id, {
        state: 'confirmed',
        payment_id: 'nonexistent',
      }),
    /Failed to update seller_fees state.*foreign key/
  )
})
