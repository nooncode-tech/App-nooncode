import assert from 'node:assert/strict'
import test from 'node:test'

import { mapLeadProposalRowToWire } from '@/lib/server/leads/proposal-mappers'
import type { LeadProposalRowWithLinkedProject } from '@/lib/server/leads/proposal-types'

// activeCheckoutLink enrichment was added in F-V08 / B7 (2026-05-16).
// The mapper computes isExpired at read time so the client never has to.

function makeRow(): LeadProposalRowWithLinkedProject {
  return {
    id: 'proposal-1',
    lead_id: 'lead-1',
    created_by: 'user-1',
    title: 'Demo',
    body: 'Body',
    amount: '1000',
    currency: 'USD',
    status: 'sent',
    review_status: 'approved',
    version_number: 1,
    is_special_case: false,
    superseded_by: null,
    sent_at: null,
    accepted_at: null,
    handoff_ready_at: null,
    first_opened_at: null,
    expires_at: null,
    reviewer_id: null,
    reviewed_at: null,
    payment_status: null,
    paid_at: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    linked_project: null,
  } as unknown as LeadProposalRowWithLinkedProject
}

test('mapLeadProposalRowToWire: activeCheckoutLink is null when override is null', () => {
  const wire = mapLeadProposalRowToWire(makeRow())
  assert.equal(wire.activeCheckoutLink, null)
})

test('mapLeadProposalRowToWire: activeCheckoutLink.isExpired=false when expiresAt is in the future', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const wire = mapLeadProposalRowToWire(makeRow(), null, {
    proposalId: 'proposal-1',
    url: 'https://checkout.stripe.com/c/pay/cs_live_x',
    sessionId: 'cs_live_x',
    expiresAt: future,
  })

  assert.ok(wire.activeCheckoutLink, 'activeCheckoutLink should be populated')
  assert.equal(wire.activeCheckoutLink?.isExpired, false)
  assert.equal(wire.activeCheckoutLink?.url, 'https://checkout.stripe.com/c/pay/cs_live_x')
  assert.equal(wire.activeCheckoutLink?.sessionId, 'cs_live_x')
  assert.equal(wire.activeCheckoutLink?.expiresAt, future)
})

test('mapLeadProposalRowToWire: activeCheckoutLink.isExpired=true when expiresAt is in the past', () => {
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const wire = mapLeadProposalRowToWire(makeRow(), null, {
    proposalId: 'proposal-1',
    url: 'https://checkout.stripe.com/c/pay/cs_live_y',
    sessionId: 'cs_live_y',
    expiresAt: past,
  })

  assert.ok(wire.activeCheckoutLink, 'activeCheckoutLink should be populated')
  assert.equal(wire.activeCheckoutLink?.isExpired, true)
})

test('mapLeadProposalRowToWire: activeCheckoutLink does not shadow linkedProject override', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const wire = mapLeadProposalRowToWire(
    makeRow(),
    {
      id: 'project-1',
      name: 'Demo project',
      status: 'backlog',
      created_at: '2026-05-01T00:00:00Z',
    },
    {
      proposalId: 'proposal-1',
      url: 'https://checkout.stripe.com/c/pay/cs_live_z',
      sessionId: 'cs_live_z',
      expiresAt: future,
    },
  )

  assert.equal(wire.linkedProject?.id, 'project-1')
  assert.equal(wire.activeCheckoutLink?.sessionId, 'cs_live_z')
})
