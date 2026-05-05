import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthGuardError } from '@/lib/server/auth/guards'
import { createGetDeliveryUsersHandler } from '@/app/api/users/delivery/route'
import type { DeliveryUser } from '@/lib/server/profiles/types'

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeDeliveryUser(overrides: Partial<DeliveryUser> = {}): DeliveryUser {
  return {
    id: 'user-1',
    profileId: 'profile-1',
    email: 'user@test.com',
    name: 'Test User',
    role: 'developer',
    avatar: undefined,
    isActive: true,
    ...overrides,
  }
}

function makeHandler({
  users = [] as DeliveryUser[],
  authError = null as Error | null,
} = {}) {
  const requireRoleStub = async () => {
    if (authError) throw authError
    return { userId: 'user-1', role: 'admin' as const }
  }

  const listDeliveryUsersStub = async (_client: unknown, limit: number) =>
    users.slice(0, limit)

  const createAdminClientStub = () => ({})

  return createGetDeliveryUsersHandler({
    requireRole: requireRoleStub,
    listDeliveryUsers: listDeliveryUsersStub,
    createSupabaseAdminClient: createAdminClientStub,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('default request (no params) returns at most 100 users', async () => {
  const users = Array.from({ length: 150 }, (_, i) =>
    makeDeliveryUser({ profileId: `profile-${i}`, id: `id-${i}`, email: `user${i}@test.com` })
  )
  const handler = makeHandler({ users })

  const request = new Request('https://app.test/api/users/delivery')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.data.length, 100)
})

test('explicit ?limit=50 returns at most 50 users', async () => {
  const users = Array.from({ length: 80 }, (_, i) =>
    makeDeliveryUser({ profileId: `profile-${i}`, id: `id-${i}`, email: `user${i}@test.com` })
  )
  const handler = makeHandler({ users })

  const request = new Request('https://app.test/api/users/delivery?limit=50')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.data.length, 50)
})

test('?limit=200 is clamped to server max of 100', async () => {
  const users = Array.from({ length: 150 }, (_, i) =>
    makeDeliveryUser({ profileId: `profile-${i}`, id: `id-${i}`, email: `user${i}@test.com` })
  )
  const handler = makeHandler({ users })

  const request = new Request('https://app.test/api/users/delivery?limit=200')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.data.length, 100)
})

test('response shape is { data: DeliveryUser[] } — no meta wrapper', async () => {
  const users = [makeDeliveryUser()]
  const handler = makeHandler({ users })

  const request = new Request('https://app.test/api/users/delivery')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.ok(Array.isArray(body.data))
  assert.equal(body.meta, undefined)
  assert.equal(body.data[0].profileId, 'profile-1')
})

test('unauthenticated → 401', async () => {
  const authError = new AuthGuardError('UNAUTHENTICATED', 'An active session is required.', 401)
  const handler = makeHandler({ authError })

  const request = new Request('https://app.test/api/users/delivery')
  const response = await handler(request)

  assert.equal(response.status, 401)
})
