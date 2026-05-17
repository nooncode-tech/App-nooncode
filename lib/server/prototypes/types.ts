import type { Database } from '@/lib/server/supabase/database.types'

export type PrototypeWorkspaceRow = Database['public']['Tables']['prototype_workspaces']['Row']
export type HandoffPrototypeWorkspaceRpcRow =
  Database['public']['Functions']['handoff_prototype_workspace_to_delivery']['Returns']
export type LinkLeadPrototypeWorkspaceRpcRow =
  Database['public']['Functions']['link_lead_prototype_workspace_to_project']['Returns'][number]

export interface PrototypeWorkspaceRowWithRelations extends PrototypeWorkspaceRow {
  lead: {
    id: string
    name: string
  } | null
  project: {
    id: string
    name: string
  } | null
  requested_by: {
    id: string
    full_name: string
  } | null
}
