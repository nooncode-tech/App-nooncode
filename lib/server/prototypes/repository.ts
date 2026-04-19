import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  HandoffPrototypeWorkspaceRpcRow,
  LinkLeadPrototypeWorkspaceRpcRow,
  PrototypeWorkspaceRow,
  PrototypeWorkspaceRowWithRelations,
} from '@/lib/server/prototypes/types'

type DatabaseClient = SupabaseClient<Database>

const prototypeWorkspaceSelect = `
  id,
  lead_id,
  project_id,
  requested_by_profile_id,
  current_stage,
  status,
  last_operation_id,
  created_at,
  updated_at
`

const prototypeWorkspaceListSelect = `
  id,
  lead_id,
  project_id,
  requested_by_profile_id,
  current_stage,
  status,
  last_operation_id,
  created_at,
  updated_at,
  lead:leads!prototype_workspaces_lead_id_fkey(id, name),
  project:projects!prototype_workspaces_project_id_fkey(id, name),
  requested_by:user_profiles!prototype_workspaces_requested_by_profile_id_fkey(id, full_name)
`

export async function getPrototypeWorkspaceByLeadId(
  client: DatabaseClient,
  leadId: string
): Promise<PrototypeWorkspaceRow | null> {
  const { data, error } = await client
    .from('prototype_workspaces')
    .select(prototypeWorkspaceSelect)
    .eq('lead_id', leadId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load prototype workspace: ${error.message}`)
  }

  return (data ?? null) as PrototypeWorkspaceRow | null
}

export async function getPrototypeWorkspaceById(
  client: DatabaseClient,
  prototypeWorkspaceId: string
): Promise<PrototypeWorkspaceRow | null> {
  const { data, error } = await client
    .from('prototype_workspaces')
    .select(prototypeWorkspaceSelect)
    .eq('id', prototypeWorkspaceId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load prototype workspace by id: ${error.message}`)
  }

  return (data ?? null) as PrototypeWorkspaceRow | null
}

export async function listPrototypeWorkspaces(
  client: DatabaseClient,
  options: {
    leadId?: string
    limit: number
  }
): Promise<PrototypeWorkspaceRowWithRelations[]> {
  let query = client
    .from('prototype_workspaces')
    .select(prototypeWorkspaceListSelect)
    .order('updated_at', { ascending: false })
    .limit(options.limit)

  if (options.leadId) {
    query = query.eq('lead_id', options.leadId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to list prototype workspaces: ${error.message}`)
  }

  return (data ?? []) as PrototypeWorkspaceRowWithRelations[]
}

export async function listPrototypeWorkspacesByProjectIds(
  client: DatabaseClient,
  projectIds: string[]
): Promise<PrototypeWorkspaceRowWithRelations[]> {
  if (projectIds.length === 0) {
    return []
  }

  const { data, error } = await client
    .from('prototype_workspaces')
    .select(prototypeWorkspaceListSelect)
    .in('project_id', projectIds)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list prototype workspaces by project ids: ${error.message}`)
  }

  return (data ?? []) as PrototypeWorkspaceRowWithRelations[]
}

export async function handoffPrototypeWorkspaceToDelivery(
  client: DatabaseClient,
  prototypeWorkspaceId: string
): Promise<HandoffPrototypeWorkspaceRpcRow> {
  const { data, error } = await client.rpc('handoff_prototype_workspace_to_delivery', {
    target_workspace_id: prototypeWorkspaceId,
  })

  if (error || !data) {
    throw new Error(error?.message ?? 'Prototype workspace handoff did not return a result.')
  }

  return data as HandoffPrototypeWorkspaceRpcRow
}

export async function linkLeadPrototypeWorkspaceToProject(
  client: DatabaseClient,
  leadId: string,
  projectId: string
): Promise<LinkLeadPrototypeWorkspaceRpcRow> {
  const { data, error } = await client.rpc('link_lead_prototype_workspace_to_project', {
    target_lead_id: leadId,
    target_project_id: projectId,
  })

  if (error || !Array.isArray(data) || data.length === 0) {
    throw new Error(error?.message ?? 'Prototype workspace project linkage did not return a result.')
  }

  return data[0] as LinkLeadPrototypeWorkspaceRpcRow
}
