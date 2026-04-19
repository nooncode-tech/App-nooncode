import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { LeadInsert, LeadUpdate, LeadRowWithProfiles } from '@/lib/server/leads/types'

type DatabaseClient = SupabaseClient<Database>

const leadSelect = `
  id,
  legacy_mock_id,
  name,
  email,
  phone,
  company,
  source,
  status,
  score,
  value,
  assigned_to,
  assignment_status,
  locked_by_proposal_id,
  locked_at,
  released_at,
  created_by,
  notes,
  tags,
  last_contacted_at,
  next_follow_up_at,
  location_text,
  latitude,
  longitude,
  lead_origin,
  created_at,
  updated_at,
  assigned_profile:user_profiles!leads_assigned_to_fkey(legacy_mock_id, full_name)
`

export async function listLeads(client: DatabaseClient): Promise<LeadRowWithProfiles[]> {
  const { data, error } = await client
    .from('leads')
    .select(leadSelect)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list leads: ${error.message}`)
  }

  return (data ?? []) as LeadRowWithProfiles[]
}

export async function getLeadById(
  client: DatabaseClient,
  leadId: string
): Promise<LeadRowWithProfiles | null> {
  const { data, error } = await client
    .from('leads')
    .select(leadSelect)
    .eq('id', leadId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load lead: ${error.message}`)
  }

  return (data ?? null) as LeadRowWithProfiles | null
}

export async function createLead(
  client: DatabaseClient,
  lead: LeadInsert
): Promise<LeadRowWithProfiles> {
  const { data, error } = await client
    .from('leads')
    .insert(lead)
    .select(leadSelect)
    .single()

  if (error || !data) {
    throw new Error(`Failed to create lead: ${error?.message ?? 'No lead returned.'}`)
  }

  return data as LeadRowWithProfiles
}

export async function updateLeadById(
  client: DatabaseClient,
  leadId: string,
  updates: LeadUpdate
): Promise<LeadRowWithProfiles> {
  const { data, error } = await client
    .from('leads')
    .update(updates)
    .eq('id', leadId)
    .select(leadSelect)
    .single()

  if (error || !data) {
    throw new Error(`Failed to update lead: ${error?.message ?? 'No lead returned.'}`)
  }

  return data as LeadRowWithProfiles
}

export async function deleteLeadById(client: DatabaseClient, leadId: string): Promise<void> {
  const { error } = await client
    .from('leads')
    .delete()
    .eq('id', leadId)

  if (error) {
    throw new Error(`Failed to delete lead: ${error.message}`)
  }
}

export async function claimReleasedLeadById(
  client: DatabaseClient,
  leadId: string
): Promise<LeadRowWithProfiles> {
  const { data, error } = await client.rpc('claim_released_lead', {
    target_lead_id: leadId,
  })

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to claim released lead.')
  }

  const lead = await getLeadById(client, data)

  if (!lead) {
    throw new Error('Claimed lead could not be reloaded.')
  }

  return lead
}

export async function releaseLeadAsNoResponseById(
  client: DatabaseClient,
  leadId: string
): Promise<LeadRowWithProfiles> {
  const { data, error } = await client.rpc('release_lead_as_no_response', {
    target_lead_id: leadId,
  })

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to release lead.')
  }

  const lead = await getLeadById(client, data)

  if (!lead) {
    throw new Error('Released lead could not be reloaded.')
  }

  return lead
}
