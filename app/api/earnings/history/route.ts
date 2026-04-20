import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getCurrentPrincipal } from '@/lib/server/auth/session'
import { toErrorResponse } from '@/lib/server/api/errors'
import { listEarningsHistory, listAllEarningsHistory } from '@/lib/server/earnings/repository'

export async function GET(request: Request) {
  try {
    const principal = await getCurrentPrincipal()

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)
    const isAdmin = principal.role === 'admin' || principal.role === 'pm'

    const client = await createSupabaseServerClient()

    const history = isAdmin
      ? await listAllEarningsHistory(client, limit)
      : await listEarningsHistory(client, principal.userId, limit)

    return NextResponse.json({ data: history })
  } catch (err) {
    return toErrorResponse(err)
  }
}
