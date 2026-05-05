import type { Database } from '@/lib/server/supabase/database.types'

export type ProjectRow = Database['public']['Tables']['projects']['Row']
export type ProjectInsert = Database['public']['Tables']['projects']['Insert']
export type ProjectUpdate = Database['public']['Tables']['projects']['Update']

export interface ProjectRowWithLineage extends ProjectRow {
  source_lead: {
    id: string
    name: string
    company: string | null
  } | null
  source_proposal: {
    id: string
    title: string
  } | null
  prototype_workspace: Array<{
    id: string
    requested_by_profile_id: string
    current_stage: Database['public']['Enums']['prototype_stage']
    status: Database['public']['Enums']['prototype_workspace_status']
    created_at: string
    requested_by: {
      full_name: string
    } | null
  }> | null
}
