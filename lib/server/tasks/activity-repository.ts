import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  TaskActivityInsert,
  TaskActivityRowWithActor,
} from '@/lib/server/tasks/activity-types'

type DatabaseClient = SupabaseClient<Database>

const taskActivitySelect = `
  id,
  task_id,
  activity_type,
  actor_profile_id,
  note_body,
  metadata,
  created_at,
  actor_profile:user_profiles!task_activities_actor_profile_id_fkey(full_name, legacy_mock_id)
`

export async function listTaskActivities(
  client: DatabaseClient,
  taskId: string
): Promise<TaskActivityRowWithActor[]> {
  const { data, error } = await client
    .from('task_activities')
    .select(taskActivitySelect)
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list task activities: ${error.message}`)
  }

  return (data ?? []) as TaskActivityRowWithActor[]
}

export async function createTaskActivity(
  client: DatabaseClient,
  activity: TaskActivityInsert
): Promise<TaskActivityRowWithActor> {
  const { data, error } = await client
    .from('task_activities')
    .insert(activity)
    .select(taskActivitySelect)
    .single()

  if (error || !data) {
    throw new Error(`Failed to create task activity: ${error?.message ?? 'No activity returned.'}`)
  }

  return data as TaskActivityRowWithActor
}
