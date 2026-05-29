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

const requestBodySchema = z.object({
  // Optional free-text brief the seller adds to steer v0 generation. Capped to
  // keep the eventual v0 prompt bounded; empty/whitespace is treated as absent.
  sellerBrief: z.string().trim().max(2000).optional(),
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
        maxIterationsPerLead: result.maxIterationsPerLead,
        iterationsUsed: result.iterationsUsed,
        iterationsRemaining: result.iterationsRemaining,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    const principal = await requireRole(allowedLeadPrototypeRoles)
    const { leadId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const rawBody = await request.json().catch(() => null)
    const body = rawBody ? requestBodySchema.parse(rawBody) : {}
    const result = await requestVisibleLeadPrototype(
      client,
      principal,
      leadId,
      body.sellerBrief ?? null
    )

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
