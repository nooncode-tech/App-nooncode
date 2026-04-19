import type { ProjectActivity, ProjectTaskActivity, TaskActivityType } from '@/lib/types'

export type ProjectVisibleActivityWire =
  | {
      id: string
      sourceKind: 'project_activity'
      projectId: string
      type: ProjectActivity['type']
      actorId: string | null
      actorName: string
      taskId: null
      taskTitle: null
      noteBody: null
      metadata: Record<string, unknown> | null
      createdAt: string
    }
  | {
      id: string
      sourceKind: 'task_activity'
      projectId: string
      type: TaskActivityType
      actorId: string | null
      actorName: string
      taskId: string
      taskTitle: string
      noteBody: string | null
      metadata: Record<string, unknown> | null
      createdAt: string
    }

export function deserializeProjectVisibleActivity(
  activity: ProjectVisibleActivityWire
): ProjectTaskActivity {
  if (activity.sourceKind === 'project_activity') {
    return {
      id: activity.id,
      sourceKind: 'project_activity',
      projectId: activity.projectId,
      type: activity.type,
      actorId: activity.actorId ?? undefined,
      actorName: activity.actorName,
      metadata: activity.metadata ?? undefined,
      createdAt: new Date(activity.createdAt),
    }
  }

  return {
    id: activity.id,
    sourceKind: 'task_activity',
    projectId: activity.projectId,
    type: activity.type,
    actorId: activity.actorId ?? undefined,
    actorName: activity.actorName,
    taskId: activity.taskId ?? '',
    taskTitle: activity.taskTitle ?? 'Tarea sin titulo',
    noteBody: activity.noteBody ?? undefined,
    metadata: activity.metadata ?? undefined,
    createdAt: new Date(activity.createdAt),
  }
}

export interface ProjectActivityWire {
  id: string
  projectId: string
  type: ProjectActivity['type']
  actorId: string | null
  actorName: string
  metadata: Record<string, unknown> | null
  createdAt: string
}
