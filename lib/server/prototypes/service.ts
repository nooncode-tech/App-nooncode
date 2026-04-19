import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/server/supabase/database.types'
import type {
  PrototypeWorkspaceListItemWire,
  PrototypeWorkspaceWire,
} from '@/lib/prototypes/serialization'
import type { WalletSummaryWire } from '@/lib/wallet/serialization'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import { ApiError, ConflictApiError, NotFoundApiError } from '@/lib/server/api/errors'
import { getLeadById } from '@/lib/server/leads/repository'
import { assertSalesLeadOwnership } from '@/lib/server/leads/permissions'
import {
  mapPrototypeWorkspaceListItemRowToWire,
  mapPrototypeWorkspaceRowToWire,
} from '@/lib/server/prototypes/mappers'
import {
  getPrototypeWorkspaceById,
  getPrototypeWorkspaceByLeadId,
  handoffPrototypeWorkspaceToDelivery,
  linkLeadPrototypeWorkspaceToProject,
  listPrototypeWorkspaces,
} from '@/lib/server/prototypes/repository'
import {
  ensureCurrentUserWallet,
  getPrototypeCreditSettings,
  requestLeadPrototype,
} from '@/lib/server/wallet/repository'

type DatabaseClient = SupabaseClient<Database>

function mapPrototypeRpcError(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Unexpected prototype request failure.'

  if (message.includes('PROTOTYPE_REQUEST_NOT_CONFIGURED')) {
    throw new ApiError(
      'FEATURE_UNAVAILABLE',
      'Prototype credits are not configured yet.',
      503
    )
  }

  if (message.includes('INSUFFICIENT_CREDITS')) {
    throw new ConflictApiError('The current wallet balance is insufficient for this prototype request.', 'INSUFFICIENT_CREDITS')
  }

  if (message.includes('PROTOTYPE_WORKSPACE_EXISTS')) {
    throw new ConflictApiError('This lead already has a prototype workspace.', 'PROTOTYPE_WORKSPACE_EXISTS')
  }

  if (message.includes('LEAD_NOT_FOUND')) {
    throw new NotFoundApiError('Lead not found.')
  }

  if (message.includes('FORBIDDEN')) {
    throw new ApiError('FORBIDDEN', 'The authenticated user cannot request a prototype for this lead.', 403)
  }

  if (message.includes('PROFILE_NOT_FOUND')) {
    throw new ApiError('PROFILE_NOT_FOUND', 'A user profile row is required for this operation.', 403)
  }

  if (message.includes('UNAUTHENTICATED')) {
    throw new ApiError('UNAUTHENTICATED', 'An active session is required.', 401)
  }

  throw new Error(message)
}

function mapPrototypeHandoffRpcError(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Unexpected prototype handoff failure.'

  if (message.includes('PROTOTYPE_WORKSPACE_NOT_FOUND')) {
    throw new NotFoundApiError('Prototype workspace not found.')
  }

  if (message.includes('PROJECT_REQUIRED_FOR_HANDOFF')) {
    throw new ConflictApiError('A linked project is required before handing this workspace to delivery.', 'PROJECT_REQUIRED_FOR_HANDOFF')
  }

  if (message.includes('PROTOTYPE_ALREADY_IN_DELIVERY')) {
    throw new ConflictApiError('This prototype workspace is already in the delivery stage.', 'PROTOTYPE_ALREADY_IN_DELIVERY')
  }

  if (message.includes('INVALID_PROTOTYPE_HANDOFF_STATE')) {
    throw new ConflictApiError('Only sales-stage workspaces pending generation can be handed off to delivery.', 'INVALID_PROTOTYPE_HANDOFF_STATE')
  }

  if (message.includes('FORBIDDEN')) {
    throw new ApiError('FORBIDDEN', 'The authenticated user cannot hand off this prototype workspace.', 403)
  }

  if (message.includes('PROFILE_NOT_FOUND')) {
    throw new ApiError('PROFILE_NOT_FOUND', 'A user profile row is required for this operation.', 403)
  }

  if (message.includes('UNAUTHENTICATED')) {
    throw new ApiError('UNAUTHENTICATED', 'An active session is required.', 401)
  }

  throw new Error(message)
}

export async function getVisibleLeadPrototypeState(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  leadId: string
): Promise<{
  prototype: PrototypeWorkspaceWire | null
  prototypeRequestCost: number | null
  prototypeRequestsEnabled: boolean
}> {
  const lead = await getLeadById(client, leadId)

  if (!lead) {
    throw new NotFoundApiError('Lead not found.')
  }

  assertSalesLeadOwnership(principal, lead)

  const [workspace, settings] = await Promise.all([
    getPrototypeWorkspaceByLeadId(client, leadId),
    getPrototypeCreditSettings(client),
  ])

  return {
    prototype: workspace ? mapPrototypeWorkspaceRowToWire(workspace) : null,
    prototypeRequestCost: settings?.request_cost ?? null,
    prototypeRequestsEnabled: Boolean(settings?.request_cost),
  }
}

export async function listVisiblePrototypeWorkspaces(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  query: {
    leadId?: string
    limit: number
  }
): Promise<{
  items: PrototypeWorkspaceListItemWire[]
}> {
  if (
    principal.role !== 'admin'
    && principal.role !== 'sales_manager'
    && principal.role !== 'sales'
  ) {
    throw new ApiError(
      'FORBIDDEN',
      'The authenticated user cannot access prototype workspaces.',
      403
    )
  }

  if (query.leadId) {
    const lead = await getLeadById(client, query.leadId)

    if (!lead) {
      throw new NotFoundApiError('Lead not found.')
    }

    assertSalesLeadOwnership(principal, lead)
  }

  const workspaces = await listPrototypeWorkspaces(client, {
    leadId: query.leadId,
    limit: query.limit,
  })

  return {
    items: workspaces.map(mapPrototypeWorkspaceListItemRowToWire),
  }
}

export async function requestVisibleLeadPrototype(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  leadId: string
): Promise<{
  prototype: PrototypeWorkspaceWire
  wallet: Pick<WalletSummaryWire, 'freeAvailable' | 'earnedAvailable' | 'totalAvailable'>
  consumed: {
    free: number
    earned: number
    total: number
  }
}> {
  const lead = await getLeadById(client, leadId)

  if (!lead) {
    throw new NotFoundApiError('Lead not found.')
  }

  assertSalesLeadOwnership(principal, lead)

  let requestResult

  try {
    requestResult = await requestLeadPrototype(client, leadId)
  } catch (error) {
    mapPrototypeRpcError(error)
  }

  const [workspace, wallet] = await Promise.all([
    getPrototypeWorkspaceByLeadId(client, leadId),
    ensureCurrentUserWallet(client),
  ])

  if (!workspace) {
    throw new Error('Prototype workspace was not created.')
  }

  return {
    prototype: mapPrototypeWorkspaceRowToWire(workspace),
    wallet: {
      freeAvailable: wallet.free_credits_balance,
      earnedAvailable: wallet.earned_credits_balance,
      totalAvailable: wallet.free_credits_balance + wallet.earned_credits_balance,
    },
    consumed: {
      free: requestResult.consumed_free,
      earned: requestResult.consumed_earned,
      total: requestResult.consumed_free + requestResult.consumed_earned,
    },
  }
}

export async function handoffVisiblePrototypeWorkspaceToDelivery(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  prototypeWorkspaceId: string
): Promise<PrototypeWorkspaceWire> {
  if (principal.role !== 'admin' && principal.role !== 'pm') {
    throw new ApiError(
      'FORBIDDEN',
      'The authenticated user cannot hand off this prototype workspace.',
      403
    )
  }

  const workspace = await getPrototypeWorkspaceById(client, prototypeWorkspaceId)

  if (!workspace) {
    throw new NotFoundApiError('Prototype workspace not found.')
  }

  if (!workspace.project_id) {
    throw new ConflictApiError(
      'A linked project is required before handing this workspace to delivery.',
      'PROJECT_REQUIRED_FOR_HANDOFF'
    )
  }

  if (workspace.current_stage === 'delivery') {
    throw new ConflictApiError(
      'This prototype workspace is already in the delivery stage.',
      'PROTOTYPE_ALREADY_IN_DELIVERY'
    )
  }

  if (workspace.current_stage !== 'sales' || workspace.status !== 'pending_generation') {
    throw new ConflictApiError(
      'Only sales-stage workspaces pending generation can be handed off to delivery.',
      'INVALID_PROTOTYPE_HANDOFF_STATE'
    )
  }

  let updatedWorkspace

  try {
    updatedWorkspace = await handoffPrototypeWorkspaceToDelivery(client, prototypeWorkspaceId)
  } catch (error) {
    mapPrototypeHandoffRpcError(error)
  }

  return mapPrototypeWorkspaceRowToWire(updatedWorkspace)
}

export type PrototypeProjectLinkStatus =
  | 'missing_workspace'
  | 'linked'
  | 'already_linked_same_project'
  | 'already_linked_other_project'

export async function linkVisibleLeadPrototypeWorkspaceToProject(
  client: DatabaseClient,
  leadId: string,
  projectId: string
): Promise<{
  prototypeWorkspaceId: string | null
  linkedProjectId: string | null
  status: PrototypeProjectLinkStatus
}> {
  let result

  try {
    result = await linkLeadPrototypeWorkspaceToProject(client, leadId, projectId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected prototype linkage failure.'

    if (message.includes('FORBIDDEN')) {
      throw new ApiError('FORBIDDEN', 'The authenticated user cannot link this prototype workspace.', 403)
    }

    if (message.includes('PROFILE_NOT_FOUND')) {
      throw new ApiError('PROFILE_NOT_FOUND', 'A user profile row is required for this operation.', 403)
    }

    if (message.includes('UNAUTHENTICATED')) {
      throw new ApiError('UNAUTHENTICATED', 'An active session is required.', 401)
    }

    if (message.includes('PROJECT_NOT_FOUND_OR_MISMATCH')) {
      throw new NotFoundApiError('Project not found for this lead.')
    }

    throw error
  }

  const status = result.link_status as PrototypeProjectLinkStatus

  return {
    prototypeWorkspaceId: result.prototype_workspace_id,
    linkedProjectId: result.linked_project_id,
    status,
  }
}
