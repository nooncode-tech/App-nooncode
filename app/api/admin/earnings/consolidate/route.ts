import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { consolidateEarnings } from '@/lib/server/earnings/admin'

const consolidateSchema = z.object({
  targetProfileId: z.string().uuid(),
  amount: z.number().positive(),
})

export async function POST(request: Request) {
  try {
    const principal = await requireRole(['admin'])
    const body = consolidateSchema.parse(await request.json())

    const adminClient = createSupabaseAdminClient()

    await consolidateEarnings(adminClient, {
      ...body,
      actorProfileId: principal.userId,
    })

    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
