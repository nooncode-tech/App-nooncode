import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>

export type WebsiteWebhookEndpoint =
  | 'inbound-proposal'
  | 'payment-confirmed'
  | 'prototype-decision'
  | 'prototype-share'

export type WebsiteWebhookEventStatus = 'processing' | 'processed' | 'failed'

export interface WebsiteWebhookEventInput {
  endpoint: WebsiteWebhookEndpoint
  signatureHeader: string
  signatureHash: string
  payloadHash: string
  requestId: string
}

export interface WebsiteWebhookEventRecord {
  shouldProcess: boolean
  eventId: string
  /**
   * Discriminator added per ADR-025 D1 / A1. The replay-path helper for
   * the `prototype-decision` endpoint requires this field to branch into
   * the FK-join lookup against `prototype_decisions.webhook_event_id`.
   * Existing call sites for `inbound-proposal` / `payment-confirmed`
   * continue to ignore the field; their replay path keeps reading
   * `linkId` against `website_inbound_links`.
   */
  endpoint: WebsiteWebhookEndpoint
  status: WebsiteWebhookEventStatus
  attemptCount: number
  externalSessionId: string | null
  externalProposalId: string | null
  externalPaymentId: string | null
  linkId: string | null
}

const FLAG_ENV_VAR = 'WEBSITE_WEBHOOK_LEDGER_ENABLED'

function readLedgerFlag(): boolean {
  const raw = process.env[FLAG_ENV_VAR]
  if (raw === undefined) {
    return true
  }
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'false') {
    return false
  }
  if (normalized !== 'true') {
    console.warn(
      `[website-webhook-ledger] ${FLAG_ENV_VAR} has non-canonical value "${raw}". ` +
        `Only the literal "false" (case-insensitive) disables; defaulting to enabled. See ADR-016 D9.`,
    )
  }
  return true
}

const LEDGER_ENABLED = readLedgerFlag()

export function websiteWebhookLedgerEnabled(): boolean {
  return LEDGER_ENABLED
}

function asStatus(value: unknown): WebsiteWebhookEventStatus {
  return value === 'processing' || value === 'processed' || value === 'failed'
    ? value
    : 'failed'
}

export async function recordWebsiteWebhookEvent(
  client: DatabaseClient,
  input: WebsiteWebhookEventInput,
): Promise<WebsiteWebhookEventRecord> {
  const { data: inserted, error: insertError } = await client
    .from('website_webhook_events')
    .insert({
      endpoint: input.endpoint,
      signature_hash: input.signatureHash,
      payload_hash: input.payloadHash,
      signature_header: input.signatureHeader,
      request_id: input.requestId,
      status: 'processing',
    })
    .select(
      'id, endpoint, status, attempt_count, external_session_id, external_proposal_id, external_payment_id, link_id',
    )
    .maybeSingle()

  if (!insertError && inserted) {
    return {
      shouldProcess: true,
      eventId: inserted.id,
      endpoint: (inserted.endpoint as WebsiteWebhookEndpoint | null) ?? input.endpoint,
      status: asStatus(inserted.status),
      attemptCount: inserted.attempt_count,
      externalSessionId: inserted.external_session_id ?? null,
      externalProposalId: inserted.external_proposal_id ?? null,
      externalPaymentId: inserted.external_payment_id ?? null,
      linkId: inserted.link_id ?? null,
    }
  }

  const isUniqueViolation =
    !!insertError && (insertError.code === '23505' || /duplicate key/i.test(insertError.message))
  if (!isUniqueViolation) {
    throw new Error(`Failed to record website webhook event: ${insertError?.message ?? 'unknown error'}`)
  }

  const { data: existing, error: selectError } = await client
    .from('website_webhook_events')
    .select(
      'id, endpoint, status, attempt_count, external_session_id, external_proposal_id, external_payment_id, link_id',
    )
    .eq('endpoint', input.endpoint)
    .eq('signature_hash', input.signatureHash)
    .single()

  if (selectError || !existing) {
    throw new Error(
      `Website webhook event collision detected but lookup failed: ${selectError?.message ?? 'no row'}`,
    )
  }

  const currentStatus = asStatus(existing.status)
  const linkId = existing.link_id ?? null
  const existingEndpoint = (existing.endpoint as WebsiteWebhookEndpoint | null) ?? input.endpoint

  // Endpoint-specific "processed" detection. Per ADR-025 D1, the
  // `prototype-decision` endpoint does NOT populate `link_id` (it has no
  // `website_inbound_links` row by design — §5.7 of cross-repo-webhook-v1.md
  // / D1 ledger row shape). Its "processed" signal is `status = 'processed'`
  // alone; the replay-path helper resolves the recorded `prototype_decisions`
  // row via the `webhook_event_id` FK-join. Per ADR-028 §5A.7, the
  // `prototype-share` endpoint follows the same rule: link_id may be NULL
  // when the lead-resolution path created a fresh lead (no inbound link
  // row exists); its replay-path helper resolves `prototype_workspaces`
  // via `webhook_event_id` FK-join. The other two endpoints retain the
  // original `link_id` check (preserves their behavior unchanged).
  const isProcessed =
    currentStatus === 'processed' &&
    (existingEndpoint === 'prototype-decision' ||
      existingEndpoint === 'prototype-share' ||
      linkId !== null)

  if (isProcessed) {
    return {
      shouldProcess: false,
      eventId: existing.id,
      endpoint: existingEndpoint,
      status: 'processed',
      attemptCount: existing.attempt_count,
      externalSessionId: existing.external_session_id ?? null,
      externalProposalId: existing.external_proposal_id ?? null,
      externalPaymentId: existing.external_payment_id ?? null,
      linkId,
    }
  }

  const nextAttempt = existing.attempt_count + 1
  const { error: updateError } = await client
    .from('website_webhook_events')
    .update({
      attempt_count: nextAttempt,
      status: 'processing',
      last_error: null,
      failed_at: null,
    })
    .eq('id', existing.id)

  if (updateError) {
    throw new Error(`Failed to bump website webhook event attempt: ${updateError.message}`)
  }

  return {
    shouldProcess: true,
    eventId: existing.id,
    endpoint: existingEndpoint,
    status: 'processing',
    attemptCount: nextAttempt,
    externalSessionId: existing.external_session_id ?? null,
    externalProposalId: existing.external_proposal_id ?? null,
    externalPaymentId: existing.external_payment_id ?? null,
    linkId,
  }
}

export interface WebsiteWebhookEventOutcome {
  externalSessionId: string | null
  externalProposalId: string | null
  externalPaymentId: string | null
  linkId: string | null
}

export async function markWebsiteWebhookEventProcessed(
  client: DatabaseClient,
  eventId: string,
  outcome: WebsiteWebhookEventOutcome,
): Promise<void> {
  const { error } = await client
    .from('website_webhook_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      last_error: null,
      external_session_id: outcome.externalSessionId,
      external_proposal_id: outcome.externalProposalId,
      external_payment_id: outcome.externalPaymentId,
      link_id: outcome.linkId,
    })
    .eq('id', eventId)

  if (error) {
    throw new Error(`Failed to mark website webhook event processed: ${error.message}`)
  }
}

export interface WebsiteWebhookReplayResponse {
  idempotent: true
  linkId: string
  leadId: string
  proposalId: string
  status: string
  projectId?: string
}

export async function composeReplayResponseFromLedger(
  client: DatabaseClient,
  ledger: WebsiteWebhookEventRecord,
): Promise<WebsiteWebhookReplayResponse | null> {
  if (ledger.linkId === null) {
    return null
  }
  const { data: link, error } = await client
    .from('website_inbound_links')
    .select('id, lead_id, proposal_id, current_status, project_id')
    .eq('id', ledger.linkId)
    .maybeSingle()

  if (error || !link) {
    return null
  }

  const response: WebsiteWebhookReplayResponse = {
    idempotent: true,
    linkId: link.id,
    leadId: link.lead_id,
    proposalId: link.proposal_id,
    status: link.current_status,
  }
  if (link.project_id) {
    response.projectId = link.project_id
  }
  return response
}

/**
 * Replay-response reconstruction for the `prototype-decision` endpoint.
 *
 * Per ADR-025 D1 / A1: rather than extending the generic `website_webhook_events`
 * schema with an endpoint-specific FK column (option a — rejected; sets schema
 * sprawl precedent), the replay path joins `prototype_decisions` to the ledger
 * row via the existing `webhook_event_id` soft-FK declared by ADR-023 D4.
 *
 * Architecture preference (ADR-025 D1 implementation alternative b.2):
 * sibling helper rather than a `switch` branch inside `composeReplayResponseFromLedger`.
 * Preserves the existing function's behavior unchanged for `inbound-proposal` /
 * `payment-confirmed` (smaller blast radius).
 *
 * Wire-shape rules (per ADR-025 D1 + cross-repo-webhook-v1.md §5.4):
 *   - `idempotent: true` always on replay.
 *   - `draftPropuestaQueued: false` always on replay — per ADR-023 D6 the
 *     Maxwell draft fire-and-forget runs only on the original successful
 *     run; replays return the recorded state without re-invoking side effects.
 *
 * Defensive null fallback (per ADR-025 D1): if the matched `prototype_decisions`
 * row's `webhook_event_id` is NULL (the FK is `on delete set null`, so a
 * ledger row purge can orphan the link), return null so the handler falls
 * through to "re-run business logic" per ADR-016 D6's failed-then-retry branch.
 */
export interface WebsitePrototypeDecisionReplayResponse {
  idempotent: true
  decisionId: string
  prototypeWorkspaceId: string
  leadId: string
  decision: 'accepted' | 'rejected'
  decidedAt: string
  draftPropuestaQueued: false
}

export async function composePrototypeDecisionReplayResponseFromLedger(
  client: DatabaseClient,
  ledger: WebsiteWebhookEventRecord,
): Promise<WebsitePrototypeDecisionReplayResponse | null> {
  if (ledger.endpoint !== 'prototype-decision') {
    return null
  }

  const { data: decision, error } = await client
    .from('prototype_decisions')
    .select('id, prototype_workspace_id, lead_id, decision, decided_at')
    .eq('webhook_event_id', ledger.eventId)
    .maybeSingle()

  if (error || !decision) {
    return null
  }

  const decisionValue =
    decision.decision === 'accepted' || decision.decision === 'rejected'
      ? decision.decision
      : null

  if (decisionValue === null) {
    // Defensive: if the DB CHECK constraint is violated somehow (data drift),
    // fall through to re-run business logic per ADR-016 D6.
    return null
  }

  return {
    idempotent: true,
    decisionId: decision.id,
    prototypeWorkspaceId: decision.prototype_workspace_id,
    leadId: decision.lead_id,
    decision: decisionValue,
    decidedAt: decision.decided_at,
    draftPropuestaQueued: false,
  }
}

/**
 * Replay-response reconstruction for the `prototype-share` endpoint
 * (ADR-028 §5A.3). Mirrors `composePrototypeDecisionReplayResponseFromLedger`
 * one-for-one: joins `prototype_workspaces` to the ledger via the
 * `webhook_event_id` soft-FK declared in migration 0063 element 1.
 *
 * Wire-shape rules (per ADR-028 D3 + cross-repo-webhook-v1.md §5A.4):
 *   - `idempotent: true` always on replay.
 *   - `superseded_workspace_ids: []` always on replay — the original
 *     processing already invalidated whichever prior workspaces it needed
 *     to; replays do not re-emit that list (the receiver already acted
 *     on it the first time).
 *
 * Defensive null fallback (mirrors ADR-025 D1 reasoning): if the matched
 * `prototype_workspaces` row's `webhook_event_id` is NULL (the FK is
 * `on delete set null`, so a ledger row purge can orphan the link), return
 * null so the handler falls through to "re-run business logic" per ADR-016 D6.
 * Re-running is safe because the handler's `(external_session_id, v0_chat_id)`
 * application-level dedup will hit and return the existing workspace.
 */
export interface WebsitePrototypeShareReplayResponse {
  idempotent: true
  shareToken: string
  prototypeWorkspaceId: string
  leadId: string
  versionNumber: number | null
  issuedAt: string
  supersededWorkspaceIds: never[]
}

export async function composePrototypeShareReplayResponseFromLedger(
  client: DatabaseClient,
  ledger: WebsiteWebhookEventRecord,
): Promise<WebsitePrototypeShareReplayResponse | null> {
  if (ledger.endpoint !== 'prototype-share') {
    return null
  }

  // The `webhook_event_id` column is added by migration 0063 (ADR-028);
  // the generated Supabase types may lag the migration. Cast the column
  // name to the broad union the typed builder expects — runtime behavior
  // is unchanged. Same pattern used elsewhere in this repo when types
  // trail a migration (see `lib/server/website-integration.ts:41`).
  const { data: workspace, error } = await client
    .from('prototype_workspaces')
    .select('id, lead_id, share_token, created_at, updated_at')
    .eq('webhook_event_id' as never, ledger.eventId)
    .maybeSingle()

  if (error || !workspace || !workspace.share_token) {
    return null
  }

  return {
    idempotent: true,
    shareToken: workspace.share_token,
    prototypeWorkspaceId: workspace.id,
    leadId: workspace.lead_id,
    // `version_number` is not stored on `prototype_workspaces` today — see
    // ADR-028 D2 + Q-piedra-1 (the wire field is informational; the
    // workspace row identity is the token, not the version). Replay returns
    // null so NoonWeb-side mappers can fall back to their own tracking.
    versionNumber: null,
    issuedAt: workspace.updated_at ?? workspace.created_at,
    supersededWorkspaceIds: [],
  }
}

export async function markWebsiteWebhookEventFailed(
  client: DatabaseClient,
  eventId: string,
  failure: unknown,
): Promise<void> {
  const message = failure instanceof Error ? failure.message : String(failure)
  const { error: updateError } = await client
    .from('website_webhook_events')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      last_error: message.slice(0, 1000),
    })
    .eq('id', eventId)

  if (updateError) {
    console.error(
      `[website-webhook-ledger] failed to mark event ${eventId} as failed: ${updateError.message}`,
    )
  }
}
