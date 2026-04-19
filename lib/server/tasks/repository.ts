import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { TaskInsert, TaskRowWithProfiles, TaskUpdate } from '@/lib/server/tasks/types'

type DatabaseClient = SupabaseClient<Database>

const taskSelect = `
  id,
  project_id,
  created_by,
  title,
  description,
  status,
  priority,
  assigned_legacy_user_id,
  due_date,
  estimated_hours,
  actual_hours,
  created_at,
  updated_at,
  assigned_profile:user_profiles!tasks_assigned_legacy_user_id_fkey(full_name, legacy_mock_id)
`

export async function listTasks(client: DatabaseClient): Promise<TaskRowWithProfiles[]> {
  const { data, error } = await client
    .from('tasks')
    .select(taskSelect)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list tasks: ${error.message}`)
  }

  return (data ?? []) as TaskRowWithProfiles[]
}

export async function getTaskById(
  client: DatabaseClient,
  taskId: string
): Promise<TaskRowWithProfiles | null> {
  const { data, error } = await client
    .from('tasks')
    .select(taskSelect)
    .eq('id', taskId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load task: ${error.message}`)
  }

  return (data ?? null) as TaskRowWithProfiles | null
}

export async function createTask(
  client: DatabaseClient,
  task: TaskInsert
): Promise<TaskRowWithProfiles> {
  const { data, error } = await client
    .from('tasks')
    .insert(task)
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create task: ${error?.message ?? 'No task returned.'}`)
  }

  const createdTask = await getTaskById(client, data.id)

  if (!createdTask) {
    throw new Error('Failed to load created task.')
  }

  return createdTask
}

export async function updateTaskById(
  client: DatabaseClient,
  taskId: string,
  updates: TaskUpdate
): Promise<TaskRowWithProfiles> {
  const { error } = await client
    .from('tasks')
    .update(updates)
    .eq('id', taskId)

  if (error) {
    throw new Error(`Failed to update task: ${error.message}`)
  }

  const updatedTask = await getTaskById(client, taskId)

  if (!updatedTask) {
    throw new Error('Failed to load updated task.')
  }

  return updatedTask
}
