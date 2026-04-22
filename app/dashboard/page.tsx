'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
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
  Kanban,
  ListTodo,
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
  const num = 'text-xl font-bold tracking-tight tabular-nums leading-none mt-1.5'
  const note = 'text-xs text-muted-foreground mt-1.5'
  const card = 'rounded-[10px] border bg-card px-4 pt-3 pb-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] hover:shadow-[0_3px_12px_rgba(0,0,0,0.12)] hover:border-border/80 hover:-translate-y-px transition-all duration-150 block cursor-pointer'

  const dateStr = mounted
    ? new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''

  return (
    <div>
      {/* ── Dark Hero Header ── */}
      <div className="relative bg-[#000000] px-8 pt-6 pb-7 border-b border-white/[0.05]">
        {/* subtle grid texture */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        {/* Search — top right corner, expands inline */}
        <div className="absolute top-4 right-6 z-10">
          {searchOpen ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.08] border border-white/[0.15] transition-all w-64">
              <Search className="size-3.5 text-white/40 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Buscar..."
                className="flex-1 bg-transparent text-xs text-white/80 placeholder:text-white/25 outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
                    setSearchOpen(false)
                  }
                }}
              />
              <button onClick={() => setSearchOpen(false)} className="text-white/25 hover:text-white/60">
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.07] text-white/25 hover:text-white/55 hover:bg-white/[0.08] transition-all text-xs"
            >
              <Search className="size-3.5 shrink-0" />
              <span>Buscar</span>
              <kbd className="font-mono text-[9px] text-white/20 ml-1">⌘K</kbd>
            </button>
          )}
        </div>

        <p className="relative text-[10px] font-semibold uppercase tracking-[0.15em] text-white/25 mb-3">
          {dateStr}
        </p>
        <h1 className="relative text-[2.8rem] font-black tracking-tight text-white leading-none">
          Hola, {user.name.split(' ')[0]}
        </h1>
        <p className="relative mt-2.5 text-sm text-white/35 flex items-center gap-2">
          <Badge variant="secondary" className="font-medium text-[10px] bg-white/8 text-white/50 border border-white/10 hover:bg-white/8">
            {getRoleLabel(user.role)}
          </Badge>
          {dashboardKpiCopy.headerSummaryLabel}
        </p>

        <div className="relative mt-7 flex flex-wrap items-center gap-2.5">
          <Link href="/dashboard/earnings" className="flex items-center gap-2.5 bg-white/[0.05] border border-white/[0.07] rounded-[10px] px-4 py-2.5 hover:bg-white/[0.09] hover:border-white/[0.12] transition-all">
            <Wallet className="size-3.5 text-white/20 shrink-0" />
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/20">Balance</p>
              <p className="text-sm font-semibold text-white/60 tabular-nums mt-0.5">{personalStats.balanceValueLabel}</p>
            </div>
          </Link>
          <Link href="/dashboard/rewards" className="flex items-center gap-2.5 bg-white/[0.05] border border-white/[0.07] rounded-[10px] px-4 py-2.5 hover:bg-white/[0.09] hover:border-white/[0.12] transition-all">
            <Zap className="size-3.5 text-white/20 shrink-0" />
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/20">Puntos</p>
              <p className="text-sm font-semibold text-white/60 tabular-nums mt-0.5">{personalStats.pointsValueLabel}</p>
            </div>
          </Link>

          {/* Quick action buttons */}
          <div className="flex items-center gap-1.5 ml-1">
            {canAccessSales(user.role) && (
              <>
                <Link href="/dashboard/leads" className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-primary/80 hover:bg-primary transition-colors text-white text-xs font-medium">
                  <Plus className="size-3.5" />
                  Nuevo Lead
                </Link>
                <Link href="/dashboard/pipeline" className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-colors text-white/60 hover:text-white text-xs font-medium">
                  <Kanban className="size-3.5" />
                  Pipeline
                </Link>
              </>
            )}
            {canAccessDelivery(user.role) && (
              <>
                <Link href="/dashboard/projects" className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-colors text-white/60 hover:text-white text-xs font-medium">
                  <FolderKanban className="size-3.5" />
                  Proyectos
                </Link>
                <Link href="/dashboard/tasks" className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-colors text-white/60 hover:text-white text-xs font-medium">
                  <ListTodo className="size-3.5" />
                  Tareas
                </Link>
              </>
            )}
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
              <Link href="/dashboard/leads" className="rounded-[10px] bg-primary px-4 pt-3 pb-4 block hover:opacity-90 hover:-translate-y-px transition-all duration-150 cursor-pointer">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">Leads abiertos</p>
                <p className="text-2xl font-bold tracking-tight tabular-nums leading-none mt-1.5 text-white">{sales.openLeads}</p>
                <p className="text-xs text-white/40 mt-1.5 flex items-center gap-1">
                  {authMode === 'mock' && <ArrowUpRight className="size-3 text-white/60" />}
                  <span>{dashboardKpiCopy.salesOpenLeadsNote}</span>
                </p>
              </Link>
              <Link href="/dashboard/pipeline" className={card}>
                <p className={lbl}>Valor del pipeline</p>
                <p className={num}>${sales.pipelineValue.toLocaleString()}</p>
                <p className={note}>Oportunidades abiertas</p>
              </Link>
              <Link href="/dashboard/leads" className={card}>
                <p className={lbl}>Deals cerrados</p>
                <p className={num}>{sales.wonLeads}</p>
                <p className={note}>{dashboardKpiCopy.salesWonLeadsNote}</p>
              </Link>
              <Link href="/dashboard/earnings" className={card}>
                <p className={lbl}>{dashboardKpiCopy.salesRevenueTitle}</p>
                <p className={num}>${sales.totalRevenue.toLocaleString()}</p>
                <p className={`${note} flex items-center gap-1`}>
                  {authMode === 'mock' && <ArrowUpRight className="size-3 text-emerald-500" />}
                  <span className={authMode === 'mock' ? 'text-emerald-600' : undefined}>{dashboardKpiCopy.salesRevenueNote}</span>
                </p>
              </Link>
            </div>
          </div>
        )}

        {/* ── Conversion + Followups + Chart ── */}
        {canAccessSales(user.role) && leads.length > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            <Link href="/dashboard/leads" className={card}>
              <p className={lbl}>Tasa de conversión</p>
              <p className={num}>{conversionRate !== null ? `${conversionRate}%` : '—'}</p>
              <p className={note}>
                {conversionRate !== null
                  ? `${sales.wonLeads} ganados de ${leads.filter((l) => l.status === 'won' || l.status === 'lost').length} cerrados`
                  : 'Sin deals cerrados aún'}
              </p>
            </Link>

            <Link href="/dashboard/leads" className={card}>
              <p className={lbl}>Seguimientos vencidos</p>
              <p className={`${num} ${overdueFollowUps.length > 0 ? 'text-destructive' : ''}`}>
                {overdueFollowUps.length}
              </p>
              <p className={note}>
                {overdueFollowUps.length === 0
                  ? 'Todo al día'
                  : `${overdueFollowUps.length} lead${overdueFollowUps.length > 1 ? 's' : ''} sin seguimiento`}
              </p>
            </Link>

            <Link href="/dashboard/pipeline" className={card}>
              <p className={`${lbl} mb-3`}>Pipeline por estado</p>
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
            </Link>
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
              <Link href="/dashboard/projects" className="rounded-[10px] bg-[oklch(0.50_0.26_264)] px-4 pt-3 pb-4 block hover:opacity-90 hover:-translate-y-px transition-all duration-150 cursor-pointer">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">Proyectos activos</p>
                <p className="text-2xl font-bold tracking-tight tabular-nums leading-none mt-1.5 text-white">{delivery.activeProjects}</p>
                <p className="text-xs text-white/40 mt-1.5">{delivery.projectsInReview} en revisión</p>
              </Link>
              <Link href="/dashboard/tasks" className={card}>
                <p className={lbl}>Tareas pendientes</p>
                <p className={num}>{delivery.pendingTasks}</p>
                <p className={note}>{delivery.inProgressTasks} en progreso</p>
              </Link>
              <Link href="/dashboard/tasks" className={card}>
                <p className={lbl}>En revisión</p>
                <p className={num}>{delivery.reviewTasks}</p>
                <p className={note}>Esperando aprobación</p>
              </Link>
              <Link href="/dashboard/projects" className={card}>
                <p className={lbl}>Completados</p>
                <p className={num}>{delivery.completedProjects}</p>
                <p className={note}>{dashboardKpiCopy.deliveryCompletedProjectsNote}</p>
              </Link>
            </div>
          </div>
        )}

        {/* ── Quick Actions ── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-4">Acciones rápidas</h2>
          <div className="rounded-[10px] border bg-card shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden divide-y">
            {canAccessSales(user.role) && (
              <>
                <Link href="/dashboard/leads" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors group">
                  <div className="size-9 rounded-[10px] bg-primary/8 flex items-center justify-center shrink-0">
                    <Users className="size-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Ver leads</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{sales.openLeads} leads activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                </Link>
                <Link href="/dashboard/pipeline" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors group">
                  <div className="size-9 rounded-[10px] bg-primary/8 flex items-center justify-center shrink-0">
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
                  <div className="size-9 rounded-[10px] bg-accent/8 flex items-center justify-center shrink-0">
                    <FolderKanban className="size-4 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Proyectos</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{delivery.activeProjects} activos</p>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                </Link>
                <Link href="/dashboard/tasks" className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors group">
                  <div className="size-9 rounded-[10px] bg-accent/8 flex items-center justify-center shrink-0">
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
