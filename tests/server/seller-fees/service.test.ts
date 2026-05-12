import assert from 'node:assert/strict'
import test from 'node:test'

import { ApiError } from '@/lib/server/api/errors'
import {
  cancelSellerFee,
  confirmSellerFee,
  createSellerFee,
  markPaidOut,
  markPendingPayout,
} from '@/lib/server/seller-fees/service'
import type {
  SellerFeeRow,
  SellerFeeState,
} from '@/lib/server/seller-fees/types'

// ---------------------------------------------------------------------------
// Mock supabase client. The service.ts implementation routes reads and writes
// through repository.ts (.from('seller_fees')) and activity.ts (.from(
// 'lead_activities')). The mock dispatches per-table chains scripted by the
// test, recording every operation for assertions.
// ---------------------------------------------------------------------------

type MockResult = { data: unknown; error: { message: string } | null }

interface ScenarioInputs {
  // Queues of scripted results, popped in FIFO order per operation.
  sellerFeesMaybeSingle?: MockResult[]
  sellerFeesSingle?: MockResult[]
  leadActivitiesSingle?: MockResult[]
}

function makeClient(scenario: ScenarioInputs) {
  const queues = {
    sellerFeesMaybeSingle: [...(scenario.sellerFeesMaybeSingle ?? [])],
    sellerFeesSingle: [...(scenario.sellerFeesSingle ?? [])],
    leadActivitiesSingle: [...(scenario.leadActivitiesSingle ?? [])],
  }

  const recorded: {
    sellerFeesSelect: unknown[][]
    sellerFeesInsert: unknown[][]
    sellerFeesUpdate: unknown[][]
    sellerFeesEq: unknown[][]
    leadActivitiesInsert: unknown[][]
  } = {
    sellerFeesSelect: [],
    sellerFeesInsert: [],
    sellerFeesUpdate: [],
    sellerFeesEq: [],
    leadActivitiesInsert: [],
  }

  function chainFor(table: string) {
    const chain: Record<string, (...args: unknown[]) => unknown> = {}

    chain.select = (...args: unknown[]) => {
      if (table === 'seller_fees') recorded.sellerFeesSelect.push(args)
      return chain
    }
    chain.insert = (...args: unknown[]) => {
      if (table === 'seller_fees') recorded.sellerFeesInsert.push(args)
      else if (table === 'lead_activities')
        recorded.leadActivitiesInsert.push(args)
      return chain
    }
    chain.update = (...args: unknown[]) => {
      if (table === 'seller_fees') recorded.sellerFeesUpdate.push(args)
      return chain
    }
    chain.eq = (...args: unknown[]) => {
      if (table === 'seller_fees') recorded.sellerFeesEq.push(args)
      return chain
    }
    chain.maybeSingle = () => {
      if (table === 'seller_fees') {
        const next = queues.sellerFeesMaybeSingle.shift()
        if (!next) throw new Error('No scripted maybeSingle for seller_fees')
        return Promise.resolve(next)
      }
      throw new Error(`Unexpected maybeSingle for table ${table}`)
    }
    chain.single = () => {
      if (table === 'seller_fees') {
        const next = queues.sellerFeesSingle.shift()
        if (!next) throw new Error('No scripted single for seller_fees')
        return Promise.resolve(next)
      }
      if (table === 'lead_activities') {
        const next = queues.leadActivitiesSingle.shift()
        if (!next) throw new Error('No scripted single for lead_activities')
        return Promise.resolve(next)
      }
      throw new Error(`Unexpected single for table ${table}`)
    }

    return chain
  }

  return {
    from: (table: string) => chainFor(table),
    _recorded: recorded,
    _queues: queues,
  }
}

const NOW_ISO = '2026-05-11T10:00:00.000Z'

function makeRow(overrides: Partial<SellerFeeRow> = {}): SellerFeeRow {
  return {
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
    selected_at: NOW_ISO,
    confirmed_at: null,
    pending_payout_at: null,
    paid_out_at: null,
    cancelled_at: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  }
}

const baseCreateInput = {
  proposalId: '22222222-2222-4222-8222-222222222222',
  leadId: '33333333-3333-4333-8333-333333333333',
  sellerProfileId: '44444444-4444-4444-8444-444444444444',
  amount: 300 as 100 | 300 | 500,
}

// ---------------------------------------------------------------------------
// createSellerFee
// ---------------------------------------------------------------------------

test('createSellerFee inserts a new row and logs seller_fee_selected activity', async () => {
  const row = makeRow()
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: null, error: null }], // no existing row
    sellerFeesSingle: [{ data: row, error: null }], // insert result
    leadActivitiesSingle: [{ data: { id: 'act-1' }, error: null }],
  })

  const result = await createSellerFee(client as never, baseCreateInput)

  assert.equal(result.state, 'potential')
  assert.equal(result.amount, 300)
  assert.equal(client._recorded.sellerFeesInsert.length, 1)
  assert.equal(client._recorded.leadActivitiesInsert.length, 1)
  const activity = client._recorded.leadActivitiesInsert[0][0] as Record<string, unknown>
  assert.equal(activity.activity_type, 'seller_fee_selected')
})

test('createSellerFee rejects when seller_fee already exists for the proposal', async () => {
  const existing = makeRow()
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: existing, error: null }],
  })

  await assert.rejects(
    () => createSellerFee(client as never, baseCreateInput),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_ALREADY_EXISTS' &&
      err.status === 409
  )
})

// ---------------------------------------------------------------------------
// confirmSellerFee
// ---------------------------------------------------------------------------

test('confirmSellerFee transitions potential → confirmed and logs activity', async () => {
  const potential = makeRow({ state: 'potential' })
  const confirmed = makeRow({
    state: 'confirmed',
    payment_id: 'pay-1',
    confirmed_at: NOW_ISO,
  })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: potential, error: null }],
    sellerFeesSingle: [{ data: confirmed, error: null }],
    leadActivitiesSingle: [{ data: { id: 'act-2' }, error: null }],
  })

  const result = await confirmSellerFee(client as never, {
    proposalId: potential.proposal_id,
    paymentId: 'pay-1',
  })

  assert.equal(result.state, 'confirmed')
  assert.equal(result.payment_id, 'pay-1')
  const activity = client._recorded.leadActivitiesInsert[0][0] as Record<string, unknown>
  assert.equal(activity.activity_type, 'seller_fee_confirmed')
})

test('confirmSellerFee is idempotent when row already confirmed for same payment', async () => {
  const confirmed = makeRow({
    state: 'confirmed',
    payment_id: 'pay-1',
    confirmed_at: NOW_ISO,
  })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: confirmed, error: null }],
  })

  const result = await confirmSellerFee(client as never, {
    proposalId: confirmed.proposal_id,
    paymentId: 'pay-1',
  })

  assert.equal(result.state, 'confirmed')
  // No update, no activity logged on idempotent retry.
  assert.equal(client._recorded.sellerFeesUpdate.length, 0)
  assert.equal(client._recorded.leadActivitiesInsert.length, 0)
})

test('confirmSellerFee rejects when row confirmed against a different payment', async () => {
  const confirmedDifferent = makeRow({
    state: 'confirmed',
    payment_id: 'pay-2',
    confirmed_at: NOW_ISO,
  })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: confirmedDifferent, error: null }],
  })

  await assert.rejects(
    () =>
      confirmSellerFee(client as never, {
        proposalId: confirmedDifferent.proposal_id,
        paymentId: 'pay-1',
      }),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_PAYMENT_CONFLICT' &&
      err.status === 409
  )
})

test('confirmSellerFee rejects when row is in pending_payout', async () => {
  const pending = makeRow({ state: 'pending_payout', payment_id: 'pay-1' })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: pending, error: null }],
  })

  await assert.rejects(
    () =>
      confirmSellerFee(client as never, {
        proposalId: pending.proposal_id,
        paymentId: 'pay-1',
      }),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_INVALID_TRANSITION'
  )
})

test('confirmSellerFee rejects when proposal has no seller_fees row', async () => {
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: null, error: null }],
  })

  await assert.rejects(
    () =>
      confirmSellerFee(client as never, {
        proposalId: 'nonexistent',
        paymentId: 'pay-1',
      }),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_NOT_FOUND' &&
      err.status === 404
  )
})

// ---------------------------------------------------------------------------
// markPendingPayout
// ---------------------------------------------------------------------------

test('markPendingPayout transitions confirmed → pending_payout', async () => {
  const confirmed = makeRow({
    state: 'confirmed',
    payment_id: 'pay-1',
    confirmed_at: NOW_ISO,
  })
  const pending = makeRow({
    state: 'pending_payout',
    payment_id: 'pay-1',
    payout_id: 'po-1',
    confirmed_at: NOW_ISO,
    pending_payout_at: NOW_ISO,
  })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: confirmed, error: null }],
    sellerFeesSingle: [{ data: pending, error: null }],
    leadActivitiesSingle: [{ data: { id: 'act-3' }, error: null }],
  })

  const result = await markPendingPayout(client as never, {
    sellerFeeId: confirmed.id,
    payoutId: 'po-1',
  })

  assert.equal(result.state, 'pending_payout')
  assert.equal(result.payout_id, 'po-1')
  const activity = client._recorded.leadActivitiesInsert[0][0] as Record<string, unknown>
  assert.equal(activity.activity_type, 'seller_fee_pending_payout')
})

test('markPendingPayout is idempotent for same payout_id', async () => {
  const pending = makeRow({
    state: 'pending_payout',
    payment_id: 'pay-1',
    payout_id: 'po-1',
  })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: pending, error: null }],
  })

  const result = await markPendingPayout(client as never, {
    sellerFeeId: pending.id,
    payoutId: 'po-1',
  })

  assert.equal(result.state, 'pending_payout')
  assert.equal(client._recorded.sellerFeesUpdate.length, 0)
  assert.equal(client._recorded.leadActivitiesInsert.length, 0)
})

test('markPendingPayout rejects when row is still in potential', async () => {
  const potential = makeRow({ state: 'potential' })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: potential, error: null }],
  })

  await assert.rejects(
    () =>
      markPendingPayout(client as never, {
        sellerFeeId: potential.id,
        payoutId: 'po-1',
      }),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_INVALID_TRANSITION'
  )
})

// ---------------------------------------------------------------------------
// markPaidOut
// ---------------------------------------------------------------------------

test('markPaidOut transitions pending_payout → paid_out', async () => {
  const pending = makeRow({
    state: 'pending_payout',
    payment_id: 'pay-1',
    payout_id: 'po-1',
  })
  const paid = makeRow({
    state: 'paid_out',
    payment_id: 'pay-1',
    payout_id: 'po-1',
    paid_out_at: NOW_ISO,
  })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: pending, error: null }],
    sellerFeesSingle: [{ data: paid, error: null }],
    leadActivitiesSingle: [{ data: { id: 'act-4' }, error: null }],
  })

  const result = await markPaidOut(client as never, {
    sellerFeeId: pending.id,
  })

  assert.equal(result.state, 'paid_out')
  const activity = client._recorded.leadActivitiesInsert[0][0] as Record<string, unknown>
  assert.equal(activity.activity_type, 'seller_fee_paid_out')
})

test('markPaidOut is idempotent', async () => {
  const paid = makeRow({ state: 'paid_out', paid_out_at: NOW_ISO })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: paid, error: null }],
  })

  const result = await markPaidOut(client as never, {
    sellerFeeId: paid.id,
  })

  assert.equal(result.state, 'paid_out')
  assert.equal(client._recorded.sellerFeesUpdate.length, 0)
  assert.equal(client._recorded.leadActivitiesInsert.length, 0)
})

test('markPaidOut rejects when row is in confirmed (skips pending_payout)', async () => {
  const confirmed = makeRow({ state: 'confirmed', payment_id: 'pay-1' })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: confirmed, error: null }],
  })

  await assert.rejects(
    () => markPaidOut(client as never, { sellerFeeId: confirmed.id }),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_INVALID_TRANSITION'
  )
})

// ---------------------------------------------------------------------------
// cancelSellerFee
// ---------------------------------------------------------------------------

const cancelCases: Array<[SellerFeeState, boolean]> = [
  ['potential', true],
  ['confirmed', true],
  ['pending_payout', false],
  ['paid_out', false],
]

for (const [fromState, allowed] of cancelCases) {
  test(`cancelSellerFee from ${fromState}: ${allowed ? 'allowed' : 'forbidden'}`, async () => {
    const row = makeRow({ state: fromState, payment_id: fromState === 'potential' ? null : 'pay-1' })

    if (allowed) {
      const cancelled = makeRow({
        ...row,
        state: 'cancelled',
        cancellation_reason: 'manual reason',
        cancelled_at: NOW_ISO,
      })
      const client = makeClient({
        sellerFeesMaybeSingle: [{ data: row, error: null }],
        sellerFeesSingle: [{ data: cancelled, error: null }],
        leadActivitiesSingle: [{ data: { id: 'act-x' }, error: null }],
      })
      const result = await cancelSellerFee(client as never, {
        sellerFeeId: row.id,
        reason: 'manual reason',
        actorProfileId: 'admin-1',
      })
      assert.equal(result.state, 'cancelled')
      assert.equal(result.cancellation_reason, 'manual reason')
      const activity = client._recorded.leadActivitiesInsert[0][0] as Record<string, unknown>
      assert.equal(activity.activity_type, 'seller_fee_cancelled')
    } else {
      const client = makeClient({
        sellerFeesMaybeSingle: [{ data: row, error: null }],
      })
      await assert.rejects(
        () =>
          cancelSellerFee(client as never, {
            sellerFeeId: row.id,
            reason: 'should reject',
            actorProfileId: 'admin-1',
          }),
        (err) => err instanceof ApiError
      )
    }
  })
}

test('cancelSellerFee from paid_out raises SELLER_FEE_CANCEL_FORBIDDEN_FROM_PAID_OUT', async () => {
  const paid = makeRow({ state: 'paid_out', paid_out_at: NOW_ISO })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: paid, error: null }],
  })

  await assert.rejects(
    () =>
      cancelSellerFee(client as never, {
        sellerFeeId: paid.id,
        reason: 'late refund',
        actorProfileId: 'admin-1',
      }),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_CANCEL_FORBIDDEN_FROM_PAID_OUT'
  )
})

test('cancelSellerFee from pending_payout raises NOT_IMPLEMENTED code', async () => {
  const pending = makeRow({ state: 'pending_payout', payout_id: 'po-1' })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: pending, error: null }],
  })

  await assert.rejects(
    () =>
      cancelSellerFee(client as never, {
        sellerFeeId: pending.id,
        reason: 'cancel mid-payout',
        actorProfileId: 'admin-1',
      }),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_CANCEL_FROM_PENDING_NOT_IMPLEMENTED'
  )
})

test('cancelSellerFee is idempotent (cancelled stays cancelled)', async () => {
  const cancelled = makeRow({
    state: 'cancelled',
    cancellation_reason: 'prior',
    cancelled_at: NOW_ISO,
  })
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: cancelled, error: null }],
  })

  const result = await cancelSellerFee(client as never, {
    sellerFeeId: cancelled.id,
    reason: 'second cancel attempt',
    actorProfileId: 'admin-1',
  })

  assert.equal(result.state, 'cancelled')
  // No new update, no new activity row.
  assert.equal(client._recorded.sellerFeesUpdate.length, 0)
  assert.equal(client._recorded.leadActivitiesInsert.length, 0)
})

test('cancelSellerFee rejects when seller_fee not found', async () => {
  const client = makeClient({
    sellerFeesMaybeSingle: [{ data: null, error: null }],
  })

  await assert.rejects(
    () =>
      cancelSellerFee(client as never, {
        sellerFeeId: 'nope',
        reason: 'whatever',
        actorProfileId: null,
      }),
    (err) =>
      err instanceof ApiError &&
      err.code === 'SELLER_FEE_NOT_FOUND' &&
      err.status === 404
  )
})
