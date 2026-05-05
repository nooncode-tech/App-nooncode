import type { UpdateFeedItemWire } from '@/lib/updates/serialization'
import type { LeadStatus, ProposalStatus, TaskStatus } from '@/lib/types'
import {
  buildLeadDetailHref,
  buildProjectDetailHref,
  buildTaskDetailHref,
} from '@/lib/dashboard-navigation'
import type {
  RecentLeadUpdateRow,
  RecentProjectUpdateRow,
  RecentTaskUpdateRow,
} from '@/lib/server/updates/types'
import { formatProjectActivityBody, formatProjectActivityTitle } from '@/lib/projects/activity-copy'
import { formatTaskActivityBody, formatTaskActivityTitle } from '@/lib/tasks/activity-copy'

const leadStatusLabels: Record<LeadStatus, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  qualified: 'Calificado',
  proposal: 'En propuesta',
  negotiation: 'En negociacion',
  won: 'Ganado',
  lost: 'Perdido',
}

const proposalStatusLabels: Record<ProposalStatus, string> = {
  draft: 'borrador',
  sent: 'enviada',
  accepted: 'aceptada',
  rejected: 'rechazada',
  handoff_ready: 'lista para hand-off',
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  return metadata as Record<string, unknown>
}

function truncateText(value: string, maxLength = 140): string {
  const trimmed = value.trim()

  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`
}

function formatLeadEntityLabel(row: RecentLeadUpdateRow): string {
  const leadName = row.lead?.name?.trim()
  const company = row.lead?.company?.trim()

  if (company) {
    return `${company}${leadName ? ` (${leadName})` : ''}`
  }

  return leadName || 'Lead sin nombre'
}

function formatTaskEntityLabel(row: RecentTaskUpdateRow): string {
  const taskTitle = row.task?.title?.trim()
  const projectName = row.task?.project?.name?.trim()

  if (projectName && taskTitle) {
    return `${taskTitle} / ${projectName}`
  }

  return taskTitle || 'Tarea sin titulo'
}

function formatProjectEntityLabel(row: RecentProjectUpdateRow): string {
  const projectName = row.project?.name?.trim()
  const metadata = normalizeMetadata(row.metadata)
  const metadataProjectName = typeof metadata?.projectName === 'string'
    ? metadata.projectName.trim()
    : ''

  return projectName || metadataProjectName || 'Proyecto sin nombre'
}

function formatChangedFields(metadata: Record<string, unknown> | null): string | null {
  const changedFields = metadata?.changedFields

  if (!Array.isArray(changedFields) || changedFields.length === 0) {
    return null
  }

  const labels = changedFields
    .filter((field): field is string => typeof field === 'string')
    .map((field) => {
      if (field === 'nextFollowUpAt') return 'seguimiento'
      if (field === 'lastContactedAt') return 'ultimo contacto'
      if (field === 'assignedTo') return 'asignacion'
      if (field === 'value') return 'valor'
      if (field === 'score') return 'score'
      if (field === 'notes') return 'notas'
      return field
    })

  if (labels.length === 0) {
    return null
  }

  return labels.join(', ')
}

export function mapRecentLeadUpdateToWire(row: RecentLeadUpdateRow): UpdateFeedItemWire {
  const metadata = normalizeMetadata(row.metadata)
  const entityLabel = formatLeadEntityLabel(row)
  const actorName = row.actor_profile?.full_name ?? 'Sistema'

  let title = 'Actividad de lead actualizada'
  let description = `Movimiento visible en ${entityLabel}.`

  if (row.activity_type === 'created') {
    title = 'Nuevo lead registrado'
    description = `${entityLabel} entro al pipeline visible.`
  } else if (row.activity_type === 'note_added') {
    title = 'Nueva nota en lead'
    description = row.note_body
      ? truncateText(row.note_body)
      : `Nota registrada por ${actorName}.`
  } else if (row.activity_type === 'updated') {
    const changedFields = formatChangedFields(metadata)
    const changedFollowUpOnly = changedFields === 'seguimiento'

    title = changedFollowUpOnly ? 'Seguimiento actualizado' : 'Lead actualizado'
    description = changedFields
      ? `Cambios visibles en: ${changedFields}.`
      : `Actualizacion registrada por ${actorName}.`
  } else if (row.activity_type === 'status_changed') {
    const toStatus = typeof metadata?.toStatus === 'string' ? metadata.toStatus as LeadStatus : null
    title = toStatus ? `Lead movido a ${leadStatusLabels[toStatus]}` : 'Estado del lead actualizado'
    description = `Cambio registrado por ${actorName}.`
  } else if (row.activity_type === 'proposal_created') {
    const proposalTitle = typeof metadata?.title === 'string' ? metadata.title : 'Sin titulo'
    title = 'Propuesta creada'
    description = `Se creo "${proposalTitle}" para ${entityLabel}.`
  } else if (row.activity_type === 'proposal_status_changed') {
    const toStatus = typeof metadata?.toStatus === 'string' ? metadata.toStatus as ProposalStatus : null
    title = toStatus ? `Propuesta ${proposalStatusLabels[toStatus]}` : 'Estado de propuesta actualizado'
    description = `Cambio registrado por ${actorName}.`
  } else if (row.activity_type === 'project_created') {
    const projectName = typeof metadata?.projectName === 'string' ? metadata.projectName : 'Proyecto sin nombre'
    title = 'Proyecto creado desde lead'
    description = `"${projectName}" ya forma parte del flujo visible de delivery.`
  } else if (row.activity_type === 'released_no_response') {
    title = 'Lead liberado'
    description = 'La oportunidad quedo visible para reasignacion comercial.'
  } else if (row.activity_type === 'claimed') {
    title = 'Lead reclamado'
    description = `La oportunidad fue tomada por ${actorName}.`
  }

  return {
    id: `sales-${row.id}`,
    domain: 'sales',
    sourceKind: 'lead_activity',
    eventType: row.activity_type,
    actorName,
    title,
    description,
    entityLabel,
    href: buildLeadDetailHref(row.lead?.id ?? row.lead_id),
    createdAt: row.created_at,
  }
}

export function mapRecentTaskUpdateToWire(row: RecentTaskUpdateRow): UpdateFeedItemWire {
  const entityLabel = formatTaskEntityLabel(row)
  const actorName = row.actor_profile?.full_name ?? 'Sistema'
  const metadata = normalizeMetadata(row.metadata)
  const type = row.activity_type
  const title = formatTaskActivityTitle({
    type,
    actorName,
    noteBody: row.note_body ?? undefined,
    metadata: metadata ?? undefined,
  })
  let description = formatTaskActivityBody({
    type,
    actorName,
    noteBody: row.note_body ?? undefined,
    metadata: metadata ?? undefined,
  })

  if (type === 'status_changed') {
    const toStatus = typeof metadata?.toStatus === 'string' ? metadata.toStatus as TaskStatus : null
    if (toStatus) {
      description = `La tarea ahora esta en ${toStatus === 'in_progress' ? 'En progreso' : toStatus === 'todo' ? 'Por hacer' : toStatus === 'review' ? 'Revision' : 'Completada'}.`
    }
  }

  return {
    id: `delivery-${row.id}`,
    domain: 'delivery',
    sourceKind: 'task_activity',
    eventType: type,
    actorName,
    title,
    description: type === 'note_added' ? truncateText(description) : description,
    entityLabel,
    href: buildTaskDetailHref(row.task?.id ?? row.task_id),
    createdAt: row.created_at,
  }
}

export function mapRecentProjectUpdateToWire(row: RecentProjectUpdateRow): UpdateFeedItemWire {
  const entityLabel = formatProjectEntityLabel(row)
  const actorName = row.actor_profile?.full_name ?? 'Sistema'
  const metadata = normalizeMetadata(row.metadata)
  const type = row.activity_type
  const description = formatProjectActivityBody({
    type,
    actorName,
    metadata: metadata ?? undefined,
  })

  return {
    id: `delivery-project-${row.id}`,
    domain: 'delivery',
    sourceKind: 'project_activity',
    eventType: type,
    actorName,
    title: formatProjectActivityTitle({
      type,
      actorName,
      metadata: metadata ?? undefined,
    }),
    description,
    entityLabel,
    href: buildProjectDetailHref(row.project?.id ?? row.project_id),
    createdAt: row.created_at,
  }
}
