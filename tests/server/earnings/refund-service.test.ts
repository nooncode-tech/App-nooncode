import assert from 'node:assert/strict'
import test from 'node:test'

import { debitWalletForRefund } from '@/lib/server/earnings/refund-service'
import { ApiError } from '@/lib/server/api/errors'

// Tests cover the TS wrapper for the `debit_wallet_for_refund` RPC
// defined in migration 0050. The SQL function itself is the canonical
// behavior — these tests verify the wrapper translates RPC error
// messages, shape-converts the row, and preserves the bucket-aware
// semantics.

const PAYMENT_ID = '44444444-4444-4444-8444-444444444444'
const ACTOR_ID = '55555555-5555-4555-8555-555555555555'

function makeMockClient(opts: { rpcResponse?: { data: unknown; error: unknown } }) {
  const rpcCalls: Array<{ name: string; args: unknown }> = []
  return {
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args })
      return Promise.resolve(opts.rpcResponse ?? { data: null, error: null })
    },
    _rpcCalls: rpcCalls,
  }
}

test('debitWalletForRefund: pre-consolidation refund debits pending bucket', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        actors_debited: 2,
        actors_skipped_already_paid_out: 0,
        amount_debited: '300',
        bucket_used: 'pending',
      }],
      error: null,
    },
  })

  const result = await debitWalletForRefund(client as never, {
    paymentId: PAYMENT_ID,
    actorProfileId: ACTOR_ID,
  })

  assert.equal(client._rpcCalls.length, 1)
  assert.equal(client._rpcCalls[0].name, 'debit_wallet_for_refund')
  assert.deepEqual(client._rpcCalls[0].args, {
    p_payment_id: PAYMENT_ID,
    p_actor_profile_id: ACTOR_ID,
  })

  assert.equal(result.paymentId, PAYMENT_ID)
  assert.equal(result.actorsDebited, 2)
  assert.equal(result.actorsSkippedAlreadyPaidOut, 0)
  assert.equal(result.amountDebited, 300)
  assert.equal(result.bucketUsed, 'pending')
})

test('debitWalletForRefund: post-consolidation refund debits available_to_withdraw', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        actors_debited: 2,
        actors_skipped_already_paid_out: 0,
        amount_debited: '300',
        bucket_used: 'available_to_withdraw',
      }],
      error: null,
    },
  })

  const result = await debitWalletForRefund(client as never, { paymentId: PAYMENT_ID })

  assert.equal(result.bucketUsed, 'available_to_withdraw')
  assert.equal(result.amountDebited, 300)
})

test('debitWalletForRefund: idempotent no-op on prior refund (Stripe webhook retry)', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        actors_debited: 0,
        actors_skipped_already_paid_out: 0,
        amount_debited: '0',
        bucket_used: 'noop_already_refunded',
      }],
      error: null,
    },
  })

  const result = await debitWalletForRefund(client as never, { paymentId: PAYMENT_ID })

  assert.equal(result.actorsDebited, 0)
  assert.equal(result.amountDebited, 0)
  assert.equal(result.bucketUsed, 'noop_already_refunded')
})

test('debitWalletForRefund: actor skipped when funds already moved to locked / paid_out', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        actors_debited: 1,
        actors_skipped_already_paid_out: 1,
        amount_debited: '100',
        bucket_used: 'available_to_withdraw',
      }],
      error: null,
    },
  })

  const result = await debitWalletForRefund(client as never, { paymentId: PAYMENT_ID })

  assert.equal(result.actorsDebited, 1, 'developer still in available_to_withdraw → debited')
  assert.equal(result.actorsSkippedAlreadyPaidOut, 1, 'seller already paid out → skipped')
  assert.equal(result.amountDebited, 100)
})

test('debitWalletForRefund: omits actor_profile_id when not provided', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: [{
        payment_id: PAYMENT_ID,
        actors_debited: 1,
        actors_skipped_already_paid_out: 0,
        amount_debited: '100',
        bucket_used: 'pending',
      }],
      error: null,
    },
  })

  await debitWalletForRefund(client as never, { paymentId: PAYMENT_ID })

  const args = client._rpcCalls[0].args as { p_payment_id: string; p_actor_profile_id?: unknown }
  assert.equal(args.p_actor_profile_id, undefined)
})

test('debitWalletForRefund: maps PAYMENT_ID_REQUIRED to typed ApiError 422', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: null,
      error: { message: 'PAYMENT_ID_REQUIRED' },
    },
  })

  try {
    await debitWalletForRefund(client as never, { paymentId: '' })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'PAYMENT_ID_REQUIRED')
    assert.equal(error.status, 422)
  }
})

test('debitWalletForRefund: surfaces generic RPC errors as Error (not ApiError)', async () => {
  const client = makeMockClient({
    rpcResponse: {
      data: null,
      error: { message: 'connection timeout' },
    },
  })

  try {
    await debitWalletForRefund(client as never, { paymentId: PAYMENT_ID })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof Error)
    assert.ok(!(error instanceof ApiError))
    assert.match((error as Error).message, /connection timeout/)
  }
})

test('debitWalletForRefund: throws when RPC returns no rows', async () => {
  const client = makeMockClient({
    rpcResponse: { data: [], error: null },
  })

  await assert.rejects(
    () => debitWalletForRefund(client as never, { paymentId: PAYMENT_ID }),
    /DEBIT_WALLET_FOR_REFUND_RETURNED_NO_DATA/,
  )
})
