import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { requireRole } from '@/lib/server/auth/guards'
import { ApiError, toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { mapLeadRowToWire } from '@/lib/server/leads/mappers'
import {
  maxwellLeadSearchRequestSchema,
  runMaxwellLeadSearch,
} from '@/lib/server/maxwell/lead-engine'

const allowedRoles = ['admin', 'sales_manager', 'sales', 'pm'] as const

export const maxDuration = 90

export async function POST(request: Request) {
  const requestId = getRequestId(request)

  try {
    await assertRateLimit(request, {
      namespace: 'maxwell-lead-searches',
      limit: 8,
      windowMs: 15 * 60_000,
    })

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

    logger.info('maxwell.lead_search.completed', {
      requestId,
      userId: principal.userId,
      role: principal.role,
      runId: result.runId,
      status: result.status,
      leadsPublished: result.leads.length,
    })

    return jsonWithRequestId({
      data: {
        runId: result.runId,
        status: result.status,
        leads: result.leads.map(mapLeadRowToWire),
        leadsByNiche: result.leadsByNiche?.map((group) => ({
          nicheId: group.nicheId,
          nicheLabel: group.nicheLabel,
          leads: group.leads.map(mapLeadRowToWire),
        })),
        counts: result.counts,
        radiusKm: result.radiusKm,
        message: result.message,
      },
    }, undefined, requestId)
  } catch (error) {
    logger.warn('maxwell.lead_search.failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return toErrorResponse(error, { requestId })
  }
}
