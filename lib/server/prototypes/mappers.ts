import type {
  PrototypeWorkspaceListItemWire,
  PrototypeWorkspaceWire,
} from '@/lib/prototypes/serialization'
import type {
  PrototypeWorkspaceRow,
  PrototypeWorkspaceRowWithRelations,
} from '@/lib/server/prototypes/types'

export function mapPrototypeWorkspaceRowToWire(row: PrototypeWorkspaceRow): PrototypeWorkspaceWire {
  return {
    id: row.id,
    leadId: row.lead_id,
    projectId: row.project_id,
    requestedByProfileId: row.requested_by_profile_id,
    currentStage: row.current_stage,
    status: row.status,
    lastOperationId: row.last_operation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapPrototypeWorkspaceListItemRowToWire(
  row: PrototypeWorkspaceRowWithRelations
): PrototypeWorkspaceListItemWire {
  return {
    ...mapPrototypeWorkspaceRowToWire(row),
    leadName: row.lead?.name ?? 'Lead sin nombre',
    projectName: row.project?.name ?? null,
    requestedByName: row.requested_by?.full_name ?? 'Usuario desconocido',
  }
}
