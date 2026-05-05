import { NextResponse } from 'next/server'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { listNotificationsQuerySchema } from '@/lib/server/notifications/schema'
import { listVisibleNotifications } from '@/lib/server/notifications/service'
import { decodeCursor } from '@/lib/server/pagination/cursor'
import { buildCursorResponse } from '@/lib/server/pagination/envelope'

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal()
    const url = new URL(request.url)
    const query = listNotificationsQuerySchema.parse({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })

    // Malformed cursor decodes to null → first page, never 400
    const cursorPayload = query.cursor ? decodeCursor(query.cursor) : null

    const client = await createSupabaseServerClient()
    const result = await listVisibleNotifications(client, principal, query.limit, cursorPayload)

    const envelope = buildCursorResponse(result.items, {
      limit: query.limit,
      getCursor: (item) => ({ createdAt: item.createdAt, id: item.id }),
    })

    return NextResponse.json({
      data: envelope.data,
      meta: {
        // unreadCount comes from a separate count query — independent of cursor/page
        unreadCount: result.unreadCount,
        limit: envelope.meta.limit,
        nextCursor: envelope.meta.nextCursor,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
