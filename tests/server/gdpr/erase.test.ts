/**
 * Unit tests — lib/server/gdpr/erase.ts
 *
 * Coverage:
 *  - Error-shape happy-paths (preserved from initial backend delivery).
 *  - planErase() against a mocked inventory with deterministic row counts.
 *  - eraseUserData() success path: ANONYMIZE pass invokes correct columns +
 *    payload shape, auth.admin.deleteUser is invoked after anonymization,
 *    verification queries report 0 remaining for original profile-id.
 *  - eraseUserData() mid-failure safeguard (the load-bearing test for
 *    Backend's transactional-relaxation): if any ANONYMIZE table UPDATE
 *    errors, auth.admin.deleteUser MUST NOT be invoked.
 *  - eraseUserData() pre-flight guards: sentinel target refused, sentinel
 *    absent refused, admin target without --allow-admin refused.
 *  - eraseUserData() verification mismatch surfacing (when sentinel anonymization
 *    "succeeds" but a row still references the original profile-id).
 *
 * Destructive integration coverage (real-DB round-trip) is documented in
 * `docs/handoffs/2026-05-21-b16-gdpr-integration-manual.md` (manual procedure;
 * local Supabase unavailable in this environment per system-testing report).
 *
 * @see lib/server/gdpr/erase.ts
 * @see docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md §D7
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AdminTargetWithoutAllowError,
  EraseStepError,
  EraseVerificationError,
  SentinelTargetError,
  eraseUserData,
  planErase,
} from '@/lib/server/gdpr/erase'
import {
  ANONYMIZE_TABLES,
  TABLE_INVENTORY,
} from '@/lib/server/gdpr/inventory'
import { SENTINEL_PROFILE_ID } from '@/lib/server/gdpr/sentinel'

const TARGET_PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const SENTINEL_EMAIL = 'deleted-user@noon.invalid'

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/**
 * Tracks every call routed through the mocked client. The harness in each
 * test inspects this log to assert ordering, payload shapes, and the
 * critical safeguard (auth.admin.deleteUser only fires on full ANONYMIZE
 * success).
 */
interface CallLog {
  operations: Array<
    | { kind: 'select-count'; table: string; orExpr: string }
    | { kind: 'select'; table: string; cols: string }
    | { kind: 'select-eq'; table: string; cols: string; col: string; value: string }
    | { kind: 'update'; table: string; payload: Record<string, unknown>; col: string; value: string }
    | { kind: 'delete'; table: string; col: string; value: string }
    | { kind: 'count-exact-eq'; table: string; col: string; value: string }
    | { kind: 'auth-delete-user'; userId: string }
  >
  authDeleteResult: { error: { message: string } | null }
}

interface HarnessConfig {
  /** Target profile row returned for `select('id, email, full_name, role').eq('id', target)`. */
  targetProfileRow: { id: string; email: string; full_name: string; role: string } | null
  /** Sentinel row returned for sentinel.assertSentinelExists. */
  sentinelRow: { id: string; email: string; is_active: boolean } | null
  /** Sentinel read error (overrides sentinel row). */
  sentinelReadError?: { message: string } | null
  /** Row counts per table (for planErase + verification). */
  rowCountByTable: Record<string, number>
  /** Per-table override: how many rows the UPDATE chain returns in `.select('*')`. */
  updateRowCountByTable?: Record<string, number>
  /** Per-table sentinel count after erasure (verification phase). */
  sentinelCountByTable?: Record<string, number>
  /** Tables that should error on UPDATE (failure injection). */
  failOnUpdate?: Set<string>
  /** Optional: error to attach to auth.admin.deleteUser. */
  authDeleteError?: { message: string } | null
  /** Optional: per-table remaining-for-original count override during verification. */
  remainingForOriginalByTable?: Record<string, number>
}

function makeHarness(config: HarnessConfig) {
  const log: CallLog = {
    operations: [],
    authDeleteResult: { error: config.authDeleteError ?? null },
  }

  function chainForTable(table: string) {
    // Builder pattern: methods are stateful within a chain. Each `.from(table)`
    // returns a fresh chain object so calls do not bleed across tables.
    const chain: Record<string, unknown> = {}

    // ----- SELECT path -----
    chain.select = (cols: string, opts?: { count?: 'exact'; head?: true }) => {
      const isCount = opts?.count === 'exact'
      const selectChain: Record<string, unknown> = {}

      selectChain.or = async (orExpr: string) => {
        if (isCount) {
          log.operations.push({ kind: 'select-count', table, orExpr })
          return { count: config.rowCountByTable[table] ?? 0, error: null }
        }
        log.operations.push({ kind: 'select', table, cols })
        // Return placeholder rows matching the count.
        const n = config.rowCountByTable[table] ?? 0
        const data = Array.from({ length: n }, (_, i) => ({ __row: i }))
        return { data, error: null }
      }

      selectChain.eq = (col: string, value: string) => {
        if (isCount) {
          // count-exact-eq is the verification-phase query for both
          // "remaining-for-original" and "sentinel-count".
          const eqResult = async () => {
            log.operations.push({ kind: 'count-exact-eq', table, col, value })
            // Verification-time counts.
            if (value === TARGET_PROFILE_ID) {
              const overridden =
                config.remainingForOriginalByTable?.[table] !== undefined
                  ? config.remainingForOriginalByTable[table]
                  : 0
              return { count: overridden, error: null }
            }
            if (value === SENTINEL_PROFILE_ID) {
              const sentinelN =
                config.sentinelCountByTable?.[table] ??
                config.rowCountByTable[table] ??
                0
              return { count: sentinelN, error: null }
            }
            return { count: 0, error: null }
          }
          // Make .eq itself thenable so `await chain.select(...).eq(...)` works,
          // matching the actual supabase-js shape used in `countRowsExactColumn`.
          return Object.assign(eqResult(), { then: (fn: any, rej: any) => eqResult().then(fn, rej) })
        }
        // Non-count select-eq used by readProfileSnapshot/role lookups.
        log.operations.push({ kind: 'select-eq', table, cols, col, value })

        const eqChain: Record<string, unknown> = {}
        eqChain.maybeSingle = async () => {
          if (table === 'user_profiles' && col === 'id' && value === SENTINEL_PROFILE_ID) {
            // Sentinel check
            if (config.sentinelReadError) return { data: null, error: config.sentinelReadError }
            return { data: config.sentinelRow, error: null }
          }
          if (table === 'user_profiles' && col === 'id' && value === TARGET_PROFILE_ID) {
            return { data: config.targetProfileRow, error: null }
          }
          return { data: null, error: null }
        }
        return eqChain
      }

      return selectChain
    }

    // ----- UPDATE path -----
    chain.update = (payload: Record<string, unknown>) => ({
      eq: (col: string, value: string) => ({
        select: async (_cols: string) => {
          if (config.failOnUpdate?.has(table)) {
            return { data: null, error: { message: `simulated update failure on ${table}` } }
          }
          log.operations.push({ kind: 'update', table, payload, col, value })
          const n =
            config.updateRowCountByTable?.[table] ??
            config.rowCountByTable[table] ??
            0
          const data = Array.from({ length: n }, (_, i) => ({ __row: i }))
          return { data, error: null }
        },
      }),
    })

    // ----- DELETE path -----
    chain.delete = () => ({
      eq: (col: string, value: string) => ({
        select: async (_cols: string) => {
          log.operations.push({ kind: 'delete', table, col, value })
          return { data: [], error: null }
        },
      }),
    })

    return chain
  }

  const client = {
    from: (table: string) => chainForTable(table),
    auth: {
      admin: {
        deleteUser: async (userId: string) => {
          log.operations.push({ kind: 'auth-delete-user', userId })
          return log.authDeleteResult
        },
      },
    },
  }

  return { client, log }
}

// ---------------------------------------------------------------------------
// Error-shape happy-paths (preserved from initial backend delivery)
// ---------------------------------------------------------------------------

test('SentinelTargetError has a recognizable name', () => {
  const err = new SentinelTargetError()
  assert.equal(err.name, 'SentinelTargetError')
  assert.match(err.message, /sentinel/i)
})

test('AdminTargetWithoutAllowError surfaces the role + the flag hint', () => {
  const err = new AdminTargetWithoutAllowError('admin')
  assert.equal(err.name, 'AdminTargetWithoutAllowError')
  assert.match(err.message, /admin/)
  assert.match(err.message, /--allow-admin/)
})

test('EraseStepError exposes step and table', () => {
  const err = new EraseStepError('anonymize', 'wallet_ledger_entries', 'boom')
  assert.equal(err.name, 'EraseStepError')
  assert.equal(err.step, 'anonymize')
  assert.equal(err.table, 'wallet_ledger_entries')
  assert.match(err.message, /wallet_ledger_entries/)
})

test('EraseStepError handles null table (auth-delete step)', () => {
  const err = new EraseStepError('auth-delete', null, 'auth failure')
  assert.equal(err.step, 'auth-delete')
  assert.equal(err.table, null)
  assert.match(err.message, /auth-delete/)
})

test('EraseVerificationError carries mismatched table list', () => {
  const err = new EraseVerificationError([
    {
      table: 'wallet_ledger_entries',
      rows_affected: 3,
      verification_remaining_for_original: 2,
      verification_sentinel_count: 1,
    },
    {
      table: 'seller_fees',
      rows_affected: 1,
      verification_remaining_for_original: 1,
      verification_sentinel_count: 0,
    },
  ])
  assert.equal(err.name, 'EraseVerificationError')
  assert.equal(err.mismatches.length, 2)
  assert.match(err.message, /wallet_ledger_entries/)
  assert.match(err.message, /seller_fees/)
})

test('sentinel UUID is the all-zeros nil UUID', () => {
  assert.equal(SENTINEL_PROFILE_ID, '00000000-0000-0000-0000-000000000000')
})

// ---------------------------------------------------------------------------
// planErase() — read-only, dry-run plan generation
// ---------------------------------------------------------------------------

test('planErase emits one entry per inventory table with verdict + planned action', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 2

  const { client } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
  })

  const plan = await planErase(client as never, TARGET_PROFILE_ID)
  assert.equal(plan.profile_id, TARGET_PROFILE_ID)
  assert.equal(plan.per_table.length, TABLE_INVENTORY.length)

  for (const row of plan.per_table) {
    const entry = TABLE_INVENTORY.find((e) => e.table === row.table)
    assert.ok(entry, `Inventory entry missing for ${row.table}`)
    assert.equal(row.verdict, entry.verdict)

    if (entry.verdict === 'ANONYMIZE-in-place') {
      assert.equal(row.planned_action, 'ANONYMIZE')
      assert.equal(row.row_count, 2)
    } else if (entry.verdict === 'CASCADE-delete') {
      assert.equal(row.planned_action, 'DELETE')
      assert.equal(row.row_count, 2)
    }
  }
})

test('planErase issues a count query for every ANONYMIZE + CASCADE table', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 0

  const { client, log } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
  })

  await planErase(client as never, TARGET_PROFILE_ID)

  const countCalls = log.operations.filter((op) => op.kind === 'select-count')
  const expectedTables = TABLE_INVENTORY.filter(
    (e) => e.verdict === 'ANONYMIZE-in-place' || e.verdict === 'CASCADE-delete',
  ).map((e) => e.table)

  for (const t of expectedTables) {
    assert.ok(
      countCalls.some((c) => c.table === t),
      `planErase did not issue count for ${t}`,
    )
  }
})

// ---------------------------------------------------------------------------
// eraseUserData() — pre-flight guards
// ---------------------------------------------------------------------------

test('eraseUserData refuses to erase the sentinel profile itself', async () => {
  const { client } = makeHarness({
    targetProfileRow: null,
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable: {},
  })

  await assert.rejects(
    () =>
      eraseUserData(client as never, SENTINEL_PROFILE_ID, {
        reason: 'unit-test',
      }),
    (err: Error) => err instanceof SentinelTargetError,
  )
})

test('eraseUserData refuses when sentinel row is absent (migration not applied)', async () => {
  const { client } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: null,
    rowCountByTable: {},
  })

  await assert.rejects(
    () =>
      eraseUserData(client as never, TARGET_PROFILE_ID, {
        reason: 'unit-test',
      }),
    /sentinel/i,
  )
})

test('eraseUserData refuses admin target without --allow-admin', async () => {
  const { client, log } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'admin@noon.test',
      full_name: 'Admin User',
      role: 'admin',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable: {},
  })

  await assert.rejects(
    () =>
      eraseUserData(client as never, TARGET_PROFILE_ID, {
        reason: 'unit-test',
      }),
    (err: Error) => err instanceof AdminTargetWithoutAllowError,
  )

  // Critical: no ANONYMIZE updates and no auth-delete should have fired.
  const updates = log.operations.filter((op) => op.kind === 'update')
  const authDeletes = log.operations.filter((op) => op.kind === 'auth-delete-user')
  assert.equal(updates.length, 0, 'admin pre-flight failed but UPDATE still ran')
  assert.equal(authDeletes.length, 0, 'admin pre-flight failed but auth-delete still ran')
})

test('eraseUserData allows admin target when allowAdmin=true', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 0

  const { client } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'admin@noon.test',
      full_name: 'Admin User',
      role: 'admin',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
  })

  const result = await eraseUserData(client as never, TARGET_PROFILE_ID, {
    reason: 'unit-test',
    allowAdmin: true,
  })

  assert.equal(result.auth_user_deleted, true)
})

// ---------------------------------------------------------------------------
// eraseUserData() — success path
// ---------------------------------------------------------------------------

test('eraseUserData runs ANONYMIZE pass with sentinel payload and then auth-delete', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 1

  const { client, log } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
  })

  const result = await eraseUserData(client as never, TARGET_PROFILE_ID, {
    reason: 'unit-test',
  })

  // Result shape
  assert.equal(result.profile_id, TARGET_PROFILE_ID)
  assert.equal(result.auth_user_deleted, true)
  assert.ok(result.per_table.length > 0)

  // Every ANONYMIZE-in-place table received an UPDATE with the sentinel payload.
  const updateOps = log.operations.filter((op) => op.kind === 'update')
  for (const entry of ANONYMIZE_TABLES) {
    const tableUpdates = updateOps.filter((op) => op.kind === 'update' && op.table === entry.table) as Array<
      Extract<CallLog['operations'][number], { kind: 'update' }>
    >
    assert.ok(
      tableUpdates.length >= 1,
      `No UPDATE issued for ANONYMIZE table ${entry.table}`,
    )
    // First UPDATE on the table must carry sentinel for the first actor column.
    const firstColumn = entry.actorColumnsToSentinel[0]
    assert.equal(
      tableUpdates[0].payload[firstColumn],
      SENTINEL_PROFILE_ID,
      `${entry.table}.${firstColumn} not set to sentinel in UPDATE payload`,
    )
    // JSONB wipe assertion (wallet_ledger_entries declares metadata).
    for (const jsonbCol of entry.jsonbColumnsToWipe) {
      assert.deepEqual(
        tableUpdates[0].payload[jsonbCol],
        {},
        `${entry.table}.${jsonbCol} not wiped to {} in UPDATE payload`,
      )
    }
  }

  // auth-delete fires exactly once, AFTER all updates.
  const lastUpdate = log.operations
    .map((op, i) => ({ op, i }))
    .filter(({ op }) => op.kind === 'update')
    .pop()
  const authIdx = log.operations.findIndex((op) => op.kind === 'auth-delete-user')
  assert.ok(authIdx >= 0, 'auth-delete-user never invoked')
  assert.ok(
    lastUpdate && authIdx > lastUpdate.i,
    'auth-delete-user invoked BEFORE final UPDATE — ordering violated',
  )
})

test('eraseUserData multi-actor table issues one UPDATE per actor column', async () => {
  // wallet_ledger_entries has actorColumnsToSentinel = ['profile_id', 'actor_profile_id'].
  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 0
  rowCountByTable['wallet_ledger_entries'] = 5

  const { client, log } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
  })

  await eraseUserData(client as never, TARGET_PROFILE_ID, { reason: 'unit-test' })

  const wleUpdates = log.operations.filter(
    (op) => op.kind === 'update' && op.table === 'wallet_ledger_entries',
  ) as Array<Extract<CallLog['operations'][number], { kind: 'update' }>>

  // Two actor columns → two UPDATEs.
  assert.equal(wleUpdates.length, 2)

  const filterCols = wleUpdates.map((u) => u.col).sort()
  assert.deepEqual(filterCols, ['actor_profile_id', 'profile_id'])

  // Only the first UPDATE should carry the JSONB wipe (metadata = {}).
  const updateWithMetadataWipe = wleUpdates.filter((u) => 'metadata' in u.payload)
  assert.equal(
    updateWithMetadataWipe.length,
    1,
    'JSONB metadata wipe duplicated across actor-column passes',
  )
})

// ---------------------------------------------------------------------------
// eraseUserData() — the load-bearing safeguard test
// ---------------------------------------------------------------------------

test('eraseUserData does NOT invoke auth.admin.deleteUser if any ANONYMIZE step fails (Backend D7 relaxation safeguard)', async () => {
  // Failure injection: the third ANONYMIZE table fails.
  // The mock returns `error` on .update().eq().select() for the chosen table.
  const failingTable = ANONYMIZE_TABLES[2].table

  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 1

  const { client, log } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
    failOnUpdate: new Set([failingTable]),
  })

  await assert.rejects(
    () =>
      eraseUserData(client as never, TARGET_PROFILE_ID, {
        reason: 'unit-test',
      }),
    (err: Error) => {
      assert.ok(err instanceof EraseStepError, `Expected EraseStepError, got ${err.name}`)
      assert.equal((err as EraseStepError).step, 'anonymize')
      assert.equal((err as EraseStepError).table, failingTable)
      return true
    },
  )

  // CRITICAL: auth.admin.deleteUser must NOT have fired.
  const authDeletes = log.operations.filter((op) => op.kind === 'auth-delete-user')
  assert.equal(
    authDeletes.length,
    0,
    `auth.admin.deleteUser fired despite mid-ANONYMIZE failure on ${failingTable}. ` +
      'This breaks the Backend transactional-relaxation safeguard (ADR-019 §D7 mitigation).',
  )

  // Sanity: prior ANONYMIZE tables WERE updated (best-effort sequential).
  const updates = log.operations.filter((op) => op.kind === 'update')
  const updatedTables = new Set(updates.map((op) => (op as { table: string }).table))
  assert.ok(
    updatedTables.has(ANONYMIZE_TABLES[0].table),
    'First ANONYMIZE table was not touched before failure',
  )
  assert.ok(
    updatedTables.has(ANONYMIZE_TABLES[1].table),
    'Second ANONYMIZE table was not touched before failure',
  )
  // The failing table issued an UPDATE that errored (no log entry pushed).
  assert.ok(
    !updatedTables.has(failingTable),
    `Failing table ${failingTable} should NOT appear in successful-update log`,
  )
})

test('eraseUserData re-run after partial failure can proceed when prior anonymized rows persist (idempotence shape)', async () => {
  // Simulate a re-run AFTER the failing table's rows still reference the
  // original profile-id (the failed UPDATE never committed). The harness
  // treats the failure as transient (failOnUpdate empty on re-run) and
  // verifies the run completes.
  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 1

  const { client, log } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
    // No failures injected — second-pass simulation.
  })

  const result = await eraseUserData(client as never, TARGET_PROFILE_ID, {
    reason: 'unit-test re-run',
  })

  // Every ANONYMIZE table received an UPDATE — re-running anonymizes the
  // remaining rows because the helper still finds them via filterColumn=originalId.
  for (const entry of ANONYMIZE_TABLES) {
    const tableUpdates = log.operations.filter(
      (op) => op.kind === 'update' && op.table === entry.table,
    )
    assert.ok(
      tableUpdates.length >= 1,
      `Re-run did not anonymize ${entry.table}`,
    )
  }
  assert.equal(result.auth_user_deleted, true)
})

// ---------------------------------------------------------------------------
// eraseUserData() — verification mismatch
// ---------------------------------------------------------------------------

test('eraseUserData throws EraseVerificationError if any table still references original profile-id after erase', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 1

  // wallet_ledger_entries reports 2 rows still referencing the original
  // profile-id at verification time (e.g., a concurrent insert during the run).
  const { client } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
    remainingForOriginalByTable: { wallet_ledger_entries: 2 },
  })

  await assert.rejects(
    () =>
      eraseUserData(client as never, TARGET_PROFILE_ID, {
        reason: 'unit-test verification mismatch',
      }),
    (err: Error) => {
      assert.ok(err instanceof EraseVerificationError)
      const mismatches = (err as EraseVerificationError).mismatches
      assert.equal(mismatches.length, 1)
      assert.equal(mismatches[0].table, 'wallet_ledger_entries')
      assert.equal(mismatches[0].verification_remaining_for_original, 2)
      return true
    },
  )
})

test('eraseUserData throws EraseStepError(auth-delete) when auth.admin.deleteUser errors', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of TABLE_INVENTORY) rowCountByTable[entry.table] = 0

  const { client } = makeHarness({
    targetProfileRow: {
      id: TARGET_PROFILE_ID,
      email: 'tester@noon.test',
      full_name: 'Pedro Tester',
      role: 'sales',
    },
    sentinelRow: { id: SENTINEL_PROFILE_ID, email: SENTINEL_EMAIL, is_active: false },
    rowCountByTable,
    authDeleteError: { message: 'user_not_found' },
  })

  await assert.rejects(
    () =>
      eraseUserData(client as never, TARGET_PROFILE_ID, { reason: 'unit-test' }),
    (err: Error) => {
      assert.ok(err instanceof EraseStepError)
      assert.equal((err as EraseStepError).step, 'auth-delete')
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Live-DB / integration coverage marker
// ---------------------------------------------------------------------------

// Live-DB round-trip (apply migration 0057, seed synthetic profile across the
// full inventory, run export, run erase --execute, verify post-state) is
// covered by the manual procedure documented in
// `docs/handoffs/2026-05-21-b16-gdpr-integration-manual.md`.
// Local Supabase (`npx supabase start`) is unavailable in this environment
// (Docker not present); the manual procedure runs against a dev/staging
// Supabase project at operator discretion.
