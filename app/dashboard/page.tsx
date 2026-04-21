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

  const kpiLabel = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'
  const kpiNum   = 'text-4xl font-bold tracking-tight tabular-nums mt-2'
  const kpiNote  = 'text-xs text-muted-foreground mt-1.5'

  return (
    <div className="p-6 md:p-8 space-y-10">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-4xl font-bold tracking-tight">Hola, {user.name.split(' ')[0]}</h1>
          <p className="text-sm text-muted-foreground mt-1.5 flex items-center gap-2">
            <Badge variant="secondary" className="font-normal text-xs">{getRoleLabel(user.role)}</Badge>
            {dashboardKpiCopy.headerSummaryLabel}
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl bg-primary/5 border border-primary/20 px-5 py-4 min-w-[140px]">
            <p className={kpiLabel}>Balance</p>
            <p className="text-2xl font-bold text-primary mt-1.5 tabular-nums">{personalStats.balanceValueLabel}</p>
            <p className="text-xs text-muted-foreground mt-1">{personalStats.balanceDescription}</p>
          </div>
          <div className="rounded-xl bg-accent/5 border border-accent/20 px-5 py-4 min-w-[140px]">
            <p className={kpiLabel}>Puntos</p>
            <p className="text-2xl font-bold text-accent mt-1.5 tabular-nums">{personalStats.pointsValueLabel}</p>
            <p className="text-xs text-muted-foreground mt-1">{personalStats.pointsDescription}</p>
          </div>
        </div>
      </div>

      {/* ── Sales KPIs ── */}
      {canAccessSales(user.role) && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-1 rounded-full bg-primary" />
            <div>
              <h2 className="text-sm font-semibold">Ventas</h2>
              <p className="text-xs text-muted-foreground">Pipeline actual</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-l-4 border-l-primary bg-card px-6 pt-5 pb-6 shadow-sm">
              <p className={kpiLabel}>Leads abiertos</p>
              <p className={kpiNum}>{sales.openLeads}</p>
              <p className={`${kpiNote} flex items-center gap-1`}>
                {authMode === 'mock' && <ArrowUpRight className="size-3 text-success" />}
                <span className={authMode === 'mock' ? 'text-success' : undefined}>{dashboardKpiCopy.salesOpenLeadsNote}</span>
              </p>
            </div>
            <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
              <p className={kpiLabel}>Valor del pipeline</p>
              <p className={kpiNum}>${sales.pipelineValue.toLocaleString()}</p>
              <p className={kpiNote}>Oportunidades abiertas</p>
            </div>
            <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
              <p className={kpiLabel}>Deals cerrados</p>
              <p className={kpiNum}>{sales.wonLeads}</p>
              <p className={kpiNote}>{dashboardKpiCopy.salesWonLeadsNote}</p>
            </div>
            <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
              <p className={kpiLabel}>{dashboardKpiCopy.salesRevenueTitle}</p>
              <p className={kpiNum}>${sales.totalRevenue.toLocaleString()}</p>
              <p className={`${kpiNote} flex items-center gap-1`}>
                {authMode === 'mock' && <ArrowUpRight className="size-3 text-success" />}
                <span className={authMode === 'mock' ? 'text-success' : undefined}>{dashboardKpiCopy.salesRevenueNote}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Conversion + Followups + Chart ── */}
      {canAccessSales(user.role) && leads.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
            <p className={kpiLabel}>Tasa de conversión</p>
            <p className={kpiNum}>{conversionRate !== null ? `${conversionRate}%` : '—'}</p>
            <p className={kpiNote}>
              {conversionRate !== null
                ? `${sales.wonLeads} ganados de ${leads.filter((l) => l.status === 'won' || l.status === 'lost').length} cerrados`
                : 'Sin deals cerrados aún'}
            </p>
          </div>

          <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
            <p className={kpiLabel}>Seguimientos vencidos</p>
            <p className={`${kpiNum} ${overdueFollowUps.length > 0 ? 'text-destructive' : ''}`}>
              {overdueFollowUps.length}
            </p>
            <p className={kpiNote}>
              {overdueFollowUps.length === 0 ? 'Todo al día' : `${overdueFollowUps.length} lead${overdueFollowUps.length > 1 ? 's' : ''} sin seguimiento`}
            </p>
            {overdueFollowUps.length > 0 && (
              <Link href="/dashboard/leads" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                Ver leads <ArrowUpRight className="size-3" />
              </Link>
            )}
          </div>

          <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
            <p className={`${kpiLabel} mb-4`}>Pipeline por estado</p>
            <div className="flex items-center gap-4">
              {mounted && (
                <ResponsiveContainer width={80} height={80}>
                  <PieChart>
                    <Pie data={leadsByStatus} dataKey="value" cx="50%" cy="50%" outerRadius={38} strokeWidth={0}>
                      {leadsByStatus.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(value, name) => [value, name]} contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div className="flex flex-col gap-1.5 flex-1">
                {leadsByStatus.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                    <span className="size-2 rounded-full shrink-0" style={{ background: entry.color }} />
                    <span className="text-muted-foreground truncate">{entry.name}</span>
                    <span className="font-bold ml-auto">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delivery KPIs ── */}
      {canAccessDelivery(user.role) && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-1 rounded-full bg-accent" />
            <div>
              <h2 className="text-sm font-semibold">Delivery</h2>
              <p className="text-xs text-muted-foreground">Proyectos y tareas activas</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-l-4 border-l-accent bg-card px-6 pt-5 pb-6 shadow-sm">
              <p className={kpiLabel}>Proyectos activos</p>
              <p className={kpiNum}>{delivery.activeProjects}</p>
              <p className={kpiNote}>{delivery.projectsInReview} en revisión</p>
            </div>
            <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
              <p className={kpiLabel}>Tareas pendientes</p>
              <p className={kpiNum}>{delivery.pendingTasks}</p>
              <p className={kpiNote}>{delivery.inProgressTasks} en progreso</p>
            </div>
            <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
              <p className={kpiLabel}>En revisión</p>
              <p className={kpiNum}>{delivery.reviewTasks}</p>
              <p className={kpiNote}>Esperando aprobación</p>
            </div>
            <div className="rounded-xl border bg-card px-6 pt-5 pb-6 shadow-sm">
              <p className={kpiLabel}>Completados</p>
              <p className={kpiNum}>{delivery.completedProjects}</p>
              <p className={kpiNote}>{dashboardKpiCopy.deliveryCompletedProjectsNote}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Actions ── */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-sm font-semibold">Acciones rápidas</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Accede directamente a las funciones más usadas</p>
        </div>
        <div className="divide-y">
          {canAccessSales(user.role) && (
            <>
              <Link href="/dashboard/leads" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors group">
                <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Users className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Ver leads</p>
                  <p className="text-xs text-muted-foreground">{sales.openLeads} leads activos</p>
                </div>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </Link>
              <Link href="/dashboard/pipeline" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors group">
                <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Pipeline de ventas</p>
                  <p className="text-xs text-muted-foreground">Vista kanban</p>
                </div>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </Link>
            </>
          )}
          {canAccessDelivery(user.role) && (
            <>
              <Link href="/dashboard/projects" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors group">
                <div className="size-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  <FolderKanban className="size-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Proyectos</p>
                  <p className="text-xs text-muted-foreground">{delivery.activeProjects} activos</p>
                </div>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </Link>
              <Link href="/dashboard/tasks" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors group">
                <div className="size-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="size-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Mis tareas</p>
                  <p className="text-xs text-muted-foreground">{delivery.actionableTasks} pendientes</p>
                </div>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
              </Link>
            </>
          )}
        </div>
      </div>

    </div>
  )
}
