import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import { resolveClientToken } from '@/lib/server/client-portal/repository'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 })
    }

    const client = await createSupabaseServerClient()
    const resolved = await resolveClientToken(client, token)

    if (!resolved) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })
    }

    // Touch last_accessed_at
    await client.rpc('touch_client_token', { p_token: token })

    return NextResponse.json({ data: resolved })
  } catch (err) {
    return toErrorResponse(err)
  }
}
