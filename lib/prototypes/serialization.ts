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
}

export interface PrototypeWorkspaceListItemWire extends PrototypeWorkspaceWire {
  leadName: string
  projectName: string | null
  requestedByName: string
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
  }
}
