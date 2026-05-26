import assert from 'node:assert/strict'
import test from 'node:test'

import { receiveWebsitePaymentConfirmed } from '@/lib/server/website-integration'

// Integration test for the inbound `payment-confirmed` business handler:
// after `activatePaidProposal` succeeds, the handler must auto-credit
// developer + noon shares via the shared `creditActivationEarnings`
// service (ADR-021). This verifies the wire — Phase A unit tests already
// cover the service's allocation policy exhaustively.
//
// Mock surface (per call chain):
//   findLinkByExternalRef:    website_inbound_links .select().eq().eq().maybeSingle()
//   getApprovedInboundProp:   lead_proposals        .select().eq().single()
//   createPaymentIfMissing:   payments              .select().eq().eq().maybeSingle()
//                             payments              .insert().select().single() (only when not found)
//   resolveIntegrationActor:  user_profiles         .select().in().eq().order().limit().maybeSingle()
//   activatePaidProposal:     rpc('activate_paid_proposal')
//   NEW developer lookup:     projects              .select().eq().maybeSingle()
//   service upsert:           earnings_ledger       .upsert()
//   service wallet credit:    rpc('credit_wallet_bucket')  (per non-null actor)
//   final link update:        website_inbound_links .update().eq()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINK_ID = 'link-0000-0000-4000-8000-000000000001'
const LEAD_ID = 'lead-0000-0000-4000-8000-000000000002'
const PROPOSAL_ID = 'prop-0000-0000-4000-8000-000000000003'
const PAYMENT_ID = 'pay0-0000-0000-4000-8000-000000000004'
const PROJECT_ID = 'proj-0000-0000-4000-8000-000000000005'
const DEVELOPER_ID = 'dev0-0000-0000-4000-8000-000000000006'
const ACTOR_ID = 'actr-0000-0000-4000-8000-000000000007'
const EXTERNAL_PAYMENT_ID = 'pi_live_inbound_xyz789'
const EXTERNAL_SESSION_ID = 'cs_live_inbound_abc123'
const EXTERNAL_PROPOSAL_ID = 'noonweb_proposal_999'

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    external_source: 'noon_website',
    external_session_id: EXTERNAL_SESSION_ID,
    external_proposal_id: EXTERNAL_PROPOSAL_ID,
    external_payment_id: EXTERNAL_PAYMENT_ID,
    maxwell: {},
    handoff: {},
    metadata: {},
    payment: { amount: 1000, currency: 'USD', paid_at: '2026-05-23T10:00:00.000Z' },
    ...overrides,
  } as never
}

function makeLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    lead_id: LEAD_ID,
    proposal_id: PROPOSAL_ID,
    external_source: 'noon_website',
    external_session_id: EXTERNAL_SESSION_ID,
    external_proposal_id: EXTERNAL_PROPOSAL_ID,
    external_payment_id: null,
    project_id: null,
    current_status: 'proposal_approved',
    ...overrides,
  }
}

const proposalRow = {
  id: PROPOSAL_ID,
  title: 'Inbound proposal',
  body: 'Approved by PM.',
  amount: 1000,
  currency: 'USD',
  lead_id: LEAD_ID,
  review_status: 'approved',
}

const actorRow = { id: ACTOR_ID, role: 'admin' }

const activationRpcResult = {
  payment_id: PAYMENT_ID,
  proposal_id: PROPOSAL_ID,
  lead_id: LEAD_ID,
  project_id: PROJECT_ID,
  activated_now: true,
  payment_was_already_succeeded: false,
}

// ---------------------------------------------------------------------------
// Mock client. FIFO queues per (terminal-op, table) and per rpc name.
// Matches the pattern in tests/server/api/webhooks/stripe-checkout-completed.test.ts.
// ---------------------------------------------------------------------------

type Script = Record<string, Array<{ data: unknown; error: unknown }>>

interface RecordedOp {
  table: string
  op: string
  args: unknown[]
}

interface RecordedRpc {
  name: string
  args: Record<string, unknown>
}

function makeMockClient(opts: {
  maybeSingleByTable?: Script
  singleByTable?: Script
  upsertByTable?: Script
  updateByTable?: Script
  rpcByName?: Script
}) {
  const queues = {
    maybeSingle: { ...(opts.maybeSingleByTable ?? {}) },
    single: { ...(opts.singleByTable ?? {}) },
    upsert: { ...(opts.upsertByTable ?? {}) },
    update: { ...(opts.updateByTable ?? {}) },
    rpc: { ...(opts.rpcByName ?? {}) },
  }

  const ops: RecordedOp[] = []
  const rpcCalls: RecordedRpc[] = []

  function pop(q: Script, table: string, ctx: string) {
    const arr = q[table]
    if (!arr || arr.length === 0) {
      throw new Error(`Mock: no scripted ${ctx} response for table "${table}"`)
    }
    return arr.shift()!
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
    chain.upsert = (..._args: unknown[]) => {
      ops.push({ table, op: 'upsert', args: _args })
      const r = queues.upsert[table]?.shift() ?? { data: null, error: null }
      return Promise.resolve(r)
    }
    chain.update = (...args: unknown[]) => {
      ops.push({ table, op: 'update', args })
      return {
        eq: (..._eqArgs: unknown[]) => {
          ops.push({ table, op: 'eq', args: _eqArgs })
          const r = queues.update[table]?.shift() ?? { data: null, error: null }
          return Promise.resolve(r)
        },
      }
    }
    chain.eq = (...args: unknown[]) => {
      ops.push({ table, op: 'eq', args })
      return chain
    }
    chain.in = (...args: unknown[]) => {
      ops.push({ table, op: 'in', args })
      return chain
    }
    chain.order = (...args: unknown[]) => {
      ops.push({ table, op: 'order', args })
      return chain
    }
    chain.limit = (...args: unknown[]) => {
      ops.push({ table, op: 'limit', args })
      return chain
    }
    chain.maybeSingle = () => {
      ops.push({ table, op: 'maybeSingle', args: [] })
      return Promise.resolve(pop(queues.maybeSingle, table, 'maybeSingle'))
    }
    chain.single = () => {
      ops.push({ table, op: 'single', args: [] })
      return Promise.resolve(pop(queues.single, table, 'single'))
    }

    return chain
  }

  return {
    from: (table: string) => chainFor(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      const arr = queues.rpc[name]
      if (!arr || arr.length === 0) {
        return Promise.resolve({ data: null, error: null })
      }
      return Promise.resolve(arr.shift()!)
    },
    _ops: ops,
    _rpcCalls: rpcCalls,
  }
}

function baseMockArgs(overrides: { developerUserId?: string | null } = {}) {
  const developerUserId = overrides.developerUserId === undefined ? DEVELOPER_ID : overrides.developerUserId

  return {
    maybeSingleByTable: {
      website_inbound_links: [{ data: makeLinkRow(), error: null }],
      // createPaymentRecordIfMissing: lookup returns null → must insert
      payments: [{ data: null, error: null }],
      // resolveIntegrationActorId
      user_profiles: [{ data: actorRow, error: null }],
      // NEW: project developer lookup
      projects: [{ data: { developer_user_id: developerUserId }, error: null }],
      // PR #108 absorbed drift: linkInboundPrototypeWorkspaceToProject lookup
      // (no workspace in these scenarios → early-return at website-integration.ts:157)
      prototype_workspaces: [{ data: null, error: null }],
    },
    singleByTable: {
      lead_proposals: [{ data: proposalRow, error: null }],
      // createPaymentRecordIfMissing fallback insert .select().single()
      payments: [{ data: { id: PAYMENT_ID }, error: null }],
    },
    updateByTable: {
      website_inbound_links: [{ data: null, error: null }],
    },
    upsertByTable: {
      earnings_ledger: [{ data: null, error: null }],
    },
    rpcByName: {
      activate_paid_proposal: [{ data: [activationRpcResult], error: null }],
      // 1 call expected for inbound with developer assigned (noon has actor_id=null → skipped)
      credit_wallet_bucket: [{ data: true, error: null }],
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('payment-confirmed inbound: credits developer + noon (audit), no seller row, namespace = website:', async () => {
  const client = makeMockClient(baseMockArgs())

  const result = await receiveWebsitePaymentConfirmed(makePayload(), client as never)

  // Return shape
  assert.equal(result.status, 'project_activated')
  assert.equal(result.projectId, PROJECT_ID)
  assert.equal(result.leadId, LEAD_ID)

  // earnings_ledger upsert — should have 2 rows (developer + noon), NO seller
  const upsertOp = client._ops.find((o) => o.table === 'earnings_ledger' && o.op === 'upsert')
  assert.ok(upsertOp, 'earnings_ledger upsert must have happened')
  const upsertRows = (upsertOp.args as unknown[])[0] as Array<Record<string, unknown>>
  assert.equal(upsertRows.length, 2, 'inbound has 2 rows (developer + noon), no seller')

  const sellerRow = upsertRows.find((r) => r.actor_role === 'seller')
  assert.equal(sellerRow, undefined, 'inbound has NO seller earning row')

  const developerRow = upsertRows.find((r) => r.actor_role === 'developer')
  assert.ok(developerRow, 'developer row inserted')
  assert.equal(developerRow.actor_id, DEVELOPER_ID)
  assert.equal(developerRow.amount, 500, '50% of $1000 inbound')
  assert.equal(developerRow.idempotency_key, `website:${EXTERNAL_PAYMENT_ID}:earning:developer:${DEVELOPER_ID}`)
  assert.equal(developerRow.notes, 'Inbound activation - 50% of base $1000')

  const noonRow = upsertRows.find((r) => r.actor_role === 'noon')
  assert.ok(noonRow, 'noon row inserted')
  assert.equal(noonRow.actor_id, null)
  assert.equal(noonRow.amount, 500)
  assert.equal(noonRow.idempotency_key, `website:${EXTERNAL_PAYMENT_ID}:earning:noon:unassigned`)

  // Wallet RPC — exactly 1 call (developer only; noon actor_id=null → skipped)
  const walletCalls = client._rpcCalls.filter((c) => c.name === 'credit_wallet_bucket')
  assert.equal(walletCalls.length, 1, 'only developer gets wallet credit (noon skipped)')
  assert.equal(walletCalls[0].args.p_profile_id, DEVELOPER_ID)
  assert.equal(walletCalls[0].args.p_amount, 500)
  assert.equal(walletCalls[0].args.p_balance_bucket, 'pending')
  assert.equal(walletCalls[0].args.p_entry_type, 'earnings_distribution')
  assert.equal(walletCalls[0].args.p_reference_type, 'payment')
  assert.equal(walletCalls[0].args.p_reference_id, PAYMENT_ID)
  assert.equal(walletCalls[0].args.p_idempotency_key, `website:${EXTERNAL_PAYMENT_ID}:wallet:developer:${DEVELOPER_ID}`)

  const walletMetadata = walletCalls[0].args.p_metadata as Record<string, unknown>
  assert.equal(walletMetadata.channel, 'inbound')
  assert.equal(walletMetadata.actorRole, 'developer')
  assert.equal(walletMetadata.earningType, 'activation')

  // confirmSellerFee NEVER queried (inbound has no seller_fees row)
  const sellerFeesOps = client._ops.filter((o) => o.table === 'seller_fees')
  assert.equal(sellerFeesOps.length, 0, 'inbound never touches seller_fees table')

  // points_ledger NEVER touched in inbound (no seller, operator-confirmed no developer points)
  const pointsOps = client._ops.filter((o) => o.table === 'points_ledger')
  assert.equal(pointsOps.length, 0, 'inbound awards no points')
})

test('payment-confirmed inbound: developerUserId=null boundary — audit row inserted, wallet credit skipped', async () => {
  const client = makeMockClient({
    ...baseMockArgs({ developerUserId: null }),
    rpcByName: {
      activate_paid_proposal: [{ data: [activationRpcResult], error: null }],
      // ZERO wallet credit calls expected (developer null + noon null both skipped)
      credit_wallet_bucket: [],
    },
  })

  const result = await receiveWebsitePaymentConfirmed(makePayload(), client as never)
  assert.equal(result.status, 'project_activated')

  // earnings_ledger upsert still happens with 2 rows (audit invariant)
  const upsertOp = client._ops.find((o) => o.table === 'earnings_ledger' && o.op === 'upsert')
  const upsertRows = (upsertOp!.args as unknown[])[0] as Array<Record<string, unknown>>
  assert.equal(upsertRows.length, 2)

  const developerRow = upsertRows.find((r) => r.actor_role === 'developer')
  assert.equal(developerRow!.actor_id, null, 'developer row inserted with actor_id=null for audit')
  assert.equal(developerRow!.notes, 'Developer not yet assigned - pending resolution')
  assert.equal(developerRow!.idempotency_key, `website:${EXTERNAL_PAYMENT_ID}:earning:developer:unassigned`)

  // Zero wallet RPC calls
  const walletCalls = client._rpcCalls.filter((c) => c.name === 'credit_wallet_bucket')
  assert.equal(walletCalls.length, 0, 'no wallet credit when developer null')
})

test('payment-confirmed inbound: activation flow does NOT touch confirmSellerFee or points', async () => {
  const client = makeMockClient(baseMockArgs())

  await receiveWebsitePaymentConfirmed(makePayload(), client as never)

  // Verify by listing every distinct table touched
  const tablesTouched = new Set(client._ops.map((o) => o.table))
  assert.ok(!tablesTouched.has('seller_fees'), 'no seller_fees activity')
  assert.ok(!tablesTouched.has('points_ledger'), 'no points_ledger activity')
  assert.ok(!tablesTouched.has('lead_activities'), 'no lead_activities (confirmSellerFee side effect)')

  // Verify which tables ARE touched (sanity check the happy path)
  assert.ok(tablesTouched.has('website_inbound_links'), 'link lookup + final update')
  assert.ok(tablesTouched.has('lead_proposals'), 'proposal lookup')
  assert.ok(tablesTouched.has('payments'), 'payment record')
  assert.ok(tablesTouched.has('user_profiles'), 'actor resolution')
  assert.ok(tablesTouched.has('projects'), 'developer lookup')
  assert.ok(tablesTouched.has('earnings_ledger'), 'service upsert')

  // RPC list: activate_paid_proposal + credit_wallet_bucket only
  const rpcNames = new Set(client._rpcCalls.map((c) => c.name))
  assert.ok(rpcNames.has('activate_paid_proposal'))
  assert.ok(rpcNames.has('credit_wallet_bucket'))
  assert.equal(rpcNames.size, 2, 'only those two RPCs called')
})

test('payment-confirmed inbound: replay (link already has project_id) still calls service (idempotency at SQL level)', async () => {
  // Simulate replay: link already has project_id + external_payment_id set.
  // The service is still called; SQL-level idempotency (earnings_ledger.idempotency_key
  // unique + wallet_ledger metadata partial index) handles dedup. The RPC returns
  // `false` to signal dedup, which the service surfaces in the row result.
  const client = makeMockClient({
    maybeSingleByTable: {
      website_inbound_links: [{
        data: makeLinkRow({
          external_payment_id: EXTERNAL_PAYMENT_ID,
          project_id: PROJECT_ID,
        }),
        error: null,
      }],
      payments: [{ data: { id: PAYMENT_ID }, error: null }],  // existing payment found → no insert
      user_profiles: [{ data: actorRow, error: null }],
      projects: [{ data: { developer_user_id: DEVELOPER_ID }, error: null }],
      // PR #108 absorbed drift: linkInboundPrototypeWorkspaceToProject lookup
      prototype_workspaces: [{ data: null, error: null }],
    },
    singleByTable: {
      lead_proposals: [{ data: proposalRow, error: null }],
    },
    updateByTable: {
      website_inbound_links: [{ data: null, error: null }],
    },
    upsertByTable: {
      earnings_ledger: [{ data: null, error: null }],
    },
    rpcByName: {
      activate_paid_proposal: [{ data: [activationRpcResult], error: null }],
      credit_wallet_bucket: [{ data: false, error: null }],  // RPC returns false = deduped
    },
  })

  const result = await receiveWebsitePaymentConfirmed(makePayload(), client as never)

  assert.equal(result.idempotent, true, 'replay returns idempotent=true')

  // Service was called — wallet RPC executed — RPC returned false (deduped).
  // No double-credit because the SQL partial unique index on metadata->>'idempotencyKey'
  // catches the duplicate. The service surfaces this via walletCredited=false.
  const walletCalls = client._rpcCalls.filter((c) => c.name === 'credit_wallet_bucket')
  assert.equal(walletCalls.length, 1, 'service still called; SQL-level dedup is the safety net')
})
