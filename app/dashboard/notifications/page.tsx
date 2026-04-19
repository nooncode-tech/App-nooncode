'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Bell, BellOff, Briefcase, CheckCheck, ListTodo } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import type { UserNotification } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { NOTIFICATIONS_UPDATED_EVENT } from '@/lib/notifications/client-events'
import {
  deserializeUserNotification,
  type UserNotificationWire,
} from '@/lib/notifications/serialization'

interface NotificationsResponse {
  data: UserNotificationWire[]
  meta: {
    unreadCount: number
  }
}

function formatRelativeTimestamp(value: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

function readApiResponse(payload: NotificationsResponse): {
  items: UserNotification[]
  unreadCount: number
} {
  return {
    items: payload.data.map(deserializeUserNotification),
    unreadCount: payload.meta.unreadCount,
  }
}

function domainLabel(domain: UserNotification['domain']): string {
  return domain === 'sales' ? 'Ventas' : 'Delivery'
}

function domainIcon(domain: UserNotification['domain']) {
  return domain === 'sales' ? Briefcase : ListTodo
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
      setItems([])
      setUnreadCount(0)
      setError(null)
      setIsLoading(false)
      return () => {
        isActive = false
      }
    }

    setIsLoading(true)
    setError(null)

    fetch('/api/notifications?limit=30', {
      method: 'GET',
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            payload && typeof payload.error === 'string'
              ? payload.error
              : 'No se pudieron cargar las notificaciones visibles.'
          throw new Error(message)
        }

        return payload as NotificationsResponse
      })
      .then((payload) => {
        if (isActive) {
          const nextState = readApiResponse(payload)
          setItems(nextState.items)
          setUnreadCount(nextState.unreadCount)
        }
      })
      .catch((nextError) => {
        if (isActive) {
          setItems([])
          setUnreadCount(0)
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'No se pudieron cargar las notificaciones visibles.'
          )
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false)
        }
      })

    return () => {
      isActive = false
    }
  }, [authMode, user])

  const handleMarkAsRead = async (notificationId: string) => {
    setMarkingId(notificationId)

    try {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          payload && typeof payload.error === 'string'
            ? payload.error
            : 'No se pudo marcar la notificacion como leida.'
        throw new Error(message)
      }

      const nextNotification = deserializeUserNotification((payload as { data: UserNotificationWire }).data)

      setItems((currentItems) =>
        currentItems.map((item) => (item.id === nextNotification.id ? nextNotification : item))
      )
      setUnreadCount((currentCount) => Math.max(0, currentCount - 1))
      window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT))
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'No se pudo marcar la notificacion como leida.'
      )
    } finally {
      setMarkingId(null)
    }
  }

  if (!user) return null

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-balance">Notificaciones</h1>
          {authMode === 'supabase' ? <Badge variant="outline">{unreadCount} sin leer</Badge> : null}
        </div>
        <p className="text-muted-foreground max-w-3xl">
          Inbox interno con notificaciones reales por usuario. No incluye push, email ni automatizaciones externas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bandeja personal</CardTitle>
          <CardDescription>
            Solo muestra eventos persistidos que ya forman parte de tu alcance visible actual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {authMode !== 'supabase' ? (
            <Empty className="border-0 px-0 py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellOff className="size-5" />
                </EmptyMedia>
                <EmptyTitle>Disponible en runtime Supabase</EmptyTitle>
                <EmptyDescription>
                  Este inbox depende de notificaciones persistidas por usuario. En mock no se generan.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : isLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="size-6" />
            </div>
          ) : error ? (
            <Empty className="border-0 px-0 py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Bell className="size-5" />
                </EmptyMedia>
                <EmptyTitle>No se pudo cargar el inbox</EmptyTitle>
                <EmptyDescription>{error}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : items.length === 0 ? (
            <Empty className="border-0 px-0 py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Bell className="size-5" />
                </EmptyMedia>
                <EmptyTitle>Sin notificaciones</EmptyTitle>
                <EmptyDescription>
                  No hay notificaciones visibles para tu usuario en este momento.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const DomainIcon = domainIcon(item.domain)
                const canOpenTarget = item.href !== '/dashboard/notifications'

                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-4 ${item.isRead ? 'bg-background' : 'bg-muted/30'}`}
                  >
                    <div className="flex gap-4">
                      <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <DomainIcon className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{domainLabel(item.domain)}</Badge>
                          {!item.isRead ? <Badge>No leida</Badge> : null}
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTimestamp(item.createdAt)}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <p className="font-medium leading-tight">{item.title}</p>
                          <p className="text-sm text-muted-foreground">{item.body}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {canOpenTarget ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={item.href}>Abrir</Link>
                            </Button>
                          ) : null}
                          {!item.isRead ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={markingId === item.id}
                              onClick={() => handleMarkAsRead(item.id)}
                            >
                              <CheckCheck className="mr-2 size-4" />
                              Marcar como leida
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
