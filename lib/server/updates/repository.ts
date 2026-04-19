import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  RecentLeadUpdateRow,
  RecentProjectUpdateRow,
  RecentTaskUpdateRow,
} from '@/lib/server/updates/types'

type DatabaseClient = SupabaseClient<Database>

const recentLeadUpdateSelect = `
  id,
  lead_id,
  activity_type,
  actor_profile_id,
  note_body,
  metadata,
  created_at,
  actor_profile:user_profiles!lead_activities_actor_profile_id_fkey(full_name, legacy_mock_id),
  lead:leads!lead_activities_lead_id_fkey(id, name, company)
`

const recentTaskUpdateSelect = `
  id,
  task_id,
  activity_type,
  actor_profile_id,
  note_body,
  metadata,
  created_at,
  actor_profile:user_profiles!task_activities_actor_profile_id_fkey(full_name, legacy_mock_id),
  task:tasks!task_activities_task_id_fkey(
    id,
    title,
    project:projects!tasks_project_id_fkey(id, name)
  )
`

const recentProjectUpdateSelect = `
  id,
  project_id,
  activity_type,
  actor_profile_id,
  metadata,
  created_at,
  actor_profile:user_profiles!project_activities_actor_profile_id_fkey(full_name, legacy_mock_id),
  project:projects!project_activities_project_id_fkey(id, name)
`

export async function listRecentLeadUpdates(
  client: DatabaseClient,
  limit: number
): Promise<RecentLeadUpdateRow[]> {
  const { data, error } = await client
    .from('lead_activities')
    .select(recentLeadUpdateSelect)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to list recent lead updates: ${error.message}`)
  }

  return (data ?? []) as RecentLeadUpdateRow[]
}

export async function listRecentTaskUpdates(
  client: DatabaseClient,
  limit: number
): Promise<RecentTaskUpdateRow[]> {
  const { data, error } = await client
    .from('task_activities')
    .select(recentTaskUpdateSelect)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to list recent task updates: ${error.message}`)
  }

  return (data ?? []) as RecentTaskUpdateRow[]
}

export async function listRecentProjectUpdates(
  client: DatabaseClient,
  limit: number
): Promise<RecentProjectUpdateRow[]> {
  const { data, error } = await client
    .from('project_activities')
    .select(recentProjectUpdateSelect)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to list recent project updates: ${error.message}`)
  }

  return (data ?? []) as RecentProjectUpdateRow[]
}
