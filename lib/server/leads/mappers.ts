import type { LeadWire } from '@/lib/leads/serialization'
import type { LeadInsert, LeadRowWithProfiles, LeadUpdate } from '@/lib/server/leads/types'
import type { CreateLeadInput, UpdateLeadInput } from '@/lib/server/leads/schema'

export function mapLeadRowToWire(row: LeadRowWithProfiles): LeadWire {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    source: row.source,
    status: row.status,
    score: row.score,
    value: Number(row.value),
    assignedTo: row.assigned_profile?.legacy_mock_id ?? row.assigned_to,
    assignmentStatus: row.assignment_status,
    lockedByProposalId: row.locked_by_proposal_id,
    lockedAt: row.locked_at,
    releasedAt: row.released_at,
    notes: row.notes,
    tags: row.tags,
    locationText: row.location_text,
    latitude: row.latitude,
    longitude: row.longitude,
    leadOrigin: row.lead_origin,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastContactedAt: row.last_contacted_at,
    nextFollowUpAt: row.next_follow_up_at,
  }
}

export function mapCreateLeadInputToInsert(
  input: CreateLeadInput,
  principalUserId: string
): LeadInsert {
  return {
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    company: input.company ?? null,
    source: input.source,
    status: input.status,
    score: input.score,
    value: input.value,
    assigned_to: input.assignedTo ?? principalUserId,
    created_by: principalUserId,
    notes: input.notes ?? null,
    tags: input.tags,
    last_contacted_at: input.lastContactedAt ?? null,
    next_follow_up_at: input.nextFollowUpAt ?? null,
    location_text: input.locationText ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    lead_origin: input.leadOrigin,
  }
}

export function mapUpdateLeadInputToUpdate(input: UpdateLeadInput): LeadUpdate {
  const update: LeadUpdate = {}

  if (input.name !== undefined) update.name = input.name
  if (input.email !== undefined) update.email = input.email
  if (input.phone !== undefined) update.phone = input.phone ?? null
  if (input.company !== undefined) update.company = input.company ?? null
  if (input.source !== undefined) update.source = input.source
  if (input.status !== undefined) update.status = input.status
  if (input.score !== undefined) update.score = input.score
  if (input.value !== undefined) update.value = input.value
  if (input.notes !== undefined) update.notes = input.notes ?? null
  if (input.tags !== undefined) update.tags = input.tags
  if (input.assignedTo !== undefined) update.assigned_to = input.assignedTo ?? null
  if (input.lastContactedAt !== undefined) {
    update.last_contacted_at = input.lastContactedAt ?? null
  }
  if (input.nextFollowUpAt !== undefined) {
    update.next_follow_up_at = input.nextFollowUpAt ?? null
  }
  if (input.locationText !== undefined) update.location_text = input.locationText ?? null
  if (input.latitude !== undefined) update.latitude = input.latitude ?? null
  if (input.longitude !== undefined) update.longitude = input.longitude ?? null

  return update
}
