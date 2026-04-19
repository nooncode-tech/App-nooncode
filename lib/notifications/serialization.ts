import type { UserNotification } from '@/lib/types'

export interface UserNotificationWire {
  id: string
  domain: UserNotification['domain']
  sourceKind: UserNotification['sourceKind']
  title: string
  body: string
  href: string
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export function deserializeUserNotification(item: UserNotificationWire): UserNotification {
  return {
    id: item.id,
    domain: item.domain,
    sourceKind: item.sourceKind,
    title: item.title,
    body: item.body,
    href: item.href,
    isRead: item.isRead,
    readAt: item.readAt ? new Date(item.readAt) : undefined,
    createdAt: new Date(item.createdAt),
  }
}
