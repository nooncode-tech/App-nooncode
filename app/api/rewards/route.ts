import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentPrincipal } from '@/lib/server/auth/session'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'
import { toErrorResponse } from '@/lib/server/api/errors'
import {
  getPointsBalance,
  listPointsLedger,
  listRewardStoreItems,
  redeemReward,
} from '@/lib/server/points/repository'

export async function GET() {
  try {
    const principal = await getCurrentPrincipal()
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const client = await createSupabaseServerClient()

    const [balance, ledger, storeItems] = await Promise.all([
      getPointsBalance(client, principal.userId),
      listPointsLedger(client, principal.userId),
      listRewardStoreItems(client),
    ])

    return NextResponse.json({ data: { balance, ledger, storeItems } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

const redeemSchema = z.object({
  itemId: z.string().uuid(),
})

export async function POST(request: Request) {
  try {
    const principal = await getCurrentPrincipal()
    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = redeemSchema.parse(await request.json())
    const client = await createSupabaseServerClient()

    const redemption = await redeemReward(client, principal.userId, body.itemId)

    return NextResponse.json({ data: redemption }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
