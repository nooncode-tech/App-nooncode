import type { Database } from '@/lib/server/supabase/database.types'

export type LeadActivityRow = Database['public']['Tables']['lead_activities']['Row']
export type ProjectActivityRow = Database['public']['Tables']['project_activities']['Row']
export type TaskActivityRow = Database['public']['Tables']['task_activities']['Row']

export interface RecentLeadUpdateRow extends LeadActivityRow {
  actor_profile: {
    full_name: string
    legacy_mock_id: string | null
  } | null
  lead: {
    id: string
    name: string
    company: string | null
  } | null
}

export interface RecentTaskUpdateRow extends TaskActivityRow {
  actor_profile: {
    full_name: string
    legacy_mock_id: string | null
  } | null
  task: {
    id: string
    title: string
    project: {
      id: string
      name: string
    } | null
  } | null
}

export interface RecentProjectUpdateRow extends ProjectActivityRow {
  actor_profile: {
    full_name: string
    legacy_mock_id: string | null
  } | null
  project: {
    id: string
    name: string
  } | null
}
