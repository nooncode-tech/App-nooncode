import type { WalletSummaryWire, WalletEntryWire } from '@/lib/wallet/serialization'
import type { WalletEntryRowWithActor, WalletRow } from '@/lib/server/wallet/types'

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
  entries: WalletEntryWire[]
): WalletSummaryWire {
  return {
    freeAvailable: wallet.free_credits_balance,
    earnedAvailable: wallet.earned_credits_balance,
    totalAvailable: wallet.free_credits_balance + wallet.earned_credits_balance,
    prototypeRequestCost,
    entries,
  }
}
