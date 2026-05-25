/**
 * GDPR erasure sentinel — ADR-019 §D1.
 *
 * The sentinel `user_profiles` row at `id = '00000000-0000-0000-0000-000000000000'`
 * (RFC 4122 nil UUID) anchors every ANONYMIZE-in-place actor column after a
 * GDPR Art. 17 erasure run. Pre-seeded by migration 0057.
 *
 * The sentinel is never able to authenticate (no password, no confirmed email
 * in the matching `auth.users` row) and carries `is_active = false` so it is
 * hidden from active-user queries.
 *
 * @see docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md §D1, §D4
 * @see supabase/migrations/0057_phase_22a_gdpr_sentinel_profile.sql
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/server/supabase/database.types'

/**
 * Fixed sentinel UUID — RFC 4122 §4.1.7 nil UUID. Pre-seeded by migration 0057
 * as both an `auth.users` row and a `user_profiles` row. Anonymized actor
 * columns reference this value.
 */
export const SENTINEL_PROFILE_ID = '00000000-0000-0000-0000-000000000000' as const

/**
 * Sentinel email at `.invalid` TLD (RFC 6761) — guaranteed-unresolvable.
 * Used by the erase script's pre-flight check to verify the sentinel row.
 */
export const SENTINEL_EMAIL = 'deleted-user@noon.invalid' as const

export class SentinelNotSeededError extends Error {
  constructor() {
    super(
      `GDPR sentinel profile not seeded — apply migration 0057 before running ` +
        `the GDPR erase script. Expected row: user_profiles.id = ${SENTINEL_PROFILE_ID}`,
    )
    this.name = 'SentinelNotSeededError'
  }
}

/**
 * Throws `SentinelNotSeededError` if the sentinel `user_profiles` row is missing.
 *
 * The erase script's pre-flight calls this BEFORE attempting any anonymization;
 * the script refuses to run if the sentinel is absent because every ANONYMIZE-in-place
 * UPDATE would FK-violate against `not null + RESTRICT` actor columns.
 *
 * @param client Service-role Supabase client.
 */
export async function assertSentinelExists(
  client: SupabaseClient<Database>,
): Promise<void> {
  const { data, error } = await client
    .from('user_profiles')
    .select('id, email, is_active')
    .eq('id', SENTINEL_PROFILE_ID)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Failed to verify GDPR sentinel profile: ${error.message}. ` +
        `Check that migration 0057 has been applied.`,
    )
  }

  if (!data) {
    throw new SentinelNotSeededError()
  }

  if (data.email !== SENTINEL_EMAIL) {
    throw new Error(
      `GDPR sentinel profile email mismatch: expected ${SENTINEL_EMAIL}, ` +
        `got ${data.email}. Migration 0057 may have been altered.`,
    )
  }
}

/**
 * Returns true iff the candidate profile-id is the sentinel UUID.
 * Used by the erase script to refuse self-erasure of the sentinel.
 */
export function isSentinelProfileId(candidate: string): boolean {
  return candidate === SENTINEL_PROFILE_ID
}
