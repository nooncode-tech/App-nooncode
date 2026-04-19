'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Blocks, CircleOff, FolderKanban, Link2, Sparkles, UserRound, Wand2 } from 'lucide-react'
import { useAuth, canAccessDashboardPath } from '@/lib/auth-context'
import type { PrototypeWorkspaceListItem } from '@/lib/types'
import {
  deserializePrototypeWorkspaceListItem,
  type PrototypeWorkspaceListItemWire,
} from '@/lib/prototypes/serialization'
import { toast } from 'sonner'
import {
  buildLeadDetailHref,
  buildProjectDetailHref,
} from '@/lib/dashboard-navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { useSearchParams } from 'next/navigation'

function formatPrototypeStatus(status: PrototypeWorkspaceListItem['status']): string {
  if (status === 'pending_generation') {
    return 'Pendiente de generacion'
  }

  if (status === 'ready') {
    return 'Listo'
  }

  if (status === 'delivery_active') {
    return 'Activo en delivery'
  }

  return 'Archivado'
}

function formatPrototypeStage(stage: PrototypeWorkspaceListItem['currentStage']): string {
  return stage === 'sales' ? 'Etapa comercial' : 'Etapa delivery'
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

interface PrototypeListResponse {
  data: PrototypeWorkspaceListItemWire[]
}

export default function PrototypesPage() {
  const { authMode, user } = useAuth()
  const searchParams = useSearchParams()
  const requestedLeadId = searchParams.get('leadId')
  const [items, setItems] = useState<PrototypeWorkspaceListItem[]>([])
  const [isLoading, setIsLoading] = useState(authMode === 'supabase')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [generatedContent, setGeneratedContent] = useState<Record<string, string>>({})
  const [demoUrls, setDemoUrls] = useState<Record<string, string>>({})
  const [chatUrls, setChatUrls] = useState<Record<string, string>>({})

  const handleGenerate = async (workspaceId: string) => {
    setGeneratingId(workspaceId)
    try {
      const res = await fetch(`/api/prototypes/${workspaceId}/generate`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? 'Error al generar prototipo')
        return
      }
      setGeneratedContent((prev) => ({ ...prev, [workspaceId]: json.data.generatedContent }))
      if (json.data.demoUrl) setDemoUrls((prev) => ({ ...prev, [workspaceId]: json.data.demoUrl }))
      if (json.data.chatUrl) setChatUrls((prev) => ({ ...prev, [workspaceId]: json.data.chatUrl }))
      setItems((prev) =>
        prev.map((item) =>
          item.id === workspaceId ? { ...item, status: 'ready' as const } : item
        )
      )
      toast.success('Prototipo generado correctamente')
    } catch {
      toast.error('Error de red al generar prototipo')
    } finally {
      setGeneratingId(null)
    }
  }

  useEffect(() => {
    let isActive = true

    if (authMode !== 'supabase' || !user) {
      setItems([])
      setErrorMessage(null)
      setIsLoading(false)
      return () => {
        isActive = false
      }
    }

    setIsLoading(true)
    setErrorMessage(null)

    const params = new URLSearchParams({ limit: '30' })

    if (requestedLeadId) {
      params.set('leadId', requestedLeadId)
    }

    fetch(`/api/prototypes?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            payload && typeof payload.error === 'string'
              ? payload.error
              : 'No se pudieron cargar los workspaces de prototipo.'
          throw new Error(message)
        }

        return payload as PrototypeListResponse
      })
      .then((payload) => {
        if (isActive) {
          setItems(payload.data.map(deserializePrototypeWorkspaceListItem))
        }
      })
      .catch((error) => {
        if (isActive) {
          setItems([])
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'No se pudieron cargar los workspaces de prototipo.'
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
  }, [authMode, requestedLeadId, user])

  if (!user) return null

  const canOpenLeads = canAccessDashboardPath(user.role, '/dashboard/leads')
  const canOpenProjects = canAccessDashboardPath(user.role, '/dashboard/projects')

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-balance">Prototipos</h1>
          {authMode === 'supabase' ? <Badge variant="outline">Workspace comercial</Badge> : null}
          {requestedLeadId ? <Badge variant="secondary">Filtrado por lead</Badge> : null}
        </div>
        <p className="text-muted-foreground max-w-3xl">
          Esta surface muestra workspaces de prototipo reales ya solicitados desde leads. No implica que el contenido IA del prototipo ya exista.
        </p>
      </div>

      {authMode !== 'supabase' ? (
        <Card>
          <CardContent className="min-h-[320px]">
            <Empty className="h-full border-0 p-0">
              <EmptyHeader className="my-auto">
                <EmptyMedia variant="icon">
                  <CircleOff className="size-5" />
                </EmptyMedia>
                <EmptyTitle>Disponible en runtime Supabase</EmptyTitle>
                <EmptyDescription>
                  Los workspaces de prototipo dependen de persistencia real. En mock no existe esta fuente de verdad.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="flex min-h-[320px] items-center justify-center">
            <Spinner className="size-6" />
          </CardContent>
        </Card>
      ) : errorMessage ? (
        <Card>
          <CardContent className="min-h-[320px]">
            <Empty className="h-full border-0 p-0">
              <EmptyHeader className="my-auto">
                <EmptyMedia variant="icon">
                  <Blocks className="size-5" />
                </EmptyMedia>
                <EmptyTitle>No se pudieron cargar los prototipos</EmptyTitle>
                <EmptyDescription>{errorMessage}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="min-h-[320px]">
            <Empty className="h-full border-0 p-0">
              <EmptyHeader className="my-auto">
                <EmptyMedia variant="icon">
                  <Sparkles className="size-5" />
                </EmptyMedia>
                <EmptyTitle>Aun no hay workspaces solicitados</EmptyTitle>
                <EmptyDescription>
                  {requestedLeadId
                    ? 'Este lead todavia no tiene un workspace de prototipo visible.'
                    : 'Cuando un vendedor solicite un prototipo real desde un lead, aparecera aqui.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <Card key={item.id} className="gap-4 py-4">
              <CardHeader className="px-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{item.leadName}</CardTitle>
                    <CardDescription>
                      Workspace solicitado por {item.requestedByName} el {formatDate(item.createdAt)}.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="bg-primary/10 text-primary">
                      {formatPrototypeStatus(item.status)}
                    </Badge>
                    <Badge variant="secondary">{formatPrototypeStage(item.currentStage)}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Lead origen</p>
                    <p className="text-sm font-medium">{item.leadName}</p>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Proyecto vinculado</p>
                    <p className="text-sm font-medium">{item.projectName ?? 'Sin proyecto vinculado'}</p>
                  </div>
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Ultimo movimiento</p>
                    <p className="text-sm font-medium">{formatDate(item.updatedAt)}</p>
                  </div>
                </div>

                <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Link2 className="size-4 text-primary" />
                    Handoff actual
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {item.projectId
                      ? 'Este workspace ya esta vinculado a un proyecto real en delivery.'
                      : 'Todavia no existe un proyecto vinculado. El workspace sigue en trazabilidad comercial.'}
                  </p>
                </div>

                {generatedContent[item.id] ? (
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prototipo generado por v0</p>
                    {demoUrls[item.id] ? (
                      <a
                        href={demoUrls[item.id]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-medium text-primary underline underline-offset-2"
                      >
                        Ver demo en vivo →
                      </a>
                    ) : null}
                    {chatUrls[item.id] ? (
                      <a
                        href={chatUrls[item.id]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-muted-foreground underline"
                      >
                        Ver en v0.dev →
                      </a>
                    ) : null}
                    <pre className="text-xs overflow-auto max-h-64 whitespace-pre-wrap font-mono leading-relaxed">
                      {generatedContent[item.id]}
                    </pre>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {item.status === 'pending_generation' && (
                    <Button
                      size="sm"
                      onClick={() => handleGenerate(item.id)}
                      disabled={generatingId === item.id}
                    >
                      {generatingId === item.id ? (
                        <Spinner className="size-4 mr-2" />
                      ) : (
                        <Wand2 className="size-4 mr-2" />
                      )}
                      {generatingId === item.id ? 'Generando...' : 'Generar con v0'}
                    </Button>
                  )}
                  {canOpenLeads ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={buildLeadDetailHref(item.leadId)}>
                        <UserRound className="size-4 mr-2" />
                        Abrir lead
                      </Link>
                    </Button>
                  ) : null}
                  {item.projectId && canOpenProjects ? (
                    <Button asChild size="sm">
                      <Link href={buildProjectDetailHref(item.projectId)}>
                        <FolderKanban className="size-4 mr-2" />
                        Ir a proyecto
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
