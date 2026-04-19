import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  LeadActivityInsert,
  LeadActivityRowWithActor,
} from '@/lib/server/leads/activity-types'

type DatabaseClient = SupabaseClient<Database>

const leadActivitySelect = `
  id,
  lead_id,
  activity_type,
  actor_profile_id,
  note_body,
  metadata,
  created_at,
  actor_profile:user_profiles!lead_activities_actor_profile_id_fkey(full_name, legacy_mock_id)
`

export async function listLeadActivities(
  client: DatabaseClient,
  leadId: string
): Promise<LeadActivityRowWithActor[]> {
  const { data, error } = await client
    .from('lead_activities')
    .select(leadActivitySelect)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list lead activities: ${error.message}`)
  }

  return (data ?? []) as LeadActivityRowWithActor[]
}

export async function createLeadActivity(
  client: DatabaseClient,
  activity: LeadActivityInsert
): Promise<LeadActivityRowWithActor> {
  const { data, error } = await client
    .from('lead_activities')
    .insert(activity)
    .select(leadActivitySelect)
    .single()

  if (error || !data) {
    throw new Error(`Failed to create lead activity: ${error?.message ?? 'No activity returned.'}`)
  }

  return data as LeadActivityRowWithActor
}
