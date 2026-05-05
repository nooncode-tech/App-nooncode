import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  ProjectActivityRowWithActor,
  ProjectTaskActivityRowWithActor,
} from '@/lib/server/projects/activity-types'

type DatabaseClient = SupabaseClient<Database>

const projectActivitySelect = `
  id,
  project_id,
  activity_type,
  actor_profile_id,
  metadata,
  created_at,
  actor_profile:user_profiles!project_activities_actor_profile_id_fkey(full_name, legacy_mock_id)
`

const taskActivityByProjectSelect = `
  id,
  task_id,
  activity_type,
  actor_profile_id,
  note_body,
  metadata,
  created_at,
  actor_profile:user_profiles!task_activities_actor_profile_id_fkey(full_name, legacy_mock_id),
  task:tasks!task_activities_task_id_fkey(id, title, project_id)
`

export async function listProjectActivities(
  client: DatabaseClient,
  projectId: string
): Promise<ProjectActivityRowWithActor[]> {
  const { data, error } = await client
    .from('project_activities')
    .select(projectActivitySelect)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list project activities: ${error.message}`)
  }

  return (data ?? []) as ProjectActivityRowWithActor[]
}

export async function listTaskActivitiesByProject(
  client: DatabaseClient,
  projectId: string
): Promise<ProjectTaskActivityRowWithActor[]> {
  const { data, error } = await client
    .from('task_activities')
    .select(taskActivityByProjectSelect)
    .eq('task.project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list task activities by project: ${error.message}`)
  }

  return (data ?? []) as ProjectTaskActivityRowWithActor[]
}
