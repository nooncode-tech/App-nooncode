/**
 * GDPR table inventory — the authoritative per-table classification used by
 * both the export and erase procedures.
 *
 * Each entry binds:
 *  - the verdict (CASCADE-delete / ANONYMIZE-in-place / EXPORT-only / SKIP)
 *  - the filter column (how to find the target's rows on the table)
 *  - the actor columns to set to the sentinel UUID during ANONYMIZE
 *  - free-text PII columns to redact to '[redacted]'
 *  - JSONB columns to wipe to {}
 *  - whether the FK cascades from `user_profiles` (i.e., no explicit DELETE needed)
 *
 * Inventory derived from `specs/fase-3-b16-gdpr-art-15-17.md` §Authoritative
 * inventory + ADR-019 §D3. RESTRICT FKs are anonymized to the sentinel; the
 * commercial/financial row itself is retained.
 *
 * @see docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md §D1, §D3
 * @see specs/fase-3-b16-gdpr-art-15-17.md §Authoritative PII / profile_id-linked table inventory
 */

export type TableVerdict =
  | 'CASCADE-delete'
  | 'ANONYMIZE-in-place'
  | 'EXPORT-only'
  | 'SKIP-with-reason'

export interface TableInventoryEntry {
  /** Table name in the `public` schema. */
  table: string
  /** The verdict applied at Art. 17 time. */
  verdict: TableVerdict
  /**
   * Column used to filter rows belonging to the target profile. Null means the
   * table has no per-profile filter and is handled specially (e.g., the parent
   * `user_profiles` row itself, filtered by `id`).
   */
  filterColumn: string | null
  /**
   * Additional filter columns for tables with multiple FK references to
   * `user_profiles` (e.g., `wallet_ledger_entries` has both `profile_id` and
   * `actor_profile_id`). All-OR semantics: a row matches if ANY listed column
   * equals the target profile-id.
   */
  additionalFilterColumns: string[]
  /**
   * Columns to set to the sentinel UUID during ANONYMIZE-in-place. Empty for
   * CASCADE-delete / EXPORT-only / SKIP.
   */
  actorColumnsToSentinel: string[]
  /**
   * Free-text PII columns to redact to '[redacted]' during ANONYMIZE-in-place.
   */
  freeTextColumnsToRedact: string[]
  /**
   * JSONB columns to wipe to {} during ANONYMIZE-in-place.
   */
  jsonbColumnsToWipe: string[]
  /**
   * True iff the FK chain cascades from a `user_profiles` delete (i.e., the
   * erase script does NOT need to issue an explicit DELETE — the auth-side
   * delete handles it).
   */
  cascadesFromUserProfiles: boolean
  /** Human-readable rationale (1-line). */
  notes: string
}

/**
 * Authoritative table inventory. ORDER MATTERS for the erase procedure: the
 * inventory is iterated front-to-back, so ANONYMIZE-in-place tables (which
 * have RESTRICT FKs) are processed BEFORE the parent user_profiles delete.
 *
 * The trailing `user_profiles` entry is the parent row — handled by the
 * auth.users delete cascade, NOT by an explicit DELETE in the erase loop.
 */
export const TABLE_INVENTORY: readonly TableInventoryEntry[] = [
  // -------------------------------------------------------------------------
  // ANONYMIZE-in-place — RESTRICT FKs and audit-immutability tables.
  // These MUST be processed first; their rows persist with sentinel actors.
  // -------------------------------------------------------------------------
  {
    table: 'wallet_ledger_entries',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'profile_id',
    additionalFilterColumns: ['actor_profile_id'],
    actorColumnsToSentinel: ['profile_id', 'actor_profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: ['metadata'],
    cascadesFromUserProfiles: false,
    notes:
      'Financial ledger. profile_id is NOT NULL — sentinel required. metadata may contain incidental PII.',
  },
  {
    table: 'earnings_ledger',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'actor_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['actor_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Audit-immutable earnings ledger. actor_id is SET NULL by default but ADR-019 uses sentinel for consistency.',
  },
  {
    table: 'payouts',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Financial disbursement record. profile_id is NOT NULL + RESTRICT — sentinel required.',
  },
  {
    table: 'seller_fees',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'seller_profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['seller_profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Seller fee state machine. seller_profile_id is NOT NULL + RESTRICT — sentinel required.',
  },
  {
    table: 'withdrawal_requests',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'actor_id',
    additionalFilterColumns: ['processed_by_id'],
    actorColumnsToSentinel: ['actor_id', 'processed_by_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Withdrawal request ledger. actor_id is NOT NULL + RESTRICT — sentinel required.',
  },
  {
    table: 'points_ledger',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'actor_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['actor_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Points ledger. actor_id is NOT NULL + RESTRICT — sentinel required.',
  },
  {
    table: 'point_redemptions',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'actor_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['actor_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes: 'Points redemption ledger. actor_id RESTRICT — sentinel required.',
  },
  // RESTRICT-FK creator columns on commercial entities. ADR-019 §D3:
  // anonymize, do NOT row-delete (commercial value belongs to the business).
  {
    table: 'leads',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'created_by',
    additionalFilterColumns: ['assigned_to'],
    actorColumnsToSentinel: ['created_by', 'assigned_to'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Lead rows carry CLIENT PII (NoonWeb B14 scope). Only collaborator linkage is anonymized.',
  },
  {
    table: 'lead_proposals',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'created_by',
    additionalFilterColumns: ['reviewer_id'],
    actorColumnsToSentinel: ['created_by', 'reviewer_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Commercial proposal. created_by RESTRICT — sentinel required. reviewer_id is SET NULL but unified to sentinel.',
  },
  {
    table: 'tasks',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'created_by',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['created_by'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Task record. created_by RESTRICT. assigned_legacy_user_id is text FK to legacy_mock_id (SET NULL).',
  },
  {
    table: 'projects',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'created_by',
    additionalFilterColumns: ['developer_user_id'],
    actorColumnsToSentinel: ['created_by', 'developer_user_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Project record. created_by RESTRICT. client_name is CLIENT PII (NoonWeb B14 scope).',
  },
  {
    table: 'prototype_workspaces',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'requested_by_profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['requested_by_profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Prototype workspace. requested_by_profile_id RESTRICT — sentinel required.',
  },
  // Activity/audit tables — ANONYMIZE but with SET NULL FK semantics already.
  // Using sentinel UUID for consistency.
  {
    table: 'lead_activities',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'actor_profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['actor_profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Activity log. actor_profile_id SET NULL by default; unified to sentinel. note_body free-text NOT scanned (ADR-019 §D3, LOW risk).',
  },
  {
    table: 'task_activities',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'actor_profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['actor_profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes: 'Task activity log. Same shape as lead_activities.',
  },
  {
    table: 'project_activities',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'actor_profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['actor_profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes: 'Project activity log. Same shape as lead_activities.',
  },
  {
    table: 'payout_batches',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'created_by_profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['created_by_profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Payout batch. created_by_profile_id SET NULL by default; unified to sentinel.',
  },
  {
    table: 'prototype_credit_settings',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'updated_by_profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['updated_by_profile_id'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes: 'Singleton settings row. Operational metadata.',
  },
  {
    table: 'client_access_tokens',
    verdict: 'ANONYMIZE-in-place',
    filterColumn: 'created_by',
    additionalFilterColumns: [],
    actorColumnsToSentinel: ['created_by'],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: false,
    notes:
      'Token row itself carries CLIENT PII (NoonWeb B14 scope). Only collaborator linkage anonymized here.',
  },

  // -------------------------------------------------------------------------
  // CASCADE-delete — owned by the user, deleted via FK cascade from
  // user_profiles delete (which is triggered by the auth.users delete).
  // -------------------------------------------------------------------------
  {
    table: 'user_notifications',
    verdict: 'CASCADE-delete',
    filterColumn: 'profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: [],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: true,
    notes:
      'Personal inbox. ON DELETE CASCADE. No audit need to retain.',
  },
  {
    table: 'wallet_accounts',
    verdict: 'CASCADE-delete',
    filterColumn: 'profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: [],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: true,
    notes:
      'Wallet account row. ON DELETE CASCADE from user_profiles. Ledger rows persist via anonymization.',
  },
  {
    table: 'payout_methods',
    verdict: 'CASCADE-delete',
    filterColumn: 'profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: [],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: true,
    notes:
      'Payout routing details (bank/Binance) — hot PII. ON DELETE CASCADE. Safe to delete.',
  },
  {
    table: 'user_wallets',
    verdict: 'CASCADE-delete',
    filterColumn: 'profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: [],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: true,
    notes:
      'Prototype-credits balance — non-financial. ON DELETE CASCADE.',
  },
  {
    table: 'user_wallet_entries',
    verdict: 'CASCADE-delete',
    filterColumn: 'profile_id',
    additionalFilterColumns: ['actor_profile_id'],
    actorColumnsToSentinel: [],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: true,
    notes:
      'Prototype-credits ledger — non-financial. profile_id cascades from user_wallets. actor_profile_id SET NULL.',
  },
  {
    table: 'maxwell_search_runs',
    verdict: 'CASCADE-delete',
    filterColumn: 'requested_by',
    additionalFilterColumns: [],
    actorColumnsToSentinel: [],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: true,
    notes: 'Search history — personal. ON DELETE CASCADE.',
  },
  {
    table: 'maxwell_lead_feedback',
    verdict: 'CASCADE-delete',
    filterColumn: 'profile_id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: [],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: true,
    notes: 'Personal feedback. ON DELETE CASCADE.',
  },
  // -------------------------------------------------------------------------
  // Parent row — handled by auth.users delete cascade. Listed last so the
  // export reads it but the erase loop does NOT explicit-DELETE it.
  // -------------------------------------------------------------------------
  {
    table: 'user_profiles',
    verdict: 'CASCADE-delete',
    filterColumn: 'id',
    additionalFilterColumns: [],
    actorColumnsToSentinel: [],
    freeTextColumnsToRedact: [],
    jsonbColumnsToWipe: [],
    cascadesFromUserProfiles: true,
    notes:
      'Parent row. Cascades from auth.users delete (migration 0001). Erase loop does NOT explicit-DELETE.',
  },
] as const

/**
 * Convenience: tables touched by the export procedure (everything EXCEPT
 * SKIP-with-reason).
 */
export const EXPORT_TABLES: readonly TableInventoryEntry[] = TABLE_INVENTORY.filter(
  (entry) => entry.verdict !== 'SKIP-with-reason',
)

/**
 * Convenience: tables that need ANONYMIZE-in-place treatment in the erase loop.
 */
export const ANONYMIZE_TABLES: readonly TableInventoryEntry[] = TABLE_INVENTORY.filter(
  (entry) => entry.verdict === 'ANONYMIZE-in-place',
)

/**
 * Convenience: tables that need explicit DELETE in the erase loop (CASCADE-delete
 * tables that do NOT cascade from user_profiles are 0 in current inventory; the
 * auth.users cascade handles all CASCADE-delete rows).
 */
export const EXPLICIT_DELETE_TABLES: readonly TableInventoryEntry[] = TABLE_INVENTORY.filter(
  (entry) =>
    entry.verdict === 'CASCADE-delete' &&
    !entry.cascadesFromUserProfiles &&
    entry.table !== 'user_profiles',
)
