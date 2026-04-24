'use client'

import { useMemo } from 'react'
import { useAuth, canViewAllStats, canAccessDelivery, canAccessSales } from '@/lib/auth-context'
import { useData } from '@/lib/data-context'
import {
  reportsChartColors,
  selectReportsRevenueKpiCopy,
  selectReportsViewModel,
} from '@/lib/dashboard-selectors'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip as ChartTooltip } from 'recharts'
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { BarChart3, DollarSign, Target, Award, Clock } from 'lucide-react'

function ReportsChartEmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Empty className="h-full border-0 p-0">
      <EmptyHeader className="my-auto">
        <EmptyMedia variant="icon">
          <BarChart3 className="size-5" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export default function ReportsPage() {
  const { authMode, user } = useAuth()
  const {
    leads,
    projectBoardProjects,
    persistedProjects,
    taskBoardTasks,
    persistedTasks,
  } = useData()

  const canViewAll = user ? canViewAllStats(user.role) : false
  const deliveryProjects =
    authMode === 'supabase'
      ? user?.role === 'developer'
        ? projectBoardProjects
        : persistedProjects
      : projectBoardProjects
  const deliveryTasks =
    authMode === 'supabase'
      ? user?.role === 'developer'
        ? taskBoardTasks
        : persistedTasks
      : taskBoardTasks

  const {
    pipelineData,
    monthlyData,
    sourceData,
    projectStatusData,
    hasRecentLeadTrend,
    stats,
  } = useMemo(
    () => {
      const visibleLeads =
        canViewAll || !user
          ? leads
          : canAccessSales(user.role)
            ? leads.filter((lead) => lead.assignedTo === user.id)
            : []

      const visibleProjects =
        canViewAll || !user
          ? deliveryProjects
          : canAccessDelivery(user.role)
            ? deliveryProjects
            : []

      const visibleTasks =
        canViewAll || !user
          ? deliveryTasks
          : canAccessDelivery(user.role)
            ? deliveryTasks
            : []

      if (canViewAll || !user) {
        return selectReportsViewModel(visibleLeads, visibleProjects, visibleTasks)
      }

      return selectReportsViewModel(visibleLeads, visibleProjects, visibleTasks)
    },
    [canViewAll, user, leads, deliveryProjects, deliveryTasks]
  )

  if (!user) return null

  const hasPipelineData = pipelineData.some((entry) => entry.count > 0)
  const hasSourceData = sourceData.length > 0
  const hasProjectStatusData = projectStatusData.length > 0
  const revenueKpiCopy = selectReportsRevenueKpiCopy(authMode)

  return (
    <div className="app-page">
      {/* Header */}
      <div className="app-page-header">
        <div>
        <h1 className="app-page-title">Reportes y analiticas</h1>
        <p className="app-page-subtitle">
          {canViewAll ? 'Vision general del rendimiento del equipo' : 'Tu rendimiento personal'}
        </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="metric-grid">
        <div className="metric-card-primary">
          <p className="metric-label-inverse">Tasa de conversion</p>
          <p className="metric-value-inverse">{stats.conversionRate}%</p>
          <p className="metric-note-inverse">{stats.wonLeads} de {stats.totalLeads} leads</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">{revenueKpiCopy.title}</p>
          <p className="metric-value">${stats.totalRevenue.toLocaleString()}</p>
          <p className="metric-note">Promedio ${stats.avgDealSize.toLocaleString()} {revenueKpiCopy.averageLabel}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Score promedio</p>
          <p className="metric-value">{stats.avgScore}</p>
          <p className="metric-note">Calidad de leads</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Proyectos activos</p>
          <p className="metric-value">{stats.activeProjects}</p>
          <p className="metric-note">{stats.completedTasks} tareas completadas</p>
        </div>
      </div>

      {/* Charts */}
      <Tabs defaultValue="sales" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sales">Ventas</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="sources">Fuentes</TabsTrigger>
          <TabsTrigger value="projects">Proyectos</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Leads por mes</CardTitle>
                <CardDescription>Leads visibles creados en los ultimos 6 meses</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  {hasRecentLeadTrend ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" className="text-xs" />
                        <YAxis allowDecimals={false} className="text-xs" />
                        <ChartTooltip />
                        <Legend />
                        <Line type="monotone" dataKey="leads" stroke="#6366f1" name="Leads" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <ReportsChartEmptyState
                      title="Sin actividad reciente"
                      description="No hay leads visibles creados en los ultimos 6 meses para este alcance."
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ventas e ingresos por mes</CardTitle>
                <CardDescription>Serie deshabilitada hasta tener fechas reales de cierre</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ReportsChartEmptyState
                    title="Datos insuficientes"
                    description="Aun no existe un timestamp persistido de cierre para distribuir ventas e ingresos por mes sin inventar datos."
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Embudo de Ventas</CardTitle>
              <CardDescription>Distribucion de leads por etapa del pipeline</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                {hasPipelineData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pipelineData} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis type="category" dataKey="name" className="text-xs" />
                      <ChartTooltip />
                      <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} name="Leads" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ReportsChartEmptyState
                    title="Sin leads para el embudo"
                    description="No hay leads visibles para mostrar distribucion por etapas."
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Fuentes de Leads</CardTitle>
              <CardDescription>Distribucion por canal de adquisicion</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                {hasSourceData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sourceData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        outerRadius={150}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {sourceData.map((entry, index) => (
                          <Cell key={`cell-${entry.name}`} fill={reportsChartColors[index % reportsChartColors.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <ReportsChartEmptyState
                    title="Sin fuentes registradas"
                    description="No hay leads visibles con fuente disponible para construir este grafico."
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projects" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Estado de Proyectos</CardTitle>
              <CardDescription>Distribucion de proyectos por estado</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                {hasProjectStatusData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={projectStatusData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        outerRadius={150}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {projectStatusData.map((entry, index) => (
                          <Cell key={`cell-${entry.name}`} fill={reportsChartColors[index % reportsChartColors.length]} />
                        ))}
                      </Pie>
                      <ChartTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <ReportsChartEmptyState
                    title="Sin proyectos visibles"
                    description="No hay proyectos visibles con base real para mostrar distribucion por estado."
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
