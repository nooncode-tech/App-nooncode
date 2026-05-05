import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { listDeliveryUsers } from '@/lib/server/profiles/repository'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import type { DeliveryUser } from '@/lib/server/profiles/types'
import type { SupabaseClient } from '@supabase/supabase-js'

const allowedDeliveryUserRoles = ['admin', 'sales_manager', 'pm', 'developer'] as const

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 100

type Dependencies = {
  requireRole: (roles: readonly string[]) => Promise<unknown>
  listDeliveryUsers: (client: unknown, limit: number) => Promise<DeliveryUser[]>
  createSupabaseAdminClient: () => unknown
}

export function createGetDeliveryUsersHandler(deps: Dependencies) {
  return async function GET(request: Request) {
    try {
      await deps.requireRole(allowedDeliveryUserRoles)

      const { searchParams } = new URL(request.url)
      const rawLimit = searchParams.get('limit')
      const requestedLimit = rawLimit !== null ? parseInt(rawLimit, 10) : DEFAULT_LIMIT
      const limit = Math.min(requestedLimit, MAX_LIMIT)

      const adminClient = deps.createSupabaseAdminClient()
      const deliveryUsers = await deps.listDeliveryUsers(adminClient, limit)

      return NextResponse.json({
        data: deliveryUsers,
      })
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

const handler = createGetDeliveryUsersHandler({
  requireRole: (roles) => requireRole(roles as typeof allowedDeliveryUserRoles),
  listDeliveryUsers: (client, limit) => listDeliveryUsers(client as SupabaseClient, limit),
  createSupabaseAdminClient,
})

export { handler as GET }
