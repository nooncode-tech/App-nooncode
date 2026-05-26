/**
 * Outbound webhook ledger helper (ADR-027).
 *
 * Sibling to `lib/server/website/webhook-events.ts` (inbound ledger, ADR-016).
 * Implements the lifecycle calls + state-machine transitions for the
 * `outbound_webhook_events` table introduced by migration
 * `0062_phase_3r5_outbound_webhook_events.sql`.
 *
 * All writes assume a service-role client (`createSupabaseAdminClient()`);
 * RLS on the table is admin-read-only with no INSERT/UPDATE/DELETE
 * policies. See ADR-027 D2 § RLS and the migration file's policy block.
 *
 * Kill-switch env var follows the WEBSITE_WEBHOOK_LEDGER_ENABLED precedent
 * (ADR-016 D9 reading discipline): single read at module load, default
 * enabled, only the literal lowercased `'false'` disables. Non-canonical
 * values emit a one-time console warning and default to enabled.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/server/supabase/database.types'

// The outbound ledger table is created by migration 0062 (G23 / ADR-027) and
// may be ahead of the generated Supabase types in this repo. Same posture as
// the inbound integration boundary in `lib/server/website-integration.ts`:
// the untyped client cast is contained to this helper module so callers stay
// typed against the high-level record shapes below.
type DatabaseClient = SupabaseClient<Database>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function outboundTable(client: DatabaseClient): any {
  return client.from('outbound_webhook_events' as never)
}

// ---------------------------------------------------------------------------
// Public type surface
// ---------------------------------------------------------------------------

export type OutboundWebhookEndpoint = 'proposal-review-decision'

export type OutboundWebhookStatus =
  | 'pending'
  | 'delivered'
  | 'dead_letter'
  | 'replayed'

export type OutboundWebhookDecision =
  | 'approved'
  | 'rejected'
  | 'changes_requested'
  | 'cancelled'

export interface OutboundWebhookEventInput {
  endpoint: OutboundWebhookEndpoint
  externalProposalId: string
  decision: OutboundWebhookDecision
  linkId: string | null
  proposalId: string | null
  payloadHash: string
  signatureHeader: string | null
  idempotencyKey: string
  requestId: string | null
  actorId: string | null
  maxAttempts?: number
}

export interface OutboundWebhookEventRecord {
  eventId: string
  endpoint: OutboundWebhookEndpoint
  status: OutboundWebhookStatus
  attemptCount: number
  maxAttempts: number
  nextRetryAt: string | null
  lastAttemptedAt: string | null
  deliveredAt: string | null
  deadLetteredAt: string | null
  replayedAt: string | null
  replayedByEventId: string | null
  externalProposalId: string
  decision: OutboundWebhookDecision
  idempotencyKey: string
  linkId: string | null
  proposalId: string | null
  payloadHash: string
  signatureHeader: string | null
  lastError: string | null
  lastHttpStatus: number | null
  requestId: string | null
  actorId: string | null
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Kill-switch (D5)
// ---------------------------------------------------------------------------

const FLAG_ENV_VAR = 'NOON_OUTBOUND_WEBHOOK_RETRY_ENABLED'

function readInlineRetryFlag(): boolean {
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
      `[outbound-webhook-ledger] ${FLAG_ENV_VAR} has non-canonical value "${raw}". ` +
        `Only the literal "false" (case-insensitive) disables inline retry; defaulting to enabled. See ADR-027 D5.`,
    )
  }
  return true
}

const INLINE_RETRY_ENABLED = readInlineRetryFlag()

export function outboundWebhookInlineRetryEnabled(): boolean {
  return INLINE_RETRY_ENABLED
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const RECORD_SELECT_COLS =
  'id, endpoint, status, attempt_count, max_attempts, next_retry_at, last_attempted_at, ' +
  'delivered_at, dead_lettered_at, replayed_at, replayed_by_event_id, external_proposal_id, ' +
  'decision, idempotency_key, link_id, proposal_id, payload_hash, signature_header, ' +
  'last_error, last_http_status, request_id, actor_id, created_at, updated_at'

interface RawOutboundRow {
  id: string
  endpoint: string
  status: string
  attempt_count: number
  max_attempts: number
  next_retry_at: string | null
  last_attempted_at: string | null
  delivered_at: string | null
  dead_lettered_at: string | null
  replayed_at: string | null
  replayed_by_event_id: string | null
  external_proposal_id: string
  decision: string
  idempotency_key: string
  link_id: string | null
  proposal_id: string | null
  payload_hash: string
  signature_header: string | null
  last_error: string | null
  last_http_status: number | null
  request_id: string | null
  actor_id: string | null
  created_at: string
  updated_at: string
}

function asEndpoint(value: unknown): OutboundWebhookEndpoint {
  if (value === 'proposal-review-decision') return value
  // Defensive: schema CHECK constraint should prevent any other value, but if
  // the table is somehow extended without updating this helper, fall back to
  // the only known endpoint rather than crashing the dispatcher.
  return 'proposal-review-decision'
}

function asStatus(value: unknown): OutboundWebhookStatus {
  if (
    value === 'pending' ||
    value === 'delivered' ||
    value === 'dead_letter' ||
    value === 'replayed'
  ) {
    return value
  }
  return 'pending'
}

function asDecision(value: unknown): OutboundWebhookDecision {
  if (
    value === 'approved' ||
    value === 'rejected' ||
    value === 'changes_requested' ||
    value === 'cancelled'
  ) {
    return value
  }
  // CHECK constraint guarantees this; fall back conservatively.
  return 'approved'
}

function mapRow(row: RawOutboundRow): OutboundWebhookEventRecord {
  return {
    eventId: row.id,
    endpoint: asEndpoint(row.endpoint),
    status: asStatus(row.status),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at,
    lastAttemptedAt: row.last_attempted_at,
    deliveredAt: row.delivered_at,
    deadLetteredAt: row.dead_lettered_at,
    replayedAt: row.replayed_at,
    replayedByEventId: row.replayed_by_event_id,
    externalProposalId: row.external_proposal_id,
    decision: asDecision(row.decision),
    idempotencyKey: row.idempotency_key,
    linkId: row.link_id,
    proposalId: row.proposal_id,
    payloadHash: row.payload_hash,
    signatureHeader: row.signature_header,
    lastError: row.last_error,
    lastHttpStatus: row.last_http_status,
    requestId: row.request_id,
    actorId: row.actor_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function clipError(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return value.slice(0, 1000)
}

// ---------------------------------------------------------------------------
// Lifecycle API
// ---------------------------------------------------------------------------

/**
 * Insert a fresh outbound ledger row with status='pending' and
 * attempt_count=0. Called BEFORE the first fetch so a process crash mid-fetch
 * still leaves a discoverable `pending` row for the cron to drive.
 */
export async function createOutboundWebhookEvent(
  client: DatabaseClient,
  input: OutboundWebhookEventInput,
): Promise<OutboundWebhookEventRecord> {
  const { data, error } = await outboundTable(client)
    .insert({
      endpoint: input.endpoint,
      external_proposal_id: input.externalProposalId,
      decision: input.decision,
      link_id: input.linkId,
      proposal_id: input.proposalId,
      payload_hash: input.payloadHash,
      signature_header: input.signatureHeader,
      idempotency_key: input.idempotencyKey,
      request_id: input.requestId,
      actor_id: input.actorId,
      max_attempts: input.maxAttempts ?? 3,
      status: 'pending',
      attempt_count: 0,
    })
    .select(RECORD_SELECT_COLS)
    .single()

  if (error || !data) {
    throw new Error(
      `Failed to create outbound webhook event row: ${error?.message ?? 'no row returned'}`,
    )
  }
  return mapRow(data as RawOutboundRow)
}

/**
 * Bump attempt_count by 1 and set last_attempted_at=now() before each fetch.
 * Returns the new attempt_count for caller logging. Does NOT change status.
 */
export async function beginOutboundAttempt(
  client: DatabaseClient,
  eventId: string,
  options: { now?: string } = {},
): Promise<{ attemptCount: number }> {
  // Read-then-write is safe enough here: the inline path is serial per row
  // (a single dispatcher call owns the row across its attempts), and the
  // cron path claims rows via a status='pending' filter — concurrent
  // increments on the same row would only inflate attempt_count beyond
  // max_attempts, at which point the row would already be slated for
  // dead-letter by the calling code. We accept this tradeoff per ADR-027
  // D4 (no claimed_at lock column at this cadence).
  const { data: existing, error: readError } = await outboundTable(client)
    .select('attempt_count')
    .eq('id', eventId)
    .single()

  if (readError || !existing) {
    throw new Error(
      `Failed to read outbound webhook event ${eventId} before attempt bump: ${
        readError?.message ?? 'no row'
      }`,
    )
  }

  const nextCount = (existing.attempt_count as number) + 1
  const { error } = await outboundTable(client)
    .update({
      attempt_count: nextCount,
      last_attempted_at: options.now ?? new Date().toISOString(),
    })
    .eq('id', eventId)

  if (error) {
    throw new Error(
      `Failed to bump outbound webhook event ${eventId} attempt: ${error.message}`,
    )
  }
  return { attemptCount: nextCount }
}

/**
 * Persist a fresh signature header alongside the row. Called after each
 * `signWebsitePayload` re-signature so the ledger reflects the most recent
 * `X-Noon-Signature` value (forensic per ADR-027 D2). Idempotent at the
 * row level: the LAST signature wins.
 */
export async function recordOutboundSignatureHeader(
  client: DatabaseClient,
  eventId: string,
  signatureHeader: string,
): Promise<void> {
  const { error } = await outboundTable(client)
    .update({ signature_header: signatureHeader })
    .eq('id', eventId)
  if (error) {
    // Non-fatal: signature persistence is a forensic aid, not a correctness
    // path. Log via console (no logger import to keep this module
    // dependency-light) and continue.
    console.warn(
      `[outbound-webhook-ledger] failed to record signature header for ${eventId}: ${error.message}`,
    )
  }
}

/**
 * Terminal happy path: status='delivered', delivered_at=now(), next_retry_at
 * cleared. Records last_http_status for forensic operator triage.
 */
export async function markOutboundDelivered(
  client: DatabaseClient,
  eventId: string,
  outcome: { httpStatus: number; now?: string },
): Promise<void> {
  const { error } = await outboundTable(client)
    .update({
      status: 'delivered',
      delivered_at: outcome.now ?? new Date().toISOString(),
      next_retry_at: null,
      last_http_status: outcome.httpStatus,
      last_error: null,
    })
    .eq('id', eventId)

  if (error) {
    throw new Error(
      `Failed to mark outbound webhook event ${eventId} delivered: ${error.message}`,
    )
  }
}

/**
 * Non-terminal failure: schedule next retry. status stays 'pending'. Stores
 * `last_error` (clipped to 1000 chars) + `last_http_status` for triage.
 */
export async function scheduleOutboundRetry(
  client: DatabaseClient,
  eventId: string,
  outcome: { lastError: string; lastHttpStatus: number | null; nextRetryAt: string },
): Promise<void> {
  const { error } = await outboundTable(client)
    .update({
      status: 'pending',
      next_retry_at: outcome.nextRetryAt,
      last_error: clipError(outcome.lastError),
      last_http_status: outcome.lastHttpStatus,
    })
    .eq('id', eventId)

  if (error) {
    throw new Error(
      `Failed to schedule outbound webhook event ${eventId} retry: ${error.message}`,
    )
  }
}

/**
 * Terminal failure: status='dead_letter', dead_lettered_at=now(),
 * next_retry_at cleared. Stores last_error and last_http_status.
 */
export async function markOutboundDeadLetter(
  client: DatabaseClient,
  eventId: string,
  outcome: { lastError: string; lastHttpStatus: number | null; now?: string },
): Promise<void> {
  const { error } = await outboundTable(client)
    .update({
      status: 'dead_letter',
      dead_lettered_at: outcome.now ?? new Date().toISOString(),
      next_retry_at: null,
      last_error: clipError(outcome.lastError),
      last_http_status: outcome.lastHttpStatus,
    })
    .eq('id', eventId)

  if (error) {
    throw new Error(
      `Failed to mark outbound webhook event ${eventId} dead-letter: ${error.message}`,
    )
  }
}

/**
 * Admin replay (D7): spawn a new row inheriting the source row's identity
 * keys (idempotency_key MUST match per D10) and transition the source row
 * to 'replayed' with `replayed_by_event_id` pointing at the new row.
 *
 * Returns both event ids so the caller can drive the new row through the
 * dispatcher's retry loop.
 *
 * NOTE: this helper does NOT itself perform the outbound fetch — that is
 * the dispatcher's responsibility. This keeps the lifecycle pure-DB and
 * unit-testable.
 */
export async function spawnOutboundReplay(
  client: DatabaseClient,
  sourceEventId: string,
  options: { now?: string } = {},
): Promise<{ sourceEventId: string; newEventId: string; record: OutboundWebhookEventRecord }> {
  const { data: source, error: readError } = await outboundTable(client)
    .select(RECORD_SELECT_COLS)
    .eq('id', sourceEventId)
    .single()
  if (readError || !source) {
    throw new Error(
      `Failed to read source outbound event ${sourceEventId} for replay: ${
        readError?.message ?? 'no row'
      }`,
    )
  }
  const src = mapRow(source as RawOutboundRow)
  if (src.status !== 'dead_letter') {
    throw new Error(
      `Cannot spawn replay for outbound event ${sourceEventId} in status '${src.status}'. Only 'dead_letter' rows are replayable.`,
    )
  }

  const { data: spawned, error: insertError } = await outboundTable(client)
    .insert({
      endpoint: src.endpoint,
      external_proposal_id: src.externalProposalId,
      decision: src.decision,
      link_id: src.linkId,
      proposal_id: src.proposalId,
      payload_hash: src.payloadHash,
      signature_header: null,
      idempotency_key: src.idempotencyKey, // D10 — same key, preserves NoonWeb dedupe
      request_id: src.requestId,
      actor_id: src.actorId,
      max_attempts: 3, // D7 — fresh attempts budget
      status: 'pending',
      attempt_count: 0,
    })
    .select(RECORD_SELECT_COLS)
    .single()

  if (insertError || !spawned) {
    throw new Error(
      `Failed to spawn replay row for outbound event ${sourceEventId}: ${
        insertError?.message ?? 'no row returned'
      }`,
    )
  }
  const newRow = mapRow(spawned as RawOutboundRow)

  const nowIso = options.now ?? new Date().toISOString()
  const { error: updateError } = await outboundTable(client)
    .update({
      status: 'replayed',
      replayed_at: nowIso,
      replayed_by_event_id: newRow.eventId,
    })
    .eq('id', sourceEventId)

  if (updateError) {
    throw new Error(
      `Failed to transition source outbound event ${sourceEventId} to 'replayed': ${updateError.message}`,
    )
  }

  return { sourceEventId, newEventId: newRow.eventId, record: newRow }
}

/**
 * Operator query helper: fetch a single ledger row by id. Returns `null`
 * when not found.
 */
export async function getOutboundWebhookEvent(
  client: DatabaseClient,
  eventId: string,
): Promise<OutboundWebhookEventRecord | null> {
  const { data, error } = await outboundTable(client)
    .select(RECORD_SELECT_COLS)
    .eq('id', eventId)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to fetch outbound webhook event ${eventId}: ${error.message}`,
    )
  }
  return data ? mapRow(data as RawOutboundRow) : null
}

/**
 * Cron sweep (D4): claim up to N pending rows whose `next_retry_at` is due.
 * Filters on `status='pending'`, `next_retry_at <= now()`, and
 * `attempt_count < max_attempts`. Orders by `next_retry_at asc` (oldest-due
 * first) to prevent starvation. Returns the claimed rows for the caller
 * to drive through the dispatcher's retry loop.
 */
export async function claimOutboundPendingDue(
  client: DatabaseClient,
  options: { limit: number; now: string },
): Promise<OutboundWebhookEventRecord[]> {
  // The cron cadence (`*/5 * * * *` per D4) makes concurrent runs essentially
  // serialized on Vercel; per ADR-027 D4 we deliberately do NOT add a
  // claimed_at lock column. Plain SELECT with an ORDER+LIMIT is sufficient.
  const { data, error } = await outboundTable(client)
    .select(RECORD_SELECT_COLS)
    .eq('status', 'pending')
    .lte('next_retry_at', options.now)
    .not('next_retry_at', 'is', null)
    .order('next_retry_at', { ascending: true })
    .limit(options.limit)

  if (error) {
    throw new Error(
      `Failed to claim due outbound webhook events: ${error.message}`,
    )
  }
  const rows = (data ?? []) as RawOutboundRow[]
  return rows
    .filter((row) => row.attempt_count < row.max_attempts)
    .map(mapRow)
}
