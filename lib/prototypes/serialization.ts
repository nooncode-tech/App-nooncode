import type { PrototypeWorkspace, PrototypeWorkspaceListItem } from '@/lib/types'

export interface PrototypeWorkspaceWire {
  id: string
  leadId: string
  projectId: string | null
  requestedByProfileId: string
  currentStage: PrototypeWorkspace['currentStage']
  status: PrototypeWorkspace['status']
  lastOperationId: string | null
  generationPrompt: string | null
  generatedContent: string | null
  generatedAt: string | null
  createdAt: string
  updatedAt: string
  /**
   * Optional free-text brief the seller attached at request time to steer v0
   * generation. Surfaced read-only in the lead card; merged into the composed
   * prompt by the generate endpoint.
   */
  sellerBrief: string | null
  shareToken: string | null
  /**
   * Full client-facing URL for sharing the prototipo. Composed server-side
   * by `buildPrototypeShareUrl` only when the workspace is ready/delivery
   * and the token is not superseded — `null` otherwise so the UI can hide
   * the "Copiar link" affordance without recomputing the rule client-side.
   */
  shareUrl: string | null
}

export interface PrototypeWorkspaceListItemWire extends PrototypeWorkspaceWire {
  leadName: string
  projectName: string | null
  requestedByName: string
  generatedAt: string | null
  generatedContent: string | null
  demoUrl: string | null
  chatUrl: string | null
}

export function deserializePrototypeWorkspace(workspace: PrototypeWorkspaceWire): PrototypeWorkspace {
  return {
    id: workspace.id,
    leadId: workspace.leadId,
    projectId: workspace.projectId ?? undefined,
    requestedByProfileId: workspace.requestedByProfileId,
    currentStage: workspace.currentStage,
    status: workspace.status,
    lastOperationId: workspace.lastOperationId ?? undefined,
    generationPrompt: workspace.generationPrompt ?? undefined,
    generatedContent: workspace.generatedContent ?? undefined,
    generatedAt: workspace.generatedAt ? new Date(workspace.generatedAt) : undefined,
    createdAt: new Date(workspace.createdAt),
    updatedAt: new Date(workspace.updatedAt),
    sellerBrief: workspace.sellerBrief ?? undefined,
    shareToken: workspace.shareToken ?? undefined,
    shareUrl: workspace.shareUrl ?? undefined,
  }
}

export function deserializePrototypeWorkspaceListItem(
  workspace: PrototypeWorkspaceListItemWire
): PrototypeWorkspaceListItem {
  return {
    ...deserializePrototypeWorkspace(workspace),
    leadName: workspace.leadName,
    projectName: workspace.projectName ?? undefined,
    requestedByName: workspace.requestedByName,
    generatedAt: workspace.generatedAt ? new Date(workspace.generatedAt) : undefined,
    generatedContent: workspace.generatedContent ?? undefined,
    demoUrl: workspace.demoUrl ?? undefined,
    chatUrl: workspace.chatUrl ?? undefined,
  }
}
