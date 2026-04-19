import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import {
  getPrototypeCreditSettings,
  upsertPrototypeCreditSettings,
} from '@/lib/server/wallet/repository'

const adminOnlyRoles = ['admin'] as const

const updateSettingsSchema = z.object({
  requestCost: z.number().int().min(1).max(10000),
})

export async function GET() {
  try {
    await requireRole(adminOnlyRoles)

    const client = await createSupabaseServerClient()
    const settings = await getPrototypeCreditSettings(client)

    return NextResponse.json({
      data: {
        requestCost: settings?.request_cost ?? null,
        updatedAt: settings?.updated_at ?? null,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireRole(adminOnlyRoles)
    const payload = updateSettingsSchema.parse(await request.json())

    const client = await createSupabaseServerClient()
    const settings = await upsertPrototypeCreditSettings(
      client,
      payload.requestCost,
      principal.userId
    )

    return NextResponse.json({
      data: {
        requestCost: settings.request_cost,
        updatedAt: settings.updated_at,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
