import type { TaskActivity } from '@/lib/types'

export interface TaskActivityWire {
  id: string
  taskId: string
  type: TaskActivity['type']
  actorId: string | null
  actorName: string
  noteBody: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export function deserializeTaskActivity(activity: TaskActivityWire): TaskActivity {
  return {
    id: activity.id,
    taskId: activity.taskId,
    type: activity.type,
    actorId: activity.actorId ?? undefined,
    actorName: activity.actorName,
    noteBody: activity.noteBody ?? undefined,
    metadata: activity.metadata ?? undefined,
    createdAt: new Date(activity.createdAt),
  }
}
