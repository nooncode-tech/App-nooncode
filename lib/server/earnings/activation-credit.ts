import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/server/supabase/database.types'

// Shared activation-earnings allocator + wallet crediter for both webhook
// entry-points (outbound Stripe Checkout + inbound NoonWeb payment-confirmed).
// Architecture decisions live in `docs/adrs/ADR-021-inbound-earnings-auto-credit-extraction.md`.
// Spec at `specs/fase-3-r4-inbound-earnings-auto-credit.md`.
//
// The service is the allocation policy holder. It computes `base`, builds
// the earnings rows (1-3 actors), upserts `earnings_ledger`, then loops
// through `credit_wallet_bucket` RPC calls for each actor with a non-null
// profile_id. Idempotency is enforced at the SQL level via the unique
// constraint on `earnings_ledger.idempotency_key` (column) and the partial
// unique index on `wallet_ledger_entries.metadata->>'idempotencyKey'`
// (both defined by migration 0036).

type SupabaseAdminClient = SupabaseClient<Database>
type MonetaryEntryType = Database['public']['Enums']['monetary_entry_type']
type WalletBalanceBucket = 'available_to_spend' | 'available_to_withdraw' | 'pending' | 'locked'

export type ActivationChannel = 'inbound' | 'outbound'
export type ActivationActorRole = 'seller' | 'developer' | 'noon'

export interface CreditActivationEarningsSellerInput {
  /** Profile UUID of the seller being credited. Required when seller present. */
  actorId: string
  /** Seller's persisted take from `seller_fees.amount` (outbound only). */
  amount: number
}

export interface CreditActivationEarningsParams {
  // Money
  activationAmount: number
  currency: string

  // IDs (from `activatePaidProposal` return shape)
  paymentId: string
  proposalId: string
  leadId: string

  // Actors
  /**
   * Outbound only. When provided, service includes the seller row and uses
   * `base = activationAmount - seller.amount`. When null (inbound), service
   * uses `base = activationAmount` and writes only developer + noon rows.
   */
  seller: CreditActivationEarningsSellerInput | null
  /** Project's assignee at payment time. Null when not yet assigned. */
  developerUserId: string | null

  // Idempotency + tracing
  channel: ActivationChannel
  /**
   * Unique per-event idempotency-key base. Service appends row-specific
   * suffixes. Outbound callers pass `'stripe:${session.id}'`; inbound
   * callers pass `'website:${external_payment_id}'`. Namespace mismatch
   * with `channel` is rejected at entry — see ADR-021 D2.
   */
  idempotencyKeyBase: string
  /** Audit actor for `wallet_ledger_entries.actor_profile_id`. Webhooks pass null. */
  actorProfileId: string | null
  /** Optional override for the wallet credit timestamp. Defaults to `new Date().toISOString()`. */
  createdAt?: string
}

export interface CreditActivationEarningsRowResult {
  actorRole: ActivationActorRole
  /** null for `noon`; null for `developer` when `developerUserId` was null at call time */
  actorId: string | null
  amount: number
  /** earnings_ledger row's idempotency_key (column-level UNIQUE) */
  earningsLedgerIdempotencyKey: string
  /** wallet_ledger_entries metadata.idempotencyKey. null when no wallet credit attempted (actorId was null). */
  walletIdempotencyKey: string | null
  /**
   * true: a new wallet_ledger_entries row was inserted this call.
   * false: actorId was null (no credit attempted), or RPC returned false (deduped via partial unique index).
   */
  walletCredited: boolean
}

export interface CreditActivationEarningsResult {
  /** `activationAmount - (seller?.amount ?? 0)`. May be 0 when seller takes the full amount. */
  base: number
  /** All rows considered (seller when present + developer + noon when base > 0). */
  rows: CreditActivationEarningsRowResult[]
}

interface EarningsLedgerInsertRow {
  actor_id: string | null
  actor_role: ActivationActorRole
  earning_type: 'activation'
  amount: number
  currency: string
  lead_id: string
  proposal_id: string
  payment_id: string
  idempotency_key: string
  notes: string
}

interface WalletCreditAttempt {
  actorRole: ActivationActorRole
  actorId: string | null
  amount: number
  earningsLedgerIdempotencyKey: string
  walletIdempotencyKey: string | null
  notes: string
}

function buildEarningsKey(base: string, actorRole: ActivationActorRole, actorId: string | null): string {
  return `${base}:earning:${actorRole}:${actorId ?? 'unassigned'}`
}

function buildWalletKey(base: string, actorRole: ActivationActorRole, actorId: string): string {
  // actorId is required here — caller only constructs wallet keys for non-null actors.
  return `${base}:wallet:${actorRole}:${actorId}`
}

function assertNamespaceMatch(channel: ActivationChannel, idempotencyKeyBase: string): void {
  const requiredPrefix = channel === 'inbound' ? 'website:' : 'stripe:'
  if (!idempotencyKeyBase.startsWith(requiredPrefix)) {
    throw new Error('IDEMPOTENCY_KEY_BASE_NAMESPACE_MISMATCH')
  }
}

function roundCents(value: number): number {
  return Number.parseFloat(value.toFixed(2))
}

async function creditWalletBucketRpc(
  client: SupabaseAdminClient,
  input: {
    profileId: string
    amount: number
    currency: string
    entryType: MonetaryEntryType
    balanceBucket: WalletBalanceBucket
    referenceType: string
    referenceId: string
    actorProfileId: string | null
    metadata: Json
    idempotencyKey: string
    createdAt: string
  },
): Promise<boolean> {
  const { data, error } = await client.rpc('credit_wallet_bucket', {
    p_profile_id: input.profileId,
    p_amount: input.amount,
    p_currency: input.currency,
    p_entry_type: input.entryType,
    p_balance_bucket: input.balanceBucket,
    p_reference_type: input.referenceType,
    p_reference_id: input.referenceId,
    p_actor_profile_id: input.actorProfileId ?? undefined,
    p_metadata: input.metadata,
    p_idempotency_key: input.idempotencyKey,
    p_created_at: input.createdAt,
  })

  if (error) {
    throw new Error(`Failed to credit wallet: ${error.message}`)
  }

  // RPC returns boolean: true = inserted, false = deduped (partial unique index hit).
  return data === true
}

export async function creditActivationEarnings(
  client: SupabaseAdminClient,
  params: CreditActivationEarningsParams,
): Promise<CreditActivationEarningsResult> {
  assertNamespaceMatch(params.channel, params.idempotencyKeyBase)

  const sellerAmount = params.seller?.amount ?? 0
  const base = Math.max(params.activationAmount - sellerAmount, 0)
  const channelLabel = params.channel === 'outbound' ? 'Outbound' : 'Inbound'
  const createdAt = params.createdAt ?? new Date().toISOString()

  const rowsToInsert: EarningsLedgerInsertRow[] = []
  const walletAttempts: WalletCreditAttempt[] = []

  // Seller row — outbound only.
  if (params.seller) {
    const sellerKey = buildEarningsKey(params.idempotencyKeyBase, 'seller', params.seller.actorId)
    const sellerNotes = `${channelLabel} activation - $${params.seller.amount} (seller-selected)`

    rowsToInsert.push({
      actor_id: params.seller.actorId,
      actor_role: 'seller',
      earning_type: 'activation',
      amount: params.seller.amount,
      currency: params.currency,
      lead_id: params.leadId,
      proposal_id: params.proposalId,
      payment_id: params.paymentId,
      idempotency_key: sellerKey,
      notes: sellerNotes,
    })

    walletAttempts.push({
      actorRole: 'seller',
      actorId: params.seller.actorId,
      amount: params.seller.amount,
      earningsLedgerIdempotencyKey: sellerKey,
      walletIdempotencyKey: buildWalletKey(params.idempotencyKeyBase, 'seller', params.seller.actorId),
      notes: sellerNotes,
    })
  }

  // Developer + noon rows — only when base > 0.
  if (base > 0) {
    const halfBase = roundCents(base * 0.5)

    const developerKey = buildEarningsKey(params.idempotencyKeyBase, 'developer', params.developerUserId)
    const developerNotes = params.developerUserId
      ? `${channelLabel} activation - 50% of base $${base}`
      : 'Developer not yet assigned - pending resolution'

    rowsToInsert.push({
      actor_id: params.developerUserId,
      actor_role: 'developer',
      earning_type: 'activation',
      amount: halfBase,
      currency: params.currency,
      lead_id: params.leadId,
      proposal_id: params.proposalId,
      payment_id: params.paymentId,
      idempotency_key: developerKey,
      notes: developerNotes,
    })

    walletAttempts.push({
      actorRole: 'developer',
      actorId: params.developerUserId,
      amount: halfBase,
      earningsLedgerIdempotencyKey: developerKey,
      walletIdempotencyKey: params.developerUserId
        ? buildWalletKey(params.idempotencyKeyBase, 'developer', params.developerUserId)
        : null,
      notes: developerNotes,
    })

    const noonKey = buildEarningsKey(params.idempotencyKeyBase, 'noon', null)
    const noonNotes = `${channelLabel} activation - 50% of base $${base}`

    rowsToInsert.push({
      actor_id: null,
      actor_role: 'noon',
      earning_type: 'activation',
      amount: halfBase,
      currency: params.currency,
      lead_id: params.leadId,
      proposal_id: params.proposalId,
      payment_id: params.paymentId,
      idempotency_key: noonKey,
      notes: noonNotes,
    })

    walletAttempts.push({
      actorRole: 'noon',
      actorId: null,
      amount: halfBase,
      earningsLedgerIdempotencyKey: noonKey,
      walletIdempotencyKey: null,
      notes: noonNotes,
    })
  }

  // Single atomic upsert covering every row.
  if (rowsToInsert.length > 0) {
    const { error: earningsError } = await client
      .from('earnings_ledger')
      .upsert(rowsToInsert, { onConflict: 'idempotency_key', ignoreDuplicates: true })

    if (earningsError) {
      throw new Error(`Failed to insert earnings: ${earningsError.message}`)
    }
  }

  // Per-row wallet credit. Skipped when actorId is null (noon always; developer when unassigned).
  const rowResults: CreditActivationEarningsRowResult[] = []

  for (const attempt of walletAttempts) {
    if (attempt.actorId === null || attempt.walletIdempotencyKey === null) {
      rowResults.push({
        actorRole: attempt.actorRole,
        actorId: null,
        amount: attempt.amount,
        earningsLedgerIdempotencyKey: attempt.earningsLedgerIdempotencyKey,
        walletIdempotencyKey: null,
        walletCredited: false,
      })
      continue
    }

    const walletInserted = await creditWalletBucketRpc(client, {
      profileId: attempt.actorId,
      amount: attempt.amount,
      currency: params.currency,
      entryType: 'earnings_distribution',
      balanceBucket: 'pending',
      referenceType: 'payment',
      referenceId: params.paymentId,
      actorProfileId: params.actorProfileId,
      metadata: {
        earningType: 'activation',
        actorRole: attempt.actorRole,
        channel: params.channel,
        notes: attempt.notes,
        paymentId: params.paymentId,
      },
      idempotencyKey: attempt.walletIdempotencyKey,
      createdAt,
    })

    rowResults.push({
      actorRole: attempt.actorRole,
      actorId: attempt.actorId,
      amount: attempt.amount,
      earningsLedgerIdempotencyKey: attempt.earningsLedgerIdempotencyKey,
      walletIdempotencyKey: attempt.walletIdempotencyKey,
      walletCredited: walletInserted,
    })
  }

  return { base, rows: rowResults }
}
