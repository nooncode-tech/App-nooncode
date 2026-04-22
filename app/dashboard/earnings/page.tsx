'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DollarSign,
  Clock,
  Wallet,
  CreditCard,
  CircleOff,
  Loader2,
  CheckCircle2,
  ArrowDownToLine,
  Lock,
  ExternalLink,
  AlertCircle,
} from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { toast } from 'sonner'

interface EarningsSummary {
  totalEarned: number
  availableToWithdraw: number
  pending: number
  locked: number
}

interface LedgerEntry {
  id: string
  profile_id: string
  amount: number
  currency: string
  entry_type: string
  balance_bucket: string
  status: string
  reference_type: string | null
  reference_id: string | null
  actor_profile_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  actor_profile?: { full_name: string | null } | null
}

interface ConnectStatus {
  status: 'none' | 'pending' | 'active' | 'restricted'
  accountId: string | null
  chargesEnabled?: boolean
  detailsSubmitted?: boolean
}

interface WithdrawalRequest {
  id: string
  amount: number
  currency: string
  status: string
  requested_at: string
}

const bucketConfig: Record<string, { label: string; color: string }> = {
  pending:              { label: 'Pendiente',           color: 'bg-yellow-500/10 text-yellow-600' },
  available_to_withdraw:{ label: 'Disponible retiro',   color: 'bg-green-500/10 text-green-600' },
  available_to_spend:   { label: 'Disponible gasto',    color: 'bg-blue-500/10 text-blue-600' },
  locked:               { label: 'Bloqueado',           color: 'bg-destructive/10 text-destructive' },
}

const earningTypeLabel: Record<string, string> = {
  activation: 'Activación',
  membership: 'Membresía',
  milestone:  'Milestone',
  manual:     'Manual',
}

const withdrawalStatusConfig: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pendiente',  color: 'bg-yellow-500/10 text-yellow-600' },
  approved:  { label: 'Aprobado',   color: 'bg-blue-500/10 text-blue-600' },
  completed: { label: 'Completado', color: 'bg-green-500/10 text-green-600' },
  rejected:  { label: 'Rechazado',  color: 'bg-destructive/10 text-destructive' },
}

function fmt(n: number) {
  return `$${n.toFixed(2)}`
}

export default function EarningsPage() {
  const { authMode, user } = useAuth()
  const isSupabase = authMode === 'supabase'

  const [summary, setSummary] = useState<EarningsSummary | null>(null)
  const [history, setHistory] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawNotes, setWithdrawNotes] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)

  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null)
  const [connectLoading, setConnectLoading] = useState(false)
  const [connectInitiating, setConnectInitiating] = useState(false)

  const loadData = () => {
    if (!isSupabase) return
    setLoading(true)
    Promise.all([
      fetch('/api/earnings').then((r) => r.json()),
      fetch('/api/earnings/withdraw').then((r) => r.json()),
    ])
      .then(([earningsJson, withdrawalsJson]) => {
        if (earningsJson.data) {
          setSummary(earningsJson.data.summary)
          setHistory(earningsJson.data.history)
        } else {
          setError(earningsJson.error ?? 'Error al cargar ganancias')
        }
        if (withdrawalsJson.data) setWithdrawals(withdrawalsJson.data)
      })
      .catch(() => setError('Error de red'))
      .finally(() => setLoading(false))
  }

  const loadConnectStatus = () => {
    if (!isSupabase) return
    setConnectLoading(true)
    fetch('/api/connect/status')
      .then((r) => r.json())
      .then((json) => { if (json.data) setConnectStatus(json.data) })
      .catch(() => {})
      .finally(() => setConnectLoading(false))
  }

  const handleStartOnboarding = async () => {
    setConnectInitiating(true)
    try {
      const res = await fetch('/api/connect/onboard', { method: 'POST' })
      const json = await res.json()
      if (res.ok && json.data?.url) {
        window.location.href = json.data.url
      } else {
        toast.error(json.error ?? 'Error al iniciar configuración')
      }
    } catch {
      toast.error('Error de red')
    } finally {
      setConnectInitiating(false)
    }
  }

  useEffect(() => {
    loadData()
    loadConnectStatus()
  }, [isSupabase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount)
    if (!amount || amount <= 0) {
      toast.error('Ingresa un monto válido')
      return
    }
    setWithdrawing(true)
    try {
      const res = await fetch('/api/earnings/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, notes: withdrawNotes || null }),
      })
      const json = await res.json()
      if (res.ok) {
        toast.success('Solicitud de retiro enviada')
        setShowWithdrawDialog(false)
        setWithdrawAmount('')
        setWithdrawNotes('')
        loadData()
      } else {
        toast.error(json.error ?? 'Error al solicitar retiro')
      }
    } catch {
      toast.error('Error de red')
    } finally {
      setWithdrawing(false)
    }
  }

  if (!user) return null

  if (!isSupabase) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="min-h-[280px]">
            <Empty className="h-full border-0 p-0">
              <EmptyHeader className="my-auto">
                <EmptyMedia variant="icon">
                  <CircleOff className="size-5" />
                </EmptyMedia>
                <EmptyTitle>Ganancias no disponibles en modo demo</EmptyTitle>
                <EmptyDescription>Inicia sesión con Supabase para ver tu historial real de comisiones.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <div className="relative bg-[#000000] px-8 pt-4 pb-4 border-b border-white/[0.05] flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white leading-none">Mis Ganancias</h1>
          <p className="mt-1 text-xs text-white/40">Comisiones acreditadas desde el ledger monetario</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowWithdrawDialog(true)}
          disabled={!summary || summary.availableToWithdraw <= 0}
          className="shrink-0 border-white/20 text-white/70 hover:text-white hover:bg-white/10"
        >
          <CreditCard className="size-4 mr-2" />
          Solicitar retiro
        </Button>
      </div>
      <div className="px-8 py-8 space-y-8">

      {/* Stripe Connect card */}
      {!connectLoading && connectStatus && (
        <Card className={connectStatus.status === 'active' ? 'border-emerald-200 bg-emerald-50/40' : 'border-yellow-200 bg-yellow-50/40'}>
          <CardContent className="flex flex-col gap-3 pt-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              {connectStatus.status === 'active' ? (
                <CheckCircle2 className="size-5 text-emerald-600 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="size-5 text-yellow-600 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="font-medium text-sm">
                  {connectStatus.status === 'active' && 'Cuenta de retiro activa (Stripe Connect)'}
                  {connectStatus.status === 'pending' && 'Configura tu cuenta de retiro'}
                  {connectStatus.status === 'restricted' && 'Cuenta con restricciones — completa la verificación'}
                  {connectStatus.status === 'none' && 'Configura tu cuenta de retiro'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {connectStatus.status === 'active'
                    ? 'Puedes recibir pagos. Los retiros se procesan el primer día hábil de cada mes.'
                    : 'Completa el onboarding de Stripe para recibir pagos directamente en tu cuenta.'}
                </p>
              </div>
            </div>
            {connectStatus.status !== 'active' && (
              <Button
                size="sm"
                variant={connectStatus.status === 'none' || connectStatus.status === 'pending' ? 'default' : 'outline'}
                onClick={handleStartOnboarding}
                disabled={connectInitiating}
                className="shrink-0"
              >
                {connectInitiating
                  ? <Loader2 className="size-4 mr-2 animate-spin" />
                  : <ExternalLink className="size-4 mr-2" />}
                {connectStatus.status === 'none' ? 'Configurar cuenta' : 'Continuar configuración'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-primary text-primary-foreground">
              <CardContent className="pt-6 pb-5 px-6">
                <p className="text-xs font-medium uppercase tracking-wide text-primary-foreground/70">Total Ganado</p>
                <p className="stat-number-lg mt-2 text-primary-foreground">{fmt(summary?.totalEarned ?? 0)}</p>
                <p className="text-xs text-primary-foreground/60 mt-1.5">Acumulado histórico</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Disponible para retirar</p>
                <p className="stat-number mt-2 text-green-600">{fmt(summary?.availableToWithdraw ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1.5">Consolidado y listo</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Pendiente</p>
                <p className="stat-number mt-2 text-yellow-600">{fmt(summary?.pending ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1.5">En validación por PM</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Bloqueado</p>
                <p className="stat-number mt-2 text-destructive">{fmt(summary?.locked ?? 0)}</p>
                <p className="text-xs text-muted-foreground mt-1.5">En disputa o retención</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historial de ganancias</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <Empty className="border-0 p-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <DollarSign className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>Sin ganancias aún</EmptyTitle>
                    <EmptyDescription>
                      Las comisiones aparecen aquí una vez que un admin o PM las acredite.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Canal</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Bucket</TableHead>
                      <TableHead>Acreditado por</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => {
                      const meta = entry.metadata ?? {}
                      const earningType = String(meta.earningType ?? '')
                      const channel = String(meta.channel ?? '')
                      const creditedBy = String(meta.creditedBy ?? entry.actor_profile?.full_name ?? '—')
                      const bucket = bucketConfig[entry.balance_bucket] ?? { label: entry.balance_bucket, color: '' }
                      return (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-600">
                              {(earningTypeLabel[earningType] ?? earningType) || '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm capitalize">{channel || '—'}</TableCell>
                          <TableCell className="font-semibold">
                            {fmt(Number(entry.amount))} {entry.currency}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={bucket.color}>{bucket.label}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{creditedBy}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(entry.created_at).toLocaleDateString('es-MX', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {withdrawals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Solicitudes de retiro</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {withdrawals.map((w) => {
                      const wsc = withdrawalStatusConfig[w.status] ?? { label: w.status, color: '' }
                      return (
                        <TableRow key={w.id}>
                          <TableCell className="font-semibold">
                            {fmt(Number(w.amount))} {w.currency}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={wsc.color}>{wsc.label}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(w.requested_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar retiro</DialogTitle>
            <DialogDescription>
              Disponible para retirar: <strong>{fmt(summary?.availableToWithdraw ?? 0)} USD</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="withdraw-amount">Monto a retirar (USD)</Label>
              <Input
                id="withdraw-amount"
                type="number"
                min={1}
                max={summary?.availableToWithdraw}
                step={0.01}
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="withdraw-notes">Notas (opcional)</Label>
              <Textarea
                id="withdraw-notes"
                value={withdrawNotes}
                onChange={(e) => setWithdrawNotes(e.target.value)}
                placeholder="Método de pago preferido, cuenta, etc."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWithdrawDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleWithdraw} disabled={withdrawing}>
              {withdrawing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <CheckCircle2 className="size-4 mr-2" />}
              Enviar solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}
