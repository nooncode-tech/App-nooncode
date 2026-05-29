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
  countPrototypeWorkspacesByLeadId,
  getPrototypeWorkspaceById,
  getPrototypeWorkspaceByLeadId,
  handoffPrototypeWorkspaceToDelivery,
  linkLeadPrototypeWorkspaceToProject,
  listPrototypeWorkspaces,
} from '@/lib/server/prototypes/repository'
import { logger } from '@/lib/server/api/logger'
import { bootstrapPrototypeDeliveryFollowUp } from '@/lib/server/prototypes/handoff-follow-up'
import { createSupabaseAdminClient } from '@/lib/server/supabase/admin'
import {
  getWalletByProfileId,
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

  if (message.includes('ITERATION_CAP_REACHED')) {
    throw new ConflictApiError(
      'This lead has reached its prototype version limit. No more versions can be generated.',
      'ITERATION_CAP_REACHED'
    )
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
    throw new ConflictApiError('Only sales-stage workspaces pending generation or ready can be handed off to delivery.', 'INVALID_PROTOTYPE_HANDOFF_STATE')
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
  maxIterationsPerLead: number | null
  iterationsUsed: number
  iterationsRemaining: number | null
}> {
  const lead = await getLeadById(client, leadId)

  if (!lead) {
    throw new NotFoundApiError('Lead not found.')
  }

  assertSalesLeadOwnership(principal, lead)

  const [workspace, settings, iterationsUsed] = await Promise.all([
    getPrototypeWorkspaceByLeadId(client, leadId),
    getPrototypeCreditSettings(client),
    countPrototypeWorkspacesByLeadId(client, leadId),
  ])

  const maxIterationsPerLead = settings?.max_iterations_per_lead ?? null
  const iterationsRemaining =
    maxIterationsPerLead !== null ? Math.max(0, maxIterationsPerLead - iterationsUsed) : null

  return {
    prototype: workspace ? mapPrototypeWorkspaceRowToWire(workspace) : null,
    prototypeRequestCost: settings?.request_cost ?? null,
    prototypeRequestsEnabled: Boolean(settings?.request_cost),
    maxIterationsPerLead,
    iterationsUsed,
    iterationsRemaining,
  }
}

export async function listVisiblePrototypeWorkspaces(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  query: {
    leadId?: string
    limit: number
    cursor?: import('@/lib/server/pagination/cursor').CursorPayload | null
  }
): Promise<{
  items: PrototypeWorkspaceListItemWire[]
}> {
  if (
    principal.role !== 'admin'
    && principal.role !== 'sales_manager'
    && principal.role !== 'sales'
    && principal.role !== 'pm'
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
    cursor: query.cursor ?? null,
  })

  return {
    items: workspaces.map(mapPrototypeWorkspaceListItemRowToWire),
  }
}

export async function requestVisibleLeadPrototype(
  client: DatabaseClient,
  principal: AuthenticatedPrincipal,
  leadId: string,
  sellerBrief?: string | null
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

  // Persist the optional seller brief AFTER the credits RPC created the
  // workspace, via the admin client (the RPC is left untouched, so the
  // credit / iteration-cap surface is unchanged). Best-effort: the workspace
  // and credit consumption already succeeded, so a brief write failure must
  // not fail the request — that would mislead the seller into retrying and
  // double-spending. Logged for operator visibility instead.
  const trimmedBrief = sellerBrief?.trim()
  if (trimmedBrief) {
    const adminClient = createSupabaseAdminClient()
    const { error: briefError } = await adminClient
      .from('prototype_workspaces')
      .update({ seller_brief: trimmedBrief })
      .eq('id', requestResult.prototype_workspace_id)

    if (briefError) {
      logger.warn('prototype.request.seller_brief_update_failed', {
        prototypeWorkspaceId: requestResult.prototype_workspace_id,
        leadId,
        errorMessage: briefError.message,
      })
    }
  }

  const [workspace, wallet] = await Promise.all([
    getPrototypeWorkspaceByLeadId(client, leadId),
    getWalletByProfileId(client, principal.profile.id),
  ])

  if (!workspace) {
    throw new Error('Prototype workspace was not created.')
  }

  if (!wallet) {
    throw new Error('Wallet was not found after prototype request.')
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

  if (
    workspace.current_stage !== 'sales'
    || (workspace.status !== 'pending_generation' && workspace.status !== 'ready')
  ) {
    throw new ConflictApiError(
      'Only sales-stage workspaces pending generation or ready can be handed off to delivery.',
      'INVALID_PROTOTYPE_HANDOFF_STATE'
    )
  }

  let updatedWorkspace

  try {
    updatedWorkspace = await handoffPrototypeWorkspaceToDelivery(client, prototypeWorkspaceId)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''

    if (
      workspace.status === 'ready'
      && message.includes('INVALID_PROTOTYPE_HANDOFF_STATE')
    ) {
      const adminClient = createSupabaseAdminClient()
      const { data, error: updateError } = await adminClient
        .from('prototype_workspaces')
        .update({
          current_stage: 'delivery',
          status: 'delivery_active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', prototypeWorkspaceId)
        .select('*')
        .single()

      if (updateError || !data) {
        mapPrototypeHandoffRpcError(error)
      }

      updatedWorkspace = data
    } else {
      mapPrototypeHandoffRpcError(error)
    }
  }

  if (updatedWorkspace.project_id) {
    const adminClient = createSupabaseAdminClient()
    await bootstrapPrototypeDeliveryFollowUp(adminClient, {
      prototypeWorkspaceId: updatedWorkspace.id,
      projectId: updatedWorkspace.project_id,
      actorProfileId: principal.profile.id,
    })
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
