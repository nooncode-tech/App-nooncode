import type { Project } from '@/lib/types'

export interface ProjectWire {
  id: string
  name: string
  description: string | null
  clientId?: string
  clientName: string
  status: Project['status']
  budget: number
  startDate: string | null
  endDate: string | null
  pmId: string | null
  pmName: string | null | undefined
  teamIds: string[]
  createdAt: string
  updatedAt: string
  sourceLeadId: string | null
  sourceLeadName: string | null
  sourceProposalId: string | null
  sourceProposalTitle: string | null
  handoffReadyAt: string | null
  prototypeWorkspaceId: string | null
  prototypeWorkspaceStatus: Project['prototypeWorkspaceStatus'] | null
  prototypeWorkspaceStage: Project['prototypeWorkspaceStage'] | null
  prototypeRequestedByName: string | null
  prototypeCreatedAt: string | null
}

export function deserializeProject(project: ProjectWire): Project {
  return {
    id: project.id,
    name: project.name,
    description: project.description ?? undefined,
    clientId: project.clientId,
    clientName: project.clientName,
    status: project.status,
    budget: project.budget,
    startDate: project.startDate ? new Date(project.startDate) : undefined,
    endDate: project.endDate ? new Date(project.endDate) : undefined,
    pmId: project.pmId ?? undefined,
    pmName: project.pmName ?? undefined,
    teamIds: project.teamIds,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    sourceLeadId: project.sourceLeadId ?? undefined,
    sourceLeadName: project.sourceLeadName ?? undefined,
    sourceProposalId: project.sourceProposalId ?? undefined,
    sourceProposalTitle: project.sourceProposalTitle ?? undefined,
    handoffReadyAt: project.handoffReadyAt ? new Date(project.handoffReadyAt) : undefined,
    prototypeWorkspaceId: project.prototypeWorkspaceId ?? undefined,
    prototypeWorkspaceStatus: project.prototypeWorkspaceStatus ?? undefined,
    prototypeWorkspaceStage: project.prototypeWorkspaceStage ?? undefined,
    prototypeRequestedByName: project.prototypeRequestedByName ?? undefined,
    prototypeCreatedAt: project.prototypeCreatedAt ? new Date(project.prototypeCreatedAt) : undefined,
  }
}
