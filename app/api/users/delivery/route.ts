import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { listDeliveryUsers } from '@/lib/server/profiles/repository'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'

const allowedDeliveryUserRoles = ['admin', 'sales_manager', 'pm', 'developer'] as const

export async function GET() {
  try {
    await requireRole(allowedDeliveryUserRoles)

    const adminClient = createSupabaseAdminClient()
    const deliveryUsers = await listDeliveryUsers(adminClient)

    return NextResponse.json({
      data: deliveryUsers,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
