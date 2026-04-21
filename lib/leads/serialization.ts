import type { Lead, LeadOrigin } from '@/lib/types'

export interface LeadWire {
  id: string
  name: string
  email: string
  phone: string | null
  whatsapp: string | null
  company: string | null
  source: Lead['source']
  status: Lead['status']
  score: number
  value: number
  assignedTo: string | null
  assignmentStatus: Lead['assignmentStatus']
  lockedByProposalId: string | null
  lockedAt: string | null
  releasedAt: string | null
  notes: string | null
  tags: string[]
  locationText: string | null
  latitude: number | null
  longitude: number | null
  leadOrigin: LeadOrigin | null
  createdAt: string
  updatedAt: string
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  autoFollowupEnabled: boolean
}

export function deserializeLead(lead: LeadWire): Lead {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone ?? undefined,
    whatsapp: lead.whatsapp ?? undefined,
    company: lead.company ?? undefined,
    source: lead.source,
    status: lead.status,
    score: lead.score,
    value: lead.value,
    assignedTo: lead.assignedTo ?? undefined,
    assignmentStatus: lead.assignmentStatus,
    lockedByProposalId: lead.lockedByProposalId ?? undefined,
    lockedAt: lead.lockedAt ? new Date(lead.lockedAt) : undefined,
    releasedAt: lead.releasedAt ? new Date(lead.releasedAt) : undefined,
    notes: lead.notes ?? undefined,
    tags: lead.tags,
    locationText: lead.locationText ?? undefined,
    latitude: lead.latitude ?? undefined,
    longitude: lead.longitude ?? undefined,
    leadOrigin: lead.leadOrigin ?? undefined,
    createdAt: new Date(lead.createdAt),
    updatedAt: new Date(lead.updatedAt),
    lastContactedAt: lead.lastContactedAt ? new Date(lead.lastContactedAt) : undefined,
    nextFollowUpAt: lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : undefined,
    autoFollowupEnabled: lead.autoFollowupEnabled,
  }
}
