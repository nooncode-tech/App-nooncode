import type { Database } from '@/lib/server/supabase/database.types'

export type LeadProposalRow = Database['public']['Tables']['lead_proposals']['Row']
export type LeadProposalInsert = Database['public']['Tables']['lead_proposals']['Insert']
export type LeadProposalUpdate = Database['public']['Tables']['lead_proposals']['Update']

export interface LeadProposalRowWithLinkedProject extends LeadProposalRow {
  linked_project: Array<{
    id: string
    name: string
    status: Database['public']['Enums']['project_status']
    created_at: string
  }> | null
}
