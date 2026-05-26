import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit, RateLimitExceededError } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId } from '@/lib/server/api/request'
import { serveWebsitePrototypeSignedRead } from '@/lib/server/website-integration'
import {
  verifyWebsiteWebhookSignature,
  WebsiteWebhookError,
} from '@/lib/server/website-webhook-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_CONTROL_HEADER = 'Cache-Control'
const NO_STORE = 'no-store'

// Inline IP extraction mirroring `getClientIp` in lib/server/api/rate-limit.ts.
// That helper is not exported (per spec §"Handler implementation" OQ-2
// resolution: replicate inline; keep symmetric to the sibling pattern). If a
// future iteration exports `getClientIp` from `rate-limit.ts`, this duplicate
// should be removed.
function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (
    forwardedFor ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    'unknown'
  )
}

function applyErrorHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId)
  response.headers.set(CACHE_CONTROL_HEADER, NO_STORE)
  return response
}

/**
 * Inbound prototype-signed-read endpoint (NoonWeb → App, GET).
 *
 * Symmetric read entry to the inbound POST handlers (`inbound-proposal`,
 * `payment-confirmed`, `prototype-decision`). NoonWeb fetches this at render
 * time from `/maxwell/prototipo/[token]` (Pull pattern B.2 per ADR-023 D8 →
 * ADR-024 discharge).
 *
 * Authoritative references:
 *   - ADR-024 (D1-D7 + Amendments A1) — wire contract, auth, cache, sanitization.
 *   - docs/integrations/cross-repo-webhook-v1.md §6 — wire-level spec.
 *   - specs/fase-3-g22-prototype-signed-read-handler-impl.md — iteration spec.
 *
 * Transport ledger participation: declined-by-design per ADR-024 D1. GET is
 * HTTP-idempotent; no replay-protection state needs tracking.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request)

  try {
    const { token } = await context.params

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return applyErrorHeaders(
        NextResponse.json(
          { error: 'Missing prototype token.', code: 'INVALID_REQUEST' },
          { status: 400 },
        ),
        requestId,
      )
    }

    // Rate-limit per ADR-024 D6: 60/min, combined key `${token}:${remoteIp}`.
    // Runs BEFORE HMAC verify so an unauthenticated client cannot exhaust HMAC
    // verify cost; per ADR-024 D6 §"Rate-limit-before-HMAC" + sibling convention.
    const remoteIp = getClientIp(request)
    await assertRateLimit(request, {
      namespace: 'prototype-signed-read',
      limit: 60,
      windowMs: 60_000,
      key: `${token}:${remoteIp}`,
    })

    // HMAC verify with zero-body signing input per ADR-024 D1 + cross-repo §2.1.
    // The verifier accepts `bodyText = ''`; signing payload is `${timestamp}.`.
    verifyWebsiteWebhookSignature(request.headers, '')

    const result = await serveWebsitePrototypeSignedRead(token)

    if (result.kind === 'ok') {
      logger.info(result.log.event, {
        requestId,
        ...result.log.fields,
      })
      const response = NextResponse.json(result.body, { status: result.status })
      response.headers.set('x-request-id', requestId)
      response.headers.set(CACHE_CONTROL_HEADER, result.cacheControl)
      return response
    }

    logger.warn(result.log.event, {
      requestId,
      ...result.log.fields,
    })
    const response = NextResponse.json(result.body, { status: result.status })
    response.headers.set('x-request-id', requestId)
    response.headers.set(CACHE_CONTROL_HEADER, result.cacheControl)
    return response
  } catch (error) {
    if (error instanceof WebsiteWebhookError) {
      logger.warn('website.prototype_signed_read.rejected', {
        requestId,
        status: error.status,
        code: 'WEBSITE_WEBHOOK_AUTH_FAILED',
        ...errorToLogContext(error),
      })
      return applyErrorHeaders(
        NextResponse.json(
          { error: error.message, code: 'WEBSITE_WEBHOOK_AUTH_FAILED' },
          { status: error.status },
        ),
        requestId,
      )
    }

    if (error instanceof RateLimitExceededError) {
      logger.warn('website.prototype_signed_read.rate_limited', {
        requestId,
        retryAfterSeconds: error.retryAfterSeconds,
      })
      return applyErrorHeaders(toErrorResponse(error, { requestId }), requestId)
    }

    logger.error('website.prototype_signed_read.failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return applyErrorHeaders(toErrorResponse(error, { requestId }), requestId)
  }
}
