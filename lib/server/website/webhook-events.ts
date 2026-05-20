import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>

export type WebsiteWebhookEndpoint = 'inbound-proposal' | 'payment-confirmed'

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
      'id, status, attempt_count, external_session_id, external_proposal_id, external_payment_id, link_id',
    )
    .maybeSingle()

  if (!insertError && inserted) {
    return {
      shouldProcess: true,
      eventId: inserted.id,
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
      'id, status, attempt_count, external_session_id, external_proposal_id, external_payment_id, link_id',
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

  if (currentStatus === 'processed' && linkId !== null) {
    return {
      shouldProcess: false,
      eventId: existing.id,
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
