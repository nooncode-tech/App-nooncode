import type {
  WalletSummaryWire,
  WalletEntryWire,
  MonetaryWalletWire,
  MonetaryLedgerEntryWire,
} from '@/lib/wallet/serialization'
import type {
  WalletEntryRowWithActor,
  WalletRow,
  WalletAccountRow,
  WalletLedgerEntryRowWithActor,
} from '@/lib/server/wallet/types'

function normalizeEntryMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return metadata as Record<string, unknown>
}

export function mapWalletEntryRowToWire(row: WalletEntryRowWithActor): WalletEntryWire {
  return {
    id: row.id,
    type: row.entry_type,
    bucket: row.bucket,
    deltaCredits: row.delta_credits,
    operationId: row.operation_id,
    actorId: row.actor_profile_id,
    actorName: row.actor_profile?.full_name ?? 'Sistema',
    leadId: row.lead_id,
    prototypeWorkspaceId: row.prototype_workspace_id,
    metadata: normalizeEntryMetadata(row.metadata),
    createdAt: row.created_at,
  }
}

export function mapWalletToWire(
  wallet: WalletRow,
  prototypeRequestCost: number | null,
  entries: WalletEntryWire[],
  monetaryWallet?: WalletAccountRow | null,
  monetaryLedger?: MonetaryLedgerEntryWire[]
): WalletSummaryWire {
  return {
    freeAvailable: wallet.free_credits_balance,
    earnedAvailable: wallet.earned_credits_balance,
    totalAvailable: wallet.free_credits_balance + wallet.earned_credits_balance,
    prototypeRequestCost,
    entries,
    ...(monetaryWallet != null && {
      monetaryWallet: mapWalletAccountToWire(monetaryWallet),
    }),
    ...(monetaryLedger != null && { monetaryLedger }),
  }
}

export function mapWalletAccountToWire(account: WalletAccountRow): MonetaryWalletWire {
  return {
    availableToSpend: Number(account.available_to_spend),
    availableToWithdraw: Number(account.available_to_withdraw),
    pending: Number(account.pending),
    locked: Number(account.locked),
    currency: account.currency,
  }
}

export function mapMonetaryLedgerEntryToWire(
  row: WalletLedgerEntryRowWithActor
): MonetaryLedgerEntryWire {
  return {
    id: row.id,
    amount: Number(row.amount),
    currency: row.currency,
    entryType: row.entry_type,
    balanceBucket: row.balance_bucket,
    status: row.status,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    actorId: row.actor_profile_id,
    actorName: row.actor_profile?.full_name ?? 'Sistema',
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.created_at,
  }
}
