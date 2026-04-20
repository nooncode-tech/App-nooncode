'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
  CreditCard,
  MessageSquare,
  Send,
  Sparkles,
  ArrowRight,
} from 'lucide-react'

interface ClientProject {
  token_id: string
  project_id: string
  project_name: string
  project_status: string
  client_name: string | null
  client_email: string | null
  lead_id: string | null
  proposal_id: string | null
  proposal_title: string | null
  proposal_amount: number | null
  payment_status: string | null
  payment_activated: boolean
  latest_update_text: string | null
  latest_update_date: string | null
  latest_update_next_step: string | null
}

interface Comment {
  id: string
  body: string
  created_at: string
}

const statusConfig: Record<string, { label: string; color: string }> = {
  backlog:     { label: 'En preparación', color: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'En desarrollo',  color: 'bg-blue-500/10 text-blue-600' },
  review:      { label: 'En revisión',    color: 'bg-yellow-500/10 text-yellow-600' },
  delivered:   { label: 'Entregado',      color: 'bg-emerald-500/10 text-emerald-700' },
  completed:   { label: 'Completado',     color: 'bg-emerald-500/10 text-emerald-700' },
}

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [project, setProject] = useState<ClientProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)

  const [comments, setComments] = useState<Comment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [sending, setSending] = useState(false)
  const commentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!token) return
    fetch(`/api/client/resolve?token=${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          setProject(json.data)
          loadComments()
        } else {
          setError(json.error ?? 'Enlace inválido o expirado')
        }
      })
      .catch(() => setError('Error de red'))
      .finally(() => setLoading(false))
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadComments = () => {
    fetch(`/api/client/comments?token=${token}`)
      .then((r) => r.json())
      .then((json) => { if (json.data) setComments(json.data) })
      .catch(() => {})
  }

  const handlePay = async () => {
    if (!project?.proposal_id) return
    setPaying(true)
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: project.proposal_id,
          leadId: project.lead_id,
          projectId: project.project_id,
          clientName: project.client_name ?? 'Cliente',
          clientEmail: project.client_email,
        }),
      })
      const json = await res.json()
      if (json.data?.url) {
        window.location.href = json.data.url
      } else {
        setError(json.error ?? 'No se pudo iniciar el pago')
      }
    } catch {
      setError('Error al iniciar el pago')
    } finally {
      setPaying(false)
    }
  }

  const handleSendComment = async () => {
    if (!commentBody.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/client/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, body: commentBody.trim() }),
      })
      if (res.ok) {
        setCommentBody('')
        loadComments()
      }
    } catch {
      // silent fail — portal should stay functional
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center space-y-3">
            <AlertCircle className="size-10 text-destructive mx-auto" />
            <p className="font-semibold text-lg">Enlace no válido</p>
            <p className="text-muted-foreground text-sm">{error ?? 'Este enlace ha expirado o no existe.'}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusInfo = statusConfig[project.project_status] ?? { label: project.project_status, color: 'bg-muted text-muted-foreground' }
  const isPaid = project.payment_status === 'succeeded' || project.payment_activated
  const canPay = !isPaid && !!project.proposal_id && project.proposal_amount && project.proposal_amount > 0

  return (
    <div className="min-h-screen bg-background flex flex-col items-center py-12 px-4 gap-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="text-center space-y-1 w-full">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">Portal de cliente · Noon</p>
        <h1 className="text-2xl font-bold">
          {project.client_name ? `Hola, ${project.client_name}` : 'Tu proyecto'}
        </h1>
      </div>

      {/* Project status card */}
      <Card className="w-full">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base">{project.project_name}</CardTitle>
            {project.proposal_title && (
              <p className="text-xs text-muted-foreground mt-0.5">{project.proposal_title}</p>
            )}
          </div>
          <Badge variant="outline" className={statusInfo.color}>{statusInfo.label}</Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Payment section */}
          {project.proposal_amount && project.proposal_amount > 0 && (
            <div className="p-4 rounded-lg border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Inversión del proyecto</span>
                <span className="font-bold">
                  ${Number(project.proposal_amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Estado del pago</span>
                {isPaid ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                    <CheckCircle2 className="size-4" /> Pagado
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="size-4" /> Pendiente
                  </span>
                )}
              </div>
              {canPay && (
                <Button className="w-full" onClick={handlePay} disabled={paying}>
                  {paying ? <Loader2 className="size-4 mr-2 animate-spin" /> : <CreditCard className="size-4 mr-2" />}
                  Pagar ahora
                </Button>
              )}
            </div>
          )}

          {/* Project activation status */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm">
            <div className={`size-2 rounded-full shrink-0 ${isPaid ? 'bg-emerald-500' : 'bg-yellow-400'}`} />
            {isPaid
              ? 'Proyecto activo — el equipo de Noon está trabajando en él'
              : 'Proyecto en espera de confirmación de pago para iniciar'}
          </div>
        </CardContent>
      </Card>

      {/* Latest Update */}
      {project.latest_update_text && (
        <Card className="w-full border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Última actualización
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{project.latest_update_text}</p>
            {project.latest_update_date && (
              <p className="text-xs text-muted-foreground">
                {new Date(project.latest_update_date).toLocaleDateString('es-MX', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </p>
            )}
            {project.latest_update_next_step && (
              <div className="flex items-start gap-1.5 pt-1 text-xs text-primary">
                <ArrowRight className="size-3.5 shrink-0 mt-0.5" />
                <span><strong>Siguiente paso:</strong> {project.latest_update_next_step}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Comments */}
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="size-4" />
            Mensajes al equipo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {comments.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-muted/50 px-3 py-2 text-sm space-y-0.5">
                  <p>{c.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              ref={commentRef}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Escribe un mensaje o pregunta al equipo..."
              rows={2}
              className="flex-1 resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSendComment()
                }
              }}
            />
            <Button
              size="icon"
              onClick={handleSendComment}
              disabled={sending || !commentBody.trim()}
              className="shrink-0 self-end"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            El equipo de Noon revisará tu mensaje y te contactará pronto.
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Este es tu espacio privado de seguimiento con Noon.
      </p>
    </div>
  )
}
