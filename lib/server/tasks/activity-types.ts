import type { Database } from '@/lib/server/supabase/database.types'

export type TaskActivityRow = Database['public']['Tables']['task_activities']['Row']
export type TaskActivityInsert = Database['public']['Tables']['task_activities']['Insert']

export interface TaskActivityRowWithActor extends TaskActivityRow {
  actor_profile: {
    full_name: string
    legacy_mock_id: string | null
  } | null
}
