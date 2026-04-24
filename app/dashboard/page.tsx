'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
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
  Search,
  X,
  Plus,
} from 'lucide-react'

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

  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSearchOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

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
      negotiation: 'Negociacion',
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

  const dateStr = mounted
    ? new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

  return (
    <div className="app-page">
      <div className="app-page-header">
        <div>
          <p className="text-sm leading-6 text-muted-foreground">{dateStr}</p>
          <h1 className="app-page-title">Hola, {user.name.split(' ')[0]}</h1>
          <p className="app-page-subtitle">
            <Badge variant="secondary" className="mr-2 align-middle font-medium">
              {getRoleLabel(user.role)}
            </Badge>
            {dashboardKpiCopy.headerSummaryLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {searchOpen ? (
            <div className="flex h-11 w-full min-w-[220px] items-center gap-2.5 rounded-md border border-input bg-background px-4 transition-colors sm:w-[300px]">
              <Search className="size-5 shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Buscar..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
                    setSearchOpen(false)
                  }
                }}
              />
              <button onClick={() => setSearchOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-11 min-w-[170px] items-center justify-start gap-2.5 rounded-md border border-input bg-background px-4 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <Search className="size-5 shrink-0" />
              <span>Buscar</span>
            </button>
          )}

          <Link href="/dashboard/earnings" className="inline-flex h-9 items-center gap-2 rounded-sm bg-muted/40 px-3 text-sm transition-colors hover:bg-muted">
            <Wallet className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold tabular-nums">{personalStats.balanceValueLabel}</span>
          </Link>
          <Link href="/dashboard/rewards" className="inline-flex h-9 items-center gap-2 rounded-sm bg-muted/40 px-3 text-sm transition-colors hover:bg-muted">
            <Zap className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold tabular-nums">{personalStats.pointsValueLabel}</span>
          </Link>
          {canAccessSales(user.role) && (
            <Link href="/dashboard/leads" className="inline-flex h-9 items-center gap-2 rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              <Plus className="size-4" />
              Nuevo lead
            </Link>
          )}
        </div>
      </div>

      {canAccessSales(user.role) && (
        <section className="app-section">
          <div className="app-section-header">
            <div>
              <h2 className="app-section-title">Ventas</h2>
              <p className="app-section-subtitle">Pipeline actual</p>
            </div>
          </div>
          <div className="metric-grid">
            <Link href="/dashboard/leads" className="metric-card-primary block cursor-pointer">
              <p className="metric-label-inverse">Leads abiertos</p>
              <p className="metric-value-inverse">{sales.openLeads}</p>
              <p className="metric-note-inverse flex items-center gap-1">
                {authMode === 'mock' && <ArrowUpRight className="size-3 text-primary-foreground/70" />}
                <span>{dashboardKpiCopy.salesOpenLeadsNote}</span>
              </p>
            </Link>
            <Link href="/dashboard/pipeline" className="metric-card block cursor-pointer">
              <p className="metric-label">Valor del pipeline</p>
              <p className="metric-value">${sales.pipelineValue.toLocaleString()}</p>
              <p className="metric-note">Oportunidades abiertas</p>
            </Link>
            <Link href="/dashboard/leads" className="metric-card block cursor-pointer">
              <p className="metric-label">Deals cerrados</p>
              <p className="metric-value">{sales.wonLeads}</p>
              <p className="metric-note">{dashboardKpiCopy.salesWonLeadsNote}</p>
            </Link>
            <Link href="/dashboard/earnings" className="metric-card block cursor-pointer">
              <p className="metric-label">{dashboardKpiCopy.salesRevenueTitle}</p>
              <p className="metric-value">${sales.totalRevenue.toLocaleString()}</p>
              <p className="metric-note flex items-center gap-1">
                {authMode === 'mock' && <ArrowUpRight className="size-3 text-emerald-500" />}
                <span className={authMode === 'mock' ? 'text-emerald-600' : undefined}>{dashboardKpiCopy.salesRevenueNote}</span>
              </p>
            </Link>
          </div>
        </section>
      )}

      {canAccessSales(user.role) && leads.length > 0 && (
        <section className="grid gap-4 md:grid-cols-3">
          <Link href="/dashboard/leads" className="metric-card block cursor-pointer">
            <p className="metric-label">Tasa de conversion</p>
            <p className="metric-value">{conversionRate !== null ? `${conversionRate}%` : '-'}</p>
            <p className="metric-note">
              {conversionRate !== null
                ? `${sales.wonLeads} ganados de ${leads.filter((l) => l.status === 'won' || l.status === 'lost').length} cerrados`
                : 'Sin deals cerrados aun'}
            </p>
          </Link>

          <Link href="/dashboard/leads" className="metric-card block cursor-pointer">
            <p className="metric-label">Seguimientos vencidos</p>
            <p className={`metric-value ${overdueFollowUps.length > 0 ? 'text-destructive' : ''}`}>
              {overdueFollowUps.length}
            </p>
            <p className="metric-note">
              {overdueFollowUps.length === 0
                ? 'Todo al dia'
                : `${overdueFollowUps.length} lead${overdueFollowUps.length > 1 ? 's' : ''} sin seguimiento`}
            </p>
          </Link>

          <Link href="/dashboard/pipeline" className="metric-card block cursor-pointer">
            <p className="metric-label mb-3">Pipeline por estado</p>
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
              <div className="flex flex-1 flex-col gap-1.5">
                {leadsByStatus.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: entry.color }} />
                    <span className="truncate text-muted-foreground">{entry.name}</span>
                    <span className="ml-auto font-semibold tabular-nums">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Link>
        </section>
      )}

      {canAccessDelivery(user.role) && (
        <section className="app-section">
          <div className="app-section-header">
            <div>
              <h2 className="app-section-title">Delivery</h2>
              <p className="app-section-subtitle">Proyectos y tareas activas</p>
            </div>
          </div>
          <div className="metric-grid">
            <Link href="/dashboard/projects" className="metric-card-primary block cursor-pointer bg-accent hover:bg-accent/90">
              <p className="metric-label-inverse">Proyectos activos</p>
              <p className="metric-value-inverse">{delivery.activeProjects}</p>
              <p className="metric-note-inverse">{delivery.projectsInReview} en revision</p>
            </Link>
            <Link href="/dashboard/tasks" className="metric-card block cursor-pointer">
              <p className="metric-label">Tareas pendientes</p>
              <p className="metric-value">{delivery.pendingTasks}</p>
              <p className="metric-note">{delivery.inProgressTasks} en progreso</p>
            </Link>
            <Link href="/dashboard/tasks" className="metric-card block cursor-pointer">
              <p className="metric-label">En revision</p>
              <p className="metric-value">{delivery.reviewTasks}</p>
              <p className="metric-note">Esperando aprobacion</p>
            </Link>
            <Link href="/dashboard/projects" className="metric-card block cursor-pointer">
              <p className="metric-label">Completados</p>
              <p className="metric-value">{delivery.completedProjects}</p>
              <p className="metric-note">{dashboardKpiCopy.deliveryCompletedProjectsNote}</p>
            </Link>
          </div>
        </section>
      )}

      <section className="app-section">
        <h2 className="app-section-title">Acciones rapidas</h2>
        <div className="overflow-hidden rounded-md bg-card divide-y divide-border/80">
          {canAccessSales(user.role) && (
            <>
              <Link href="/dashboard/leads" className="app-row group">
                <div className="size-9 rounded-md bg-primary/8 flex shrink-0 items-center justify-center">
                  <Users className="size-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Ver leads</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{sales.openLeads} leads activos</p>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
              </Link>
              <Link href="/dashboard/pipeline" className="app-row group">
                <div className="size-9 rounded-md bg-primary/8 flex shrink-0 items-center justify-center">
                  <TrendingUp className="size-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Pipeline de ventas</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Vista kanban</p>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
              </Link>
            </>
          )}
          {canAccessDelivery(user.role) && (
            <>
              <Link href="/dashboard/projects" className="app-row group">
                <div className="size-9 rounded-md bg-accent/8 flex shrink-0 items-center justify-center">
                  <FolderKanban className="size-4 text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Proyectos</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{delivery.activeProjects} activos</p>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
              </Link>
              <Link href="/dashboard/tasks" className="app-row group">
                <div className="size-9 rounded-md bg-accent/8 flex shrink-0 items-center justify-center">
                  <CheckCircle2 className="size-4 text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Mis tareas</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{delivery.actionableTasks} pendientes</p>
                </div>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
