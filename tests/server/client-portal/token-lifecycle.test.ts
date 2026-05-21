import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  revokeClientToken,
  rotateClientToken,
  ClientTokenRevokeError,
  ClientTokenRotateError,
} from '@/lib/server/client-portal/repository'

type RpcCall = { name: string; args: unknown }
type RpcResponse = { data: unknown; error: { code?: string; message: string } | null }

function makeClient(responses: Record<string, RpcResponse>): {
  client: SupabaseClient
  calls: RpcCall[]
} {
  const calls: RpcCall[] = []
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args })
      const response = responses[name]
      if (!response) {
        return Promise.resolve({ data: null, error: { code: 'NO_STUB', message: `No stub for ${name}` } })
      }
      return Promise.resolve(response)
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('revokeClientToken', () => {
  test('returns tokenId + revokedAt on success', async () => {
    const { client, calls } = makeClient({
      revoke_client_token: {
        data: [{ token_id: 'tok-1', revoked_at: '2026-05-20T22:00:00.000Z' }],
        error: null,
      },
    })

    const result = await revokeClientToken(client, 'tok-1')

    assert.deepEqual(result, { tokenId: 'tok-1', revokedAt: '2026-05-20T22:00:00.000Z' })
    assert.deepEqual(calls, [{ name: 'revoke_client_token', args: { p_token_id: 'tok-1' } }])
  })

  test('throws ClientTokenRevokeError when RPC returns Postgres error', async () => {
    const { client } = makeClient({
      revoke_client_token: {
        data: null,
        error: { code: 'P0001', message: 'REVOKE_NOT_ALLOWED' },
      },
    })

    await assert.rejects(
      () => revokeClientToken(client, 'tok-1'),
      (err) =>
        err instanceof ClientTokenRevokeError &&
        err.code === 'P0001' &&
        err.message === 'REVOKE_NOT_ALLOWED'
    )
  })

  test('throws NO_ROW when RPC returns empty array', async () => {
    const { client } = makeClient({
      revoke_client_token: { data: [], error: null },
    })

    await assert.rejects(
      () => revokeClientToken(client, 'tok-1'),
      (err) => err instanceof ClientTokenRevokeError && err.code === 'NO_ROW'
    )
  })
})

describe('rotateClientToken', () => {
  test('returns new + old token info on success', async () => {
    const { client, calls } = makeClient({
      rotate_client_token: {
        data: [
          {
            new_token_id: 'tok-new',
            new_token: 'abc123def456',
            old_token_id: 'tok-old',
            old_revoked_at: '2026-05-20T22:00:00.000Z',
          },
        ],
        error: null,
      },
    })

    const result = await rotateClientToken(client, 'tok-old', null)

    assert.deepEqual(result, {
      newTokenId: 'tok-new',
      newToken: 'abc123def456',
      oldTokenId: 'tok-old',
      oldRevokedAt: '2026-05-20T22:00:00.000Z',
    })
    assert.deepEqual(calls, [
      {
        name: 'rotate_client_token',
        args: { p_token_id: 'tok-old', p_new_expires_at: null },
      },
    ])
  })

  test('passes explicit newExpiresAt through to the RPC', async () => {
    const { client, calls } = makeClient({
      rotate_client_token: {
        data: [
          {
            new_token_id: 'tok-new',
            new_token: 'abc',
            old_token_id: 'tok-old',
            old_revoked_at: '2026-05-20T22:00:00.000Z',
          },
        ],
        error: null,
      },
    })

    await rotateClientToken(client, 'tok-old', '2026-12-31T00:00:00.000Z')

    assert.deepEqual(calls[0].args, {
      p_token_id: 'tok-old',
      p_new_expires_at: '2026-12-31T00:00:00.000Z',
    })
  })

  test('throws ClientTokenRotateError when RPC fails', async () => {
    const { client } = makeClient({
      rotate_client_token: {
        data: null,
        error: { code: 'P0001', message: 'TOKEN_ALREADY_REVOKED' },
      },
    })

    await assert.rejects(
      () => rotateClientToken(client, 'tok-old', null),
      (err) =>
        err instanceof ClientTokenRotateError &&
        err.code === 'P0001' &&
        err.message === 'TOKEN_ALREADY_REVOKED'
    )
  })

  test('throws NO_ROW when RPC returns empty array', async () => {
    const { client } = makeClient({
      rotate_client_token: { data: [], error: null },
    })

    await assert.rejects(
      () => rotateClientToken(client, 'tok-old', null),
      (err) => err instanceof ClientTokenRotateError && err.code === 'NO_ROW'
    )
  })
})
