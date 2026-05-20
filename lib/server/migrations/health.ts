/**
 * Pure-function migration drift classifier.
 *
 * Compares a filesystem listing of `supabase/migrations/*.sql` against the
 * remote `supabase_migrations.schema_migrations` ledger, classifying the
 * diff against the two ADR-anchored exception sets:
 *
 *  - `KNOWN_COLLISION_FILES` — disk files intentionally absent from the
 *    ledger (ADR-006 §Option B2 grandfathered set).
 *  - `EXPECTED_ORPHAN_LEDGER_NAMES` — ledger rows with no matching disk
 *    file (ADR-014 §Orphans).
 *
 * This module is intentionally pure: no I/O, no Supabase client, no
 * `node:fs` dependency. The 7 edge cases enumerated in
 * `specs/fase-2-c-b26-schema-migrations-gating-endpoint-health.md` (§Included)
 * are the unit-test contract.
 *
 * Join key (ADR-017 §D8): filesystem entries join to ledger rows on
 * `(filename_slug, ledger.name)`, where `filename_slug` is the filename
 * WITHOUT its 4-digit prefix and WITHOUT its `.sql` extension. The
 * `(prefix, version)` join is intentionally NOT used because the 4
 * grandfathered prefixes (0024/0025/0026/0027) each have 2 files; a
 * prefix-based join would non-deterministically match one of each pair.
 *
 * @see docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md
 */

export interface MigrationsLedgerRow {
  /**
   * Either a 4-digit prefix ('0023') or a 14-digit timestamp
   * ('20260420063335') per ADR-014. Not used as a join key — `name` is.
   */
  version: string
  /** Bare slug — no prefix, no `.sql` extension. */
  name: string
}

export interface MigrationsDiffSummary {
  filesystem_count: number
  ledger_count: number
  grandfathered_collisions_count: number
  expected_orphans_count: number
  /** Sum of `missing_in_ledger.length + unexpected_drift_orphans.length`. */
  unexpected_drift_count: number
  /** Count of disk files with no matching ledger row that are NOT grandfathered. */
  missing_in_ledger_count: number
}

export interface MigrationsDiffResult {
  synced: boolean
  summary: MigrationsDiffSummary
  /** Full filenames (incl. `.sql`) on disk with no ledger row AND not in `KNOWN_COLLISION_FILES`. */
  missing_in_ledger: string[]
  /** Ledger `name` values with no matching disk file AND not in `EXPECTED_ORPHAN_LEDGER_NAMES`. */
  unexpected_drift_orphans: string[]
  /** The grandfathered filenames currently present on disk, sorted lexically. */
  grandfathered_collisions: string[]
  /** The expected orphan `name` values currently present in the ledger, sorted lexically. */
  expected_orphans: string[]
}

const PREFIX_RE = /^\d{4}_/
const SQL_EXTENSION = '.sql'

/**
 * Extract the slug (prefix-less, extension-less) from a migration filename.
 *
 * - `0051_phase_20a_website_webhook_event_ledger.sql`
 *   → `phase_20a_website_webhook_event_ledger`
 * - A filename without the 4-digit prefix returns the filename stripped of
 *   its `.sql` extension only (defensive: should never happen given the CI
 *   guard, but the diff function does not assume the guard ran).
 *
 * Exported for unit-test introspection only.
 */
export function filenameToSlug(filename: string): string {
  const noPrefix = filename.replace(PREFIX_RE, '')
  return noPrefix.endsWith(SQL_EXTENSION)
    ? noPrefix.slice(0, -SQL_EXTENSION.length)
    : noPrefix
}

/**
 * Classify the diff between disk migrations and ledger rows.
 *
 * Inputs:
 *  - `files` — full filenames (including `.sql`) under `supabase/migrations/`.
 *  - `rows` — ledger rows from `supabase_migrations.schema_migrations`.
 *  - `grandfathered` — set of full filenames intentionally absent from ledger
 *    (ADR-006 §B2). Keyed on FULL filename including prefix + `.sql`.
 *  - `expectedOrphans` — set of ledger `name` values with no matching disk
 *    file (ADR-014 §Orphans). Keyed on BARE name (no prefix, no extension).
 *
 * Returns a classified `MigrationsDiffResult`. `synced` is `true` iff both
 * `missing_in_ledger` and `unexpected_drift_orphans` are empty arrays.
 *
 * Behavior on edge cases:
 *  - Allowlist file present in ledger anyway: silently absorbed (no drift)
 *    — the file is on disk and the row is in the ledger, regardless of the
 *    allowlist's intent.
 *  - Expected-orphan name appears on disk later: reclassified as a regular
 *    matched file; no longer counted as an expected orphan.
 *  - Unknown extra orphan: surfaced in `unexpected_drift_orphans`, drives
 *    `synced=false`.
 *  - New disk file not in ledger AND not in `grandfathered`: surfaced in
 *    `missing_in_ledger`, drives `synced=false`.
 */
export function diffMigrations(
  files: readonly string[],
  rows: readonly MigrationsLedgerRow[],
  grandfathered: ReadonlySet<string>,
  expectedOrphans: ReadonlySet<string>,
): MigrationsDiffResult {
  // Build the slug index for disk files. Duplicates are possible (the 4
  // grandfathered prefix pairs share slugs only by coincidence, not by
  // pattern — actual collisions are at the prefix layer, not the slug
  // layer). We use a Set on slugs for join membership.
  const diskSlugs = new Set<string>()
  for (const file of files) {
    diskSlugs.add(filenameToSlug(file))
  }

  // Build the ledger name index. Duplicates would indicate a corrupt
  // ledger; we accept the first occurrence and let the count surface it.
  const ledgerNames = new Set<string>()
  for (const row of rows) {
    ledgerNames.add(row.name)
  }

  // Classify disk files.
  const missing_in_ledger: string[] = []
  const grandfathered_collisions: string[] = []
  for (const file of files) {
    const slug = filenameToSlug(file)
    if (ledgerNames.has(slug)) {
      // File has a matching ledger row. No drift, regardless of allowlist
      // membership (allowlist-in-ledger case is silently absorbed).
      continue
    }
    // File has no matching ledger row.
    if (grandfathered.has(file)) {
      grandfathered_collisions.push(file)
    } else {
      missing_in_ledger.push(file)
    }
  }

  // Classify ledger rows.
  const unexpected_drift_orphans: string[] = []
  const expected_orphans: string[] = []
  for (const row of rows) {
    if (diskSlugs.has(row.name)) {
      // Ledger row has a matching disk file. No drift, regardless of
      // expected-orphan-set membership (the reclassification case).
      continue
    }
    if (expectedOrphans.has(row.name)) {
      expected_orphans.push(row.name)
    } else {
      unexpected_drift_orphans.push(row.name)
    }
  }

  // Lexical sort for stable response order.
  missing_in_ledger.sort()
  unexpected_drift_orphans.sort()
  grandfathered_collisions.sort()
  expected_orphans.sort()

  const missing_in_ledger_count = missing_in_ledger.length
  const unexpected_drift_count =
    missing_in_ledger_count + unexpected_drift_orphans.length

  const summary: MigrationsDiffSummary = {
    filesystem_count: files.length,
    ledger_count: rows.length,
    grandfathered_collisions_count: grandfathered_collisions.length,
    expected_orphans_count: expected_orphans.length,
    unexpected_drift_count,
    missing_in_ledger_count,
  }

  return {
    synced: unexpected_drift_count === 0,
    summary,
    missing_in_ledger,
    unexpected_drift_orphans,
    grandfathered_collisions,
    expected_orphans,
  }
}
