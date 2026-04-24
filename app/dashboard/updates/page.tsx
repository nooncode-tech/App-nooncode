'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Activity, BellOff, Briefcase, ChevronRight, ListTodo } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import type { UpdateFeedItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { deserializeUpdateFeedItem, type UpdateFeedItemWire } from '@/lib/updates/serialization'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

interface UpdateFeedResponse {
  data: UpdateFeedItemWire[]
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
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
      setItems([]); setError(null); setIsLoading(false)
      return () => { isActive = false }
    }
    setIsLoading(true); setError(null)
    fetch('/api/updates?limit=50', { method: 'GET', cache: 'no-store' })
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error(payload?.error ?? 'Error al cargar')
        return payload as UpdateFeedResponse
      })
      .then((payload) => { if (isActive) setItems(readApiResponse(payload)) })
      .catch((e) => { if (isActive) { setItems([]); setError(e instanceof Error ? e.message : 'Error') } })
      .finally(() => { if (isActive) setIsLoading(false) })
    return () => { isActive = false }
  }, [authMode, user])

  if (!user) return null

  return (
    <div className="app-page">
      <div className="app-page-header">
        <div>
        <h1 className="app-page-title">Actualizaciones</h1>
        <p className="app-page-subtitle">Feed interno de eventos visibles para tu alcance actual.</p>
        </div>
      </div>

      <div className="app-feed">
        {authMode !== 'supabase' ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><BellOff className="size-5" /></EmptyMedia>
              <EmptyTitle>Disponible en runtime Supabase</EmptyTitle>
              <EmptyDescription>Este feed solo se alimenta de eventos reales persistidos.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : isLoading ? (
          <div className="flex min-h-40 items-center justify-center">
            <Spinner className="size-5" />
          </div>
        ) : error ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Activity className="size-5" /></EmptyMedia>
              <EmptyTitle>No se pudo cargar el feed</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : items.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Activity className="size-5" /></EmptyMedia>
              <EmptyTitle>Sin actividad reciente</EmptyTitle>
              <EmptyDescription>No hay eventos visibles para tu rol en este momento.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-hidden rounded-md bg-card divide-y divide-border/80">
            {items.map((item) => {
              const DomainIcon = domainIcon(item.domain)
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40 group"
                >
                  {/* Icon */}
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-muted/80">
                    <DomainIcon className="size-3.5" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className="text-sm font-medium leading-tight">{item.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                        {formatTimestamp(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug mb-1">{item.description}</p>
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'rounded px-1.5 py-px text-[10px] font-medium',
                        item.domain === 'sales' ? 'bg-blue-500/10 text-blue-600' : 'bg-orange-500/10 text-orange-600'
                      )}>
                        {domainLabel(item.domain)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">{item.entityLabel}</span>
                      {item.actorName && (
                        <>
                          <span className="text-[10px] text-muted-foreground/40">·</span>
                          <span className="text-[10px] text-muted-foreground/70">{item.actorName}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
