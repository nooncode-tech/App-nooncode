import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import {
  getVisibleLeadPrototypeState,
  requestVisibleLeadPrototype,
} from '@/lib/server/prototypes/service'

const routeParamsSchema = z.object({
  leadId: z.string().uuid(),
})

const allowedLeadPrototypeRoles = ['admin', 'sales_manager', 'sales'] as const

export async function GET(
  _request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    const principal = await requireRole(allowedLeadPrototypeRoles)
    const { leadId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const result = await getVisibleLeadPrototypeState(client, principal, leadId)

    return NextResponse.json({
      data: result.prototype,
      meta: {
        prototypeRequestCost: result.prototypeRequestCost,
        prototypeRequestsEnabled: result.prototypeRequestsEnabled,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    const principal = await requireRole(allowedLeadPrototypeRoles)
    const { leadId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const result = await requestVisibleLeadPrototype(client, principal, leadId)

    return NextResponse.json(
      {
        data: result,
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
