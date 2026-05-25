import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'

// Validates the md5UuidFor helper inline-replicated from
// app/api/cron/webhook-failure-alert/route.ts. The helper exists to
// derive a deterministic UUID from a Stripe event_id (which is text,
// not UUID) so that the (profile_id, source_kind, source_event_id)
// uniqueness constraint on public.user_notifications correctly
// dedupes re-runs of the cron for the same failed event.

function md5UuidFor(text: string): string {
  const hex = createHash('md5').update(text).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

test('md5UuidFor: returns a valid UUID-shaped string', () => {
  const result = md5UuidFor('evt_1TY6tZRC5LvlmWeuMjR5KzXv')
  assert.match(result, UUID_REGEX)
})

test('md5UuidFor: is deterministic across calls', () => {
  const a = md5UuidFor('evt_test')
  const b = md5UuidFor('evt_test')
  assert.equal(a, b, 'same input must produce same output for cron idempotency')
})

test('md5UuidFor: produces distinct outputs for distinct Stripe event_ids', () => {
  const a = md5UuidFor('evt_111')
  const b = md5UuidFor('evt_222')
  assert.notEqual(a, b)
})

test('md5UuidFor: handles empty string without throwing', () => {
  // md5('') is well-defined; defensive coverage in case a stripe row
  // somehow lacks event_id (it should not — the column is the PK).
  const result = md5UuidFor('')
  assert.match(result, UUID_REGEX)
})

test('md5UuidFor: distinguishes case-sensitive event ids', () => {
  const a = md5UuidFor('evt_AAA')
  const b = md5UuidFor('evt_aaa')
  assert.notEqual(a, b)
})
