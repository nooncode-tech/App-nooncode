'use client'

import { useMemo, useState, useEffect } from 'react'
import { useAuth, canAccessSales, canAccessDelivery, getRoleLabel } from '@/lib/auth-context'
import { useData } from '@/lib/data-context'
import {
  selectDashboardKpiCopy,
  selectDashboardSummary,
  selectPersonalStatsAvailability,
} from '@/lib/dashboard-selectors'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Users,
  DollarSign,
  TrendingUp,
  FolderKanban,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowUpRight,
  Target,
  Bell,
} from 'lucide-react'
import Link from 'next/link'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

export default function DashboardPage() {
  const { authMode, user } = useAuth()
  const { leads, projectBoardProjects, taskBoardTasks } = useData()

  if (!user) return null

  const summary = useMemo(
    () => selectDashboardSummary(leads, projectBoardProjects, taskBoardTasks),
    [leads, projectBoardProjects, taskBoardTasks]
  )

  const { sales, delivery } = summary
  const personalStats = selectPersonalStatsAvailability(authMode, user)
  const dashboardKpiCopy = selectDashboardKpiCopy(authMode)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const conversionRate = useMemo(() => {
    const closed = leads.filter((l) => l.status === 'won' || l.status === 'lost').length
    if (closed === 0) return null
    return Math.round((leads.filter((l) => l.status === 'won').length / closed) * 100)
  }, [leads])

  const overdueFollowUps = useMemo(() => {
    if (!mounted) return []
    const now = new Date()
    return leads.filter(
      (l) =>
        l.nextFollowUpAt &&
        new Date(l.nextFollowUpAt) < now &&
        l.status !== 'won' &&
        l.status !== 'lost'
    )
  }, [leads, mounted])

  const leadsByStatus = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const l of leads) {
      counts[l.status] = (counts[l.status] ?? 0) + 1
    }
    const labels: Record<string, string> = {
      new: 'Nuevo',
      contacted: 'Contactado',
      qualified: 'Calificado',
      proposal: 'Propuesta',
      negotiation: 'Negociación',
      won: 'Ganado',
      lost: 'Perdido',
    }
    const colors: Record<string, string> = {
      new: '#6366f1',
      contacted: '#3b82f6',
      qualified: '#06b6d4',
      proposal: '#f59e0b',
      negotiation: '#f97316',
      won: '#22c55e',
      lost: '#ef4444',
    }
    return Object.entries(counts).map(([status, value]) => ({
      name: labels[status] ?? status,
      value,
      color: colors[status] ?? '#94a3b8',
    }))
  }, [leads])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-balance">Bienvenido, {user.name.split(' ')[0]}</h1>
          <p className="text-muted-foreground max-w-2xl">
            <Badge variant="outline" className="mr-2">{getRoleLabel(user.role)}</Badge>
            {dashboardKpiCopy.headerSummaryLabel}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:min-w-[260px]">
          <div className="rounded-xl border bg-card px-4 py-3 text-right shadow-sm">
            <p className="text-sm text-muted-foreground">Tu balance</p>
            <p className="text-xl font-bold text-primary">{personalStats.balanceValueLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">{personalStats.balanceDescription}</p>
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 text-right shadow-sm">
            <p className="text-sm text-muted-foreground">Puntos</p>
            <p className="text-xl font-bold text-accent">{personalStats.pointsValueLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">{personalStats.pointsDescription}</p>
          </div>
        </div>
      </div>

      {/* Sales Stats - Only for sales roles */}
      {canAccessSales(user.role) && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Ventas</h2>
            <p className="text-sm text-muted-foreground">Resumen comercial derivado de tu pipeline actual.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="gap-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Leads abiertos</CardTitle>
                <Users className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{sales.openLeads}</div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {authMode === 'mock' && <ArrowUpRight className="size-3 text-success" />}
                  <span className={authMode === 'mock' ? 'text-success' : undefined}>
                    {dashboardKpiCopy.salesOpenLeadsNote}
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Valor del pipeline</CardTitle>
                <TrendingUp className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${sales.pipelineValue.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">Oportunidades abiertas</p>
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Deals cerrados</CardTitle>
                <CheckCircle2 className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{sales.wonLeads}</div>
                <p className="text-xs text-muted-foreground">{dashboardKpiCopy.salesWonLeadsNote}</p>
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{dashboardKpiCopy.salesRevenueTitle}</CardTitle>
                <DollarSign className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${sales.totalRevenue.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {authMode === 'mock' && <ArrowUpRight className="size-3 text-success" />}
                  <span className={authMode === 'mock' ? 'text-success' : undefined}>
                    {dashboardKpiCopy.salesRevenueNote}
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Conversion rate + overdue follow-ups + pipeline chart */}
      {canAccessSales(user.role) && leads.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {/* Conversion rate */}
          <Card className="gap-4">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tasa de conversión</CardTitle>
              <Target className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {conversionRate !== null ? `${conversionRate}%` : '—'}
              </div>
              <p className="text-xs text-muted-foreground">
                {conversionRate !== null
                  ? `${sales.wonLeads} ganados de ${leads.filter((l) => l.status === 'won' || l.status === 'lost').length} cerrados`
                  : 'Sin deals cerrados aún'}
              </p>
            </CardContent>
          </Card>

          {/* Overdue follow-ups */}
          <Card className="gap-4">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Seguimientos vencidos</CardTitle>
              <Bell className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{overdueFollowUps.length}</div>
              <p className="text-xs text-muted-foreground">
                {overdueFollowUps.length === 0
                  ? 'Todo al día'
                  : `${overdueFollowUps.length} lead${overdueFollowUps.length > 1 ? 's' : ''} sin seguimiento`}
              </p>
              {overdueFollowUps.length > 0 && (
                <Link
                  href="/dashboard/leads"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Ver leads <ArrowUpRight className="size-3" />
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Pipeline pie chart */}
          <Card className="gap-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pipeline por estado</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-4 pb-4">
              {mounted && (
                <ResponsiveContainer width={80} height={80}>
                  <PieChart>
                    <Pie data={leadsByStatus} dataKey="value" cx="50%" cy="50%" outerRadius={38} strokeWidth={1}>
                      {leadsByStatus.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [value, name]}
                      contentStyle={{ fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div className="flex flex-col gap-1">
                {leadsByStatus.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                    <span className="size-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
                    <span className="text-muted-foreground">{entry.name}</span>
                    <span className="font-medium ml-auto pl-2">{entry.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delivery Stats - Only for delivery roles */}
      {canAccessDelivery(user.role) && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Delivery</h2>
            <p className="text-sm text-muted-foreground">Estado operativo alineado con proyectos y tareas activas.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="gap-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Proyectos activos</CardTitle>
                <FolderKanban className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{delivery.activeProjects}</div>
                <p className="text-xs text-muted-foreground">{delivery.projectsInReview} en revision</p>
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Tareas pendientes</CardTitle>
                <Clock className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{delivery.pendingTasks}</div>
                <p className="text-xs text-muted-foreground">{delivery.inProgressTasks} en progreso</p>
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">En revision</CardTitle>
                <AlertTriangle className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{delivery.reviewTasks}</div>
                <p className="text-xs text-muted-foreground">Esperando aprobacion</p>
              </CardContent>
            </Card>
            <Card className="gap-4">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completados</CardTitle>
                <CheckCircle2 className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{delivery.completedProjects}</div>
                <p className="text-xs text-muted-foreground">{dashboardKpiCopy.deliveryCompletedProjectsNote}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle>Acciones rapidas</CardTitle>
          <CardDescription>Accede rapidamente a las funciones mas usadas</CardDescription>
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <div className="divide-y">
            {canAccessSales(user.role) && (
              <>
                <Link
                  href="/dashboard/leads"
                  className="flex items-center gap-3 px-6 py-3.5 hover:bg-muted/40 transition-colors"
                >
                  <Users className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Ver leads</p>
                    <p className="text-xs text-muted-foreground">{sales.openLeads} leads activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
                <Link
                  href="/dashboard/pipeline"
                  className="flex items-center gap-3 px-6 py-3.5 hover:bg-muted/40 transition-colors"
                >
                  <TrendingUp className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Pipeline de ventas</p>
                    <p className="text-xs text-muted-foreground">Vista kanban</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
              </>
            )}
            {canAccessDelivery(user.role) && (
              <>
                <Link
                  href="/dashboard/projects"
                  className="flex items-center gap-3 px-6 py-3.5 hover:bg-muted/40 transition-colors"
                >
                  <FolderKanban className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Proyectos</p>
                    <p className="text-xs text-muted-foreground">{delivery.activeProjects} activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
                <Link
                  href="/dashboard/tasks"
                  className="flex items-center gap-3 px-6 py-3.5 hover:bg-muted/40 transition-colors"
                >
                  <CheckCircle2 className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Mis tareas</p>
                    <p className="text-xs text-muted-foreground">{delivery.actionableTasks} pendientes</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
