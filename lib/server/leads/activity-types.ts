import type { Database } from '@/lib/server/supabase/database.types'

export type LeadActivityRow = Database['public']['Tables']['lead_activities']['Row']
export type LeadActivityInsert = Database['public']['Tables']['lead_activities']['Insert']

export interface LeadActivityRowWithActor extends LeadActivityRow {
  actor_profile: {
    full_name: string
    legacy_mock_id: string | null
  } | null
}
