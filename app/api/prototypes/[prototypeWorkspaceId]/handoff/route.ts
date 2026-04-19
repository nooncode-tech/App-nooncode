import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { prototypeWorkspaceRouteParamsSchema } from '@/lib/server/prototypes/schema'
import { handoffVisiblePrototypeWorkspaceToDelivery } from '@/lib/server/prototypes/service'

const allowedPrototypeHandoffRoles = ['admin', 'pm'] as const

export async function POST(
  _request: Request,
  context: { params: Promise<{ prototypeWorkspaceId: string }> }
) {
  try {
    const principal = await requireRole(allowedPrototypeHandoffRoles)
    const { prototypeWorkspaceId } = prototypeWorkspaceRouteParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const prototype = await handoffVisiblePrototypeWorkspaceToDelivery(
      client,
      principal,
      prototypeWorkspaceId
    )

    return NextResponse.json({
      data: prototype,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
