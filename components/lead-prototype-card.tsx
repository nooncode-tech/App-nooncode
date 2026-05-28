'use client'

import Link from 'next/link'
import { startTransition, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Blocks, CheckCircle2, Coins, FolderKanban, Loader2, RefreshCw, Sparkles, Wallet } from 'lucide-react'
import { canAccessDashboardPath, useAuth } from '@/lib/auth-context'
import type { PrototypeWorkspace, WalletSummary } from '@/lib/types'
import { deserializeWalletSummary, type WalletSummaryWire } from '@/lib/wallet/serialization'
import {
  deserializePrototypeWorkspace,
  type PrototypeWorkspaceWire,
} from '@/lib/prototypes/serialization'
import {
  buildProjectDetailHref,
  buildPrototypeWorkspaceHref,
} from '@/lib/dashboard-navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface LeadPrototypeResponse {
  data: PrototypeWorkspaceWire | null
  meta: {
    prototypeRequestCost: number | null
    prototypeRequestsEnabled: boolean
    maxIterationsPerLead: number | null
    iterationsUsed: number
    iterationsRemaining: number | null
  }
}

interface PrototypeRequestResponse {
  data: {
    prototype: PrototypeWorkspaceWire
    wallet: Pick<WalletSummaryWire, 'freeAvailable' | 'earnedAvailable' | 'totalAvailable'>
    consumed: {
      free: number
      earned: number
      total: number
    }
  }
}

interface LeadPrototypeCardProps {
  leadId: string
  authMode: 'mock' | 'supabase'
  isDisabled?: boolean
  refreshKey?: number
}

function formatPrototypeStatus(status: PrototypeWorkspace['status']): string {
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

function formatEntryCountLabel(total: number): string {
  return `${total} credito${total === 1 ? '' : 's'}`
}

export function LeadPrototypeCard({
  leadId,
  authMode,
  isDisabled = false,
  refreshKey = 0,
}: LeadPrototypeCardProps) {
  const { user } = useAuth()
  const [wallet, setWallet] = useState<WalletSummary | null>(null)
  const [prototype, setPrototype] = useState<PrototypeWorkspace | null>(null)
  const [prototypeRequestCost, setPrototypeRequestCost] = useState<number | null>(null)
  const [prototypeRequestsEnabled, setPrototypeRequestsEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(authMode === 'supabase')
  const [isRequesting, setIsRequesting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sellerBrief, setSellerBrief] = useState('')
  const [maxIterationsPerLead, setMaxIterationsPerLead] = useState<number | null>(null)
  const [iterationsUsed, setIterationsUsed] = useState(0)
  const [iterationsRemaining, setIterationsRemaining] = useState<number | null>(null)

  useEffect(() => {
    let isActive = true

    if (authMode !== 'supabase') {
      startTransition(() => {
        setWallet(null)
        setPrototype(null)
        setPrototypeRequestCost(null)
        setPrototypeRequestsEnabled(false)
        setMaxIterationsPerLead(null)
        setIterationsUsed(0)
        setIterationsRemaining(null)
        setErrorMessage(null)
        setIsLoading(false)
      })
      return () => {
        isActive = false
      }
    }

    async function loadState() {
      startTransition(() => {
        setIsLoading(true)
        setErrorMessage(null)
      })

      try {
        const [walletResponse, prototypeResponse] = await Promise.all([
          fetch('/api/wallet?limit=5', {
            method: 'GET',
            cache: 'no-store',
          }),
          fetch(`/api/leads/${leadId}/prototype`, {
            method: 'GET',
            cache: 'no-store',
          }),
        ])

        const walletPayload = await walletResponse.json().catch(() => null)
        const prototypePayload = await prototypeResponse.json().catch(() => null)

        if (!walletResponse.ok) {
          throw new Error(
            walletPayload && typeof walletPayload.error === 'string'
              ? walletPayload.error
              : 'No se pudo cargar el saldo disponible.'
          )
        }

        if (!prototypeResponse.ok) {
          throw new Error(
            prototypePayload && typeof prototypePayload.error === 'string'
              ? prototypePayload.error
              : 'No se pudo cargar el estado del prototipo comercial.'
          )
        }

        if (!isActive) {
          return
        }

        setWallet(deserializeWalletSummary((walletPayload as { data: WalletSummaryWire }).data))
        setPrototype(
          prototypePayload && (prototypePayload as LeadPrototypeResponse).data
            ? deserializePrototypeWorkspace((prototypePayload as LeadPrototypeResponse).data as PrototypeWorkspaceWire)
            : null
        )
        const meta = (prototypePayload as LeadPrototypeResponse).meta
        setPrototypeRequestCost(meta.prototypeRequestCost)
        setPrototypeRequestsEnabled(meta.prototypeRequestsEnabled)
        setMaxIterationsPerLead(meta.maxIterationsPerLead ?? null)
        setIterationsUsed(meta.iterationsUsed ?? 0)
        setIterationsRemaining(meta.iterationsRemaining ?? null)
      } catch (error) {
        if (!isActive) {
          return
        }

        setWallet(null)
        setPrototype(null)
        setPrototypeRequestCost(null)
        setPrototypeRequestsEnabled(false)
        setMaxIterationsPerLead(null)
        setIterationsUsed(0)
        setIterationsRemaining(null)
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el estado del prototipo comercial.'
        )
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadState()

    return () => {
      isActive = false
    }
  }, [authMode, leadId, refreshKey])

  const hasConfiguredCost = prototypeRequestCost !== null
  const totalAvailable = wallet?.totalAvailable ?? 0
  const hasSufficientBalance = hasConfiguredCost && totalAvailable >= prototypeRequestCost
  const hasIterationsLeft = iterationsRemaining === null || iterationsRemaining > 0
  const canRequestPrototype =
    authMode === 'supabase'
    && !isDisabled
    && !isLoading
    && !errorMessage
    && !prototype
    && prototypeRequestsEnabled
    && hasConfiguredCost
    && hasSufficientBalance
    && hasIterationsLeft
  // Regenerate reuses the same request RPC (it supersedes prior versions and
  // creates a fresh one); it is only offered when a workspace already exists,
  // there is iteration budget left, and credits/balance allow it.
  const canRegenerate =
    authMode === 'supabase'
    && !isDisabled
    && !isLoading
    && !errorMessage
    && Boolean(prototype)
    && prototypeRequestsEnabled
    && hasConfiguredCost
    && hasSufficientBalance
    && hasIterationsLeft
  const canOpenPrototypes = user ? canAccessDashboardPath(user.role, '/dashboard/prototypes') : false
  const canOpenProjects = user ? canAccessDashboardPath(user.role, '/dashboard/projects') : false

  const handleConfirmRequest = async () => {
    const isRegenerate = Boolean(prototype)
    setIsRequesting(true)

    try {
      const trimmedBrief = sellerBrief.trim()
      const response = await fetch(`/api/leads/${leadId}/prototype`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trimmedBrief ? { sellerBrief: trimmedBrief } : {}),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          payload && typeof payload.error === 'string'
            ? payload.error
            : 'No se pudo solicitar el prototipo comercial.'
        throw new Error(message)
      }

      const result = payload as PrototypeRequestResponse
      setPrototype(deserializePrototypeWorkspace(result.data.prototype))
      setWallet((currentWallet) => ({
        freeAvailable: result.data.wallet.freeAvailable,
        earnedAvailable: result.data.wallet.earnedAvailable,
        totalAvailable: result.data.wallet.totalAvailable,
        prototypeRequestCost: currentWallet?.prototypeRequestCost,
        entries: currentWallet?.entries ?? [],
      }))
      // The request consumed one iteration: reflect it locally so the counter
      // and the regenerate affordance update without a refetch.
      setIterationsUsed((used) => used + 1)
      setIterationsRemaining((remaining) =>
        remaining === null ? null : Math.max(0, remaining - 1)
      )
      setSellerBrief('')
      setConfirmOpen(false)
      toast.success(
        isRegenerate
          ? `Nueva versión solicitada. Se consumieron ${formatEntryCountLabel(result.data.consumed.total)} y quedó pendiente de generación.`
          : `Solicitud registrada. Se consumieron ${formatEntryCountLabel(result.data.consumed.total)} y el prototipo quedo pendiente.`
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'No se pudo solicitar el prototipo comercial.'
      )
    } finally {
      setIsRequesting(false)
    }
  }

  return (
    <>
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base">Prototipo comercial</CardTitle>
              <p className="text-sm text-muted-foreground">
                Solicitar un prototipo consume creditos de tu saldo interno. Una vez solicitado, el admin o PM puede generar el contenido real con v0.
              </p>
            </div>
            {prototype ? (
              <Badge variant="outline" className="bg-primary/10 text-primary">
                {formatPrototypeStatus(prototype.status)}
              </Badge>
            ) : prototypeRequestsEnabled ? (
              <Badge variant="outline">Sin prototipo solicitado</Badge>
            ) : (
              <Badge variant="outline">No configurado</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 space-y-4">
          {authMode !== 'supabase' ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Disponible solo en runtime Supabase. En mock no existe wallet real ni consumo persistido de creditos.
            </div>
          ) : isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando wallet y estado del prototipo...
            </div>
          ) : errorMessage ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                No se pudo cargar el prototipo comercial
              </div>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Saldo disponible</p>
                  <p className="text-sm font-medium">{wallet?.totalAvailable ?? 0} creditos</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Creditos gratis</p>
                  <p className="text-sm font-medium">{wallet?.freeAvailable ?? 0}</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Saldo propio</p>
                  <p className="text-sm font-medium">{wallet?.earnedAvailable ?? 0}</p>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Costo actual</p>
                  <p className="text-sm font-medium">
                    {prototypeRequestCost !== null ? `${prototypeRequestCost} creditos` : 'No configurado'}
                  </p>
                </div>
              </div>

              {prototype ? (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="size-4 text-primary" />
                    Solicitud registrada
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Este lead ya tiene un workspace de prototipo en estado <span className="font-medium text-foreground">{formatPrototypeStatus(prototype.status)}</span>.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    El admin o PM puede generar el contenido desde la vista de Prototipos usando v0.
                  </p>
                  {maxIterationsPerLead !== null ? (
                    <p className="text-xs text-muted-foreground">
                      Versiones: <span className="font-medium text-foreground">{iterationsUsed} de {maxIterationsPerLead}</span>
                      {iterationsRemaining !== null
                        ? hasIterationsLeft
                          ? ` · te quedan ${iterationsRemaining}`
                          : ' · límite alcanzado'
                        : ''}
                    </p>
                  ) : null}
                  {prototype.sellerBrief ? (
                    <div className="rounded-md border bg-background p-3">
                      <p className="text-xs font-medium text-foreground">Brief del vendedor</p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{prototype.sellerBrief}</p>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {canRegenerate ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setConfirmOpen(true)}
                        disabled={isRequesting}
                      >
                        {isRequesting ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4 mr-2" />
                        )}
                        Generar nueva versión
                      </Button>
                    ) : null}
                    {canOpenPrototypes ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={buildPrototypeWorkspaceHref(leadId)}>
                          <Blocks className="size-4 mr-2" />
                          Ver workspace
                        </Link>
                      </Button>
                    ) : null}
                    {prototype.projectId && canOpenProjects ? (
                      <Button asChild size="sm">
                        <Link href={buildProjectDetailHref(prototype.projectId)}>
                          <FolderKanban className="size-4 mr-2" />
                          Ir a proyecto
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                  {!hasIterationsLeft ? (
                    <p className="text-xs text-amber-700">
                      Este lead alcanzó el límite de versiones de prototipo.
                    </p>
                  ) : !hasSufficientBalance ? (
                    <p className="text-xs text-amber-700">
                      Saldo insuficiente para generar otra versión ({prototypeRequestCost} créditos).
                    </p>
                  ) : null}
                </div>
              ) : !prototypeRequestsEnabled ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  La solicitud de prototipos todavia no esta configurada para este runtime.
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Solicitud manual de prototipo</p>
                      <p className="text-sm text-muted-foreground">
                        Esta accion descuenta creditos y crea el workspace. El admin o PM luego genera el contenido real con v0 desde la vista de Prototipos.
                      </p>
                    </div>
                  </div>

                  {!hasSufficientBalance ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      Saldo insuficiente. Necesitas {prototypeRequestCost} creditos y hoy tienes {wallet?.totalAvailable ?? 0}.
                    </div>
                  ) : null}

                  {isDisabled ? (
                    <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                      Reclama o reasigna este lead antes de consumir creditos en un prototipo.
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => setConfirmOpen(true)}
                      disabled={!canRequestPrototype || isRequesting}
                    >
                      {isRequesting ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <Coins className="size-4 mr-2" />
                      )}
                      Solicitar prototipo
                    </Button>
                    <Button asChild type="button" variant="outline">
                      <Link href="/dashboard/credits">
                        <Wallet className="size-4 mr-2" />
                        Ver creditos
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {prototype ? 'Generar nueva versión' : 'Solicitar prototipo'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion consume {prototypeRequestCost ?? 0} creditos de tu saldo interno.{' '}
              {prototype
                ? 'Se creará una nueva versión del prototipo (las versiones anteriores quedan invalidadas) lista para generar con v0.'
                : 'El workspace quedara listo para que el admin o PM genere el contenido con v0.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label htmlFor="seller-brief" className="text-sm font-medium">
              Detalle para el prototipo (opcional)
            </label>
            <Textarea
              id="seller-brief"
              value={sellerBrief}
              onChange={(event) => setSellerBrief(event.target.value.slice(0, 2000))}
              placeholder="Ej: enfócate en el panel de reservas, tono sobrio, incluir métricas de ventas..."
              rows={4}
              disabled={isRequesting}
            />
            <p className="text-xs text-muted-foreground">
              Se suma al prompt automático del lead para guiar la generación con v0. {sellerBrief.length}/2000
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRequesting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={isRequesting} onClick={handleConfirmRequest}>
              {isRequesting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Consumiendo creditos...
                </>
              ) : (
                'Confirmar consumo'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
