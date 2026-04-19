'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Coins, CircleOff, History, Sparkles, Wallet } from 'lucide-react'
import { useAuth, canAccessDashboardPath } from '@/lib/auth-context'
import type { WalletSummary, WalletEntry } from '@/lib/types'
import { deserializeWalletSummary, type WalletSummaryWire } from '@/lib/wallet/serialization'
import { buildLeadDetailHref } from '@/lib/dashboard-navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

function formatEntryDate(value: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value)
}

function entryTypeLabel(entry: WalletEntry): string {
  if (entry.type === 'prototype_request_debit') {
    return 'Solicitud de prototipo'
  }

  if (entry.type === 'prototype_continue_debit') {
    return 'Continuacion de prototipo'
  }

  if (entry.type === 'free_grant') {
    return 'Credito gratis'
  }

  if (entry.type === 'earnings_credit') {
    return 'Credito por ganancias'
  }

  return 'Ajuste manual'
}

function bucketLabel(bucket: WalletEntry['bucket']): string {
  return bucket === 'free' ? 'Gratis' : 'Propio'
}

function deltaLabel(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`
}

export default function CreditsPage() {
  const { authMode, user } = useAuth()
  const [wallet, setWallet] = useState<WalletSummary | null>(null)
  const [isLoading, setIsLoading] = useState(authMode === 'supabase')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true

    if (authMode !== 'supabase' || !user) {
      setWallet(null)
      setErrorMessage(null)
      setIsLoading(false)
      return () => {
        isActive = false
      }
    }

    setIsLoading(true)
    setErrorMessage(null)

    fetch('/api/wallet?limit=30', {
      method: 'GET',
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            payload && typeof payload.error === 'string'
              ? payload.error
              : 'No se pudo cargar la wallet interna.'
          throw new Error(message)
        }

        return payload as { data: WalletSummaryWire }
      })
      .then((payload) => {
        if (isActive) {
          setWallet(deserializeWalletSummary(payload.data))
        }
      })
      .catch((error) => {
        if (isActive) {
          setWallet(null)
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'No se pudo cargar la wallet interna.'
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

  const canOpenLeads = canAccessDashboardPath(user.role, '/dashboard/leads')

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-balance">Creditos</h1>
          {authMode === 'supabase' ? <Badge variant="outline">Wallet interna</Badge> : null}
        </div>
        <p className="text-muted-foreground max-w-3xl">
          Saldo interno disponible para solicitar prototipos. No equivale a liquidaciones mensuales ni a pagos reales.
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
                  La wallet interna depende de saldo y ledger persistidos. En mock no existe esta fuente real.
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
                  <Wallet className="size-5" />
                </EmptyMedia>
                <EmptyTitle>No se pudo cargar la wallet</EmptyTitle>
                <EmptyDescription>{errorMessage}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-primary text-primary-foreground">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-primary-foreground/80">
                  Saldo disponible
                </CardTitle>
                <Wallet className="size-4 text-primary-foreground/80" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{wallet?.totalAvailable ?? 0}</div>
                <p className="text-xs text-primary-foreground/70 mt-1">Creditos listos para usar</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Creditos gratis</CardTitle>
                <Sparkles className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{wallet?.freeAvailable ?? 0}</div>
                <p className="text-xs text-muted-foreground">Se consumen primero en solicitudes de prototipo</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Saldo propio</CardTitle>
                <Coins className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{wallet?.earnedAvailable ?? 0}</div>
                <p className="text-xs text-muted-foreground">Saldo interno reflejado dentro de Noon</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Costo por prototipo</CardTitle>
                <History className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {wallet?.prototypeRequestCost ?? 'No configurado'}
                </div>
                <p className="text-xs text-muted-foreground">Costo actual por solicitud comercial</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Ledger de creditos</CardTitle>
              <CardDescription>
                Historial durable del saldo interno. Los pagos reales y liquidaciones mensuales siguen fuera de este modulo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!wallet || wallet.entries.length === 0 ? (
                <Empty className="border-0 px-0 py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <History className="size-5" />
                    </EmptyMedia>
                    <EmptyTitle>Aun no hay movimientos</EmptyTitle>
                    <EmptyDescription>
                      Los consumos y ajustes de creditos apareceran aqui cuando existan movimientos reales.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="space-y-3">
                  {wallet.entries.map((entry) => (
                    <div key={entry.id} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{entryTypeLabel(entry)}</Badge>
                            <Badge variant="secondary">{bucketLabel(entry.bucket)}</Badge>
                            {entry.leadId && canOpenLeads ? (
                              <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-xs">
                                <Link href={buildLeadDetailHref(entry.leadId)}>Abrir lead</Link>
                              </Button>
                            ) : null}
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-medium">
                              {entry.metadata?.leadName && typeof entry.metadata.leadName === 'string'
                                ? entry.metadata.leadName
                                : entryTypeLabel(entry)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {entry.actorName} · {formatEntryDate(entry.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-lg font-semibold ${entry.deltaCredits < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {deltaLabel(entry.deltaCredits)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {entry.bucket === 'free' ? 'Desde creditos gratis' : 'Desde saldo propio'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
