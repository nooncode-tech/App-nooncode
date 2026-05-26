import assert from 'node:assert/strict'
import test from 'node:test'

import {
  beginOutboundAttempt,
  claimOutboundPendingDue,
  createOutboundWebhookEvent,
  getOutboundWebhookEvent,
  markOutboundDeadLetter,
  markOutboundDelivered,
  recordOutboundSignatureHeader,
  scheduleOutboundRetry,
  spawnOutboundReplay,
  type OutboundWebhookEventInput,
} from '@/lib/server/website/outbound-webhook-events'

// ---------------------------------------------------------------------------
// Fake Supabase client
// ---------------------------------------------------------------------------

type LedgerRow = {
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
  external_proposal_id_dup?: string
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

type FakeClient = Parameters<typeof createOutboundWebhookEvent>[0]

function isoFor(seedMs = 0): string {
  return new Date(1_700_000_000_000 + seedMs).toISOString()
}

function createFakeClient(initialRows: LedgerRow[] = []) {
  const rows: LedgerRow[] = [...initialRows]
  let nextSeq = rows.length + 1

  function outboundTable() {
    return {
      insert(value: Partial<LedgerRow>) {
        const id = `evt-${nextSeq++}`
        const nowIso = isoFor(rows.length)
        const row: LedgerRow = {
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
          replayed_at: value.replayed_at ?? null,
          replayed_by_event_id: value.replayed_by_event_id ?? null,
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
        rows.push(row)
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
        const filters: Array<(r: LedgerRow) => boolean> = []
        let orderField: keyof LedgerRow | null = null
        let orderAsc = true
        let limitN: number | null = null
        const chain = {
          eq(col: keyof LedgerRow, val: unknown) {
            filters.push((r) => (r[col] as unknown) === val)
            return chain
          },
          lte(col: keyof LedgerRow, val: unknown) {
            filters.push((r) => {
              const v = r[col]
              if (v === null || v === undefined) return false
              return (v as unknown as string) <= (val as string)
            })
            return chain
          },
          not(col: keyof LedgerRow, op: string, val: unknown) {
            if (op === 'is' && val === null) {
              filters.push((r) => r[col] !== null)
            }
            return chain
          },
          order(col: keyof LedgerRow, opts: { ascending: boolean }) {
            orderField = col
            orderAsc = opts.ascending
            return chain
          },
          limit(n: number) {
            limitN = n
            return chain
          },
          async single() {
            const found = rows.find((r) => filters.every((fn) => fn(r)))
            if (!found) {
              return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
            }
            return { data: found, error: null }
          },
          async maybeSingle() {
            const found = rows.find((r) => filters.every((fn) => fn(r)))
            return { data: found ?? null, error: null }
          },
          then<T>(
            onFulfilled?: (
              value: { data: LedgerRow[] | null; error: null },
            ) => T | PromiseLike<T>,
          ): Promise<T> {
            let result = rows.filter((r) => filters.every((fn) => fn(r)))
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
      update(value: Partial<LedgerRow>) {
        return {
          async eq(col: keyof LedgerRow, val: unknown) {
            const row = rows.find((r) => (r[col] as unknown) === val)
            if (row) Object.assign(row, value, { updated_at: isoFor(rows.length) })
            return { error: null }
          },
        }
      },
    }
  }

  return {
    client: {
      from(name: string) {
        if (name === 'outbound_webhook_events') return outboundTable()
        throw new Error(`Unexpected table in mock: ${name}`)
      },
    } as unknown as FakeClient,
    rows,
  }
}

function makeInput(
  overrides: Partial<OutboundWebhookEventInput> = {},
): OutboundWebhookEventInput {
  return {
    endpoint: 'proposal-review-decision',
    externalProposalId: 'prop_abc',
    decision: 'approved',
    linkId: 'link-1',
    proposalId: 'proposal-1',
    payloadHash: 'p-hash',
    signatureHeader: null,
    idempotencyKey: 'prop_abc:approved',
    requestId: 'req-1',
    actorId: 'actor-1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('createOutboundWebhookEvent inserts a row with status=pending and attempt_count=0', async () => {
  const fake = createFakeClient()
  const record = await createOutboundWebhookEvent(fake.client, makeInput())
  assert.equal(record.status, 'pending')
  assert.equal(record.attemptCount, 0)
  assert.equal(record.endpoint, 'proposal-review-decision')
  assert.equal(record.externalProposalId, 'prop_abc')
  assert.equal(record.decision, 'approved')
  assert.equal(record.idempotencyKey, 'prop_abc:approved')
  assert.equal(record.maxAttempts, 3)
  assert.equal(fake.rows.length, 1)
})

test('beginOutboundAttempt increments attempt_count and sets last_attempted_at', async () => {
  const fake = createFakeClient()
  const record = await createOutboundWebhookEvent(fake.client, makeInput())
  const { attemptCount } = await beginOutboundAttempt(fake.client, record.eventId, {
    now: '2026-05-26T00:00:00.000Z',
  })
  assert.equal(attemptCount, 1)
  const updated = await getOutboundWebhookEvent(fake.client, record.eventId)
  assert.equal(updated?.attemptCount, 1)
  assert.equal(updated?.lastAttemptedAt, '2026-05-26T00:00:00.000Z')
})

test('markOutboundDelivered transitions row to delivered terminal state', async () => {
  const fake = createFakeClient()
  const record = await createOutboundWebhookEvent(fake.client, makeInput())
  await markOutboundDelivered(fake.client, record.eventId, {
    httpStatus: 200,
    now: '2026-05-26T00:01:00.000Z',
  })
  const updated = await getOutboundWebhookEvent(fake.client, record.eventId)
  assert.equal(updated?.status, 'delivered')
  assert.equal(updated?.deliveredAt, '2026-05-26T00:01:00.000Z')
  assert.equal(updated?.lastHttpStatus, 200)
  assert.equal(updated?.lastError, null)
})

test('scheduleOutboundRetry stores next_retry_at + last_error and keeps status pending', async () => {
  const fake = createFakeClient()
  const record = await createOutboundWebhookEvent(fake.client, makeInput())
  await scheduleOutboundRetry(fake.client, record.eventId, {
    lastError: 'transient 503',
    lastHttpStatus: 503,
    nextRetryAt: '2026-05-26T00:00:02.000Z',
  })
  const updated = await getOutboundWebhookEvent(fake.client, record.eventId)
  assert.equal(updated?.status, 'pending')
  assert.equal(updated?.nextRetryAt, '2026-05-26T00:00:02.000Z')
  assert.equal(updated?.lastError, 'transient 503')
  assert.equal(updated?.lastHttpStatus, 503)
})

test('markOutboundDeadLetter transitions row to dead_letter and clears next_retry_at', async () => {
  const fake = createFakeClient()
  const record = await createOutboundWebhookEvent(fake.client, makeInput())
  await scheduleOutboundRetry(fake.client, record.eventId, {
    lastError: 'first',
    lastHttpStatus: 503,
    nextRetryAt: '2026-05-26T00:00:02.000Z',
  })
  await markOutboundDeadLetter(fake.client, record.eventId, {
    lastError: 'exhausted',
    lastHttpStatus: 503,
    now: '2026-05-26T00:00:14.000Z',
  })
  const updated = await getOutboundWebhookEvent(fake.client, record.eventId)
  assert.equal(updated?.status, 'dead_letter')
  assert.equal(updated?.deadLetteredAt, '2026-05-26T00:00:14.000Z')
  assert.equal(updated?.nextRetryAt, null)
  assert.equal(updated?.lastError, 'exhausted')
})

test('recordOutboundSignatureHeader persists the latest signature on the row', async () => {
  const fake = createFakeClient()
  const record = await createOutboundWebhookEvent(fake.client, makeInput())
  await recordOutboundSignatureHeader(fake.client, record.eventId, 'sha256=abc123')
  const updated = await getOutboundWebhookEvent(fake.client, record.eventId)
  assert.equal(updated?.signatureHeader, 'sha256=abc123')
})

test('spawnOutboundReplay only works from dead_letter and inherits the idempotency_key', async () => {
  const fake = createFakeClient()
  const record = await createOutboundWebhookEvent(fake.client, makeInput())

  await assert.rejects(
    () => spawnOutboundReplay(fake.client, record.eventId),
    /Cannot spawn replay/,
  )

  await markOutboundDeadLetter(fake.client, record.eventId, {
    lastError: 'exhausted',
    lastHttpStatus: 503,
    now: '2026-05-26T00:00:14.000Z',
  })

  const { newEventId, sourceEventId } = await spawnOutboundReplay(
    fake.client,
    record.eventId,
    { now: '2026-05-26T00:05:00.000Z' },
  )
  assert.equal(sourceEventId, record.eventId)
  assert.notEqual(newEventId, record.eventId)

  const source = await getOutboundWebhookEvent(fake.client, record.eventId)
  const spawned = await getOutboundWebhookEvent(fake.client, newEventId)
  assert.equal(source?.status, 'replayed')
  assert.equal(source?.replayedAt, '2026-05-26T00:05:00.000Z')
  assert.equal(source?.replayedByEventId, newEventId)
  assert.equal(spawned?.status, 'pending')
  assert.equal(spawned?.attemptCount, 0)
  // D10 invariant: same key across original + replay row.
  assert.equal(spawned?.idempotencyKey, record.idempotencyKey)
})

test('claimOutboundPendingDue returns due pending rows in ascending order, respecting limit + budget', async () => {
  const fake = createFakeClient()
  const a = await createOutboundWebhookEvent(fake.client, makeInput({ externalProposalId: 'p-a' }))
  const b = await createOutboundWebhookEvent(fake.client, makeInput({ externalProposalId: 'p-b' }))
  const c = await createOutboundWebhookEvent(fake.client, makeInput({ externalProposalId: 'p-c' }))

  // Schedule retries with different next_retry_at — b is oldest-due, c is due, a is due.
  await scheduleOutboundRetry(fake.client, a.eventId, {
    lastError: 'x',
    lastHttpStatus: 503,
    nextRetryAt: '2026-05-26T00:00:10.000Z',
  })
  await scheduleOutboundRetry(fake.client, b.eventId, {
    lastError: 'x',
    lastHttpStatus: 503,
    nextRetryAt: '2026-05-26T00:00:01.000Z',
  })
  await scheduleOutboundRetry(fake.client, c.eventId, {
    lastError: 'x',
    lastHttpStatus: 503,
    nextRetryAt: '2026-05-26T00:00:05.000Z',
  })

  const due = await claimOutboundPendingDue(fake.client, {
    limit: 2,
    now: '2026-05-26T00:00:20.000Z',
  })
  assert.equal(due.length, 2)
  assert.equal(due[0]!.externalProposalId, 'p-b')
  assert.equal(due[1]!.externalProposalId, 'p-c')
})

test('claimOutboundPendingDue skips rows whose attempt_count >= max_attempts', async () => {
  const fake = createFakeClient()
  const a = await createOutboundWebhookEvent(fake.client, makeInput({ externalProposalId: 'p-a' }))
  // Force attempt_count to max_attempts via three begin calls.
  await beginOutboundAttempt(fake.client, a.eventId)
  await beginOutboundAttempt(fake.client, a.eventId)
  await beginOutboundAttempt(fake.client, a.eventId)
  await scheduleOutboundRetry(fake.client, a.eventId, {
    lastError: 'x',
    lastHttpStatus: 503,
    nextRetryAt: '2026-05-26T00:00:01.000Z',
  })

  const due = await claimOutboundPendingDue(fake.client, {
    limit: 10,
    now: '2026-05-26T00:00:20.000Z',
  })
  assert.equal(due.length, 0)
})
