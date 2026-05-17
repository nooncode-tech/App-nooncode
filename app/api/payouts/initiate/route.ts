import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/server/auth/guards'
import { toErrorResponse } from '@/lib/server/api/errors'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import { createTransfer } from '@/lib/server/stripe/connect'

const bodySchema = z.object({
  profileId: z.string().uuid(),
  notes: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    const principal = await requireRole(['admin'])
    const { profileId, notes } = bodySchema.parse(await request.json())

    const client = await createSupabaseAdminClient()

    const { data: profile } = await client
      .from('user_profiles' as never)
      .select('id, full_name, email, stripe_connect_account_id, stripe_connect_status')
      .eq('id', profileId)
      .maybeSingle() as {
        data: {
          id: string
          full_name: string
          email: string
          stripe_connect_account_id: string | null
          stripe_connect_status: string
        } | null
      }

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }
    if (!profile.stripe_connect_account_id || profile.stripe_connect_status !== 'active') {
      return NextResponse.json(
        { error: 'User does not have an active Stripe Connect account' },
        { status: 422 },
      )
    }

    const { data: reservedRows, error: reserveError } = await client.rpc('reserve_wallet_payout', {
      p_profile_id: profileId,
      p_actor_profile_id: principal.userId,
      p_notes: notes ?? undefined,
    })

    if (reserveError) {
      if (reserveError.message.includes('NO_BALANCE_AVAILABLE')) {
        return NextResponse.json({ error: 'No balance available to withdraw' }, { status: 422 })
      }
      throw new Error(`Failed to reserve payout: ${reserveError.message}`)
    }

    const reserved = Array.isArray(reservedRows) ? reservedRows[0] : reservedRows
    if (!reserved) {
      throw new Error('Payout reservation did not return a result')
    }

    const amount = Number(reserved.amount)
    const currency = reserved.currency ?? 'USD'
    const amountCents = Math.round(amount * 100)

    let transferId: string
    try {
      transferId = await createTransfer(
        profile.stripe_connect_account_id,
        amountCents,
        currency,
        {
          noon_profile_id: profileId,
          noon_batch_id: reserved.batch_id,
          noon_payout_id: reserved.payout_id,
        },
        `payout:${reserved.payout_id}`,
      )
    } catch (error) {
      await client.rpc('release_wallet_payout', {
        p_payout_id: reserved.payout_id,
        p_reason: 'stripe_transfer_failed',
      })
      throw error
    }

    const { error: attachError } = await client.rpc('attach_payout_transfer', {
      p_payout_id: reserved.payout_id,
      p_external_reference: transferId,
    })

    if (attachError) {
      throw new Error(`Failed to attach payout transfer: ${attachError.message}`)
    }

    return NextResponse.json({
      data: {
        payoutId: reserved.payout_id,
        batchId: reserved.batch_id,
        transferId,
        amount,
        currency,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
