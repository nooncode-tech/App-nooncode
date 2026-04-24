'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Bell, BellOff, Briefcase, Check, ExternalLink, ListTodo } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import type { UserNotification } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { NOTIFICATIONS_UPDATED_EVENT } from '@/lib/notifications/client-events'
import {
  deserializeUserNotification,
  type UserNotificationWire,
} from '@/lib/notifications/serialization'

interface NotificationsResponse {
  data: UserNotificationWire[]
  meta: { unreadCount: number }
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}

function readApiResponse(payload: NotificationsResponse) {
  return {
    items: payload.data.map(deserializeUserNotification),
    unreadCount: payload.meta.unreadCount,
  }
}

function domainIcon(domain: UserNotification['domain']) {
  return domain === 'sales' ? Briefcase : ListTodo
}

function domainLabel(domain: UserNotification['domain']): string {
  return domain === 'sales' ? 'Ventas' : 'Delivery'
}

export default function NotificationsPage() {
  const { authMode, user } = useAuth()
  const [items, setItems] = useState<UserNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(authMode === 'supabase')
  const [error, setError] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true
    if (authMode !== 'supabase' || !user) {
      setItems([]); setUnreadCount(0); setError(null); setIsLoading(false)
      return () => { isActive = false }
    }
    setIsLoading(true); setError(null)
    fetch('/api/notifications?limit=50', { method: 'GET', cache: 'no-store' })
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error ?? 'Error al cargar notificaciones')
        return payload as NotificationsResponse
      })
      .then((payload) => { if (isActive) { const s = readApiResponse(payload); setItems(s.items); setUnreadCount(s.unreadCount) } })
      .catch((e) => { if (isActive) { setItems([]); setUnreadCount(0); setError(e instanceof Error ? e.message : 'Error') } })
      .finally(() => { if (isActive) setIsLoading(false) })
    return () => { isActive = false }
  }, [authMode, user])

  const handleMarkAsRead = async (id: string) => {
    setMarkingId(id)
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: 'POST' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error ?? 'Error')
      const next = deserializeUserNotification((payload as { data: UserNotificationWire }).data)
      setItems((prev) => prev.map((n) => n.id === next.id ? next : n))
      setUnreadCount((c) => Math.max(0, c - 1))
      window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT))
    } catch { /* swallow */ } finally { setMarkingId(null) }
  }

  if (!user) return null

  return (
    <div className="app-page">
      <div className="app-page-header">
        <div>
        <div className="flex items-center gap-2">
          <h1 className="app-page-title">Notificaciones</h1>
          {authMode === 'supabase' && unreadCount > 0 && (
            <span className="text-[10px] font-bold bg-primary text-white px-1.5 py-0.5 rounded-full tabular-nums">
              {unreadCount}
            </span>
          )}
        </div>
        <p className="app-page-subtitle">Inbox interno de notificaciones por usuario.</p>
        </div>
      </div>

      <div className="max-w-2xl">
        {authMode !== 'supabase' ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><BellOff className="size-5" /></EmptyMedia>
              <EmptyTitle>Disponible en runtime Supabase</EmptyTitle>
              <EmptyDescription>Este inbox depende de notificaciones persistidas por usuario.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : isLoading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : error ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Bell className="size-5" /></EmptyMedia>
              <EmptyTitle>Error al cargar</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : items.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Bell className="size-5" /></EmptyMedia>
              <EmptyTitle>Sin notificaciones</EmptyTitle>
              <EmptyDescription>No hay notificaciones visibles para tu usuario.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md bg-card divide-y divide-border/80">
            {items.map((item) => {
              const DomainIcon = domainIcon(item.domain)
              const canOpen = item.href !== '/dashboard/notifications'

              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 transition-colors',
                    item.isRead ? 'bg-background' : 'bg-primary/[0.03] border-l-2 border-l-primary'
                  )}
                >
                  {/* Icon */}
                  <div className={cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg',
                    item.isRead ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                  )}>
                    <DomainIcon className="size-3.5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className={cn('text-sm leading-tight', item.isRead ? 'font-normal text-foreground' : 'font-semibold text-foreground')}>
                        {item.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {formatTimestamp(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug mb-1.5">{item.body}</p>
                    <div className="flex items-center gap-1">
                      <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground/70">
                        {domainLabel(item.domain)}
                      </span>
                      {canOpen && (
                        <Link
                          href={item.href}
                          className="text-[10px] text-primary hover:underline flex items-center gap-0.5 ml-1"
                        >
                          <ExternalLink className="size-2.5" />
                          Abrir
                        </Link>
                      )}
                      {!item.isRead && (
                        <button
                          onClick={() => handleMarkAsRead(item.id)}
                          disabled={markingId === item.id}
                          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 ml-auto transition-colors disabled:opacity-40"
                        >
                          <Check className="size-2.5" />
                          {markingId === item.id ? 'Marcando...' : 'Leída'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
