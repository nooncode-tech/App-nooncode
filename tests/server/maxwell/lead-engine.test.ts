import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAllowedRadiusKm,
  maxwellLeadSearchRequestSchema,
  parseMaxwellFeedbackInput,
  radiusKmForConfirmedSales,
} from '@/lib/server/maxwell/lead-engine'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'

const profileId = '22222222-2222-4222-8222-222222222222'
const principal = {
  userId: profileId,
  email: 'seller@noon.app',
  role: 'sales',
  profile: {
    id: profileId,
    email: 'seller@noon.app',
    full_name: 'Seller Noon',
    role: 'sales',
    is_active: true,
    avatar_url: null,
    created_at: '2026-05-04T00:00:00.000Z',
    updated_at: '2026-05-04T00:00:00.000Z',
    last_login_at: null,
    legacy_mock_id: null,
    locale: 'es-MX',
    notification_preferences: {},
    stripe_connect_account_id: null,
    stripe_connect_status: 'not_connected',
    timezone: 'America/Mexico_City',
  },
} as AuthenticatedPrincipal

function createRadiusClient(confirmedSales: number) {
  const rpcCalls: Array<{ name: string; args: unknown }> = []

  return {
    client: ({
      async rpc(name: string, args: unknown) {
        rpcCalls.push({ name, args })
        assert.equal(name, 'maxwell_confirmed_sales_count')
        return { data: confirmedSales, error: null }
      },
    } as unknown) as Parameters<typeof getAllowedRadiusKm>[0],
    rpcCalls,
  }
}

test('Maxwell radius increases with confirmed sales thresholds', () => {
  assert.equal(radiusKmForConfirmedSales(0), 5)
  assert.equal(radiusKmForConfirmedSales(3), 10)
  assert.equal(radiusKmForConfirmedSales(8), 20)
  assert.equal(radiusKmForConfirmedSales(16), 35)
  assert.equal(radiusKmForConfirmedSales(31), 50)
})

test('Maxwell seller radius is calculated through the provided admin client', async () => {
  const fake = createRadiusClient(3)

  const radiusKm = await getAllowedRadiusKm(fake.client, principal)

  assert.equal(radiusKm, 10)
  assert.deepEqual(fake.rpcCalls, [
    {
      name: 'maxwell_confirmed_sales_count',
      args: { p_profile_id: profileId },
    },
  ])
})

test('Maxwell privileged roles do not query seller sales count', async () => {
  const fake = createRadiusClient(3)
  const adminPrincipal = {
    ...principal,
    role: 'admin',
    profile: { ...principal.profile, role: 'admin' },
  } as AuthenticatedPrincipal

  const radiusKm = await getAllowedRadiusKm(fake.client, adminPrincipal)

  assert.equal(radiusKm, 100)
  assert.deepEqual(fake.rpcCalls, [])
})

test('Maxwell lead search schema validates current location coordinates', () => {
  const parsed = maxwellLeadSearchRequestSchema.parse({
    mode: 'current_location',
    latitude: 18.4861,
    longitude: -69.9312,
    locale: 'es-DO',
  })

  assert.equal(parsed.mode, 'current_location')
})

test('Maxwell lead search schema rejects invalid coordinates', () => {
  assert.throws(() => maxwellLeadSearchRequestSchema.parse({
    mode: 'current_location',
    latitude: 180,
    longitude: -69.9312,
  }))
})

test('Maxwell feedback schema rejects unsupported ratings', () => {
  assert.throws(() => parseMaxwellFeedbackInput({
    rating: 'perfect',
  }))
})
