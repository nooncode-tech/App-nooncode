import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { getEarningsSummary, listEarningsHistory, listAllEarningsHistory } from '@/lib/server/earnings/repository'

export async function GET() {
  try {
    const principal = await requirePrincipal()

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
