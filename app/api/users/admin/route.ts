import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { listAdminDirectoryUsers } from '@/lib/server/profiles/repository'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'

const adminOnlyRoles = ['admin'] as const

export async function GET() {
  try {
    await requireRole(adminOnlyRoles)

    const adminClient = createSupabaseAdminClient()
    const users = await listAdminDirectoryUsers(adminClient)

    return NextResponse.json({
      data: users,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
