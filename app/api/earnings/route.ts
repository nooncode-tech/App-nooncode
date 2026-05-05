import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getCurrentPrincipal } from '@/lib/server/auth/session'
import { toErrorResponse } from '@/lib/server/api/errors'
import { getEarningsSummary, listEarningsHistory, listAllEarningsHistory } from '@/lib/server/earnings/repository'

export async function GET() {
  try {
    const principal = await getCurrentPrincipal()

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const client = await createSupabaseServerClient()
    const isAdmin = principal.role === 'admin' || principal.role === 'pm'

    const [summary, history] = await Promise.all([
      getEarningsSummary(client, principal.userId),
      isAdmin
        ? listAllEarningsHistory(client)
        : listEarningsHistory(client, principal.userId),
    ])

    return NextResponse.json({ data: { summary, history } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
