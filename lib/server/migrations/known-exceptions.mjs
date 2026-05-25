/**
 * Known exceptions for the migration ledger drift classifier.
 *
 * This is the SINGLE source of truth for the two ADR-anchored exception sets
 * used by both `scripts/check-migrations.mjs` (CI guard) and the
 * `/api/admin/migrations-health` endpoint (operator-driven drift health).
 *
 * Why .mjs and not .ts:
 * - The CI script is a plain Node ESM script with no compile step (`tsx` not
 *   in its path). Using `.mjs` lets both the script and the TypeScript route
 *   adapter import these constants natively via Node ESM resolution, with no
 *   build dependency.
 * - JSDoc types provide adequate TypeScript inference at the import site.
 *
 * DO NOT EDIT either set without amending the cited ADR.
 *
 * @see docs/adrs/ADR-006-migration-prefix-convention-and-rename.md (Option B2)
 * @see docs/adrs/ADR-014-migration-ledger-reconciliation.md (Orphans section)
 * @see docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md (D1, D8)
 */

/**
 * Files involved in known historical prefix collisions (0024-0027).
 *
 * Permanent grandfathered set per ADR-006 §Reconciliation required (Option B2
 * — additive convention permanent — adopted 2026-05-11 after ledger
 * verification confirmed 4 of 8 colliding filenames were already registered
 * in `supabase_migrations.schema_migrations`, foreclosing the rename branch).
 *
 * Format: full filename including the 4-digit prefix AND the `.sql`
 * extension (consistent with the `scripts/check-migrations.mjs` join key).
 *
 * Any *new* file colliding at any prefix still fails the CI guard.
 *
 * @type {ReadonlySet<string>}
 */
export const KNOWN_COLLISION_FILES = new Set([
  '0024_phase_3a_monetary_wallet_foundation.sql',
  '0024_phase_5a_prototype_settings_admin_write.sql',
  '0025_phase_3a_bridge_wallet_compatibility.sql',
  '0025_phase_3a_leads_geo_location.sql',
  '0026_phase_3b_earnings_backend.sql',
  '0026_phase_9a_stripe_payments.sql',
  '0027_phase_10a_commissions.sql',
  '0027_phase_3_proposal_lifecycle.sql',
])

/**
 * Ledger row `name` values that are expected to exist in
 * `supabase_migrations.schema_migrations` WITHOUT a matching disk file.
 *
 * Reconciled and permanently retained per ADR-014 §Orphans (2026-05-17):
 * removing them risks `supabase db push` re-applying nonexistent files from
 * a future CLI run, recreating the very drift the reconciliation closed.
 *
 * Format: bare `name` (no 4-digit/timestamp prefix, no `.sql` extension)
 * — consistent with the `name` column format in the ledger after the
 * ADR-014 reconciliation INSERT convention.
 *
 * @type {ReadonlySet<string>}
 */
export const EXPECTED_ORPHAN_LEDGER_NAMES = new Set([
  'phase_4b_payment_columns',
  'phase_5_stripe_connect',
  'phase_7_client_workspace',
  'phase_7b_resolve_token_update',
  'phase_8_lead_whatsapp',
  'phase_11_lead_auto_followup',
])
