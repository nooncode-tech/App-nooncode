import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit, RateLimitExceededError } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
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

function applyCacheControl(response: NextResponse, cacheControl: string): NextResponse {
  response.headers.set(CACHE_CONTROL_HEADER, cacheControl)
  return response
}

/**
 * Inbound prototype-signed-read endpoint (NoonWeb → App, GET).
 *
 * Symmetric read entry to the inbound POST handlers (`inbound-proposal`,
 * `payment-confirmed`, `prototype-decision`, `prototype-share`). NoonWeb
 * fetches this at render time from `/maxwell/prototipo/[token]` (Pull
 * pattern B.2 per ADR-023 D8 → ADR-024 discharge).
 *
 * Authoritative references:
 *   - ADR-024 (D1-D7 + Amendments A1) — wire contract, auth, cache, sanitization.
 *   - docs/integrations/cross-repo-webhook-v1.md §6 — wire-level spec.
 *   - specs/fase-3-g22-prototype-signed-read-handler-impl.md — iteration spec.
 *
 * Transport ledger participation: declined-by-design per ADR-024 D1. GET is
 * HTTP-idempotent; no replay-protection state needs tracking.
 *
 * `requestId` injection: every response body includes `requestId` at the top
 * level per cross-repo-webhook-v1.md §6.4 / §8 (fix per ADR-028 Q-piedra-5;
 * 2026-05-26 bilateral smoke exposed the original omission on 404 bodies).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const requestId = getRequestId(request)

  try {
    const { token } = await context.params

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return applyCacheControl(
        jsonWithRequestId(
          { error: 'Missing prototype token.', code: 'INVALID_REQUEST', requestId },
          { status: 400 },
          requestId,
        ),
        NO_STORE,
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
      return applyCacheControl(
        jsonWithRequestId(
          { ...result.body, requestId },
          { status: result.status },
          requestId,
        ),
        result.cacheControl,
      )
    }

    logger.warn(result.log.event, {
      requestId,
      ...result.log.fields,
    })
    return applyCacheControl(
      jsonWithRequestId(
        { ...result.body, requestId },
        { status: result.status },
        requestId,
      ),
      result.cacheControl,
    )
  } catch (error) {
    if (error instanceof WebsiteWebhookError) {
      logger.warn('website.prototype_signed_read.rejected', {
        requestId,
        status: error.status,
        code: 'WEBSITE_WEBHOOK_AUTH_FAILED',
        ...errorToLogContext(error),
      })
      return applyCacheControl(
        jsonWithRequestId(
          { error: error.message, code: 'WEBSITE_WEBHOOK_AUTH_FAILED', requestId },
          { status: error.status },
          requestId,
        ),
        NO_STORE,
      )
    }

    if (error instanceof RateLimitExceededError) {
      logger.warn('website.prototype_signed_read.rate_limited', {
        requestId,
        retryAfterSeconds: error.retryAfterSeconds,
      })
      return applyCacheControl(toErrorResponse(error, { requestId }), NO_STORE)
    }

    logger.error('website.prototype_signed_read.failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return applyCacheControl(toErrorResponse(error, { requestId }), NO_STORE)
  }
}
