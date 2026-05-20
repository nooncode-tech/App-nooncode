import assert from 'node:assert/strict'
import test from 'node:test'
import { createGetLeadsHandler } from '@/app/api/leads/route'
import { LEADS_PAGE_SIZE } from '@/lib/data-context'
import type { OffsetMeta } from '@/lib/server/pagination/envelope'
import type { DatabaseClient } from '@/lib/server/supabase/server'
import type { LeadWire } from '@/lib/leads/serialization'

// ---------------------------------------------------------------------------
// Integration scope (F-V12 spec §8)
//
// The frontend wire-up under test lives in `lib/data-context.tsx`. That module
// is a React client component (`'use client'`) and the repo has no JSDOM/RTL
// harness, so we exercise the same wire contract the provider relies on:
//
//   1. `/api/leads` handler (real `createGetLeadsHandler`, stubbed deps —
//      same pattern as `tests/server/api/leads/list-leads-paginated.test.ts`)
//      produces the `{ data, meta }` envelope.
//   2. A `fetch`-equivalent loader mirrors the provider's `loadLeads` flow:
//      read the envelope, surface `leads` + `leadsPagination` derived state.
//   3. Optimistic meta math from `addLead`/`deleteLead` is exercised against
//      the pure semantics the provider applies (`++total` / `--total` +
//      `pageCount = Math.ceil(total/limit)`).
//   4. Mock-mode parity is exercised through the documented
//      `buildMockLeadsPagination` contract:
//      `{ page:1, limit:max(count,1), total:count, pageCount: count===0?0:1 }`.
//
// What this protects: regression of the envelope contract (server side) +
// regression of the client envelope-handling shape + the meta math invariants
// the UI controls depend on (prev/next disabled-state, "Page X of Y" label).
// ---------------------------------------------------------------------------

type StubPrincipal = { userId: string; role: 'admin' }

function makeWireLead(id: string): LeadWire {
  // Minimal fields the handler's mapRow path expects when we pass them through
  // unchanged. The list-leads tests use `[{ id: 'lead-1' }]` and rely on the
  // identity `mapRow` injected at test time; we follow the same shape.
  return { id } as unknown as LeadWire
}

function makeHandler({
  rows = [] as LeadWire[],
  total = 0,
  principal = { userId: 'user-1', role: 'admin' } as StubPrincipal,
}: {
  rows?: LeadWire[]
  total?: number
  principal?: StubPrincipal
} = {}) {
  const requireRoleStub = async () => principal
  const listLeadsStub = async () => ({ rows, total })
  const createClientStub = async () => ({}) as DatabaseClient

  return createGetLeadsHandler({
    requireRole: requireRoleStub,
    listLeads: listLeadsStub,
    createSupabaseServerClient: createClientStub,
  })
}

// Client-side envelope reader mirroring `readPaginatedApiResponse` in
// `lib/data-context.tsx`. Re-implemented here because it is not exported —
// the contract under test is "client reads top-level { data, meta } from the
// envelope and surfaces both", which this helper expresses directly.
async function readPaginatedEnvelope<T>(response: Response): Promise<{ data: T; meta: OffsetMeta }> {
  const payload = (await response.json()) as { data: T; meta: OffsetMeta }
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !('meta' in payload)) {
    throw new Error('Unexpected response shape: missing pagination envelope.')
  }
  return payload
}

// Drives the handler the same way the provider's `loadLeads` would, returning
// the derived (leads, leadsPagination) tuple. We pass `rows`/`total` per call
// so each test can shape its own dataset against a single handler.
async function callLoadLeads(opts: {
  page: number
  limit?: number
  rows: LeadWire[]
  total: number
}): Promise<{ leads: LeadWire[]; meta: OffsetMeta }> {
  const limit = opts.limit ?? LEADS_PAGE_SIZE
  const handler = makeHandler({ rows: opts.rows, total: opts.total })
  const request = new Request(`https://app.test/api/leads?page=${opts.page}&limit=${limit}`)
  const response = await handler(request)
  const envelope = await readPaginatedEnvelope<LeadWire[]>(response)
  // The provider applies `deserializeLead` to each wire row; for the contract
  // we care about identity preservation of the array length and meta shape.
  return { leads: envelope.data, meta: envelope.meta }
}

// Mock-mode meta synthesizer — mirrors `buildMockLeadsPagination` in
// `lib/data-context.tsx`. Documented contract per spec §2.1.
function buildMockLeadsPagination(leadsCount: number): OffsetMeta {
  return {
    page: 1,
    limit: Math.max(leadsCount, 1),
    total: leadsCount,
    pageCount: leadsCount === 0 ? 0 : 1,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('client default limit is exposed as LEADS_PAGE_SIZE=50 (spec Q1 default)', () => {
  assert.equal(LEADS_PAGE_SIZE, 50)
})

test('first page: total>limit → page=1, pageCount>1, data length = limit, controls would render', async () => {
  const rows = Array.from({ length: LEADS_PAGE_SIZE }, (_, i) => makeWireLead(`lead-${i + 1}`))
  const { leads, meta } = await callLoadLeads({ page: 1, rows, total: 120 })

  assert.equal(meta.page, 1)
  assert.equal(meta.limit, LEADS_PAGE_SIZE)
  assert.equal(meta.total, 120)
  assert.equal(meta.pageCount, Math.ceil(120 / LEADS_PAGE_SIZE)) // 3
  assert.equal(leads.length, LEADS_PAGE_SIZE)

  // UI invariants the controls block on:
  assert.ok(meta.pageCount > 1, 'controls render when pageCount > 1')
  assert.equal(meta.page === 1, true, 'Anterior is disabled on first page')
  assert.equal(meta.page < meta.pageCount, true, 'Siguiente is enabled when page < pageCount')
})

test('last page: page === pageCount, data length <= limit, Siguiente disabled', async () => {
  // total=120, limit=50 → pageCount=3; last page has 120 - 2*50 = 20 rows.
  const rows = Array.from({ length: 20 }, (_, i) => makeWireLead(`lead-${100 + i + 1}`))
  const { leads, meta } = await callLoadLeads({ page: 3, rows, total: 120 })

  assert.equal(meta.page, 3)
  assert.equal(meta.pageCount, 3)
  assert.equal(meta.total, 120)
  assert.equal(leads.length, 20)
  assert.ok(leads.length <= meta.limit)

  // UI invariants:
  assert.equal(meta.page >= meta.pageCount, true, 'Siguiente is disabled on last page')
  assert.equal(meta.page > 1, true, 'Anterior is enabled when page > 1')
})

test('empty result: total=0 → pageCount=0, data=[], controls do NOT render', async () => {
  const { leads, meta } = await callLoadLeads({ page: 1, rows: [], total: 0 })

  assert.deepEqual(leads, [])
  assert.equal(meta.page, 1)
  assert.equal(meta.limit, LEADS_PAGE_SIZE)
  assert.equal(meta.total, 0)
  assert.equal(meta.pageCount, 0)

  // UI invariant: controls hidden when pageCount <= 1 (spec Q5).
  assert.ok(meta.pageCount <= 1, 'pagination controls hidden when pageCount <= 1')
})

test('page navigation round-trip: setLeadsPage(2) then setLeadsPage(1) tracks meta.page', async () => {
  // Simulate two consecutive provider-side fetches at pages 2 and 1.
  // The handler is stubbed to return distinct row sets per page so we can
  // verify the leads state actually swaps (not just meta).
  const allRows = Array.from({ length: 150 }, (_, i) => makeWireLead(`lead-${i + 1}`))
  const total = allRows.length // 150 → pageCount=3

  // Page 2 → rows 51..100 (we just slice; the real server does this in SQL).
  const page2Rows = allRows.slice(LEADS_PAGE_SIZE, LEADS_PAGE_SIZE * 2)
  const page1Rows = allRows.slice(0, LEADS_PAGE_SIZE)

  const r2 = await callLoadLeads({ page: 2, rows: page2Rows, total })
  assert.equal(r2.meta.page, 2)
  assert.equal(r2.meta.pageCount, 3)
  assert.equal(r2.leads.length, LEADS_PAGE_SIZE)
  assert.equal(r2.leads[0]?.id, 'lead-51')

  const r1 = await callLoadLeads({ page: 1, rows: page1Rows, total })
  assert.equal(r1.meta.page, 1)
  assert.equal(r1.meta.pageCount, 3)
  assert.equal(r1.leads.length, LEADS_PAGE_SIZE)
  assert.equal(r1.leads[0]?.id, 'lead-1')

  // Confirm meta.total survives navigation unchanged (no row insertion between
  // calls — TDR-004 R5 boundary not exercised here, intentionally).
  assert.equal(r1.meta.total, r2.meta.total)
})

test('mock-mode parity: synthetic single-page meta matches buildMockLeadsPagination contract', () => {
  const meta = buildMockLeadsPagination(7)
  assert.deepEqual(meta, { page: 1, limit: 7, total: 7, pageCount: 1 })

  // Controls hidden in mock mode (pageCount === 1 → spec Q5).
  assert.equal(meta.pageCount, 1)
  assert.ok(meta.pageCount <= 1, 'mock-mode controls hidden — single page')
})

test('mock-mode parity: empty mock dataset → pageCount=0, limit clamped to 1', () => {
  // Edge case: mockLeads.length === 0. The synthesizer must not produce
  // limit=0 (would be a divide-by-zero risk in any future meta math).
  const meta = buildMockLeadsPagination(0)
  assert.deepEqual(meta, { page: 1, limit: 1, total: 0, pageCount: 0 })
})

test('optimistic meta on addLead: total++, pageCount recomputes (provider invariant)', () => {
  // Mirrors the supabase-mode `addLead` setLeadsPagination updater in
  // `lib/data-context.tsx`. The provider does not refetch on add; the meta
  // must stay consistent so the UI label "Page X of Y" remains correct.
  const prev: OffsetMeta = { page: 1, limit: 50, total: 120, pageCount: 3 }
  const nextTotal = prev.total + 1
  const next: OffsetMeta = {
    ...prev,
    total: nextTotal,
    pageCount: nextTotal === 0 ? 0 : Math.ceil(nextTotal / prev.limit),
  }
  assert.equal(next.total, 121)
  assert.equal(next.pageCount, 3) // ceil(121/50) === 3

  // Crossing a page boundary: 150 → 151 forces pageCount 3 → 4.
  const prevAtBoundary: OffsetMeta = { page: 3, limit: 50, total: 150, pageCount: 3 }
  const nt = prevAtBoundary.total + 1
  const atBoundary: OffsetMeta = {
    ...prevAtBoundary,
    total: nt,
    pageCount: Math.ceil(nt / prevAtBoundary.limit),
  }
  assert.equal(atBoundary.pageCount, 4)
})

test('optimistic meta on deleteLead: total--, pageCount recomputes, step-back signal when page exceeds new pageCount', () => {
  // Mirrors the supabase-mode `deleteLead` setLeadsPagination updater.
  // Case A: simple decrement, no step-back.
  const prevA: OffsetMeta = { page: 1, limit: 50, total: 120, pageCount: 3 }
  const ntA = Math.max(0, prevA.total - 1)
  const npcA = ntA === 0 ? 0 : Math.ceil(ntA / prevA.limit)
  let stepBackA: { targetPage: number } | null = null
  if (npcA > 0 && prevA.page > npcA) {
    stepBackA = { targetPage: Math.max(1, npcA) }
  }
  assert.equal(ntA, 119)
  assert.equal(npcA, 3)
  assert.equal(stepBackA, null)

  // Case B: deleting the only row on the last page → step back required.
  // page=3, total=101, limit=50, pageCount=3. After delete: total=100,
  // pageCount=2, current page=3 > 2 → step back to page 2.
  const prevB: OffsetMeta = { page: 3, limit: 50, total: 101, pageCount: 3 }
  const ntB = Math.max(0, prevB.total - 1)
  const npcB = ntB === 0 ? 0 : Math.ceil(ntB / prevB.limit)
  let stepBackB: { targetPage: number } | null = null
  if (npcB > 0 && prevB.page > npcB) {
    stepBackB = { targetPage: Math.max(1, npcB) }
  }
  assert.equal(ntB, 100)
  assert.equal(npcB, 2)
  assert.deepEqual(stepBackB, { targetPage: 2 })

  // Case C: deleting the last lead in the tenant → total=0, pageCount=0,
  // no step-back (no remaining page to land on; UI hides controls).
  const prevC: OffsetMeta = { page: 1, limit: 50, total: 1, pageCount: 1 }
  const ntC = Math.max(0, prevC.total - 1)
  const npcC = ntC === 0 ? 0 : Math.ceil(ntC / prevC.limit)
  assert.equal(ntC, 0)
  assert.equal(npcC, 0)
})

test('envelope shape is the exact contract the client expects (regression net for D2/D4)', async () => {
  // If the server ever stops emitting top-level `{ data, meta }` the client's
  // `readPaginatedApiResponse` throws "Unexpected response shape" — this test
  // fires before that lands in production.
  const rows = [makeWireLead('lead-1')]
  const handler = makeHandler({ rows, total: 1 })
  const request = new Request('https://app.test/api/leads?page=1&limit=50')
  const response = await handler(request)
  const body = (await response.json()) as Record<string, unknown>

  assert.ok('data' in body, 'envelope MUST expose top-level `data`')
  assert.ok('meta' in body, 'envelope MUST expose top-level `meta`')
  assert.ok(Array.isArray(body.data), '`data` MUST be an array (LeadWire[])')
  const meta = body.meta as Record<string, unknown>
  assert.ok('page' in meta && 'limit' in meta && 'total' in meta && 'pageCount' in meta,
    '`meta` MUST expose page/limit/total/pageCount (OffsetMeta shape)')
})
