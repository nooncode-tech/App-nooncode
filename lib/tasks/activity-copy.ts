import type { ProjectTaskActivity, TaskActivity, TaskStatus } from '@/lib/types'

type TaskActivityLike = Pick<TaskActivity, 'type' | 'actorName' | 'noteBody' | 'metadata'>
type ProjectTaskActivityLike = Pick<ProjectTaskActivity, 'type' | 'actorName' | 'noteBody' | 'metadata'>

const taskStatusLabels: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  review: 'Revision',
  done: 'Completada',
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  return metadata as Record<string, unknown>
}

function formatHours(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value}h`
  }

  return 'sin dato'
}

export function formatTaskActivityTitle(activity: TaskActivityLike | ProjectTaskActivityLike): string {
  const metadata = normalizeMetadata(activity.metadata)

  if (activity.type === 'note_added') {
    return 'Nueva nota de avance'
  }

  if (activity.type === 'status_changed') {
    const toStatus = typeof metadata?.toStatus === 'string' ? metadata.toStatus as TaskStatus : null
    return toStatus ? `Estado movido a ${taskStatusLabels[toStatus]}` : 'Estado de tarea actualizado'
  }

  if (activity.type === 'actual_hours_updated') {
    return 'Horas reales actualizadas'
  }

  return 'Actividad de tarea'
}

export function formatTaskActivityBody(activity: TaskActivityLike | ProjectTaskActivityLike): string {
  const metadata = normalizeMetadata(activity.metadata)

  if (activity.type === 'note_added') {
    return activity.noteBody ?? ''
  }

  if (activity.type === 'status_changed') {
    return `Cambio registrado por ${activity.actorName}.`
  }

  if (activity.type === 'actual_hours_updated') {
    return `Horas registradas: ${formatHours(metadata?.fromActualHours)} -> ${formatHours(metadata?.toActualHours)}.`
  }

  return `Actividad registrada por ${activity.actorName}.`
}
