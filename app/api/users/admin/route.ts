import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { listAdminDirectoryUsers } from '@/lib/server/profiles/repository'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import type { AdminDirectoryUser } from '@/lib/server/profiles/types'
import type { SupabaseClient } from '@supabase/supabase-js'

const adminOnlyRoles = ['admin'] as const

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 100

type Dependencies = {
  requireRole: (roles: readonly string[]) => Promise<unknown>
  listAdminDirectoryUsers: (client: unknown, limit: number) => Promise<AdminDirectoryUser[]>
  createSupabaseAdminClient: () => unknown
}

export function createGetAdminUsersHandler(deps: Dependencies) {
  return async function GET(request: Request) {
    try {
      await deps.requireRole(adminOnlyRoles)

      const { searchParams } = new URL(request.url)
      const rawLimit = searchParams.get('limit')
      const requestedLimit = rawLimit !== null ? parseInt(rawLimit, 10) : DEFAULT_LIMIT
      const limit = Math.min(requestedLimit, MAX_LIMIT)

      const adminClient = deps.createSupabaseAdminClient()
      const users = await deps.listAdminDirectoryUsers(adminClient, limit)

      return NextResponse.json({
        data: users,
      })
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

const handler = createGetAdminUsersHandler({
  requireRole: (roles) => requireRole(roles as typeof adminOnlyRoles),
  listAdminDirectoryUsers: (client, limit) =>
    listAdminDirectoryUsers(client as SupabaseClient, limit),
  createSupabaseAdminClient,
})

export { handler as GET }
