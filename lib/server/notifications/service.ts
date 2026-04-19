import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import { NotFoundApiError } from '@/lib/server/api/errors'
import {
  buildLeadDetailHref,
  buildProjectDetailHref,
  buildTaskDetailHref,
} from '@/lib/dashboard-navigation'
import { canAccessDashboardPath } from '@/lib/server/auth/policy'
import type { UserNotificationWire } from '@/lib/notifications/serialization'
import { mapUserNotificationRowToWire } from '@/lib/server/notifications/mappers'
import {
  countUnreadUserNotifications,
  getUserNotificationById,
  listLeadActivityTargetsByIds,
  listProjectActivityTargetsByIds,
  listTaskActivityTargetsByIds,
  listUserNotifications,
  markUserNotificationRead,
} from '@/lib/server/notifications/repository'

type DatabaseClient = SupabaseClient<Database>

function resolveNotificationHref(
  row: Awaited<ReturnType<typeof listUserNotifications>>[number],
  principal: AuthenticatedPrincipal,
  leadIdByEventId: Map<string, string>,
  projectIdByEventId: Map<string, string>,
  taskIdByEventId: Map<string, string>
): string {
  if (row.source_kind === 'lead_activity') {
    const leadId = leadIdByEventId.get(row.source_event_id)
    return leadId ? buildLeadDetailHref(leadId) : row.href
  }

  if (row.source_kind === 'project_activity' && canAccessDashboardPath(principal.role, '/dashboard/projects')) {
    const projectId = projectIdByEventId.get(row.source_event_id)
    return projectId ? buildProjectDetailHref(projectId) : row.href
  }

  if (row.source_kind === 'task_activity' && canAccessDashboardPath(principal.role, '/dashboard/tasks')) {
    const taskId = taskIdByEventId.get(row.source_event_id)
    return taskId ? buildTaskDetailHref(taskId) : row.href
  }

  return row.href
}

async function buildNotificationHrefMaps(
  client: DatabaseClient,
  items: Array<Awaited<ReturnType<typeof listUserNotifications>>[number]>
): Promise<{
  leadIdByEventId: Map<string, string>
  projectIdByEventId: Map<string, string>
  taskIdByEventId: Map<string, string>
}> {
  const leadActivityIds = items
    .filter((item) => item.source_kind === 'lead_activity')
    .map((item) => item.source_event_id)
  const projectActivityIds = items
    .filter((item) => item.source_kind === 'project_activity')
    .map((item) => item.source_event_id)
  const taskActivityIds = items
    .filter((item) => item.source_kind === 'task_activity')
    .map((item) => item.source_event_id)
  const [leadTargets, projectTargets, taskTargets] = await Promise.all([
    listLeadActivityTargetsByIds(client, leadActivityIds),
    listProjectActivityTargetsByIds(client, projectActivityIds),
    listTaskActivityTargetsByIds(client, taskActivityIds),
  ])

  return {
    leadIdByEventId: new Map(leadTargets.map((row) => [row.id, row.lead_id])),
    projectIdByEventId: new Map(projectTargets.map((row) => [row.id, row.project_id])),
    taskIdByEventId: new Map(taskTargets.map((row) => [row.id, row.task_id])),
  }
}

export async function listVisibleNotifications(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  limit: number
): Promise<{ items: UserNotificationWire[]; unreadCount: number }> {
  const [items, unreadCount] = await Promise.all([
    listUserNotifications(client, principal.profile.id, limit),
    countUnreadUserNotifications(client, principal.profile.id),
  ])
  const { leadIdByEventId, projectIdByEventId, taskIdByEventId } = await buildNotificationHrefMaps(client, items)

  return {
    items: items.map((item) =>
      mapUserNotificationRowToWire(
        item,
        resolveNotificationHref(item, principal, leadIdByEventId, projectIdByEventId, taskIdByEventId)
      )
    ),
    unreadCount,
  }
}

export async function markVisibleNotificationAsRead(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  notificationId: string
): Promise<UserNotificationWire> {
  const existingNotification = await getUserNotificationById(
    client,
    principal.profile.id,
    notificationId
  )

  if (!existingNotification) {
    throw new NotFoundApiError('Notification not found.')
  }

  if (existingNotification.is_read) {
    const { leadIdByEventId, projectIdByEventId, taskIdByEventId } = await buildNotificationHrefMaps(client, [existingNotification])

    return mapUserNotificationRowToWire(
      existingNotification,
      resolveNotificationHref(existingNotification, principal, leadIdByEventId, projectIdByEventId, taskIdByEventId)
    )
  }

  const updatedNotification = await markUserNotificationRead(
    client,
    principal.profile.id,
    notificationId,
    new Date().toISOString()
  )

  const { leadIdByEventId, projectIdByEventId, taskIdByEventId } = await buildNotificationHrefMaps(client, [updatedNotification])

  return mapUserNotificationRowToWire(
    updatedNotification,
    resolveNotificationHref(updatedNotification, principal, leadIdByEventId, projectIdByEventId, taskIdByEventId)
  )
}
