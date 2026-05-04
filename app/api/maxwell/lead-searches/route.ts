import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { requireRole } from '@/lib/server/auth/guards'
import { ApiError, toErrorResponse } from '@/lib/server/api/errors'
import { mapLeadRowToWire } from '@/lib/server/leads/mappers'
import {
  maxwellLeadSearchRequestSchema,
  runMaxwellLeadSearch,
} from '@/lib/server/maxwell/lead-engine'

const allowedRoles = ['admin', 'sales_manager', 'sales', 'pm'] as const

export const maxDuration = 90

export async function POST(request: Request) {
  try {
    const principal = await requireRole(allowedRoles)
    const parsed = maxwellLeadSearchRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw new ApiError('INVALID_MAXWELL_SEARCH_REQUEST', 'Invalid Maxwell search request.', 422)
    }
    const payload = parsed.data
    const serverClient = await createSupabaseServerClient()
    const adminClient = await createSupabaseAdminClient()

    const result = await runMaxwellLeadSearch({
      request: payload,
      principal,
      serverClient,
      adminClient,
      acceptLanguage: request.headers.get('accept-language'),
    })

    return NextResponse.json({
      data: {
        runId: result.runId,
        status: result.status,
        leads: result.leads.map(mapLeadRowToWire),
        counts: result.counts,
        radiusKm: result.radiusKm,
        message: result.message,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
