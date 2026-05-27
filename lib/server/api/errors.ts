import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthGuardError } from '@/lib/server/auth/guards'
type ErrorResponseOptions = {
  requestId?: string
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class NotFoundApiError extends ApiError {
  constructor(message: string, code = 'NOT_FOUND') {
    super(code, message, 404)
    this.name = 'NotFoundApiError'
  }
}

export class ConflictApiError extends ApiError {
  constructor(message: string, code = 'CONFLICT') {
    super(code, message, 409)
    this.name = 'ConflictApiError'
  }
}

function buildHeaders(error: unknown, options: ErrorResponseOptions) {
  const headers = new Headers()
  if (options.requestId) {
    headers.set('x-request-id', options.requestId)
  }

  const retryAfterSeconds =
    typeof error === 'object' &&
    error !== null &&
    'retryAfterSeconds' in error &&
    typeof error.retryAfterSeconds === 'number'
      ? error.retryAfterSeconds
      : null

  if (retryAfterSeconds !== null) {
    headers.set('retry-after', String(retryAfterSeconds))
  }

  return headers
}

// Cross-repo-webhook-v1.md §8 specifies `{ error, code, requestId }` as the
// canonical error body shape. Per ADR-028 Q-piedra-5 (2026-05-26 smoke
// finding), `requestId` MUST be present in the response body — not only in
// the `x-request-id` header. This helper injects it consistently when the
// caller supplied `options.requestId`. Callers that omit `requestId` keep
// the prior behavior (no body-level field) for backward compatibility.
function withRequestIdField<T extends Record<string, unknown>>(
  body: T,
  options: ErrorResponseOptions,
): T & { requestId?: string } {
  if (!options.requestId) return body
  return { ...body, requestId: options.requestId }
}

export function toErrorResponse(error: unknown, options: ErrorResponseOptions = {}) {
  const headers = buildHeaders(error, options)

  if (error instanceof AuthGuardError) {
    return NextResponse.json(
      withRequestIdField({ error: error.message, code: error.code }, options),
      { status: error.status, headers }
    )
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      withRequestIdField({ error: error.message, code: error.code }, options),
      { status: error.status, headers }
    )
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      withRequestIdField(
        {
          error: 'Invalid request payload.',
          code: 'INVALID_REQUEST',
          issues: error.flatten(),
        },
        options,
      ),
      { status: 400, headers }
    )
  }

  return NextResponse.json(
    withRequestIdField(
      { error: 'Unexpected server error.', code: 'INTERNAL_ERROR' },
      options,
    ),
    { status: 500, headers }
  )
}
