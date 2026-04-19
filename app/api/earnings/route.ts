import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { getCurrentPrincipal } from '@/lib/server/auth/session'
import { toErrorResponse } from '@/lib/server/api/errors'
import { listEarningsForActor, listAllEarnings, getEarningsSummaryForActor } from '@/lib/server/earnings/repository'

export async function GET() {
  try {
    const principal = await getCurrentPrincipal()

    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const client = await createSupabaseServerClient()
    const isAdmin = principal.role === 'admin' || principal.role === 'pm'

    const [earnings, summary] = await Promise.all([
      isAdmin
        ? listAllEarnings(client)
        : listEarningsForActor(client, principal.userId),
      getEarningsSummaryForActor(client, principal.userId),
    ])

    return NextResponse.json({ data: { earnings, summary } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
