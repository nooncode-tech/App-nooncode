import type { LeadActivityWire } from '@/lib/leads/activity-serialization'
import type {
  LeadActivityInsert,
  LeadActivityRowWithActor,
} from '@/lib/server/leads/activity-types'
import type { CreateLeadNoteInput } from '@/lib/server/leads/activity-schema'

function normalizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  return metadata as Record<string, unknown>
}

export function mapLeadActivityRowToWire(row: LeadActivityRowWithActor): LeadActivityWire {
  return {
    id: row.id,
    leadId: row.lead_id,
    type: row.activity_type,
    actorId: row.actor_profile?.legacy_mock_id ?? row.actor_profile_id,
    actorName: row.actor_profile?.full_name ?? 'Sistema',
    noteBody: row.note_body,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at,
  }
}

export function mapCreateLeadNoteInputToInsert(
  input: CreateLeadNoteInput,
  leadId: string,
  principalUserId: string
): LeadActivityInsert {
  return {
    lead_id: leadId,
    activity_type: 'note_added',
    actor_profile_id: principalUserId,
    note_body: input.body,
    metadata: {},
  }
}
