import assert from 'node:assert/strict'
import test from 'node:test'

import {
  diffMigrations,
  filenameToSlug,
  type MigrationsLedgerRow,
} from '@/lib/server/migrations/health'
import {
  EXPECTED_ORPHAN_LEDGER_NAMES,
  KNOWN_COLLISION_FILES,
} from '@/lib/server/migrations/known-exceptions.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the steady-state production fixture: 51 disk files, 53 ledger rows,
 * 4 grandfathered collisions on disk (intentionally absent from ledger),
 * 6 expected orphans in ledger (intentionally absent from disk).
 *
 * The exact numbers track the ADR-014 reconciled baseline + B15 close-out
 * (2026-05-20). They are the smoke-target for the production deploy.
 */
function buildSteadyStateFixture() {
  // 51 disk files: 0001..0027 (with the 4 grandfathered prefix doubles at
  // 0024/0025/0026/0027) + 0028..0051 = 23 + 8 + 24 = 55 — but ADR/spec
  // model this as 51 by treating the 4 grandfathered files as "intentional
  // extras". For test purity we just enumerate 51 actual files where 4 are
  // the grandfathered set on disk + 47 are "regular" (each present in the
  // ledger).
  const grandfatheredFiles = [
    '0024_phase_5a_prototype_settings_admin_write.sql',
    '0025_phase_3a_leads_geo_location.sql',
    '0026_phase_9a_stripe_payments.sql',
    '0027_phase_10a_commissions.sql',
  ]
  const regularFiles: string[] = []
  for (let i = 1; i <= 47; i++) {
    const prefix = String(i).padStart(4, '0')
    regularFiles.push(`${prefix}_phase_test_regular_${i}.sql`)
  }
  const files = [...regularFiles, ...grandfatheredFiles]

  const expectedOrphanNames = [
    'phase_4b_payment_columns',
    'phase_5_stripe_connect',
    'phase_7_client_workspace',
    'phase_7b_resolve_token_update',
    'phase_8_lead_whatsapp',
    'phase_11_lead_auto_followup',
  ]

  // 53 ledger rows: 47 "regular" rows matching the 47 regular files +
  // 6 expected orphans. (The 4 grandfathered files have NO ledger rows.)
  const rows: MigrationsLedgerRow[] = regularFiles.map((file) => ({
    version: file.slice(0, 4),
    name: filenameToSlug(file),
  }))
  for (const name of expectedOrphanNames) {
    rows.push({ version: '20260101000000', name })
  }

  const grandfathered = new Set(grandfatheredFiles)
  const expectedOrphans = new Set(expectedOrphanNames)

  return { files, rows, grandfathered, expectedOrphans }
}

// ---------------------------------------------------------------------------
// filenameToSlug
// ---------------------------------------------------------------------------

test('filenameToSlug strips a 4-digit prefix and .sql extension', () => {
  assert.equal(
    filenameToSlug('0051_phase_20a_website_webhook_event_ledger.sql'),
    'phase_20a_website_webhook_event_ledger',
  )
})

test('filenameToSlug handles a filename without a 4-digit prefix defensively', () => {
  assert.equal(filenameToSlug('phase_loose_naming.sql'), 'phase_loose_naming')
})

test('filenameToSlug handles a filename without .sql extension defensively', () => {
  assert.equal(filenameToSlug('0001_phase_1a_auth_profiles'), 'phase_1a_auth_profiles')
})

// ---------------------------------------------------------------------------
// diffMigrations — 7 mandatory edge cases (spec §Included)
// ---------------------------------------------------------------------------

test('diffMigrations: steady state — 51 disk, 53 ledger, 4 grandfathered, 6 expected orphans → synced', () => {
  const { files, rows, grandfathered, expectedOrphans } = buildSteadyStateFixture()
  const result = diffMigrations(files, rows, grandfathered, expectedOrphans)

  assert.equal(result.synced, true)
  assert.equal(result.summary.filesystem_count, 51)
  assert.equal(result.summary.ledger_count, 53)
  assert.equal(result.summary.grandfathered_collisions_count, 4)
  assert.equal(result.summary.expected_orphans_count, 6)
  assert.equal(result.summary.unexpected_drift_count, 0)
  assert.equal(result.summary.missing_in_ledger_count, 0)
  assert.deepEqual(result.missing_in_ledger, [])
  assert.deepEqual(result.unexpected_drift_orphans, [])
  assert.equal(result.grandfathered_collisions.length, 4)
  assert.equal(result.expected_orphans.length, 6)
  // Sorted lexically.
  assert.deepEqual(
    result.grandfathered_collisions,
    [
      '0024_phase_5a_prototype_settings_admin_write.sql',
      '0025_phase_3a_leads_geo_location.sql',
      '0026_phase_9a_stripe_payments.sql',
      '0027_phase_10a_commissions.sql',
    ],
  )
  assert.deepEqual(
    result.expected_orphans,
    [
      'phase_11_lead_auto_followup',
      'phase_4b_payment_columns',
      'phase_5_stripe_connect',
      'phase_7_client_workspace',
      'phase_7b_resolve_token_update',
      'phase_8_lead_whatsapp',
    ],
  )
})

test('diffMigrations: empty filesystem AND empty ledger → synced with zero counts', () => {
  const result = diffMigrations([], [], new Set(), new Set())

  assert.equal(result.synced, true)
  assert.equal(result.summary.filesystem_count, 0)
  assert.equal(result.summary.ledger_count, 0)
  assert.equal(result.summary.grandfathered_collisions_count, 0)
  assert.equal(result.summary.expected_orphans_count, 0)
  assert.equal(result.summary.unexpected_drift_count, 0)
  assert.equal(result.summary.missing_in_ledger_count, 0)
  assert.deepEqual(result.missing_in_ledger, [])
  assert.deepEqual(result.unexpected_drift_orphans, [])
  assert.deepEqual(result.grandfathered_collisions, [])
  assert.deepEqual(result.expected_orphans, [])
})

test('diffMigrations: empty filesystem with non-empty ledger → ledger rows surface as unexpected_drift_orphans (drift)', () => {
  const rows: MigrationsLedgerRow[] = [
    { version: '0001', name: 'phase_1a_auth_profiles' },
    { version: '0002', name: 'phase_2a_leads' },
  ]

  const result = diffMigrations([], rows, new Set(), new Set())

  assert.equal(result.synced, false)
  assert.equal(result.summary.filesystem_count, 0)
  assert.equal(result.summary.ledger_count, 2)
  assert.equal(result.summary.unexpected_drift_count, 2)
  assert.equal(result.summary.missing_in_ledger_count, 0)
  assert.deepEqual(result.unexpected_drift_orphans, ['phase_1a_auth_profiles', 'phase_2a_leads'])
})

test('diffMigrations: empty ledger with non-empty filesystem → disk files surface as missing_in_ledger (drift)', () => {
  const files = [
    '0001_phase_1a_auth_profiles.sql',
    '0002_phase_2a_leads.sql',
  ]

  const result = diffMigrations(files, [], new Set(), new Set())

  assert.equal(result.synced, false)
  assert.equal(result.summary.filesystem_count, 2)
  assert.equal(result.summary.ledger_count, 0)
  assert.equal(result.summary.unexpected_drift_count, 2)
  assert.equal(result.summary.missing_in_ledger_count, 2)
  assert.deepEqual(result.missing_in_ledger, [
    '0001_phase_1a_auth_profiles.sql',
    '0002_phase_2a_leads.sql',
  ])
})

test('diffMigrations: allowlist file present in ledger anyway is silently absorbed (no drift)', () => {
  // A grandfathered file (`0024_phase_5a_prototype_settings_admin_write.sql`)
  // is present on disk AND its slug is in the ledger. The classifier must
  // NOT report it as drift; the matched-on-disk-and-in-ledger case wins
  // regardless of allowlist intent.
  const file = '0024_phase_5a_prototype_settings_admin_write.sql'
  const files = [file]
  const rows: MigrationsLedgerRow[] = [
    { version: '0024', name: 'phase_5a_prototype_settings_admin_write' },
  ]
  const grandfathered = new Set([file])

  const result = diffMigrations(files, rows, grandfathered, new Set())

  assert.equal(result.synced, true)
  assert.deepEqual(result.missing_in_ledger, [])
  assert.deepEqual(result.unexpected_drift_orphans, [])
  // The grandfathered_collisions bucket only contains files that are on
  // disk AND have no matching ledger row. Since this file matches, it's
  // not in either bucket.
  assert.deepEqual(result.grandfathered_collisions, [])
  assert.equal(result.summary.unexpected_drift_count, 0)
})

test('diffMigrations: expected-orphan file appears on disk later → reclassified as a regular matched file', () => {
  // Operator authored a placeholder SQL file for what was previously an
  // expected orphan. The endpoint must NOT keep flagging the row as an
  // expected orphan; it's now a regular match.
  const file = '0052_phase_4b_payment_columns.sql'
  const files = [file]
  const rows: MigrationsLedgerRow[] = [
    { version: '20260101000000', name: 'phase_4b_payment_columns' },
  ]
  const expectedOrphans = new Set(['phase_4b_payment_columns'])

  const result = diffMigrations(files, rows, new Set(), expectedOrphans)

  assert.equal(result.synced, true)
  // The expected_orphans array is empty because the slug now matches a disk
  // file — it's no longer an orphan.
  assert.deepEqual(result.expected_orphans, [])
  assert.equal(result.summary.expected_orphans_count, 0)
  assert.deepEqual(result.missing_in_ledger, [])
  assert.deepEqual(result.unexpected_drift_orphans, [])
})

test('diffMigrations: unknown extra orphan in ledger → unexpected_drift_orphans + synced=false', () => {
  // A ledger row whose name is neither matched by a disk file nor in the
  // expected-orphan set is real drift.
  const files = ['0001_phase_1a_auth_profiles.sql']
  const rows: MigrationsLedgerRow[] = [
    { version: '0001', name: 'phase_1a_auth_profiles' },
    { version: '20240101000000', name: 'phase_unknown_legacy' },
  ]

  const result = diffMigrations(files, rows, new Set(), new Set())

  assert.equal(result.synced, false)
  assert.deepEqual(result.unexpected_drift_orphans, ['phase_unknown_legacy'])
  assert.equal(result.summary.unexpected_drift_count, 1)
  assert.equal(result.summary.missing_in_ledger_count, 0)
})

test('diffMigrations: new disk file not in ledger AND not grandfathered → missing_in_ledger + synced=false', () => {
  // A new migration file the operator forgot to register in the ledger
  // (the B15 / 0051 manual-apply hazard).
  const files = [
    '0001_phase_1a_auth_profiles.sql',
    '0052_phase_21a_new_unregistered.sql',
  ]
  const rows: MigrationsLedgerRow[] = [
    { version: '0001', name: 'phase_1a_auth_profiles' },
  ]

  const result = diffMigrations(files, rows, new Set(), new Set())

  assert.equal(result.synced, false)
  assert.deepEqual(result.missing_in_ledger, ['0052_phase_21a_new_unregistered.sql'])
  assert.equal(result.summary.unexpected_drift_count, 1)
  assert.equal(result.summary.missing_in_ledger_count, 1)
  assert.deepEqual(result.unexpected_drift_orphans, [])
})

test('diffMigrations: new disk file not in ledger BUT in KNOWN_COLLISION_FILES → grandfathered, NOT drift', () => {
  // The 4 grandfathered files per ADR-006 §B2 are intentionally absent
  // from the ledger. They MUST surface as grandfathered_collisions, NOT
  // as missing_in_ledger.
  const file = '0024_phase_5a_prototype_settings_admin_write.sql'
  const files = ['0001_phase_1a_auth_profiles.sql', file]
  const rows: MigrationsLedgerRow[] = [
    { version: '0001', name: 'phase_1a_auth_profiles' },
  ]
  const grandfathered = new Set([file])

  const result = diffMigrations(files, rows, grandfathered, new Set())

  assert.equal(result.synced, true)
  assert.deepEqual(result.grandfathered_collisions, [file])
  assert.equal(result.summary.grandfathered_collisions_count, 1)
  assert.deepEqual(result.missing_in_ledger, [])
  assert.equal(result.summary.unexpected_drift_count, 0)
})

// ---------------------------------------------------------------------------
// Shared-module sanity (D1)
// ---------------------------------------------------------------------------

test('KNOWN_COLLISION_FILES exposes exactly the 8 ADR-006 §B2 filenames', () => {
  // Sanity check: shared module is the single source of truth. If a future
  // edit accidentally changes the set, this assertion catches it before
  // the CI script's behavior diverges from the health endpoint's.
  assert.equal(KNOWN_COLLISION_FILES.size, 8)
  assert.equal(KNOWN_COLLISION_FILES.has('0024_phase_3a_monetary_wallet_foundation.sql'), true)
  assert.equal(KNOWN_COLLISION_FILES.has('0024_phase_5a_prototype_settings_admin_write.sql'), true)
  assert.equal(KNOWN_COLLISION_FILES.has('0025_phase_3a_bridge_wallet_compatibility.sql'), true)
  assert.equal(KNOWN_COLLISION_FILES.has('0025_phase_3a_leads_geo_location.sql'), true)
  assert.equal(KNOWN_COLLISION_FILES.has('0026_phase_3b_earnings_backend.sql'), true)
  assert.equal(KNOWN_COLLISION_FILES.has('0026_phase_9a_stripe_payments.sql'), true)
  assert.equal(KNOWN_COLLISION_FILES.has('0027_phase_10a_commissions.sql'), true)
  assert.equal(KNOWN_COLLISION_FILES.has('0027_phase_3_proposal_lifecycle.sql'), true)
})

test('EXPECTED_ORPHAN_LEDGER_NAMES exposes the 6 ADR-014 §Orphans names + the 2026-05-30 addendum orphan', () => {
  assert.equal(EXPECTED_ORPHAN_LEDGER_NAMES.size, 7)
  assert.equal(EXPECTED_ORPHAN_LEDGER_NAMES.has('phase_4b_payment_columns'), true)
  assert.equal(EXPECTED_ORPHAN_LEDGER_NAMES.has('phase_5_stripe_connect'), true)
  assert.equal(EXPECTED_ORPHAN_LEDGER_NAMES.has('phase_7_client_workspace'), true)
  assert.equal(EXPECTED_ORPHAN_LEDGER_NAMES.has('phase_7b_resolve_token_update'), true)
  assert.equal(EXPECTED_ORPHAN_LEDGER_NAMES.has('phase_8_lead_whatsapp'), true)
  assert.equal(EXPECTED_ORPHAN_LEDGER_NAMES.has('phase_11_lead_auto_followup'), true)
  // ADR-014 §Addendum 2026-05-30: alerted_at follow-up applied 2026-05-26 as its
  // own ledger row, folded into 0062_phase_3r5_outbound_webhook_events.sql.
  assert.equal(EXPECTED_ORPHAN_LEDGER_NAMES.has('phase_3r5_outbound_webhook_events_alerted_at'), true)
})
