import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import { createTask } from '@/lib/server/tasks/repository'
import { getProjectById } from '@/lib/server/projects/repository'
import { getPrototypeWorkspaceById } from '@/lib/server/prototypes/repository'

type DatabaseClient = SupabaseClient<Database>

const BOOTSTRAP_TASK_TITLE = 'Revisar prototipo comercial'

export interface PrototypeHandoffFollowUpResult {
  taskId: string | null
  assigneeLegacyId: string | null
  notifiedProfileIds: string[]
}

function resolvePrimaryAssigneeLegacyId(teamIds: string[] | null | undefined): string | null {
  const firstMember = teamIds?.find((memberId) => memberId.trim().length > 0)
  return firstMember ?? null
}

async function resolveProfileIdsForProjectTeam(
  client: DatabaseClient,
  project: NonNullable<Awaited<ReturnType<typeof getProjectById>>>
): Promise<string[]> {
  const legacyIds = new Set<string>()

  if (project.pm_legacy_user_id) {
    legacyIds.add(project.pm_legacy_user_id)
  }

  for (const teamMemberId of project.team_legacy_user_ids ?? []) {
    if (teamMemberId) {
      legacyIds.add(teamMemberId)
    }
  }

  if (legacyIds.size === 0) {
    return []
  }

  const { data, error } = await client
    .from('user_profiles')
    .select('id, legacy_mock_id')
    .in('legacy_mock_id', Array.from(legacyIds))
    .eq('is_active', true)

  if (error) {
    throw new Error(`Failed to resolve project team profiles: ${error.message}`)
  }

  return (data ?? []).map((row) => row.id)
}

async function findExistingBootstrapTask(
  client: DatabaseClient,
  projectId: string,
  prototypeWorkspaceId: string
) {
  const { data, error } = await client
    .from('tasks')
    .select('id, description')
    .eq('project_id', projectId)
    .eq('title', BOOTSTRAP_TASK_TITLE)

  if (error) {
    throw new Error(`Failed to lookup bootstrap prototype task: ${error.message}`)
  }

  return (
    (data ?? []).find((row) => row.description?.includes(prototypeWorkspaceId))?.id ?? null
  )
}

export async function bootstrapPrototypeDeliveryFollowUp(
  client: DatabaseClient,
  input: {
    prototypeWorkspaceId: string
    projectId: string
    actorProfileId: string
  }
): Promise<PrototypeHandoffFollowUpResult> {
  const [project, workspace] = await Promise.all([
    getProjectById(client, input.projectId),
    getPrototypeWorkspaceById(client, input.prototypeWorkspaceId),
  ])

  if (!project) {
    throw new Error('Project not found for prototype handoff follow-up.')
  }

  if (!workspace) {
    throw new Error('Prototype workspace not found for handoff follow-up.')
  }

  const assigneeLegacyId = resolvePrimaryAssigneeLegacyId(project.team_legacy_user_ids)
  const prototypeReference = workspace.generated_content?.trim()
  const descriptionParts = [
    `Workspace: ${workspace.id}`,
    prototypeReference ? `Referencia: ${prototypeReference}` : null,
    'Revisa el prototipo comercial heredado desde ventas o inbound web antes de continuar el desarrollo.',
  ].filter(Boolean)

  let taskId = await findExistingBootstrapTask(client, project.id, workspace.id)

  if (!taskId) {
    const createdTask = await createTask(client, {
      project_id: project.id,
      created_by: input.actorProfileId,
      title: BOOTSTRAP_TASK_TITLE,
      description: descriptionParts.join('\n'),
      status: 'todo',
      priority: 'high',
      assigned_legacy_user_id: assigneeLegacyId,
      due_date: null,
      estimated_hours: null,
      actual_hours: null,
    })

    taskId = createdTask.id
  }

  const recipientProfileIds = await resolveProfileIdsForProjectTeam(client, project)
  const notificationBody = prototypeReference
    ? `El workspace de prototipo ya esta en delivery. Referencia: ${prototypeReference}`
    : 'El workspace de prototipo ya esta en delivery y requiere revision del equipo.'

  if (recipientProfileIds.length > 0) {
    const now = new Date().toISOString()
    const rows = recipientProfileIds.map((profileId) => ({
      profile_id: profileId,
      source_kind: 'project_activity' as const,
      source_event_id: workspace.id,
      domain: 'delivery' as const,
      title: 'Prototipo listo para delivery',
      body: notificationBody,
      href: `/dashboard/projects?projectId=${project.id}`,
      created_at: now,
    }))

    const { error } = await client.from('user_notifications').upsert(rows, {
      onConflict: 'profile_id,source_kind,source_event_id',
      ignoreDuplicates: true,
    })

    if (error) {
      throw new Error(`Failed to notify delivery team about prototype handoff: ${error.message}`)
    }
  }

  return {
    taskId,
    assigneeLegacyId,
    notifiedProfileIds: recipientProfileIds,
  }
}
