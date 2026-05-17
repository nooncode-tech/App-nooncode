import type { Database } from '@/lib/server/supabase/database.types'

// Manual extension of the generated Row with the F-V06 columns (migration 0046).
// Regenerated types are blocked by G7 (schema↔ledger desync); remove the
// intersection once `database.types.ts` is regenerated and these columns appear
// in the generated Row.
export type PrototypeWorkspaceRow = Database['public']['Tables']['prototype_workspaces']['Row'] & {
  demo_url: string | null
  chat_url: string | null
}
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
