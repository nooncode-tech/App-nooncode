import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  ProjectInsert,
  ProjectRowWithLineage,
  ProjectUpdate,
} from '@/lib/server/projects/types'
import { listPrototypeWorkspacesByProjectIds } from '@/lib/server/prototypes/repository'

type DatabaseClient = SupabaseClient<Database>

const projectSelect = `
  id,
  source_lead_id,
  source_proposal_id,
  created_by,
  name,
  description,
  client_name,
  status,
  budget,
  pm_legacy_user_id,
  team_legacy_user_ids,
  handoff_ready_at,
  start_date,
  end_date,
  created_at,
  updated_at,
  source_lead:leads!projects_source_lead_id_fkey(id, name, company),
  source_proposal:lead_proposals!projects_source_proposal_id_fkey(id, title)
`

async function attachPrototypeWorkspaces(
  client: DatabaseClient,
  projects: ProjectRowWithLineage[]
): Promise<ProjectRowWithLineage[]> {
  if (projects.length === 0) {
    return projects
  }

  const prototypeWorkspaces = await listPrototypeWorkspacesByProjectIds(
    client,
    projects.map((project) => project.id)
  )
  const prototypeWorkspaceMap = new Map<string, ProjectRowWithLineage['prototype_workspace']>()

  for (const workspace of prototypeWorkspaces) {
    if (!workspace.project_id) {
      continue
    }

    const currentEntries = prototypeWorkspaceMap.get(workspace.project_id) ?? []
    currentEntries.push({
      id: workspace.id,
      requested_by_profile_id: workspace.requested_by_profile_id,
      current_stage: workspace.current_stage,
      status: workspace.status,
      created_at: workspace.created_at,
      requested_by: workspace.requested_by
        ? { full_name: workspace.requested_by.full_name }
        : null,
    })
    prototypeWorkspaceMap.set(workspace.project_id, currentEntries)
  }

  return projects.map((project) => ({
    ...project,
    prototype_workspace: prototypeWorkspaceMap.get(project.id) ?? [],
  }))
}

export async function listProjects(client: DatabaseClient): Promise<ProjectRowWithLineage[]> {
  const { data, error } = await client
    .from('projects')
    .select(projectSelect)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list projects: ${error.message}`)
  }

  return attachPrototypeWorkspaces(client, (data ?? []) as ProjectRowWithLineage[])
}

export async function getProjectById(
  client: DatabaseClient,
  projectId: string
): Promise<ProjectRowWithLineage | null> {
  const { data, error } = await client
    .from('projects')
    .select(projectSelect)
    .eq('id', projectId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load project: ${error.message}`)
  }

  if (!data) {
    return null
  }

  const [project] = await attachPrototypeWorkspaces(client, [data as ProjectRowWithLineage])
  return project ?? null
}

export async function getProjectByProposalId(
  client: DatabaseClient,
  proposalId: string
): Promise<ProjectRowWithLineage | null> {
  const { data, error } = await client
    .from('projects')
    .select(projectSelect)
    .eq('source_proposal_id', proposalId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load project by proposal: ${error.message}`)
  }

  if (!data) {
    return null
  }

  const [project] = await attachPrototypeWorkspaces(client, [data as ProjectRowWithLineage])
  return project ?? null
}

export async function listProjectsByProposalIds(
  client: DatabaseClient,
  proposalIds: string[]
): Promise<ProjectRowWithLineage[]> {
  if (proposalIds.length === 0) {
    return []
  }

  const { data, error } = await client
    .from('projects')
    .select(projectSelect)
    .in('source_proposal_id', proposalIds)

  if (error) {
    throw new Error(`Failed to list projects by proposal ids: ${error.message}`)
  }

  return attachPrototypeWorkspaces(client, (data ?? []) as ProjectRowWithLineage[])
}

export async function createProject(
  client: DatabaseClient,
  projectInsert: ProjectInsert
): Promise<ProjectRowWithLineage> {
  const { data, error } = await client
    .from('projects')
    .insert(projectInsert)
    .select(projectSelect)
    .single()

  if (error || !data) {
    throw new Error(`Failed to create project: ${error?.message ?? 'No project returned.'}`)
  }

  const [createdProject] = await attachPrototypeWorkspaces(client, [data as ProjectRowWithLineage])
  if (!createdProject) {
    throw new Error('Created project could not be enriched with prototype linkage.')
  }

  return createdProject
}

export async function updateProjectById(
  client: DatabaseClient,
  projectId: string,
  updates: ProjectUpdate
): Promise<ProjectRowWithLineage> {
  const { data, error } = await client
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .select(projectSelect)
    .single()

  if (error || !data) {
    throw new Error(`Failed to update project: ${error?.message ?? 'No project returned.'}`)
  }

  const [updatedProject] = await attachPrototypeWorkspaces(client, [data as ProjectRowWithLineage])
  if (!updatedProject) {
    throw new Error('Updated project could not be enriched with prototype linkage.')
  }

  return updatedProject
}
