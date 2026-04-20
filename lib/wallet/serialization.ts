import type { WalletEntry, WalletSummary } from '@/lib/types'
import type { MonetaryEntryType, BalanceBucket } from '@/lib/server/wallet/types'

export interface WalletEntryWire {
  id: string
  type: WalletEntry['type']
  bucket: WalletEntry['bucket']
  deltaCredits: number
  operationId: string
  actorId: string | null
  actorName: string
  leadId: string | null
  prototypeWorkspaceId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface WalletSummaryWire {
  freeAvailable: number
  earnedAvailable: number
  totalAvailable: number
  prototypeRequestCost: number | null
  entries: WalletEntryWire[]
  // Wallet monetaria (opcional — solo cuando migration 0024 está aplicada)
  monetaryWallet?: MonetaryWalletWire
  monetaryLedger?: MonetaryLedgerEntryWire[]
}

// Wire types monetarios
export interface MonetaryWalletWire {
  availableToSpend: number
  availableToWithdraw: number
  pending: number
  locked: number
  currency: string
}

export interface MonetaryLedgerEntryWire {
  id: string
  amount: number
  currency: string
  entryType: MonetaryEntryType
  balanceBucket: BalanceBucket
  status: 'confirmed' | 'pending' | 'reversed'
  referenceType: string | null
  referenceId: string | null
  actorId: string | null
  actorName: string
  metadata: Record<string, unknown>
  createdAt: string
}

export function deserializeWalletEntry(entry: WalletEntryWire): WalletEntry {
  return {
    id: entry.id,
    type: entry.type,
    bucket: entry.bucket,
    deltaCredits: entry.deltaCredits,
    operationId: entry.operationId,
    actorId: entry.actorId ?? undefined,
    actorName: entry.actorName,
    leadId: entry.leadId ?? undefined,
    prototypeWorkspaceId: entry.prototypeWorkspaceId ?? undefined,
    metadata: entry.metadata,
    createdAt: new Date(entry.createdAt),
  }
}

export function deserializeWalletSummary(summary: WalletSummaryWire): WalletSummary {
  return {
    freeAvailable: summary.freeAvailable,
    earnedAvailable: summary.earnedAvailable,
    totalAvailable: summary.totalAvailable,
    prototypeRequestCost: summary.prototypeRequestCost ?? undefined,
    entries: summary.entries.map(deserializeWalletEntry),
    monetaryWallet: summary.monetaryWallet,
    monetaryLedger: summary.monetaryLedger?.map(deserializeMonetaryLedgerEntry),
  }
}

export function deserializeMonetaryLedgerEntry(entry: MonetaryLedgerEntryWire) {
  return {
    ...entry,
    createdAt: new Date(entry.createdAt),
  }
}
