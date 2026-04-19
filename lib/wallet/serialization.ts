import type { WalletEntry, WalletSummary } from '@/lib/types'

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
  }
}
