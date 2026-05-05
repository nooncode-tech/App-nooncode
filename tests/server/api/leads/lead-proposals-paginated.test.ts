import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthGuardError } from '@/lib/server/auth/guards'
import { encodeCursor } from '@/lib/server/pagination/cursor'
import type { DatabaseClient } from '@/lib/server/supabase/server'
import { createGetLeadProposalsHandler } from '@/app/api/leads/[leadId]/proposals/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUrl(leadId: string, params: Record<string, string> = {}) {
  const url = new URL(`https://app.noon.test/api/leads/${leadId}/proposals`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString())
}

const LEAD_ID = '00000000-0000-0000-0000-000000000001'

function makeProposal(id: string, createdAt = '2026-05-01T00:00:00Z') {
  return {
    id,
    lead_id: LEAD_ID,
    created_by: 'user-1',
    title: 'Test Proposal',
    body: 'Body',
    amount: '1000',
    currency: 'USD',
    status: 'draft' as const,
    review_status: 'pending_review' as const,
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
    created_at: createdAt,
    updated_at: createdAt,
    linked_project: null,
  }
}

function makeHandler({
  proposals = [] as ReturnType<typeof makeProposal>[],
  leadExists = true,
  authError = null as Error | null,
} = {}) {
  const requireRoleStub = async () => {
    if (authError) throw authError
    return { userId: 'user-1', role: 'admin' }
  }

  const getLeadByIdStub = async () => (leadExists ? { id: LEAD_ID } : null)

  const listLeadProposalsStub = async () => proposals

  const listProjectsByProposalIdsStub = async () => []
  const listLeadActivitiesStub = async () => []
  const createClientStub = async () => ({}) as DatabaseClient

  return createGetLeadProposalsHandler({
    requireRole: requireRoleStub,
    getLeadById: getLeadByIdStub,
    listLeadProposals: listLeadProposalsStub,
    listProjectsByProposalIds: listProjectsByProposalIdsStub,
    listLeadActivities: listLeadActivitiesStub,
    createSupabaseServerClient: createClientStub,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('GET /api/leads/:leadId/proposals no cursor → 200 with meta.nextCursor=null', async () => {
  const handler = makeHandler({ proposals: [makeProposal('p-1')] })
  const res = await handler(makeUrl(LEAD_ID), { params: Promise.resolve({ leadId: LEAD_ID }) })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.ok(Array.isArray(body.data))
  assert.equal(body.meta.nextCursor, null)
  assert.equal(body.meta.limit, 100)
})

test('GET /api/leads/:leadId/proposals when limit+1 rows returned → nextCursor is set', async () => {
  // Return limit+1 proposals to trigger next cursor
  const proposals = Array.from({ length: 11 }, (_, i) =>
    makeProposal(`p-${i + 1}`, `2026-05-0${String(11 - i).padStart(1, '0')}T00:00:00Z`)
  )
  const handler = makeHandler({ proposals })
  const res = await handler(makeUrl(LEAD_ID, { limit: '10' }), { params: Promise.resolve({ leadId: LEAD_ID }) })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.data.length, 10)
  assert.ok(body.meta.nextCursor !== null, 'nextCursor should be set')
})

test('GET /api/leads/:leadId/proposals malformed cursor → 200 first page (not 400)', async () => {
  const handler = makeHandler({ proposals: [makeProposal('p-1')] })
  const res = await handler(makeUrl(LEAD_ID, { cursor: 'not-valid-base64' }), { params: Promise.resolve({ leadId: LEAD_ID }) })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.ok(Array.isArray(body.data))
})

test('GET /api/leads/:leadId/proposals valid cursor → 200', async () => {
  const cursor = encodeCursor({ createdAt: '2026-05-01T10:00:00Z', id: 'p-5' })
  const handler = makeHandler({ proposals: [makeProposal('p-6')] })
  const res = await handler(makeUrl(LEAD_ID, { cursor }), { params: Promise.resolve({ leadId: LEAD_ID }) })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.data.length, 1)
})

test('GET /api/leads/:leadId/proposals lead not found → 404', async () => {
  const handler = makeHandler({ leadExists: false })
  const res = await handler(makeUrl(LEAD_ID), { params: Promise.resolve({ leadId: LEAD_ID }) })

  assert.equal(res.status, 404)
})

test('GET /api/leads/:leadId/proposals unauthenticated → 401', async () => {
  const authError = new AuthGuardError('UNAUTHENTICATED', 'An active session is required.', 401)
  const handler = makeHandler({ authError })
  const res = await handler(makeUrl(LEAD_ID), { params: Promise.resolve({ leadId: LEAD_ID }) })

  assert.equal(res.status, 401)
})
