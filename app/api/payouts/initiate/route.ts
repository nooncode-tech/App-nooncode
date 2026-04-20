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
    await requireRole(['admin'])
    const { profileId, notes } = bodySchema.parse(await request.json())

    const client = await createSupabaseAdminClient()

    // Get profile + connect account
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

    // Get available_to_withdraw balance
    const { data: wallet } = await client
      .from('wallet_accounts' as never)
      .select('available_to_withdraw, currency')
      .eq('profile_id', profileId)
      .maybeSingle() as { data: { available_to_withdraw: number; currency: string } | null }

    const amount = Number(wallet?.available_to_withdraw ?? 0)
    if (amount <= 0) {
      return NextResponse.json({ error: 'No balance available to withdraw' }, { status: 422 })
    }

    const currency = wallet?.currency ?? 'USD'
    const amountCents = Math.round(amount * 100)
    const now = new Date().toISOString()
    const periodStart = new Date(now)
    periodStart.setDate(1)

    // Create payout batch
    const { data: batch, error: batchError } = await client
      .from('payout_batches' as never)
      .insert({
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: now.slice(0, 10),
        status: 'processing',
        total_amount: amount,
        currency,
        notes: notes ?? null,
      } as never)
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (batchError || !batch) throw new Error('Failed to create payout batch')

    // Create Stripe Transfer
    const transferId = await createTransfer(
      profile.stripe_connect_account_id,
      amountCents,
      currency,
      { noon_profile_id: profileId, noon_batch_id: batch.id },
    )

    // Record payout
    const { data: payout, error: payoutError } = await client
      .from('payouts' as never)
      .insert({
        batch_id: batch.id,
        profile_id: profileId,
        amount,
        currency,
        status: 'processing',
        external_reference: transferId,
        metadata: { notes: notes ?? null },
      } as never)
      .select('id')
      .single() as { data: { id: string } | null; error: unknown }

    if (payoutError || !payout) throw new Error('Failed to record payout')

    // Debit wallet — set available_to_withdraw to 0
    await client
      .from('wallet_accounts' as never)
      .update({ available_to_withdraw: 0, updated_at: now } as never)
      .eq('profile_id', profileId)

    // Ledger entry for the payout
    await client.from('wallet_ledger_entries' as never).insert({
      profile_id: profileId,
      amount: -amount,
      currency,
      entry_type: 'payout',
      balance_bucket: 'available_to_withdraw',
      status: 'confirmed',
      reference_type: 'payout',
      reference_id: payout.id,
      actor_profile_id: null,
      metadata: { transferId, batchId: batch.id, notes: notes ?? null },
      created_at: now,
    } as never)

    return NextResponse.json({ data: { payoutId: payout.id, transferId, amount, currency } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
