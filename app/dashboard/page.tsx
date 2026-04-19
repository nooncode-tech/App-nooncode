'use client'

import { useMemo } from 'react'
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
} from 'lucide-react'
import Link from 'next/link'

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
      <div>
        <Card>
          <CardHeader>
            <CardTitle>Acciones rapidas</CardTitle>
            <CardDescription>Accede rapidamente a las funciones mas usadas</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {canAccessSales(user.role) && (
              <>
                <Link
                  href="/dashboard/leads"
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="size-10 rounded-lg bg-chart-1/10 flex items-center justify-center">
                    <Users className="size-5 text-chart-1" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Ver leads</p>
                    <p className="text-sm text-muted-foreground">{sales.openLeads} leads activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
                <Link
                  href="/dashboard/pipeline"
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="size-10 rounded-lg bg-chart-2/10 flex items-center justify-center">
                    <TrendingUp className="size-5 text-chart-2" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Pipeline de ventas</p>
                    <p className="text-sm text-muted-foreground">Vista kanban</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
              </>
            )}
            {canAccessDelivery(user.role) && (
              <>
                <Link
                  href="/dashboard/projects"
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="size-10 rounded-lg bg-chart-3/10 flex items-center justify-center">
                    <FolderKanban className="size-5 text-chart-3" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Proyectos</p>
                    <p className="text-sm text-muted-foreground">{delivery.activeProjects} activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
                <Link
                  href="/dashboard/tasks"
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="size-10 rounded-lg bg-chart-4/10 flex items-center justify-center">
                    <CheckCircle2 className="size-5 text-chart-4" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Mis tareas</p>
                    <p className="text-sm text-muted-foreground">{delivery.actionableTasks} pendientes</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
