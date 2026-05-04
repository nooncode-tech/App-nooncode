import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '@/lib/server/api/errors'
import type { AuthenticatedPrincipal } from '@/lib/server/profiles/types'
import type { WalletDataClients } from '@/lib/server/wallet/service'
import { getVisibleWallet } from '@/lib/server/wallet/service'

const profileId = '11111111-1111-4111-8111-111111111111'
const now = '2026-05-04T00:00:00.000Z'

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
    created_at: now,
    updated_at: now,
    last_login_at: null,
    legacy_mock_id: null,
    locale: 'es-MX',
    notification_preferences: {},
    stripe_connect_account_id: null,
    stripe_connect_status: 'not_connected',
    timezone: 'America/Mexico_City',
  },
} as AuthenticatedPrincipal

function createAdminClient(options?: {
  failUserWallet?: boolean
}) {
  const rpcCalls: Array<{ name: string; args: unknown }> = []

  return {
    client: ({
      async rpc(name: string, args: unknown) {
        rpcCalls.push({ name, args })

        if (name === 'ensure_user_wallet_for_profile') {
          if (options?.failUserWallet) {
            return { data: null, error: { message: 'PROFILE_NOT_FOUND' } }
          }

          return {
            data: {
              profile_id: profileId,
              free_credits_balance: 7,
              earned_credits_balance: 3,
              created_at: now,
              updated_at: now,
            },
            error: null,
          }
        }

        if (name === 'ensure_monetary_wallet_for_profile') {
          return {
            data: {
              profile_id: profileId,
              available_to_spend: 10,
              available_to_withdraw: 2,
              pending: 1,
              locked: 0,
              currency: 'USD',
              created_at: now,
              updated_at: now,
            },
            error: null,
          }
        }

        throw new Error(`Unexpected RPC ${name}`)
      },
    } as unknown) as WalletDataClients['adminClient'],
    rpcCalls,
  }
}

function createUserClient() {
  const fromCalls: string[] = []

  const client = {
    from(tableName: string) {
      fromCalls.push(tableName)

      const builder = {
        select() {
          return builder
        },
        eq() {
          return builder
        },
        order() {
          return builder
        },
        limit() {
          if (tableName === 'user_wallet_entries' || tableName === 'wallet_ledger_entries') {
            return Promise.resolve({ data: [], error: null })
          }

          return Promise.resolve({ data: null, error: null })
        },
        maybeSingle() {
          if (tableName === 'prototype_credit_settings') {
            return Promise.resolve({
              data: {
                singleton_key: true,
                request_cost: 2,
                updated_by_profile_id: profileId,
                created_at: now,
                updated_at: now,
              },
              error: null,
            })
          }

          return Promise.resolve({ data: null, error: null })
        },
      }

      return builder
    },
  } as unknown as WalletDataClients['userClient']

  return { client, fromCalls }
}

test('getVisibleWallet uses service-role wallet ensure RPCs by profile id', async () => {
  const admin = createAdminClient()
  const user = createUserClient()

  const wallet = await getVisibleWallet(
    { userClient: user.client, adminClient: admin.client },
    principal,
    10
  )

  assert.deepEqual(
    admin.rpcCalls.map((call) => call.name),
    ['ensure_user_wallet_for_profile', 'ensure_monetary_wallet_for_profile']
  )
  assert.equal(
    admin.rpcCalls.some((call) => call.name === 'ensure_current_user_wallet'),
    false
  )
  assert.equal(
    admin.rpcCalls.some((call) => call.name === 'ensure_monetary_wallet'),
    false
  )
  assert.equal(wallet.totalAvailable, 10)
  assert.equal(wallet.prototypeRequestCost, 2)
  assert.equal(wallet.monetaryWallet?.availableToSpend, 10)
})

test('getVisibleWallet normalizes profile lookup failures', async () => {
  const admin = createAdminClient({ failUserWallet: true })
  const user = createUserClient()

  await assert.rejects(
    () => getVisibleWallet(
      { userClient: user.client, adminClient: admin.client },
      principal,
      10
    ),
    (error) => {
      assert.equal(error instanceof ApiError, true)
      assert.equal((error as ApiError).code, 'PROFILE_NOT_FOUND')
      assert.equal((error as ApiError).status, 403)
      return true
    }
  )
})
