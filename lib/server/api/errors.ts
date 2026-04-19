import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthGuardError } from '@/lib/server/auth/guards'

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

export function toErrorResponse(error: unknown) {
  if (error instanceof AuthGuardError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.status }
    )
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
      },
      { status: error.status }
    )
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: 'Invalid request payload.',
        code: 'INVALID_REQUEST',
        issues: error.flatten(),
      },
      { status: 400 }
    )
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error.'

  return NextResponse.json(
    {
      error: message,
      code: 'INTERNAL_ERROR',
    },
    { status: 500 }
  )
}
