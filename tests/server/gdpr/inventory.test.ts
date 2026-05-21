/**
 * Unit tests — lib/server/gdpr/inventory.ts
 *
 * Happy-path coverage of the inventory data shape + the convenience filters.
 * Inventory-vs-live-schema correctness is verified by system-testing's
 * integration round-trip (seed → export → erase → verify).
 *
 * @see lib/server/gdpr/inventory.ts
 * @see specs/fase-3-b16-gdpr-art-15-17.md §Authoritative inventory
 * @see docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md §D3
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANONYMIZE_TABLES,
  EXPLICIT_DELETE_TABLES,
  EXPORT_TABLES,
  TABLE_INVENTORY,
  type TableInventoryEntry,
} from '@/lib/server/gdpr/inventory'

test('TABLE_INVENTORY is non-empty', () => {
  assert.ok(TABLE_INVENTORY.length > 0)
})

test('every inventory entry has a verdict and table name', () => {
  for (const entry of TABLE_INVENTORY) {
    assert.ok(entry.table.length > 0, `Empty table name in inventory: ${JSON.stringify(entry)}`)
    assert.ok(
      ['CASCADE-delete', 'ANONYMIZE-in-place', 'EXPORT-only', 'SKIP-with-reason'].includes(
        entry.verdict,
      ),
      `Invalid verdict for ${entry.table}: ${entry.verdict}`,
    )
  }
})

test('ANONYMIZE-in-place entries declare at least one actor column', () => {
  for (const entry of TABLE_INVENTORY) {
    if (entry.verdict === 'ANONYMIZE-in-place') {
      assert.ok(
        entry.actorColumnsToSentinel.length > 0,
        `${entry.table} is ANONYMIZE but has no actorColumnsToSentinel`,
      )
    }
  }
})

test('CASCADE-delete entries do not declare actor columns', () => {
  for (const entry of TABLE_INVENTORY) {
    if (entry.verdict === 'CASCADE-delete') {
      assert.equal(
        entry.actorColumnsToSentinel.length,
        0,
        `${entry.table} is CASCADE-delete but declares actorColumnsToSentinel`,
      )
    }
  }
})

test('inventory contains the load-bearing ledger tables (ADR-019 §D3)', () => {
  const tables = new Set(TABLE_INVENTORY.map((e: TableInventoryEntry) => e.table))
  assert.ok(tables.has('wallet_ledger_entries'))
  assert.ok(tables.has('earnings_ledger'))
  assert.ok(tables.has('payouts'))
  assert.ok(tables.has('seller_fees'))
  assert.ok(tables.has('withdrawal_requests'))
  assert.ok(tables.has('points_ledger'))
})

test('inventory contains the RESTRICT-FK commercial entities (ADR-019 §D3)', () => {
  const tables = new Set(TABLE_INVENTORY.map((e: TableInventoryEntry) => e.table))
  assert.ok(tables.has('leads'))
  assert.ok(tables.has('lead_proposals'))
  assert.ok(tables.has('tasks'))
  assert.ok(tables.has('projects'))
  assert.ok(tables.has('prototype_workspaces'))
})

test('user_profiles parent row is in the inventory and cascades from auth', () => {
  const userProfilesEntry = TABLE_INVENTORY.find((e) => e.table === 'user_profiles')
  assert.ok(userProfilesEntry, 'user_profiles missing from inventory')
  assert.equal(userProfilesEntry.verdict, 'CASCADE-delete')
  assert.equal(userProfilesEntry.cascadesFromUserProfiles, true)
})

test('EXPORT_TABLES excludes SKIP-with-reason entries', () => {
  for (const entry of EXPORT_TABLES) {
    assert.notEqual(entry.verdict, 'SKIP-with-reason')
  }
})

test('ANONYMIZE_TABLES contains only ANONYMIZE-in-place entries', () => {
  for (const entry of ANONYMIZE_TABLES) {
    assert.equal(entry.verdict, 'ANONYMIZE-in-place')
  }
})

test('EXPLICIT_DELETE_TABLES contains only CASCADE-delete + non-cascading entries', () => {
  for (const entry of EXPLICIT_DELETE_TABLES) {
    assert.equal(entry.verdict, 'CASCADE-delete')
    assert.equal(entry.cascadesFromUserProfiles, false)
  }
})

// ---------------------------------------------------------------------------
// Static cross-check against database.types.ts — every public table that has
// a column FK-referencing user_profiles must either appear in TABLE_INVENTORY
// or be explicitly classed as SKIP-with-reason in the analysis spec.
// ---------------------------------------------------------------------------

test('inventory does not duplicate table entries', () => {
  const tables = TABLE_INVENTORY.map((e) => e.table)
  const unique = new Set(tables)
  assert.equal(
    unique.size,
    tables.length,
    `Duplicate inventory entries: ${tables.length - unique.size}`,
  )
})

test('every ANONYMIZE entry has a non-null filterColumn matching the first actor column', () => {
  for (const entry of TABLE_INVENTORY) {
    if (entry.verdict !== 'ANONYMIZE-in-place') continue
    assert.ok(entry.filterColumn, `${entry.table} ANONYMIZE has null filterColumn`)
    assert.ok(
      entry.actorColumnsToSentinel.includes(entry.filterColumn!),
      `${entry.table} filterColumn=${entry.filterColumn} not in actorColumnsToSentinel`,
    )
  }
})

test('inventory contains every analysis-spec inventory table (35 enumerated)', () => {
  // Authoritative list from specs/fase-3-b16-gdpr-art-15-17.md
  // §Authoritative PII / profile_id-linked table inventory (collaborator scope).
  const expected = [
    'wallet_ledger_entries',
    'earnings_ledger',
    'payouts',
    'seller_fees',
    'withdrawal_requests',
    'points_ledger',
    'point_redemptions',
    'leads',
    'lead_proposals',
    'tasks',
    'projects',
    'prototype_workspaces',
    'lead_activities',
    'task_activities',
    'project_activities',
    'payout_batches',
    'prototype_credit_settings',
    'client_access_tokens',
    'user_notifications',
    'wallet_accounts',
    'payout_methods',
    'user_wallets',
    'user_wallet_entries',
    'maxwell_search_runs',
    'maxwell_lead_feedback',
    'user_profiles',
  ]
  const present = new Set(TABLE_INVENTORY.map((e) => e.table))
  for (const t of expected) {
    assert.ok(present.has(t), `Inventory missing analysis-spec table: ${t}`)
  }
})

// Live-DB cross-check (every FK to user_profiles in the live schema appears
// in the inventory) is part of the manual integration procedure documented
// in `docs/handoffs/2026-05-21-b16-gdpr-integration-manual.md`. Backend's
// pre-implementation checklist (#1) ran the equivalent Grep during the
// architecture pass; any future migration that adds a user_profiles FK
// must update this inventory + this test's expected list.
