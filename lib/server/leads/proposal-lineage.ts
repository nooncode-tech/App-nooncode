import type { LeadActivityRowWithActor } from '@/lib/server/leads/activity-types'
import type { LeadProposalLinkedProjectSource } from '@/lib/server/leads/proposal-mappers'
import type { Database } from '@/lib/server/supabase/database.types'

const projectStatuses = new Set<Database['public']['Enums']['project_status']>([
  'backlog',
  'in_progress',
  'review',
  'delivered',
  'completed',
])

function readMetadataRecord(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  return metadata as Record<string, unknown>
}

function readProjectStatus(value: unknown): Database['public']['Enums']['project_status'] | null {
  return typeof value === 'string' && projectStatuses.has(value as Database['public']['Enums']['project_status'])
    ? (value as Database['public']['Enums']['project_status'])
    : null
}

export function findProposalLinkedProjectFromActivities(
  activities: LeadActivityRowWithActor[],
  proposalId: string
): LeadProposalLinkedProjectSource | null {
  for (const activity of activities) {
    if (activity.activity_type !== 'project_created') {
      continue
    }

    const metadata = readMetadataRecord(activity.metadata)

    if (!metadata || metadata.proposalId !== proposalId) {
      continue
    }

    const projectId = typeof metadata.projectId === 'string' ? metadata.projectId : null
    const projectName = typeof metadata.projectName === 'string' ? metadata.projectName : null
    const projectStatus = readProjectStatus(metadata.projectStatus)

    if (!projectId || !projectName || !projectStatus) {
      continue
    }

    return {
      id: projectId,
      name: projectName,
      status: projectStatus,
      created_at: activity.created_at,
    }
  }

  return null
}
