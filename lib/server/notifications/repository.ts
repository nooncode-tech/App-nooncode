import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type { UserNotificationRow } from '@/lib/server/notifications/types'

type DatabaseClient = SupabaseClient<Database>

const userNotificationSelect = `
  id,
  profile_id,
  source_kind,
  source_event_id,
  domain,
  title,
  body,
  href,
  is_read,
  read_at,
  created_at
`

export async function listUserNotifications(
  client: DatabaseClient,
  profileId: string,
  limit: number
): Promise<UserNotificationRow[]> {
  const { data, error } = await client
    .from('user_notifications')
    .select(userNotificationSelect)
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to list user notifications: ${error.message}`)
  }

  return (data ?? []) as UserNotificationRow[]
}

export async function countUnreadUserNotifications(
  client: DatabaseClient,
  profileId: string
): Promise<number> {
  const { count, error } = await client
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('is_read', false)

  if (error) {
    throw new Error(`Failed to count unread notifications: ${error.message}`)
  }

  return count ?? 0
}

export async function getUserNotificationById(
  client: DatabaseClient,
  profileId: string,
  notificationId: string
): Promise<UserNotificationRow | null> {
  const { data, error } = await client
    .from('user_notifications')
    .select(userNotificationSelect)
    .eq('profile_id', profileId)
    .eq('id', notificationId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load notification: ${error.message}`)
  }

  return (data ?? null) as UserNotificationRow | null
}

export async function markUserNotificationRead(
  client: DatabaseClient,
  profileId: string,
  notificationId: string,
  readAt: string
): Promise<UserNotificationRow> {
  const { data, error } = await client
    .from('user_notifications')
    .update({
      is_read: true,
      read_at: readAt,
    })
    .eq('profile_id', profileId)
    .eq('id', notificationId)
    .select(userNotificationSelect)
    .single()

  if (error) {
    throw new Error(`Failed to mark notification as read: ${error.message}`)
  }

  return data as UserNotificationRow
}

export async function listLeadActivityTargetsByIds(
  client: DatabaseClient,
  eventIds: string[]
): Promise<Array<{ id: string; lead_id: string }>> {
  if (eventIds.length === 0) {
    return []
  }

  const { data, error } = await client
    .from('lead_activities')
    .select('id, lead_id')
    .in('id', eventIds)

  if (error) {
    throw new Error(`Failed to resolve lead activity targets: ${error.message}`)
  }

  return data ?? []
}

export async function listProjectActivityTargetsByIds(
  client: DatabaseClient,
  eventIds: string[]
): Promise<Array<{ id: string; project_id: string }>> {
  if (eventIds.length === 0) {
    return []
  }

  const { data, error } = await client
    .from('project_activities')
    .select('id, project_id')
    .in('id', eventIds)

  if (error) {
    throw new Error(`Failed to resolve project activity targets: ${error.message}`)
  }

  return data ?? []
}

export async function listTaskActivityTargetsByIds(
  client: DatabaseClient,
  eventIds: string[]
): Promise<Array<{ id: string; task_id: string }>> {
  if (eventIds.length === 0) {
    return []
  }

  const { data, error } = await client
    .from('task_activities')
    .select('id, task_id')
    .in('id', eventIds)

  if (error) {
    throw new Error(`Failed to resolve task activity targets: ${error.message}`)
  }

  return data ?? []
}
