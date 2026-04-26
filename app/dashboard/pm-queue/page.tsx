'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type ReviewAction = 'approve' | 'reject' | 'request_changes' | 'cancel'

interface InboundLead {
  id: string
  name: string
  email: string
  company: string | null
  status: string
  value: number
  created_at: string
}

interface InboundProposal {
  id: string
  title: string
  body: string
  amount: number
  currency: string
  status: string
  review_status: string
  payment_status: string | null
  paid_at: string | null
  reviewed_at: string | null
  created_at: string
}

interface InboundProject {
  id: string
  name: string
  status: string
  created_at: string
}

interface InboundQueueItem {
  id: string
  external_source: string
  external_session_id: string
  external_proposal_id: string
  external_payment_id: string | null
  current_status: string
  review_webhook_status: string | null
  review_webhook_error: string | null
  inbound_payload: unknown
  created_at: string
  updated_at: string
  lead: InboundLead | InboundLead[] | null
  proposal: InboundProposal | InboundProposal[] | null
  project: InboundProject | InboundProject[] | null
}

interface QueueResponse {
  data?: InboundQueueItem[]
  error?: string
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function formatMoney(amount?: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount ?? 0)
}

function formatDate(value?: string | null) {
  if (!value) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function compactId(value: string) {
  if (value.length <= 14) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function readPrototypeUrl(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('maxwell' in payload)) return null
  const maxwell = (payload as { maxwell?: unknown }).maxwell
  if (!maxwell || typeof maxwell !== 'object' || !('prototype_url' in maxwell)) return null
  const url = (maxwell as { prototype_url?: unknown }).prototype_url
  return typeof url === 'string' && url.trim() ? url : null
}

function getStatusCopy(item: InboundQueueItem, proposal: InboundProposal | null) {
  if (item.current_status === 'project_activated') return 'Proyecto activado'
  if (item.current_status === 'review_webhook_sent') return 'Decision enviada'
  if (item.current_status === 'review_webhook_failed') return 'Webhook fallido'
  if (proposal?.review_status === 'changes_requested') return 'Ajustes solicitados'
  if (proposal?.review_status === 'rejected') return 'Rechazada'
  if (proposal?.review_status === 'cancelled') return 'Cancelada'
  return 'Pendiente PM'
}

function QueueCard({
  item,
  isPending,
  actionKey,
  onReview,
  onRetryApproval,
}: {
  item: InboundQueueItem
  isPending: boolean
  actionKey: string | null
  onReview: (proposalId: string, action: ReviewAction) => Promise<void>
  onRetryApproval: (proposalId: string) => Promise<void>
}) {
  const lead = one(item.lead)
  const proposal = one(item.proposal)
  const project = one(item.project)

  if (!proposal || !lead) return null

  const isBusy = actionKey?.startsWith(proposal.id)
  const statusCopy = getStatusCopy(item, proposal)
  const prototypeUrl = readPrototypeUrl(item.inbound_payload)
  const canRetryApproval =
    !isPending &&
    ['approved', 'rejected', 'changes_requested', 'cancelled'].includes(proposal.review_status) &&
    (item.review_webhook_status === 'failed' || item.review_webhook_status === 'skipped')

  return (
    <article className="border-t border-border/70 first:border-t-0">
      <div className="grid gap-5 px-1 py-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{proposal.title}</h3>
            <Badge variant="secondary" className="rounded-full text-[11px] font-medium">
              {statusCopy}
            </Badge>
            {proposal.payment_status === 'succeeded' && (
              <Badge className="rounded-full bg-emerald-600 text-[11px] font-medium text-white">
                Pago confirmado
              </Badge>
            )}
          </div>

          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{proposal.body}</p>

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>
              Cliente <strong className="font-medium text-foreground">{lead.company ?? lead.name}</strong>
            </span>
            <span>
              Contacto <strong className="font-medium text-foreground">{lead.email}</strong>
            </span>
            <span>
              Monto <strong className="font-medium text-foreground">{formatMoney(proposal.amount, proposal.currency)}</strong>
            </span>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>Session {compactId(item.external_session_id)}</span>
            <span>Proposal {compactId(item.external_proposal_id)}</span>
            {item.external_payment_id && <span>Payment {compactId(item.external_payment_id)}</span>}
            {project && <span>Proyecto {compactId(project.id)}</span>}
          </div>

          {item.review_webhook_status === 'failed' && item.review_webhook_error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
              Website no pudo recibir la decision PM: {item.review_webhook_error}
            </p>
          )}

          {prototypeUrl && (
            <a
              href={prototypeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              Ver prototipo <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        <div className="flex flex-col justify-between gap-4 lg:items-end">
          <div className="text-left text-xs text-muted-foreground lg:text-right">
            <p>Recibida</p>
            <p className="mt-1 font-medium text-foreground">{formatDate(item.created_at)}</p>
            {proposal.reviewed_at && (
              <>
                <p className="mt-3">Revisada</p>
                <p className="mt-1 font-medium text-foreground">{formatDate(proposal.reviewed_at)}</p>
              </>
            )}
          </div>

          {isPending && (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button
                size="sm"
                onClick={() => onReview(proposal.id, 'approve')}
                disabled={isBusy}
                className="h-9"
              >
                {actionKey === `${proposal.id}:approve` ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Check className="mr-2 size-4" />
                )}
                Aprobar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReview(proposal.id, 'request_changes')}
                disabled={isBusy}
                className="h-9"
              >
                {actionKey === `${proposal.id}:request_changes` ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <X className="mr-2 size-4" />
                )}
                Solicitar ajuste
              </Button>
            </div>
          )}

          {canRetryApproval && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRetryApproval(proposal.id)}
              disabled={isBusy}
              className="h-9"
            >
              {actionKey === `${proposal.id}:retry` ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Reintentar envio
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

export default function PmQueuePage() {
  const [items, setItems] = useState<InboundQueueItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [actionKey, setActionKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadQueue = useCallback(async () => {
    setError(null)
    const response = await fetch('/api/inbound/pm-queue', { cache: 'no-store' })
    const payload = (await response.json().catch(() => null)) as QueueResponse | null

    if (!response.ok) {
      throw new Error(payload?.error ?? 'No se pudo cargar la bandeja PM.')
    }

    setItems(payload?.data ?? [])
  }, [])

  useEffect(() => {
    let active = true
    setIsLoading(true)
    loadQueue()
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'No se pudo cargar la bandeja PM.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [loadQueue])

  const pendingItems = useMemo(
    () =>
      items.filter((item) => {
        const proposal = one(item.proposal)
        return proposal?.review_status === 'pending_review' && item.current_status === 'proposal_pending_review'
      }),
    [items]
  )

  const historyItems = useMemo(
    () =>
      items.filter((item) => {
        const proposal = one(item.proposal)
        return !(proposal?.review_status === 'pending_review' && item.current_status === 'proposal_pending_review')
      }),
    [items]
  )

  const handleReview = useCallback(
    async (proposalId: string, action: ReviewAction) => {
      setActionKey(`${proposalId}:${action}`)
      setError(null)

      try {
        const response = await fetch(`/api/proposals/${proposalId}/review`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(payload?.error ?? 'No se pudo actualizar la revision.')
        }

        await loadQueue()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo actualizar la revision.')
      } finally {
        setActionKey(null)
      }
    },
    [loadQueue]
  )

  const handleRetryApproval = useCallback(
    async (proposalId: string) => {
      setActionKey(`${proposalId}:retry`)
      setError(null)

      try {
        const response = await fetch(`/api/inbound/pm-queue/${proposalId}/review-webhook`, {
          method: 'POST',
        })
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(payload?.error ?? 'No se pudo reenviar la decision a website.')
        }

        await loadQueue()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo reenviar la decision a website.')
      } finally {
        setActionKey(null)
      }
    },
    [loadQueue]
  )

  return (
    <div className="app-page">
      <div className="app-page-header">
        <div>
          <h1 className="app-page-title">Bandeja PM</h1>
          <p className="app-page-subtitle">
            Revisa propuestas inbound creadas desde la website antes de que el cliente pueda verlas y pagar.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setIsLoading(true)
            loadQueue()
              .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar la bandeja PM.'))
              .finally(() => setIsLoading(false))
          }}
          disabled={isLoading}
          className="h-10"
        >
          <RefreshCw className={['mr-2 size-4', isLoading ? 'animate-spin' : ''].join(' ')} />
          Actualizar
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="app-section">
        <div className="app-section-header">
          <div>
            <h2 className="app-section-title">Pendientes de revision</h2>
            <p className="app-section-subtitle">Solo aqui se aprueba que la website publique la propuesta.</p>
          </div>
          <Badge variant="secondary" className="rounded-full">
            {pendingItems.length}
          </Badge>
        </div>

        <div className="app-panel">
          {isLoading ? (
            <div className="flex min-h-[180px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Cargando propuestas inbound...
            </div>
          ) : pendingItems.length > 0 ? (
            pendingItems.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                isPending
                actionKey={actionKey}
                onReview={handleReview}
                onRetryApproval={handleRetryApproval}
              />
            ))
          ) : (
            <div className="flex min-h-[180px] items-center justify-center text-sm text-muted-foreground">
              No hay propuestas inbound pendientes.
            </div>
          )}
        </div>
      </section>

      <section className="app-section">
        <div className="app-section-header">
          <div>
            <h2 className="app-section-title">Historial inbound</h2>
            <p className="app-section-subtitle">Propuestas revisadas, enviadas a website o convertidas en proyecto.</p>
          </div>
        </div>

        <div className="app-panel">
          {historyItems.length > 0 ? (
            historyItems.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                isPending={false}
                actionKey={actionKey}
                onReview={handleReview}
                onRetryApproval={handleRetryApproval}
              />
            ))
          ) : (
            <div className="flex min-h-[140px] items-center justify-center text-sm text-muted-foreground">
              Todavia no hay historial inbound.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
