import type { SupabaseClient } from '@supabase/supabase-js'
import type { WalletLedgerEntryRow } from '@/lib/server/wallet/types'

type EarningType = 'activation' | 'membership' | 'milestone' | 'manual'

export interface CreditEarningsInput {
  targetProfileId: string
  amount: number
  earningType: EarningType
  channel: 'inbound' | 'outbound' | null
  referenceType?: string | null
  referenceId?: string | null
  notes?: string | null
  actorProfileId: string
  actorName: string
}

export interface ConsolidateEarningsInput {
  targetProfileId: string
  amount: number
  actorProfileId: string
}

// Uses admin (service_role) client — bypasses RLS
export async function creditEarnings(
  adminClient: SupabaseClient,
  input: CreditEarningsInput,
): Promise<WalletLedgerEntryRow> {
  if (input.amount <= 0) throw new Error('INVALID_AMOUNT')

  const validTypes: EarningType[] = ['activation', 'membership', 'milestone', 'manual']
  if (!validTypes.includes(input.earningType)) throw new Error('INVALID_EARNING_TYPE')

  // Ensure wallet account row exists (all numeric columns default to 0)
  await adminClient
    .from('wallet_accounts' as never)
    .upsert({ profile_id: input.targetProfileId } as never, { onConflict: 'profile_id', ignoreDuplicates: true })

  // Read current pending balance, then increment (admin credits are low-frequency; no concurrent risk)
  const { data: wallet, error: readError } = await adminClient
    .from('wallet_accounts' as never)
    .select('pending')
    .eq('profile_id', input.targetProfileId)
    .single() as { data: { pending: number } | null; error: unknown }

  if (readError || !wallet) throw new Error('WALLET_NOT_FOUND')

  const { error: updateError } = await adminClient
    .from('wallet_accounts' as never)
    .update({
      pending: Number(wallet.pending) + input.amount,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('profile_id', input.targetProfileId)

  if (updateError) throw new Error(`Failed to update wallet: ${(updateError as Error).message}`)

  // Record the ledger entry
  const { data: entry, error: insertError } = await adminClient
    .from('wallet_ledger_entries' as never)
    .insert({
      profile_id: input.targetProfileId,
      amount: input.amount,
      currency: 'USD',
      entry_type: 'earnings_distribution',
      balance_bucket: 'pending',
      status: 'confirmed',
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      actor_profile_id: input.actorProfileId,
      metadata: {
        earningType: input.earningType,
        channel: input.channel,
        notes: input.notes ?? null,
        creditedBy: input.actorName,
      },
    } as never)
    .select('id, profile_id, amount, currency, entry_type, balance_bucket, status, reference_type, reference_id, actor_profile_id, metadata, created_at')
    .single()

  if (insertError || !entry) throw new Error(`Failed to record ledger entry: ${(insertError as Error)?.message ?? 'No data'}`)

  return entry as unknown as WalletLedgerEntryRow
}

export async function consolidateEarnings(
  adminClient: SupabaseClient,
  input: ConsolidateEarningsInput,
): Promise<void> {
  if (input.amount <= 0) throw new Error('INVALID_AMOUNT')

  const { data: wallet, error: readError } = await adminClient
    .from('wallet_accounts' as never)
    .select('pending, available_to_withdraw')
    .eq('profile_id', input.targetProfileId)
    .single() as { data: { pending: number; available_to_withdraw: number } | null; error: unknown }

  if (readError || !wallet) throw new Error('WALLET_NOT_FOUND')

  const currentPending = Number(wallet.pending)
  if (currentPending < input.amount) throw new Error('INSUFFICIENT_PENDING')

  const { error: updateError } = await adminClient
    .from('wallet_accounts' as never)
    .update({
      pending: currentPending - input.amount,
      available_to_withdraw: Number(wallet.available_to_withdraw) + input.amount,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('profile_id', input.targetProfileId)

  if (updateError) throw new Error(`Failed to consolidate: ${(updateError as Error).message}`)

  await adminClient
    .from('wallet_ledger_entries' as never)
    .insert({
      profile_id: input.targetProfileId,
      amount: input.amount,
      currency: 'USD',
      entry_type: 'earnings_distribution',
      balance_bucket: 'available_to_withdraw',
      status: 'confirmed',
      reference_type: 'consolidation',
      actor_profile_id: input.actorProfileId,
      metadata: { consolidatedFrom: 'pending' },
    } as never)
}
