'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
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

interface DataContextType {
  // Leads
  isLeadsLoading: boolean
  leads: Lead[]
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
  }) => Promise<LeadProposal>
  updateLeadProposalStatus: (leadId: string, proposalId: string, status: ProposalStatus) => Promise<LeadProposal>
  createProjectFromProposal: (leadId: string, proposalId: string) => Promise<Project>

  // Projects
  projects: Project[]
  persistedProjects: Project[]
  projectBoardProjects: Project[]
  addProject: (project: ProjectDraft) => Project
  updateProject: (id: string, updates: ProjectUpdates) => Promise<Project> | void
  deleteProject: (id: string) => void
  updateProjectStatus: (id: string, status: ProjectStatus) => Promise<Project> | void
  refreshProjects: () => Promise<void>

  // Tasks
  tasks: Task[]
  persistedTasks: Task[]
  taskBoardTasks: Task[]
  addTask: (task: TaskDraft) => Promise<Task> | Task
  updateTask: (id: string, updates: TaskUpdates) => Promise<Task> | void
  deleteTask: (id: string) => void
  updateTaskStatus: (id: string, status: TaskStatus) => Promise<Task> | void
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
    createdAt: now,
    updatedAt: now,
    sentAt: input.status === 'sent' ? now : undefined,
    acceptedAt: input.status === 'accepted' || input.status === 'handoff_ready' ? now : undefined,
    handoffReadyAt: input.status === 'handoff_ready' ? now : undefined,
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
    email: leadData.email,
    phone: leadData.phone ?? null,
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
  }
}

function mapLeadUpdatesToRequest(updates: LeadUpdates) {
  const payload: Record<string, unknown> = {}

  if (updates.name !== undefined) payload.name = updates.name
  if (updates.email !== undefined) payload.email = updates.email
  if (updates.phone !== undefined) payload.phone = updates.phone ?? null
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
  const [isLeadsLoading, setIsLeadsLoading] = useState(authMode === 'supabase')
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

  useEffect(() => {
    leadActivityByLeadIdRef.current = leadActivityByLeadId
  }, [leadActivityByLeadId])

  useEffect(() => {
    leadProposalsByLeadIdRef.current = leadProposalsByLeadId
  }, [leadProposalsByLeadId])

  useEffect(() => {
    taskActivityByTaskIdRef.current = taskActivityByTaskId
  }, [taskActivityByTaskId])

  const loadLeads = useCallback(async () => {
    const response = await fetch('/api/leads', {
      method: 'GET',
      cache: 'no-store',
    })
    const payload = await readApiResponse<LeadWire[]>(response)
    setLeads(payload.map(deserializeLead))
  }, [])

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

  useEffect(() => {
    let isActive = true

    if (authMode !== 'supabase') {
      setLeads(mockLeads)
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
      return () => {
        isActive = false
      }
    }

    setIsLeadsLoading(true)
    setProjects(mockProjects)
    setPersistedProjects([])
    setTasks(mockTasks)
    setPersistedTasks([])
    setSettingsUsers([])
    setIsSettingsUsersLoading(false)
    setSettingsUsersError(null)
    setDeliveryUsers([])
    setLeadActivityByLeadId({})
    setLeadProposalsByLeadId({})
    setTaskActivityByTaskId({})

    loadLeads()
      .catch(() => {
        if (isActive) {
          setLeads([])
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLeadsLoading(false)
        }
      })

    loadProjects()
      .catch(() => {
        if (isActive) {
          setPersistedProjects([])
          setProjects(mockProjects)
        }
      })

    loadTasks()
      .catch(() => {
        if (isActive) {
          setPersistedTasks([])
          setTasks(mockTasks)
        }
      })

    if (user && ['admin', 'sales_manager', 'pm', 'developer'].includes(user.role)) {
      loadDeliveryUsers()
        .catch(() => {
          if (isActive) {
            setDeliveryUsers([])
          }
        })
    }

    if (user?.role === 'admin') {
      setIsSettingsUsersLoading(true)
      setSettingsUsersError(null)

      loadSettingsUsers()
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
  }, [authMode, loadDeliveryUsers, loadLeads, loadProjects, loadSettingsUsers, loadTasks, user])

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
    return proposal
  }, [authMode, getLeadActivity, user])

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
    await loadLeads()
    if (leadActivityByLeadIdRef.current[leadId]) {
      void getLeadActivity(leadId)
    }
    return updatedProposal
  }, [authMode, getLeadActivity, loadLeads, user])

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

    return project
  }, [authMode, getLeadActivity, leads, projects, user])

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
    return updatedLead
  }, [authMode, getLeadActivity, leads, replaceLead, user])

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
    return updatedLead
  }, [authMode, getLeadActivity, leads, replaceLead, user])

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
    return createdLead
  }, [authMode, user])

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
    return updatedLead
  }, [authMode, getLeadActivity, leads, user])

  const deleteLead = useCallback(async (id: string) => {
    if (authMode !== 'supabase') {
      setLeads((prev) => prev.filter((lead) => lead.id !== id))
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
  }, [authMode])

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
    return updatedLead
  }, [authMode, getLeadActivity, leads, user])

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
  }, [authMode])

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

    await loadProjects()
  }, [authMode, loadProjects])

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
  }, [authMode])

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
  }, [authMode])

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
  }, [authMode])

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
  }, [getTaskActivity, tasks])

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
        addProject,
        updateProject,
        deleteProject,
        updateProjectStatus,
        refreshProjects,
        tasks,
        persistedTasks,
        taskBoardTasks,
        addTask,
        updateTask,
        deleteTask,
        updateTaskStatus,
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
