/**
 * GDPR Art. 17 erase helper.
 *
 * Two procedures:
 *  - `planErase()` — read-only: builds the per-table plan the script prints
 *    in dry-run mode.
 *  - `eraseUserData()` — destructive: runs the ANONYMIZE-in-place pass
 *    per the inventory, then invokes `supabase.auth.admin.deleteUser()` to
 *    cascade through `auth.users → user_profiles → CASCADE-FK children`,
 *    then runs verification queries.
 *
 * Transactional caveat (escalated to Architecture during B16 backend):
 * -------------------------------------------------------------------
 * ADR-019 §D7 mandates a "single Postgres transaction" wrapping all
 * `public.*` anonymization. The Supabase JS SDK does NOT expose
 * `BEGIN`/`COMMIT` across multiple `.from(...).update(...)` calls (no
 * direct `pg` client in the repo). True atomicity would require either
 * (a) a new PL/pgSQL RPC `gdpr_erase_user_data(profile_id, sentinel_id)`
 * — which adds a schema change ADR-019 §Consequences forbids — or
 * (b) a `pg` driver added to the toolchain.
 *
 * This implementation uses best-effort sequential per-table UPDATEs, with
 * the following safeguards in lieu of true atomicity:
 *   - The auth-side delete is invoked ONLY if every ANONYMIZE step
 *     succeeded. Partial anonymization never reaches the auth.users
 *     cascade.
 *   - If any UPDATE step fails, the helper throws; the script reports
 *     which step failed; the runbook documents recovery (re-run is safe
 *     because the failed table's filter column is already on the original
 *     profile-id; the second pass anonymizes only the remaining rows).
 *   - Verification queries after the auth-side delete catch any drift.
 *
 * This is flagged for system-validator + system-security as a
 * contract-relaxation: §D7's atomicity is a recovery posture, not a
 * data-integrity guarantee, because all touched rows are scoped to one
 * profile-id and partial state is self-healing on re-run.
 *
 * @see docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md §D2, §D3, §D5, §D7
 * @see specs/fase-3-b16-gdpr-art-15-17.md §Contract — scripts/gdpr/erase-user-data.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  ANONYMIZE_TABLES,
  EXPLICIT_DELETE_TABLES,
  TABLE_INVENTORY,
  type TableInventoryEntry,
  type TableVerdict,
} from '@/lib/server/gdpr/inventory'
import {
  SENTINEL_PROFILE_ID,
  assertSentinelExists,
  isSentinelProfileId,
} from '@/lib/server/gdpr/sentinel'
import type { Database } from '@/lib/server/supabase/database.types'

export type PlannedAction = 'DELETE' | 'ANONYMIZE' | 'EXPORT-only' | 'SKIP'

export interface ErasePlanEntry {
  table: string
  verdict: TableVerdict
  row_count: number
  planned_action: PlannedAction
}

export interface ErasePlan {
  profile_id: string
  per_table: ErasePlanEntry[]
}

export interface EraseResultEntry {
  table: string
  rows_affected: number
  verification_remaining_for_original: number
  verification_sentinel_count: number
}

export interface EraseResult {
  profile_id: string
  per_table: EraseResultEntry[]
  auth_user_deleted: boolean
}

export interface EraseOptions {
  reason: string
  ticketRef?: string | null
  allowAdmin?: boolean
}

export class AdminTargetWithoutAllowError extends Error {
  constructor(role: string) {
    super(
      `Refusing to erase profile with role="${role}" — pass --allow-admin explicitly.`,
    )
    this.name = 'AdminTargetWithoutAllowError'
  }
}

export class SentinelTargetError extends Error {
  constructor() {
    super('Refusing to erase the GDPR sentinel profile itself.')
    this.name = 'SentinelTargetError'
  }
}

export class EraseStepError extends Error {
  constructor(public step: string, public table: string | null, cause: string) {
    super(
      `GDPR erase step "${step}" failed${table ? ` on table "${table}"` : ''}: ${cause}`,
    )
    this.name = 'EraseStepError'
  }
}

export class EraseVerificationError extends Error {
  constructor(public mismatches: EraseResultEntry[]) {
    super(
      `GDPR erase post-verification mismatch on ${mismatches.length} table(s): ` +
        mismatches.map((m) => m.table).join(', '),
    )
    this.name = 'EraseVerificationError'
  }
}

// ---------------------------------------------------------------------------
// Helpers — typed-loose access to inventory-driven table names.
// ---------------------------------------------------------------------------

interface CountResult {
  count: number | null
  error: { message: string } | null
}

async function countRowsMatchingProfile(
  client: SupabaseClient<Database>,
  entry: TableInventoryEntry,
  profileId: string,
): Promise<number> {
  if (entry.filterColumn === null) return 0

  const columns = [entry.filterColumn, ...entry.additionalFilterColumns]
  const orExpr = columns.map((col) => `${col}.eq.${profileId}`).join(',')

  const fromAny = client.from(entry.table as never) as unknown as {
    select: (cols: string, opts: { count: 'exact'; head: true }) => {
      or: (expr: string) => Promise<CountResult>
    }
  }

  const { count, error } = await fromAny
    .select('*', { count: 'exact', head: true })
    .or(orExpr)

  if (error) {
    throw new EraseStepError('count', entry.table, error.message)
  }

  return count ?? 0
}

async function countRowsExactColumn(
  client: SupabaseClient<Database>,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const fromAny = client.from(table as never) as unknown as {
    select: (cols: string, opts: { count: 'exact'; head: true }) => {
      eq: (col: string, value: string) => Promise<CountResult>
    }
  }

  const { count, error } = await fromAny
    .select('*', { count: 'exact', head: true })
    .eq(column, value)

  if (error) {
    throw new EraseStepError('verification', table, error.message)
  }

  return count ?? 0
}

/**
 * Run one ANONYMIZE pass for a single table.
 *
 * For each `actorColumnsToSentinel` column, issue a separate UPDATE that
 * sets that column to the sentinel UUID where it equals the target profile-id.
 * Free-text columns are redacted to '[redacted]'. JSONB columns are wiped to {}.
 *
 * Returns the number of rows touched (sum across actor columns; rows touched
 * twice count twice, which is acceptable for the result summary — the
 * verification query is the authoritative post-state check).
 */
async function anonymizeTable(
  client: SupabaseClient<Database>,
  entry: TableInventoryEntry,
  profileId: string,
): Promise<number> {
  let totalAffected = 0

  // Per-actor-column UPDATE. We use a generic from-handle cast because the
  // table name is inventory-driven at runtime.
  for (const column of entry.actorColumnsToSentinel) {
    const fromAny = client.from(entry.table as never) as unknown as {
      update: (payload: Record<string, unknown>) => {
        eq: (col: string, value: string) => {
          select: (cols: string) => Promise<{
            data: unknown[] | null
            error: { message: string } | null
          }>
        }
      }
    }

    const payload: Record<string, unknown> = { [column]: SENTINEL_PROFILE_ID }

    // Co-located redaction: redact free-text + wipe JSONB only on the FIRST
    // UPDATE pass per table (when column === entry.actorColumnsToSentinel[0]).
    // This avoids re-wiping on subsequent passes that target a different
    // actor column for the same row.
    if (column === entry.actorColumnsToSentinel[0]) {
      for (const freeTextCol of entry.freeTextColumnsToRedact) {
        payload[freeTextCol] = '[redacted]'
      }
      for (const jsonbCol of entry.jsonbColumnsToWipe) {
        payload[jsonbCol] = {}
      }
    }

    const { data, error } = await fromAny
      .update(payload)
      .eq(column, profileId)
      .select('*')

    if (error) {
      throw new EraseStepError('anonymize', entry.table, error.message)
    }

    totalAffected += data?.length ?? 0
  }

  return totalAffected
}

/**
 * Explicit DELETE for tables marked CASCADE-delete that do NOT cascade from
 * user_profiles. Current inventory has zero such tables (every CASCADE-delete
 * row cascades via the auth.users → user_profiles chain), but the helper is
 * kept for future-proofing.
 */
async function deleteTable(
  client: SupabaseClient<Database>,
  entry: TableInventoryEntry,
  profileId: string,
): Promise<number> {
  if (entry.filterColumn === null) return 0

  const fromAny = client.from(entry.table as never) as unknown as {
    delete: () => {
      eq: (col: string, value: string) => {
        select: (cols: string) => Promise<{
          data: unknown[] | null
          error: { message: string } | null
        }>
      }
    }
  }

  const { data, error } = await fromAny
    .delete()
    .eq(entry.filterColumn, profileId)
    .select('*')

  if (error) {
    throw new EraseStepError('explicit-delete', entry.table, error.message)
  }

  return data?.length ?? 0
}

/**
 * Read the target profile's role for the pre-flight admin guard.
 */
async function readProfileRole(
  client: SupabaseClient<Database>,
  profileId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('user_profiles')
    .select('role')
    .eq('id', profileId)
    .maybeSingle()

  if (error) {
    throw new EraseStepError('preflight-role', 'user_profiles', error.message)
  }

  return data?.role ?? null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a dry-run plan for the erase pass. Read-only.
 *
 * For each inventory table, counts the rows that would be touched and
 * records the verdict + planned action. SKIP-with-reason and
 * cascadesFromUserProfiles tables report a planned action without a
 * count (they are handled implicitly by the auth-side cascade).
 */
export async function planErase(
  client: SupabaseClient<Database>,
  profileId: string,
): Promise<ErasePlan> {
  const perTable: ErasePlanEntry[] = []

  for (const entry of TABLE_INVENTORY) {
    let row_count = 0
    let planned_action: PlannedAction

    if (entry.verdict === 'ANONYMIZE-in-place') {
      row_count = await countRowsMatchingProfile(client, entry, profileId)
      planned_action = 'ANONYMIZE'
    } else if (entry.verdict === 'CASCADE-delete') {
      row_count = await countRowsMatchingProfile(client, entry, profileId)
      planned_action = entry.cascadesFromUserProfiles ? 'DELETE' : 'DELETE'
    } else if (entry.verdict === 'EXPORT-only') {
      planned_action = 'EXPORT-only'
    } else {
      planned_action = 'SKIP'
    }

    perTable.push({
      table: entry.table,
      verdict: entry.verdict,
      row_count,
      planned_action,
    })
  }

  return { profile_id: profileId, per_table: perTable }
}

/**
 * Execute the erase pass against the live database. Destructive.
 *
 * Caller (the script) is responsible for:
 *  - Verifying the `I_UNDERSTAND_THIS_IS_DESTRUCTIVE` env var.
 *  - Interactive typed confirmation.
 *  - Verifying the export artefact path was provided + valid.
 *
 * This helper is responsible for:
 *  - Pre-flight checks (sentinel exists, target is not sentinel, admin guard).
 *  - ANONYMIZE pass (per inventory).
 *  - Explicit DELETE for non-cascading CASCADE-delete tables (currently none).
 *  - `auth.admin.deleteUser()` call.
 *  - Post-verification queries.
 *
 * Order (ADR-019 §D2):
 *   1. Pre-flight.
 *   2. ANONYMIZE per inventory order.
 *   3. Explicit DELETE (currently no-op — kept for future-proofing).
 *   4. auth.admin.deleteUser(profileId).
 *   5. Verification.
 */
export async function eraseUserData(
  client: SupabaseClient<Database>,
  profileId: string,
  opts: EraseOptions,
): Promise<EraseResult> {
  // ----- Pre-flight -----
  if (isSentinelProfileId(profileId)) {
    throw new SentinelTargetError()
  }

  await assertSentinelExists(client)

  const role = await readProfileRole(client, profileId)
  if (role === 'admin' && !opts.allowAdmin) {
    throw new AdminTargetWithoutAllowError(role)
  }

  // ----- ANONYMIZE pass -----
  const anonymizeResults = new Map<string, number>()

  for (const entry of ANONYMIZE_TABLES) {
    const affected = await anonymizeTable(client, entry, profileId)
    anonymizeResults.set(entry.table, affected)
  }

  // ----- Explicit DELETE pass (currently no-op) -----
  for (const entry of EXPLICIT_DELETE_TABLES) {
    await deleteTable(client, entry, profileId)
  }

  // ----- auth.admin.deleteUser — fires the user_profiles cascade -----
  let authUserDeleted = false
  const { error: authError } = await client.auth.admin.deleteUser(profileId)
  if (authError) {
    // The runbook documents the recovery: re-invoke the auth-side delete
    // after the anonymization pass already committed.
    throw new EraseStepError(
      'auth-delete',
      'auth.users',
      authError.message,
    )
  }
  authUserDeleted = true

  // ----- Verification -----
  const perTable: EraseResultEntry[] = []
  const mismatches: EraseResultEntry[] = []

  for (const entry of TABLE_INVENTORY) {
    if (entry.verdict === 'SKIP-with-reason' || entry.verdict === 'EXPORT-only') {
      continue
    }
    if (entry.filterColumn === null) continue

    const remainingForOriginal = await countRowsExactColumn(
      client,
      entry.table,
      entry.filterColumn,
      profileId,
    )

    let sentinelCount = 0
    if (entry.verdict === 'ANONYMIZE-in-place') {
      sentinelCount = await countRowsExactColumn(
        client,
        entry.table,
        entry.filterColumn,
        SENTINEL_PROFILE_ID,
      )
    }

    const resultEntry: EraseResultEntry = {
      table: entry.table,
      rows_affected: anonymizeResults.get(entry.table) ?? 0,
      verification_remaining_for_original: remainingForOriginal,
      verification_sentinel_count: sentinelCount,
    }

    perTable.push(resultEntry)

    // Drift: ANY remaining row referencing the original profile-id on a
    // touched table is a failure.
    if (remainingForOriginal > 0) {
      mismatches.push(resultEntry)
    }
  }

  if (mismatches.length > 0) {
    throw new EraseVerificationError(mismatches)
  }

  return {
    profile_id: profileId,
    per_table: perTable,
    auth_user_deleted: authUserDeleted,
  }
}
