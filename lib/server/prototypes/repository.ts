import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/server/supabase/database.types'
import type { CursorPayload } from '@/lib/server/pagination/cursor'
import type {
  HandoffPrototypeWorkspaceRpcRow,
  LinkLeadPrototypeWorkspaceRpcRow,
  PrototypeWorkspaceRow,
  PrototypeWorkspaceRowWithRelations,
} from '@/lib/server/prototypes/types'

type DatabaseClient = SupabaseClient<Database>

export interface PrototypeSignedReadRow {
  workspace: {
    id: string
    lead_id: string
    created_at: string
    demo_url: string | null
    generated_content: string | null
    share_token_superseded_at: string | null
  }
  lead: {
    id: string
    name: string
    company: string | null
    maxwell_snapshot: Json
  } | null
  decision: {
    decision: string
    notes: string | null
    decided_at: string
  } | null
}

const prototypeWorkspaceSelect = `
  id,
  lead_id,
  project_id,
  requested_by_profile_id,
  current_stage,
  status,
  last_operation_id,
  generated_at,
  generated_content,
  demo_url,
  chat_url,
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
  generated_at,
  generated_content,
  demo_url,
  chat_url,
  share_token,
  share_token_superseded_at,
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
  // Per ADR-023 D3 + migration 0060 (R1 refactor): `prototype_workspaces.lead_id`
  // is no longer UNIQUE — regenerate produces V1 / V2 / V3 rows for the same
  // lead. Callers of this helper want the latest (non-superseded if any,
  // otherwise newest by `created_at`) workspace. `.order(created_at desc).limit(1)`
  // is the canonical "latest workspace" pattern.
  const { data, error } = await client
    .from('prototype_workspaces')
    .select(prototypeWorkspaceSelect)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1)
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
    cursor?: CursorPayload | null
  }
): Promise<PrototypeWorkspaceRowWithRelations[]> {
  let query = client
    .from('prototype_workspaces')
    .select(prototypeWorkspaceListSelect)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.limit + 1)

  if (options.leadId) {
    query = query.eq('lead_id', options.leadId)
  }

  if (options.cursor) {
    query = (query as ReturnType<typeof query.lt>).or(
      `updated_at.lt.${options.cursor.createdAt},and(updated_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`
    )
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

// Per ADR-024 D2 + spec fase-3-g22-prototype-signed-read-handler-impl:
// Resolve a workspace by its public `share_token` (migration 0060 element 2),
// joined with parent lead context columns and the single terminal decision (if
// any). The helper DOES NOT filter on `share_token_superseded_at` — the handler
// needs to see superseded rows to map them to `410 PROTOTYPE_READ_TOKEN_SUPERSEDED`.
// Returns null only when no workspace matches the token (handler maps to
// `404 PROTOTYPE_READ_TOKEN_NOT_FOUND`). A `lead === null` payload means the
// parent lead row is missing (FK cascade race; handler maps to `410 PROTOTYPE_READ_LEAD_DELETED`).
export async function getPrototypeWorkspaceByShareToken(
  client: DatabaseClient,
  shareToken: string
): Promise<PrototypeSignedReadRow | null> {
  const { data, error } = await client
    .from('prototype_workspaces')
    .select(
      `
        id,
        lead_id,
        created_at,
        demo_url,
        generated_content,
        share_token_superseded_at,
        lead:leads!prototype_workspaces_lead_id_fkey(id, name, company, maxwell_snapshot),
        decisions:prototype_decisions!prototype_decisions_prototype_workspace_id_fkey(decision, notes, decided_at)
      `
    )
    .eq('share_token', shareToken)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load prototype workspace by share token: ${error.message}`)
  }

  if (!data) {
    return null
  }

  // PostgREST renders embedded foreign relationships as an object when the FK
  // is unique-by-target and as an array otherwise. We defensively normalize
  // both shapes here so the handler reads a uniform object/null.
  const leadEmbed = (data as unknown as { lead: unknown }).lead
  const lead = Array.isArray(leadEmbed)
    ? ((leadEmbed[0] ?? null) as PrototypeSignedReadRow['lead'])
    : ((leadEmbed ?? null) as PrototypeSignedReadRow['lead'])

  const decisionsEmbed = (data as unknown as { decisions: unknown }).decisions
  const decisionArr = Array.isArray(decisionsEmbed)
    ? (decisionsEmbed as Array<NonNullable<PrototypeSignedReadRow['decision']>>)
    : decisionsEmbed
      ? [decisionsEmbed as NonNullable<PrototypeSignedReadRow['decision']>]
      : []
  const decision = decisionArr[0] ?? null

  return {
    workspace: {
      id: data.id as string,
      lead_id: data.lead_id as string,
      created_at: data.created_at as string,
      demo_url: (data.demo_url ?? null) as string | null,
      generated_content: (data.generated_content ?? null) as string | null,
      share_token_superseded_at: (data.share_token_superseded_at ?? null) as string | null,
    },
    lead,
    decision,
  }
}

// Count of workspaces for the given lead at-or-before the target workspace's
// `created_at`. The target workspace itself is included → the returned value
// is the natural 1-based "version" / iteration number (V1, V2, V3, ...). Gate
// B (ADR-025 D2) bounds the count by `prototype_credit_settings.max_iterations_per_lead`.
// Implemented as a single SELECT + client-side rank to avoid extra mock surface
// in unit tests; the row count per lead is bounded by Gate B (typically ≤3).
export async function countPrototypeWorkspaceVersionForLead(
  client: DatabaseClient,
  leadId: string,
  targetWorkspaceId: string
): Promise<number> {
  const { data, error } = await client
    .from('prototype_workspaces')
    .select('id, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    throw new Error(`Failed to load prototype workspace siblings for version: ${error.message}`)
  }

  if (!Array.isArray(data) || data.length === 0) {
    return 1
  }

  const index = data.findIndex((row) => row.id === targetWorkspaceId)
  return index >= 0 ? index + 1 : data.length
}
