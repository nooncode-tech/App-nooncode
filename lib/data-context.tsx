'use client'

import { createContext, startTransition, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import type {
  DeliveryUser,
  Lead,
  LeadActivity,
  LeadDraft,
  LeadProposal,
  LeadSource,
  LeadStatus,
  LeadUpdates,
  ProposalStatus,
  Project,
  ProjectDraft,
  ProjectStatus,
  ProjectTaskActivity,
  ProjectUpdates,
  Reward,
  SettingsUser,
  Task,
  TaskActivity,
  TaskDraft,
  TaskStatus,
  TaskUpdates,
  User,
} from './types'
import { mockLeads, mockProjects, mockTasks, mockRewards, mockUsers } from './mock-data'
import { useAuth } from './auth-context'
import { deserializeLead, type LeadWire } from '@/lib/leads/serialization'
import type { OffsetMeta } from '@/lib/server/pagination/envelope'

// Client default page size for /dashboard/leads. Server caps at 100
// (lib/server/pagination/schema.ts); 50 gives faster navigation and makes
// multi-page browsing visible on small tenants.
export const LEADS_PAGE_SIZE = 50
import {
  deserializeLeadActivity,
  type LeadActivityWire,
} from '@/lib/leads/activity-serialization'
import {
  deserializeLeadProposal,
  type LeadProposalWire,
} from '@/lib/leads/proposal-serialization'
import {
  deserializeProject,
  type ProjectWire,
} from '@/lib/projects/serialization'
import {
  deserializeProjectVisibleActivity,
  type ProjectVisibleActivityWire,
} from '@/lib/projects/activity-serialization'
import {
  deserializeTask,
  type TaskWire,
} from '@/lib/tasks/serialization'
import {
  deserializeTaskActivity,
  type TaskActivityWire,
} from '@/lib/tasks/activity-serialization'
import {
  deserializeAdminDirectoryUser,
  type AdminDirectoryUserWire,
} from '@/lib/users/admin-directory-serialization'
import type { DashboardSummaryResponse } from '@/lib/server/dashboard/serialization'
import {
  createDashboardSummaryDebouncer,
  isDashboardSummaryFresh,
  type DashboardSummaryDebouncer,
} from '@/lib/dashboard/summary-cache'

interface UseDashboardSummaryResult {
  data: DashboardSummaryResponse | null
  isLoading: boolean
  error: Error | null
  refresh: () => Promise<void>
}

interface DataContextType {
  // Leads
  isLeadsLoading: boolean
  leads: Lead[]
  leadsPagination: OffsetMeta | null
  setLeadsPage: (page: number) => Promise<void>
  refreshLeads: () => Promise<void>
  addLead: (lead: LeadDraft) => Promise<Lead>
  updateLead: (id: string, updates: LeadUpdates) => Promise<Lead>
  deleteLead: (id: string) => Promise<void>
  updateLeadStatus: (id: string, status: LeadStatus) => Promise<Lead>
  claimLead: (leadId: string) => Promise<Lead>
  releaseLeadAsNoResponse: (leadId: string) => Promise<Lead>
  getLeadActivity: (leadId: string) => Promise<LeadActivity[]>
  addLeadNote: (leadId: string, body: string) => Promise<LeadActivity>
  getLeadProposals: (leadId: string) => Promise<LeadProposal[]>
  addLeadProposal: (leadId: string, input: {
    title: string
    body: string
    amount: number
    currency?: string
    status?: ProposalStatus
    sellerFeeAmount?: 100 | 300 | 500
    projectType?: 'landing' | 'ecommerce' | 'webapp' | 'mobile' | 'saas_ai'
    complexity?: 'low' | 'medium' | 'high'
  }) => Promise<LeadProposal>
  updateLeadProposalStatus: (leadId: string, proposalId: string, status: ProposalStatus) => Promise<LeadProposal>
  createProjectFromProposal: (leadId: string, proposalId: string) => Promise<Project>

  // Projects
  projects: Project[]
  persistedProjects: Project[]
  projectBoardProjects: Project[]
  isProjectsLoading: boolean
  addProject: (project: ProjectDraft) => Project
  updateProject: (id: string, updates: ProjectUpdates) => Promise<Project> | void
  deleteProject: (id: string) => void
  updateProjectStatus: (id: string, status: ProjectStatus) => Promise<Project> | void
  refreshProjects: () => Promise<void>

  // Tasks
  tasks: Task[]
  persistedTasks: Task[]
  taskBoardTasks: Task[]
  isTasksLoading: boolean
  addTask: (task: TaskDraft) => Promise<Task> | Task
  updateTask: (id: string, updates: TaskUpdates) => Promise<Task> | void
  deleteTask: (id: string) => void
  updateTaskStatus: (id: string, status: TaskStatus) => Promise<Task> | void
  refreshTasks: () => Promise<void>
  getTasksByProject: (projectId: string) => Task[]
  getTaskActivity: (taskId: string) => Promise<TaskActivity[]>
  getProjectActivity: (projectId: string) => Promise<ProjectTaskActivity[]>
  addTaskNote: (taskId: string, body: string) => Promise<TaskActivity>

  // Rewards
  rewards: Reward[]
  redeemReward: (rewardId: string, userId: string) => boolean

  // Users
  isSettingsUsersLoading: boolean
  settingsUsers: SettingsUser[]
  settingsUsersError: string | null
  refreshSettingsUsers: () => Promise<void>
  deliveryUsers: DeliveryUser[]
  users: User[]
  getUserById: (id: string) => User | undefined

  // Points
  userPoints: Record<string, number>
  addPoints: (userId: string, points: number, reason: string) => void
  deductPoints: (userId: string, points: number, reason: string) => boolean
  getPointsHistory: (userId: string) => PointsTransaction[]

  // Dashboard summary (server-aggregated KPI payload — supabase mode only)
  // See ADR-020 §D7 (hook location) and §D5 (60s SWR TTL).
  dashboardSummary: DashboardSummaryResponse | null
  isDashboardSummaryLoading: boolean
  dashboardSummaryError: Error | null
  refreshDashboardSummary: (options?: { force?: boolean }) => Promise<void>
}

interface PointsTransaction {
  id: string
  userId: string
  points: number
  type: 'earned' | 'redeemed'
  reason: string
  timestamp: Date
}

const DataContext = createContext<DataContextType | undefined>(undefined)

interface ApiResponse<T> {
  data: T
}

interface PaginatedApiResponse<T> {
  data: T
  meta: OffsetMeta
}

function buildMockLeadsPagination(leadsCount: number): OffsetMeta {
  return {
    page: 1,
    limit: Math.max(leadsCount, 1),
    total: leadsCount,
    pageCount: leadsCount === 0 ? 0 : 1,
  }
}

function normalizeLeadSource(source: LeadDraft['source']): LeadSource {
  if (source === 'social_media') return 'social'
  if (source === 'cold_outreach') return 'cold_call'
  return source
}

function createMockLeadActivity(
  leadId: string,
  type: LeadActivity['type'],
  actorName: string,
  createdAt: Date,
  options?: {
    actorId?: string
    noteBody?: string
    metadata?: Record<string, unknown>
  }
): LeadActivity {
  return {
    id: `lead-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    leadId,
    type,
    actorId: options?.actorId,
    actorName,
    noteBody: options?.noteBody,
    metadata: options?.metadata,
    createdAt,
  }
}

function buildInitialMockLeadActivity(leads: Lead[]): Record<string, LeadActivity[]> {
  return leads.reduce<Record<string, LeadActivity[]>>((acc, lead) => {
    acc[lead.id] = [
      createMockLeadActivity(lead.id, 'created', 'Sistema demo', lead.createdAt, {
        metadata: { status: lead.status },
      }),
    ]
    return acc
  }, {})
}

function createMockTaskActivity(
  taskId: string,
  actorName: string,
  createdAt: Date,
  options?: {
    actorId?: string
    noteBody?: string
    metadata?: Record<string, unknown>
  }
): TaskActivity {
  return {
    id: `task-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    type: 'note_added',
    actorId: options?.actorId,
    actorName,
    noteBody: options?.noteBody,
    metadata: options?.metadata,
    createdAt,
  }
}

function createMockLeadProposal(
  leadId: string,
  input: {
    title: string
    body: string
    amount: number
    currency: string
    status: ProposalStatus
  }
): LeadProposal {
  const now = new Date()
  return {
    id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    leadId,
    title: input.title,
    body: input.body,
    amount: input.amount,
    currency: input.currency,
    status: input.status,
    reviewStatus: 'pending_review',
    paymentStatus: null,
    paidAt: null,
    versionNumber: 1,
    isSpecialCase: false,
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
    sentAt: input.status === 'sent' ? now : undefined,
    acceptedAt: input.status === 'accepted' || input.status === 'handoff_ready' ? now : undefined,
    handoffReadyAt: input.status === 'handoff_ready' ? now : undefined,
    activeCheckoutLink: null,
  }
}

function createMockProjectFromProposal(lead: Lead, proposal: LeadProposal): Project {
  const now = new Date()

  return {
    id: `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: proposal.title,
    description: proposal.body,
    clientName: lead.company ?? lead.name,
    status: 'backlog',
    budget: proposal.amount,
    teamIds: [],
    createdAt: now,
    updatedAt: now,
    sourceLeadId: lead.id,
    sourceProposalId: proposal.id,
    handoffReadyAt: proposal.handoffReadyAt ?? proposal.acceptedAt ?? now,
  }
}

function mapLeadDraftToRequest(leadData: LeadDraft) {
  return {
    name: leadData.name,
    email: leadData.email ?? null,
    phone: leadData.phone ?? null,
    whatsapp: leadData.whatsapp ?? null,
    company: leadData.company ?? null,
    source: leadData.source,
    status: leadData.status,
    score: leadData.score,
    value: leadData.value,
    notes: leadData.notes ?? null,
    tags: leadData.tags,
    assignedTo: leadData.assignedTo ?? null,
    lastContactedAt: leadData.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: leadData.nextFollowUpAt?.toISOString() ?? null,
    locationText: leadData.locationText ?? null,
    latitude: leadData.latitude ?? null,
    longitude: leadData.longitude ?? null,
    leadOrigin: leadData.leadOrigin,
    nicheId: leadData.nicheId ?? null,
  }
}

function mapLeadUpdatesToRequest(updates: LeadUpdates) {
  const payload: Record<string, unknown> = {}

  if (updates.name !== undefined) payload.name = updates.name
  if (updates.email !== undefined) payload.email = updates.email
  if (updates.phone !== undefined) payload.phone = updates.phone ?? null
  if (updates.whatsapp !== undefined) payload.whatsapp = updates.whatsapp ?? null
  if (updates.company !== undefined) payload.company = updates.company ?? null
  if (updates.source !== undefined) payload.source = updates.source
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.score !== undefined) payload.score = updates.score
  if (updates.value !== undefined) payload.value = updates.value
  if (updates.notes !== undefined) payload.notes = updates.notes ?? null
  if (updates.tags !== undefined) payload.tags = updates.tags
  if (updates.assignedTo !== undefined) payload.assignedTo = updates.assignedTo ?? null
  if (updates.lastContactedAt !== undefined) {
    payload.lastContactedAt = updates.lastContactedAt?.toISOString() ?? null
  }
  if (updates.nextFollowUpAt !== undefined) {
    payload.nextFollowUpAt = updates.nextFollowUpAt?.toISOString() ?? null
  }
  if (updates.nicheId !== undefined) payload.nicheId = updates.nicheId ?? null

  return payload
}

function mapProjectUpdatesToRequest(updates: ProjectUpdates) {
  const payload: Record<string, unknown> = {}

  if (updates.name !== undefined) payload.name = updates.name
  if (updates.clientName !== undefined) payload.clientName = updates.clientName
  if (updates.description !== undefined) payload.description = updates.description ?? null
  if (updates.status !== undefined) payload.status = updates.status
  if (updates.budget !== undefined) payload.budget = updates.budget
  if (updates.pmId !== undefined) payload.pmId = updates.pmId ?? null
  if (updates.teamIds !== undefined) payload.teamIds = updates.teamIds
  if (updates.startDate !== undefined) {
    payload.startDate = updates.startDate?.toISOString().slice(0, 10) ?? null
  }
  if (updates.endDate !== undefined) {
    payload.endDate = updates.endDate?.toISOString().slice(0, 10) ?? null
  }

  return payload
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : 'The request could not be completed.'
    throw new Error(message)
  }

  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as ApiResponse<T>).data
  }

  return payload as T
}

// Reads the full `{ data, meta }` offset envelope. Distinct from
// `readApiResponse<T>` which discards `meta` — that helper is used for
// non-paginated routes and for endpoints whose meta is not consumed yet.
async function readPaginatedApiResponse<T>(response: Response): Promise<PaginatedApiResponse<T>> {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : 'The request could not be completed.'
    throw new Error(message)
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    'meta' in payload
  ) {
    return payload as PaginatedApiResponse<T>
  }

  throw new Error('Unexpected response shape: missing pagination envelope.')
}

function normalizeTaskAssignment(taskData: Pick<TaskDraft, 'assignedTo' | 'assignedToName' | 'assigneeId' | 'assigneeName'>) {
  return {
    assignedTo: taskData.assignedTo ?? taskData.assigneeId,
    assignedToName: taskData.assignedToName ?? taskData.assigneeName,
  }
}

function mapMockUserToDeliveryUser(user: User): DeliveryUser {
  return {
    id: user.id,
    profileId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as DeliveryUser['role'],
    avatar: user.avatar,
    isActive: true,
  }
}

function mapMockUserToSettingsUser(user: User): SettingsUser {
  return {
    profileId: user.id,
    legacyMockId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatar: user.avatar,
    isActive: true,
    createdAt: user.createdAt,
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function mergeProjects(baseProjects: Project[], incomingProjects: Project[]): Project[] {
  const projectById = new Map<string, Project>()

  for (const project of baseProjects) {
    projectById.set(project.id, project)
  }

  for (const project of incomingProjects) {
    projectById.set(project.id, project)
  }

  return Array.from(projectById.values()).sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
  )
}

function mergeTasks(baseTasks: Task[], incomingTasks: Task[]): Task[] {
  const taskById = new Map<string, Task>()

  for (const task of baseTasks) {
    taskById.set(task.id, task)
  }

  for (const task of incomingTasks) {
    taskById.set(task.id, task)
  }

  return Array.from(taskById.values()).sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
  )
}

function replaceLeadInCollection(collection: Lead[], nextLead: Lead): Lead[] {
  const existingLeadIndex = collection.findIndex((lead) => lead.id === nextLead.id)

  if (existingLeadIndex === -1) {
    return [nextLead, ...collection].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    )
  }

  return collection.map((lead) => (lead.id === nextLead.id ? nextLead : lead))
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { authMode, user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>(authMode === 'supabase' ? [] : mockLeads)
  const [leadsPagination, setLeadsPagination] = useState<OffsetMeta | null>(
    authMode === 'supabase' ? null : buildMockLeadsPagination(mockLeads.length)
  )
  const [isLeadsLoading, setIsLeadsLoading] = useState(authMode === 'supabase')
  // Overlap guard for `setLeadsPage`. Tracks an actual in-flight `/api/leads`
  // fetch — NOT the `isLeadsLoading` UI flag. The flag initializes to `true`
  // in supabase mode (a "we expect to load" placeholder), so mirroring it
  // here would wrongly block the page's first `setLeadsPage(1)` on a hard
  // reload: the page (child) effect fires the load before the provider
  // (parent) effect can sync a state-derived ref down to `false`, so the
  // guard would read a stale `true` and bail, leaving leads empty with no
  // retry. This ref is owned exclusively by `setLeadsPage` and flipped
  // synchronously at call/finish time.
  const leadsRequestInFlightRef = useRef(false)
  const [leadActivityByLeadId, setLeadActivityByLeadId] = useState<Record<string, LeadActivity[]>>(
    () => (authMode === 'supabase' ? {} : buildInitialMockLeadActivity(mockLeads))
  )
  const [leadProposalsByLeadId, setLeadProposalsByLeadId] = useState<Record<string, LeadProposal[]>>(
    () => ({})
  )
  const leadActivityByLeadIdRef = useRef<Record<string, LeadActivity[]>>(leadActivityByLeadId)
  const leadProposalsByLeadIdRef = useRef<Record<string, LeadProposal[]>>(leadProposalsByLeadId)
  const [projects, setProjects] = useState<Project[]>(mockProjects)
  const [persistedProjects, setPersistedProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>(mockTasks)
  const [persistedTasks, setPersistedTasks] = useState<Task[]>([])
  const [taskActivityByTaskId, setTaskActivityByTaskId] = useState<Record<string, TaskActivity[]>>(
    () => ({})
  )
  const taskActivityByTaskIdRef = useRef<Record<string, TaskActivity[]>>(taskActivityByTaskId)
  const [rewards] = useState<Reward[]>(mockRewards)
  const [users] = useState<User[]>(mockUsers)
  const [settingsUsers, setSettingsUsers] = useState<SettingsUser[]>(
    () => mockUsers.map(mapMockUserToSettingsUser)
  )
  const [isSettingsUsersLoading, setIsSettingsUsersLoading] = useState(false)
  const [settingsUsersError, setSettingsUsersError] = useState<string | null>(null)
  const [deliveryUsers, setDeliveryUsers] = useState<DeliveryUser[]>(
    () => mockUsers
      .filter((user) => ['admin', 'pm', 'developer'].includes(user.role))
      .map(mapMockUserToDeliveryUser)
  )
  const [userPoints, setUserPoints] = useState<Record<string, number>>(() => {
    const points: Record<string, number> = {}
    mockUsers.forEach((u) => {
      points[u.id] = u.points
    })
    return points
  })
  const [pointsHistory, setPointsHistory] = useState<PointsTransaction[]>([])

  // Per-slice loading flags for the lazy-load surfaces. Pre-refactor the
  // provider eager-loaded projects/tasks at mount, so consumers had no
  // visibility into a "still loading" state. Post-refactor (ADR-020 §D8)
  // each list page triggers its own load; the consuming page reads these
  // flags so the first paint can render a spinner instead of an empty
  // state.
  const [isProjectsLoading, setIsProjectsLoading] = useState(false)
  const [isTasksLoading, setIsTasksLoading] = useState(false)

  // Dashboard summary client cache (supabase mode only). The hook
  // `useDashboardSummary` reads `dashboardSummary` + `isDashboardSummaryLoading`
  // + `dashboardSummaryError`, and calls `refreshDashboardSummary` to
  // force a refetch when the consumer initiates one. Mutation
  // invalidation (D6) schedules a debounced refetch via
  // `scheduleDashboardSummaryRefetch`. Mock mode never populates these
  // fields; `selectDashboardSummary` continues to derive KPIs locally.
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummaryResponse | null>(null)
  const [isDashboardSummaryLoading, setIsDashboardSummaryLoading] = useState(false)
  const [dashboardSummaryError, setDashboardSummaryError] = useState<Error | null>(null)
  // Timestamp (Date.now()) of the most recent successful fetch. Used to
  // honor the 60s SWR window (ADR-020 §D5) on `{ force: false }` calls.
  const dashboardSummaryFetchedAtRef = useRef<number | null>(null)
  // Tracks a pending fetch promise so back-to-back force-refetches do
  // not stack multiple network calls. Also used by the debounce helper
  // to wait for the in-flight call before scheduling a follow-up.
  const dashboardSummaryInFlightRef = useRef<Promise<void> | null>(null)
  // Debouncer for mutation-triggered refetches. ADR-020 §D6: the
  // kanban drag-drop in /dashboard/pipeline fires a sequence of
  // updateLeadStatus calls; without a 250ms debounce, each fires an
  // independent summary refetch. The debouncer is lazily created on
  // the first invalidation so it captures the live
  // `refreshDashboardSummary` closure via the helper ref below.
  const dashboardSummaryDebouncerRef = useRef<DashboardSummaryDebouncer | null>(null)
  // Tracks whether the current provider is operating in supabase mode.
  // Mock mode never fetches the summary endpoint; mutation invalidations
  // become no-ops there. Captured via ref so the debounced refetch sees
  // the latest mode without re-creating the callback.
  const authModeRef = useRef(authMode)
  useEffect(() => {
    authModeRef.current = authMode
  }, [authMode])

  // Tracks the authMode seen by the slice-reset effect on its previous run.
  // The reset must fire only on an actual mode transition — not on every
  // `user`/callback identity change — or a late `user` resolution after a list
  // page already lazy-loaded its slice would wipe that slice, and the page's
  // one-shot load trigger would not recover until a remount.
  const prevAuthModeRef = useRef<typeof authMode | null>(null)

  useEffect(() => {
    leadActivityByLeadIdRef.current = leadActivityByLeadId
  }, [leadActivityByLeadId])

  useEffect(() => {
    leadProposalsByLeadIdRef.current = leadProposalsByLeadId
  }, [leadProposalsByLeadId])

  useEffect(() => {
    taskActivityByTaskIdRef.current = taskActivityByTaskId
  }, [taskActivityByTaskId])

  const loadLeads = useCallback(async (page: number = 1, limit: number = LEADS_PAGE_SIZE) => {
    const response = await fetch(`/api/leads?page=${page}&limit=${limit}`, {
      method: 'GET',
      cache: 'no-store',
    })
    const envelope = await readPaginatedApiResponse<LeadWire[]>(response)
    setLeads(envelope.data.map(deserializeLead))
    setLeadsPagination(envelope.meta)
  }, [])

  const refreshLeads = useCallback(async () => {
    if (authMode !== 'supabase') {
      setLeads(mockLeads)
      setLeadsPagination(buildMockLeadsPagination(mockLeads.length))
      return
    }

    const currentPage = leadsPagination?.page ?? 1
    await loadLeads(currentPage)
  }, [authMode, leadsPagination, loadLeads])

  const setLeadsPage = useCallback(async (page: number) => {
    if (authMode !== 'supabase') {
      // Mock mode is single-page; nothing to fetch.
      return
    }

    // Guard against overlapping requests when the user double-clicks prev/next.
    // Uses a dedicated in-flight ref flipped synchronously here — not the
    // `isLeadsLoading` state — so the initial `true` placeholder never blocks
    // the page's first load on a hard reload.
    if (leadsRequestInFlightRef.current) {
      return
    }

    const targetPage = Math.max(1, Math.floor(page))
    leadsRequestInFlightRef.current = true
    setIsLeadsLoading(true)
    try {
      await loadLeads(targetPage)
    } catch {
      // Loader-level error: leave state untouched so the UI can retry.
    } finally {
      setIsLeadsLoading(false)
      leadsRequestInFlightRef.current = false
    }
  }, [authMode, loadLeads])

  const replaceLead = useCallback((nextLead: Lead) => {
    setLeads((prev) => replaceLeadInCollection(prev, nextLead))
  }, [])

  const loadProjects = useCallback(async () => {
    const response = await fetch('/api/projects', {
      method: 'GET',
      cache: 'no-store',
    })
    const payload = await readApiResponse<ProjectWire[]>(response)
    const nextProjects = payload.map(deserializeProject)
    setPersistedProjects(nextProjects)
    setProjects(mergeProjects(mockProjects, nextProjects))
  }, [])

  const loadTasks = useCallback(async () => {
    const response = await fetch('/api/tasks', {
      method: 'GET',
      cache: 'no-store',
    })
    const payload = await readApiResponse<TaskWire[]>(response)
    const nextTasks = payload.map(deserializeTask)
    setPersistedTasks(nextTasks)
    setTasks(mergeTasks(mockTasks, nextTasks))
  }, [])

  const loadDeliveryUsers = useCallback(async () => {
    const response = await fetch('/api/users/delivery', {
      method: 'GET',
      cache: 'no-store',
    })
    const payload = await readApiResponse<DeliveryUser[]>(response)
    setDeliveryUsers(payload)
  }, [])

  const loadSettingsUsers = useCallback(async () => {
    const response = await fetch('/api/users/admin', {
      method: 'GET',
      cache: 'no-store',
    })
    const payload = await readApiResponse<AdminDirectoryUserWire[]>(response)
    return payload.map(deserializeAdminDirectoryUser)
  }, [])

  const refreshSettingsUsers = useCallback(async () => {
    setIsSettingsUsersLoading(true)
    setSettingsUsersError(null)

    try {
      const nextSettingsUsers = await loadSettingsUsers()
      setSettingsUsers(nextSettingsUsers)
    } catch (error) {
      setSettingsUsers([])
      setSettingsUsersError(
        error instanceof Error ? error.message : 'No se pudieron cargar los usuarios reales.'
      )
      throw error
    } finally {
      setIsSettingsUsersLoading(false)
    }
  }, [loadSettingsUsers])

  // Fetches the dashboard summary from `GET /api/dashboard/summary` and
  // populates `dashboardSummary` / `dashboardSummaryError`. Honors the
  // 60s SWR TTL unless `{ force: true }` is passed (ADR-020 §D5, §D6).
  //
  // - Mock mode is a no-op: the consumer derives KPIs via
  //   `selectDashboardSummary` over in-memory mock data, per spec §4.
  // - Coalesces overlapping calls: if a fetch is already in flight, the
  //   same promise is returned so callers never trigger two simultaneous
  //   network reads.
  // - Errors are surfaced via `dashboardSummaryError`; the cached payload
  //   (if any) is preserved so the UI continues to show the last good
  //   read while the consumer retries.
  const refreshDashboardSummary = useCallback(async (options?: { force?: boolean }) => {
    if (authModeRef.current !== 'supabase') {
      return
    }

    const force = options?.force === true
    const fetchedAt = dashboardSummaryFetchedAtRef.current

    // SWR TTL: skip if cached payload is fresh AND not forced. The
    // freshness decision lives in a pure helper so it can be unit-
    // tested without spinning up a React tree.
    if (
      isDashboardSummaryFresh({
        fetchedAtMs: fetchedAt,
        nowMs: Date.now(),
        force,
      })
    ) {
      return
    }

    // Coalesce overlapping fetches. The in-flight promise resolves once
    // state has been written, so the caller observes consistent timing
    // regardless of whether it triggered the fetch or piggy-backed on
    // someone else's.
    if (dashboardSummaryInFlightRef.current) {
      return dashboardSummaryInFlightRef.current
    }

    setIsDashboardSummaryLoading(true)
    setDashboardSummaryError(null)

    const fetchPromise = (async () => {
      try {
        const response = await fetch('/api/dashboard/summary', {
          method: 'GET',
          cache: 'no-store',
        })
        const payload = await readApiResponse<DashboardSummaryResponse>(response)
        setDashboardSummary(payload)
        dashboardSummaryFetchedAtRef.current = Date.now()
      } catch (error) {
        const wrapped = error instanceof Error
          ? error
          : new Error('No se pudo cargar el resumen del dashboard.')
        setDashboardSummaryError(wrapped)
        // Keep the previously cached payload (if any) so the UI does not
        // lose its last-good read. The error surface lets the consumer
        // decide whether to show a banner / retry.
      } finally {
        setIsDashboardSummaryLoading(false)
        dashboardSummaryInFlightRef.current = null
      }
    })()

    dashboardSummaryInFlightRef.current = fetchPromise
    return fetchPromise
  }, [])

  // Schedules a debounced summary refetch after a successful mutation.
  // Calls within `DASHBOARD_SUMMARY_REFRESH_DEBOUNCE_MS` collapse to a
  // single fetch. ADR-020 §D6: mandatory wire for the 15 mutation
  // surfaces. Mock mode is a no-op (no endpoint to invalidate).
  //
  // The debouncer is lazily instantiated on first call so we can hand
  // it the live `refreshDashboardSummary` closure. The shared instance
  // lives for the life of the provider so multiple mutations across
  // the 15 surfaces collapse into one timer.
  const scheduleDashboardSummaryRefetch = useCallback(() => {
    if (authModeRef.current !== 'supabase') {
      return
    }

    if (dashboardSummaryDebouncerRef.current === null) {
      dashboardSummaryDebouncerRef.current = createDashboardSummaryDebouncer({
        onTrigger: () => {
          void refreshDashboardSummary({ force: true })
        },
      })
    }

    dashboardSummaryDebouncerRef.current.schedule()
  }, [refreshDashboardSummary])

  // Clear any pending debounce timer on unmount so a late mutation echo
  // does not fire a fetch against a torn-down provider.
  useEffect(() => () => {
    dashboardSummaryDebouncerRef.current?.cancel()
  }, [])

  useEffect(() => {
    let isActive = true
    const authModeChanged = prevAuthModeRef.current !== authMode
    prevAuthModeRef.current = authMode

    if (authMode !== 'supabase') {
      if (authModeChanged) startTransition(() => {
        setLeads(mockLeads)
        setLeadsPagination(buildMockLeadsPagination(mockLeads.length))
        setProjects(mockProjects)
        setPersistedProjects([])
        setTasks(mockTasks)
        setPersistedTasks([])
        setSettingsUsers(mockUsers.map(mapMockUserToSettingsUser))
        setIsSettingsUsersLoading(false)
        setSettingsUsersError(null)
        setDeliveryUsers(
          mockUsers
            .filter((currentUser) => ['admin', 'pm', 'developer'].includes(currentUser.role))
            .map(mapMockUserToDeliveryUser)
        )
        setLeadActivityByLeadId(buildInitialMockLeadActivity(mockLeads))
        setLeadProposalsByLeadId({})
        setTaskActivityByTaskId({})
        setIsLeadsLoading(false)
        setIsProjectsLoading(false)
        setIsTasksLoading(false)
        setDashboardSummary(null)
        setIsDashboardSummaryLoading(false)
        setDashboardSummaryError(null)
        dashboardSummaryFetchedAtRef.current = null
      })
      return () => {
        isActive = false
      }
    }

    // Supabase mode (post-R3 chunk 2): the provider no longer eager-loads
    // leads/projects/tasks. Each list page lazy-loads its own slice via
    // `setLeadsPage(1)` / `refreshProjects()` / `refreshTasks()` on
    // mount. The dashboard home consumes `useDashboardSummary()` which
    // fetches the server-aggregated KPI payload below. See ADR-020 §D8.
    if (authModeChanged) startTransition(() => {
      setLeads([])
      setLeadsPagination(null)
      setIsLeadsLoading(false)
      setProjects(mockProjects)
      setPersistedProjects([])
      setIsProjectsLoading(false)
      setTasks(mockTasks)
      setPersistedTasks([])
      setIsTasksLoading(false)
      setSettingsUsers([])
      setIsSettingsUsersLoading(false)
      setSettingsUsersError(null)
      setDeliveryUsers([])
      setLeadActivityByLeadId({})
      setLeadProposalsByLeadId({})
      setTaskActivityByTaskId({})
      setDashboardSummary(null)
      setIsDashboardSummaryLoading(false)
      setDashboardSummaryError(null)
      dashboardSummaryFetchedAtRef.current = null
    })

    // The summary endpoint is the only request fired at provider mount
    // in supabase mode. It returns role-scoped, server-aggregated KPIs
    // that the dashboard home renders without needing the full lists.
    void refreshDashboardSummary({ force: true })

    // `loadDeliveryUsers` stays eager because it powers lead /
    // project / task assignment dropdowns across multiple consumers
    // (lead-detail, project-form-dialog, task-form-dialog). It is
    // bounded reference data and explicitly out of R3 scope.
    if (user && ['admin', 'sales_manager', 'pm', 'developer'].includes(user.role)) {
      Promise.resolve()
        .then(loadDeliveryUsers)
        .catch(() => {
          if (isActive) {
            setDeliveryUsers([])
          }
        })
    }

    // `loadSettingsUsers` stays eager for the admin role because the
    // sidebar and settings page both consume it. Also bounded reference
    // data and explicitly out of R3 scope.
    if (user?.role === 'admin') {
      startTransition(() => {
        setIsSettingsUsersLoading(true)
        setSettingsUsersError(null)
      })

      Promise.resolve()
        .then(loadSettingsUsers)
        .then((nextSettingsUsers) => {
          if (isActive) {
            setSettingsUsers(nextSettingsUsers)
          }
        })
        .catch((error) => {
          if (isActive) {
            setSettingsUsers([])
            setSettingsUsersError(
              error instanceof Error
                ? error.message
                : 'No se pudieron cargar los usuarios reales.'
            )
          }
        })
        .finally(() => {
          if (isActive) {
            setIsSettingsUsersLoading(false)
          }
        })
    }

    return () => {
      isActive = false
    }
  }, [authMode, loadDeliveryUsers, loadSettingsUsers, refreshDashboardSummary, user])

  const getLeadActivity = useCallback(async (leadId: string) => {
    if (authMode !== 'supabase') {
      return leadActivityByLeadIdRef.current[leadId] ?? []
    }

    const response = await fetch(`/api/leads/${leadId}/activity`, {
      method: 'GET',
      cache: 'no-store',
    })
    const payload = await readApiResponse<LeadActivityWire[]>(response)
    const activities = payload.map(deserializeLeadActivity)
    setLeadActivityByLeadId((prev) => ({
      ...prev,
      [leadId]: activities,
    }))
    return activities
  }, [authMode])

  const addLeadNote = useCallback(async (leadId: string, body: string) => {
    if (authMode !== 'supabase') {
      const activity = createMockLeadActivity(
        leadId,
        'note_added',
        user?.name ?? 'Usuario actual',
        new Date(),
        {
          actorId: user?.id,
          noteBody: body.trim(),
        }
      )

      setLeadActivityByLeadId((prev) => ({
        ...prev,
        [leadId]: [activity, ...(prev[leadId] ?? [])],
      }))

      return activity
    }

    const response = await fetch(`/api/leads/${leadId}/activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    })
    const payload = await readApiResponse<LeadActivityWire>(response)
    const activity = deserializeLeadActivity(payload)
    setLeadActivityByLeadId((prev) => ({
      ...prev,
      [leadId]: [activity, ...(prev[leadId] ?? [])],
    }))
    return activity
  }, [authMode, user])

  const getLeadProposals = useCallback(async (leadId: string) => {
    if (authMode !== 'supabase') {
      return leadProposalsByLeadIdRef.current[leadId] ?? []
    }

    const response = await fetch(`/api/leads/${leadId}/proposals`, {
      method: 'GET',
      cache: 'no-store',
    })
    const payload = await readApiResponse<LeadProposalWire[]>(response)
    const proposals = payload.map(deserializeLeadProposal)
    setLeadProposalsByLeadId((prev) => ({
      ...prev,
      [leadId]: proposals,
    }))
    return proposals
  }, [authMode])

  const addLeadProposal = useCallback(async (
    leadId: string,
    input: {
      title: string
      body: string
      amount: number
      currency?: string
      status?: ProposalStatus
      // Outbound proposals only. When provided, the proposal API uses this
      // value to persist a seller_fees row (potential state). For inbound
      // leads, callers pass undefined and no seller_fees row is created.
      // The API defaults missing values to 100 per backwards compatibility.
      sellerFeeAmount?: 100 | 300 | 500
      // Outbound proposals only (per ADR-013). The proposal API revalidates
      // `amount === computePricing(projectType, complexity, 'outbound',
      // sellerFeeAmount).activationFinal` and rejects mismatches with 422.
      // Required for outbound; undefined for inbound.
      projectType?: 'landing' | 'ecommerce' | 'webapp' | 'mobile' | 'saas_ai'
      complexity?: 'low' | 'medium' | 'high'
    }
  ) => {
    if (authMode !== 'supabase') {
      const proposal = createMockLeadProposal(leadId, {
        title: input.title,
        body: input.body,
        amount: input.amount,
        currency: input.currency ?? 'USD',
        status: input.status ?? 'draft',
      })

      setLeadProposalsByLeadId((prev) => ({
        ...prev,
        [leadId]: [proposal, ...(prev[leadId] ?? [])],
      }))

      const activity = createMockLeadActivity(leadId, 'proposal_created', user?.name ?? 'Usuario actual', new Date(), {
        actorId: user?.id,
        metadata: {
          proposalId: proposal.id,
          title: proposal.title,
          status: proposal.status,
        },
      })

      setLeadActivityByLeadId((prev) => ({
        ...prev,
        [leadId]: [activity, ...(prev[leadId] ?? [])],
      }))

      return proposal
    }

    const response = await fetch(`/api/leads/${leadId}/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        amount: input.amount,
        currency: input.currency ?? 'USD',
        status: input.status ?? 'draft',
        // Only sent when defined (i.e., outbound proposal with a resolved
        // amount). JSON.stringify drops undefined values automatically.
        sellerFeeAmount: input.sellerFeeAmount,
        projectType: input.projectType,
        complexity: input.complexity,
      }),
    })
    const payload = await readApiResponse<LeadProposalWire>(response)
    const proposal = deserializeLeadProposal(payload)
    setLeadProposalsByLeadId((prev) => ({
      ...prev,
      [leadId]: [proposal, ...(prev[leadId] ?? [])],
    }))
    if (leadActivityByLeadIdRef.current[leadId]) {
      void getLeadActivity(leadId)
    }
    scheduleDashboardSummaryRefetch()
    return proposal
  }, [authMode, getLeadActivity, scheduleDashboardSummaryRefetch, user])

  const updateLeadProposalStatus = useCallback(async (
    leadId: string,
    proposalId: string,
    status: ProposalStatus
  ) => {
    if (authMode !== 'supabase') {
      const currentProposal = (leadProposalsByLeadIdRef.current[leadId] ?? []).find(
        (proposal) => proposal.id === proposalId
      )

      if (!currentProposal) {
        throw new Error('Proposal not found.')
      }

      const now = new Date()
      const updatedProposal: LeadProposal = {
        ...currentProposal,
        status,
        updatedAt: now,
        sentAt: status === 'sent' ? currentProposal.sentAt ?? now : currentProposal.sentAt,
        acceptedAt:
          status === 'accepted' || status === 'handoff_ready'
            ? currentProposal.acceptedAt ?? now
            : currentProposal.acceptedAt,
        handoffReadyAt:
          status === 'handoff_ready'
            ? currentProposal.handoffReadyAt ?? now
            : currentProposal.handoffReadyAt,
      }

      setLeadProposalsByLeadId((prev) => ({
        ...prev,
        [leadId]: (prev[leadId] ?? []).map((proposal) =>
          proposal.id === proposalId ? updatedProposal : proposal
        ),
      }))

      const activity = createMockLeadActivity(leadId, 'proposal_status_changed', user?.name ?? 'Usuario actual', now, {
        actorId: user?.id,
        metadata: {
          proposalId,
          title: updatedProposal.title,
          fromStatus: currentProposal.status,
          toStatus: status,
        },
      })

      setLeadActivityByLeadId((prev) => ({
        ...prev,
        [leadId]: [activity, ...(prev[leadId] ?? [])],
      }))

      if (status === 'sent' || status === 'accepted' || status === 'handoff_ready') {
        setLeads((prev) =>
          prev.map((lead) =>
            lead.id === leadId
              ? {
                  ...lead,
                  status:
                    lead.status === 'new' || lead.status === 'contacted' || lead.status === 'qualified'
                      ? 'proposal'
                      : lead.status,
                  assignmentStatus: 'proposal_locked',
                  lockedByProposalId: proposalId,
                  lockedAt: lead.lockedAt ?? now,
                  releasedAt: undefined,
                  updatedAt: now,
                }
              : lead
          )
        )
      }

      return updatedProposal
    }

    const response = await fetch(`/api/leads/${leadId}/proposals/${proposalId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    })
    const payload = await readApiResponse<LeadProposalWire>(response)
    const updatedProposal = deserializeLeadProposal(payload)
    setLeadProposalsByLeadId((prev) => ({
      ...prev,
      [leadId]: (prev[leadId] ?? []).map((proposal) =>
        proposal.id === proposalId ? updatedProposal : proposal
      ),
    }))
    // Proposal status changes can demote/promote the parent lead via the
    // proposal_locked flow (see addLeadProposal docstring). The server
    // applies the lead-side change; the provider refreshes the current
    // leads page so any visible lead row reflects the new state.
    await loadLeads()
    if (leadActivityByLeadIdRef.current[leadId]) {
      void getLeadActivity(leadId)
    }
    scheduleDashboardSummaryRefetch()
    return updatedProposal
  }, [authMode, getLeadActivity, loadLeads, scheduleDashboardSummaryRefetch, user])

  const createProjectFromProposal = useCallback(async (leadId: string, proposalId: string) => {
    if (authMode !== 'supabase') {
      const existingProject = projects.find((project) => project.sourceProposalId === proposalId)

      if (existingProject) {
        return existingProject
      }

      const lead = leads.find((leadItem) => leadItem.id === leadId)
      const proposal = (leadProposalsByLeadIdRef.current[leadId] ?? []).find(
        (proposalItem) => proposalItem.id === proposalId
      )

      if (!lead) {
        throw new Error('Lead not found.')
      }

      if (!proposal) {
        throw new Error('Proposal not found.')
      }

      if (proposal.status !== 'handoff_ready') {
        throw new Error('Only handoff-ready proposals can be converted into projects.')
      }

      const project = createMockProjectFromProposal(lead, proposal)
      const now = new Date()
      const nextLeadStatus: LeadStatus = lead.status === 'won' ? lead.status : 'won'

      setProjects((prev) => mergeProjects(prev, [project]))
      setLeads((prev) =>
        prev.map((leadItem) =>
          leadItem.id === leadId
            ? { ...leadItem, status: nextLeadStatus, updatedAt: now }
            : leadItem
        )
      )

      const projectActivity = createMockLeadActivity(
        leadId,
        'project_created',
        user?.name ?? 'Usuario actual',
        now,
        {
          actorId: user?.id,
          metadata: {
            projectId: project.id,
            projectName: project.name,
            proposalId,
            projectStatus: project.status,
          },
        }
      )

      const statusActivity =
        lead.status === 'won'
          ? null
          : createMockLeadActivity(leadId, 'status_changed', user?.name ?? 'Usuario actual', now, {
              actorId: user?.id,
              metadata: {
                fromStatus: lead.status,
                toStatus: 'won',
              },
            })

      setLeadActivityByLeadId((prev) => ({
        ...prev,
        [leadId]: [
          ...(statusActivity ? [statusActivity] : []),
          projectActivity,
          ...(prev[leadId] ?? []),
        ],
      }))
      setLeadProposalsByLeadId((prev) => ({
        ...prev,
        [leadId]: (prev[leadId] ?? []).map((proposalItem) =>
          proposalItem.id === proposalId
            ? {
                ...proposalItem,
                linkedProject: {
                  id: project.id,
                  name: project.name,
                  status: project.status,
                  createdAt: project.createdAt,
                },
              }
            : proposalItem
        ),
      }))

      return project
    }

    const response = await fetch(`/api/leads/${leadId}/proposals/${proposalId}/project`, {
      method: 'POST',
    })
    const payload = await readApiResponse<ProjectWire>(response)
    const project = deserializeProject(payload)
    const now = new Date()

    setPersistedProjects((prev) => mergeProjects(prev, [project]))
    setProjects((prev) => mergeProjects(prev, [project]))
    setLeads((prev) =>
      prev.map((leadItem) =>
        leadItem.id === leadId
          ? {
              ...leadItem,
              status: 'won',
              updatedAt: now,
            }
          : leadItem
      )
    )

    void getLeadActivity(leadId)
    setLeadProposalsByLeadId((prev) => ({
      ...prev,
      [leadId]: (prev[leadId] ?? []).map((proposalItem) =>
        proposalItem.id === proposalId
          ? {
              ...proposalItem,
              linkedProject: {
                id: project.id,
                name: project.name,
                status: project.status,
                createdAt: project.createdAt,
              },
            }
          : proposalItem
      ),
    }))

    // Sets lead -> won AND creates a project; both inputs to the
    // sales-section and delivery-section KPIs need to be refreshed.
    scheduleDashboardSummaryRefetch()
    return project
  }, [authMode, getLeadActivity, leads, projects, scheduleDashboardSummaryRefetch, user])

  const releaseLeadAsNoResponse = useCallback(async (leadId: string) => {
    if (authMode !== 'supabase') {
      const currentLead = leads.find((lead) => lead.id === leadId)

      if (!currentLead) {
        throw new Error('Lead not found.')
      }

      if (currentLead.assignmentStatus !== 'proposal_locked') {
        throw new Error('Only proposal-locked leads can be released as no response.')
      }

      const now = new Date()
      const updatedLead: Lead = {
        ...currentLead,
        assignedTo: undefined,
        assignmentStatus: 'released_no_response',
        lockedByProposalId: undefined,
        lockedAt: undefined,
        releasedAt: now,
        updatedAt: now,
      }

      replaceLead(updatedLead)
      setLeadActivityByLeadId((prev) => ({
        ...prev,
        [leadId]: [
          createMockLeadActivity(
            leadId,
            'released_no_response',
            user?.name ?? 'Usuario actual',
            now,
            {
              actorId: user?.id,
              metadata: {
                fromAssignmentStatus: currentLead.assignmentStatus,
                toAssignmentStatus: 'released_no_response',
              },
            }
          ),
          ...(prev[leadId] ?? []),
        ],
      }))
      return updatedLead
    }

    const response = await fetch(`/api/leads/${leadId}/release`, {
      method: 'POST',
    })
    const payload = await readApiResponse<LeadWire>(response)
    const updatedLead = deserializeLead(payload)
    replaceLead(updatedLead)
    if (leadActivityByLeadIdRef.current[leadId]) {
      void getLeadActivity(leadId)
    }
    scheduleDashboardSummaryRefetch()
    return updatedLead
  }, [authMode, getLeadActivity, leads, replaceLead, scheduleDashboardSummaryRefetch, user])

  const claimLead = useCallback(async (leadId: string) => {
    if (authMode !== 'supabase') {
      const currentLead = leads.find((lead) => lead.id === leadId)

      if (!currentLead) {
        throw new Error('Lead not found.')
      }

      if (currentLead.assignmentStatus !== 'released_no_response') {
        throw new Error('Only released leads can be claimed.')
      }

      const now = new Date()
      const updatedLead: Lead = {
        ...currentLead,
        assignedTo: user?.id,
        assignmentStatus: 'owned',
        lockedByProposalId: undefined,
        lockedAt: undefined,
        releasedAt: undefined,
        updatedAt: now,
      }

      replaceLead(updatedLead)
      setLeadActivityByLeadId((prev) => ({
        ...prev,
        [leadId]: [
          createMockLeadActivity(
            leadId,
            'claimed',
            user?.name ?? 'Usuario actual',
            now,
            {
              actorId: user?.id,
              metadata: {
                fromAssignmentStatus: currentLead.assignmentStatus,
                toAssignmentStatus: 'owned',
              },
            }
          ),
          ...(prev[leadId] ?? []),
        ],
      }))
      return updatedLead
    }

    const response = await fetch(`/api/leads/${leadId}/claim`, {
      method: 'POST',
    })
    const payload = await readApiResponse<LeadWire>(response)
    const updatedLead = deserializeLead(payload)
    replaceLead(updatedLead)
    if (leadActivityByLeadIdRef.current[leadId]) {
      void getLeadActivity(leadId)
    }
    scheduleDashboardSummaryRefetch()
    return updatedLead
  }, [authMode, getLeadActivity, leads, replaceLead, scheduleDashboardSummaryRefetch, user])

  // Lead operations
  const addLead = useCallback(async (leadData: LeadDraft) => {
    if (authMode !== 'supabase') {
      const newLead: Lead = {
        ...leadData,
        source: normalizeLeadSource(leadData.source),
        assignmentStatus: 'owned',
        id: `lead-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      setLeads((prev) => [newLead, ...prev])
      setLeadsPagination((prev) => {
        // Mock-mode meta stays a single page covering every mock lead.
        const nextTotal = (prev?.total ?? 0) + 1
        return buildMockLeadsPagination(nextTotal)
      })
      setLeadActivityByLeadId((prev) => ({
        ...prev,
        [newLead.id]: [
          createMockLeadActivity(newLead.id, 'created', user?.name ?? 'Usuario actual', newLead.createdAt, {
            actorId: user?.id,
            metadata: { status: newLead.status },
          }),
        ],
      }))
      return newLead
    }

    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mapLeadDraftToRequest(leadData)),
    })
    const payload = await readApiResponse<LeadWire>(response)
    const createdLead = deserializeLead(payload)
    setLeads((prev) => [createdLead, ...prev])
    setLeadsPagination((prev) => {
      if (!prev) return prev
      const nextTotal = prev.total + 1
      return {
        ...prev,
        total: nextTotal,
        pageCount: nextTotal === 0 ? 0 : Math.ceil(nextTotal / prev.limit),
      }
    })
    scheduleDashboardSummaryRefetch()
    return createdLead
  }, [authMode, scheduleDashboardSummaryRefetch, user])

  const updateLead = useCallback(async (id: string, updates: LeadUpdates) => {
    if (authMode !== 'supabase') {
      const currentLead = leads.find((lead) => lead.id === id)

      if (!currentLead) {
        throw new Error('Lead not found.')
      }

      let updatedLead: Lead | null = null

      setLeads((prev) =>
        prev.map((lead) => {
          if (lead.id !== id) {
            return lead
          }

          const nextLead: Lead = {
            ...lead,
            ...updates,
            source: updates.source ? normalizeLeadSource(updates.source) : lead.source,
            nextFollowUpAt:
              updates.nextFollowUpAt === null
                ? undefined
                : updates.nextFollowUpAt ?? lead.nextFollowUpAt,
            updatedAt: new Date(),
          }

          updatedLead = nextLead
          return nextLead
        })
      )

      const changedFields = Object.keys(updates).filter((field) => {
        if (field === 'status') {
          return false
        }

        const typedField = field as keyof LeadUpdates
        return updates[typedField] !== undefined
      })

      if (updates.status !== undefined && updates.status !== currentLead.status) {
        const statusActivity = createMockLeadActivity(id, 'status_changed', user?.name ?? 'Usuario actual', new Date(), {
          actorId: user?.id,
          metadata: {
            fromStatus: currentLead.status,
            toStatus: updates.status,
          },
        })

        setLeadActivityByLeadId((prev) => ({
          ...prev,
          [id]: [statusActivity, ...(prev[id] ?? [])],
        }))
      }

      if (changedFields.length > 0) {
        const updateActivity = createMockLeadActivity(id, 'updated', user?.name ?? 'Usuario actual', new Date(), {
          actorId: user?.id,
          metadata: {
            changedFields,
          },
        })

        setLeadActivityByLeadId((prev) => ({
          ...prev,
          [id]: [updateActivity, ...(prev[id] ?? [])],
        }))
      }

      if (!updatedLead) {
        throw new Error('Lead not found.')
      }

      return updatedLead
    }

    const response = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mapLeadUpdatesToRequest(updates)),
    })
    const payload = await readApiResponse<LeadWire>(response)
    const updatedLead = deserializeLead(payload)
    setLeads((prev) => prev.map((lead) => (lead.id === id ? updatedLead : lead)))
    if (leadActivityByLeadIdRef.current[id]) {
      void getLeadActivity(id)
    }
    // ADR-020 §D6 extension: invalidate on every successful update
    // regardless of which fields changed. status/value/nextFollowUpAt all
    // feed the summary, and the operator brief explicitly chose "simple
    // > clever" — refetch unconditionally rather than diffing here.
    scheduleDashboardSummaryRefetch()
    return updatedLead
  }, [authMode, getLeadActivity, leads, scheduleDashboardSummaryRefetch, user])

  const deleteLead = useCallback(async (id: string) => {
    if (authMode !== 'supabase') {
      setLeads((prev) => prev.filter((lead) => lead.id !== id))
      setLeadsPagination((prev) => {
        const nextTotal = Math.max(0, (prev?.total ?? 0) - 1)
        return buildMockLeadsPagination(nextTotal)
      })
      setLeadActivityByLeadId((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setLeadProposalsByLeadId((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }

    const response = await fetch(`/api/leads/${id}`, {
      method: 'DELETE',
    })
    await readApiResponse<{ ok: boolean }>(response)
    setLeads((prev) => prev.filter((lead) => lead.id !== id))
    // Optimistic meta: decrement total and recompute pageCount. If the
    // current page becomes empty (e.g., deleting the last lead on page N),
    // navigate back one page on the next render.
    let shouldStepBack: { targetPage: number } | null = null
    setLeadsPagination((prev) => {
      if (!prev) return prev
      const nextTotal = Math.max(0, prev.total - 1)
      const nextPageCount = nextTotal === 0 ? 0 : Math.ceil(nextTotal / prev.limit)
      if (nextPageCount > 0 && prev.page > nextPageCount) {
        shouldStepBack = { targetPage: Math.max(1, nextPageCount) }
      }
      return {
        ...prev,
        total: nextTotal,
        pageCount: nextPageCount,
      }
    })
    setLeadActivityByLeadId((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setLeadProposalsByLeadId((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (shouldStepBack) {
      // Refetch the previous page; ignore in-flight guard since the user-
      // initiated mutation has already completed.
      const targetPage = (shouldStepBack as { targetPage: number }).targetPage
      setIsLeadsLoading(true)
      try {
        await loadLeads(targetPage)
      } catch {
        // Leave state; user can retry via next refresh.
      } finally {
        setIsLeadsLoading(false)
      }
    }
    scheduleDashboardSummaryRefetch()
  }, [authMode, loadLeads, scheduleDashboardSummaryRefetch])

  const updateLeadStatus = useCallback(async (id: string, status: LeadStatus) => {
    if (authMode !== 'supabase') {
      const currentLead = leads.find((lead) => lead.id === id)

      if (!currentLead) {
        throw new Error('Lead not found.')
      }

      let updatedLead: Lead | null = null

      setLeads((prev) =>
        prev.map((lead) => {
          if (lead.id !== id) {
            return lead
          }

          const nextLead: Lead = { ...lead, status, updatedAt: new Date() }
          updatedLead = nextLead
          return nextLead
        })
      )

      if (status !== currentLead.status) {
        const activity = createMockLeadActivity(id, 'status_changed', user?.name ?? 'Usuario actual', new Date(), {
          actorId: user?.id,
          metadata: {
            fromStatus: currentLead.status,
            toStatus: status,
          },
        })

        setLeadActivityByLeadId((prev) => ({
          ...prev,
          [id]: [activity, ...(prev[id] ?? [])],
        }))
      }

      if (!updatedLead) {
        throw new Error('Lead not found.')
      }

      return updatedLead
    }

    const response = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    })
    const payload = await readApiResponse<LeadWire>(response)
    const updatedLead = deserializeLead(payload)
    setLeads((prev) => prev.map((lead) => (lead.id === id ? updatedLead : lead)))
    if (leadActivityByLeadIdRef.current[id]) {
      void getLeadActivity(id)
    }
    scheduleDashboardSummaryRefetch()
    return updatedLead
  }, [authMode, getLeadActivity, leads, scheduleDashboardSummaryRefetch, user])

  // Project operations
  const addProject = useCallback((projectData: ProjectDraft) => {
    const newProject: Project = {
      ...projectData,
      id: `project-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    setProjects((prev) => [newProject, ...prev])
    return newProject
  }, [])

  const updateProject = useCallback(async (id: string, updates: ProjectUpdates) => {
    if (authMode === 'supabase' && isUuid(id)) {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mapProjectUpdatesToRequest(updates)),
      })
      const payload = await readApiResponse<ProjectWire>(response)
      const updatedProject = deserializeProject(payload)

      setPersistedProjects((prev) =>
        prev.map((project) => (project.id === id ? updatedProject : project))
      )
      setProjects((prev) =>
        prev.map((project) => (project.id === id ? updatedProject : project))
      )

      // Project status changes feed delivery counters (activeProjects /
      // projectsInReview / completedProjects) via deriveProjectDisplayStatus.
      scheduleDashboardSummaryRefetch()
      return updatedProject
    }

    let updatedProject: Project | null = null

    setProjects((prev) =>
      prev.map((project) =>
        project.id === id
          ? (updatedProject = {
              ...project,
              ...updates,
              description:
                updates.description === null
                  ? undefined
                  : updates.description ?? project.description,
              clientId: updates.clientId ?? project.clientId,
              pmId: updates.pmId === null ? undefined : updates.pmId ?? project.pmId,
              pmName:
                updates.pmId === null
                  ? undefined
                  : updates.pmName ?? project.pmName,
              startDate:
                updates.startDate === null
                  ? undefined
                  : updates.startDate ?? project.startDate,
              endDate:
                updates.endDate === null
                  ? undefined
                  : updates.endDate ?? project.endDate,
              updatedAt: new Date(),
            })
          : project
      )
    )

    if (!updatedProject) {
      throw new Error('Project not found.')
    }

    return updatedProject
  }, [authMode, scheduleDashboardSummaryRefetch])

  const deleteProject = useCallback((id: string) => {
    setPersistedProjects((prev) => prev.filter((project) => project.id !== id))
    setProjects((prev) => prev.filter((project) => project.id !== id))
    setTasks((prev) => prev.filter((task) => task.projectId !== id))
  }, [])

  const updateProjectStatus = useCallback((id: string, status: ProjectStatus) => {
    return updateProject(id, { status })
  }, [updateProject])

  const refreshProjects = useCallback(async () => {
    if (authMode !== 'supabase') {
      return
    }

    setIsProjectsLoading(true)
    try {
      await loadProjects()
    } catch {
      // Loader-level error: leave existing state untouched. The page can
      // observe the empty list and retry on next mount / explicit action.
    } finally {
      setIsProjectsLoading(false)
    }
  }, [authMode, loadProjects])

  const refreshTasks = useCallback(async () => {
    if (authMode !== 'supabase') {
      return
    }

    setIsTasksLoading(true)
    try {
      await loadTasks()
    } catch {
      // Loader-level error: leave existing state untouched (see
      // `refreshProjects` reasoning).
    } finally {
      setIsTasksLoading(false)
    }
  }, [authMode, loadTasks])

  // Task operations
  const addTask = useCallback(async (taskData: TaskDraft) => {
    const normalizedTask = normalizeTaskAssignment(taskData)

    if (authMode === 'supabase' && isUuid(taskData.projectId)) {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: taskData.projectId,
          title: taskData.title,
          description: taskData.description ?? null,
          status: taskData.status,
          priority: taskData.priority,
          assignedTo: normalizedTask.assignedTo ?? null,
          dueDate: taskData.dueDate?.toISOString().slice(0, 10) ?? null,
          estimatedHours: taskData.estimatedHours ?? null,
          actualHours: taskData.actualHours ?? null,
        }),
      })
      const payload = await readApiResponse<TaskWire>(response)
      const createdTask = deserializeTask(payload)
      setPersistedTasks((prev) => mergeTasks(prev, [createdTask]))
      setTasks((prev) => mergeTasks(prev, [createdTask]))
      // Adding a task feeds delivery counters: pendingTasks +
      // actionableTasks bump by 1. Also feeds project display status
      // (deriveProjectDisplayStatus depends on the task fanout).
      scheduleDashboardSummaryRefetch()
      return createdTask
    }

    const newTask: Task = {
      projectId: taskData.projectId,
      title: taskData.title,
      description: taskData.description,
      status: taskData.status,
      priority: taskData.priority,
      ...normalizedTask,
      dueDate: taskData.dueDate,
      estimatedHours: taskData.estimatedHours,
      actualHours: taskData.actualHours,
      id: `task-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    setTasks((prev) => [newTask, ...prev])
    return newTask
  }, [authMode, scheduleDashboardSummaryRefetch])

  const updateTask = useCallback(async (id: string, updates: TaskUpdates) => {
    const normalizedAssignment = normalizeTaskAssignment(updates)

    if (authMode === 'supabase' && isUuid(id)) {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: updates.title,
          description: updates.description ?? undefined,
          status: updates.status,
          priority: updates.priority,
          assignedTo:
            updates.assignedTo !== undefined || updates.assigneeId !== undefined
              ? normalizedAssignment.assignedTo ?? null
              : undefined,
          dueDate:
            updates.dueDate !== undefined
              ? updates.dueDate?.toISOString().slice(0, 10) ?? null
              : undefined,
          estimatedHours: updates.estimatedHours,
          actualHours: updates.actualHours,
        }),
      })
      const payload = await readApiResponse<TaskWire>(response)
      const updatedTask = deserializeTask(payload)

      setPersistedTasks((prev) =>
        prev.map((task) => (task.id === id ? updatedTask : task))
      )
      setTasks((prev) =>
        prev.map((task) => (task.id === id ? updatedTask : task))
      )

      // Task updates may flip status (pendingTasks / inProgressTasks /
      // reviewTasks all rebalance) and indirectly change project display
      // status. Refetch unconditionally; the debounce coalesces rapid
      // edits from the same form save.
      scheduleDashboardSummaryRefetch()
      return updatedTask
    }

    let updatedTask: Task | null = null
    setTasks((prev) =>
      prev.map((task) =>
        task.id === id
          ? (updatedTask = {
              ...task,
              projectId: updates.projectId ?? task.projectId,
              title: updates.title ?? task.title,
              status: updates.status ?? task.status,
              priority: updates.priority ?? task.priority,
              description: updates.description ?? task.description,
              dueDate: updates.dueDate ?? task.dueDate,
              estimatedHours: updates.estimatedHours ?? task.estimatedHours,
              actualHours: updates.actualHours ?? task.actualHours,
              assignedTo: normalizedAssignment.assignedTo ?? task.assignedTo,
              assignedToName: normalizedAssignment.assignedToName ?? task.assignedToName,
              updatedAt: new Date(),
            })
          : task
      )
    )

    if (!updatedTask) {
      throw new Error('Task not found.')
    }

    return updatedTask
  }, [authMode, scheduleDashboardSummaryRefetch])

  const deleteTask = useCallback((id: string) => {
    setPersistedTasks((prev) => prev.filter((task) => task.id !== id))
    setTasks((prev) => prev.filter((task) => task.id !== id))
  }, [])

  const updateTaskStatus = useCallback(async (id: string, status: TaskStatus) => {
    if (authMode === 'supabase' && isUuid(id)) {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      })
      const payload = await readApiResponse<TaskWire>(response)
      const updatedTask = deserializeTask(payload)

      setPersistedTasks((prev) =>
        prev.map((task) => (task.id === id ? updatedTask : task))
      )
      setTasks((prev) =>
        prev.map((task) => (task.id === id ? updatedTask : task))
      )

      scheduleDashboardSummaryRefetch()
      return updatedTask
    }

    let updatedTask: Task | null = null
    setTasks((prev) =>
      prev.map((task) =>
        task.id === id
          ? (updatedTask = { ...task, status, updatedAt: new Date() })
          : task
      )
    )

    if (!updatedTask) {
      throw new Error('Task not found.')
    }

    return updatedTask
  }, [authMode, scheduleDashboardSummaryRefetch])

  const getTasksByProject = useCallback(
    (projectId: string) => {
      return tasks.filter((task) => task.projectId === projectId)
    },
    [tasks]
  )

  const getTaskActivity = useCallback(async (taskId: string) => {
    if (authMode !== 'supabase' || !isUuid(taskId)) {
      return taskActivityByTaskIdRef.current[taskId] ?? []
    }

    const response = await fetch(`/api/tasks/${taskId}/activity`, {
      method: 'GET',
      cache: 'no-store',
    })
    const payload = await readApiResponse<TaskActivityWire[]>(response)
    const activities = payload.map(deserializeTaskActivity)
    setTaskActivityByTaskId((prev) => ({
      ...prev,
      [taskId]: activities,
    }))
    return activities
  }, [authMode])

  const getProjectActivity = useCallback(async (projectId: string) => {
    if (authMode === 'supabase' && isUuid(projectId)) {
      const response = await fetch(`/api/projects/${projectId}/activity`, {
        method: 'GET',
        cache: 'no-store',
      })
      const payload = await readApiResponse<ProjectVisibleActivityWire[]>(response)
      return payload.map(deserializeProjectVisibleActivity)
    }

    const projectTasks = tasks.filter((task) => task.projectId === projectId)

    if (projectTasks.length === 0) {
      return []
    }

    const projectActivities = await Promise.all(
      projectTasks.map(async (task) => {
        const activities = await getTaskActivity(task.id)

        return activities.map<ProjectTaskActivity>((activity) => ({
          id: activity.id,
          sourceKind: 'task_activity',
          projectId,
          taskId: task.id,
          taskTitle: task.title,
          type: activity.type,
          actorId: activity.actorId,
          actorName: activity.actorName,
          noteBody: activity.noteBody,
          metadata: activity.metadata,
          createdAt: activity.createdAt,
        }))
      })
    )

    return projectActivities
      .flat()
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
  }, [authMode, getTaskActivity, tasks])

  const addTaskNote = useCallback(async (taskId: string, body: string) => {
    if (authMode !== 'supabase' || !isUuid(taskId)) {
      const activity = createMockTaskActivity(taskId, user?.name ?? 'Usuario actual', new Date(), {
        actorId: user?.id,
        noteBody: body.trim(),
      })

      setTaskActivityByTaskId((prev) => ({
        ...prev,
        [taskId]: [activity, ...(prev[taskId] ?? [])],
      }))

      return activity
    }

    const response = await fetch(`/api/tasks/${taskId}/activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    })
    const payload = await readApiResponse<TaskActivityWire>(response)
    const activity = deserializeTaskActivity(payload)
    setTaskActivityByTaskId((prev) => ({
      ...prev,
      [taskId]: [activity, ...(prev[taskId] ?? [])],
    }))
    return activity
  }, [authMode, user])

  // User operations
  const getUserById = useCallback(
    (id: string) => {
      return users.find((u) => u.id === id)
    },
    [users]
  )

  // Points operations
  const addPoints = useCallback((userId: string, points: number, reason: string) => {
    setUserPoints((prev) => ({
      ...prev,
      [userId]: (prev[userId] || 0) + points,
    }))
    setPointsHistory((prev) => [
      {
        id: `tx-${Date.now()}`,
        userId,
        points,
        type: 'earned',
        reason,
        timestamp: new Date(),
      },
      ...prev,
    ])
  }, [])

  const deductPoints = useCallback(
    (userId: string, points: number, reason: string) => {
      const currentPoints = userPoints[userId] || 0
      if (currentPoints < points) return false

      setUserPoints((prev) => ({
        ...prev,
        [userId]: prev[userId] - points,
      }))
      setPointsHistory((prev) => [
        {
          id: `tx-${Date.now()}`,
          userId,
          points,
          type: 'redeemed',
          reason,
          timestamp: new Date(),
        },
        ...prev,
      ])
      return true
    },
    [userPoints]
  )

  const getPointsHistory = useCallback(
    (userId: string) => {
      return pointsHistory.filter((tx) => tx.userId === userId)
    },
    [pointsHistory]
  )

  // Rewards
  const redeemReward = useCallback(
    (rewardId: string, userId: string) => {
      const reward = rewards.find((r) => r.id === rewardId)
      if (!reward || !reward.available) return false

      const success = deductPoints(userId, reward.pointsCost, `Canje: ${reward.name}`)
      return success
    },
    [rewards, deductPoints]
  )

  // In Supabase mode, delivery workspaces should reflect only persisted project/task truth.
  const usePersistedDeliveryBoards = authMode === 'supabase'
  const projectBoardProjects = usePersistedDeliveryBoards ? persistedProjects : projects
  const taskBoardTasks = usePersistedDeliveryBoards ? persistedTasks : tasks

  return (
    <DataContext.Provider
      value={{
        isLeadsLoading,
        leads,
        leadsPagination,
        setLeadsPage,
        refreshLeads,
        addLead,
        updateLead,
        deleteLead,
        updateLeadStatus,
        claimLead,
        releaseLeadAsNoResponse,
        getLeadActivity,
        addLeadNote,
        getLeadProposals,
        addLeadProposal,
        updateLeadProposalStatus,
        createProjectFromProposal,
        projects,
        persistedProjects,
        projectBoardProjects,
        isProjectsLoading,
        addProject,
        updateProject,
        deleteProject,
        updateProjectStatus,
        refreshProjects,
        tasks,
        persistedTasks,
        taskBoardTasks,
        isTasksLoading,
        addTask,
        updateTask,
        deleteTask,
        updateTaskStatus,
        refreshTasks,
        getTasksByProject,
        getTaskActivity,
        getProjectActivity,
        addTaskNote,
        rewards,
        redeemReward,
        isSettingsUsersLoading,
        settingsUsers,
        settingsUsersError,
        refreshSettingsUsers,
        deliveryUsers,
        users,
        getUserById,
        userPoints,
        addPoints,
        deductPoints,
        getPointsHistory,
        dashboardSummary,
        isDashboardSummaryLoading,
        dashboardSummaryError,
        refreshDashboardSummary,
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  const context = useContext(DataContext)
  if (!context) {
    throw new Error('useData must be used within a DataProvider')
  }
  return context
}

/**
 * Consumer hook for the dashboard summary KPI payload (supabase mode).
 *
 * Returns:
 * - `data`: the wire-shape `DashboardSummaryResponse` once loaded; `null`
 *   while the initial fetch is in flight or in mock mode.
 * - `isLoading`: `true` between fetch start and resolution. Stays `false`
 *   during SWR-cached reads (the consumer keeps showing the previous
 *   payload while a background refetch runs).
 * - `error`: the most recent fetch error; the cached payload is
 *   preserved so the UI can show a soft error affordance without losing
 *   its last-good read.
 * - `refresh`: forces a refetch bypassing the 60s TTL. Consumers call
 *   this on user-initiated retry; mutation invalidation is wired by the
 *   provider itself via `scheduleDashboardSummaryRefetch`.
 *
 * See ADR-020 §D5 (TTL), §D6 (invalidation), §D7 (hook location).
 */
export function useDashboardSummary(): UseDashboardSummaryResult {
  const {
    dashboardSummary,
    isDashboardSummaryLoading,
    dashboardSummaryError,
    refreshDashboardSummary,
  } = useData()

  const refresh = useCallback(async () => {
    await refreshDashboardSummary({ force: true })
  }, [refreshDashboardSummary])

  return {
    data: dashboardSummary,
    isLoading: isDashboardSummaryLoading,
    error: dashboardSummaryError,
    refresh,
  }
}
