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

export function toErrorResponse(error: unknown, options: ErrorResponseOptions = {}) {
  const headers = buildHeaders(error, options)

  if (error instanceof AuthGuardError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.status, headers }
    )
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.status, headers }
    )
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Invalid request payload.',
        code: 'INVALID_REQUEST',
        issues: error.flatten(),
      },
      { status: 400, headers }
    )
  }

  return NextResponse.json(
    {
      error: 'Unexpected server error.',
      code: 'INTERNAL_ERROR',
    },
    { status: 500, headers }
  )
}
