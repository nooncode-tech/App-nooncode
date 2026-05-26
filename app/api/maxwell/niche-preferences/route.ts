import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { ApiError, toErrorResponse } from '@/lib/server/api/errors'
import { errorToLogContext, logger } from '@/lib/server/api/logger'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { getNicheById } from '@/lib/server/maxwell/niches'

// Architecture C4: admin client + explicit ownership pin to user_profiles.id.
// Role gate: sales | pm | admin. The handler NEVER accepts a target user id
// from the request — `.eq('id', principal.userId)` is the only identifier used.

export const NICHE_PREFERENCES_ALLOWED_ROLES = ['admin', 'sales', 'pm'] as const

export const nichePreferencesPatchSchema = z.object({
  preferredNicheIds: z.array(z.string().trim().min(1).max(64)).max(2),
})

/**
 * Validates a PATCH body against the schema + the static niche catalog.
 * Throws ApiError(400) on invalid payload or unknown niche id; returns the
 * normalized list on success. Exported for unit tests.
 */
export function validateNichePreferencesPatch(body: unknown): { preferredNicheIds: string[] } {
  const parsed = nichePreferencesPatchSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_NICHE_PREFERENCES_BODY', 'Invalid niche preferences payload.', 400)
  }
  for (const id of parsed.data.preferredNicheIds) {
    if (!getNicheById(id)) {
      throw new ApiError('NICHE_UNKNOWN', `Invalid niche id: ${id}`, 400)
    }
  }
  return parsed.data
}

export async function GET(request: Request) {
  const requestId = getRequestId(request)

  try {
    const principal = await requireRole(NICHE_PREFERENCES_ALLOWED_ROLES)
    const adminClient = createSupabaseAdminClient()

    const { data, error } = await adminClient
      .from('user_profiles')
      .select('preferred_niche_ids')
      .eq('id', principal.userId)
      .maybeSingle()

    if (error) {
      throw new ApiError('NICHE_PREFERENCES_LOAD_FAILED', error.message, 500)
    }

    // TODO(types-regen): cast until database.types.ts is regenerated post-merge
    const row = data as unknown as { preferred_niche_ids?: string[] | null } | null
    const preferredNicheIds = Array.isArray(row?.preferred_niche_ids)
      ? row.preferred_niche_ids
      : []

    return jsonWithRequestId({ data: { preferredNicheIds } }, undefined, requestId)
  } catch (error) {
    logger.warn('maxwell.niche_preferences.get_failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return toErrorResponse(error, { requestId })
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request)

  try {
    const principal = await requireRole(NICHE_PREFERENCES_ALLOWED_ROLES)
    const body = await request.json().catch(() => null)
    const validated = validateNichePreferencesPatch(body)

    const adminClient = createSupabaseAdminClient()

    // TODO(types-regen): cast until database.types.ts is regenerated post-merge
    const update = { preferred_niche_ids: validated.preferredNicheIds } as unknown as Record<
      string,
      never
    >

    const { error } = await adminClient
      .from('user_profiles')
      .update(update)
      .eq('id', principal.userId)

    if (error) {
      throw new ApiError('NICHE_PREFERENCES_UPDATE_FAILED', error.message, 500)
    }

    logger.info('maxwell.niche_preferences.updated', {
      requestId,
      userId: principal.userId,
      role: principal.role,
      count: validated.preferredNicheIds.length,
    })

    return jsonWithRequestId(
      { data: { preferredNicheIds: validated.preferredNicheIds } },
      undefined,
      requestId,
    )
  } catch (error) {
    logger.warn('maxwell.niche_preferences.patch_failed', {
      requestId,
      ...errorToLogContext(error),
    })
    return toErrorResponse(error, { requestId })
  }
}
