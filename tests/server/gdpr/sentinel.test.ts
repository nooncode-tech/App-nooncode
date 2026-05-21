/**
 * Unit tests — lib/server/gdpr/sentinel.ts
 *
 * Happy-path coverage only. Destructive-path and live-DB coverage is owned by
 * system-testing (integration test with seeded test profile).
 *
 * @see lib/server/gdpr/sentinel.ts
 * @see specs/fase-3-b16-gdpr-art-15-17.md
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SENTINEL_EMAIL,
  SENTINEL_PROFILE_ID,
  SentinelNotSeededError,
  assertSentinelExists,
  isSentinelProfileId,
} from '@/lib/server/gdpr/sentinel'

function makeMockClient(opts: {
  data?: { id: string; email: string; is_active: boolean } | null
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

test('SENTINEL_PROFILE_ID is the RFC 4122 nil UUID', () => {
  assert.equal(SENTINEL_PROFILE_ID, '00000000-0000-0000-0000-000000000000')
})

test('isSentinelProfileId returns true only for the sentinel UUID', () => {
  assert.equal(isSentinelProfileId(SENTINEL_PROFILE_ID), true)
  assert.equal(isSentinelProfileId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false)
  assert.equal(isSentinelProfileId(''), false)
})

test('assertSentinelExists resolves when the sentinel row is present', async () => {
  const client = makeMockClient({
    data: {
      id: SENTINEL_PROFILE_ID,
      email: SENTINEL_EMAIL,
      is_active: false,
    },
    error: null,
  })

  await assert.doesNotReject(() => assertSentinelExists(client as never))
})

test('assertSentinelExists throws SentinelNotSeededError when row is missing', async () => {
  const client = makeMockClient({ data: null, error: null })

  await assert.rejects(
    () => assertSentinelExists(client as never),
    (err: Error) => err instanceof SentinelNotSeededError,
  )
})

test('assertSentinelExists throws when sentinel email does not match expected value', async () => {
  const client = makeMockClient({
    data: {
      id: SENTINEL_PROFILE_ID,
      email: 'someone-else@example.com',
      is_active: false,
    },
    error: null,
  })

  await assert.rejects(
    () => assertSentinelExists(client as never),
    /sentinel profile email mismatch/i,
  )
})

test('assertSentinelExists surfaces Supabase errors with migration hint', async () => {
  const client = makeMockClient({
    data: null,
    error: { message: 'permission denied' },
  })

  await assert.rejects(
    () => assertSentinelExists(client as never),
    /migration 0057/i,
  )
})

// ---------------------------------------------------------------------------
// Additional safeguard tests
// ---------------------------------------------------------------------------

test('SENTINEL_EMAIL uses the RFC 6761 .invalid TLD', () => {
  assert.match(SENTINEL_EMAIL, /\.invalid$/)
  assert.equal(SENTINEL_EMAIL, 'deleted-user@noon.invalid')
})

test('SentinelNotSeededError carries the migration hint and sentinel UUID', () => {
  const err = new SentinelNotSeededError()
  assert.equal(err.name, 'SentinelNotSeededError')
  assert.match(err.message, /migration 0057/i)
  assert.match(err.message, /00000000-0000-0000-0000-000000000000/)
})

test('assertSentinelExists tolerates is_active=true (does not require false)', async () => {
  // The check is intentionally minimal — just presence + email. An operator
  // may legitimately re-activate the sentinel via Supabase Dashboard for an
  // emergency op; the erase script should still recognize it as present.
  const client = makeMockClient({
    data: {
      id: SENTINEL_PROFILE_ID,
      email: SENTINEL_EMAIL,
      is_active: true,
    },
    error: null,
  })

  await assert.doesNotReject(() => assertSentinelExists(client as never))
})

// Live-DB sentinel-existence check (apply migration 0057, SELECT sentinel from
// auth.users AND user_profiles, verify both rows present) is covered by the
// manual integration procedure in
// `docs/handoffs/2026-05-21-b16-gdpr-integration-manual.md`.
