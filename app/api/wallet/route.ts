import { NextResponse } from 'next/server'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { listWalletEntriesQuerySchema } from '@/lib/server/wallet/schema'
import { getVisibleWallet } from '@/lib/server/wallet/service'

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal()
    const url = new URL(request.url)
    const query = listWalletEntriesQuerySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
    })
    const userClient = await createSupabaseServerClient()
    const adminClient = createSupabaseAdminClient()
    const wallet = await getVisibleWallet({ userClient, adminClient }, principal, query.limit)

    return NextResponse.json({
      data: wallet,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
