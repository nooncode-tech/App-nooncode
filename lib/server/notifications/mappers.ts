import type { UserNotificationWire } from '@/lib/notifications/serialization'
import type { UserNotificationRow } from '@/lib/server/notifications/types'

export function mapUserNotificationRowToWire(
  row: UserNotificationRow,
  hrefOverride?: string
): UserNotificationWire {
  return {
    id: row.id,
    domain: row.domain,
    sourceKind: row.source_kind,
    title: row.title,
    body: row.body,
    href: hrefOverride ?? row.href,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}
