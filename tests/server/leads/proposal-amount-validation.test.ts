import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ProposalAmountBelowSellerFeeError,
  assertProposalAmountCoversSellerFee,
} from '@/lib/server/leads/proposal-amount-validation'

// Path J — proposal-creation guard against `amount < seller_fee`. Mirrors
// the webhook handler's defensive cap but rejects the configuration at
// save time so the inconsistent row never lands in `lead_proposals`.

test('assertProposalAmountCoversSellerFee: no-op for inbound proposals (no seller fee)', () => {
  assertProposalAmountCoversSellerFee('inbound', { amount: 1 })
})

test('assertProposalAmountCoversSellerFee: no-op when lead_origin is null', () => {
  assertProposalAmountCoversSellerFee(null, { amount: 1 })
})

test('assertProposalAmountCoversSellerFee: no-op when lead_origin is undefined', () => {
  assertProposalAmountCoversSellerFee(undefined, { amount: 1 })
})

test('assertProposalAmountCoversSellerFee: accepts outbound with amount >= seller fee', () => {
  assertProposalAmountCoversSellerFee('outbound', { amount: 500, sellerFeeAmount: 300 })
  assertProposalAmountCoversSellerFee('outbound', { amount: 100, sellerFeeAmount: 100 })
  assertProposalAmountCoversSellerFee('outbound', { amount: 1000 })  // default fee = 100
})

test('assertProposalAmountCoversSellerFee: rejects outbound when amount < explicit seller fee', () => {
  assert.throws(
    () => assertProposalAmountCoversSellerFee('outbound', { amount: 1, sellerFeeAmount: 100 }),
    ProposalAmountBelowSellerFeeError,
  )
  assert.throws(
    () => assertProposalAmountCoversSellerFee('outbound', { amount: 200, sellerFeeAmount: 300 }),
    ProposalAmountBelowSellerFeeError,
  )
  assert.throws(
    () => assertProposalAmountCoversSellerFee('outbound', { amount: 400, sellerFeeAmount: 500 }),
    ProposalAmountBelowSellerFeeError,
  )
})

test('assertProposalAmountCoversSellerFee: rejects outbound when amount < default seller fee', () => {
  // sellerFeeAmount omitted → falls back to default $100.
  assert.throws(
    () => assertProposalAmountCoversSellerFee('outbound', { amount: 99 }),
    ProposalAmountBelowSellerFeeError,
  )
})

test('ProposalAmountBelowSellerFeeError exposes ApiError contract (code + status + message)', () => {
  try {
    assertProposalAmountCoversSellerFee('outbound', { amount: 1, sellerFeeAmount: 300 })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ProposalAmountBelowSellerFeeError)
    assert.equal(error.code, 'PROPOSAL_AMOUNT_BELOW_SELLER_FEE')
    assert.equal(error.status, 422)
    assert.equal(error.amount, 1)
    assert.equal(error.sellerFeeAmount, 300)
    assert.match(error.message, /\$1/)
    assert.match(error.message, /\$300/)
  }
})
