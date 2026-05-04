import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { resolveClientToken } from '@/lib/server/client-portal/repository'

export async function GET(request: Request) {
  const requestId = getRequestId(request)

  try {
    assertRateLimit(request, {
      namespace: 'client-resolve',
      limit: 60,
      windowMs: 60_000,
    })

    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return jsonWithRequestId({ error: 'token is required' }, { status: 400 }, requestId)
    }

    const client = await createSupabaseAdminClient()
    const resolved = await resolveClientToken(client, token)

    if (!resolved) {
      return jsonWithRequestId({ error: 'Invalid or expired token' }, { status: 404 }, requestId)
    }

    // Touch last_accessed_at
    await client.rpc('touch_client_token', { p_token: token })

    return jsonWithRequestId({ data: resolved }, undefined, requestId)
  } catch (err) {
    return toErrorResponse(err, { requestId })
  }
}
