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
  review_status,
  first_opened_at,
  expires_at,
  version_number,
  superseded_by,
  is_special_case,
  reviewer_id,
  reviewed_at,
  payment_status,
  paid_at,
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

  return (data ?? []) as unknown as LeadProposalRowWithLinkedProject[]
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

  return data as unknown as LeadProposalRowWithLinkedProject
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

  return (data ?? null) as unknown as LeadProposalRowWithLinkedProject | null
}

export async function markProposalFirstOpened(
  client: DatabaseClient,
  proposalId: string
): Promise<LeadProposalRowWithLinkedProject> {
  const { data, error } = await client
    .from('lead_proposals')
    .update({ first_opened_at: new Date().toISOString() } as never)
    .eq('id', proposalId)
    .is('first_opened_at', null)
    .select(leadProposalSelect)
    .maybeSingle()

  if (error) throw new Error(`Failed to mark proposal opened: ${error.message}`)

  // If data is null, first_opened_at was already set — re-fetch
  if (!data) {
    const existing = await getLeadProposalById(client, proposalId)
    if (!existing) throw new Error('Proposal not found')
    return existing
  }

  return data as unknown as LeadProposalRowWithLinkedProject
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

  return data as unknown as LeadProposalRowWithLinkedProject
}
