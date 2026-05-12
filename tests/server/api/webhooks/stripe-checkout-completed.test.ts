import assert from 'node:assert/strict'
import test from 'node:test'
import type Stripe from 'stripe'

import { handleCheckoutSessionCompleted } from '@/app/api/webhooks/stripe/route'

// ---------------------------------------------------------------------------
// Mock supabase admin client. The webhook handler routes through:
//   - .from('payments').select().eq().maybeSingle()
//   - .rpc('activate_paid_proposal', ...)
//   - .from('lead_proposals').select().eq().maybeSingle()
//   - .from('leads').select().eq().maybeSingle()
//   - .from('seller_fees').select().eq().maybeSingle()       (new in 3b)
//   - .from('projects').select().eq().maybeSingle()
//   - .from('earnings_ledger').upsert()
//   - .rpc('credit_wallet_bucket', ...)
//   - .from('seller_fees').select().eq().maybeSingle()       (confirmSellerFee re-read)
//   - .from('seller_fees').update().eq().select().single()   (confirmSellerFee update)
//   - .from('lead_activities').insert().select().single()    (activity log)
//   - .from('points_ledger').upsert()
//
// The mock dispatches per (table, operation) pair. Each table maintains a
// queue of scripted responses; calls pop the next response in FIFO order.
// ---------------------------------------------------------------------------

type Script = Record<string, Array<{ data: unknown; error: unknown }>>

interface RecordedOp {
  table: string
  op: 'select' | 'insert' | 'upsert' | 'update' | 'eq' | 'maybeSingle' | 'single'
  args: unknown[]
}

interface RecordedRpc {
  name: string
  args: unknown
}

function makeMockClient(opts: {
  maybeSingleByTable?: Script
  singleByTable?: Script
  upsertByTable?: Script
  rpcByName?: Script
}) {
  const maybeSingleByTable: Script = { ...(opts.maybeSingleByTable ?? {}) }
  const singleByTable: Script = { ...(opts.singleByTable ?? {}) }
  const upsertByTable: Script = { ...(opts.upsertByTable ?? {}) }
  const rpcByName: Script = { ...(opts.rpcByName ?? {}) }

  const ops: RecordedOp[] = []
  const rpcCalls: RecordedRpc[] = []

  function nextResponse(
    script: Script,
    key: string,
    context: string
  ): { data: unknown; error: unknown } {
    const queue = script[key]
    if (!queue || queue.length === 0) {
      throw new Error(`Mock: no scripted ${context} response for "${key}"`)
    }
    return queue.shift()!
  }

  function chainFor(table: string) {
    const chain: Record<string, (...args: unknown[]) => unknown> = {}

    chain.select = (...args: unknown[]) => {
      ops.push({ table, op: 'select', args })
      return chain
    }
    chain.insert = (...args: unknown[]) => {
      ops.push({ table, op: 'insert', args })
      return chain
    }
    chain.upsert = (...args: unknown[]) => {
      ops.push({ table, op: 'upsert', args })
      // Upserts can be awaited directly (no terminal method). Return a
      // promise-like that resolves to the next upsert response for this table.
      const response = upsertByTable[table]?.shift() ?? { data: null, error: null }
      return Promise.resolve(response)
    }
    chain.update = (...args: unknown[]) => {
      ops.push({ table, op: 'update', args })
      return chain
    }
    chain.eq = (...args: unknown[]) => {
      ops.push({ table, op: 'eq', args })
      return chain
    }
    chain.maybeSingle = () => {
      ops.push({ table, op: 'maybeSingle', args: [] })
      return Promise.resolve(nextResponse(maybeSingleByTable, table, 'maybeSingle'))
    }
    chain.single = () => {
      ops.push({ table, op: 'single', args: [] })
      return Promise.resolve(nextResponse(singleByTable, table, 'single'))
    }

    return chain
  }

  return {
    from: (table: string) => chainFor(table),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args })
      const response = rpcByName[name]?.shift() ?? { data: null, error: null }
      return Promise.resolve(response)
    },
    _ops: ops,
    _rpcCalls: rpcCalls,
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAYMENT_ID = 'pay-00000000-0000-4000-8000-000000000001'
const PROPOSAL_ID = 'prop-0000-0000-4000-8000-000000000002'
const LEAD_ID = 'lead-0000-0000-4000-8000-000000000003'
const SELLER_ID = 'user-0000-0000-4000-8000-000000000004'
const PROJECT_ID = 'proj-0000-0000-4000-8000-000000000005'
const DEVELOPER_ID = 'dev0-0000-0000-4000-8000-000000000006'

function makeSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_test_123',
    metadata: {
      noon_proposal_id: PROPOSAL_ID,
      noon_payment_id: PAYMENT_ID,
    },
    created: 1747000000,
    payment_intent: 'pi_test',
    payment_status: 'paid',
    customer: 'cus_test',
    ...overrides,
  } as unknown as Stripe.Checkout.Session
}

const activationRpcResult = {
  payment_id: PAYMENT_ID,
  proposal_id: PROPOSAL_ID,
  lead_id: LEAD_ID,
  project_id: PROJECT_ID,
  activated_now: true,
  payment_was_already_succeeded: false,
}

function makeSellerFeeRow(amount: 100 | 300 | 500, state = 'potential') {
  return {
    id: 'sf-0000-0000-4000-8000-000000000007',
    proposal_id: PROPOSAL_ID,
    lead_id: LEAD_ID,
    seller_profile_id: SELLER_ID,
    amount,
    currency: 'USD',
    state,
    payment_id: state === 'confirmed' ? PAYMENT_ID : null,
    payout_id: null,
    cancellation_reason: null,
    formula_context_snapshot: {},
    selected_at: '2026-05-11T00:00:00.000Z',
    confirmed_at: state === 'confirmed' ? '2026-05-11T01:00:00.000Z' : null,
    pending_payout_at: null,
    paid_out_at: null,
    cancelled_at: null,
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// Test 1: Happy path — outbound proposal with persisted seller_fees row
// ---------------------------------------------------------------------------

test('webhook: outbound proposal with seller_fees row=300 uses persisted amount, fires confirmSellerFee', async () => {
  const sellerFee = makeSellerFeeRow(300)
  const confirmedRow = { ...sellerFee, state: 'confirmed', confirmed_at: '2026-05-11T02:00:00.000Z', payment_id: PAYMENT_ID }

  const client = makeMockClient({
    maybeSingleByTable: {
      payments: [{ data: { id: PAYMENT_ID, amount: 599, proposal_id: PROPOSAL_ID, project_id: PROJECT_ID }, error: null }],
      lead_proposals: [{ data: { id: PROPOSAL_ID, lead_id: LEAD_ID, amount: 599 }, error: null }],
      leads: [{ data: { lead_origin: 'outbound', assigned_to: SELLER_ID, created_by: SELLER_ID }, error: null }],
      seller_fees: [
        { data: sellerFee, error: null },  // initial lookup by getSellerFeeByProposalId
        { data: sellerFee, error: null },  // confirmSellerFee re-read
      ],
      projects: [{ data: { developer_user_id: DEVELOPER_ID }, error: null }],
    },
    singleByTable: {
      seller_fees: [{ data: confirmedRow, error: null }],   // confirmSellerFee update
      lead_activities: [{ data: { id: 'act-1' }, error: null }],  // activity log
    },
    upsertByTable: {
      earnings_ledger: [{ data: null, error: null }],
      points_ledger: [{ data: null, error: null }],
    },
    rpcByName: {
      activate_paid_proposal: [{ data: [activationRpcResult], error: null }],
      credit_wallet_bucket: [
        { data: null, error: null },  // seller credit
        { data: null, error: null },  // developer credit
      ],
    },
  })

  await handleCheckoutSessionCompleted(client as never, makeSession())

  // Assert seller_fees was looked up for this proposal.
  const sellerFeesEqCalls = client._ops.filter((o) => o.table === 'seller_fees' && o.op === 'eq')
  assert.ok(
    sellerFeesEqCalls.some((o) => o.args[0] === 'proposal_id' && o.args[1] === PROPOSAL_ID),
    'should query seller_fees by proposal_id'
  )

  // Assert earnings_ledger upsert received the seller earning row with amount=300.
  const earningsUpsert = client._ops.find((o) => o.table === 'earnings_ledger' && o.op === 'upsert')
  assert.ok(earningsUpsert, 'should upsert to earnings_ledger')
  const earningRows = earningsUpsert!.args[0] as Array<{ actor_role: string; amount: number }>
  const sellerRow = earningRows.find((r) => r.actor_role === 'seller')
  assert.equal(sellerRow?.amount, 300, 'seller earning amount should be the persisted 300, not hardcoded 100')

  // Assert base for dev/noon split = activationAmount(599) - sellerFee(300) = 299; each gets 50% = 149.50
  const developerRow = earningRows.find((r) => r.actor_role === 'developer')
  assert.equal(developerRow?.amount, 149.5, 'developer earning = 50% of (599 - 300)')
  const noonRow = earningRows.find((r) => r.actor_role === 'noon')
  assert.equal(noonRow?.amount, 149.5, 'noon earning = 50% of (599 - 300)')

  // Assert confirmSellerFee triggered the state machine update.
  const sellerFeesUpdate = client._ops.find((o) => o.table === 'seller_fees' && o.op === 'update')
  assert.ok(sellerFeesUpdate, 'confirmSellerFee should fire an update on seller_fees')
  const patch = sellerFeesUpdate!.args[0] as Record<string, unknown>
  assert.equal(patch.state, 'confirmed')
  assert.equal(patch.payment_id, PAYMENT_ID)

  // Assert activity log row was inserted with seller_fee_confirmed type.
  const activityInsert = client._ops.find((o) => o.table === 'lead_activities' && o.op === 'insert')
  assert.ok(activityInsert, 'activity log row should be inserted')
  const activityRow = activityInsert!.args[0] as Record<string, unknown>
  assert.equal(activityRow.activity_type, 'seller_fee_confirmed')
})

// ---------------------------------------------------------------------------
// Test 2: Legacy fallback — outbound proposal without a seller_fees row
// ---------------------------------------------------------------------------

test('webhook: outbound proposal WITHOUT seller_fees row falls back to 100, skips confirmSellerFee', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      payments: [{ data: { id: PAYMENT_ID, amount: 599, proposal_id: PROPOSAL_ID, project_id: PROJECT_ID }, error: null }],
      lead_proposals: [{ data: { id: PROPOSAL_ID, lead_id: LEAD_ID, amount: 599 }, error: null }],
      leads: [{ data: { lead_origin: 'outbound', assigned_to: SELLER_ID, created_by: SELLER_ID }, error: null }],
      seller_fees: [{ data: null, error: null }], // no row — legacy in-flight proposal
      projects: [{ data: { developer_user_id: DEVELOPER_ID }, error: null }],
    },
    singleByTable: {},
    upsertByTable: {
      earnings_ledger: [{ data: null, error: null }],
      points_ledger: [{ data: null, error: null }],
    },
    rpcByName: {
      activate_paid_proposal: [{ data: [activationRpcResult], error: null }],
      credit_wallet_bucket: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    },
  })

  await handleCheckoutSessionCompleted(client as never, makeSession())

  // Seller earning uses the legacy fallback (100).
  const earningsUpsert = client._ops.find((o) => o.table === 'earnings_ledger' && o.op === 'upsert')
  const earningRows = earningsUpsert!.args[0] as Array<{ actor_role: string; amount: number; notes: string }>
  const sellerRow = earningRows.find((r) => r.actor_role === 'seller')
  assert.equal(sellerRow?.amount, 100, 'fallback path should use 100 for the seller earning')
  assert.match(sellerRow!.notes, /legacy fallback/, 'fallback notes should mark the legacy path')

  // No confirmSellerFee call (no row to transition).
  const sellerFeesUpdate = client._ops.find((o) => o.table === 'seller_fees' && o.op === 'update')
  assert.equal(sellerFeesUpdate, undefined, 'no seller_fees update when row missing')

  // No activity log for seller_fee transition.
  const activityInsert = client._ops.find((o) => o.table === 'lead_activities' && o.op === 'insert')
  assert.equal(activityInsert, undefined, 'no activity log when no row to transition')
})

// ---------------------------------------------------------------------------
// Test 3: Inbound proposal — seller_fees is not even looked up
// ---------------------------------------------------------------------------

test('webhook: inbound proposal skips seller_fees lookup and uses fee=0 for split', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      payments: [{ data: { id: PAYMENT_ID, amount: 499, proposal_id: PROPOSAL_ID, project_id: PROJECT_ID }, error: null }],
      lead_proposals: [{ data: { id: PROPOSAL_ID, lead_id: LEAD_ID, amount: 499 }, error: null }],
      leads: [{ data: { lead_origin: 'inbound', assigned_to: SELLER_ID, created_by: SELLER_ID }, error: null }],
      projects: [{ data: { developer_user_id: DEVELOPER_ID }, error: null }],
    },
    singleByTable: {},
    upsertByTable: {
      earnings_ledger: [{ data: null, error: null }],
      points_ledger: [{ data: null, error: null }],
    },
    rpcByName: {
      activate_paid_proposal: [{ data: [activationRpcResult], error: null }],
      credit_wallet_bucket: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    },
  })

  await handleCheckoutSessionCompleted(client as never, makeSession())

  // seller_fees should NEVER be queried for inbound.
  const sellerFeesOps = client._ops.filter((o) => o.table === 'seller_fees')
  assert.equal(sellerFeesOps.length, 0, 'inbound proposal should not query seller_fees at all')

  // No seller earning row in the split — only developer and noon at 50/50 of full activationAmount.
  const earningsUpsert = client._ops.find((o) => o.table === 'earnings_ledger' && o.op === 'upsert')
  const earningRows = earningsUpsert!.args[0] as Array<{ actor_role: string; amount: number }>
  const sellerRow = earningRows.find((r) => r.actor_role === 'seller')
  assert.equal(sellerRow, undefined, 'no seller earning row for inbound')

  const developerRow = earningRows.find((r) => r.actor_role === 'developer')
  assert.equal(developerRow?.amount, 249.5, 'developer earning = 50% of 499 for inbound')
})

// ---------------------------------------------------------------------------
// Test 4: confirmSellerFee error path — webhook completes despite state-machine failure
// ---------------------------------------------------------------------------

test('webhook: confirmSellerFee failure is logged and swallowed — payment + earnings still processed', async () => {
  const sellerFee = makeSellerFeeRow(300)

  const client = makeMockClient({
    maybeSingleByTable: {
      payments: [{ data: { id: PAYMENT_ID, amount: 599, proposal_id: PROPOSAL_ID, project_id: PROJECT_ID }, error: null }],
      lead_proposals: [{ data: { id: PROPOSAL_ID, lead_id: LEAD_ID, amount: 599 }, error: null }],
      leads: [{ data: { lead_origin: 'outbound', assigned_to: SELLER_ID, created_by: SELLER_ID }, error: null }],
      seller_fees: [
        { data: sellerFee, error: null }, // initial lookup
        { data: sellerFee, error: null }, // confirmSellerFee re-read
      ],
      projects: [{ data: { developer_user_id: DEVELOPER_ID }, error: null }],
    },
    singleByTable: {
      // The update inside updateSellerFeeState() fails — simulates an
      // unexpected DB-side error (e.g., FK violation, deadlock, RLS reject).
      seller_fees: [{ data: null, error: { message: 'simulated: connection timeout during state transition' } }],
    },
    upsertByTable: {
      earnings_ledger: [{ data: null, error: null }],
      points_ledger: [{ data: null, error: null }],
    },
    rpcByName: {
      activate_paid_proposal: [{ data: [activationRpcResult], error: null }],
      credit_wallet_bucket: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    },
  })

  // The webhook MUST complete without throwing — payment and earnings are
  // already processed at this point. State-machine failure is a secondary
  // concern that's logged and recovered separately.
  await assert.doesNotReject(() => handleCheckoutSessionCompleted(client as never, makeSession()))

  // Earnings ledger upsert + wallet credits MUST still have happened — the
  // payment is the source of truth for the money movement.
  const earningsUpsert = client._ops.find((o) => o.table === 'earnings_ledger' && o.op === 'upsert')
  assert.ok(earningsUpsert, 'earnings_ledger upsert must happen before confirmSellerFee')
  const earningRows = earningsUpsert!.args[0] as Array<{ actor_role: string; amount: number }>
  const sellerRow = earningRows.find((r) => r.actor_role === 'seller')
  assert.equal(sellerRow?.amount, 300, 'seller earning row still posted with correct amount')

  // Points award MUST still happen.
  const pointsUpsert = client._ops.find((o) => o.table === 'points_ledger' && o.op === 'upsert')
  assert.ok(pointsUpsert, 'points_ledger upsert must happen even if confirmSellerFee fails')

  // Wallet credits MUST still happen for each actor.
  const walletCredits = client._rpcCalls.filter((c) => c.name === 'credit_wallet_bucket')
  assert.ok(walletCredits.length >= 2, 'wallet credits for seller + developer must happen')

  // The update attempt DID happen (confirmSellerFee tried to transition).
  const sellerFeesUpdates = client._ops.filter((o) => o.table === 'seller_fees' && o.op === 'update')
  assert.equal(sellerFeesUpdates.length, 1, 'confirmSellerFee attempted the update before failing')

  // But NO activity log row was inserted — the update threw, so the activity
  // log was never reached.
  const activityInserts = client._ops.filter((o) => o.table === 'lead_activities' && o.op === 'insert')
  assert.equal(activityInserts.length, 0, 'activity log not written when state transition fails')
})

// ---------------------------------------------------------------------------
// Test 5: confirmSellerFee idempotent — webhook retry on already-confirmed row
// ---------------------------------------------------------------------------

test('webhook: retry with already-confirmed seller_fees row is idempotent (no second update)', async () => {
  const alreadyConfirmed = makeSellerFeeRow(300, 'confirmed')

  const client = makeMockClient({
    maybeSingleByTable: {
      payments: [{ data: { id: PAYMENT_ID, amount: 599, proposal_id: PROPOSAL_ID, project_id: PROJECT_ID }, error: null }],
      lead_proposals: [{ data: { id: PROPOSAL_ID, lead_id: LEAD_ID, amount: 599 }, error: null }],
      leads: [{ data: { lead_origin: 'outbound', assigned_to: SELLER_ID, created_by: SELLER_ID }, error: null }],
      seller_fees: [
        { data: alreadyConfirmed, error: null },  // initial lookup
        { data: alreadyConfirmed, error: null },  // confirmSellerFee re-read sees already confirmed
      ],
      projects: [{ data: { developer_user_id: DEVELOPER_ID }, error: null }],
    },
    singleByTable: {},  // no update or activity should fire
    upsertByTable: {
      earnings_ledger: [{ data: null, error: null }],
      points_ledger: [{ data: null, error: null }],
    },
    rpcByName: {
      activate_paid_proposal: [{ data: [activationRpcResult], error: null }],
      credit_wallet_bucket: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    },
  })

  await handleCheckoutSessionCompleted(client as never, makeSession())

  // Earnings split still uses the persisted amount (300) — idempotent: idempotency_key prevents duplicate row.
  const earningsUpsert = client._ops.find((o) => o.table === 'earnings_ledger' && o.op === 'upsert')
  const earningRows = earningsUpsert!.args[0] as Array<{ actor_role: string; amount: number }>
  const sellerRow = earningRows.find((r) => r.actor_role === 'seller')
  assert.equal(sellerRow?.amount, 300, 'still 300 on retry')

  // No second update on seller_fees: confirmSellerFee saw state=confirmed and short-circuited.
  const sellerFeesUpdates = client._ops.filter((o) => o.table === 'seller_fees' && o.op === 'update')
  assert.equal(sellerFeesUpdates.length, 0, 'idempotent: no second state transition write')

  // No second activity log row.
  const activityInserts = client._ops.filter((o) => o.table === 'lead_activities' && o.op === 'insert')
  assert.equal(activityInserts.length, 0, 'no duplicate activity row on retry')
})
