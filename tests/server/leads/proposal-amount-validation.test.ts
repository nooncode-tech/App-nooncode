import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ProposalAmountPricingMismatchError,
  ProposalMissingPricingContextError,
  assertOutboundProposalAmountMatchesPricing,
} from '@/lib/server/leads/proposal-amount-validation'
import {
  computePricing,
  type Complexity,
  type ProjectType,
  type SellerFeeAmount,
} from '@/lib/maxwell/pricing'

// Per ADR-013 (2026-05-17): the server-side validator is the
// load-bearing defense closing the bypass vector surfaced by B1.3a
// observation §2. Every outbound proposal-create call must revalidate
// `amount === computePricing(projectType, complexity, 'outbound',
// sellerFeeAmount).activationFinal`.

const PROJECT_TYPES: ProjectType[] = ['landing', 'ecommerce', 'webapp', 'mobile', 'saas_ai']
const COMPLEXITIES: Complexity[] = ['low', 'medium', 'high']
const SELLER_FEES: Array<100 | 300 | 500> = [100, 300, 500]

// ---------------------------------------------------------------------------
// Skip behavior for inbound proposals (no seller fee, owned by NoonWeb)
// ---------------------------------------------------------------------------

test('inbound proposals skip the validator entirely', () => {
  assertOutboundProposalAmountMatchesPricing('inbound', {
    amount: 1,
    sellerFeeAmount: 100,
    projectType: 'landing',
    complexity: 'low',
  })
})

test('inbound proposals skip even without projectType / complexity', () => {
  assertOutboundProposalAmountMatchesPricing('inbound', { amount: 1 })
})

test('null lead origin is treated as non-outbound (skips)', () => {
  assertOutboundProposalAmountMatchesPricing(null, { amount: 1 })
})

test('undefined lead origin is treated as non-outbound (skips)', () => {
  assertOutboundProposalAmountMatchesPricing(undefined, { amount: 1 })
})

// ---------------------------------------------------------------------------
// Missing pricing context for outbound — reject with structured error
// ---------------------------------------------------------------------------

test('outbound without projectType throws ProposalMissingPricingContextError', () => {
  assert.throws(
    () =>
      assertOutboundProposalAmountMatchesPricing('outbound', {
        amount: 149,
        sellerFeeAmount: 100,
        complexity: 'low',
      }),
    ProposalMissingPricingContextError,
  )
})

test('outbound without complexity throws ProposalMissingPricingContextError', () => {
  assert.throws(
    () =>
      assertOutboundProposalAmountMatchesPricing('outbound', {
        amount: 149,
        sellerFeeAmount: 100,
        projectType: 'landing',
      }),
    ProposalMissingPricingContextError,
  )
})

test('outbound without either field throws ProposalMissingPricingContextError("both")', () => {
  try {
    assertOutboundProposalAmountMatchesPricing('outbound', { amount: 149, sellerFeeAmount: 100 })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ProposalMissingPricingContextError)
    assert.equal(error.code, 'PROPOSAL_MISSING_PRICING_CONTEXT')
    assert.equal(error.status, 422)
    assert.match(error.message, /both/)
  }
})

// ---------------------------------------------------------------------------
// Happy path — every matrix cell × every seller fee = 45 cases
// ---------------------------------------------------------------------------

for (const projectType of PROJECT_TYPES) {
  for (const complexity of COMPLEXITIES) {
    for (const sellerFee of SELLER_FEES) {
      test(`outbound matrix cell accepted: ${projectType}/${complexity} + sellerFee=${sellerFee}`, () => {
        const pricing = computePricing(projectType, complexity, 'outbound', sellerFee as SellerFeeAmount)

        // Must not throw when amount matches the matrix.
        assertOutboundProposalAmountMatchesPricing('outbound', {
          amount: pricing.activationFinal,
          sellerFeeAmount: sellerFee,
          projectType,
          complexity,
        })
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Mismatch — reject and capture both received + expected for error contract
// ---------------------------------------------------------------------------

test('outbound rejects when amount is the activationBase (missing seller fee)', () => {
  // Common LLM drift: passes activationBase instead of activationFinal.
  const pricing = computePricing('saas_ai', 'high', 'outbound', 500 as SellerFeeAmount)
  // activationBase = 349, activationFinal = 849 (349 + 500)
  try {
    assertOutboundProposalAmountMatchesPricing('outbound', {
      amount: pricing.activationBase,  // wrong!
      sellerFeeAmount: 500,
      projectType: 'saas_ai',
      complexity: 'high',
    })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ProposalAmountPricingMismatchError)
    assert.equal(error.code, 'PROPOSAL_AMOUNT_PRICING_MISMATCH')
    assert.equal(error.status, 422)
    assert.equal(error.receivedAmount, 349)
    assert.equal(error.expectedAmount, 849)
    assert.equal(error.projectType, 'saas_ai')
    assert.equal(error.complexity, 'high')
    assert.equal(error.sellerFeeAmount, 500)
  }
})

test('outbound rejects when amount is hand-edited (the B1.3a smoke case)', () => {
  // Pedro typed "$1" on a landing/low + $100 fee proposal. Matrix says
  // $149 (49 + 100). Any value other than 149 must reject.
  assert.throws(
    () =>
      assertOutboundProposalAmountMatchesPricing('outbound', {
        amount: 1,
        sellerFeeAmount: 100,
        projectType: 'landing',
        complexity: 'low',
      }),
    ProposalAmountPricingMismatchError,
  )
})

test('outbound rejects when amount is off-by-one ($148 instead of $149)', () => {
  assert.throws(
    () =>
      assertOutboundProposalAmountMatchesPricing('outbound', {
        amount: 148,
        sellerFeeAmount: 100,
        projectType: 'landing',
        complexity: 'low',
      }),
    ProposalAmountPricingMismatchError,
  )
})

test('outbound rejects when seller fee mixed up with another cell', () => {
  // e-commerce/medium + $300 fee = $429 (129 + 300).
  // If the seller misreports projectType as landing while keeping amount,
  // landing/medium + $300 fee should be $379 (79 + 300). Reject.
  assert.throws(
    () =>
      assertOutboundProposalAmountMatchesPricing('outbound', {
        amount: 429,
        sellerFeeAmount: 300,
        projectType: 'landing',
        complexity: 'medium',
      }),
    ProposalAmountPricingMismatchError,
  )
})

test('outbound default seller fee path: omitted sellerFeeAmount uses 100', () => {
  // matrix landing/low = 49 base; default fee = 100; activationFinal = 149.
  // Caller omits sellerFeeAmount entirely.
  assertOutboundProposalAmountMatchesPricing('outbound', {
    amount: 149,
    projectType: 'landing',
    complexity: 'low',
  })
})

test('outbound default seller fee path rejects amount that does not match $100 default', () => {
  // Same as above but amount=$249 (which would be 149 + $100 extra).
  assert.throws(
    () =>
      assertOutboundProposalAmountMatchesPricing('outbound', {
        amount: 249,
        projectType: 'landing',
        complexity: 'low',
      }),
    ProposalAmountPricingMismatchError,
  )
})

// ---------------------------------------------------------------------------
// Error contract surface
// ---------------------------------------------------------------------------

test('ProposalAmountPricingMismatchError exposes received vs expected + matrix coords', () => {
  try {
    assertOutboundProposalAmountMatchesPricing('outbound', {
      amount: 1,
      sellerFeeAmount: 100,
      projectType: 'landing',
      complexity: 'low',
    })
    assert.fail('should have thrown')
  } catch (error) {
    assert.ok(error instanceof ProposalAmountPricingMismatchError)
    assert.equal(error.receivedAmount, 1)
    assert.equal(error.expectedAmount, 149)
    assert.equal(error.projectType, 'landing')
    assert.equal(error.complexity, 'low')
    assert.equal(error.sellerFeeAmount, 100)
    assert.match(error.message, /\$1/)
    assert.match(error.message, /\$149/)
    assert.match(error.message, /landing/)
    assert.match(error.message, /pricing matrix/)
  }
})
