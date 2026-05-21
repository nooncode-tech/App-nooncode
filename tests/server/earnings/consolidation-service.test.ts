import assert from 'node:assert/strict'
import test from 'node:test'

import { consolidateEarningsForPayment } from '@/lib/server/earnings/consolidation-service'
import { ApiError } from '@/lib/server/api/errors'

// Tests cover the TS wrapper for the consolidate_payment_earnings RPC
// (defined in migration 0048). The SQL function itself is the canonical
// behavior; these tests verify the wrapper translates RPC error messages
// into typed application errors and shape-converts the row result.

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111'
const SELLER_FEE_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'

function makeMockClient(opts: {
  rpcResponse?: { data: unknown; error: unknown }
}) {
  const rpcCalls: Array<{ name: string; args: unknown }> = []
  return {
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args })
      return Promise.resolve(opts.rpcResponse ?? { data: null, error: null })
    },
    _rpcCalls: rpcCalls,
  }
}

test('consolidateEarningsForPayment: happy path returns typed result + invokes RPC with renamed args', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        seller_fee_id: SELLER_FEE_ID,
        prior_state: 'confirmed',
        new_state: 'pending_payout',
        actors_consolidated: 2,
        amount_consolidated: '149.50',
      }],
      error: null,
    },
  })

  const result = await consolidateEarningsForPayment(client as never, {
    paymentId: PAYMENT_ID,
    actorProfileId: ACTOR_ID,
  })

  assert.equal(client._rpcCalls.length, 1)
  assert.equal(client._rpcCalls[0].name, 'consolidate_payment_earnings')
  assert.deepEqual(client._rpcCalls[0].args, {
    p_payment_id: PAYMENT_ID,
    p_actor_profile_id: ACTOR_ID,
  })

  assert.equal(result.paymentId, PAYMENT_ID)
  assert.equal(result.sellerFeeId, SELLER_FEE_ID)
  assert.equal(result.priorState, 'confirmed')
  assert.equal(result.newState, 'pending_payout')
  assert.equal(result.actorsConsolidated, 2)
  assert.equal(result.amountConsolidated, 149.5)
})

test('consolidateEarningsForPayment: idempotent no-op when prior state is not confirmed', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        seller_fee_id: SELLER_FEE_ID,
        prior_state: 'pending_payout',
        new_state: 'pending_payout',
        actors_consolidated: 0,
        amount_consolidated: '0',
      }],
      error: null,
    },
  })

  const result = await consolidateEarningsForPayment(client as never, {
    paymentId: PAYMENT_ID,
  })

  assert.equal(result.actorsConsolidated, 0)
  assert.equal(result.amountConsolidated, 0)
  assert.equal(result.priorState, 'pending_payout')
  assert.equal(result.newState, 'pending_payout')
})

test('consolidateEarningsForPayment: omits actor_profile_id when not provided (undefined fall-through)', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        seller_fee_id: SELLER_FEE_ID,
        prior_state: 'confirmed',
        new_state: 'pending_payout',
        actors_consolidated: 1,
        amount_consolidated: '100',
      }],
      error: null,
    },
  })

  await consolidateEarningsForPayment(client as never, { paymentId: PAYMENT_ID })

  const args = client._rpcCalls[0].args as { p_payment_id: string; p_actor_profile_id?: unknown }
  assert.equal(args.p_payment_id, PAYMENT_ID)
  assert.equal(args.p_actor_profile_id, undefined, 'actor must be undefined so SQL DEFAULT NULL fires')
})

test('consolidateEarningsForPayment: maps PAYMENT_ID_REQUIRED to typed ApiError 422', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: null,
      error: { message: 'PAYMENT_ID_REQUIRED' },
    },
  })

  try {
    await consolidateEarningsForPayment(client as never, { paymentId: '' })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'PAYMENT_ID_REQUIRED')
    assert.equal(error.status, 422)
  }
})

test('consolidateEarningsForPayment: maps SELLER_FEE_NOT_FOUND to typed ApiError 404', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: null,
      error: { message: 'SELLER_FEE_NOT_FOUND_FOR_PAYMENT' },
    },
  })

  try {
    await consolidateEarningsForPayment(client as never, { paymentId: PAYMENT_ID })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'SELLER_FEE_NOT_FOUND_FOR_PAYMENT')
    assert.equal(error.status, 404)
  }
})

test('consolidateEarningsForPayment: surfaces generic RPC errors as Error (not ApiError)', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: null,
      error: { message: 'connection timeout' },
    },
  })

  try {
    await consolidateEarningsForPayment(client as never, { paymentId: PAYMENT_ID })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof Error)
    assert.ok(!(error instanceof ApiError))
    assert.match((error as Error).message, /connection timeout/)
  }
})

test('consolidateEarningsForPayment: idempotent when a prior consolidation ledger entry already exists (state flipped, no wallet move)', async () => {
  // Per migration 0049 guard #2: if a `wallet_ledger_entries` row with
  // reference_type='consolidation' AND reference_id=payment_id already
  // exists, the RPC transitions the state to pending_payout for
  // consistency but skips the wallet move. The shape distinguishes from
  // the state-not-confirmed no-op by reporting prior_state='confirmed'
  // but actors_consolidated=0. The guard is defense-in-depth against any
  // future writer that lands a consolidation entry before the cron picks
  // up the same payment.
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        seller_fee_id: SELLER_FEE_ID,
        prior_state: 'confirmed',
        new_state: 'pending_payout',
        actors_consolidated: 0,
        amount_consolidated: '0',
      }],
      error: null,
    },
  })

  const result = await consolidateEarningsForPayment(client as never, { paymentId: PAYMENT_ID })

  assert.equal(result.priorState, 'confirmed')
  assert.equal(result.newState, 'pending_payout', 'state still transitions to keep consistency')
  assert.equal(result.actorsConsolidated, 0, 'no actor wallets touched on second-path consolidation')
  assert.equal(result.amountConsolidated, 0)
})

test('consolidateEarningsForPayment: throws when RPC returns no rows', async () => {
  const client = makeMockClient({
    rpcResponse: { data: [], error: null },
  })

  await assert.rejects(
    () => consolidateEarningsForPayment(client as never, { paymentId: PAYMENT_ID }),
    /CONSOLIDATION_RETURNED_NO_DATA/,
  )
})
