import type { Task } from '@/lib/types'

export interface TaskWire {
  id: string
  projectId: string
  title: string
  description: string | null
  status: Task['status']
  priority: Task['priority']
  assignedTo: string | null
  assignedToName: string | null
  dueDate: string | null
  estimatedHours: number | null
  actualHours: number | null
  createdAt: string
  updatedAt: string
}

export function deserializeTask(task: TaskWire): Task {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    description: task.description ?? undefined,
    status: task.status,
    priority: task.priority,
    assignedTo: task.assignedTo ?? undefined,
    assignedToName: task.assignedToName ?? undefined,
    dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
    estimatedHours: task.estimatedHours ?? undefined,
    actualHours: task.actualHours ?? undefined,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
  }
}
