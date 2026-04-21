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
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 pb-6 border-b">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Hola, {user.name.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            <Badge variant="outline" className="mr-2 font-normal">{getRoleLabel(user.role)}</Badge>
            {dashboardKpiCopy.headerSummaryLabel}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:min-w-[280px]">
          <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
            <p className="stat-label">Balance</p>
            <p className="text-2xl font-semibold text-primary mt-1 tabular-nums">{personalStats.balanceValueLabel}</p>
            <p className="text-xs text-muted-foreground mt-1">{personalStats.balanceDescription}</p>
          </div>
          <div className="rounded-xl border bg-card px-5 py-4 shadow-sm">
            <p className="stat-label">Puntos</p>
            <p className="text-2xl font-semibold text-accent mt-1 tabular-nums">{personalStats.pointsValueLabel}</p>
            <p className="text-xs text-muted-foreground mt-1">{personalStats.pointsDescription}</p>
          </div>
        </div>
      </div>

      {/* Sales Stats - Only for sales roles */}
      {canAccessSales(user.role) && (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold">Ventas</h2>
            <p className="text-sm text-muted-foreground">Resumen comercial de tu pipeline actual.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Leads abiertos</p>
                <p className="stat-number mt-2">{sales.openLeads}</p>
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                  {authMode === 'mock' && <ArrowUpRight className="size-3 text-success" />}
                  <span className={authMode === 'mock' ? 'text-success' : undefined}>
                    {dashboardKpiCopy.salesOpenLeadsNote}
                  </span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Valor del pipeline</p>
                <p className="stat-number mt-2">${sales.pipelineValue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1.5">Oportunidades abiertas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Deals cerrados</p>
                <p className="stat-number mt-2">{sales.wonLeads}</p>
                <p className="text-xs text-muted-foreground mt-1.5">{dashboardKpiCopy.salesWonLeadsNote}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">{dashboardKpiCopy.salesRevenueTitle}</p>
                <p className="stat-number mt-2">${sales.totalRevenue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
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
          <Card>
            <CardContent className="pt-6 pb-5 px-6">
              <p className="stat-label">Tasa de conversión</p>
              <p className="stat-number mt-2">
                {conversionRate !== null ? `${conversionRate}%` : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">
                {conversionRate !== null
                  ? `${sales.wonLeads} ganados de ${leads.filter((l) => l.status === 'won' || l.status === 'lost').length} cerrados`
                  : 'Sin deals cerrados aún'}
              </p>
            </CardContent>
          </Card>

          {/* Overdue follow-ups */}
          <Card>
            <CardContent className="pt-6 pb-5 px-6">
              <p className="stat-label">Seguimientos vencidos</p>
              <p className={`stat-number mt-2 ${overdueFollowUps.length > 0 ? 'text-destructive' : ''}`}>
                {overdueFollowUps.length}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">
                {overdueFollowUps.length === 0
                  ? 'Todo al día'
                  : `${overdueFollowUps.length} lead${overdueFollowUps.length > 1 ? 's' : ''} sin seguimiento`}
              </p>
              {overdueFollowUps.length > 0 && (
                <Link href="/dashboard/leads" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Ver leads <ArrowUpRight className="size-3" />
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Pipeline pie chart */}
          <Card>
            <CardContent className="pt-6 pb-5 px-6">
              <p className="stat-label mb-4">Pipeline por estado</p>
              <div className="flex items-center gap-4">
                {mounted && (
                  <ResponsiveContainer width={80} height={80}>
                    <PieChart>
                      <Pie data={leadsByStatus} dataKey="value" cx="50%" cy="50%" outerRadius={38} strokeWidth={1}>
                        {leadsByStatus.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value, name) => [value, name]} contentStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                <div className="flex flex-col gap-1.5">
                  {leadsByStatus.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                      <span className="size-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span className="font-semibold ml-auto pl-2">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delivery Stats */}
      {canAccessDelivery(user.role) && (
        <div className="space-y-5">
          <div>
            <h2 className="text-base font-semibold">Delivery</h2>
            <p className="text-sm text-muted-foreground">Estado operativo de proyectos y tareas activas.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Proyectos activos</p>
                <p className="stat-number mt-2">{delivery.activeProjects}</p>
                <p className="text-xs text-muted-foreground mt-1.5">{delivery.projectsInReview} en revisión</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Tareas pendientes</p>
                <p className="stat-number mt-2">{delivery.pendingTasks}</p>
                <p className="text-xs text-muted-foreground mt-1.5">{delivery.inProgressTasks} en progreso</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">En revisión</p>
                <p className="stat-number mt-2">{delivery.reviewTasks}</p>
                <p className="text-xs text-muted-foreground mt-1.5">Esperando aprobación</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 pb-5 px-6">
                <p className="stat-label">Completados</p>
                <p className="stat-number mt-2">{delivery.completedProjects}</p>
                <p className="text-xs text-muted-foreground mt-1.5">{dashboardKpiCopy.deliveryCompletedProjectsNote}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader className="pb-0 px-6 pt-5">
          <CardTitle className="text-base font-semibold">Acciones rápidas</CardTitle>
          <CardDescription>Accede rápidamente a las funciones más usadas</CardDescription>
        </CardHeader>
        <CardContent className="p-0 mt-2">
          <div className="divide-y">
            {canAccessSales(user.role) && (
              <>
                <Link href="/dashboard/leads" className="flex items-center gap-3 px-6 py-4 hover:bg-muted/30 transition-colors">
                  <Users className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Ver leads</p>
                    <p className="text-xs text-muted-foreground">{sales.openLeads} leads activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground shrink-0" />
                </Link>
                <Link href="/dashboard/pipeline" className="flex items-center gap-3 px-6 py-4 hover:bg-muted/30 transition-colors">
                  <TrendingUp className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Pipeline de ventas</p>
                    <p className="text-xs text-muted-foreground">Vista kanban</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground shrink-0" />
                </Link>
              </>
            )}
            {canAccessDelivery(user.role) && (
              <>
                <Link href="/dashboard/projects" className="flex items-center gap-3 px-6 py-4 hover:bg-muted/30 transition-colors">
                  <FolderKanban className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Proyectos</p>
                    <p className="text-xs text-muted-foreground">{delivery.activeProjects} activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground shrink-0" />
                </Link>
                <Link href="/dashboard/tasks" className="flex items-center gap-3 px-6 py-4 hover:bg-muted/30 transition-colors">
                  <CheckCircle2 className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Mis tareas</p>
                    <p className="text-xs text-muted-foreground">{delivery.actionableTasks} pendientes</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground shrink-0" />
                </Link>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
