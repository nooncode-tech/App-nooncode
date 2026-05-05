import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentPrincipal } from '@/lib/server/auth/session'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import {
  createWithdrawalRequest,
  listWithdrawalRequestsForActor,
  getPendingWithdrawableBalance,
} from '@/lib/server/withdrawals/repository'

const withdrawSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default('USD'),
  notes: z.string().max(500).nullable().optional(),
})

export async function GET() {
  try {
    const principal = await getCurrentPrincipal()
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const client = await createSupabaseServerClient()
    const requests = await listWithdrawalRequestsForActor(client, principal.userId)

    return NextResponse.json({ data: requests })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal()
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = withdrawSchema.parse(await request.json())
    const client = await createSupabaseServerClient()

    // Verify they have enough credited balance
    const available = await getPendingWithdrawableBalance(client, principal.userId)
    if (body.amount > available) {
      return NextResponse.json(
        { error: `Insufficient balance. Available: $${available.toFixed(2)}` },
        { status: 400 },
      )
    }

    const withdrawal = await createWithdrawalRequest(
      client,
      principal.userId,
      body.amount,
      body.currency ?? 'USD',
      body.notes ?? null,
    )

    return NextResponse.json({ data: withdrawal }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
