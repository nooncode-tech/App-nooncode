/**
 * Unit tests — lib/server/gdpr/export.ts
 *
 * Coverage:
 *  - resolveProfileIdByEmail: row found, row missing, case normalization, error surfacing.
 *  - countExportRows: sums + empty-artefact baseline.
 *  - ProfileNotFoundError shape.
 *  - exportUserData(): the full artefact assembly path against a mocked
 *    multi-table Supabase client. Asserts that EVERY EXPORT_TABLES entry
 *    appears in the artefact, that multi-FK tables apply OR-across-columns,
 *    that the metadata snapshot captures email + full_name + ticket_ref,
 *    and that table read failures surface as ExportTableReadError with the
 *    table name in the message.
 *
 * The full live-DB round-trip (seed → export → erase → verify) is documented
 * in `docs/handoffs/2026-05-21-b16-gdpr-integration-manual.md`; local Supabase
 * is unavailable in this environment.
 *
 * @see lib/server/gdpr/export.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EXPORT_SCHEMA_VERSION,
  ExportTableReadError,
  ProfileNotFoundError,
  countExportRows,
  exportUserData,
  resolveProfileIdByEmail,
} from '@/lib/server/gdpr/export'
import { EXPORT_TABLES } from '@/lib/server/gdpr/inventory'

const TARGET_PROFILE_ID = '22222222-2222-4222-8222-222222222222'

// ---------------------------------------------------------------------------
// resolveProfileIdByEmail
// ---------------------------------------------------------------------------

function makeEmailLookupClient(opts: {
  data?: { id: string } | null
  error?: { message: string } | null
}) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = () =>
    Promise.resolve({ data: opts.data ?? null, error: opts.error ?? null })
  return {
    from: () => chain,
  }
}

test('resolveProfileIdByEmail returns the id when row exists', async () => {
  const client = makeEmailLookupClient({
    data: { id: '11111111-1111-4111-8111-111111111111' },
    error: null,
  })
  const id = await resolveProfileIdByEmail(client as never, 'foo@bar.test')
  assert.equal(id, '11111111-1111-4111-8111-111111111111')
})

test('resolveProfileIdByEmail returns null when no row matches', async () => {
  const client = makeEmailLookupClient({ data: null, error: null })
  const id = await resolveProfileIdByEmail(client as never, 'missing@bar.test')
  assert.equal(id, null)
})

test('resolveProfileIdByEmail normalizes case', async () => {
  let capturedEmail = ''
  const chain: Record<string, (...args: unknown[]) => unknown> = {}
  chain.select = () => chain
  chain.eq = (_col: unknown, value: unknown) => {
    capturedEmail = String(value)
    return chain
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
  const client = { from: () => chain }

  await resolveProfileIdByEmail(client as never, 'FoO@BaR.Test')
  assert.equal(capturedEmail, 'foo@bar.test')
})

test('resolveProfileIdByEmail throws on Supabase error', async () => {
  const client = makeEmailLookupClient({
    data: null,
    error: { message: 'permission denied' },
  })
  await assert.rejects(
    () => resolveProfileIdByEmail(client as never, 'foo@bar.test'),
    /permission denied/,
  )
})

// ---------------------------------------------------------------------------
// countExportRows
// ---------------------------------------------------------------------------

test('countExportRows sums row arrays across tables', () => {
  const total = countExportRows({
    gdpr_export_metadata: {
      schema_version: EXPORT_SCHEMA_VERSION,
      generated_at_utc: '2026-05-21T00:00:00.000Z',
      profile_id: '11111111-1111-4111-8111-111111111111',
      email_at_export_time: 'x@y.test',
      full_name_at_export_time: 'X Y',
      ticket_ref: null,
      inventory_tables_covered: ['user_profiles', 'wallet_ledger_entries'],
    },
    tables: {
      user_profiles: [{}],
      wallet_ledger_entries: [{}, {}, {}],
      seller_fees: [],
    },
  })

  assert.equal(total, 4)
})

test('countExportRows returns 0 for empty artefact', () => {
  const total = countExportRows({
    gdpr_export_metadata: {
      schema_version: EXPORT_SCHEMA_VERSION,
      generated_at_utc: '2026-05-21T00:00:00.000Z',
      profile_id: '11111111-1111-4111-8111-111111111111',
      email_at_export_time: 'x@y.test',
      full_name_at_export_time: 'X Y',
      ticket_ref: null,
      inventory_tables_covered: [],
    },
    tables: {},
  })

  assert.equal(total, 0)
})

// ---------------------------------------------------------------------------
// ProfileNotFoundError shape
// ---------------------------------------------------------------------------

test('ProfileNotFoundError carries the identifier in the message', () => {
  const err = new ProfileNotFoundError('foo@bar.test')
  assert.equal(err.name, 'ProfileNotFoundError')
  assert.match(err.message, /foo@bar\.test/)
})

// ---------------------------------------------------------------------------
// exportUserData() — full artefact assembly
// ---------------------------------------------------------------------------

interface ExportHarnessConfig {
  /** Profile snapshot row returned for the parent user_profiles read. */
  profileRow: { email: string; full_name: string } | null
  /** Per-table row counts to return on `.or(...)`. */
  rowCountByTable: Record<string, number>
  /** Tables that should error on `.or(...)`. */
  failOnRead?: Set<string>
}

function makeExportHarness(config: ExportHarnessConfig) {
  const orCalls: Array<{ table: string; expr: string }> = []

  function chainForTable(table: string) {
    return {
      select: (_cols: string) => {
        const selectChain: Record<string, unknown> = {}

        // .eq().maybeSingle() — used by readProfileSnapshot
        selectChain.eq = () => ({
          maybeSingle: async () => {
            if (table === 'user_profiles') {
              return { data: config.profileRow, error: null }
            }
            return { data: null, error: null }
          },
        })

        // .or() — used by readTableRowsForProfile
        selectChain.or = async (expr: string) => {
          orCalls.push({ table, expr })
          if (config.failOnRead?.has(table)) {
            return { data: null, error: { message: `read failed on ${table}` } }
          }
          const n = config.rowCountByTable[table] ?? 0
          const data = Array.from({ length: n }, (_, i) => ({
            __row: i,
            __table: table,
          }))
          return { data, error: null }
        }

        return selectChain
      },
    }
  }

  const client = {
    from: (table: string) => chainForTable(table),
  }

  return { client, orCalls }
}

test('exportUserData covers every EXPORT_TABLES entry in artefact.tables', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of EXPORT_TABLES) {
    rowCountByTable[entry.table] = 1
  }

  const { client } = makeExportHarness({
    profileRow: { email: 'tester@noon.test', full_name: 'Pedro Tester' },
    rowCountByTable,
  })

  const artefact = await exportUserData(client as never, TARGET_PROFILE_ID, {
    ticketRef: 'TKT-123',
  })

  // Metadata shape
  assert.equal(artefact.gdpr_export_metadata.schema_version, EXPORT_SCHEMA_VERSION)
  assert.equal(artefact.gdpr_export_metadata.profile_id, TARGET_PROFILE_ID)
  assert.equal(artefact.gdpr_export_metadata.email_at_export_time, 'tester@noon.test')
  assert.equal(artefact.gdpr_export_metadata.full_name_at_export_time, 'Pedro Tester')
  assert.equal(artefact.gdpr_export_metadata.ticket_ref, 'TKT-123')

  // CRITICAL: every EXPORT_TABLES table appears in the artefact and in the
  // inventory_tables_covered list.
  for (const entry of EXPORT_TABLES) {
    assert.ok(
      entry.table in artefact.tables,
      `Artefact tables missing inventory entry: ${entry.table}`,
    )
    assert.equal(
      artefact.tables[entry.table].length,
      1,
      `Artefact tables[${entry.table}] should contain the seeded row`,
    )
    assert.ok(
      artefact.gdpr_export_metadata.inventory_tables_covered.includes(entry.table),
      `inventory_tables_covered missing: ${entry.table}`,
    )
  }

  // Total row count matches expected.
  assert.equal(countExportRows(artefact), EXPORT_TABLES.length)
})

test('exportUserData applies OR-across-columns for multi-FK tables', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of EXPORT_TABLES) rowCountByTable[entry.table] = 0

  const { client, orCalls } = makeExportHarness({
    profileRow: { email: 'tester@noon.test', full_name: 'Pedro Tester' },
    rowCountByTable,
  })

  await exportUserData(client as never, TARGET_PROFILE_ID, {})

  // wallet_ledger_entries has filterColumn=profile_id, additional=actor_profile_id
  const wleCall = orCalls.find((c) => c.table === 'wallet_ledger_entries')
  assert.ok(wleCall, 'wallet_ledger_entries was not read')
  assert.match(wleCall.expr, /profile_id\.eq\.22222222/)
  assert.match(wleCall.expr, /actor_profile_id\.eq\.22222222/)

  // withdrawal_requests has filterColumn=actor_id, additional=processed_by_id
  const wrCall = orCalls.find((c) => c.table === 'withdrawal_requests')
  assert.ok(wrCall, 'withdrawal_requests was not read')
  assert.match(wrCall.expr, /actor_id\.eq\.22222222/)
  assert.match(wrCall.expr, /processed_by_id\.eq\.22222222/)
})

test('exportUserData throws ProfileNotFoundError when parent user_profiles row is missing', async () => {
  const { client } = makeExportHarness({
    profileRow: null,
    rowCountByTable: {},
  })

  await assert.rejects(
    () => exportUserData(client as never, TARGET_PROFILE_ID, {}),
    (err: Error) => err instanceof ProfileNotFoundError,
  )
})

test('exportUserData wraps per-table read errors as ExportTableReadError with the table name', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of EXPORT_TABLES) rowCountByTable[entry.table] = 0

  const { client } = makeExportHarness({
    profileRow: { email: 'tester@noon.test', full_name: 'Pedro Tester' },
    rowCountByTable,
    failOnRead: new Set(['wallet_ledger_entries']),
  })

  await assert.rejects(
    () => exportUserData(client as never, TARGET_PROFILE_ID, {}),
    (err: Error) => {
      assert.ok(err instanceof ExportTableReadError)
      assert.match(err.message, /wallet_ledger_entries/)
      return true
    },
  )
})

test('exportUserData defaults ticket_ref to null when not provided', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of EXPORT_TABLES) rowCountByTable[entry.table] = 0

  const { client } = makeExportHarness({
    profileRow: { email: 'tester@noon.test', full_name: 'Pedro Tester' },
    rowCountByTable,
  })

  const artefact = await exportUserData(client as never, TARGET_PROFILE_ID, {})
  assert.equal(artefact.gdpr_export_metadata.ticket_ref, null)
})

test('exportUserData emits an ISO-8601 timestamp at second precision or finer', async () => {
  const rowCountByTable: Record<string, number> = {}
  for (const entry of EXPORT_TABLES) rowCountByTable[entry.table] = 0

  const { client } = makeExportHarness({
    profileRow: { email: 'tester@noon.test', full_name: 'Pedro Tester' },
    rowCountByTable,
  })

  const before = Date.now()
  const artefact = await exportUserData(client as never, TARGET_PROFILE_ID, {})
  const after = Date.now()

  const ts = artefact.gdpr_export_metadata.generated_at_utc
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)

  const parsed = Date.parse(ts)
  assert.ok(parsed >= before && parsed <= after, 'generated_at_utc outside test window')
})

// ---------------------------------------------------------------------------
// Live-DB / integration coverage marker
// ---------------------------------------------------------------------------

// Round-trip with a real seeded profile (every inventory table populated +
// every row appearing in the artefact) is covered by the manual procedure
// documented in `docs/handoffs/2026-05-21-b16-gdpr-integration-manual.md`.
