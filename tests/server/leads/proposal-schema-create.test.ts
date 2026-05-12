import assert from 'node:assert/strict'
import test from 'node:test'

import { createLeadProposalSchema } from '@/lib/server/leads/proposal-schema'

// createLeadProposalSchema gained an optional sellerFeeAmount field in B3
// Chunk 3a. These tests validate the schema accepts/rejects values per
// ADR-007 §rule 7 (amount IN (100, 300, 500)).

const baseInput = {
  title: 'Hello',
  body: 'Proposal body content.',
}

test('createLeadProposalSchema: accepts payload without sellerFeeAmount (defaults to undefined)', () => {
  const result = createLeadProposalSchema.parse(baseInput)
  assert.equal(result.sellerFeeAmount, undefined)
})

test('createLeadProposalSchema: accepts sellerFeeAmount=100', () => {
  const result = createLeadProposalSchema.parse({ ...baseInput, sellerFeeAmount: 100 })
  assert.equal(result.sellerFeeAmount, 100)
})

test('createLeadProposalSchema: accepts sellerFeeAmount=300', () => {
  const result = createLeadProposalSchema.parse({ ...baseInput, sellerFeeAmount: 300 })
  assert.equal(result.sellerFeeAmount, 300)
})

test('createLeadProposalSchema: accepts sellerFeeAmount=500', () => {
  const result = createLeadProposalSchema.parse({ ...baseInput, sellerFeeAmount: 500 })
  assert.equal(result.sellerFeeAmount, 500)
})

test('createLeadProposalSchema: rejects sellerFeeAmount=200 (not in allowed set)', () => {
  assert.throws(() =>
    createLeadProposalSchema.parse({ ...baseInput, sellerFeeAmount: 200 })
  )
})

test('createLeadProposalSchema: rejects sellerFeeAmount=0 (must be 100/300/500)', () => {
  assert.throws(() =>
    createLeadProposalSchema.parse({ ...baseInput, sellerFeeAmount: 0 })
  )
})

test('createLeadProposalSchema: rejects negative sellerFeeAmount', () => {
  assert.throws(() =>
    createLeadProposalSchema.parse({ ...baseInput, sellerFeeAmount: -100 })
  )
})

test('createLeadProposalSchema: rejects string sellerFeeAmount', () => {
  assert.throws(() =>
    createLeadProposalSchema.parse({ ...baseInput, sellerFeeAmount: '100' })
  )
})

test('createLeadProposalSchema: preserves currency default USD and uppercases provided value', () => {
  const result = createLeadProposalSchema.parse({ ...baseInput, currency: 'usd' })
  assert.equal(result.currency, 'USD')
})

test('createLeadProposalSchema: defaults status to draft when omitted', () => {
  const result = createLeadProposalSchema.parse(baseInput)
  assert.equal(result.status, 'draft')
})
