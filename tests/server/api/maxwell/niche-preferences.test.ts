import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '@/lib/server/api/errors'
import {
  NICHE_PREFERENCES_ALLOWED_ROLES,
  nichePreferencesPatchSchema,
  validateNichePreferencesPatch,
} from '@/app/api/maxwell/niche-preferences/route'

// Architecture C4 (frozen):
// - Role gate: sales | pm | admin.
// - PATCH body: { preferredNicheIds: string[] } with max 2 entries.
// - Empty array is a valid reset.
// - Unknown niche ids return 400 (whitelist via getNicheById).
// - Admin-client with explicit ownership pin (tested at integration level).

test('role gate allows sales, pm, admin and excludes sales_manager / developer', () => {
  const allowed = new Set(NICHE_PREFERENCES_ALLOWED_ROLES)
  assert.equal(allowed.has('sales'), true)
  assert.equal(allowed.has('pm'), true)
  assert.equal(allowed.has('admin'), true)
  // sales_manager is intentionally excluded (Architecture C4 rationale).
  assert.equal(allowed.has('sales_manager' as never), false)
  assert.equal(allowed.has('developer' as never), false)
  assert.equal(allowed.has('client' as never), false)
})

test('PATCH schema accepts an empty array (valid reset state)', () => {
  const parsed = nichePreferencesPatchSchema.parse({ preferredNicheIds: [] })
  assert.deepEqual(parsed.preferredNicheIds, [])
})

test('PATCH schema rejects more than 2 niche ids with a Zod error', () => {
  const result = nichePreferencesPatchSchema.safeParse({
    preferredNicheIds: ['restaurante', 'dental', 'gimnasio'],
  })
  assert.equal(result.success, false)
})

test('validateNichePreferencesPatch throws 400 ApiError on unknown niche id', () => {
  assert.throws(
    () => validateNichePreferencesPatch({ preferredNicheIds: ['definitely-not-a-real-niche'] }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal((err as ApiError).status, 400)
      assert.equal((err as ApiError).code, 'NICHE_UNKNOWN')
      return true
    },
  )
})

test('validateNichePreferencesPatch throws 400 ApiError on malformed body', () => {
  assert.throws(
    () => validateNichePreferencesPatch({ preferredNicheIds: 'restaurante' }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal((err as ApiError).status, 400)
      assert.equal((err as ApiError).code, 'INVALID_NICHE_PREFERENCES_BODY')
      return true
    },
  )
})

test('validateNichePreferencesPatch accepts up to 2 valid catalog ids', () => {
  const result = validateNichePreferencesPatch({
    preferredNicheIds: ['restaurante', 'dental'],
  })
  assert.deepEqual(result.preferredNicheIds, ['restaurante', 'dental'])
})

test('validateNichePreferencesPatch accepts a single valid id', () => {
  const result = validateNichePreferencesPatch({ preferredNicheIds: ['gimnasio'] })
  assert.deepEqual(result.preferredNicheIds, ['gimnasio'])
})
