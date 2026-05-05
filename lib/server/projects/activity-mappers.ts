import type { ProjectVisibleActivityWire } from '@/lib/projects/activity-serialization'
import type {
  ProjectActivityRowWithActor,
  ProjectTaskActivityRowWithActor,
} from '@/lib/server/projects/activity-types'

function normalizeMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  return metadata as Record<string, unknown>
}

export function mapProjectActivityRowToVisibleWire(
  row: ProjectActivityRowWithActor
): ProjectVisibleActivityWire {
  return {
    id: row.id,
    sourceKind: 'project_activity',
    projectId: row.project_id,
    type: row.activity_type,
    actorId: row.actor_profile?.legacy_mock_id ?? row.actor_profile_id,
    actorName: row.actor_profile?.full_name ?? 'Sistema',
    taskId: null,
    taskTitle: null,
    noteBody: null,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at,
  }
}

export function mapProjectTaskActivityRowToVisibleWire(
  row: ProjectTaskActivityRowWithActor
): ProjectVisibleActivityWire {
  return {
    id: row.id,
    sourceKind: 'task_activity',
    projectId: row.task?.project_id ?? '',
    type: row.activity_type,
    actorId: row.actor_profile?.legacy_mock_id ?? row.actor_profile_id,
    actorName: row.actor_profile?.full_name ?? 'Sistema',
    taskId: row.task_id,
    taskTitle: row.task?.title ?? 'Tarea sin titulo',
    noteBody: row.note_body,
    metadata: normalizeMetadata(row.metadata),
    createdAt: row.created_at,
  }
}
