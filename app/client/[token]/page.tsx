'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, Clock, AlertCircle, CreditCard } from 'lucide-react'

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
}

const statusConfig: Record<string, { label: string; color: string }> = {
  backlog:     { label: 'En espera',      color: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'En progreso',    color: 'bg-blue-500/10 text-blue-600' },
  review:      { label: 'En revisión',    color: 'bg-yellow-500/10 text-yellow-600' },
  done:        { label: 'Entregado',      color: 'bg-green-500/10 text-green-600' },
  cancelled:   { label: 'Cancelado',      color: 'bg-destructive/10 text-destructive' },
}

export default function ClientPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [project, setProject] = useState<ClientProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`/api/client/resolve?token=${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setProject(json.data)
        else setError(json.error ?? 'Enlace inválido o expirado')
      })
      .catch(() => setError('Error de red'))
      .finally(() => setLoading(false))
  }, [token])

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
    <div className="min-h-screen bg-background flex flex-col items-center py-16 px-4 gap-6">
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground">Portal de cliente · NoonApp</p>
        <h1 className="text-2xl font-bold">
          {project.client_name ? `Hola, ${project.client_name}` : 'Tu proyecto'}
        </h1>
      </div>

      <Card className="max-w-lg w-full">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">{project.project_name}</CardTitle>
            {project.proposal_title && (
              <p className="text-sm text-muted-foreground mt-1">{project.proposal_title}</p>
            )}
          </div>
          <Badge variant="outline" className={statusInfo.color}>
            {statusInfo.label}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Payment section */}
          {project.proposal_amount && project.proposal_amount > 0 && (
            <div className="p-4 rounded-lg border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Monto del proyecto</span>
                <span className="font-bold text-lg">
                  ${Number(project.proposal_amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} USD
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Estado del pago</span>
                {isPaid ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-green-600">
                    <CheckCircle2 className="size-4" />
                    Pagado
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="size-4" />
                    Pendiente
                  </span>
                )}
              </div>

              {canPay && (
                <Button
                  className="w-full"
                  onClick={handlePay}
                  disabled={paying}
                >
                  {paying ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <CreditCard className="size-4 mr-2" />
                  )}
                  Pagar ahora
                </Button>
              )}
            </div>
          )}

          {/* Project status timeline */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Estado actual</p>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
              <div className={`size-2 rounded-full ${isPaid ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="text-sm">
                {isPaid
                  ? 'Proyecto activado — en desarrollo'
                  : 'Esperando confirmación de pago para iniciar'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center max-w-sm">
        Este es tu espacio privado de seguimiento. Si tienes preguntas, contacta a tu representante de Noon.
      </p>
    </div>
  )
}
