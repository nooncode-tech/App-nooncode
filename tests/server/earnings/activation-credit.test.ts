import assert from 'node:assert/strict'
import test from 'node:test'

import {
  creditActivationEarnings,
  type CreditActivationEarningsParams,
} from '@/lib/server/earnings/activation-credit'

// Unit tests for the shared activation-earnings allocator.
// Architecture decisions: docs/adrs/ADR-021-inbound-earnings-auto-credit-extraction.md
// Spec: specs/fase-3-r4-inbound-earnings-auto-credit.md
//
// The service uses two Supabase surfaces:
//   - client.from('earnings_ledger').upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })
//   - client.rpc('credit_wallet_bucket', args) → returns boolean
// Tests mock both to verify the allocation policy + per-row wallet credit
// loop + namespace guard.

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111'
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222'
const LEAD_ID = '33333333-3333-4333-8333-333333333333'
const SELLER_ID = '44444444-4444-4444-8444-444444444444'
const DEVELOPER_ID = '55555555-5555-4555-8555-555555555555'

// ---------------------------------------------------------------------------
// Mock client. Records every from()/upsert()/rpc() call for assertions.
// ---------------------------------------------------------------------------

interface ScriptedRpcResult {
  data: unknown
  error: { message: string } | null
}

interface ScriptedUpsertResult {
  data: unknown
  error: { message: string } | null
}

function makeClient(opts: {
  upsertResult?: ScriptedUpsertResult
  rpcResults?: ScriptedRpcResult[]
}) {
  const upsertResult = opts.upsertResult ?? { data: null, error: null }
  const rpcQueue = [...(opts.rpcResults ?? [])]

  const recorded = {
    earningsUpserts: [] as Array<{ rows: unknown; options: unknown }>,
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  }

  const client = {
    from(table: string) {
      if (table !== 'earnings_ledger') {
        throw new Error(`Unexpected client.from('${table}')`)
      }
      return {
        upsert(rows: unknown, options: unknown) {
          recorded.earningsUpserts.push({ rows, options })
          return Promise.resolve(upsertResult)
        },
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      recorded.rpcCalls.push({ name, args })
      const next = rpcQueue.shift()
      if (!next) {
        // Default: pretend the RPC inserted (returns true).
        return Promise.resolve({ data: true, error: null })
      }
      return Promise.resolve(next)
    },
    _recorded: recorded,
  }

  return client
}

function baseParams(overrides: Partial<CreditActivationEarningsParams> = {}): CreditActivationEarningsParams {
  return {
    activationAmount: 500,
    currency: 'USD',
    paymentId: PAYMENT_ID,
    proposalId: PROPOSAL_ID,
    leadId: LEAD_ID,
    seller: null,
    developerUserId: DEVELOPER_ID,
    channel: 'inbound',
    idempotencyKeyBase: 'website:pi_test_inbound_001',
    actorProfileId: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Outbound: full allocation with seller + developer + noon
// ---------------------------------------------------------------------------

test('creditActivationEarnings: outbound with seller — base subtracts seller amount; 3 earnings rows + 2 wallet credits (seller + developer; noon skipped)', async () => {
  const client = makeClient({})

  const result = await creditActivationEarnings(client as never, baseParams({
    activationAmount: 500,
    seller: { actorId: SELLER_ID, amount: 100 },
    channel: 'outbound',
    idempotencyKeyBase: 'stripe:cs_live_abc123',
  }))

  // base = 500 - 100 = 400; halfBase = 200
  assert.equal(result.base, 400)
  assert.equal(result.rows.length, 3)

  // Earnings ledger upsert — single call with 3 rows
  assert.equal(client._recorded.earningsUpserts.length, 1)
  const upsertCall = client._recorded.earningsUpserts[0]
  assert.deepEqual(upsertCall.options, { onConflict: 'idempotency_key', ignoreDuplicates: true })
  const upsertRows = upsertCall.rows as Array<Record<string, unknown>>
  assert.equal(upsertRows.length, 3)

  // Seller row
  assert.equal(upsertRows[0].actor_role, 'seller')
  assert.equal(upsertRows[0].actor_id, SELLER_ID)
  assert.equal(upsertRows[0].amount, 100)
  assert.equal(upsertRows[0].idempotency_key, `stripe:cs_live_abc123:earning:seller:${SELLER_ID}`)
  assert.equal(upsertRows[0].notes, 'Outbound activation - $100 (seller-selected)')

  // Developer row
  assert.equal(upsertRows[1].actor_role, 'developer')
  assert.equal(upsertRows[1].actor_id, DEVELOPER_ID)
  assert.equal(upsertRows[1].amount, 200)
  assert.equal(upsertRows[1].idempotency_key, `stripe:cs_live_abc123:earning:developer:${DEVELOPER_ID}`)
  assert.equal(upsertRows[1].notes, 'Outbound activation - 50% of base $400')

  // Noon row
  assert.equal(upsertRows[2].actor_role, 'noon')
  assert.equal(upsertRows[2].actor_id, null)
  assert.equal(upsertRows[2].amount, 200)
  assert.equal(upsertRows[2].idempotency_key, 'stripe:cs_live_abc123:earning:noon:unassigned')

  // Wallet credits — 2 RPC calls (seller + developer; noon skipped because actor_id null)
  assert.equal(client._recorded.rpcCalls.length, 2)
  assert.equal(client._recorded.rpcCalls[0].name, 'credit_wallet_bucket')
  assert.equal(client._recorded.rpcCalls[0].args.p_profile_id, SELLER_ID)
  assert.equal(client._recorded.rpcCalls[0].args.p_amount, 100)
  assert.equal(client._recorded.rpcCalls[0].args.p_idempotency_key, `stripe:cs_live_abc123:wallet:seller:${SELLER_ID}`)
  assert.equal(client._recorded.rpcCalls[1].args.p_profile_id, DEVELOPER_ID)
  assert.equal(client._recorded.rpcCalls[1].args.p_amount, 200)
  assert.equal(client._recorded.rpcCalls[1].args.p_idempotency_key, `stripe:cs_live_abc123:wallet:developer:${DEVELOPER_ID}`)

  // Per-row results
  assert.equal(result.rows[0].walletCredited, true)
  assert.equal(result.rows[1].walletCredited, true)
  assert.equal(result.rows[2].walletCredited, false)
  assert.equal(result.rows[2].walletIdempotencyKey, null)
})

// ---------------------------------------------------------------------------
// Inbound: no seller; full amount distributed dev + noon
// ---------------------------------------------------------------------------

test('creditActivationEarnings: inbound with seller=null — base equals activationAmount; 2 earnings rows (dev + noon) + 1 wallet credit (developer only)', async () => {
  const client = makeClient({})

  const result = await creditActivationEarnings(client as never, baseParams({
    activationAmount: 1000,
    seller: null,
    developerUserId: DEVELOPER_ID,
    channel: 'inbound',
    idempotencyKeyBase: 'website:pi_live_xyz789',
  }))

  // base = 1000 (no seller deduction); halfBase = 500
  assert.equal(result.base, 1000)
  assert.equal(result.rows.length, 2)

  const upsertRows = client._recorded.earningsUpserts[0].rows as Array<Record<string, unknown>>
  assert.equal(upsertRows.length, 2)

  // Developer row
  assert.equal(upsertRows[0].actor_role, 'developer')
  assert.equal(upsertRows[0].actor_id, DEVELOPER_ID)
  assert.equal(upsertRows[0].amount, 500)
  assert.equal(upsertRows[0].notes, 'Inbound activation - 50% of base $1000')
  assert.equal(upsertRows[0].idempotency_key, `website:pi_live_xyz789:earning:developer:${DEVELOPER_ID}`)

  // Noon row
  assert.equal(upsertRows[1].actor_role, 'noon')
  assert.equal(upsertRows[1].actor_id, null)
  assert.equal(upsertRows[1].amount, 500)

  // Only developer gets wallet credit; noon skipped
  assert.equal(client._recorded.rpcCalls.length, 1)
  assert.equal(client._recorded.rpcCalls[0].args.p_profile_id, DEVELOPER_ID)
  assert.equal(client._recorded.rpcCalls[0].args.p_idempotency_key, `website:pi_live_xyz789:wallet:developer:${DEVELOPER_ID}`)
  assert.equal(client._recorded.rpcCalls[0].args.p_reference_type, 'payment')
  assert.equal(client._recorded.rpcCalls[0].args.p_reference_id, PAYMENT_ID)
  assert.equal(client._recorded.rpcCalls[0].args.p_balance_bucket, 'pending')
  assert.equal(client._recorded.rpcCalls[0].args.p_entry_type, 'earnings_distribution')

  // Channel propagated to metadata
  const metadata = client._recorded.rpcCalls[0].args.p_metadata as Record<string, unknown>
  assert.equal(metadata.channel, 'inbound')
  assert.equal(metadata.actorRole, 'developer')
  assert.equal(metadata.earningType, 'activation')
})

// ---------------------------------------------------------------------------
// developerUserId=null boundary
// ---------------------------------------------------------------------------

test('creditActivationEarnings: developerUserId=null — earnings_ledger row inserted with actor_id=null (audit), wallet credit skipped', async () => {
  const client = makeClient({})

  const result = await creditActivationEarnings(client as never, baseParams({
    activationAmount: 800,
    seller: null,
    developerUserId: null,
    channel: 'inbound',
    idempotencyKeyBase: 'website:pi_inbound_no_dev',
  }))

  // 2 earnings rows still inserted (audit invariant)
  const upsertRows = client._recorded.earningsUpserts[0].rows as Array<Record<string, unknown>>
  assert.equal(upsertRows.length, 2)
  assert.equal(upsertRows[0].actor_role, 'developer')
  assert.equal(upsertRows[0].actor_id, null)
  assert.equal(upsertRows[0].amount, 400)
  assert.equal(upsertRows[0].notes, 'Developer not yet assigned - pending resolution')
  assert.equal(upsertRows[0].idempotency_key, 'website:pi_inbound_no_dev:earning:developer:unassigned')

  // ZERO wallet credits — developer null + noon null both skipped
  assert.equal(client._recorded.rpcCalls.length, 0)

  // Per-row results reflect skip
  assert.equal(result.rows[0].walletCredited, false)
  assert.equal(result.rows[0].walletIdempotencyKey, null)
  assert.equal(result.rows[1].walletCredited, false)
})

// ---------------------------------------------------------------------------
// Idempotency: RPC returns false (deduped)
// ---------------------------------------------------------------------------

test('creditActivationEarnings: RPC returns false on dedupe → walletCredited reflects false in result', async () => {
  const client = makeClient({
    rpcResults: [{ data: false, error: null }],
  })

  const result = await creditActivationEarnings(client as never, baseParams({
    activationAmount: 200,
    seller: null,
    developerUserId: DEVELOPER_ID,
  }))

  // Wallet RPC was called but returned false (deduped)
  assert.equal(client._recorded.rpcCalls.length, 1)
  assert.equal(result.rows[0].walletCredited, false)
  // earnings ledger key is still recorded (the upsert is idempotent at SQL level too)
  assert.equal(result.rows[0].walletIdempotencyKey, `website:pi_test_inbound_001:wallet:developer:${DEVELOPER_ID}`)
})

// ---------------------------------------------------------------------------
// Base = 0 (seller takes everything)
// ---------------------------------------------------------------------------

test('creditActivationEarnings: outbound seller takes entire activation amount → only seller row (no dev/noon)', async () => {
  const client = makeClient({})

  const result = await creditActivationEarnings(client as never, baseParams({
    activationAmount: 100,
    seller: { actorId: SELLER_ID, amount: 100 },
    channel: 'outbound',
    idempotencyKeyBase: 'stripe:cs_seller_full',
  }))

  assert.equal(result.base, 0)
  assert.equal(result.rows.length, 1)

  const upsertRows = client._recorded.earningsUpserts[0].rows as Array<Record<string, unknown>>
  assert.equal(upsertRows.length, 1)
  assert.equal(upsertRows[0].actor_role, 'seller')

  // Only seller wallet credit
  assert.equal(client._recorded.rpcCalls.length, 1)
  assert.equal(client._recorded.rpcCalls[0].args.p_profile_id, SELLER_ID)
})

// ---------------------------------------------------------------------------
// Activation amount of 0 with no seller → nothing to allocate
// ---------------------------------------------------------------------------

test('creditActivationEarnings: activationAmount=0 with no seller → zero rows, zero credits, zero upsert', async () => {
  const client = makeClient({})

  const result = await creditActivationEarnings(client as never, baseParams({
    activationAmount: 0,
    seller: null,
  }))

  assert.equal(result.base, 0)
  assert.equal(result.rows.length, 0)
  assert.equal(client._recorded.earningsUpserts.length, 0)
  assert.equal(client._recorded.rpcCalls.length, 0)
})

// ---------------------------------------------------------------------------
// Namespace mismatch guard
// ---------------------------------------------------------------------------

test('creditActivationEarnings: channel=inbound + idempotencyKeyBase missing website: prefix → throws IDEMPOTENCY_KEY_BASE_NAMESPACE_MISMATCH', async () => {
  const client = makeClient({})

  await assert.rejects(
    creditActivationEarnings(client as never, baseParams({
      channel: 'inbound',
      idempotencyKeyBase: 'stripe:cs_wrong_namespace',
    })),
    /IDEMPOTENCY_KEY_BASE_NAMESPACE_MISMATCH/,
  )

  // Should reject BEFORE any DB call
  assert.equal(client._recorded.earningsUpserts.length, 0)
  assert.equal(client._recorded.rpcCalls.length, 0)
})

test('creditActivationEarnings: channel=outbound + idempotencyKeyBase missing stripe: prefix → throws IDEMPOTENCY_KEY_BASE_NAMESPACE_MISMATCH', async () => {
  const client = makeClient({})

  await assert.rejects(
    creditActivationEarnings(client as never, baseParams({
      channel: 'outbound',
      idempotencyKeyBase: 'website:pi_wrong_namespace',
      seller: { actorId: SELLER_ID, amount: 50 },
    })),
    /IDEMPOTENCY_KEY_BASE_NAMESPACE_MISMATCH/,
  )

  assert.equal(client._recorded.earningsUpserts.length, 0)
  assert.equal(client._recorded.rpcCalls.length, 0)
})

// ---------------------------------------------------------------------------
// Error propagation: earnings upsert fails → throws, no wallet credit attempted
// ---------------------------------------------------------------------------

test('creditActivationEarnings: earnings_ledger upsert error → throws, no wallet RPC call attempted', async () => {
  const client = makeClient({
    upsertResult: { data: null, error: { message: 'duplicate key value' } },
  })

  await assert.rejects(
    creditActivationEarnings(client as never, baseParams({
      seller: null,
      developerUserId: DEVELOPER_ID,
    })),
    /Failed to insert earnings: duplicate key value/,
  )

  // Upsert was attempted, RPC was not
  assert.equal(client._recorded.earningsUpserts.length, 1)
  assert.equal(client._recorded.rpcCalls.length, 0)
})

// ---------------------------------------------------------------------------
// Error propagation: wallet RPC fails → throws (fail-closed per ADR-021 D4)
// ---------------------------------------------------------------------------

test('creditActivationEarnings: wallet RPC error → throws (fail-closed)', async () => {
  const client = makeClient({
    rpcResults: [{ data: null, error: { message: 'PROFILE_NOT_FOUND' } }],
  })

  await assert.rejects(
    creditActivationEarnings(client as never, baseParams({
      seller: null,
      developerUserId: DEVELOPER_ID,
    })),
    /Failed to credit wallet: PROFILE_NOT_FOUND/,
  )

  // Upsert succeeded (so partial retry must dedupe on next call)
  assert.equal(client._recorded.earningsUpserts.length, 1)
  // First wallet RPC attempted; subsequent attempts cut short by throw
  assert.equal(client._recorded.rpcCalls.length, 1)
})

// ---------------------------------------------------------------------------
// Rounding edge case
// ---------------------------------------------------------------------------

test('creditActivationEarnings: odd base produces cents-rounded halves', async () => {
  const client = makeClient({})

  // base = 333 → halfBase = 166.5
  const result = await creditActivationEarnings(client as never, baseParams({
    activationAmount: 333,
    seller: null,
    developerUserId: DEVELOPER_ID,
  }))

  assert.equal(result.base, 333)
  const upsertRows = client._recorded.earningsUpserts[0].rows as Array<Record<string, unknown>>
  assert.equal(upsertRows[0].amount, 166.5)
  assert.equal(upsertRows[1].amount, 166.5)
})

// ---------------------------------------------------------------------------
// Outbound with seller but no developer (developer not yet assigned)
// ---------------------------------------------------------------------------

test('creditActivationEarnings: outbound with seller + developerUserId=null → seller credited, dev audit row only, noon row inserted but skipped', async () => {
  const client = makeClient({})

  const result = await creditActivationEarnings(client as never, baseParams({
    activationAmount: 500,
    seller: { actorId: SELLER_ID, amount: 100 },
    developerUserId: null,
    channel: 'outbound',
    idempotencyKeyBase: 'stripe:cs_no_dev',
  }))

  // 3 earnings rows (seller + dev with actor_id=null + noon)
  assert.equal(result.rows.length, 3)
  const upsertRows = client._recorded.earningsUpserts[0].rows as Array<Record<string, unknown>>
  assert.equal(upsertRows.length, 3)
  assert.equal(upsertRows[1].actor_role, 'developer')
  assert.equal(upsertRows[1].actor_id, null)
  assert.equal(upsertRows[1].notes, 'Developer not yet assigned - pending resolution')

  // Only seller gets wallet credit (developer skipped because actor_id null, noon always skipped)
  assert.equal(client._recorded.rpcCalls.length, 1)
  assert.equal(client._recorded.rpcCalls[0].args.p_profile_id, SELLER_ID)
})
