import type { ProjectActivity, ProjectStatus } from '@/lib/types'

type ProjectActivityLike = Pick<ProjectActivity, 'type' | 'actorName' | 'metadata'>

const projectStatusLabels: Record<ProjectStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'En progreso',
  review: 'Revision',
  delivered: 'Entregado',
  completed: 'Completado',
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  return metadata as Record<string, unknown>
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function formatProjectDate(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'Sin fecha'
  }

  const parsed = new Date(`${value}T00:00:00Z`)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(parsed)
}

function formatName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function formatTeamList(value: unknown): string {
  const names = normalizeStringArray(value)

  if (names.length === 0) {
    return 'Sin equipo'
  }

  if (names.length <= 3) {
    return names.join(', ')
  }

  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`
}

export function formatProjectActivityTitle(activity: ProjectActivityLike): string {
  const metadata = normalizeMetadata(activity.metadata)

  if (activity.type === 'status_changed') {
    const toStatus = typeof metadata?.toStatus === 'string'
      ? metadata.toStatus as ProjectStatus
      : null

    return toStatus ? `Proyecto movido a ${projectStatusLabels[toStatus]}` : 'Estado de proyecto actualizado'
  }

  if (activity.type === 'pm_changed') {
    const toPmName = formatName(metadata?.toPmName, '')
    if (toPmName) {
      return `PM asignado: ${toPmName}`
    }

    return 'PM del proyecto actualizado'
  }

  if (activity.type === 'team_changed') {
    return 'Equipo del proyecto actualizado'
  }

  if (activity.type === 'schedule_changed') {
    return 'Fechas del proyecto actualizadas'
  }

  return 'Actividad de proyecto'
}

export function formatProjectActivityBody(activity: ProjectActivityLike): string {
  const metadata = normalizeMetadata(activity.metadata)

  if (activity.type === 'status_changed') {
    const fromStatus = typeof metadata?.fromStatus === 'string'
      ? metadata.fromStatus as ProjectStatus
      : null
    const toStatus = typeof metadata?.toStatus === 'string'
      ? metadata.toStatus as ProjectStatus
      : null

    if (fromStatus && toStatus) {
      return `Estado: ${projectStatusLabels[fromStatus]} -> ${projectStatusLabels[toStatus]}.`
    }

    return `Cambio registrado por ${activity.actorName}.`
  }

  if (activity.type === 'pm_changed') {
    const fromPmName = formatName(metadata?.fromPmName, 'Sin PM')
    const toPmName = formatName(metadata?.toPmName, 'Sin PM')
    return `PM: ${fromPmName} -> ${toPmName}.`
  }

  if (activity.type === 'team_changed') {
    return `Equipo: ${formatTeamList(metadata?.fromTeamNames)} -> ${formatTeamList(metadata?.toTeamNames)}.`
  }

  if (activity.type === 'schedule_changed') {
    return `Inicio: ${formatProjectDate(metadata?.fromStartDate)} -> ${formatProjectDate(metadata?.toStartDate)}. Fin: ${formatProjectDate(metadata?.fromEndDate)} -> ${formatProjectDate(metadata?.toEndDate)}.`
  }

  return `Actividad registrada por ${activity.actorName}.`
}
