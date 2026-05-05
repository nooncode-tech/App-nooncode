import { NextResponse } from 'next/server'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { listUpdatesQuerySchema } from '@/lib/server/updates/schema'
import { listVisibleUpdates } from '@/lib/server/updates/service'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal()
    const url = new URL(request.url)
    const query = listUpdatesQuerySchema.parse({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })

    // Malformed cursor decodes to null → first page, never 400
    const cursorPayload = query.cursor ? decodeCursor(query.cursor) : null

    const client = await createSupabaseServerClient()
    const result = await listVisibleUpdates(client, principal, query.limit, cursorPayload)

    const envelope = buildCursorResponse(result.items, {
      limit: query.limit,
      getCursor: (item) => ({ createdAt: item.createdAt, id: item.id }),
    })

    return NextResponse.json({
      data: envelope.data,
      meta: {
        // domains comes from visibility set (role-based) — independent of page slice
        domains: result.domains,
        limit: envelope.meta.limit,
        nextCursor: envelope.meta.nextCursor,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
