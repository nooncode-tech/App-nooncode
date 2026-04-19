'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Activity, BellOff, Briefcase, ChevronRight, ListTodo } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import type { UpdateFeedItem } from '@/lib/types'
import { deserializeUpdateFeedItem, type UpdateFeedItemWire } from '@/lib/updates/serialization'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

interface UpdateFeedResponse {
  data: UpdateFeedItemWire[]
}

function formatRelativeTimestamp(value: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

function readApiResponse(payload: UpdateFeedResponse): UpdateFeedItem[] {
  return payload.data.map(deserializeUpdateFeedItem)
}

function domainLabel(domain: UpdateFeedItem['domain']): string {
  return domain === 'sales' ? 'Ventas' : 'Delivery'
}

function domainIcon(domain: UpdateFeedItem['domain']) {
  return domain === 'sales' ? Briefcase : ListTodo
}

export default function UpdatesPage() {
  const { authMode, user } = useAuth()
  const [items, setItems] = useState<UpdateFeedItem[]>([])
  const [isLoading, setIsLoading] = useState(authMode === 'supabase')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true

    if (authMode !== 'supabase' || !user) {
      setItems([])
      setError(null)
      setIsLoading(false)
      return () => {
        isActive = false
      }
    }

    setIsLoading(true)
    setError(null)

    fetch('/api/updates?limit=30', {
      method: 'GET',
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            payload && typeof payload.error === 'string'
              ? payload.error
              : 'No se pudieron cargar las actualizaciones visibles.'
          throw new Error(message)
        }

        return payload as UpdateFeedResponse
      })
      .then((payload) => {
        if (isActive) {
          setItems(readApiResponse(payload))
        }
      })
      .catch((nextError) => {
        if (isActive) {
          setItems([])
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'No se pudieron cargar las actualizaciones visibles.'
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

  if (!user) return null

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-balance">Actualizaciones</h1>
        <p className="text-muted-foreground max-w-3xl">
          Feed interno read-only con eventos reales visibles para tu alcance actual.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actividad visible reciente</CardTitle>
          <CardDescription>
            No incluye notificaciones push o email. Solo muestra eventos ya persistidos en el sistema.
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
                  Este feed solo se alimenta de eventos reales persistidos. En mock no se generan actualizaciones.
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
                  <Activity className="size-5" />
                </EmptyMedia>
                <EmptyTitle>No se pudo cargar el feed</EmptyTitle>
                <EmptyDescription>{error}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : items.length === 0 ? (
            <Empty className="border-0 px-0 py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Activity className="size-5" />
                </EmptyMedia>
                <EmptyTitle>Sin actividad reciente</EmptyTitle>
                <EmptyDescription>
                  No hay eventos visibles recientes para tu rol en este runtime.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const DomainIcon = domainIcon(item.domain)

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-start gap-4 rounded-xl border p-4 transition-colors hover:bg-muted/40"
                  >
                    <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <DomainIcon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{domainLabel(item.domain)}</Badge>
                        <span className="text-xs text-muted-foreground">{formatRelativeTimestamp(item.createdAt)}</span>
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium leading-tight">{item.title}</p>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{item.entityLabel}</span>
                        <span>-</span>
                        <span>{item.actorName}</span>
                      </div>
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
