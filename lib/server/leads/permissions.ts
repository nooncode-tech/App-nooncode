import type { requireRole } from '@/lib/server/auth/guards'
import type { getLeadById } from '@/lib/server/leads/repository'
import { ApiError } from '@/lib/server/api/errors'

export function assertSalesLeadOwnership(
  principal: Awaited<ReturnType<typeof requireRole>>,
  lead: NonNullable<Awaited<ReturnType<typeof getLeadById>>>
) {
  if (principal.role !== 'sales') {
    return
  }

  const canManageLead =
    lead.assigned_to === principal.userId ||
    (
      lead.created_by === principal.userId &&
      lead.assigned_to === null &&
      lead.assignment_status !== 'released_no_response'
    )

  if (!canManageLead) {
    throw new ApiError(
      'FORBIDDEN',
      'The authenticated sales user does not own this lead.',
      403
    )
  }
}
