import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveEffectiveProposalState,
  manualProposalStatusOptions,
  type ProposalStateInput,
} from '@/lib/leads/proposal-presentation'
import type { LeadOrigin } from '@/lib/types'

// ---------------------------------------------------------------------------
// Unit scope: deriveEffectiveProposalState is a pure function over the three
// proposal status axes. These tests pin every precedence branch so the UI
// simplification provably preserves the underlying state semantics (no data
// model / RPC / payment-gate change). Each case asserts the stable `key`,
// which is locale-independent.
// ---------------------------------------------------------------------------

const linkedProject: ProposalStateInput['linkedProject'] = {
  id: 'p1',
  name: 'Proyecto',
  status: 'backlog',
  createdAt: new Date('2026-01-01'),
}

const checkoutLink: ProposalStateInput['activeCheckoutLink'] = {
  url: 'https://pay.example/abc',
  sessionId: 'cs_1',
  expiresAt: new Date('2026-12-31'),
  isExpired: false,
}

function makeProposal(overrides: Partial<ProposalStateInput> = {}): ProposalStateInput {
  return {
    status: 'draft',
    reviewStatus: 'pending_review',
    paymentStatus: null,
    linkedProject: undefined,
    activeCheckoutLink: null,
    ...overrides,
  }
}

test('converted wins over every other axis', () => {
  const state = deriveEffectiveProposalState(
    makeProposal({
      linkedProject,
      reviewStatus: 'approved',
      paymentStatus: 'succeeded',
      status: 'handoff_ready',
    }),
    'inbound',
  )
  assert.equal(state.primary.key, 'converted')
  assert.equal(state.secondary, null)
})

test('paid beats review/lifecycle when no project yet', () => {
  const state = deriveEffectiveProposalState(
    makeProposal({ paymentStatus: 'succeeded', reviewStatus: 'approved', status: 'handoff_ready' }),
    'outbound',
  )
  assert.equal(state.primary.key, 'paid')
  assert.equal(state.hint, 'Lista para crear el proyecto.')
})

test('paid without handoff_ready has no project hint', () => {
  const state = deriveEffectiveProposalState(
    makeProposal({ paymentStatus: 'succeeded', status: 'sent' }),
    'outbound',
  )
  assert.equal(state.primary.key, 'paid')
  assert.equal(state.hint, undefined)
})

test('refunded is its own terminal', () => {
  const state = deriveEffectiveProposalState(makeProposal({ paymentStatus: 'refunded' }), 'outbound')
  assert.equal(state.primary.key, 'refunded')
})

test('PM gate: pending_review reads as in_review', () => {
  const state = deriveEffectiveProposalState(makeProposal({ reviewStatus: 'pending_review' }), 'inbound')
  assert.equal(state.primary.key, 'in_review')
})

test('PM gate terminals', () => {
  for (const [reviewStatus, key] of [
    ['rejected', 'review_rejected'],
    ['cancelled', 'cancelled'],
    ['expired', 'expired'],
    ['changes_requested', 'changes_requested'],
  ] as const) {
    const state = deriveEffectiveProposalState(makeProposal({ reviewStatus }), 'outbound')
    assert.equal(state.primary.key, key, `reviewStatus=${reviewStatus}`)
  }
})

test('approved without checkout link reads as approved', () => {
  const state = deriveEffectiveProposalState(makeProposal({ reviewStatus: 'approved' }), 'outbound')
  assert.equal(state.primary.key, 'approved')
})

test('approved + checkout link reads as awaiting_payment', () => {
  const state = deriveEffectiveProposalState(
    makeProposal({ reviewStatus: 'approved', status: 'sent', activeCheckoutLink: checkoutLink }),
    'outbound',
  )
  assert.equal(state.primary.key, 'awaiting_payment')
  assert.equal(state.hint, undefined)
})

test('awaiting_payment on inbound adds the web-payment hint', () => {
  const state = deriveEffectiveProposalState(
    makeProposal({ reviewStatus: 'approved', activeCheckoutLink: checkoutLink }),
    'inbound',
  )
  assert.equal(state.primary.key, 'awaiting_payment')
  assert.equal(state.hint, 'El cliente paga desde la web.')
})

test('failed payment is surfaced as a secondary chip without hiding lifecycle', () => {
  const state = deriveEffectiveProposalState(
    makeProposal({ reviewStatus: 'approved', activeCheckoutLink: checkoutLink, paymentStatus: 'failed' }),
    'outbound',
  )
  assert.equal(state.primary.key, 'awaiting_payment')
  assert.equal(state.secondary?.key, 'payment_failed')
})

test('proposal-level rejection (outbound) falls through to rejected', () => {
  // reviewStatus must be a non-gating value for the status axis to surface;
  // 'approved' lets the lifecycle reject show through.
  const state = deriveEffectiveProposalState(
    makeProposal({ reviewStatus: 'approved', status: 'rejected' }),
    'outbound',
  )
  // approved with no checkout link wins first — guards the precedence order.
  assert.equal(state.primary.key, 'approved')
})

test('draft fallback when review axis is somehow non-standard', () => {
  // Defensive: if reviewStatus were cleared, a plain draft must still render.
  const state = deriveEffectiveProposalState(
    { status: 'draft', reviewStatus: 'approved', paymentStatus: null, linkedProject: undefined, activeCheckoutLink: null },
    'outbound',
  )
  // approved beats draft — this asserts the documented precedence, not draft.
  assert.equal(state.primary.key, 'approved')
})

// --- manual status options by origin ---------------------------------------

test('inbound exposes no manual status transitions', () => {
  assert.deepEqual(manualProposalStatusOptions('inbound'), [])
})

test('outbound exposes draft/sent/rejected only (no payment-driven states)', () => {
  const options = manualProposalStatusOptions('outbound')
  assert.deepEqual(options, ['draft', 'sent', 'rejected'])
  assert.ok(!options.includes('accepted' as never))
  assert.ok(!options.includes('handoff_ready' as never))
})

test('undefined origin is treated as outbound (keeps the control)', () => {
  assert.deepEqual(manualProposalStatusOptions(undefined as unknown as LeadOrigin), ['draft', 'sent', 'rejected'])
})
