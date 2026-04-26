import crypto from 'node:crypto'

import { z, ZodError, type ZodTypeAny } from 'zod'

const SIGNATURE_HEADER = 'x-noon-signature'
const TIMESTAMP_HEADER = 'x-noon-timestamp'
const MAX_CLOCK_SKEW_SECONDS = 5 * 60

export class WebsiteWebhookError extends Error {
  constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message)
  }
}

function readSharedSecret() {
  const secret = process.env.NOON_WEBSITE_WEBHOOK_SECRET?.trim()
  if (!secret) {
    throw new WebsiteWebhookError('Website webhook secret is not configured.', 503)
  }
  return secret
}

function normalizeSignature(signature: string) {
  return signature.trim().replace(/^sha256=/i, '')
}

function assertRecentTimestamp(timestamp: string | null) {
  if (!timestamp) return

  const parsed = Number(timestamp)
  if (!Number.isFinite(parsed)) {
    throw new WebsiteWebhookError('Invalid webhook timestamp.')
  }

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parsed) > MAX_CLOCK_SKEW_SECONDS) {
    throw new WebsiteWebhookError('Webhook timestamp is outside the allowed window.')
  }
}

function timingSafeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function verifyWebsiteWebhookSignature(headers: Headers, bodyText: string) {
  const signature = headers.get(SIGNATURE_HEADER)
  const timestamp = headers.get(TIMESTAMP_HEADER)

  if (!signature) {
    throw new WebsiteWebhookError('Missing webhook signature.')
  }

  assertRecentTimestamp(timestamp)

  const signedPayload = timestamp ? `${timestamp}.${bodyText}` : bodyText
  const expected = crypto.createHmac('sha256', readSharedSecret()).update(signedPayload).digest('hex')

  if (!timingSafeEquals(normalizeSignature(signature), expected)) {
    throw new WebsiteWebhookError('Invalid webhook signature.')
  }
}

export async function readSignedWebsiteJson<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  const bodyText = await request.text()
  verifyWebsiteWebhookSignature(request.headers, bodyText)

  try {
    return schema.parse(JSON.parse(bodyText))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new WebsiteWebhookError('Invalid JSON payload.', 400)
    }
    if (error instanceof ZodError) {
      throw new WebsiteWebhookError(error.issues[0]?.message ?? 'Invalid payload.', 400)
    }
    throw error
  }
}

export function getProposalReviewDecisionWebhookUrl() {
  return process.env.NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL?.trim() ?? ''
}

export function signWebsitePayload(bodyText: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = crypto
    .createHmac('sha256', readSharedSecret())
    .update(`${timestamp}.${bodyText}`)
    .digest('hex')

  return {
    'content-type': 'application/json',
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `sha256=${signature}`,
  }
}
