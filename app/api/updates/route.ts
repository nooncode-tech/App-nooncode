import { NextResponse } from 'next/server'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { listUpdatesQuerySchema } from '@/lib/server/updates/schema'
import { listVisibleUpdates } from '@/lib/server/updates/service'

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal()
    const url = new URL(request.url)
    const query = listUpdatesQuerySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
    })
    const client = await createSupabaseServerClient()
    const result = await listVisibleUpdates(client, principal, query.limit)

    return NextResponse.json({
      data: result.items,
      meta: {
        limit: query.limit,
        domains: result.domains,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
