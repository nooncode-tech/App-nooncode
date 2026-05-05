import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'

const postSchema = z.object({
  token: z.string().min(1),
  body: z.string().min(1).max(2000),
})

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    assertRateLimit(request, {
      namespace: 'client-comments-post',
      limit: 20,
      windowMs: 60_000,
    })

    const { token, body } = postSchema.parse(await request.json())
    const client = await createSupabaseAdminClient()

    const { data: tokenRow } = await client
      .from('client_access_tokens')
      .select('id')
      .eq('token', token)
      .or('expires_at.is.null,expires_at.gt.now()')
      .maybeSingle() as { data: { id: string } | null }

    if (!tokenRow) {
      return jsonWithRequestId({ error: 'Token invalido o expirado' }, { status: 401 }, requestId)
    }

    const { data: comment, error } = await client
      .from('client_comments' as never)
      .insert({ token_id: tokenRow.id, body } as never)
      .select('id, body, created_at')
      .single() as { data: { id: string; body: string; created_at: string } | null; error: unknown }

    if (error || !comment) throw new Error('Failed to save comment')

    return jsonWithRequestId({ data: comment }, { status: 201 }, requestId)
  } catch (err) {
    return toErrorResponse(err, { requestId })
  }
}

export async function GET(request: Request) {
  const requestId = getRequestId(request)

  try {
    assertRateLimit(request, {
      namespace: 'client-comments-get',
      limit: 60,
      windowMs: 60_000,
    })

    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    if (!token) return jsonWithRequestId({ error: 'token required' }, { status: 400 }, requestId)

    const client = await createSupabaseAdminClient()

    const { data: tokenRow } = await client
      .from('client_access_tokens')
      .select('id')
      .eq('token', token)
      .or('expires_at.is.null,expires_at.gt.now()')
      .maybeSingle() as { data: { id: string } | null }

    if (!tokenRow) {
      return jsonWithRequestId({ error: 'Token invalido' }, { status: 401 }, requestId)
    }

    const { data: comments } = await client
      .from('client_comments' as never)
      .select('id, body, created_at')
      .eq('token_id', tokenRow.id)
      .order('created_at', { ascending: false }) as { data: Array<{ id: string; body: string; created_at: string }> | null }

    return jsonWithRequestId({ data: comments ?? [] }, undefined, requestId)
  } catch (err) {
    return toErrorResponse(err, { requestId })
  }
}
