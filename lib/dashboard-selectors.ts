import {
  Award,
  Calendar,
  Coffee,
  CreditCard,
  Laptop,
  Star,
  Target,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { AuthMode } from '@/lib/auth-user'
import type { Lead, PointEvent, Project, Reward, SettingsUser, Task, User, UserRole } from './types'
import { deriveProjectDisplayStatus } from '@/lib/projects/progress'

interface SalesSummary {
  openLeads: number
  wonLeads: number
  totalRevenue: number
  pipelineValue: number
}

interface DeliverySummary {
  activeProjects: number
  projectsInReview: number
  completedProjects: number
  pendingTasks: number
  inProgressTasks: number
  reviewTasks: number
  actionableTasks: number
}

export interface DashboardSummary {
  sales: SalesSummary
  delivery: DeliverySummary
}

export interface DashboardKpiCopyModel {
  headerSummaryLabel: string
  salesOpenLeadsNote: string
  salesWonLeadsNote: string
  salesRevenueTitle: string
  salesRevenueNote: string
  deliveryCompletedProjectsNote: string
}

export type LeadStatusFilter = Lead['status'] | 'all'

export type LeadSortOption = 'score' | 'value' | 'date'

export type PipelineStage = Exclude<Lead['status'], 'lost'>

export interface LeadsSummary {
  totalLeads: number
  highScoreLeads: number
  avgScore: number
  pipelineValue: number
}

export interface PipelineColumnModel {
  id: PipelineStage
  title: string
  color: string
  items: Lead[]
}

export interface PipelineBoardSummary {
  pipelineLeads: Lead[]
  columns: PipelineColumnModel[]
  totalPipelineValue: number
}

export interface SettingsUserRow {
  id: string
  name: string
  email: string
  role: UserRole
  initials: string
  balanceLabel: string
  pointsLabel: string
  createdAtLabel: string
}

export interface SettingsDirectoryUserRow {
  id: string
  name: string
  email: string
  role: UserRole
  initials: string
  isActive: boolean
  statusLabel: string
  statusTone: string
  lastLoginLabel: string
  createdAtLabel: string
}

export interface SettingsRoleCard {
  role: UserRole
  email?: string
  initials: string
  isActive: boolean
}

export type RewardCategoryFilter = Reward['category'] | 'all'

export interface RewardStoreItem {
  reward: Reward
  canAfford: boolean
  categoryLabel: string
  categoryColor: string
  categoryIcon: LucideIcon
  pointsCostLabel: string
  actionLabel: string
}

export interface RewardsOverview {
  totalPointsEarned: number
  nextTierPoints: number
  tierProgress: number
  pointsToNextTier: number
  rewardsRedeemedThisYear: string
  pointsThisMonth: string
  monthlyTrendLabel: string
  currentStreakLabel: string
}

export interface RewardHistoryItem {
  id: string
  description: string
  eventLabel: string
  eventIcon: LucideIcon
  createdAtLabel: string
  pointsLabel: string
}

export interface RewardRedeemDialogModel {
  categoryColor: string
  categoryIcon: LucideIcon
  pointsCostLabel: string
  userPointsLabel: string
  remainingPointsLabel: string
  remainingPointsTone: string
  canAfford: boolean
}

export interface PersonalStatsAvailabilityModel {
  isRealDataAvailable: boolean
  balanceValueLabel: string
  balanceDescription: string
  pointsValueLabel: string
  pointsDescription: string
  earningsTitle: string
  earningsDescription: string
  rewardsTitle: string
  rewardsDescription: string
  earningsActionLabel: string
  rewardsActionLabel: string
  sidebarBalanceLabel: string
  sidebarPointsLabel: string
}

export interface ReportsStatsSummary {
  totalLeads: number
  wonLeads: number
  conversionRate: number
  totalRevenue: number
  avgDealSize: number
  activeProjects: number
  completedTasks: number
  avgScore: number
}

export interface ReportsRevenueKpiCopyModel {
  title: string
  averageLabel: string
}

export interface ReportsPipelineDatum {
  name: string
  count: number
  value: number
}

export interface ReportsMonthlyDatum {
  month: string
  leads: number
}

export interface ReportsBreakdownDatum {
  name: string
  value: number
}

export interface ReportsViewModel {
  pipelineData: ReportsPipelineDatum[]
  monthlyData: ReportsMonthlyDatum[]
  sourceData: ReportsBreakdownDatum[]
  projectStatusData: ReportsBreakdownDatum[]
  hasRecentLeadTrend: boolean
  stats: ReportsStatsSummary
}

interface LeadListOptions {
  searchQuery: string
  statusFilter: LeadStatusFilter
  sortBy: LeadSortOption
  proximityFilter?: {
    vendorLat: number
    vendorLng: number
    radiusKm: number | null
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

export function getRadiusKmForWonLeads(wonCount: number): number | null {
  if (wonCount <= 2) return 10
  if (wonCount <= 7) return 25
  if (wonCount <= 15) return 50
  if (wonCount <= 30) return 100
  return null
}

export const leadStatusLabels: Record<Lead['status'], string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  qualified: 'Calificado',
  proposal: 'Propuesta',
  negotiation: 'Negociacion',
  won: 'Ganado',
  lost: 'Perdido',
}

export const pipelineStageLabels: { status: PipelineStage; label: string; color: string }[] = [
  { status: 'new', label: 'Nuevos', color: 'bg-blue-500' },
  { status: 'contacted', label: 'Contactados', color: 'bg-amber-500' },
  { status: 'qualified', label: 'Calificados', color: 'bg-primary' },
  { status: 'proposal', label: 'Propuesta', color: 'bg-orange-500' },
  { status: 'negotiation', label: 'Negociacion', color: 'bg-accent' },
  { status: 'won', label: 'Ganados', color: 'bg-emerald-500' },
]

export const settingsPermissionRows: Array<{ feature: string; perms: boolean[] }> = [
  { feature: 'Dashboard', perms: [true, true, true, true, true] },
  { feature: 'Ver Leads', perms: [true, true, true, false, false] },
  { feature: 'Pipeline Ventas', perms: [true, true, true, false, false] },
  { feature: 'Ver Proyectos', perms: [true, false, false, true, true] },
  { feature: 'Gestionar Tareas', perms: [true, false, false, true, true] },
  { feature: 'Ver Earnings', perms: [true, true, true, true, true] },
  { feature: 'Tienda Recompensas', perms: [true, true, true, true, true] },
  { feature: 'Configuracion', perms: [true, false, false, false, false] },
]

export const settingsNotificationOptions: Array<{
  id: string
  label: string
  desc: string
}> = [
  { id: 'new_lead', label: 'Nuevo lead asignado', desc: 'Cuando se te asigna un nuevo prospecto' },
  { id: 'deal_closed', label: 'Deal cerrado', desc: 'Cuando una venta es completada' },
  { id: 'task_assigned', label: 'Tarea asignada', desc: 'Cuando se te asigna una nueva tarea' },
  { id: 'project_update', label: 'Actualizacion de proyecto', desc: 'Cambios de estado en proyectos' },
  { id: 'commission_approved', label: 'Comision aprobada', desc: 'Cuando una comision es aprobada' },
  { id: 'points_earned', label: 'Puntos ganados', desc: 'Cuando acumulas nuevos puntos' },
]

export function selectPersonalStatsAvailability(
  authMode: AuthMode,
  user: User
): PersonalStatsAvailabilityModel {
  if (authMode === 'mock') {
    return {
      isRealDataAvailable: true,
      balanceValueLabel: `$${user.balance.toLocaleString()}`,
      balanceDescription: 'Disponible para retiro en el entorno demo.',
      pointsValueLabel: user.points.toLocaleString(),
      pointsDescription: 'Disponibles para canjear en el entorno demo.',
      earningsTitle: 'Ganancias demo',
      earningsDescription: 'Balance, comisiones y retiros operan con datos demo en este modo.',
      rewardsTitle: 'Rewards demo',
      rewardsDescription: 'Puntos, historial y canje operan con datos demo en este modo.',
      earningsActionLabel: 'Solicitar Retiro',
      rewardsActionLabel: 'Canjear',
      sidebarBalanceLabel: `Balance: $${user.balance.toLocaleString()}`,
      sidebarPointsLabel: `Puntos: ${user.points.toLocaleString()}`,
    }
  }

  return {
    isRealDataAvailable: false,
    balanceValueLabel: 'Sin datos reales',
    balanceDescription: 'No hay una fuente real de comisiones o pagos conectada a tu cuenta.',
    pointsValueLabel: 'Sin programa real',
    pointsDescription: 'Puntos y recompensas todavia no estan conectados al runtime real.',
    earningsTitle: 'Ganancias no conectadas',
    earningsDescription: 'No existe una fuente real de comisiones, pagos o retiros para esta cuenta en modo Supabase.',
    rewardsTitle: 'Rewards no conectadas',
    rewardsDescription: 'No existe una fuente real de puntos, historial o canje para esta cuenta en modo Supabase.',
    earningsActionLabel: 'Retiros no disponibles',
    rewardsActionLabel: 'Canje no disponible',
    sidebarBalanceLabel: 'Balance: no disponible',
    sidebarPointsLabel: 'Puntos: sin fuente real',
  }
}

const settingsDemoRoles: UserRole[] = ['admin', 'sales_manager', 'sales', 'pm', 'developer']

export const rewardCategoryConfig: Record<
  Reward['category'],
  { label: string; icon: LucideIcon; color: string }
> = {
  gift_card: { label: 'Gift Cards', icon: CreditCard, color: 'bg-blue-500/10 text-blue-700' },
  experience: { label: 'Experiencias', icon: Coffee, color: 'bg-primary/10 text-primary' },
  merchandise: { label: 'Productos', icon: Laptop, color: 'bg-orange-500/10 text-orange-700' },
  time_off: { label: 'Tiempo Libre', icon: Calendar, color: 'bg-emerald-500/10 text-emerald-700' },
  bonus: { label: 'Bonos', icon: Trophy, color: 'bg-amber-500/10 text-amber-700' },
}

export const rewardPointEventLabels: Record<
  PointEvent['type'],
  { label: string; icon: LucideIcon }
> = {
  sale_closed: { label: 'Venta cerrada', icon: Trophy },
  milestone_reached: { label: 'Milestone', icon: Target },
  sla_met: { label: 'SLA cumplido', icon: Zap },
  referral: { label: 'Referido', icon: Star },
  bonus: { label: 'Bono', icon: Award },
}

export const reportsChartColors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

const reportsSourceLabels: Record<string, string> = {
  website: 'Sitio Web',
  referral: 'Referidos',
  social: 'Redes Sociales',
  social_media: 'Redes Sociales',
  cold_call: 'Contacto Frio',
  cold_outreach: 'Contacto Frio',
  event: 'Eventos',
  other: 'Otros',
}

const reportsProjectStatusLabels: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'En Progreso',
  review: 'Revision',
  delivered: 'Entregado',
  completed: 'Completado',
}

function formatReportsMonthLabel(date: Date): string {
  const label = new Intl.DateTimeFormat('es-MX', { month: 'short' }).format(date).replace('.', '')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function buildMonthlyLeadTrend(leads: Lead[], monthCount = 6): ReportsMonthlyDatum[] {
  const now = new Date()
  const months = Array.from({ length: monthCount }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (monthCount - index - 1), 1)

    return {
      month: formatReportsMonthLabel(monthDate),
      leads: 0,
    }
  })

  const monthIndexByKey = new Map(
    months.map((month, index) => {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - (monthCount - index - 1), 1)
      return [`${monthDate.getFullYear()}-${monthDate.getMonth()}`, month]
    })
  )

  leads.forEach((lead) => {
    const leadDate = new Date(lead.createdAt)
    const monthKey = `${leadDate.getFullYear()}-${leadDate.getMonth()}`
    const monthBucket = monthIndexByKey.get(monthKey)

    if (monthBucket) {
      monthBucket.leads += 1
    }
  })

  return months
}

interface EarningsCommissionLike {
  amount: number
  status: 'pending' | 'approved' | 'paid'
}

interface EarningsSummaryOptions {
  withdrawnAmount?: number
  monthlyGoal?: number
}

export interface EarningsSummary {
  totalEarnings: number
  pendingCommissions: number
  approvedCommissions: number
  monthlyGoal: number
  monthlyProgress: number
  remainingToGoal: number
}

export function selectDashboardSummary(
  leads: Lead[],
  projects: Project[],
  tasks: Task[]
): DashboardSummary {
  const sales = {
    openLeads: leads.filter((lead) => !['won', 'lost'].includes(lead.status)).length,
    wonLeads: leads.filter((lead) => lead.status === 'won').length,
    totalRevenue: leads
      .filter((lead) => lead.status === 'won')
      .reduce((sum, lead) => sum + lead.value, 0),
    pipelineValue: leads
      .filter((lead) => !['won', 'lost'].includes(lead.status))
      .reduce((sum, lead) => sum + lead.value, 0),
  }

  const pendingTasks = tasks.filter((task) => task.status === 'todo').length
  const inProgressTasks = tasks.filter((task) => task.status === 'in_progress').length
  const reviewTasks = tasks.filter((task) => task.status === 'review').length

  const getProjectTasks = (projectId: string) => tasks.filter((task) => task.projectId === projectId)

  const delivery = {
    activeProjects: projects.filter((project) =>
      deriveProjectDisplayStatus(project.status, getProjectTasks(project.id)) === 'in_progress'
    ).length,
    projectsInReview: projects.filter((project) =>
      deriveProjectDisplayStatus(project.status, getProjectTasks(project.id)) === 'review'
    ).length,
    completedProjects: projects.filter((project) =>
      deriveProjectDisplayStatus(project.status, getProjectTasks(project.id)) === 'completed'
    ).length,
    pendingTasks,
    inProgressTasks,
    reviewTasks,
    actionableTasks: pendingTasks + inProgressTasks,
  }

  return { sales, delivery }
}

export function selectDashboardKpiCopy(authMode: AuthMode): DashboardKpiCopyModel {
  if (authMode === 'mock') {
    return {
      headerSummaryLabel: 'Aqui esta el resumen de hoy',
      salesOpenLeadsNote: '+12% vs mes anterior',
      salesWonLeadsNote: 'Este mes',
      salesRevenueTitle: 'Revenue total',
      salesRevenueNote: '+23% vs mes anterior',
      deliveryCompletedProjectsNote: 'Este mes',
    }
  }

  return {
    headerSummaryLabel: 'Aqui esta tu resumen visible actual',
    salesOpenLeadsNote: 'Sin comparativa real disponible',
    salesWonLeadsNote: 'Total visible sin corte mensual real',
    salesRevenueTitle: 'Valor ganado visible',
    salesRevenueNote: 'Acumulado visible en leads ganados',
    deliveryCompletedProjectsNote: 'Total visible sin corte mensual real',
  }
}

export function selectLeadList(leads: Lead[], options: LeadListOptions): Lead[] {
  const normalizedSearchQuery = options.searchQuery.toLowerCase()

  return leads
    .filter((lead) => {
      const matchesSearch =
        lead.name.toLowerCase().includes(normalizedSearchQuery) ||
        lead.company?.toLowerCase().includes(normalizedSearchQuery) ||
        lead.email.toLowerCase().includes(normalizedSearchQuery)
      const matchesStatus =
        options.statusFilter === 'all' || lead.status === options.statusFilter

      if (options.proximityFilter) {
        const { vendorLat, vendorLng, radiusKm } = options.proximityFilter
        if (radiusKm === null) {
          return matchesSearch && matchesStatus
        }
        if (lead.latitude == null || lead.longitude == null) {
          return false
        }
        const distKm = haversineKm(vendorLat, vendorLng, lead.latitude, lead.longitude)
        return matchesSearch && matchesStatus && distKm <= radiusKm
      }

      return matchesSearch && matchesStatus
    })
    .sort((a, b) => {
      if (options.sortBy === 'score') return b.score - a.score
      if (options.sortBy === 'value') return b.value - a.value
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })
}

export function selectLeadsSummary(leads: Lead[]): LeadsSummary {
  const totalLeads = leads.length
  const highScoreLeads = leads.filter((lead) => lead.score >= 80).length
  const avgScore =
    totalLeads > 0
      ? Math.round(leads.reduce((sum, lead) => sum + lead.score, 0) / totalLeads)
      : 0
  const pipelineValue = leads
    .filter((lead) => !['won', 'lost'].includes(lead.status))
    .reduce((sum, lead) => sum + lead.value, 0)

  return {
    totalLeads,
    highScoreLeads,
    avgScore,
    pipelineValue,
  }
}

export function selectPipelineBoardSummary(leads: Lead[]): PipelineBoardSummary {
  const pipelineLeads = leads.filter((lead) => lead.status !== 'lost')

  return {
    pipelineLeads,
    columns: pipelineStageLabels.map((stage) => ({
      id: stage.status,
      title: stage.label,
      color: stage.color,
      items: pipelineLeads.filter((lead) => lead.status === stage.status),
    })),
    totalPipelineValue: pipelineLeads
      .filter((lead) => !['won', 'lost'].includes(lead.status))
      .reduce((sum, lead) => sum + lead.value, 0),
  }
}

export function selectPipelineColumnStats(leads: Lead[]): string {
  const total = leads.reduce((sum, lead) => sum + lead.value, 0)
  return `$${total.toLocaleString()}`
}

export function selectLeadScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-700 bg-emerald-500/10'
  if (score >= 60) return 'text-amber-700 bg-amber-500/10'
  if (score >= 40) return 'text-orange-700 bg-orange-500/10'
  return 'text-red-700 bg-red-500/10'
}

function formatSettingsDate(date: Date): string {
  return date.toLocaleDateString('es-MX')
}

function formatSettingsDateTime(date: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function selectSettingsUserRows(users: User[]): SettingsUserRow[] {
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.name.split(' ').map((segment) => segment[0]).join(''),
    balanceLabel: `$${user.balance.toLocaleString()}`,
    pointsLabel: user.points.toLocaleString(),
    createdAtLabel: formatSettingsDate(user.createdAt),
  }))
}

export function selectSettingsDirectoryRows(users: SettingsUser[]): SettingsDirectoryUserRow[] {
  return users.map((user) => ({
    id: user.profileId,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.name.split(' ').map((segment) => segment[0]).join(''),
    isActive: user.isActive,
    statusLabel: user.isActive ? 'Activo' : 'Inactivo',
    statusTone: user.isActive
      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-200'
      : 'bg-muted text-muted-foreground border-border',
    lastLoginLabel: user.lastLoginAt ? formatSettingsDateTime(user.lastLoginAt) : 'Sin registro',
    createdAtLabel: formatSettingsDate(user.createdAt),
  }))
}

export function selectSettingsRoleCards(
  users: User[],
  activeRole: UserRole
): SettingsRoleCard[] {
  return settingsDemoRoles.map((role) => {
    const roleUser = users.find((user) => user.role === role)

    return {
      role,
      email: roleUser?.email,
      initials: roleUser?.name.split(' ').map((segment) => segment[0]).join('') ?? '',
      isActive: activeRole === role,
    }
  })
}

export function selectRewardsOverview(
  userPoints: number,
  pointEvents: PointEvent[],
  userId: string
): RewardsOverview {
  const totalPointsEarned = pointEvents
    .filter((event) => event.userId === userId)
    .reduce((sum, event) => sum + event.points, 0)
  const nextTierPoints = 3000

  return {
    totalPointsEarned,
    nextTierPoints,
    tierProgress: Math.min((userPoints / nextTierPoints) * 100, 100),
    pointsToNextTier: Math.max(nextTierPoints - userPoints, 0),
    rewardsRedeemedThisYear: '3',
    pointsThisMonth: '700',
    monthlyTrendLabel: '+25% vs mes anterior',
    currentStreakLabel: '12 dias',
  }
}

export function selectRewardStoreItems(
  rewards: Reward[],
  categoryFilter: RewardCategoryFilter,
  userPoints: number
): RewardStoreItem[] {
  const filteredRewards =
    categoryFilter === 'all'
      ? rewards
      : rewards.filter((reward) => reward.category === categoryFilter)

  return filteredRewards.map((reward) => {
    const categoryDetails = rewardCategoryConfig[reward.category]
    const canAfford = userPoints >= reward.pointsCost

    return {
      reward,
      canAfford,
      categoryLabel: categoryDetails.label,
      categoryColor: categoryDetails.color,
      categoryIcon: categoryDetails.icon,
      pointsCostLabel: reward.pointsCost.toLocaleString(),
      actionLabel: canAfford ? 'Canjear' : 'Puntos insuficientes',
    }
  })
}

export function selectRewardHistoryItems(
  pointEvents: PointEvent[],
  userId: string
): RewardHistoryItem[] {
  return pointEvents
    .filter((event) => event.userId === userId)
    .map((event) => {
      const eventDetails = rewardPointEventLabels[event.type]

      return {
        id: event.id,
        description: event.description,
        eventLabel: eventDetails.label,
        eventIcon: eventDetails.icon,
        createdAtLabel: event.createdAt.toLocaleDateString('es-MX'),
        pointsLabel: `+${event.points}`,
      }
    })
}

export function selectRewardRedeemDialog(
  reward: Reward,
  userPoints: number
): RewardRedeemDialogModel {
  const categoryDetails = rewardCategoryConfig[reward.category]
  const remainingPoints = userPoints - reward.pointsCost
  const canAfford = userPoints >= reward.pointsCost

  return {
    categoryColor: categoryDetails.color,
    categoryIcon: categoryDetails.icon,
    pointsCostLabel: reward.pointsCost.toLocaleString(),
    userPointsLabel: userPoints.toLocaleString(),
    remainingPointsLabel: remainingPoints.toLocaleString(),
    remainingPointsTone: canAfford ? 'text-emerald-700' : 'text-destructive',
    canAfford,
  }
}

export function selectReportsViewModel(
  leads: Lead[],
  projects: Project[],
  tasks: Task[]
): ReportsViewModel {
  const pipelineStatusCounts: Record<string, { count: number; value: number }> = {}
  const pipelineStatuses = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost']

  pipelineStatuses.forEach((status) => {
    pipelineStatusCounts[status] = { count: 0, value: 0 }
  })

  leads.forEach((lead) => {
    if (pipelineStatusCounts[lead.status]) {
      pipelineStatusCounts[lead.status].count++
      pipelineStatusCounts[lead.status].value += lead.value
    }
  })

  const totalLeads = leads.length
  const wonLeads = leads.filter((lead) => lead.status === 'won').length
  const totalRevenue = leads
    .filter((lead) => lead.status === 'won')
    .reduce((sum, lead) => sum + lead.value, 0)

  const sourceCounts: Record<string, number> = {}
  leads.forEach((lead) => {
    sourceCounts[lead.source] = (sourceCounts[lead.source] || 0) + 1
  })

  const projectStatusCounts: Record<string, number> = {}
  projects.forEach((project) => {
    const displayStatus = deriveProjectDisplayStatus(
      project.status,
      tasks.filter((task) => task.projectId === project.id)
    )
    projectStatusCounts[displayStatus] = (projectStatusCounts[displayStatus] || 0) + 1
  })

  const monthlyData = buildMonthlyLeadTrend(leads)

  return {
    pipelineData: [
      { name: 'Nuevos', count: pipelineStatusCounts.new.count, value: pipelineStatusCounts.new.value },
      { name: 'Contactados', count: pipelineStatusCounts.contacted.count, value: pipelineStatusCounts.contacted.value },
      { name: 'Calificados', count: pipelineStatusCounts.qualified.count, value: pipelineStatusCounts.qualified.value },
      { name: 'Propuesta', count: pipelineStatusCounts.proposal.count, value: pipelineStatusCounts.proposal.value },
      { name: 'Negociacion', count: pipelineStatusCounts.negotiation.count, value: pipelineStatusCounts.negotiation.value },
      { name: 'Ganados', count: pipelineStatusCounts.won.count, value: pipelineStatusCounts.won.value },
    ],
    monthlyData,
    sourceData: Object.entries(sourceCounts).map(([key, value]) => ({
      name: reportsSourceLabels[key] || key,
      value,
    })),
    projectStatusData: Object.entries(projectStatusCounts).map(([key, value]) => ({
      name: reportsProjectStatusLabels[key] || key,
      value,
    })),
    hasRecentLeadTrend: monthlyData.some((month) => month.leads > 0),
    stats: {
      totalLeads,
      wonLeads,
      conversionRate: totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0,
      totalRevenue,
      avgDealSize: wonLeads > 0 ? Math.round(totalRevenue / wonLeads) : 0,
      activeProjects: projects.filter((project) =>
        deriveProjectDisplayStatus(
          project.status,
          tasks.filter((task) => task.projectId === project.id)
        ) === 'in_progress'
      ).length,
      completedTasks: tasks.filter((task) => task.status === 'done').length,
      avgScore:
        totalLeads > 0
          ? Math.round(leads.reduce((sum, lead) => sum + lead.score, 0) / totalLeads)
          : 0,
    },
  }
}

export function selectReportsRevenueKpiCopy(authMode: AuthMode): ReportsRevenueKpiCopyModel {
  if (authMode === 'mock') {
    return {
      title: 'Ingresos Totales',
      averageLabel: 'por venta',
    }
  }

  return {
    title: 'Valor ganado visible',
    averageLabel: 'por lead ganado visible',
  }
}

export function selectEarningsSummary(
  availableBalance: number,
  commissions: EarningsCommissionLike[],
  options: EarningsSummaryOptions = {}
): EarningsSummary {
  const withdrawnAmount = options.withdrawnAmount ?? 3000
  const monthlyGoal = options.monthlyGoal ?? 5000

  const pendingCommissions = commissions
    .filter((commission) => commission.status === 'pending')
    .reduce((sum, commission) => sum + commission.amount, 0)

  const approvedCommissions = commissions
    .filter((commission) => commission.status === 'approved')
    .reduce((sum, commission) => sum + commission.amount, 0)

  return {
    totalEarnings: availableBalance + withdrawnAmount,
    pendingCommissions,
    approvedCommissions,
    monthlyGoal,
    monthlyProgress: Math.min((availableBalance / monthlyGoal) * 100, 100),
    remainingToGoal: Math.max(monthlyGoal - availableBalance, 0),
  }
}
