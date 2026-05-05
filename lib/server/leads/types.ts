import type { Database } from '@/lib/server/supabase/database.types'

export type LeadRow = Database['public']['Tables']['leads']['Row']
export type LeadInsert = Database['public']['Tables']['leads']['Insert']
export type LeadUpdate = Database['public']['Tables']['leads']['Update']

export interface LeadRowWithProfiles extends LeadRow {
  assigned_profile: {
    legacy_mock_id: string | null
    full_name?: string | null
  } | null
}
