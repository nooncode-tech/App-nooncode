import type { UpdateFeedItem } from '@/lib/types'

export interface UpdateFeedItemWire {
  id: string
  domain: UpdateFeedItem['domain']
  sourceKind: UpdateFeedItem['sourceKind']
  eventType: UpdateFeedItem['eventType']
  actorName: string
  title: string
  description: string
  entityLabel: string
  href: string
  createdAt: string
}

export function deserializeUpdateFeedItem(item: UpdateFeedItemWire): UpdateFeedItem {
  return {
    id: item.id,
    domain: item.domain,
    sourceKind: item.sourceKind,
    eventType: item.eventType,
    actorName: item.actorName,
    title: item.title,
    description: item.description,
    entityLabel: item.entityLabel,
    href: item.href,
    createdAt: new Date(item.createdAt),
  }
}
