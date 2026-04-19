import type { Database } from '@/lib/server/supabase/database.types'

export type TaskRow = Database['public']['Tables']['tasks']['Row']
export type TaskInsert = Database['public']['Tables']['tasks']['Insert']
export type TaskUpdate = Database['public']['Tables']['tasks']['Update']

export interface TaskRowWithProfiles extends TaskRow {
  assigned_profile: {
    full_name: string
    legacy_mock_id: string | null
  } | null
}
