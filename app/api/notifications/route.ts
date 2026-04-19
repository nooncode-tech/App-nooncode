import { NextResponse } from 'next/server'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { listNotificationsQuerySchema } from '@/lib/server/notifications/schema'
import { listVisibleNotifications } from '@/lib/server/notifications/service'

export async function GET(request: Request) {
  try {
    const principal = await requirePrincipal()
    const url = new URL(request.url)
    const query = listNotificationsQuerySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
    })
    const client = await createSupabaseServerClient()
    const result = await listVisibleNotifications(client, principal, query.limit)

    return NextResponse.json({
      data: result.items,
      meta: {
        unreadCount: result.unreadCount,
        limit: query.limit,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
