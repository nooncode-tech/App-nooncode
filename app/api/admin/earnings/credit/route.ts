import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { creditEarnings } from '@/lib/server/earnings/admin'

const creditSchema = z.object({
  targetProfileId: z.string().uuid(),
  amount: z.number().positive(),
  earningType: z.enum(['activation', 'membership', 'milestone', 'manual']),
  channel: z.enum(['inbound', 'outbound']).nullable(),
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
})

export async function POST(request: Request) {
  try {
    const principal = await requireRole(['admin', 'pm'])
    const body = creditSchema.parse(await request.json())

    const adminClient = createSupabaseAdminClient()

    const entry = await creditEarnings(adminClient, {
      ...body,
      actorProfileId: principal.userId,
      actorName: principal.profile.full_name ?? principal.profile.email ?? 'Admin',
    })

    return NextResponse.json({ data: entry }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
