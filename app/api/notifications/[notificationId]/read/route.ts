import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePrincipal } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { markVisibleNotificationAsRead } from '@/lib/server/notifications/service'

const routeParamsSchema = z.object({
  notificationId: z.string().uuid(),
})

export async function POST(
  _request: Request,
  context: { params: Promise<{ notificationId: string }> }
) {
  try {
    const principal = await requirePrincipal()
    const { notificationId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const notification = await markVisibleNotificationAsRead(client, principal, notificationId)

    return NextResponse.json({
      data: notification,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
