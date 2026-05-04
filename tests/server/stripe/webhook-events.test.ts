import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'
import {
  beginStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from '@/lib/server/stripe/webhook-events'

type StripeWebhookClient = Parameters<typeof beginStripeWebhookEvent>[0]

type LedgerRow = {
  event_id: string
  event_type: string
  livemode: boolean
  api_version: string | null
  status: 'processing' | 'processed' | 'failed'
  attempt_count: number
  received_at?: string
  processed_at?: string | null
  failed_at?: string | null
  last_error?: string | null
}

function stripeEvent(overrides: Partial<Stripe.Event> = {}): Stripe.Event {
  return {
    id: 'evt_test_123',
    object: 'event',
    api_version: '2024-06-20',
    created: 1,
    data: { object: {} },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed',
    ...overrides,
  } as Stripe.Event
}

function createFakeClient(initial?: LedgerRow) {
  let row: LedgerRow | null = initial ?? null

  const table = {
    select() {
      return table
    },
    eq() {
      return table
    },
    async maybeSingle() {
      return { data: row, error: null }
    },
    async insert(value: LedgerRow) {
      row = value
      return { error: null }
    },
    update(value: Partial<LedgerRow>) {
      row = { ...(row as LedgerRow), ...value }
      return {
        async eq() {
          return { error: null }
        },
      }
    },
  }

  return {
    client: ({
      from(name: string) {
        assert.equal(name, 'stripe_webhook_events')
        return table
      },
    } as unknown) as StripeWebhookClient,
    get row() {
      return row
    },
  }
}

test('beginStripeWebhookEvent inserts a processing ledger row for new events', async () => {
  const fake = createFakeClient()

  const result = await beginStripeWebhookEvent(fake.client, stripeEvent())

  assert.deepEqual(result, { shouldProcess: true, status: 'processing' })
  assert.equal(fake.row?.event_id, 'evt_test_123')
  assert.equal(fake.row?.attempt_count, 1)
})

test('beginStripeWebhookEvent ignores already processed events', async () => {
  const fake = createFakeClient({
    event_id: 'evt_test_123',
    event_type: 'checkout.session.completed',
    livemode: false,
    api_version: '2024-06-20',
    status: 'processed',
    attempt_count: 1,
  })

  const result = await beginStripeWebhookEvent(fake.client, stripeEvent())

  assert.deepEqual(result, { shouldProcess: false, status: 'processed' })
  assert.equal(fake.row?.attempt_count, 1)
})

test('beginStripeWebhookEvent increments attempts for retried failed events', async () => {
  const fake = createFakeClient({
    event_id: 'evt_test_123',
    event_type: 'checkout.session.completed',
    livemode: false,
    api_version: '2024-06-20',
    status: 'failed',
    attempt_count: 2,
    last_error: 'previous failure',
  })

  const result = await beginStripeWebhookEvent(fake.client, stripeEvent())

  assert.deepEqual(result, { shouldProcess: true, status: 'processing' })
  assert.equal(fake.row?.attempt_count, 3)
  assert.equal(fake.row?.last_error, null)
})

test('Stripe webhook ledger marks processed and failed states', async () => {
  const fake = createFakeClient({
    event_id: 'evt_test_123',
    event_type: 'checkout.session.completed',
    livemode: false,
    api_version: '2024-06-20',
    status: 'processing',
    attempt_count: 1,
  })

  await markStripeWebhookEventProcessed(fake.client, 'evt_test_123')
  assert.equal(fake.row?.status, 'processed')
  assert.equal(fake.row?.last_error, null)

  await markStripeWebhookEventFailed(fake.client, 'evt_test_123', new Error('boom'))
  assert.equal(fake.row?.status, 'failed')
  assert.equal(fake.row?.last_error, 'boom')
})

test('Stripe webhook ledger truncates stored failure messages', async () => {
  const fake = createFakeClient({
    event_id: 'evt_test_123',
    event_type: 'checkout.session.completed',
    livemode: false,
    api_version: '2024-06-20',
    status: 'processing',
    attempt_count: 1,
  })

  await markStripeWebhookEventFailed(fake.client, 'evt_test_123', new Error('x'.repeat(1200)))

  assert.equal(fake.row?.last_error?.length, 1000)
})
