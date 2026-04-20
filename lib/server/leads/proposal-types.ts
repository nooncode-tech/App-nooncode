import type { Database } from '@/lib/server/supabase/database.types'
import type { ProposalReviewStatus } from '@/lib/types'

export type LeadProposalRow = Database['public']['Tables']['lead_proposals']['Row']
export type LeadProposalInsert = Database['public']['Tables']['lead_proposals']['Insert']
export type LeadProposalUpdate = Database['public']['Tables']['lead_proposals']['Update']

// Campos añadidos en migration 0027 — no presentes en database.types hasta regenerar
export interface LeadProposalLifecycleFields {
  review_status: ProposalReviewStatus
  first_opened_at: string | null
  expires_at: string | null
  version_number: number
  superseded_by: string | null
  is_special_case: boolean
  reviewer_id: string | null
  reviewed_at: string | null
}

export interface LeadProposalRowWithLinkedProject extends LeadProposalRow, LeadProposalLifecycleFields {
  linked_project: Array<{
    id: string
    name: string
    status: Database['public']['Enums']['project_status']
    created_at: string
  }> | null
}
