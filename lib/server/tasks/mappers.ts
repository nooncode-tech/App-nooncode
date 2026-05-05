import type { TaskWire } from '@/lib/tasks/serialization'
import type { TaskInsert, TaskRowWithProfiles, TaskUpdate } from '@/lib/server/tasks/types'
import type { CreateTaskInput, UpdateTaskInput } from '@/lib/server/tasks/schema'

export function mapTaskRowToWire(row: TaskRowWithProfiles): TaskWire {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignedTo: row.assigned_profile?.legacy_mock_id ?? row.assigned_legacy_user_id,
    assignedToName: row.assigned_profile?.full_name ?? null,
    dueDate: row.due_date,
    estimatedHours: row.estimated_hours,
    actualHours: row.actual_hours,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapCreateTaskInputToInsert(
  input: CreateTaskInput,
  principalUserId: string
): TaskInsert {
  return {
    project_id: input.projectId,
    created_by: principalUserId,
    title: input.title,
    description: input.description ?? null,
    status: input.status,
    priority: input.priority,
    assigned_legacy_user_id: input.assignedTo ?? null,
    due_date: input.dueDate ?? null,
    estimated_hours: input.estimatedHours ?? null,
    actual_hours: input.actualHours ?? null,
  }
}

export function mapUpdateTaskInputToUpdate(input: UpdateTaskInput): TaskUpdate {
  const update: TaskUpdate = {}

  if (input.title !== undefined) update.title = input.title
  if (input.description !== undefined) update.description = input.description ?? null
  if (input.status !== undefined) update.status = input.status
  if (input.priority !== undefined) update.priority = input.priority
  if (input.assignedTo !== undefined) update.assigned_legacy_user_id = input.assignedTo ?? null
  if (input.dueDate !== undefined) update.due_date = input.dueDate ?? null
  if (input.estimatedHours !== undefined) update.estimated_hours = input.estimatedHours ?? null
  if (input.actualHours !== undefined) update.actual_hours = input.actualHours ?? null

  return update
}
