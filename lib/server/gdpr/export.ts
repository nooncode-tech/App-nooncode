/**
 * GDPR Art. 15 export helper.
 *
 * Reads every row across the inventory tables that references the target
 * profile-id (via the per-table filter column + any additional filter columns).
 * Returns a single artefact object the script serializes to JSON.
 *
 * Reads-only. No mutation. Safe to re-run.
 *
 * @see docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md §D5
 * @see specs/fase-3-b16-gdpr-art-15-17.md §Contract — scripts/gdpr/export-user-data.ts
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { EXPORT_TABLES, type TableInventoryEntry } from '@/lib/server/gdpr/inventory'
import type { Database } from '@/lib/server/supabase/database.types'

export const EXPORT_SCHEMA_VERSION = '1.0.0' as const

export interface ExportArtefactMetadata {
  schema_version: typeof EXPORT_SCHEMA_VERSION
  generated_at_utc: string
  profile_id: string
  email_at_export_time: string
  full_name_at_export_time: string
  ticket_ref: string | null
  inventory_tables_covered: string[]
}

export interface ExportArtefact {
  gdpr_export_metadata: ExportArtefactMetadata
  tables: Record<string, unknown[]>
}

export class ProfileNotFoundError extends Error {
  constructor(identifier: string) {
    super(`GDPR target profile not found: ${identifier}`)
    this.name = 'ProfileNotFoundError'
  }
}

export class ExportTableReadError extends Error {
  constructor(table: string, cause: string) {
    super(`GDPR export read failure on table "${table}": ${cause}`)
    this.name = 'ExportTableReadError'
  }
}

/**
 * Resolve a target profile-id by email. Returns null if no match.
 * Lookups go through `user_profiles.email` which is unique + lowercased.
 */
export async function resolveProfileIdByEmail(
  client: SupabaseClient<Database>,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  const { data, error } = await client
    .from('user_profiles')
    .select('id')
    .eq('email', normalized)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to resolve profile by email: ${error.message}`)
  }

  return data?.id ?? null
}

/**
 * Reads `user_profiles` (the parent row) and returns `{ email, full_name }`
 * captured at export time for the artefact metadata.
 */
async function readProfileSnapshot(
  client: SupabaseClient<Database>,
  profileId: string,
): Promise<{ email: string; full_name: string }> {
  const { data, error } = await client
    .from('user_profiles')
    .select('email, full_name')
    .eq('id', profileId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to read profile snapshot: ${error.message}`)
  }

  if (!data) {
    throw new ProfileNotFoundError(profileId)
  }

  return data
}

/**
 * Read all rows on `table` where any of the filter columns equals `profileId`.
 * For tables with `additionalFilterColumns`, an OR-across-columns is applied
 * so multi-FK tables (e.g., `wallet_ledger_entries.profile_id`/`actor_profile_id`)
 * return every row that references the target in any role.
 */
async function readTableRowsForProfile(
  client: SupabaseClient<Database>,
  entry: TableInventoryEntry,
  profileId: string,
): Promise<unknown[]> {
  if (entry.filterColumn === null) {
    return []
  }

  // Build the OR filter. supabase-js `.or()` expects a comma-joined string of
  // `column.eq.value` expressions.
  const columns = [entry.filterColumn, ...entry.additionalFilterColumns]
  const orExpr = columns.map((col) => `${col}.eq.${profileId}`).join(',')

  // The client is typed against Database; the table name is a string at
  // runtime (driven by the inventory). We cast to a generic from-handle.
  const fromAny = client.from(entry.table as never) as unknown as {
    select: (cols: string) => {
      or: (expr: string) => Promise<{
        data: unknown[] | null
        error: { message: string } | null
      }>
    }
  }

  const { data, error } = await fromAny.select('*').or(orExpr)

  if (error) {
    throw new ExportTableReadError(entry.table, error.message)
  }

  return data ?? []
}

export interface ExportOptions {
  ticketRef?: string | null
}

/**
 * Build a complete export artefact for the target profile.
 *
 * Steps:
 *  1. Read `user_profiles` snapshot (refuses with `ProfileNotFoundError` if absent).
 *  2. For each inventory table NOT marked SKIP-with-reason, read all rows
 *     matching the target's filter columns.
 *  3. Assemble the artefact with metadata + per-table arrays.
 *
 * @param client Service-role Supabase client.
 * @param profileId Target `user_profiles.id`.
 * @param opts Options (ticket_ref for audit trail).
 */
export async function exportUserData(
  client: SupabaseClient<Database>,
  profileId: string,
  opts: ExportOptions = {},
): Promise<ExportArtefact> {
  const snapshot = await readProfileSnapshot(client, profileId)

  const tables: Record<string, unknown[]> = {}
  const tablesCovered: string[] = []

  for (const entry of EXPORT_TABLES) {
    const rows = await readTableRowsForProfile(client, entry, profileId)
    tables[entry.table] = rows
    tablesCovered.push(entry.table)
  }

  const metadata: ExportArtefactMetadata = {
    schema_version: EXPORT_SCHEMA_VERSION,
    generated_at_utc: new Date().toISOString(),
    profile_id: profileId,
    email_at_export_time: snapshot.email,
    full_name_at_export_time: snapshot.full_name,
    ticket_ref: opts.ticketRef ?? null,
    inventory_tables_covered: tablesCovered,
  }

  return {
    gdpr_export_metadata: metadata,
    tables,
  }
}

/**
 * Count total rows in the artefact across all tables.
 * Used by the script to print a one-line summary.
 */
export function countExportRows(artefact: ExportArtefact): number {
  let total = 0
  for (const rows of Object.values(artefact.tables)) {
    total += rows.length
  }
  return total
}
