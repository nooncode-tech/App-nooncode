import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updateLeadSchema } from '@/lib/server/leads/schema'
import { mapLeadRowToWire, mapUpdateLeadInputToUpdate } from '@/lib/server/leads/mappers'
import { deleteLeadById, getLeadById, updateLeadById } from '@/lib/server/leads/repository'
import { assertSalesLeadOwnership } from '@/lib/server/leads/permissions'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { ApiError, toErrorResponse } from '@/lib/server/api/errors'

const routeParamsSchema = z.object({
  leadId: z.string().uuid(),
})

const allowedLeadRoles = ['admin', 'sales_manager', 'sales'] as const

export async function PATCH(
  request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    const principal = await requireRole(allowedLeadRoles)

    const { leadId } = routeParamsSchema.parse(await context.params)
    const payload = updateLeadSchema.parse(await request.json())
    const client = await createSupabaseServerClient()
    const existingLead = await getLeadById(client, leadId)

    if (!existingLead) {
      throw new ApiError('NOT_FOUND', 'Lead not found.', 404)
    }

    assertSalesLeadOwnership(principal, existingLead)
    const lead = await updateLeadById(client, leadId, mapUpdateLeadInputToUpdate(payload))

    return NextResponse.json({
      data: mapLeadRowToWire(lead),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ leadId: string }> }
) {
  try {
    const principal = await requireRole(allowedLeadRoles)

    const { leadId } = routeParamsSchema.parse(await context.params)
    const client = await createSupabaseServerClient()
    const existingLead = await getLeadById(client, leadId)

    if (!existingLead) {
      throw new ApiError('NOT_FOUND', 'Lead not found.', 404)
    }

    assertSalesLeadOwnership(principal, existingLead)
    await deleteLeadById(client, leadId)

    return NextResponse.json(
      {
        ok: true,
      },
      { status: 200 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
