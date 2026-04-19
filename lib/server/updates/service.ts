import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import type { UpdateFeedDomain } from '@/lib/types'
import type { UpdateFeedItemWire } from '@/lib/updates/serialization'
import {
  mapRecentLeadUpdateToWire,
  mapRecentProjectUpdateToWire,
  mapRecentTaskUpdateToWire,
} from '@/lib/server/updates/mappers'
import {
  listRecentLeadUpdates,
  listRecentProjectUpdates,
  listRecentTaskUpdates,
} from '@/lib/server/updates/repository'

type DatabaseClient = SupabaseClient<Database>

interface VisibleUpdateSources {
  domains: UpdateFeedDomain[]
  includeLead: boolean
  includeProject: boolean
  includeTask: boolean
}

export function getVisibleUpdateSources(role: AuthenticatedPrincipal['role']): VisibleUpdateSources {
  if (role === 'admin') {
    return {
      domains: ['sales', 'delivery'],
      includeLead: true,
      includeProject: true,
      includeTask: true,
    }
  }

  if (role === 'sales_manager') {
    return {
      domains: ['sales', 'delivery'],
      includeLead: true,
      includeProject: true,
      includeTask: false,
    }
  }

  if (role === 'sales') {
    return {
      domains: ['sales'],
      includeLead: true,
      includeProject: false,
      includeTask: false,
    }
  }

  return {
    domains: ['delivery'],
    includeLead: false,
    includeProject: true,
    includeTask: true,
  }
}

export async function listVisibleUpdates(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  limit: number
): Promise<{ items: UpdateFeedItemWire[]; domains: UpdateFeedDomain[] }> {
  const visibility = getVisibleUpdateSources(principal.role)
  const requestedFeedPromises: Array<Promise<UpdateFeedItemWire[]>> = []

  if (visibility.includeLead) {
    requestedFeedPromises.push(
      listRecentLeadUpdates(client, limit).then((rows) => rows.map(mapRecentLeadUpdateToWire))
    )
  }

  if (visibility.includeProject) {
    requestedFeedPromises.push(
      listRecentProjectUpdates(client, limit).then((rows) => rows.map(mapRecentProjectUpdateToWire))
    )
  }

  if (visibility.includeTask) {
    requestedFeedPromises.push(
      listRecentTaskUpdates(client, limit).then((rows) => rows.map(mapRecentTaskUpdateToWire))
    )
  }

  const requestedFeeds = await Promise.all(requestedFeedPromises)
  const items = requestedFeeds
    .flat()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit)

  return {
    items,
    domains: visibility.domains,
  }
}
