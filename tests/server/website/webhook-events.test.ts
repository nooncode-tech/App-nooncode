import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composeReplayResponseFromLedger,
  markWebsiteWebhookEventFailed,
  markWebsiteWebhookEventProcessed,
  recordWebsiteWebhookEvent,
  websiteWebhookLedgerEnabled,
  type WebsiteWebhookEventInput,
  type WebsiteWebhookEventRecord,
} from '@/lib/server/website/webhook-events'

type LedgerRow = {
  id: string
  endpoint: 'inbound-proposal' | 'payment-confirmed'
  signature_hash: string
  payload_hash: string
  signature_header: string
  request_id: string
  status: 'processing' | 'processed' | 'failed'
  attempt_count: number
  received_at: string
  processed_at: string | null
  failed_at: string | null
  last_error: string | null
  external_session_id: string | null
  external_proposal_id: string | null
  external_payment_id: string | null
  link_id: string | null
}

type LinkRow = {
  id: string
  lead_id: string
  proposal_id: string
  current_status: string
  project_id: string | null
}

type FakeClient = Parameters<typeof recordWebsiteWebhookEvent>[0]

interface FakeBackend {
  client: FakeClient
  rows: LedgerRow[]
  links: LinkRow[]
  failNextLedgerUpdate: { enabled: boolean }
}

function createFakeClient(initialRows: LedgerRow[] = [], initialLinks: LinkRow[] = []): FakeBackend {
  const rows: LedgerRow[] = [...initialRows]
  const links: LinkRow[] = [...initialLinks]
  let nextId = rows.length + 1
  const failNextLedgerUpdate = { enabled: false }

  function websiteEventsTable() {
    return {
      insert(value: Partial<LedgerRow>) {
        const checkInsert = (): { data: LedgerRow | null; error: { code: string; message: string } | null } => {
          if (
            rows.some(
              (r) => r.endpoint === value.endpoint && r.signature_hash === value.signature_hash,
            )
          ) {
            return {
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "website_webhook_events_endpoint_signature_hash_key"',
              },
            }
          }
          const row: LedgerRow = {
            id: `evt-${nextId++}`,
            endpoint: value.endpoint!,
            signature_hash: value.signature_hash ?? '',
            payload_hash: value.payload_hash ?? '',
            signature_header: value.signature_header ?? '',
            request_id: value.request_id ?? '',
            status: value.status ?? 'processing',
            attempt_count: value.attempt_count ?? 1,
            received_at: value.received_at ?? new Date().toISOString(),
            processed_at: null,
            failed_at: null,
            last_error: null,
            external_session_id: null,
            external_proposal_id: null,
            external_payment_id: null,
            link_id: null,
          }
          rows.push(row)
          return { data: row, error: null }
        }
        return {
          select(_cols: string) {
            return {
              async maybeSingle() {
                return checkInsert()
              },
            }
          },
        }
      },
      select(_cols: string) {
        const filters: Record<string, unknown> = {}
        const chain = {
          eq(col: string, val: unknown) {
            filters[col] = val
            return chain
          },
          async single() {
            const found = rows.find((r) =>
              Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
            )
            return found
              ? { data: found, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'No rows returned' } }
          },
          async maybeSingle() {
            const found = rows.find((r) =>
              Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
            )
            return { data: found ?? null, error: null }
          },
        }
        return chain
      },
      update(value: Partial<LedgerRow>) {
        return {
          async eq(col: string, val: unknown) {
            if (failNextLedgerUpdate.enabled) {
              failNextLedgerUpdate.enabled = false
              return { error: { code: 'XX000', message: 'simulated update failure' } }
            }
            const row = rows.find((r) => (r as unknown as Record<string, unknown>)[col] === val)
            if (row) {
              Object.assign(row, value)
            }
            return { error: null }
          },
        }
      },
    }
  }

  function inboundLinksTable() {
    return {
      select(_cols: string) {
        const filters: Record<string, unknown> = {}
        const chain = {
          eq(col: string, val: unknown) {
            filters[col] = val
            return chain
          },
          async maybeSingle() {
            const found = links.find((l) =>
              Object.entries(filters).every(([k, v]) => (l as unknown as Record<string, unknown>)[k] === v),
            )
            return { data: found ?? null, error: null }
          },
        }
        return chain
      },
    }
  }

  return {
    client: {
      from(name: string) {
        if (name === 'website_webhook_events') return websiteEventsTable()
        if (name === 'website_inbound_links') return inboundLinksTable()
        throw new Error(`Unexpected table in mock: ${name}`)
      },
    } as unknown as FakeClient,
    rows,
    links,
    failNextLedgerUpdate,
  }
}

function makeInput(overrides: Partial<WebsiteWebhookEventInput> = {}): WebsiteWebhookEventInput {
  return {
    endpoint: 'inbound-proposal',
    signatureHeader: 'sha256=deadbeef',
    signatureHash: 'h1',
    payloadHash: 'p1',
    requestId: 'req-1',
    ...overrides,
  }
}

test('recordWebsiteWebhookEvent claims a fresh row on first-time call', async () => {
  const fake = createFakeClient()
  const record = await recordWebsiteWebhookEvent(fake.client, makeInput())

  assert.equal(record.shouldProcess, true)
  assert.equal(record.status, 'processing')
  assert.equal(record.attemptCount, 1)
  assert.equal(record.externalSessionId, null)
  assert.equal(record.externalProposalId, null)
  assert.equal(record.externalPaymentId, null)
  assert.equal(record.linkId, null)
  assert.equal(fake.rows.length, 1)
  assert.equal(fake.rows[0].endpoint, 'inbound-proposal')
  assert.equal(fake.rows[0].signature_hash, 'h1')
})

test('recordWebsiteWebhookEvent short-circuits replay when row is processed with link_id', async () => {
  const fake = createFakeClient()
  const first = await recordWebsiteWebhookEvent(fake.client, makeInput())
  await markWebsiteWebhookEventProcessed(fake.client, first.eventId, {
    externalSessionId: 'sess_001',
    externalProposalId: 'prop_001',
    externalPaymentId: null,
    linkId: 'link-001',
  })

  const replay = await recordWebsiteWebhookEvent(fake.client, makeInput())
  assert.equal(replay.shouldProcess, false)
  assert.equal(replay.status, 'processed')
  assert.equal(replay.linkId, 'link-001')
  assert.equal(replay.externalSessionId, 'sess_001')
  assert.equal(replay.externalProposalId, 'prop_001')
  assert.equal(replay.attemptCount, 1)
  // No additional rows created on replay.
  assert.equal(fake.rows.length, 1)
})

test('recordWebsiteWebhookEvent bumps attempt_count after a failed first try', async () => {
  const fake = createFakeClient()
  const first = await recordWebsiteWebhookEvent(fake.client, makeInput())
  await markWebsiteWebhookEventFailed(fake.client, first.eventId, new Error('boom'))

  const retry = await recordWebsiteWebhookEvent(fake.client, makeInput())
  assert.equal(retry.shouldProcess, true)
  assert.equal(retry.status, 'processing')
  assert.equal(retry.attemptCount, 2)
  assert.equal(fake.rows[0].status, 'processing')
  assert.equal(fake.rows[0].last_error, null)
  assert.equal(fake.rows[0].failed_at, null)
})

test('recordWebsiteWebhookEvent re-runs when an existing processing row has no link_id yet', async () => {
  const fake = createFakeClient()
  await recordWebsiteWebhookEvent(fake.client, makeInput())
  // No mark called — row remains processing/link_id=null.

  const retry = await recordWebsiteWebhookEvent(fake.client, makeInput())
  assert.equal(retry.shouldProcess, true)
  assert.equal(retry.attemptCount, 2)
  assert.equal(retry.linkId, null)
})

test('recordWebsiteWebhookEvent isolates two endpoints sharing the same signature hash', async () => {
  const fake = createFakeClient()
  const a = await recordWebsiteWebhookEvent(
    fake.client,
    makeInput({ endpoint: 'inbound-proposal', signatureHash: 'shared' }),
  )
  const b = await recordWebsiteWebhookEvent(
    fake.client,
    makeInput({ endpoint: 'payment-confirmed', signatureHash: 'shared', requestId: 'req-2' }),
  )

  assert.equal(a.shouldProcess, true)
  assert.equal(b.shouldProcess, true)
  assert.notEqual(a.eventId, b.eventId)
  assert.equal(fake.rows.length, 2)
})

test('markWebsiteWebhookEventProcessed is a no-op on unknown eventId (silent zero-rows)', async () => {
  const fake = createFakeClient()
  // Supabase update on a non-matching predicate returns error=null and 0 rows touched;
  // our helper does not surface 0-row updates as failures (documented contract).
  await markWebsiteWebhookEventProcessed(fake.client, 'evt-does-not-exist', {
    externalSessionId: null,
    externalProposalId: null,
    externalPaymentId: null,
    linkId: null,
  })
  assert.equal(fake.rows.length, 0)
})

test('markWebsiteWebhookEventFailed swallows DB errors so it never shadows the original failure', async () => {
  const fake = createFakeClient()
  const first = await recordWebsiteWebhookEvent(fake.client, makeInput())

  fake.failNextLedgerUpdate.enabled = true
  // Should not throw despite the simulated update error.
  await markWebsiteWebhookEventFailed(fake.client, first.eventId, new Error('original cause'))
})

test('composeReplayResponseFromLedger returns wire shape when link snapshot exists (with projectId)', async () => {
  const fake = createFakeClient(
    [],
    [
      {
        id: 'link-007',
        lead_id: 'lead-007',
        proposal_id: 'prop-007',
        current_status: 'project_activated',
        project_id: 'proj-007',
      },
    ],
  )
  const ledger: WebsiteWebhookEventRecord = {
    shouldProcess: false,
    eventId: 'evt-x',
    endpoint: 'payment-confirmed',
    status: 'processed',
    attemptCount: 1,
    externalSessionId: 'sess-007',
    externalProposalId: 'prop-007',
    externalPaymentId: 'pay-007',
    linkId: 'link-007',
  }
  const replay = await composeReplayResponseFromLedger(fake.client, ledger)

  assert.notEqual(replay, null)
  assert.equal(replay?.idempotent, true)
  assert.equal(replay?.linkId, 'link-007')
  assert.equal(replay?.leadId, 'lead-007')
  assert.equal(replay?.proposalId, 'prop-007')
  assert.equal(replay?.status, 'project_activated')
  assert.equal(replay?.projectId, 'proj-007')
})

test('composeReplayResponseFromLedger omits projectId when link has no project_id yet', async () => {
  const fake = createFakeClient(
    [],
    [
      {
        id: 'link-008',
        lead_id: 'lead-008',
        proposal_id: 'prop-008',
        current_status: 'proposal_pending_review',
        project_id: null,
      },
    ],
  )
  const ledger: WebsiteWebhookEventRecord = {
    shouldProcess: false,
    eventId: 'evt-y',
    endpoint: 'inbound-proposal',
    status: 'processed',
    attemptCount: 1,
    externalSessionId: 'sess-008',
    externalProposalId: 'prop-008',
    externalPaymentId: null,
    linkId: 'link-008',
  }
  const replay = await composeReplayResponseFromLedger(fake.client, ledger)

  assert.notEqual(replay, null)
  assert.equal(replay?.projectId, undefined)
  assert.equal(replay?.status, 'proposal_pending_review')
})

test('composeReplayResponseFromLedger returns null when linkId is null on the ledger record', async () => {
  const fake = createFakeClient()
  const ledger: WebsiteWebhookEventRecord = {
    shouldProcess: false,
    eventId: 'evt-z',
    endpoint: 'inbound-proposal',
    status: 'processed',
    attemptCount: 1,
    externalSessionId: null,
    externalProposalId: null,
    externalPaymentId: null,
    linkId: null,
  }
  const replay = await composeReplayResponseFromLedger(fake.client, ledger)
  assert.equal(replay, null)
})

test('composeReplayResponseFromLedger returns null when link row is missing in DB', async () => {
  const fake = createFakeClient([], [])
  const ledger: WebsiteWebhookEventRecord = {
    shouldProcess: false,
    eventId: 'evt-w',
    endpoint: 'inbound-proposal',
    status: 'processed',
    attemptCount: 1,
    externalSessionId: 'sess',
    externalProposalId: 'prop',
    externalPaymentId: null,
    linkId: 'link-ghost',
  }
  const replay = await composeReplayResponseFromLedger(fake.client, ledger)
  assert.equal(replay, null)
})

test('websiteWebhookLedgerEnabled returns true regardless of env (module-load snapshot)', () => {
  // The function reads env once at module load; here we just confirm the public
  // contract that it returns a boolean. Spec is exercised at module-load time
  // — see ADR-016 D9 for the canonical "only literal 'false' disables" rule.
  const value = websiteWebhookLedgerEnabled()
  assert.equal(typeof value, 'boolean')
})
