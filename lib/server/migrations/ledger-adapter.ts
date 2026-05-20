/**
 * Orchestrator for the migration health endpoint.
 *
 * Responsibilities (ADR-017 §D6):
 *  - Read the filesystem state of `supabase/migrations/*.sql` via
 *    `node:fs/promises.readdir`. Defensive guard: if the bundle is missing
 *    (readdir returns 0 `.sql` entries), throw `MigrationsBundleConfigError`
 *    so the route maps it to a 500 with code `MIGRATIONS_BUNDLE_MISSING`
 *    instead of false-positive-reporting 51 files as drift.
 *  - SELECT `version, name` from `supabase_migrations.schema_migrations` via
 *    the cross-schema accessor on the service-role client. Failures throw
 *    `MigrationsLedgerReadError` (mapped to 500 + `MIGRATIONS_READ_FAILED`).
 *  - Invoke the pure `diffMigrations` classifier with the two ADR-anchored
 *    exception sets imported from `known-exceptions.mjs`.
 *  - Assemble the response envelope `{ data: { ...result, checked_at } }`.
 *
 * The type for ledger rows (`SchemaMigrationsRow`) is co-located here, not
 * in `lib/server/supabase/database.types.ts`, per ADR-017 §D4 (inline cast
 * over a 5th manual override block).
 *
 * @see docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md
 * @see docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import { ApiError } from '@/lib/server/api/errors'
import { diffMigrations, type MigrationsDiffResult } from '@/lib/server/migrations/health'
import {
  EXPECTED_ORPHAN_LEDGER_NAMES,
  KNOWN_COLLISION_FILES,
} from '@/lib/server/migrations/known-exceptions.mjs'

/**
 * Row shape returned by `public.list_schema_migrations()` (ADR-018). Pinned
 * to the ADR-014 verification snapshot. If Supabase ever evolves this row
 * shape, the cast in `readMigrationsHealth` silently lies until the diff
 * function dereferences a missing field — caught at the next
 * `@supabase/supabase-js` upgrade.
 *
 * @see docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md
 * @see docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md §D4
 * @see docs/adrs/ADR-014-migration-ledger-reconciliation.md
 */
export interface SchemaMigrationsRow {
  /** 4-digit prefix (e.g. '0023') or 14-digit timestamp (e.g. '20260420063335'). */
  version: string
  /** Bare slug (no prefix, no `.sql`). */
  name: string
}

export interface MigrationsHealthResponse {
  data: MigrationsDiffResult & {
    checked_at: string
  }
}

/**
 * Thrown when the filesystem listing of `supabase/migrations/` yields zero
 * `.sql` entries. The likely cause is a missing `outputFileTracingIncludes`
 * entry in `next.config.mjs` (or a contributor moved the route without
 * copying the config), which would silently false-positive every disk file
 * as drift. Mapping to 500 + `MIGRATIONS_BUNDLE_MISSING` makes the misconfig
 * loud instead of silent (ADR-017 §D5).
 */
export class MigrationsBundleConfigError extends ApiError {
  constructor() {
    super(
      'MIGRATIONS_BUNDLE_MISSING',
      'Migration filesystem listing is empty — the supabase/migrations bundle ' +
        'is not included in the function runtime. Check next.config.mjs ' +
        'outputFileTracingIncludes.',
      500,
    )
    this.name = 'MigrationsBundleConfigError'
  }
}

/**
 * Thrown when the `public.list_schema_migrations()` RPC call fails. The
 * most likely causes are (a) the service-role lost its EXECUTE grant on
 * `list_schema_migrations` (escalates to a re-grant migration), or (b) a
 * transient Supabase outage. Mapped to 500 + `MIGRATIONS_READ_FAILED`.
 */
export class MigrationsLedgerReadError extends ApiError {
  constructor(cause: string) {
    super(
      'MIGRATIONS_READ_FAILED',
      `Could not read the schema migrations ledger: ${cause}`,
      500,
    )
    this.name = 'MigrationsLedgerReadError'
  }
}

const MIGRATIONS_DIR_REL = join('supabase', 'migrations')
const SQL_EXTENSION = '.sql'

/**
 * Read the filesystem listing of `supabase/migrations/*.sql`. Throws
 * `MigrationsBundleConfigError` if zero `.sql` files are seen.
 */
async function readMigrationFiles(): Promise<string[]> {
  const dir = join(process.cwd(), MIGRATIONS_DIR_REL)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    // ENOENT or permission error — same operator-facing failure mode as an
    // empty bundle (the route would have nothing to diff against). Map to
    // the same MIGRATIONS_BUNDLE_MISSING code so consumers see one error
    // for "I can't see the migration files".
    throw new MigrationsBundleConfigError()
  }

  const sqlFiles = entries.filter((entry) => entry.endsWith(SQL_EXTENSION))
  if (sqlFiles.length === 0) {
    throw new MigrationsBundleConfigError()
  }
  return sqlFiles
}

/**
 * Read all rows from `supabase_migrations.schema_migrations`. Throws
 * `MigrationsLedgerReadError` if the SELECT fails.
 *
 * The cast through `as unknown as SupabaseClient<any>` is the inline
 * typed-cast strategy from ADR-017 §D4. We do not add a 5th manual override
 * block to `database.types.ts` for a 2-column read against a
 * Supabase-managed schema whose row format is pinned to ADR-014.
 */
async function readLedgerRows(client: SupabaseClient): Promise<SchemaMigrationsRow[]> {
  // Path B (ADR-018): `public.list_schema_migrations()` SECURITY DEFINER RPC
  // returns `setof (version text, name text)` from
  // `supabase_migrations.schema_migrations`. The cross-schema accessor was
  // replaced because PostgREST does not expose `supabase_migrations` via
  // `db-schemas` and rejected the prior `.schema('supabase_migrations')`
  // accessor with `Invalid schema: supabase_migrations`. EXECUTE is granted
  // only to `service_role` (ADR-018 §D2).
  const { data, error } = (await client.rpc('list_schema_migrations' as never)) as {
    data: SchemaMigrationsRow[] | null
    error: PostgrestError | null
  }

  if (error) {
    throw new MigrationsLedgerReadError(error.message)
  }

  return (data ?? []) as SchemaMigrationsRow[]
}

/**
 * Read the filesystem + ledger, compute the diff, return the response
 * envelope.
 *
 * Caller is responsible for auth (see `app/api/admin/migrations-health/route.ts`).
 * This function does NOT cache (intentional per spec §Excluded).
 */
export async function readMigrationsHealth(
  client: SupabaseClient,
): Promise<MigrationsHealthResponse> {
  const [files, rows] = await Promise.all([readMigrationFiles(), readLedgerRows(client)])

  const diff = diffMigrations(
    files,
    rows,
    KNOWN_COLLISION_FILES,
    EXPECTED_ORPHAN_LEDGER_NAMES,
  )

  return {
    data: {
      ...diff,
      checked_at: new Date().toISOString(),
    },
  }
}
