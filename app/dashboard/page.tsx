'use client'

import { useMemo, useState, useEffect } from 'react'
import { useAuth, canAccessSales, canAccessDelivery, getRoleLabel } from '@/lib/auth-context'
import { useData } from '@/lib/data-context'
import {
  selectDashboardKpiCopy,
  selectDashboardSummary,
  selectPersonalStatsAvailability,
} from '@/lib/dashboard-selectors'
import { Badge } from '@/components/ui/badge'
import {
  Users,
  TrendingUp,
  FolderKanban,
  CheckCircle2,
  ArrowUpRight,
  Wallet,
  Zap,
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
      new: '#818cf8',
      contacted: '#60a5fa',
      qualified: '#22d3ee',
      proposal: '#fbbf24',
      negotiation: '#fb923c',
      won: '#4ade80',
      lost: '#f87171',
    }
    return Object.entries(counts).map(([status, value]) => ({
      name: labels[status] ?? status,
      value,
      color: colors[status] ?? '#94a3b8',
    }))
  }, [leads])

  const lbl = 'text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground'
  const num = 'text-[2.75rem] font-bold tracking-tight tabular-nums leading-none mt-3'
  const note = 'text-xs text-muted-foreground mt-2'

  const dateStr = mounted
    ? new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

  return (
    <div>
      {/* ── Dark Hero Header ── */}
      <div className="bg-[#0c0c0e] px-8 py-10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30 mb-3">
          {dateStr}
        </p>
        <h1 className="text-5xl font-bold tracking-tight text-white leading-tight">
          Hola, {user.name.split(' ')[0]}
        </h1>
        <p className="mt-2 text-sm text-white/40 flex items-center gap-2">
          <Badge variant="secondary" className="font-normal text-xs bg-white/10 text-white/70 border-0 hover:bg-white/10">
            {getRoleLabel(user.role)}
          </Badge>
          {dashboardKpiCopy.headerSummaryLabel}
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.08] rounded-xl px-5 py-3">
            <Wallet className="size-4 text-white/30 shrink-0" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">Balance</p>
              <p className="text-base font-bold text-white tabular-nums mt-0.5">{personalStats.balanceValueLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-white/[0.04] border border-white/[0.08] rounded-xl px-5 py-3">
            <Zap className="size-4 text-white/30 shrink-0" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/30">Puntos</p>
              <p className="text-base font-bold text-white tabular-nums mt-0.5">{personalStats.pointsValueLabel}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 py-8 space-y-10">

        {/* ── Sales KPIs ── */}
        {canAccessSales(user.role) && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Ventas</h2>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Pipeline actual</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {/* Hero card — filled */}
              <div className="rounded-2xl bg-primary px-6 pt-5 pb-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">Leads abiertos</p>
                <p className="text-[2.75rem] font-bold tracking-tight tabular-nums leading-none mt-3 text-white">{sales.openLeads}</p>
                <p className="text-xs text-white/40 mt-2 flex items-center gap-1">
                  {authMode === 'mock' && <ArrowUpRight className="size-3 text-white/60" />}
                  <span>{dashboardKpiCopy.salesOpenLeadsNote}</span>
                </p>
              </div>
              <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <p className={lbl}>Valor del pipeline</p>
                <p className={num}>${sales.pipelineValue.toLocaleString()}</p>
                <p className={note}>Oportunidades abiertas</p>
              </div>
              <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <p className={lbl}>Deals cerrados</p>
                <p className={num}>{sales.wonLeads}</p>
                <p className={note}>{dashboardKpiCopy.salesWonLeadsNote}</p>
              </div>
              <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <p className={lbl}>{dashboardKpiCopy.salesRevenueTitle}</p>
                <p className={num}>${sales.totalRevenue.toLocaleString()}</p>
                <p className={`${note} flex items-center gap-1`}>
                  {authMode === 'mock' && <ArrowUpRight className="size-3 text-emerald-500" />}
                  <span className={authMode === 'mock' ? 'text-emerald-600' : undefined}>{dashboardKpiCopy.salesRevenueNote}</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Conversion + Followups + Chart ── */}
        {canAccessSales(user.role) && leads.length > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <p className={lbl}>Tasa de conversión</p>
              <p className={num}>{conversionRate !== null ? `${conversionRate}%` : '—'}</p>
              <p className={note}>
                {conversionRate !== null
                  ? `${sales.wonLeads} ganados de ${leads.filter((l) => l.status === 'won' || l.status === 'lost').length} cerrados`
                  : 'Sin deals cerrados aún'}
              </p>
            </div>

            <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <p className={lbl}>Seguimientos vencidos</p>
              <p className={`${num} ${overdueFollowUps.length > 0 ? 'text-destructive' : ''}`}>
                {overdueFollowUps.length}
              </p>
              <p className={note}>
                {overdueFollowUps.length === 0
                  ? 'Todo al día'
                  : `${overdueFollowUps.length} lead${overdueFollowUps.length > 1 ? 's' : ''} sin seguimiento`}
              </p>
              {overdueFollowUps.length > 0 && (
                <Link href="/dashboard/leads" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Ver leads <ArrowUpRight className="size-3" />
                </Link>
              )}
            </div>

            <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <p className={`${lbl} mb-4`}>Pipeline por estado</p>
              <div className="flex items-center gap-4">
                {mounted && (
                  <ResponsiveContainer width={72} height={72}>
                    <PieChart>
                      <Pie data={leadsByStatus} dataKey="value" cx="50%" cy="50%" outerRadius={34} innerRadius={16} strokeWidth={0}>
                        {leadsByStatus.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(value, name) => [value, name]} contentStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                <div className="flex flex-col gap-1.5 flex-1">
                  {leadsByStatus.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                      <span className="size-1.5 rounded-full shrink-0" style={{ background: entry.color }} />
                      <span className="text-muted-foreground truncate">{entry.name}</span>
                      <span className="font-semibold ml-auto tabular-nums">{entry.value}</span>
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
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Delivery</h2>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">Proyectos y tareas activas</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {/* Hero card — filled */}
              <div className="rounded-2xl bg-[oklch(0.50_0.26_264)] px-6 pt-5 pb-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">Proyectos activos</p>
                <p className="text-[2.75rem] font-bold tracking-tight tabular-nums leading-none mt-3 text-white">{delivery.activeProjects}</p>
                <p className="text-xs text-white/40 mt-2">{delivery.projectsInReview} en revisión</p>
              </div>
              <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <p className={lbl}>Tareas pendientes</p>
                <p className={num}>{delivery.pendingTasks}</p>
                <p className={note}>{delivery.inProgressTasks} en progreso</p>
              </div>
              <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <p className={lbl}>En revisión</p>
                <p className={num}>{delivery.reviewTasks}</p>
                <p className={note}>Esperando aprobación</p>
              </div>
              <div className="rounded-2xl border bg-card px-6 pt-5 pb-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                <p className={lbl}>Completados</p>
                <p className={num}>{delivery.completedProjects}</p>
                <p className={note}>{dashboardKpiCopy.deliveryCompletedProjectsNote}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Quick Actions ── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-4">Acciones rápidas</h2>
          <div className="rounded-2xl border bg-card shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden divide-y">
            {canAccessSales(user.role) && (
              <>
                <Link href="/dashboard/leads" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors group">
                  <div className="size-9 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                    <Users className="size-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Ver leads</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{sales.openLeads} leads activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                </Link>
                <Link href="/dashboard/pipeline" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors group">
                  <div className="size-9 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                    <TrendingUp className="size-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Pipeline de ventas</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Vista kanban</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                </Link>
              </>
            )}
            {canAccessDelivery(user.role) && (
              <>
                <Link href="/dashboard/projects" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors group">
                  <div className="size-9 rounded-xl bg-accent/8 flex items-center justify-center shrink-0">
                    <FolderKanban className="size-4 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Proyectos</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{delivery.activeProjects} activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                </Link>
                <Link href="/dashboard/tasks" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors group">
                  <div className="size-9 rounded-xl bg-accent/8 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="size-4 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Mis tareas</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{delivery.actionableTasks} pendientes</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                </Link>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
