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
  TrendingUp,
  Clock,
  Wallet,
  CreditCard,
  CircleOff,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { toast } from 'sonner'

interface EarningRow {
  id: string
  actor_id: string | null
  actor_role: 'seller' | 'developer' | 'noon'
  earning_type: 'activation' | 'monthly'
  amount: number
  currency: string
  status: 'credited' | 'paid_out' | 'cancelled'
  credited_at: string
  notes: string | null
  lead: { name: string; company: string | null } | null
  proposal: { title: string; amount: number } | null
}

interface EarningsSummary {
  totalCredited: number
  pendingPayout: number
  paidOut: number
  activationTotal: number
  monthlyTotal: number
}

const statusConfig = {
  credited: { label: 'Pendiente retiro', color: 'bg-yellow-500/10 text-yellow-600' },
  paid_out: { label: 'Pagado', color: 'bg-green-500/10 text-green-600' },
  cancelled: { label: 'Cancelado', color: 'bg-destructive/10 text-destructive' },
}

const typeConfig = {
  activation: { label: 'Activación', color: 'bg-blue-500/10 text-blue-600' },
  monthly: { label: 'Mensualidad', color: 'bg-purple-500/10 text-purple-600' },
}

const roleConfig = {
  seller: 'Vendedor',
  developer: 'Developer',
  noon: 'Noon',
}

interface WithdrawalRequest {
  id: string
  amount: number
  currency: string
  status: string
  requested_at: string
}

const withdrawalStatusConfig: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pendiente',  color: 'bg-yellow-500/10 text-yellow-600' },
  approved:  { label: 'Aprobado',   color: 'bg-blue-500/10 text-blue-600' },
  completed: { label: 'Completado', color: 'bg-green-500/10 text-green-600' },
  rejected:  { label: 'Rechazado',  color: 'bg-destructive/10 text-destructive' },
}

export default function EarningsPage() {
  const { authMode, user } = useAuth()
  const isSupabase = authMode === 'supabase'

  const [earnings, setEarnings] = useState<EarningRow[]>([])
  const [summary, setSummary] = useState<EarningsSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([])
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawNotes, setWithdrawNotes] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)

  const loadData = () => {
    if (!isSupabase) return
    setLoading(true)
    Promise.all([
      fetch('/api/earnings').then((r) => r.json()),
      fetch('/api/earnings/withdraw').then((r) => r.json()),
    ])
      .then(([earningsJson, withdrawalsJson]) => {
        if (earningsJson.data) {
          setEarnings(earningsJson.data.earnings)
          setSummary(earningsJson.data.summary)
        } else {
          setError(earningsJson.error ?? 'Error al cargar ganancias')
        }
        if (withdrawalsJson.data) setWithdrawals(withdrawalsJson.data)
      })
      .catch(() => setError('Error de red'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [isSupabase]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mis Ganancias</h1>
          <p className="text-muted-foreground">Comisiones acreditadas y pendientes de retiro</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setShowWithdrawDialog(true)}
          disabled={!summary || summary.pendingPayout <= 0}
        >
          <CreditCard className="size-4 mr-2" />
          Solicitar retiro
        </Button>
      </div>

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
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-primary-foreground/80">
                  Total Ganado
                </CardTitle>
                <Wallet className="size-4 text-primary-foreground/80" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  ${summary?.totalCredited.toFixed(2) ?? '0.00'}
                </div>
                <p className="text-xs text-primary-foreground/70 mt-1">Activaciones + mensualidades</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pendiente de retiro</CardTitle>
                <Clock className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${summary?.pendingPayout.toFixed(2) ?? '0.00'}</div>
                <p className="text-xs text-muted-foreground">Acreditado, sin retirar</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Por activaciones</CardTitle>
                <DollarSign className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${summary?.activationTotal.toFixed(2) ?? '0.00'}</div>
                <p className="text-xs text-muted-foreground">Pagos únicos de activación</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Por mensualidades</CardTitle>
                <TrendingUp className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${summary?.monthlyTotal.toFixed(2) ?? '0.00'}</div>
                <p className="text-xs text-muted-foreground">Pagos mensuales recurrentes</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Historial de ganancias</CardTitle>
            </CardHeader>
            <CardContent>
              {earnings.length === 0 ? (
                <Empty className="border-0 p-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <DollarSign className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>Sin ganancias aún</EmptyTitle>
                    <EmptyDescription>
                      Las comisiones aparecen aquí al confirmar el pago de un cliente.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente / Propuesta</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {earnings.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <p className="font-medium text-sm">
                            {row.lead?.company ?? row.lead?.name ?? '—'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {row.proposal?.title ?? '—'}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={typeConfig[row.earning_type].color}>
                            {typeConfig[row.earning_type].label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{roleConfig[row.actor_role]}</TableCell>
                        <TableCell className="font-semibold">
                          ${Number(row.amount).toFixed(2)} {row.currency}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusConfig[row.status].color}>
                            {statusConfig[row.status].label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(row.credited_at).toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {/* Withdrawal history */}
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
                            ${Number(w.amount).toFixed(2)} {w.currency}
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

      {/* Withdrawal dialog */}
      <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar retiro</DialogTitle>
            <DialogDescription>
              Disponible para retirar: <strong>${summary?.pendingPayout.toFixed(2) ?? '0.00'} USD</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="withdraw-amount">Monto a retirar (USD)</Label>
              <Input
                id="withdraw-amount"
                type="number"
                min={1}
                max={summary?.pendingPayout}
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
  )
}
