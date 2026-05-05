import assert from 'node:assert/strict'
import test from 'node:test'
import { AuthGuardError } from '@/lib/server/auth/guards'
import { createGetAdminUsersHandler } from '@/app/api/users/admin/route'
import type { AdminDirectoryUser } from '@/lib/server/profiles/types'

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeAdminUser(overrides: Partial<AdminDirectoryUser> = {}): AdminDirectoryUser {
  return {
    profileId: 'profile-1',
    legacyMockId: null,
    email: 'user@test.com',
    name: 'Test User',
    role: 'admin',
    avatar: null,
    isActive: true,
    createdAt: '2024-01-01T00:00:00Z',
    lastLoginAt: null,
    ...overrides,
  }
}

function makeHandler({
  users = [] as AdminDirectoryUser[],
  authError = null as Error | null,
} = {}) {
  const requireRoleStub = async () => {
    if (authError) throw authError
    return { userId: 'user-1', role: 'admin' as const }
  }

  const listAdminDirectoryUsersStub = async (_client: unknown, limit: number) =>
    users.slice(0, limit)

  const createAdminClientStub = () => ({})

  return createGetAdminUsersHandler({
    requireRole: requireRoleStub,
    listAdminDirectoryUsers: listAdminDirectoryUsersStub,
    createSupabaseAdminClient: createAdminClientStub,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('default request (no params) returns at most 100 users', async () => {
  const users = Array.from({ length: 150 }, (_, i) =>
    makeAdminUser({ profileId: `profile-${i}`, email: `user${i}@test.com` })
  )
  const handler = makeHandler({ users })

  const request = new Request('https://app.test/api/users/admin')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.data.length, 100)
})

test('explicit ?limit=50 returns at most 50 users', async () => {
  const users = Array.from({ length: 80 }, (_, i) =>
    makeAdminUser({ profileId: `profile-${i}`, email: `user${i}@test.com` })
  )
  const handler = makeHandler({ users })

  const request = new Request('https://app.test/api/users/admin?limit=50')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.data.length, 50)
})

test('?limit=200 is clamped to server max of 100', async () => {
  const users = Array.from({ length: 150 }, (_, i) =>
    makeAdminUser({ profileId: `profile-${i}`, email: `user${i}@test.com` })
  )
  const handler = makeHandler({ users })

  const request = new Request('https://app.test/api/users/admin?limit=200')
  const response = await handler(request)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.data.length, 100)
})

test('response shape is { data: AdminDirectoryUser[] } — no meta wrapper', async () => {
  const users = [makeAdminUser()]
  const handler = makeHandler({ users })

  const request = new Request('https://app.test/api/users/admin')
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

  const request = new Request('https://app.test/api/users/admin')
  const response = await handler(request)

  assert.equal(response.status, 401)
})
