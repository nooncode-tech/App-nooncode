import type { LeadProposal, ProjectStatus } from '@/lib/types'

export interface LeadProposalWire {
  id: string
  leadId: string
  title: string
  body: string
  amount: number
  currency: string
  status: LeadProposal['status']
  createdAt: string
  updatedAt: string
  sentAt: string | null
  acceptedAt: string | null
  handoffReadyAt: string | null
  linkedProject: {
    id: string
    name: string
    status: ProjectStatus
    createdAt: string
  } | null
}

export function deserializeLeadProposal(proposal: LeadProposalWire): LeadProposal {
  return {
    id: proposal.id,
    leadId: proposal.leadId,
    title: proposal.title,
    body: proposal.body,
    amount: proposal.amount,
    currency: proposal.currency,
    status: proposal.status,
    createdAt: new Date(proposal.createdAt),
    updatedAt: new Date(proposal.updatedAt),
    sentAt: proposal.sentAt ? new Date(proposal.sentAt) : undefined,
    acceptedAt: proposal.acceptedAt ? new Date(proposal.acceptedAt) : undefined,
    handoffReadyAt: proposal.handoffReadyAt ? new Date(proposal.handoffReadyAt) : undefined,
    linkedProject: proposal.linkedProject
      ? {
          id: proposal.linkedProject.id,
          name: proposal.linkedProject.name,
          status: proposal.linkedProject.status,
          createdAt: new Date(proposal.linkedProject.createdAt),
        }
      : undefined,
  }
}
