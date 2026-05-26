import assert from 'node:assert/strict'
import test from 'node:test'

import {
  driveAdminOutboundReplay,
  runOutboundWebhookCronSweep,
  sendProposalReviewDecisionToWebsite,
} from '@/lib/server/website-integration'

// ---------------------------------------------------------------------------
// Additional integration tests added by system-testing (G23 audit).
//
// Scope of this file:
//   1. Cron sweep happy + failure paths (AC-5 mutation gap; the original
//      coverage only validates cron authz, not behavior).
//   2. Admin replay state-machine branches (AC-7 / AC-8 / D7 / D10 mutation
//      gap; the original coverage only validates authz, not behavior).
//   3. State-machine invariant: `next_retry_at` is cleared on `delivered`
//      (D2 mutation gap; the original test asserts terminal status but
//      not the cleared field).
//
// These tests reuse the same scripted-fetch + stub-client pattern from
// `website-integration-outbound-retry.test.ts` (kept local to avoid
// cross-file coupling that would force the original file's helpers into a
// shared module).
// ---------------------------------------------------------------------------

process.env.NOON_WEBSITE_WEBHOOK_SECRET ??= 'test-secret'
process.env.NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL ??=
  'https://noon.example.test/api/integrations/noon-app/proposal-review-decision'

// ---------------------------------------------------------------------------
// Stub Supabase client
// ---------------------------------------------------------------------------

interface LinkRow {
  id: string
  external_source: string
  external_session_id: string
  external_proposal_id: string
  external_payment_id: string | null
  lead_id: string
  proposal_id: string
  project_id: string | null
  current_status: string
  review_webhook_status: string | null
  review_webhook_error: string | null
  inbound_payload: unknown
  payment_payload: unknown
  review_webhook_attempted_at?: string | null
  review_webhook_sent_at?: string | null
}

interface ProposalRow {
  id: string
  title: string
  body: string | null
  amount: number
  currency: string
  review_status: string
  reviewed_at: string | null
  lead: unknown
}

interface OutboundRow {
  id: string
  endpoint: string
  external_proposal_id: string
  decision: string
  link_id: string | null
  proposal_id: string | null
  status: string
  attempt_count: number
  max_attempts: number
  next_retry_at: string | null
  last_attempted_at: string | null
  delivered_at: string | null
  dead_lettered_at: string | null
  replayed_at: string | null
  replayed_by_event_id: string | null
  last_error: string | null
  last_http_status: number | null
  payload_hash: string
  signature_header: string | null
  idempotency_key: string
  request_id: string | null
  actor_id: string | null
  alerted_at: string | null
  created_at: string
  updated_at: string
}

function makeLink(): LinkRow {
  return {
    id: 'link-1',
    external_source: 'noon_website',
    external_session_id: 'sess_1',
    external_proposal_id: 'prop_test',
    external_payment_id: null,
    lead_id: 'lead-1',
    proposal_id: 'proposal-1',
    project_id: null,
    current_status: 'proposal_pending_review',
    review_webhook_status: null,
    review_webhook_error: null,
    inbound_payload: {},
    payment_payload: {},
  }
}

function makeProposal(): ProposalRow {
  return {
    id: 'proposal-1',
    title: 'Test',
    body: 'Body',
    amount: 1000,
    currency: 'USD',
    review_status: 'approved',
    reviewed_at: '2026-05-26T00:00:00.000Z',
    lead: null,
  }
}

function createStubClient(initialOutbound: OutboundRow[] = []) {
  const links: LinkRow[] = [makeLink()]
  const proposals: ProposalRow[] = [makeProposal()]
  const outbound: OutboundRow[] = [...initialOutbound]
  let outboundSeq = outbound.length + 1

  function linksTable() {
    return {
      select(_cols: string) {
        const filters: Array<(r: LinkRow) => boolean> = []
        const chain = {
          eq(col: keyof LinkRow, val: unknown) {
            filters.push((r) => (r[col] as unknown) === val)
            return chain
          },
          async maybeSingle() {
            const found = links.find((r) => filters.every((fn) => fn(r)))
            return { data: found ?? null, error: null }
          },
        }
        return chain
      },
      update(value: Partial<LinkRow>) {
        return {
          async eq(col: keyof LinkRow, val: unknown) {
            const row = links.find((r) => (r[col] as unknown) === val)
            if (row) Object.assign(row, value)
            return { error: null }
          },
        }
      },
    }
  }

  function proposalsTable() {
    return {
      select(_cols: string) {
        const filters: Array<(r: ProposalRow) => boolean> = []
        const chain = {
          eq(col: keyof ProposalRow, val: unknown) {
            filters.push((r) => (r[col] as unknown) === val)
            return chain
          },
          async single() {
            const found = proposals.find((r) => filters.every((fn) => fn(r)))
            return found
              ? { data: found, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          },
          async maybeSingle() {
            const found = proposals.find((r) => filters.every((fn) => fn(r)))
            return { data: found ?? null, error: null }
          },
        }
        return chain
      },
    }
  }

  function outboundTable() {
    return {
      insert(value: Partial<OutboundRow>) {
        const id = `evt-${outboundSeq++}`
        const nowIso = new Date().toISOString()
        const row: OutboundRow = {
          id,
          endpoint: value.endpoint ?? 'proposal-review-decision',
          external_proposal_id: value.external_proposal_id ?? '',
          decision: value.decision ?? 'approved',
          link_id: value.link_id ?? null,
          proposal_id: value.proposal_id ?? null,
          status: value.status ?? 'pending',
          attempt_count: value.attempt_count ?? 0,
          max_attempts: value.max_attempts ?? 3,
          next_retry_at: value.next_retry_at ?? null,
          last_attempted_at: value.last_attempted_at ?? null,
          delivered_at: value.delivered_at ?? null,
          dead_lettered_at: value.dead_lettered_at ?? null,
          replayed_at: null,
          replayed_by_event_id: null,
          last_error: value.last_error ?? null,
          last_http_status: value.last_http_status ?? null,
          payload_hash: value.payload_hash ?? '',
          signature_header: value.signature_header ?? null,
          idempotency_key: value.idempotency_key ?? '',
          request_id: value.request_id ?? null,
          actor_id: value.actor_id ?? null,
          alerted_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        }
        outbound.push(row)
        return {
          select(_cols: string) {
            return {
              async single() {
                return { data: row, error: null }
              },
            }
          },
        }
      },
      select(_cols: string) {
        const filters: Array<(r: OutboundRow) => boolean> = []
        let orderField: keyof OutboundRow | null = null
        let orderAsc = true
        let limitN: number | null = null
        const chain = {
          eq(col: keyof OutboundRow, val: unknown) {
            filters.push((r) => (r[col] as unknown) === val)
            return chain
          },
          lte(col: keyof OutboundRow, val: unknown) {
            filters.push((r) => {
              const v = r[col]
              if (v === null || v === undefined) return false
              return (v as unknown as string) <= (val as string)
            })
            return chain
          },
          not(col: keyof OutboundRow, op: string, val: unknown) {
            if (op === 'is' && val === null) {
              filters.push((r) => r[col] !== null)
            }
            return chain
          },
          order(col: keyof OutboundRow, opts: { ascending: boolean }) {
            orderField = col
            orderAsc = opts.ascending
            return chain
          },
          limit(n: number) {
            limitN = n
            return chain
          },
          async single() {
            const found = outbound.find((r) => filters.every((fn) => fn(r)))
            return found
              ? { data: found, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          },
          async maybeSingle() {
            const found = outbound.find((r) => filters.every((fn) => fn(r)))
            return { data: found ?? null, error: null }
          },
          then<T>(
            onFulfilled?: (
              value: { data: OutboundRow[] | null; error: null },
            ) => T | PromiseLike<T>,
          ): Promise<T> {
            let result = outbound.filter((r) => filters.every((fn) => fn(r)))
            if (orderField !== null) {
              const field = orderField
              result = [...result].sort((a, b) => {
                const av = a[field] as unknown as string
                const bv = b[field] as unknown as string
                if (av === bv) return 0
                return (av < bv ? -1 : 1) * (orderAsc ? 1 : -1)
              })
            }
            if (limitN !== null) result = result.slice(0, limitN)
            return Promise.resolve({ data: result, error: null }).then(onFulfilled)
          },
        }
        return chain
      },
      update(value: Partial<OutboundRow>) {
        return {
          async eq(col: keyof OutboundRow, val: unknown) {
            const row = outbound.find((r) => (r[col] as unknown) === val)
            if (row) Object.assign(row, value, { updated_at: new Date().toISOString() })
            return { error: null }
          },
        }
      },
    }
  }

  const client = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(name: string): any {
      if (name === 'website_inbound_links') return linksTable()
      if (name === 'lead_proposals') return proposalsTable()
      if (name === 'outbound_webhook_events') return outboundTable()
      throw new Error(`Unexpected table in stub: ${name}`)
    },
  }
  return { client, links, proposals, outbound }
}

// ---------------------------------------------------------------------------
// Scripted fetch helper
// ---------------------------------------------------------------------------

function makeScriptedFetch(
  script: Array<
    | { ok: true; status: number; bodyText?: string }
    | { ok: false; status: number; bodyText?: string }
    | { throw: string }
  >,
): {
  fetch: typeof fetch
  calls: Array<{ url: string; headers: Record<string, string>; bodyText: string }>
} {
  const calls: Array<{ url: string; headers: Record<string, string>; bodyText: string }> = []
  let idx = 0
  const fakeFetch: typeof fetch = async (input, init) => {
    if (idx >= script.length) {
      throw new Error(`Scripted fetch exhausted at call ${idx + 1}`)
    }
    const step = script[idx++]!
    const url = typeof input === 'string' ? input : (input as URL).toString()
    const headersIn = (init?.headers ?? {}) as Record<string, string>
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    calls.push({ url, headers: { ...headersIn }, bodyText })

    if ('throw' in step) {
      throw new Error(step.throw)
    }
    const body = step.bodyText ?? ''
    return new Response(body, { status: step.status })
  }
  return { fetch: fakeFetch, calls }
}

// ---------------------------------------------------------------------------
// (A) State-machine invariant — `next_retry_at` cleared on `delivered`
//     (D2 / ADR-027 mutation gap)
// ---------------------------------------------------------------------------

test('dispatcher: [503, 200] → delivered clears next_retry_at on the ledger (D2 invariant)', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch } = makeScriptedFetch([
    { ok: false, status: 503, bodyText: 'svc unavailable' },
    { ok: true, status: 200 },
  ])

  const result = await sendProposalReviewDecisionToWebsite('proposal-1', 'approve', undefined, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(result.status, 'sent')
  assert.equal(stub.outbound[0]!.status, 'delivered')
  // D2 invariant: a row that transitions to `delivered` MUST have its
  // next_retry_at cleared (was set during the prior scheduleOutboundRetry
  // step after the 503). Silently leaving it populated is a state-machine
  // mutation that would corrupt the cron's claim filter.
  assert.equal(stub.outbound[0]!.next_retry_at, null)
})

test('dispatcher: [503, 503, 503] → dead_letter clears next_retry_at on the ledger (D2 invariant)', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch } = makeScriptedFetch([
    { ok: false, status: 503 },
    { ok: false, status: 503 },
    { ok: false, status: 503 },
  ])

  await sendProposalReviewDecisionToWebsite('proposal-1', 'approve', undefined, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(stub.outbound[0]!.status, 'dead_letter')
  // D2 invariant: a row that transitions to `dead_letter` MUST have its
  // next_retry_at cleared (otherwise the cron would re-pick it up despite
  // a terminal state, generating cross-state amplification).
  assert.equal(stub.outbound[0]!.next_retry_at, null)
})

// ---------------------------------------------------------------------------
// (B) Cron sweep behavior — AC-5
// ---------------------------------------------------------------------------

function makePendingOutboundRow(overrides: Partial<OutboundRow> = {}): OutboundRow {
  return {
    id: 'evt-seed-1',
    endpoint: 'proposal-review-decision',
    external_proposal_id: 'prop_test',
    decision: 'approved',
    link_id: 'link-1',
    proposal_id: 'proposal-1',
    status: 'pending',
    attempt_count: 1,
    max_attempts: 3,
    next_retry_at: '2020-01-01T00:00:00.000Z', // due in the far past
    last_attempted_at: '2020-01-01T00:00:00.000Z',
    delivered_at: null,
    dead_lettered_at: null,
    replayed_at: null,
    replayed_by_event_id: null,
    last_error: 'transient',
    last_http_status: 503,
    payload_hash: 'p-hash',
    signature_header: null,
    idempotency_key: 'prop_test:approved',
    request_id: 'req-seed-1',
    actor_id: null,
    alerted_at: null,
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('cron sweep: drives a due pending row to delivered when receiver returns 200 (AC-5 happy path)', async () => {
  const stub = createStubClient([makePendingOutboundRow()])
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([{ ok: true, status: 200 }])

  const result = await runOutboundWebhookCronSweep({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(result.candidateCount, 1)
  assert.equal(result.delivered.length, 1)
  assert.equal(result.deadLettered.length, 0)
  assert.equal(calls.length, 1)
  // D2 / D8 dual-track invariant: both the ledger row AND the link
  // snapshot are updated.
  assert.equal(stub.outbound[0]!.status, 'delivered')
  assert.equal(stub.outbound[0]!.next_retry_at, null)
  assert.equal(stub.links[0]!.review_webhook_status, 'sent')
  assert.equal(stub.links[0]!.current_status, 'review_webhook_sent')
  // Cross-repo idempotency-key MUST still be emitted on cron-driven retry.
  assert.equal(calls[0]!.headers['X-Noon-Idempotency-Key'], 'prop_test:approved')
})

test('cron sweep: drives a due pending row to dead_letter when remaining budget exhausts (AC-5 failure path)', async () => {
  // Row starts with attempt_count=2 / max_attempts=3, so the cron has ONE
  // remaining attempt; if it fails, the row should land in `dead_letter`.
  const stub = createStubClient([
    makePendingOutboundRow({ attempt_count: 2, max_attempts: 3 }),
  ])
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { ok: false, status: 503, bodyText: 'still down' },
  ])

  const result = await runOutboundWebhookCronSweep({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(result.candidateCount, 1)
  assert.equal(result.deadLettered.length, 1)
  assert.equal(result.delivered.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(stub.outbound[0]!.status, 'dead_letter')
  assert.equal(stub.outbound[0]!.next_retry_at, null)
  assert.equal(stub.outbound[0]!.attempt_count, 3)
  // D8 snapshot dual-track on failure.
  assert.equal(stub.links[0]!.review_webhook_status, 'failed')
  assert.equal(stub.links[0]!.current_status, 'review_webhook_failed')
})

test('cron sweep: skips rows that are not due yet', async () => {
  // next_retry_at is in the future relative to the cron's "now" -> not due.
  const stub = createStubClient([
    makePendingOutboundRow({ next_retry_at: '2999-01-01T00:00:00.000Z' }),
  ])
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([])

  const result = await runOutboundWebhookCronSweep({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(result.candidateCount, 0)
  assert.equal(calls.length, 0)
  assert.equal(stub.outbound[0]!.status, 'pending')
})

// ---------------------------------------------------------------------------
// (C) Admin replay state-machine — AC-7 / AC-8 / D7 / D10
// ---------------------------------------------------------------------------

test('admin replay: dead_letter row spawns new row, drives to delivered, carries SAME idempotency-key (D10)', async () => {
  const dead = makePendingOutboundRow({
    id: 'evt-dead-1',
    status: 'dead_letter',
    attempt_count: 3,
    next_retry_at: null,
    dead_lettered_at: '2020-01-02T00:00:00.000Z',
    last_error: 'exhausted',
    last_http_status: 503,
    idempotency_key: 'prop_test:approved',
  })
  const stub = createStubClient([dead])
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([{ ok: true, status: 200 }])

  const outcome = await driveAdminOutboundReplay(dead.id, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(outcome.kind, 'replayed')
  if (outcome.kind !== 'replayed') return
  assert.equal(outcome.sourceEventId, dead.id)
  assert.notEqual(outcome.newEventId, dead.id)
  assert.equal(outcome.status, 'delivered')

  // Source transitions to `replayed`, pointing at the new row.
  const source = stub.outbound.find((r) => r.id === dead.id)!
  assert.equal(source.status, 'replayed')
  assert.equal(source.replayed_by_event_id, outcome.newEventId)
  assert.ok(source.replayed_at)

  // New row inherits identity keys (D10) and was driven to delivered.
  const fresh = stub.outbound.find((r) => r.id === outcome.newEventId)!
  assert.equal(fresh.status, 'delivered')
  assert.equal(fresh.idempotency_key, 'prop_test:approved')
  assert.equal(fresh.external_proposal_id, 'prop_test')
  assert.equal(fresh.decision, 'approved')

  // Wire-level: the SAME idempotency-key flowed on the replay POST (D10
  // cross-repo dedupe invariant).
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.headers['X-Noon-Idempotency-Key'], 'prop_test:approved')

  // Snapshot updated.
  assert.equal(stub.links[0]!.review_webhook_status, 'sent')
})

test('admin replay: delivered row returns noop without firing fetch (AC-8)', async () => {
  const delivered = makePendingOutboundRow({
    id: 'evt-delivered-1',
    status: 'delivered',
    attempt_count: 1,
    next_retry_at: null,
    delivered_at: '2020-01-02T00:00:00.000Z',
    last_http_status: 200,
    last_error: null,
  })
  const stub = createStubClient([delivered])
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([])

  const outcome = await driveAdminOutboundReplay(delivered.id, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(outcome.kind, 'noop_delivered')
  assert.equal(calls.length, 0)
  // Source row is unchanged.
  assert.equal(stub.outbound.length, 1)
  assert.equal(stub.outbound[0]!.status, 'delivered')
})

test('admin replay: pending row returns conflict_pending (409) without firing fetch (D7)', async () => {
  const pending = makePendingOutboundRow({
    id: 'evt-pending-1',
    status: 'pending',
    next_retry_at: '2999-01-01T00:00:00.000Z',
  })
  const stub = createStubClient([pending])
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([])

  const outcome = await driveAdminOutboundReplay(pending.id, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(outcome.kind, 'conflict_pending')
  assert.equal(calls.length, 0)
  // Source row is unchanged.
  assert.equal(stub.outbound[0]!.status, 'pending')
})

test('admin replay: replayed row returns noop_replayed with replayed_by_event_id (D7)', async () => {
  const replayed = makePendingOutboundRow({
    id: 'evt-replayed-1',
    status: 'replayed',
    next_retry_at: null,
    replayed_at: '2020-01-02T00:00:00.000Z',
    replayed_by_event_id: 'evt-fresh-7',
  })
  const stub = createStubClient([replayed])
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([])

  const outcome = await driveAdminOutboundReplay(replayed.id, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(outcome.kind, 'noop_replayed')
  if (outcome.kind !== 'noop_replayed') return
  assert.equal(outcome.replayedByEventId, 'evt-fresh-7')
  assert.equal(calls.length, 0)
})

test('admin replay: not_found event returns kind:not_found without firing fetch', async () => {
  const stub = createStubClient([])
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([])

  const outcome = await driveAdminOutboundReplay('11111111-1111-1111-1111-111111111111', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(outcome.kind, 'not_found')
  assert.equal(calls.length, 0)
})
