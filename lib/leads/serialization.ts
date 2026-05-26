import type {
  Lead,
  LeadOrigin,
  MaxwellConfidence,
  MaxwellLeadSnapshot,
  MaxwellPublicationStatus,
} from '@/lib/types'

export interface LeadWire {
  id: string
  name: string
  email: string | null
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
  publicationStatus: MaxwellPublicationStatus | null
  maxwellSnapshot: MaxwellLeadSnapshot | null
  maxwellSearchRunId: string | null
  maxwellExpiresAt: string | null
  maxwellLastRefreshedAt: string | null
  maxwellDedupeKey: string | null
  maxwellConfidence: MaxwellConfidence | null
  createdAt: string
  updatedAt: string
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  autoFollowupEnabled: boolean
  nicheId: string | null
}

export function deserializeLead(lead: LeadWire): Lead {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email ?? undefined,
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
    publicationStatus: lead.publicationStatus ?? undefined,
    maxwellSnapshot: lead.maxwellSnapshot ?? undefined,
    maxwellSearchRunId: lead.maxwellSearchRunId ?? undefined,
    maxwellExpiresAt: lead.maxwellExpiresAt ? new Date(lead.maxwellExpiresAt) : undefined,
    maxwellLastRefreshedAt: lead.maxwellLastRefreshedAt
      ? new Date(lead.maxwellLastRefreshedAt)
      : undefined,
    maxwellDedupeKey: lead.maxwellDedupeKey ?? undefined,
    maxwellConfidence: lead.maxwellConfidence ?? undefined,
    createdAt: new Date(lead.createdAt),
    updatedAt: new Date(lead.updatedAt),
    lastContactedAt: lead.lastContactedAt ? new Date(lead.lastContactedAt) : undefined,
    nextFollowUpAt: lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : undefined,
    autoFollowupEnabled: lead.autoFollowupEnabled,
    nicheId: lead.nicheId ?? undefined,
  }
}
