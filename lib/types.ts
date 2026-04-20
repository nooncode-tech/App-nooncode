// User and Auth Types
export type UserRole = 'admin' | 'sales_manager' | 'sales' | 'pm' | 'developer'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  avatar?: string
  createdAt: Date
  points: number
  balance: number
}

export type DeliveryDirectoryRole = Extract<UserRole, 'admin' | 'pm' | 'developer'>

export interface DeliveryUser {
  id: string
  profileId: string
  email: string
  name: string
  role: DeliveryDirectoryRole
  avatar?: string
  isActive: boolean
}

export interface SettingsUser {
  profileId: string
  legacyMockId?: string
  email: string
  name: string
  role: UserRole
  avatar?: string
  isActive: boolean
  createdAt: Date
  lastLoginAt?: Date
}

// Lead Types
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'
export type LeadSource = 'website' | 'referral' | 'cold_call' | 'social' | 'event' | 'other'
export type LeadSourceInput = LeadSource | 'cold_outreach' | 'social_media'
export type LeadOrigin = 'inbound' | 'outbound'
export type LeadAssignmentStatus = 'owned' | 'proposal_locked' | 'released_no_response'

export interface Lead {
  id: string
  name: string
  email: string
  phone?: string
  company?: string
  source: LeadSource
  status: LeadStatus
  score: number
  value: number
  assignedTo?: string
  assignmentStatus: LeadAssignmentStatus
  lockedByProposalId?: string
  lockedAt?: Date
  releasedAt?: Date
  notes?: string
  tags: string[]
  locationText?: string
  latitude?: number
  longitude?: number
  leadOrigin?: LeadOrigin
  createdAt: Date
  updatedAt: Date
  lastContactedAt?: Date
  nextFollowUpAt?: Date
}

export interface LeadDraft extends Omit<
  Lead,
  'id' | 'createdAt' | 'updatedAt' | 'source' | 'assignmentStatus' | 'lockedByProposalId' | 'lockedAt' | 'releasedAt'
> {
  source: LeadSourceInput
  leadOrigin: LeadOrigin
}

export type LeadUpdates = Partial<Omit<LeadDraft, 'nextFollowUpAt'>> & {
  nextFollowUpAt?: Date | null
}

export type LeadActivityType = 'created' | 'updated' | 'status_changed' | 'note_added'
  | 'proposal_created'
  | 'proposal_status_changed'
  | 'project_created'
  | 'released_no_response'
  | 'claimed'

export interface LeadActivity {
  id: string
  leadId: string
  type: LeadActivityType
  actorId?: string
  actorName: string
  noteBody?: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'handoff_ready'
export type ProposalReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'expired' | 'cancelled'

export interface LeadProposal {
  id: string
  leadId: string
  title: string
  body: string
  amount: number
  currency: string
  status: ProposalStatus
  reviewStatus: ProposalReviewStatus
  versionNumber: number
  isSpecialCase: boolean
  supersededBy: string | null
  createdAt: Date
  updatedAt: Date
  sentAt?: Date
  acceptedAt?: Date
  handoffReadyAt?: Date
  firstOpenedAt?: Date
  expiresAt?: Date
  reviewedAt?: Date
  reviewerId?: string
  linkedProject?: {
    id: string
    name: string
    status: ProjectStatus
    createdAt: Date
  }
}

// Project Types
export type ProjectStatus = 'backlog' | 'in_progress' | 'review' | 'delivered' | 'completed'
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ProjectActivityType = 'status_changed' | 'pm_changed' | 'team_changed' | 'schedule_changed'
export type TaskActivityType = 'note_added' | 'status_changed' | 'actual_hours_updated'

export interface Project {
  id: string
  name: string
  description?: string
  clientId?: string
  clientName: string
  status: ProjectStatus
  budget: number
  startDate?: Date
  endDate?: Date
  pmId?: string
  pmName?: string
  teamIds: string[]
  createdAt: Date
  updatedAt: Date
  sourceLeadId?: string
  sourceLeadName?: string
  sourceProposalId?: string
  sourceProposalTitle?: string
  handoffReadyAt?: Date
  prototypeWorkspaceId?: string
  prototypeWorkspaceStatus?: PrototypeWorkspaceStatus
  prototypeWorkspaceStage?: PrototypeStage
  prototypeRequestedByName?: string
  prototypeCreatedAt?: Date
}

export type ProjectDraft = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
export type ProjectUpdates = Partial<Omit<ProjectDraft, 'description' | 'pmId' | 'startDate' | 'endDate'>> & {
  description?: string | null
  pmId?: string | null
  startDate?: Date | null
  endDate?: Date | null
}

export interface Task {
  id: string
  projectId: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  assignedTo?: string
  assignedToName?: string
  dueDate?: Date
  estimatedHours?: number
  actualHours?: number
  createdAt: Date
  updatedAt: Date
}

export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & {
  assigneeId?: string
  assigneeName?: string
}

export type TaskUpdates = Partial<TaskDraft>

export interface TaskActivity {
  id: string
  taskId: string
  type: TaskActivityType
  actorId?: string
  actorName: string
  noteBody?: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

export interface ProjectActivity {
  id: string
  projectId: string
  type: ProjectActivityType
  actorId?: string
  actorName: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

export type ProjectTaskActivity =
  | {
      id: string
      sourceKind: 'project_activity'
      projectId: string
      type: ProjectActivityType
      actorId?: string
      actorName: string
      taskId?: never
      taskTitle?: never
      noteBody?: never
      metadata?: Record<string, unknown>
      createdAt: Date
    }
  | {
      id: string
      sourceKind: 'task_activity'
      projectId: string
      taskId: string
      taskTitle: string
      type: TaskActivityType
      actorId?: string
      actorName: string
      noteBody?: string
      metadata?: Record<string, unknown>
      createdAt: Date
    }

export type UpdateFeedDomain = 'sales' | 'delivery'
export type UpdateFeedSourceKind = 'lead_activity' | 'task_activity' | 'project_activity'
export type UpdateFeedEventType = LeadActivityType | TaskActivityType | ProjectActivityType
export type UserNotificationDomain = UpdateFeedDomain
export type UserNotificationSourceKind = UpdateFeedSourceKind
export type WalletEntryType =
  | 'free_grant'
  | 'earnings_credit'
  | 'manual_adjustment'
  | 'prototype_request_debit'
  | 'prototype_continue_debit'
export type WalletBucket = 'free' | 'earned'
export type PrototypeStage = 'sales' | 'delivery'
export type PrototypeWorkspaceStatus = 'pending_generation' | 'ready' | 'delivery_active' | 'archived'

export interface UpdateFeedItem {
  id: string
  domain: UpdateFeedDomain
  sourceKind: UpdateFeedSourceKind
  eventType: UpdateFeedEventType
  actorName: string
  title: string
  description: string
  entityLabel: string
  href: string
  createdAt: Date
}

export interface UserNotification {
  id: string
  domain: UserNotificationDomain
  sourceKind: UserNotificationSourceKind
  title: string
  body: string
  href: string
  isRead: boolean
  readAt?: Date
  createdAt: Date
}

export interface WalletEntry {
  id: string
  type: WalletEntryType
  bucket: WalletBucket
  deltaCredits: number
  operationId: string
  actorId?: string
  actorName: string
  leadId?: string
  prototypeWorkspaceId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

export interface WalletSummary {
  freeAvailable: number
  earnedAvailable: number
  totalAvailable: number
  prototypeRequestCost?: number
  entries: WalletEntry[]
  monetaryWallet?: {
    availableToSpend: number
    availableToWithdraw: number
    pending: number
    locked: number
    currency: string
  }
  monetaryLedger?: Array<{
    id: string
    amount: number
    currency: string
    entryType: string
    balanceBucket: string
    status: 'confirmed' | 'pending' | 'reversed'
    referenceType: string | null
    referenceId: string | null
    actorId: string | null
    actorName: string
    metadata: Record<string, unknown>
    createdAt: Date
  }>
}

export interface PrototypeWorkspace {
  id: string
  leadId: string
  projectId?: string
  requestedByProfileId: string
  currentStage: PrototypeStage
  status: PrototypeWorkspaceStatus
  lastOperationId?: string
  createdAt: Date
  updatedAt: Date
}

export interface PrototypeWorkspaceListItem extends PrototypeWorkspace {
  leadName: string
  projectName?: string
  requestedByName: string
}

// Payment Types
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'

export interface Payment {
  id: string
  projectId: string
  amount: number
  status: PaymentStatus
  stripePaymentId?: string
  createdAt: Date
  completedAt?: Date
}

export interface Commission {
  id: string
  userId: string
  projectId: string
  amount: number
  percentage: number
  status: 'pending' | 'approved' | 'paid'
  createdAt: Date
  paidAt?: Date
}

// Points and Rewards Types
export type PointEventType = 'sale_closed' | 'milestone_reached' | 'sla_met' | 'referral' | 'bonus'

export interface PointEvent {
  id: string
  userId: string
  type: PointEventType
  points: number
  description: string
  referenceId?: string
  createdAt: Date
}

export interface Reward {
  id: string
  name: string
  description: string
  pointsCost: number
  category: 'gift_card' | 'experience' | 'merchandise' | 'time_off' | 'bonus'
  available: boolean
  imageUrl?: string
}

export interface RewardRedemption {
  id: string
  userId: string
  rewardId: string
  pointsSpent: number
  status: 'pending' | 'approved' | 'fulfilled' | 'rejected'
  createdAt: Date
  fulfilledAt?: Date
}

// Activity Types
export interface Activity {
  id: string
  userId: string
  userName: string
  action: string
  entityType: 'lead' | 'project' | 'task' | 'payment' | 'user'
  entityId: string
  entityName: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

// Dashboard Stats
export interface SalesStats {
  totalLeads: number
  leadsThisMonth: number
  conversionRate: number
  totalRevenue: number
  revenueThisMonth: number
  avgDealSize: number
  pipelineValue: number
  closedDeals: number
}

export interface DeliveryStats {
  totalProjects: number
  activeProjects: number
  completedProjects: number
  onTrack: number
  atRisk: number
  delayed: number
  avgDeliveryTime: number
  teamUtilization: number
}

export interface UserStats {
  totalEarnings: number
  pendingCommissions: number
  totalPoints: number
  leadsAssigned: number
  dealsWon: number
  tasksCompleted: number
}
