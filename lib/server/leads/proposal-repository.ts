import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  LeadProposalInsert,
  LeadProposalRowWithLinkedProject,
  LeadProposalUpdate,
} from '@/lib/server/leads/proposal-types'

type DatabaseClient = SupabaseClient<Database>

const leadProposalSelect = `
  id,
  lead_id,
  created_by,
  title,
  body,
  amount,
  currency,
  status,
  sent_at,
  accepted_at,
  handoff_ready_at,
  created_at,
  updated_at,
  linked_project:projects!projects_source_proposal_id_fkey(id, name, status, created_at)
`

export async function listLeadProposals(
  client: DatabaseClient,
  leadId: string
): Promise<LeadProposalRowWithLinkedProject[]> {
  const { data, error } = await client
    .from('lead_proposals')
    .select(leadProposalSelect)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list lead proposals: ${error.message}`)
  }

  return (data ?? []) as LeadProposalRowWithLinkedProject[]
}

export async function createLeadProposal(
  client: DatabaseClient,
  proposal: LeadProposalInsert
): Promise<LeadProposalRowWithLinkedProject> {
  const { data, error } = await client
    .from('lead_proposals')
    .insert(proposal)
    .select(leadProposalSelect)
    .single()

  if (error || !data) {
    throw new Error(`Failed to create lead proposal: ${error?.message ?? 'No proposal returned.'}`)
  }

  return data as LeadProposalRowWithLinkedProject
}

export async function getLeadProposalById(
  client: DatabaseClient,
  proposalId: string
): Promise<LeadProposalRowWithLinkedProject | null> {
  const { data, error } = await client
    .from('lead_proposals')
    .select(leadProposalSelect)
    .eq('id', proposalId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load lead proposal: ${error.message}`)
  }

  return (data ?? null) as LeadProposalRowWithLinkedProject | null
}

export async function updateLeadProposalById(
  client: DatabaseClient,
  proposalId: string,
  updates: LeadProposalUpdate
): Promise<LeadProposalRowWithLinkedProject> {
  const { data, error } = await client
    .from('lead_proposals')
    .update(updates)
    .eq('id', proposalId)
    .select(leadProposalSelect)
    .single()

  if (error || !data) {
    throw new Error(`Failed to update lead proposal: ${error?.message ?? 'No proposal returned.'}`)
  }

  return data as LeadProposalRowWithLinkedProject
}
