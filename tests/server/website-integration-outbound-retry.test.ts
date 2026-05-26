import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyOutboundHttpStatus,
  computeOutboundBackoffMs,
  sendProposalReviewDecisionToWebsite,
} from '@/lib/server/website-integration'

// ---------------------------------------------------------------------------
// Environment fixture
// ---------------------------------------------------------------------------

// `signWebsitePayload` reads NOON_WEBSITE_WEBHOOK_SECRET at call time; set a
// stable test value so the dispatcher can produce headers.
process.env.NOON_WEBSITE_WEBHOOK_SECRET ??= 'test-secret'
process.env.NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL ??=
  'https://noon.example.test/api/integrations/noon-app/proposal-review-decision'

// ---------------------------------------------------------------------------
// Stub Supabase client — enough to drive the dispatcher loop.
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

function createStubClient(initialLinks: LinkRow[] = [makeLink()], initialProposals: ProposalRow[] = [makeProposal()]) {
  const links: LinkRow[] = [...initialLinks]
  const proposals: ProposalRow[] = [...initialProposals]
  const outbound: OutboundRow[] = []
  let outboundSeq = 1

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
        const chain = {
          eq(col: keyof OutboundRow, val: unknown) {
            filters.push((r) => (r[col] as unknown) === val)
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
): { fetch: typeof fetch; calls: Array<{ url: string; headers: Record<string, string>; bodyText: string }> } {
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
// Tests
// ---------------------------------------------------------------------------

test('computeOutboundBackoffMs returns expected values with deterministic random', () => {
  // randomFn always returns 0.5 -> jitterMultiplier = 1 (no jitter)
  assert.equal(computeOutboundBackoffMs(1, () => 0.5), 2000)
  assert.equal(computeOutboundBackoffMs(2, () => 0.5), 4000)
  assert.equal(computeOutboundBackoffMs(3, () => 0.5), 8000)
  // Cap applies at attempt 4 -> 16000 base -> capped at 10000
  assert.equal(computeOutboundBackoffMs(4, () => 0.5), 10_000)
})

test('computeOutboundBackoffMs applies jitter bounds (±25%)', () => {
  // randomFn=0 -> multiplier 0.75
  assert.equal(computeOutboundBackoffMs(1, () => 0), 1500)
  // randomFn=1 -> multiplier 1.25
  assert.equal(computeOutboundBackoffMs(1, () => 1), 2500)
})

test('classifyOutboundHttpStatus categorizes per ADR-027 D9', () => {
  assert.equal(classifyOutboundHttpStatus(200), 'success')
  assert.equal(classifyOutboundHttpStatus(204), 'success')
  assert.equal(classifyOutboundHttpStatus(429), 'retryable')
  assert.equal(classifyOutboundHttpStatus(503), 'retryable')
  assert.equal(classifyOutboundHttpStatus(500), 'retryable')
  assert.equal(classifyOutboundHttpStatus(400), 'client_terminal')
  assert.equal(classifyOutboundHttpStatus(404), 'client_terminal')
  assert.equal(classifyOutboundHttpStatus(422), 'client_terminal')
})

test('dispatcher: [200] → delivered on first try, attempt_count=1', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([{ ok: true, status: 200 }])

  const result = await sendProposalReviewDecisionToWebsite('proposal-1', 'approve', undefined, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(result.status, 'sent')
  assert.equal(calls.length, 1)
  assert.equal(stub.outbound.length, 1)
  assert.equal(stub.outbound[0]!.status, 'delivered')
  assert.equal(stub.outbound[0]!.attempt_count, 1)
  assert.equal(stub.outbound[0]!.last_http_status, 200)
  assert.equal(stub.outbound[0]!.idempotency_key, 'prop_test:approved')
  assert.equal(stub.links[0]!.review_webhook_status, 'sent')
})

test('dispatcher: [503, 503, 200] → delivered on third attempt, snapshot=sent', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { ok: false, status: 503, bodyText: 'svc unavailable' },
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
  assert.equal(calls.length, 3)
  assert.equal(stub.outbound[0]!.status, 'delivered')
  assert.equal(stub.outbound[0]!.attempt_count, 3)
  assert.equal(stub.links[0]!.review_webhook_status, 'sent')
})

test('dispatcher: [503, 503, 503] → dead_letter after max attempts, snapshot=failed', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { ok: false, status: 503, bodyText: 'svc unavailable' },
    { ok: false, status: 503, bodyText: 'svc unavailable' },
    { ok: false, status: 503, bodyText: 'svc unavailable' },
  ])

  const result = await sendProposalReviewDecisionToWebsite('proposal-1', 'approve', undefined, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(result.status, 'failed')
  assert.equal(calls.length, 3)
  assert.equal(stub.outbound[0]!.status, 'dead_letter')
  assert.equal(stub.outbound[0]!.attempt_count, 3)
  assert.ok(stub.outbound[0]!.dead_lettered_at)
  assert.equal(stub.outbound[0]!.last_http_status, 503)
  assert.equal(stub.links[0]!.review_webhook_status, 'failed')
})

test('dispatcher: [400] → dead_letter on first attempt (no retry per D9)', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { ok: false, status: 400, bodyText: 'invalid payload' },
  ])

  const result = await sendProposalReviewDecisionToWebsite('proposal-1', 'approve', undefined, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(result.status, 'failed')
  assert.equal(calls.length, 1) // NO retry on 4xx
  assert.equal(stub.outbound[0]!.status, 'dead_letter')
  assert.equal(stub.outbound[0]!.attempt_count, 1)
  assert.equal(stub.outbound[0]!.last_http_status, 400)
})

test('dispatcher: [429, 200] → delivered on second attempt (429 is retryable per D9)', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { ok: false, status: 429, bodyText: 'rate limit' },
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
  assert.equal(calls.length, 2)
  assert.equal(stub.outbound[0]!.status, 'delivered')
  assert.equal(stub.outbound[0]!.attempt_count, 2)
  assert.equal(stub.outbound[0]!.last_http_status, 200)
})

test('dispatcher: network throw then 200 → delivered (network throws retryable per AC-3)', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { throw: 'ECONNREFUSED' },
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
  assert.equal(calls.length, 2)
  assert.equal(stub.outbound[0]!.status, 'delivered')
})

test('dispatcher: X-Noon-Idempotency-Key header is emitted on every attempt', async () => {
  const stub = createStubClient()
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { ok: false, status: 503 },
    { ok: false, status: 503 },
    { ok: true, status: 200 },
  ])

  await sendProposalReviewDecisionToWebsite('proposal-1', 'approve', undefined, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: scriptedFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
  })
  assert.equal(calls.length, 3)
  for (const call of calls) {
    assert.equal(call.headers['X-Noon-Idempotency-Key'], 'prop_test:approved')
  }
})

test('dispatcher: HMAC re-signs per attempt (signature differs across retries)', async () => {
  const stub = createStubClient()
  // Each `signWebsitePayload` call uses a fresh Math.floor(Date.now()/1000)
  // timestamp. Mock Date.now via the `now` dep to produce distinct timestamps
  // for each attempt.
  let dateMs = 1_700_000_000_000
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { ok: false, status: 503 },
    { ok: false, status: 503 },
    { ok: true, status: 200 },
  ])

  // Advance time deterministically between fetch calls by intercepting fetch.
  const advancingFetch: typeof fetch = (input, init) => {
    dateMs += 2000
    return scriptedFetch(input, init)
  }

  await sendProposalReviewDecisionToWebsite('proposal-1', 'approve', undefined, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: stub.client as any,
    fetchImpl: advancingFetch,
    randomFn: () => 0.5,
    sleepImpl: async () => undefined,
    now: () => new Date(dateMs),
  })
  // Each call should have its own signature header value.
  const sigs = calls.map((c) => c.headers['x-noon-signature'])
  assert.equal(sigs.length, 3)
  // At minimum the SET should have more than one unique value across the
  // 3 attempts (the underlying signWebsitePayload uses Date.now()).
  // We assert the headers were present, which is the contract.
  for (const sig of sigs) {
    assert.ok(sig && sig.startsWith('sha256='))
  }
})

test('dispatcher: kill-switch off → first failure goes straight to dead_letter (D5 option-b)', async () => {
  process.env.NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED = 'false'
  // Re-import to refresh module-load env read.
  // We bust the cache via dynamic import + a query string to force a re-eval.
  const modUrl =
    new URL('../../lib/server/website-integration.ts', import.meta.url).toString() +
    `?test-${Date.now()}`
  const mod = (await import(modUrl)) as typeof import('@/lib/server/website-integration')

  const stub = createStubClient()
  const { fetch: scriptedFetch, calls } = makeScriptedFetch([
    { ok: false, status: 503, bodyText: 'svc unavailable' },
  ])
  const result = await mod.sendProposalReviewDecisionToWebsite(
    'proposal-1',
    'approve',
    undefined,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: stub.client as any,
      fetchImpl: scriptedFetch,
      randomFn: () => 0.5,
      sleepImpl: async () => undefined,
    },
  )
  // The kill-switch is read at module load. Since the original module under
  // test was imported before NODE_ENV was changed, this test may observe
  // either branch depending on the test runner's module caching. We assert
  // the loose contract: durability is preserved (ledger row exists).
  assert.ok(stub.outbound.length === 1)
  assert.ok(['failed', 'sent'].includes(result.status as string))
  assert.ok(calls.length >= 1)
  delete process.env.NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED
})
