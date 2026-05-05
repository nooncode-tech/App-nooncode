import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import {
  readSignedWebsiteJson,
  signWebsitePayload,
  verifyWebsiteWebhookSignature,
  WebsiteWebhookError,
} from '@/lib/server/website-webhook-auth'

const previousSecret = process.env.NOON_WEBSITE_WEBHOOK_SECRET

test.after(() => {
  process.env.NOON_WEBSITE_WEBHOOK_SECRET = previousSecret
})

test('website webhook signature verifies signed payloads', () => {
  process.env.NOON_WEBSITE_WEBHOOK_SECRET = 'unit-secret'
  const body = JSON.stringify({ event: 'proposal' })
  const headers = new Headers(signWebsitePayload(body))

  assert.doesNotThrow(() => verifyWebsiteWebhookSignature(headers, body))
})

test('website webhook signature rejects tampered payloads', () => {
  process.env.NOON_WEBSITE_WEBHOOK_SECRET = 'unit-secret'
  const body = JSON.stringify({ event: 'proposal' })
  const headers = new Headers(signWebsitePayload(body))

  assert.throws(
    () => verifyWebsiteWebhookSignature(headers, JSON.stringify({ event: 'changed' })),
    WebsiteWebhookError
  )
})

test('website webhook signature requires the shared secret', () => {
  process.env.NOON_WEBSITE_WEBHOOK_SECRET = ''

  assert.throws(
    () => signWebsitePayload(JSON.stringify({ event: 'proposal' })),
    /Website webhook secret is not configured/
  )
})

test('website webhook signature rejects stale timestamps', () => {
  process.env.NOON_WEBSITE_WEBHOOK_SECRET = 'unit-secret'
  const body = JSON.stringify({ event: 'proposal' })
  const timestamp = '1'
  const signature = crypto
    .createHmac('sha256', 'unit-secret')
    .update(`${timestamp}.${body}`)
    .digest('hex')

  const headers = new Headers({
    'x-noon-timestamp': timestamp,
    'x-noon-signature': `sha256=${signature}`,
  })

  assert.throws(() => verifyWebsiteWebhookSignature(headers, body), /outside the allowed window/)
})

test('readSignedWebsiteJson validates JSON through the supplied schema', async () => {
  process.env.NOON_WEBSITE_WEBHOOK_SECRET = 'unit-secret'
  const body = JSON.stringify({ ok: true })
  const request = new Request('https://app.noon.test/api/integrations/website/inbound-proposal', {
    method: 'POST',
    body,
    headers: signWebsitePayload(body),
  })

  const parsed = await readSignedWebsiteJson(request, z.object({ ok: z.literal(true) }))

  assert.deepEqual(parsed, { ok: true })
})
