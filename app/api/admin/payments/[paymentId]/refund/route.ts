import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { assertRateLimit } from '@/lib/server/api/rate-limit'
import { getRequestId, jsonWithRequestId } from '@/lib/server/api/request'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { triggerRefund } from '@/lib/server/payments/refund-service'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const requestId = getRequestId(request)

  try {
    await assertRateLimit(request, {
      namespace: 'admin-refund',
      limit: 10,
      windowMs: 60_000,
    })

    const principal = await requireRole(['admin'])
    const { paymentId } = await params

    const adminClient = await createSupabaseAdminClient()
    const result = await triggerRefund(adminClient, {
      paymentId,
      actorProfileId: principal.profile.id,
    })

    return jsonWithRequestId({ data: result }, undefined, requestId)
  } catch (err) {
    return toErrorResponse(err, { requestId })
  }
}
