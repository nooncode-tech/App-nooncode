/**
 * Tests for `GET /api/dashboard/summary` — Chunk 1 of the dashboard
 * lazy-load-with-aggregates iteration.
 *
 * Coverage:
 *   1. Route handler — auth gates (401 / 403), response envelope,
 *      role-aware payload delegation.
 *   2. Service — role-aware null masking for task counters
 *      (`sales` / `sales_manager` see `null`; `admin` / `pm` /
 *      `developer` see numbers).
 *   3. Serialization — `leads_by_status: null` coercion to `{}`,
 *      `actionableTasks` computation.
 *   4. Parity — for non-trivial fixtures (≥10 leads, ≥5 projects,
 *      ≥10 tasks), an in-memory simulation of the SQL CTE (which
 *      mirrors `lib/projects/progress.ts:deriveProjectDisplayStatus`
 *      verbatim per ADR-020 §D2) produces values numerically equal
 *      to `selectDashboardSummary(leads, projects, tasks)` over the
 *      same input. This is the regression guard the production SQL
 *      RPC inherits — if the RPC drifts, this test still pins the
 *      JS-side contract.
 *   5. Branch coverage — all 7 branches of
 *      `deriveProjectDisplayStatus` are hit at least once by the
 *      parity fixture.
 *
 * Notes:
 *   - The tests stub the supabase client and repository to avoid
 *     requiring a live database. The route handler / service / mapper
 *     contracts are exercised through `createGetDashboardSummaryHandler`
 *     and direct calls to `getDashboardSummary` with a stubbed RPC.
 *   - The parity test does NOT call the route handler; it asserts the
 *     RPC's intended semantics (encoded as a JS simulation of the CTE)
 *     match the JS selector. A separate live-DB integration smoke is
 *     deferred to operator browser validation per spec §11.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createGetDashboardSummaryHandler } from '@/app/api/dashboard/summary/route'
import { getDashboardSummary } from '@/lib/server/dashboard/summary-service'
import {
  mapSummaryRowToSalesSection,
  mapSummaryRowToDeliverySectionFull,
  mapSummaryRowToDeliverySectionTaskMasked,
  type DashboardSummaryRow,
  type DashboardSummaryResponse,
} from '@/lib/server/dashboard/serialization'
import { AuthGuardError } from '@/lib/server/auth/guards'
import { selectDashboardSummary } from '@/lib/dashboard-selectors'
import { deriveProjectDisplayStatus } from '@/lib/projects/progress'
import type {
  Lead,
  LeadStatus,
  Project,
  ProjectStatus,
  Task,
  TaskStatus,
} from '@/lib/types'
import type { DatabaseClient } from '@/lib/server/supabase/server'
import type { AppRole, AuthenticatedPrincipal } from '@/lib/server/profiles/types'

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makePrincipal(role: AppRole, overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return {
    userId: 'user-1',
    email: 'principal@noon.app',
    role,
    profile: {
      id: 'profile-1',
      auth_user_id: 'user-1',
      legacy_mock_id: null,
      email: 'principal@noon.app',
      full_name: 'Test Principal',
      role,
      avatar_url: null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_login_at: null,
    } as unknown as AuthenticatedPrincipal['profile'],
    ...overrides,
  }
}

function makeRow(overrides: Partial<DashboardSummaryRow> = {}): DashboardSummaryRow {
  return {
    open_leads: 0,
    won_leads: 0,
    pipeline_value: 0,
    total_revenue: 0,
    closed_leads: 0,
    overdue_follow_ups: 0,
    leads_by_status: null,
    active_projects: 0,
    projects_in_review: 0,
    completed_projects: 0,
    pending_tasks: 0,
    in_progress_tasks: 0,
    review_tasks: 0,
    checked_at: '2026-05-22T14:30:00.000Z',
    ...overrides,
  }
}

function makeHandler({
  principal = makePrincipal('admin'),
  authError = null as Error | null,
  response = {
    sales: {
      openLeads: 0,
      wonLeads: 0,
      pipelineValue: 0,
      totalRevenue: 0,
      closedLeads: 0,
      overdueFollowUps: 0,
      leadsByStatus: {},
    },
    delivery: {
      activeProjects: 0,
      projectsInReview: 0,
      completedProjects: 0,
      pendingTasks: 0,
      inProgressTasks: 0,
      reviewTasks: 0,
      actionableTasks: 0,
    },
    checkedAt: '2026-05-22T14:30:00.000Z',
  } as DashboardSummaryResponse,
  serviceError = null as Error | null,
} = {}) {
  const requireRoleStub = async (_roles: readonly AppRole[]) => {
    if (authError) throw authError
    return principal
  }

  const getDashboardSummaryStub = async (
    _client: DatabaseClient,
    _principal: AuthenticatedPrincipal
  ) => {
    if (serviceError) throw serviceError
    return response
  }

  const createClientStub = async () => ({}) as DatabaseClient

  return createGetDashboardSummaryHandler({
    requireRole: requireRoleStub,
    getDashboardSummary: getDashboardSummaryStub,
    createSupabaseServerClient: createClientStub,
  })
}

// ===========================================================================
// 1. Route handler tests
// ===========================================================================

test('route: 200 success → body wrapped in `{ data: ... }`', async () => {
  const summary: DashboardSummaryResponse = {
    sales: {
      openLeads: 42,
      wonLeads: 7,
      pipelineValue: 125000,
      totalRevenue: 38000,
      closedLeads: 11,
      overdueFollowUps: 3,
      leadsByStatus: { new: 5, contacted: 8, won: 7, lost: 4 },
    },
    delivery: {
      activeProjects: 12,
      projectsInReview: 3,
      completedProjects: 18,
      pendingTasks: 24,
      inProgressTasks: 8,
      reviewTasks: 5,
      actionableTasks: 32,
    },
    checkedAt: '2026-05-22T14:30:00.000Z',
  }

  const handler = makeHandler({ response: summary })
  const response = await handler()
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, { data: summary })
})

test('route: unauthenticated → 401', async () => {
  const authError = new AuthGuardError(
    'UNAUTHENTICATED',
    'An active session is required.',
    401
  )
  const handler = makeHandler({ authError })

  const response = await handler()
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.code, 'UNAUTHENTICATED')
})

test('route: forbidden role → 403', async () => {
  const authError = new AuthGuardError(
    'FORBIDDEN',
    'The authenticated user does not have the required role.',
    403
  )
  const handler = makeHandler({ authError })

  const response = await handler()
  const body = await response.json()

  assert.equal(response.status, 403)
  assert.equal(body.code, 'FORBIDDEN')
})

test('route: inactive profile → 403', async () => {
  const authError = new AuthGuardError(
    'INACTIVE_PROFILE',
    'This user profile is inactive.',
    403
  )
  const handler = makeHandler({ authError })

  const response = await handler()

  assert.equal(response.status, 403)
})

test('route: repository / service failure → 500', async () => {
  const handler = makeHandler({
    serviceError: new Error('RPC failed: connection lost'),
  })

  const response = await handler()
  const body = await response.json()

  assert.equal(response.status, 500)
  assert.equal(body.code, 'INTERNAL_ERROR')
})

// ===========================================================================
// 2. Service-layer role masking tests
// ===========================================================================

/**
 * Build a stub `DatabaseClient` whose `.rpc('get_dashboard_summary')`
 * returns the given row (or error). This is the surface
 * `summary-repository.ts` consumes — we avoid wiring the real Supabase
 * client end-to-end.
 */
function makeStubClient(row: DashboardSummaryRow | null, error: { message: string } | null = null): DatabaseClient {
  return {
    rpc: async (name: string) => {
      assert.equal(name, 'get_dashboard_summary')
      if (error) return { data: null, error }
      return { data: row ? [row] : [], error: null }
    },
  } as unknown as DatabaseClient
}

const roleMaskingMatrix: Array<{ role: AppRole; tasksMasked: boolean }> = [
  { role: 'admin', tasksMasked: false },
  { role: 'pm', tasksMasked: false },
  { role: 'developer', tasksMasked: false },
  { role: 'sales', tasksMasked: true },
  { role: 'sales_manager', tasksMasked: true },
]

for (const { role, tasksMasked } of roleMaskingMatrix) {
  test(`service: role=${role} → task counters ${tasksMasked ? 'masked to null' : 'populated'}`, async () => {
    const row = makeRow({
      open_leads: 10,
      won_leads: 5,
      pipeline_value: 5000,
      total_revenue: 2500,
      closed_leads: 7,
      overdue_follow_ups: 2,
      leads_by_status: { new: 3, contacted: 4, won: 5, lost: 2 },
      active_projects: 4,
      projects_in_review: 1,
      completed_projects: 2,
      pending_tasks: 11,
      in_progress_tasks: 6,
      review_tasks: 3,
    })

    const client = makeStubClient(row)
    const principal = makePrincipal(role)

    const result = await getDashboardSummary(client, principal)

    // Sales section: always populated for all roles.
    assert.equal(result.sales.openLeads, 10)
    assert.equal(result.sales.wonLeads, 5)
    assert.equal(result.sales.pipelineValue, 5000)
    assert.equal(result.sales.totalRevenue, 2500)
    assert.equal(result.sales.closedLeads, 7)
    assert.equal(result.sales.overdueFollowUps, 2)
    assert.deepEqual(result.sales.leadsByStatus, { new: 3, contacted: 4, won: 5, lost: 2 })

    // Project counters: always populated for all roles.
    assert.equal(result.delivery.activeProjects, 4)
    assert.equal(result.delivery.projectsInReview, 1)
    assert.equal(result.delivery.completedProjects, 2)

    // Task counters: masked or populated per role.
    if (tasksMasked) {
      assert.equal(result.delivery.pendingTasks, null)
      assert.equal(result.delivery.inProgressTasks, null)
      assert.equal(result.delivery.reviewTasks, null)
      assert.equal(result.delivery.actionableTasks, null)
    } else {
      assert.equal(result.delivery.pendingTasks, 11)
      assert.equal(result.delivery.inProgressTasks, 6)
      assert.equal(result.delivery.reviewTasks, 3)
      // actionableTasks = pendingTasks + inProgressTasks = 11 + 6 = 17
      assert.equal(result.delivery.actionableTasks, 17)
    }

    // checkedAt always present.
    assert.equal(result.checkedAt, '2026-05-22T14:30:00.000Z')
  })
}

test('service: RPC error propagates as 500-route-eligible error', async () => {
  const client = makeStubClient(null, { message: 'permission denied for table tasks' })
  const principal = makePrincipal('admin')

  await assert.rejects(
    () => getDashboardSummary(client, principal),
    /Failed to read dashboard summary: permission denied for table tasks/
  )
})

test('service: RPC returns no rows → throws (defensive guard)', async () => {
  const client = makeStubClient(null)
  const principal = makePrincipal('admin')

  await assert.rejects(
    () => getDashboardSummary(client, principal),
    /Dashboard summary RPC returned no rows/
  )
})

// ===========================================================================
// 3. Serialization mapper tests
// ===========================================================================

test('serialization: leads_by_status null → {} (ADR-020 §D10 open issue #2)', () => {
  const row = makeRow({ leads_by_status: null })
  const sales = mapSummaryRowToSalesSection(row)

  assert.deepEqual(sales.leadsByStatus, {})
})

test('serialization: leads_by_status populated → preserved as-is', () => {
  const row = makeRow({
    leads_by_status: { new: 2, contacted: 5, qualified: 1, won: 3, lost: 1 },
  })
  const sales = mapSummaryRowToSalesSection(row)

  assert.deepEqual(sales.leadsByStatus, {
    new: 2,
    contacted: 5,
    qualified: 1,
    won: 3,
    lost: 1,
  })
})

test('serialization: full delivery section → actionableTasks = pending + inProgress', () => {
  const row = makeRow({ pending_tasks: 7, in_progress_tasks: 4, review_tasks: 2 })
  const delivery = mapSummaryRowToDeliverySectionFull(row)

  assert.equal(delivery.pendingTasks, 7)
  assert.equal(delivery.inProgressTasks, 4)
  assert.equal(delivery.reviewTasks, 2)
  assert.equal(delivery.actionableTasks, 11)
})

test('serialization: task-masked delivery section → task counters null, projects preserved', () => {
  const row = makeRow({
    active_projects: 5,
    projects_in_review: 2,
    completed_projects: 8,
    pending_tasks: 99,
    in_progress_tasks: 99,
    review_tasks: 99,
  })
  const delivery = mapSummaryRowToDeliverySectionTaskMasked(row)

  assert.equal(delivery.activeProjects, 5)
  assert.equal(delivery.projectsInReview, 2)
  assert.equal(delivery.completedProjects, 8)
  assert.equal(delivery.pendingTasks, null)
  assert.equal(delivery.inProgressTasks, null)
  assert.equal(delivery.reviewTasks, null)
  assert.equal(delivery.actionableTasks, null)
})

// ===========================================================================
// 4. Parity simulation — SQL-RPC semantics vs JS selector
// ===========================================================================

/**
 * Pure-JS simulation of `public.get_dashboard_summary()` from
 * `supabase/migrations/0058_phase_22b_dashboard_summary_rpc.sql`.
 *
 * Mirrors the CTE shape verbatim:
 *   - `project_task_facts` computes the 4 booleans per project
 *     (limited to `payment_activated = true` projects).
 *   - `project_display_status` applies the 7-branch ordered CASE.
 *   - lead / project / task counters use the same FILTER predicates.
 *
 * If this simulation produces values numerically equal to
 * `selectDashboardSummary(leads, projects, tasks)` over the same input
 * data, the JS selector and the SQL RPC agree by construction (the SQL
 * RPC is encoded by the migration to do exactly what this simulation
 * does).
 *
 * Pretreatment: this simulation uses the `payment_activated = true`
 * subset of projects, just like the SQL. The JS selector
 * (`selectDashboardSummary`) does NOT apply this filter itself — it
 * assumes its input list is already filtered (the production code
 * passes `projectBoardProjects`, which is filtered upstream). The
 * parity test therefore mirrors production by feeding the JS selector
 * the same already-filtered list.
 */
function simulateDashboardSummaryRpc(
  leads: Lead[],
  paymentActivatedProjects: Project[],
  tasks: Task[]
): DashboardSummaryRow {
  // Per-project derived display status.
  const projectDisplayStatus = new Map<string, ProjectStatus>()
  for (const project of paymentActivatedProjects) {
    const projectTasks = tasks.filter((t) => t.projectId === project.id)
    const hasAnyTasks = projectTasks.length > 0
    const allTasksDone = !hasAnyTasks
      ? true
      : projectTasks.every((t) => t.status === 'done')
    const anyReview = projectTasks.some((t) => t.status === 'review')
    const anyInProgressOrDone = projectTasks.some(
      (t) => t.status === 'in_progress' || t.status === 'done'
    )

    let displayStatus: ProjectStatus
    // Branch order mirrors the SQL CASE exactly (and the JS reference
    // in lib/projects/progress.ts:19-46).
    if (!hasAnyTasks) {
      displayStatus = project.status
    } else if (project.status === 'completed') {
      displayStatus = 'completed'
    } else if (project.status === 'delivered' && allTasksDone) {
      displayStatus = 'delivered'
    } else if (anyReview) {
      displayStatus = 'review'
    } else if (anyInProgressOrDone) {
      displayStatus = 'in_progress'
    } else if (project.status === 'review' || project.status === 'delivered') {
      displayStatus = project.status
    } else {
      displayStatus = 'backlog'
    }

    projectDisplayStatus.set(project.id, displayStatus)
  }

  const closedStatuses: LeadStatus[] = ['won', 'lost']
  const openLeads = leads.filter((l) => !closedStatuses.includes(l.status))
  const wonLeads = leads.filter((l) => l.status === 'won')
  const closedLeads = leads.filter((l) => closedStatuses.includes(l.status))
  const now = new Date()
  const overdueFollowUps = leads.filter(
    (l) =>
      l.nextFollowUpAt != null &&
      new Date(l.nextFollowUpAt) < now &&
      !closedStatuses.includes(l.status)
  )

  const leadsByStatus: Record<string, number> = {}
  for (const l of leads) {
    leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1
  }

  let activeProjects = 0
  let projectsInReview = 0
  let completedProjects = 0
  for (const ds of projectDisplayStatus.values()) {
    if (ds === 'in_progress') activeProjects++
    else if (ds === 'review') projectsInReview++
    else if (ds === 'completed') completedProjects++
  }

  const statusCount = (s: TaskStatus) => tasks.filter((t) => t.status === s).length

  return {
    open_leads: openLeads.length,
    won_leads: wonLeads.length,
    pipeline_value: openLeads.reduce((s, l) => s + l.value, 0),
    total_revenue: wonLeads.reduce((s, l) => s + l.value, 0),
    closed_leads: closedLeads.length,
    overdue_follow_ups: overdueFollowUps.length,
    leads_by_status: Object.keys(leadsByStatus).length === 0 ? null : leadsByStatus,
    active_projects: activeProjects,
    projects_in_review: projectsInReview,
    completed_projects: completedProjects,
    pending_tasks: statusCount('todo'),
    in_progress_tasks: statusCount('in_progress'),
    review_tasks: statusCount('review'),
    checked_at: '2026-05-22T14:30:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// Fixture builders (non-trivial volume: ≥10 leads, ≥5 projects, ≥10 tasks).
// All 7 branches of deriveProjectDisplayStatus are exercised.
// ---------------------------------------------------------------------------

let leadId = 0
function makeLead(overrides: Partial<Lead> = {}): Lead {
  leadId++
  return {
    id: `lead-${leadId}`,
    name: `Lead ${leadId}`,
    source: 'website',
    status: 'new',
    score: 50,
    value: 1000,
    assignmentStatus: 'owned',
    tags: [],
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    autoFollowupEnabled: false,
    ...overrides,
  }
}

let projectId = 0
function makeProject(overrides: Partial<Project> = {}): Project {
  projectId++
  return {
    id: `proj-${projectId}`,
    name: `Project ${projectId}`,
    clientName: 'Acme',
    status: 'backlog',
    budget: 0,
    teamIds: [],
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  } as Project
}

let taskId = 0
function makeTask(projectIdRef: string, overrides: Partial<Task> = {}): Task {
  taskId++
  return {
    id: `task-${taskId}`,
    projectId: projectIdRef,
    title: `Task ${taskId}`,
    status: 'todo',
    priority: 'medium',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  } as Task
}

interface ParityFixture {
  leads: Lead[]
  projects: Project[]
  tasks: Task[]
  /** Each project ID → the branch (1..7) it exercises. */
  branchMap: Record<string, number>
}

function buildParityFixture(): ParityFixture {
  // Reset module-local counters so the fixture is deterministic.
  leadId = 0
  projectId = 0
  taskId = 0

  // ---- Leads: 13 leads spanning all 7 status values + one overdue ----
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)

  const leads: Lead[] = [
    makeLead({ status: 'new', value: 1000 }),
    makeLead({ status: 'new', value: 1500 }),
    makeLead({ status: 'contacted', value: 2000, nextFollowUpAt: yesterday }), // overdue
    makeLead({ status: 'contacted', value: 2500 }),
    makeLead({ status: 'qualified', value: 3000, nextFollowUpAt: tomorrow }),  // not overdue
    makeLead({ status: 'qualified', value: 3500 }),
    makeLead({ status: 'proposal', value: 4000, nextFollowUpAt: yesterday }), // overdue
    makeLead({ status: 'negotiation', value: 5000 }),
    makeLead({ status: 'negotiation', value: 5500 }),
    makeLead({ status: 'won', value: 6000 }),
    makeLead({ status: 'won', value: 7000 }),
    makeLead({ status: 'lost', value: 8000, nextFollowUpAt: yesterday }), // closed → NOT overdue
    makeLead({ status: 'lost', value: 9000 }),
  ]

  // ---- Projects + tasks: 7 projects, one per deriveProjectDisplayStatus branch ----
  // Each project has payment_activated = true (the only projects the SQL counts).
  const projects: Project[] = []
  const tasks: Task[] = []
  const branchMap: Record<string, number> = {}

  // Branch 1: no tasks → use persistedStatus. Persisted 'in_progress', no tasks.
  const p1 = makeProject({ status: 'in_progress' })
  projects.push(p1)
  branchMap[p1.id] = 1

  // Branch 1b: no tasks, persisted 'delivered' → returns 'delivered' (regression
  // pin against branch-3 vacuous truth on empty task set).
  const p1b = makeProject({ status: 'delivered' })
  projects.push(p1b)
  branchMap[p1b.id] = 1

  // Branch 2: persisted = 'completed', tasks present → returns 'completed'.
  const p2 = makeProject({ status: 'completed' })
  projects.push(p2)
  tasks.push(makeTask(p2.id, { status: 'in_progress' })) // even with in_progress task
  tasks.push(makeTask(p2.id, { status: 'todo' }))
  branchMap[p2.id] = 2

  // Branch 3: persisted = 'delivered' AND every task done → 'delivered'.
  const p3 = makeProject({ status: 'delivered' })
  projects.push(p3)
  tasks.push(makeTask(p3.id, { status: 'done' }))
  tasks.push(makeTask(p3.id, { status: 'done' }))
  branchMap[p3.id] = 3

  // Branch 4: any task in review → 'review'.
  const p4 = makeProject({ status: 'in_progress' })
  projects.push(p4)
  tasks.push(makeTask(p4.id, { status: 'review' }))
  tasks.push(makeTask(p4.id, { status: 'todo' }))
  branchMap[p4.id] = 4

  // Branch 5: any task in_progress OR done → 'in_progress'. No review tasks.
  const p5 = makeProject({ status: 'backlog' })
  projects.push(p5)
  tasks.push(makeTask(p5.id, { status: 'in_progress' }))
  tasks.push(makeTask(p5.id, { status: 'todo' }))
  branchMap[p5.id] = 5

  // Branch 6: persisted IN (review, delivered), no qualifying task statuses.
  // To trigger branch 6 (not 4 / 5), tasks must all be 'todo'.
  const p6 = makeProject({ status: 'review' })
  projects.push(p6)
  tasks.push(makeTask(p6.id, { status: 'todo' }))
  tasks.push(makeTask(p6.id, { status: 'todo' }))
  branchMap[p6.id] = 6

  // Branch 7: persisted NOT IN (review, delivered, completed), no qualifying
  // task statuses → 'backlog'.
  const p7 = makeProject({ status: 'backlog' })
  projects.push(p7)
  tasks.push(makeTask(p7.id, { status: 'todo' }))
  branchMap[p7.id] = 7

  return { leads, projects, tasks, branchMap }
}

test('parity: SQL simulation matches JS selector at non-trivial volume', () => {
  const { leads, projects, tasks } = buildParityFixture()

  // Fixture sanity: meets spec §10 R6 volume rule.
  assert.ok(leads.length >= 10, `expected ≥10 leads, got ${leads.length}`)
  assert.ok(projects.length >= 5, `expected ≥5 projects, got ${projects.length}`)
  assert.ok(tasks.length >= 10, `expected ≥10 tasks, got ${tasks.length}`)

  const simulated = simulateDashboardSummaryRpc(leads, projects, tasks)
  const jsSelector = selectDashboardSummary(leads, projects, tasks)

  // Sales section parity.
  assert.equal(simulated.open_leads, jsSelector.sales.openLeads, 'openLeads parity')
  assert.equal(simulated.won_leads, jsSelector.sales.wonLeads, 'wonLeads parity')
  assert.equal(simulated.pipeline_value, jsSelector.sales.pipelineValue, 'pipelineValue parity')
  assert.equal(simulated.total_revenue, jsSelector.sales.totalRevenue, 'totalRevenue parity')

  // Delivery section parity (project counters).
  assert.equal(
    simulated.active_projects,
    jsSelector.delivery.activeProjects,
    'activeProjects parity'
  )
  assert.equal(
    simulated.projects_in_review,
    jsSelector.delivery.projectsInReview,
    'projectsInReview parity'
  )
  assert.equal(
    simulated.completed_projects,
    jsSelector.delivery.completedProjects,
    'completedProjects parity'
  )

  // Delivery section parity (task counters).
  assert.equal(
    simulated.pending_tasks,
    jsSelector.delivery.pendingTasks,
    'pendingTasks parity'
  )
  assert.equal(
    simulated.in_progress_tasks,
    jsSelector.delivery.inProgressTasks,
    'inProgressTasks parity'
  )
  assert.equal(
    simulated.review_tasks,
    jsSelector.delivery.reviewTasks,
    'reviewTasks parity'
  )
})

test('parity: dashboard-page extras (closedLeads, overdueFollowUps, leadsByStatus) match page.tsx semantics', () => {
  const { leads } = buildParityFixture()

  // Mirror app/dashboard/page.tsx:63-109 computations.
  const closedFromPage = leads.filter((l) => l.status === 'won' || l.status === 'lost').length
  const overdueFromPage = leads.filter(
    (l) =>
      l.nextFollowUpAt != null &&
      new Date(l.nextFollowUpAt) < new Date() &&
      l.status !== 'won' &&
      l.status !== 'lost'
  ).length
  const leadsByStatusFromPage: Record<string, number> = {}
  for (const l of leads) {
    leadsByStatusFromPage[l.status] = (leadsByStatusFromPage[l.status] ?? 0) + 1
  }

  const simulated = simulateDashboardSummaryRpc(leads, [], [])

  assert.equal(simulated.closed_leads, closedFromPage, 'closedLeads parity with page.tsx:64')
  assert.equal(
    simulated.overdue_follow_ups,
    overdueFromPage,
    'overdueFollowUps parity with page.tsx:69-79'
  )
  assert.deepEqual(
    simulated.leads_by_status,
    leadsByStatusFromPage,
    'leadsByStatus parity with page.tsx:81-109'
  )
})

// ===========================================================================
// 5. Branch coverage: all 7 deriveProjectDisplayStatus branches hit
// ===========================================================================

test('branch coverage: all 7 deriveProjectDisplayStatus branches are exercised', () => {
  const { projects, tasks, branchMap } = buildParityFixture()

  const hit: Record<number, boolean> = {}
  for (const project of projects) {
    const projectTasks = tasks.filter((t) => t.projectId === project.id)
    const displayStatus = deriveProjectDisplayStatus(project.status, projectTasks)
    const expectedBranch = branchMap[project.id]
    hit[expectedBranch] = true

    // Per-fixture branch assertion: each project lands in the expected
    // displayStatus, which proves the expected branch path is taken.
    switch (expectedBranch) {
      case 1:
        assert.equal(displayStatus, project.status, `branch 1: project ${project.id} should keep persisted ${project.status}`)
        break
      case 2:
        assert.equal(displayStatus, 'completed', `branch 2: project ${project.id} should return 'completed'`)
        break
      case 3:
        assert.equal(displayStatus, 'delivered', `branch 3: project ${project.id} should return 'delivered'`)
        break
      case 4:
        assert.equal(displayStatus, 'review', `branch 4: project ${project.id} should return 'review'`)
        break
      case 5:
        assert.equal(displayStatus, 'in_progress', `branch 5: project ${project.id} should return 'in_progress'`)
        break
      case 6:
        assert.equal(displayStatus, project.status, `branch 6: project ${project.id} should keep persisted ${project.status} (review|delivered)`)
        break
      case 7:
        assert.equal(displayStatus, 'backlog', `branch 7: project ${project.id} should return 'backlog'`)
        break
    }
  }

  for (let branch = 1; branch <= 7; branch++) {
    assert.ok(hit[branch], `branch ${branch} of deriveProjectDisplayStatus was never exercised`)
  }
})

test('branch 1 regression pin: persisted=delivered + zero tasks → delivered (NOT via branch 3)', () => {
  // Branch 1 must short-circuit before branch 3. A 'delivered' project
  // with zero tasks returns 'delivered' via branch 1 (persisted as-is),
  // not via branch 3 (which would also be vacuously satisfied by
  // `all_tasks_done = true` on an empty task set if reached).
  const display = deriveProjectDisplayStatus('delivered', [])
  assert.equal(display, 'delivered')
})

test('branch 3 regression: persisted=delivered + 5 tasks all done → delivered', () => {
  const tasks: Task[] = [
    { status: 'done' } as Task,
    { status: 'done' } as Task,
    { status: 'done' } as Task,
    { status: 'done' } as Task,
    { status: 'done' } as Task,
  ]
  const display = deriveProjectDisplayStatus('delivered', tasks)
  assert.equal(display, 'delivered')
})

test('branch 5 regression: persisted=delivered + mixed tasks (1 in_progress, 4 done) → in_progress NOT delivered', () => {
  // Branch 3 requires every task done. A single in_progress task drops
  // through to branch 4 (no review tasks present) and then branch 5.
  const tasks: Task[] = [
    { status: 'in_progress' } as Task,
    { status: 'done' } as Task,
    { status: 'done' } as Task,
    { status: 'done' } as Task,
    { status: 'done' } as Task,
  ]
  const display = deriveProjectDisplayStatus('delivered', tasks)
  assert.equal(display, 'in_progress')
})

test('branch 4 regression: review tasks beat in_progress tasks', () => {
  // If both review and in_progress are present, branch 4 wins because
  // it evaluates first in the CASE order.
  const tasks: Task[] = [
    { status: 'review' } as Task,
    { status: 'in_progress' } as Task,
  ]
  const display = deriveProjectDisplayStatus('backlog', tasks)
  assert.equal(display, 'review')
})
