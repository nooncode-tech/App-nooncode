import type { LeadActivity } from '@/lib/types'

export interface LeadActivityWire {
  id: string
  leadId: string
  type: LeadActivity['type']
  actorId: string | null
  actorName: string
  noteBody: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export function deserializeLeadActivity(activity: LeadActivityWire): LeadActivity {
  return {
    id: activity.id,
    leadId: activity.leadId,
    type: activity.type,
    actorId: activity.actorId ?? undefined,
    actorName: activity.actorName,
    noteBody: activity.noteBody ?? undefined,
    metadata: activity.metadata ?? undefined,
    createdAt: new Date(activity.createdAt),
  }
}
