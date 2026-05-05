import type { TaskActivityWire } from '@/lib/tasks/activity-serialization'
import type {
  TaskActivityInsert,
  TaskActivityRowWithActor,
} from '@/lib/server/tasks/activity-types'
import type { CreateTaskNoteInput } from '@/lib/server/tasks/activity-schema'

function normalizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  return metadata as Record<string, unknown>
}

export function mapTaskActivityRowToWire(row: TaskActivityRowWithActor): TaskActivityWire {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.activity_type,
    actorId: row.actor_profile?.legacy_mock_id ?? row.actor_profile_id,
    actorName: row.actor_profile?.full_name ?? 'Sistema',
    noteBody: row.note_body,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at,
  }
}

export function mapCreateTaskNoteInputToInsert(
  input: CreateTaskNoteInput,
  taskId: string,
  principalUserId: string
): TaskActivityInsert {
  return {
    task_id: taskId,
    activity_type: 'note_added',
    actor_profile_id: principalUserId,
    note_body: input.body,
    metadata: {},
  }
}
