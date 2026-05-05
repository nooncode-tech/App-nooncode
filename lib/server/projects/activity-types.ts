import type { Database } from '@/lib/server/supabase/database.types'

export type ProjectActivityRow = Database['public']['Tables']['project_activities']['Row']

export interface ProjectActivityRowWithActor extends ProjectActivityRow {
  actor_profile: {
    full_name: string
    legacy_mock_id: string | null
  } | null
}

export interface ProjectTaskActivityRowWithActor {
  id: string
  task_id: string
  activity_type: Database['public']['Enums']['task_activity_type']
  actor_profile_id: string | null
  note_body: string | null
  metadata: Database['public']['Tables']['task_activities']['Row']['metadata']
  created_at: string
  actor_profile: {
    full_name: string
    legacy_mock_id: string | null
  } | null
  task: {
    id: string
    title: string
    project_id: string
  } | null
}
