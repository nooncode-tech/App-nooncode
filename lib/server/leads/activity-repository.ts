import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  LeadActivityInsert,
  LeadActivityRowWithActor,
} from '@/lib/server/leads/activity-types'
import type { CursorPayload } from '@/lib/server/pagination/cursor'

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
  leadId: string,
  opts?: { cursor: CursorPayload | null; limit: number }
): Promise<LeadActivityRowWithActor[]> {
  if (opts !== undefined) {
    const { cursor, limit } = opts
    let query = client
      .from('lead_activities')
      .select(leadActivitySelect)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    if (cursor !== null) {
      query = (query as ReturnType<typeof query.order>).or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      )
    }

    const { data, error } = await (query as ReturnType<typeof query.order>).limit(limit + 1)

    if (error) {
      throw new Error(`Failed to list lead activities: ${error.message}`)
    }

    return (data ?? []) as LeadActivityRowWithActor[]
  }

  // Legacy call path (no pagination opts)
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
