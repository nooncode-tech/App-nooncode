import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { toErrorResponse } from '@/lib/server/api/errors'

const postSchema = z.object({
  token: z.string().min(1),
  body: z.string().min(1).max(2000),
})

export async function POST(request: Request) {
  try {
    const { token, body } = postSchema.parse(await request.json())
    const client = await createSupabaseAdminClient()

    // Validate token exists and is not expired
    const { data: tokenRow } = await client
      .from('client_access_tokens')
      .select('id')
      .eq('token', token)
      .or('expires_at.is.null,expires_at.gt.now()')
      .maybeSingle() as { data: { id: string } | null }

    if (!tokenRow) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 })
    }

    const { data: comment, error } = await client
      .from('client_comments' as never)
      .insert({ token_id: tokenRow.id, body } as never)
      .select('id, body, created_at')
      .single() as { data: { id: string; body: string; created_at: string } | null; error: unknown }

    if (error || !comment) throw new Error('Failed to save comment')

    return NextResponse.json({ data: comment }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

    const client = await createSupabaseAdminClient()

    const { data: tokenRow } = await client
      .from('client_access_tokens')
      .select('id')
      .eq('token', token)
      .or('expires_at.is.null,expires_at.gt.now()')
      .maybeSingle() as { data: { id: string } | null }

    if (!tokenRow) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    }

    const { data: comments } = await client
      .from('client_comments' as never)
      .select('id, body, created_at')
      .eq('token_id', tokenRow.id)
      .order('created_at', { ascending: false }) as { data: Array<{ id: string; body: string; created_at: string }> | null }

    return NextResponse.json({ data: comments ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
