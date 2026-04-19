import type { ProjectStatus, Task } from '@/lib/types'

const taskProgressWeight: Record<Task['status'], number> = {
  todo: 0,
  in_progress: 50,
  review: 85,
  done: 100,
}

export function calculateProjectProgress(tasks: Task[]): number {
  if (tasks.length === 0) {
    return 0
  }

  const weightedProgress = tasks.reduce((sum, task) => sum + taskProgressWeight[task.status], 0)
  return Math.round(weightedProgress / tasks.length)
}

export function deriveProjectDisplayStatus(
  persistedStatus: ProjectStatus,
  tasks: Task[]
): ProjectStatus {
  if (tasks.length === 0) {
    return persistedStatus
  }

  if (persistedStatus === 'completed') {
    return 'completed'
  }

  if (persistedStatus === 'delivered' && tasks.every((task) => task.status === 'done')) {
    return 'delivered'
  }

  if (tasks.some((task) => task.status === 'review')) {
    return 'review'
  }

  if (tasks.some((task) => task.status === 'in_progress' || task.status === 'done')) {
    return 'in_progress'
  }

  return persistedStatus === 'review' || persistedStatus === 'delivered'
    ? persistedStatus
    : 'backlog'
}
