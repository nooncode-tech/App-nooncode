import { NextResponse } from 'next/server'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { markAllVisibleNotificationsAsRead } from '@/lib/server/notifications/service'

export async function POST() {
  try {
    const principal = await requirePrincipal()
    const client = await createSupabaseServerClient()
    const result = await markAllVisibleNotificationsAsRead(client, principal)

    return NextResponse.json({
      data: {
        markedCount: result.markedCount,
        unreadCount: result.unreadCount,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
