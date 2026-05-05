import { NextResponse } from 'next/server'

const REQUEST_ID_HEADER = 'x-request-id'

export function getRequestId(request: Request): string {
  const existing = request.headers.get(REQUEST_ID_HEADER)?.trim()
  if (existing) return existing.slice(0, 128)

  const vercelId = request.headers.get('x-vercel-id')?.trim()
  if (vercelId) return vercelId.slice(0, 128)

  return crypto.randomUUID()
}

export function withRequestId<T extends NextResponse>(response: T, requestId: string): T {
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

export function jsonWithRequestId(
  body: unknown,
  init: ResponseInit | undefined,
  requestId: string
) {
  return withRequestId(NextResponse.json(body, init), requestId)
}
