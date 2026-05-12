import assert from 'node:assert/strict'
import test from 'node:test'

import { computePricing } from '@/lib/maxwell/pricing'

// computePricing's signature now requires the seller-chosen feeAmount per
// ADR-007. These tests cover the new behavior across allowed values, both
// channels, and verify that feeAmount on inbound is ignored.

test('computePricing: outbound proposal with feeAmount=100 adds 100 to activationFinal', () => {
  const result = computePricing('landing', 'low', 'outbound', 100)
  assert.equal(result.activationBase, 49)
  assert.equal(result.sellerFee, 100)
  assert.equal(result.activationFinal, 149)
  assert.equal(result.isOutbound, true)
})

test('computePricing: outbound proposal with feeAmount=300 adds 300 to activationFinal', () => {
  const result = computePricing('webapp', 'high', 'outbound', 300)
  assert.equal(result.activationBase, 279)
  assert.equal(result.sellerFee, 300)
  assert.equal(result.activationFinal, 579)
})

test('computePricing: outbound proposal with feeAmount=500 adds 500 to activationFinal', () => {
  const result = computePricing('saas_ai', 'high', 'outbound', 500)
  assert.equal(result.activationBase, 349)
  assert.equal(result.sellerFee, 500)
  assert.equal(result.activationFinal, 849)
})

test('computePricing: inbound proposal ignores feeAmount and zeroes sellerFee', () => {
  // Even if feeAmount is passed for an inbound, sellerFee is forced to 0.
  const result = computePricing('ecommerce', 'medium', 'inbound', 100)
  assert.equal(result.activationBase, 129)
  assert.equal(result.sellerFee, 0)
  assert.equal(result.activationFinal, 129)
  assert.equal(result.isOutbound, false)
})

test('computePricing: inbound with feeAmount=0 is the canonical inbound call', () => {
  const result = computePricing('mobile', 'low', 'inbound', 0)
  assert.equal(result.activationBase, 129)
  assert.equal(result.sellerFee, 0)
  assert.equal(result.activationFinal, 129)
})

test('computePricing: outbound with feeAmount=0 produces activationFinal === activationBase', () => {
  // This is the boundary case — outbound but seller chose 0. Not a valid
  // seller selection per ADR-007 (allowed values are 100/300/500) but the
  // pricing function itself does not enforce that. DB CHECK + schema do.
  const result = computePricing('landing', 'low', 'outbound', 0)
  assert.equal(result.sellerFee, 0)
  assert.equal(result.activationFinal, 49)
})

test('computePricing: membership is independent of feeAmount and channel', () => {
  // membership comes from a separate table; sellerFee does not touch it.
  const outbound = computePricing('webapp', 'medium', 'outbound', 500)
  const inbound = computePricing('webapp', 'medium', 'inbound', 0)
  assert.equal(outbound.membership, inbound.membership)
  assert.equal(outbound.membership, 69)
})
