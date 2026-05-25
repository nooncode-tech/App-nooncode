import assert from 'node:assert/strict'
import test from 'node:test'

import {
  receiveWebsitePrototypeDecision,
  websitePrototypeDecisionPayloadSchema,
} from '@/lib/server/website-integration'
import {
  composePrototypeDecisionReplayResponseFromLedger,
  type WebsiteWebhookEventRecord,
} from '@/lib/server/website/webhook-events'

// Integration coverage for the synchronous business handler of the
// `prototype-decision` inbound webhook (ADR-023 + ADR-025).
//
// Covers AC-3 (accept happy-path persistence + return shape), AC-4
// (reject happy-path), AC-6 (error code matrix: 404 TOKEN_NOT_FOUND,
// 409 IDENTIFIER_MISMATCH, 410 TOKEN_EXPIRED, 409 ALREADY_DECIDED), and
// AC-2 (RPC gate semantics — exercised at SQL level by the migration; the
// TS handler test confirms the error-pass-through shape).
//
// Out of scope here:
//   - HMAC signature verification (covered by tests/server/website-webhook-auth.test.ts)
//   - Replay-path inside the route file (the helper test below covers the
//     unit; the route's branch into it is one branch and is best validated
//     by end-to-end staging probes against a live signed-request fixture)
//   - Maxwell draft side effect persistence (scheduled fire-and-forget; the
//     synchronous handler returns before it runs by design)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const LEAD_ID = '33333333-3333-4333-8333-333333333333'
const SELLER_ID = '44444444-4444-4444-8444-444444444444'
const DECISION_ID = '55555555-5555-4555-8555-555555555555'
const WEBHOOK_EVENT_ID = '66666666-6666-4666-8666-666666666666'
const SHARE_TOKEN = 'share-token-v1-abc123'
const DECIDED_AT = '2026-05-25T12:34:56.000Z'

interface RecordedOp {
  table: string
  op: string
  args: unknown[]
}

interface RecordedRpc {
  name: string
  args: Record<string, unknown>
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return websitePrototypeDecisionPayloadSchema.parse({
    external_source: 'noon_website',
    token: SHARE_TOKEN,
    prototype_workspace_id: WORKSPACE_ID,
    decision: 'accepted',
    notes: null,
    client: { user_agent: 'Mozilla/5.0 (Test Agent)' },
    metadata: {},
    ...overrides,
  })
}

type Script = Record<string, Array<{ data: unknown; error: unknown }>>

function makeMockClient(opts: {
  maybeSingleByTable?: Script
  singleByTable?: Script
  insertByTable?: Script
  updateByTable?: Script
}) {
  const queues = {
    maybeSingle: { ...(opts.maybeSingleByTable ?? {}) },
    single: { ...(opts.singleByTable ?? {}) },
    insert: { ...(opts.insertByTable ?? {}) },
    update: { ...(opts.updateByTable ?? {}) },
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
    let lastInsertResult: { data: unknown; error: unknown } | null = null

    chain.select = (...args: unknown[]) => {
      ops.push({ table, op: 'select', args })
      return chain
    }
    chain.insert = (...args: unknown[]) => {
      ops.push({ table, op: 'insert', args })
      lastInsertResult = queues.insert[table]?.shift() ?? { data: null, error: null }
      return chain
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
    chain.maybeSingle = () => {
      ops.push({ table, op: 'maybeSingle', args: [] })
      return Promise.resolve(pop(queues.maybeSingle, table, 'maybeSingle'))
    }
    chain.single = () => {
      ops.push({ table, op: 'single', args: [] })
      if (lastInsertResult) {
        const r = lastInsertResult
        lastInsertResult = null
        return Promise.resolve(r)
      }
      return Promise.resolve(pop(queues.single, table, 'single'))
    }

    return chain
  }

  return {
    from: (table: string) => chainFor(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
    _ops: ops,
    _rpcCalls: rpcCalls,
  }
}

function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKSPACE_ID,
    lead_id: LEAD_ID,
    status: 'ready',
    requested_by_profile_id: SELLER_ID,
    share_token_superseded_at: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// AC-3 — accept happy-path
// ---------------------------------------------------------------------------

test('prototype-decision: accept happy-path persists row + returns wire shape with draftPropuestaQueued=true', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: workspaceRow(), error: null }],
      // leadIsHardDeleted check
      leads: [{ data: { id: LEAD_ID }, error: null }],
      // findExistingPrototypeDecision check (no prior decision)
      prototype_decisions: [{ data: null, error: null }],
    },
    insertByTable: {
      prototype_decisions: [
        { data: { id: DECISION_ID, decided_at: DECIDED_AT }, error: null },
      ],
      // No user_notifications insert on accept (handled by fire-and-forget)
    },
  })

  const result = await receiveWebsitePrototypeDecision(
    makePayload({ decision: 'accepted' }),
    WEBHOOK_EVENT_ID,
    client as never,
  )

  assert.equal(result.idempotent, false)
  assert.equal(result.decisionId, DECISION_ID)
  assert.equal(result.prototypeWorkspaceId, WORKSPACE_ID)
  assert.equal(result.leadId, LEAD_ID)
  assert.equal(result.decision, 'accepted')
  assert.equal(result.decidedAt, DECIDED_AT)
  assert.equal(result.draftPropuestaQueued, true)
  assert.equal(result.sellerProfileId, SELLER_ID)

  // Verify the insert carried webhook_event_id forensic linkage.
  const insertOp = client._ops.find(
    (o) => o.table === 'prototype_decisions' && o.op === 'insert',
  )
  assert.ok(insertOp, 'prototype_decisions insert must occur')
  const inserted = (insertOp.args as unknown[])[0] as Record<string, unknown>
  assert.equal(inserted.prototype_workspace_id, WORKSPACE_ID)
  assert.equal(inserted.lead_id, LEAD_ID)
  assert.equal(inserted.decision, 'accepted')
  assert.equal(inserted.webhook_event_id, WEBHOOK_EVENT_ID)
  assert.equal(inserted.client_user_agent, 'Mozilla/5.0 (Test Agent)')

  // Verify NO seller notification is inserted synchronously on accept
  // (the accepted-path notification is enqueued by the fire-and-forget
  // helper after the response is written).
  const notificationInsertOps = client._ops.filter(
    (o) => o.table === 'user_notifications' && o.op === 'insert',
  )
  assert.equal(notificationInsertOps.length, 0, 'accept path defers notification to fire-and-forget')
})

// ---------------------------------------------------------------------------
// AC-4 — reject happy-path
// ---------------------------------------------------------------------------

test('prototype-decision: reject happy-path persists row + inserts seller notification synchronously', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: workspaceRow(), error: null }],
      leads: [{ data: { id: LEAD_ID }, error: null }],
      prototype_decisions: [{ data: null, error: null }],
    },
    insertByTable: {
      prototype_decisions: [
        { data: { id: DECISION_ID, decided_at: DECIDED_AT }, error: null },
      ],
      user_notifications: [{ data: null, error: null }],
    },
  })

  const result = await receiveWebsitePrototypeDecision(
    makePayload({
      decision: 'rejected',
      notes: 'No coincide con lo que pedimos; faltó la integración con WhatsApp.',
    }),
    WEBHOOK_EVENT_ID,
    client as never,
  )

  assert.equal(result.decision, 'rejected')
  assert.equal(result.draftPropuestaQueued, false)

  // Notification IS inserted synchronously on reject.
  const notifInsertOp = client._ops.find(
    (o) => o.table === 'user_notifications' && o.op === 'insert',
  )
  assert.ok(notifInsertOp, 'reject path inserts seller notification synchronously')
  const notif = (notifInsertOp.args as unknown[])[0] as Record<string, unknown>
  assert.equal(notif.profile_id, SELLER_ID)
  assert.equal(notif.source_kind, 'prototype_decision_received')
  assert.equal(notif.source_event_id, DECISION_ID)
  assert.equal(notif.domain, 'leads')
  // OQ-3 resolution — uses the new source_kind, not 'lead_activity'.
  assert.ok(
    typeof notif.body === 'string' && (notif.body as string).includes('rechazó'),
    'reject notification body mentions rejection',
  )
  assert.ok(
    typeof notif.body === 'string' && (notif.body as string).includes('WhatsApp'),
    'reject notification echoes truncated client notes',
  )
})

// ---------------------------------------------------------------------------
// AC-6 — error code matrix
// ---------------------------------------------------------------------------

test('prototype-decision: unknown token returns 404 PROTOTYPE_DECISION_TOKEN_NOT_FOUND', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: null, error: null }],
    },
  })

  await assert.rejects(
    () =>
      receiveWebsitePrototypeDecision(
        makePayload({ token: 'unknown-token' }),
        WEBHOOK_EVENT_ID,
        client as never,
      ),
    (err: unknown) => {
      const e = err as { code: string; status: number }
      assert.equal(e.code, 'PROTOTYPE_DECISION_TOKEN_NOT_FOUND')
      assert.equal(e.status, 404)
      return true
    },
  )
})

test('prototype-decision: workspace_id mismatch returns 409 PROTOTYPE_DECISION_IDENTIFIER_MISMATCH', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      // Token resolves to WORKSPACE_ID but payload carries OTHER_WORKSPACE_ID.
      prototype_workspaces: [{ data: workspaceRow(), error: null }],
    },
  })

  await assert.rejects(
    () =>
      receiveWebsitePrototypeDecision(
        makePayload({ prototype_workspace_id: OTHER_WORKSPACE_ID }),
        WEBHOOK_EVENT_ID,
        client as never,
      ),
    (err: unknown) => {
      const e = err as { code: string; status: number }
      assert.equal(e.code, 'PROTOTYPE_DECISION_IDENTIFIER_MISMATCH')
      assert.equal(e.status, 409)
      return true
    },
  )
})

test('prototype-decision: superseded token returns 410 PROTOTYPE_DECISION_TOKEN_EXPIRED', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [
        {
          data: workspaceRow({ share_token_superseded_at: '2026-05-24T10:00:00.000Z' }),
          error: null,
        },
      ],
    },
  })

  await assert.rejects(
    () =>
      receiveWebsitePrototypeDecision(makePayload(), WEBHOOK_EVENT_ID, client as never),
    (err: unknown) => {
      const e = err as { code: string; status: number }
      assert.equal(e.code, 'PROTOTYPE_DECISION_TOKEN_EXPIRED')
      assert.equal(e.status, 410)
      return true
    },
  )
})

test('prototype-decision: lead hard-deleted returns 410 PROTOTYPE_DECISION_LEAD_DELETED', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: workspaceRow(), error: null }],
      // leads lookup returns null → lead is gone
      leads: [{ data: null, error: null }],
    },
  })

  await assert.rejects(
    () =>
      receiveWebsitePrototypeDecision(makePayload(), WEBHOOK_EVENT_ID, client as never),
    (err: unknown) => {
      const e = err as { code: string; status: number }
      assert.equal(e.code, 'PROTOTYPE_DECISION_LEAD_DELETED')
      assert.equal(e.status, 410)
      return true
    },
  )
})

test('prototype-decision: existing terminal decision returns 409 PROTOTYPE_DECISION_ALREADY_DECIDED', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: workspaceRow(), error: null }],
      leads: [{ data: { id: LEAD_ID }, error: null }],
      prototype_decisions: [
        { data: { id: 'prior-decision-id', decision: 'rejected' }, error: null },
      ],
    },
  })

  await assert.rejects(
    () =>
      receiveWebsitePrototypeDecision(makePayload(), WEBHOOK_EVENT_ID, client as never),
    (err: unknown) => {
      const e = err as { code: string; status: number }
      assert.equal(e.code, 'PROTOTYPE_DECISION_ALREADY_DECIDED')
      assert.equal(e.status, 409)
      return true
    },
  )
})

test('prototype-decision: invalid decision enum is rejected by Zod schema (400)', () => {
  const result = websitePrototypeDecisionPayloadSchema.safeParse({
    external_source: 'noon_website',
    token: SHARE_TOKEN,
    prototype_workspace_id: WORKSPACE_ID,
    decision: 'maybe', // invalid enum
  })

  assert.equal(result.success, false)
  // Belt-and-suspenders against PROTOTYPE_DECISION_INVALID_DECISION drift.
})

test('prototype-decision: DB insert failure surfaces 500 PROTOTYPE_DECISION_PERSIST_FAILED', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: workspaceRow(), error: null }],
      leads: [{ data: { id: LEAD_ID }, error: null }],
      prototype_decisions: [{ data: null, error: null }],
    },
    insertByTable: {
      prototype_decisions: [
        { data: null, error: { code: 'XX000', message: 'simulated DB failure' } },
      ],
    },
  })

  await assert.rejects(
    () =>
      receiveWebsitePrototypeDecision(makePayload(), WEBHOOK_EVENT_ID, client as never),
    (err: unknown) => {
      const e = err as { code: string; status: number }
      assert.equal(e.code, 'PROTOTYPE_DECISION_PERSIST_FAILED')
      assert.equal(e.status, 500)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// AC-5 — replay-path helper (ADR-025 D1 / A1)
// ---------------------------------------------------------------------------

test('composePrototypeDecisionReplayResponseFromLedger: FK-join produces correct wire shape with draftPropuestaQueued=false', async () => {
  // Minimal in-line mock for the replay-path helper only.
  const replayClient = {
    from(table: string) {
      assert.equal(table, 'prototype_decisions', 'replay helper queries prototype_decisions')
      const filters: Record<string, unknown> = {}
      const chain = {
        select(_cols: string) {
          return chain
        },
        eq(col: string, val: unknown) {
          filters[col] = val
          return chain
        },
        async maybeSingle() {
          assert.equal(filters.webhook_event_id, WEBHOOK_EVENT_ID, 'joins on webhook_event_id')
          return {
            data: {
              id: DECISION_ID,
              prototype_workspace_id: WORKSPACE_ID,
              lead_id: LEAD_ID,
              decision: 'accepted',
              decided_at: DECIDED_AT,
            },
            error: null,
          }
        },
      }
      return chain
    },
  }

  const ledger: WebsiteWebhookEventRecord = {
    shouldProcess: false,
    eventId: WEBHOOK_EVENT_ID,
    endpoint: 'prototype-decision',
    status: 'processed',
    attemptCount: 2,
    externalSessionId: null,
    externalProposalId: null,
    externalPaymentId: null,
    linkId: null, // null by design per cross-repo §5.7 / ADR-025 D1
  }

  const replay = await composePrototypeDecisionReplayResponseFromLedger(
    replayClient as never,
    ledger,
  )

  assert.notEqual(replay, null)
  assert.equal(replay!.idempotent, true)
  assert.equal(replay!.decisionId, DECISION_ID)
  assert.equal(replay!.prototypeWorkspaceId, WORKSPACE_ID)
  assert.equal(replay!.leadId, LEAD_ID)
  assert.equal(replay!.decision, 'accepted')
  assert.equal(replay!.decidedAt, DECIDED_AT)
  // Critical invariant per ADR-025 D1: replay NEVER says draftPropuestaQueued=true.
  assert.equal(replay!.draftPropuestaQueued, false)
})

test('composePrototypeDecisionReplayResponseFromLedger: returns null for non-matching endpoint discriminator', async () => {
  const noQueryClient = {
    from() {
      assert.fail('helper must short-circuit before any DB query when endpoint mismatches')
    },
  }
  const ledger: WebsiteWebhookEventRecord = {
    shouldProcess: false,
    eventId: WEBHOOK_EVENT_ID,
    endpoint: 'inbound-proposal', // wrong endpoint
    status: 'processed',
    attemptCount: 1,
    externalSessionId: null,
    externalProposalId: null,
    externalPaymentId: null,
    linkId: null,
  }
  const replay = await composePrototypeDecisionReplayResponseFromLedger(
    noQueryClient as never,
    ledger,
  )
  assert.equal(replay, null)
})

test('composePrototypeDecisionReplayResponseFromLedger: returns null when FK-join misses (fall-through to re-run)', async () => {
  const emptyClient = {
    from() {
      const chain = {
        select(_c: string) {
          return chain
        },
        eq() {
          return chain
        },
        async maybeSingle() {
          return { data: null, error: null }
        },
      }
      return chain
    },
  }
  const ledger: WebsiteWebhookEventRecord = {
    shouldProcess: false,
    eventId: WEBHOOK_EVENT_ID,
    endpoint: 'prototype-decision',
    status: 'processed',
    attemptCount: 1,
    externalSessionId: null,
    externalProposalId: null,
    externalPaymentId: null,
    linkId: null,
  }
  const replay = await composePrototypeDecisionReplayResponseFromLedger(
    emptyClient as never,
    ledger,
  )
  assert.equal(replay, null, 'null → caller falls back to "re-run business logic" per ADR-016 D6')
})

// ---------------------------------------------------------------------------
// AC-8 — Maxwell draft placeholder amount (unit-scope; ADR-013 invariant)
// ---------------------------------------------------------------------------

test('Maxwell draft helper persists amount = activationBase (no seller_fee yet)', async () => {
  const { createPrototypeDecisionDraft } = await import(
    '@/lib/server/maxwell/prototype-decision-draft'
  )
  const { computePricing } = await import('@/lib/maxwell/pricing')

  // Force the heuristic path by ensuring OPENAI_API_KEY is unset for this
  // test scope (the helper's `isMaxwellAiConfigured()` then returns false).
  const previousOpenAi = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    let capturedInsert: Record<string, unknown> | null = null
    const draftClient = {
      from(table: string) {
        if (table === 'leads') {
          const chain = {
            select(_c: string) {
              return chain
            },
            eq() {
              return chain
            },
            async single() {
              return {
                data: {
                  id: LEAD_ID,
                  name: 'Test Lead',
                  company: 'Acme',
                  notes: 'Necesitan dashboard interno + integraciones',
                  source: 'maxwell',
                  tags: ['outbound'],
                  maxwell_snapshot: {},
                },
                error: null,
              }
            },
          }
          return chain
        }
        if (table === 'lead_proposals') {
          const insertChain = {
            insert(value: Record<string, unknown>) {
              capturedInsert = value
              return insertChain
            },
            select(_c: string) {
              return insertChain
            },
            async single() {
              return { data: { id: 'proposal-id-stub' }, error: null }
            },
          }
          return insertChain
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    const result = await createPrototypeDecisionDraft({
      client: draftClient as never,
      leadId: LEAD_ID,
      sellerProfileId: SELLER_ID,
      prototypeWorkspaceId: WORKSPACE_ID,
      decisionId: DECISION_ID,
    })

    // Heuristic defaults: projectType=webapp, complexity=medium.
    const expectedBase = computePricing('webapp', 'medium', 'outbound', 0).activationBase
    assert.equal(result.amount, expectedBase, 'amount must equal activationBase, NOT activationFinal')
    assert.equal(result.projectType, 'webapp')
    assert.equal(result.complexity, 'medium')
    assert.equal(result.proposalId, 'proposal-id-stub')

    assert.ok(capturedInsert, 'insert must occur')
    const insertRow = capturedInsert as Record<string, unknown>
    assert.equal(insertRow.amount, expectedBase)
    assert.equal(insertRow.lead_id, LEAD_ID)
    assert.equal(insertRow.created_by, SELLER_ID)
    assert.equal(insertRow.project_type, 'webapp')
    assert.equal(insertRow.complexity, 'medium')
    assert.equal(insertRow.status, 'draft')
    assert.equal(insertRow.review_status, 'pending_review')
  } finally {
    if (previousOpenAi !== undefined) {
      process.env.OPENAI_API_KEY = previousOpenAi
    }
  }
})

// ---------------------------------------------------------------------------
// AC-9 — Maxwell draft failure path (router §3.2 minimum: side-effect failure)
//
// Forces `createPrototypeDecisionDraft` to throw inside the fire-and-forget
// scheduler and asserts the escalation contract:
//   - the decision row stays (handler returned before scheduler runs);
//   - the seller notification fan-out fires with the "create manually" copy
//     (draftStatus='failed' branch of `buildSellerNotificationCopy`);
//   - no `lead_proposals` insert happens (draft helper failed before that step).
//
// Failure is induced by making the `leads` lookup error (the first DB call
// inside `createPrototypeDecisionDraft` → `fetchLeadContext`). The scheduler's
// inner `try { ... } catch (draftError) { ... }` then takes the escalation path.
// ---------------------------------------------------------------------------

test('AC-9: Maxwell draft failure path inserts escalation notification with "create manually" copy', async () => {
  const { scheduleAcceptedPrototypeDecisionSideEffects } = await import(
    '@/lib/server/website-integration'
  )

  // Force the heuristic path so the failure is deterministic regardless of
  // ambient OPENAI_API_KEY. (We're forcing failure at the leads lookup which
  // runs before the LLM branch anyway, but unsetting keeps the test isolated
  // from network behavior.)
  const previousOpenAi = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  const notificationInserts: Array<Record<string, unknown>> = []
  const proposalInserts: Array<Record<string, unknown>> = []

  const failingClient = {
    from(table: string) {
      if (table === 'leads') {
        // fetchLeadContext path: select → eq → single returns an error.
        // This causes createPrototypeDecisionDraft to throw before any
        // lead_proposals insert is attempted.
        const chain = {
          select(_c: string) {
            return chain
          },
          eq(_c: string, _v: unknown) {
            return chain
          },
          async single() {
            return {
              data: null,
              error: { code: 'XX000', message: 'simulated leads lookup failure' },
            }
          },
        }
        return chain
      }
      if (table === 'lead_proposals') {
        // Should never be reached on the failure path; capture for assertion.
        const chain = {
          insert(value: Record<string, unknown>) {
            proposalInserts.push(value)
            return chain
          },
          select(_c: string) {
            return chain
          },
          async single() {
            return { data: { id: 'should-not-happen' }, error: null }
          },
        }
        return chain
      }
      if (table === 'user_notifications') {
        // The escalation path writes here with draftStatus='failed' copy.
        return {
          insert(value: Record<string, unknown>) {
            notificationInserts.push(value)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }

  try {
    scheduleAcceptedPrototypeDecisionSideEffects({
      adminClient: failingClient as never,
      decisionId: DECISION_ID,
      prototypeWorkspaceId: WORKSPACE_ID,
      leadId: LEAD_ID,
      sellerProfileId: SELLER_ID,
    })

    // Flush the detached promise chain. The scheduler wraps work in
    // `void Promise.resolve().then(async () => { ... }).catch(...)` so a
    // single microtask flush + an extra macrotask tick is enough to drive
    // it to completion across all observed runtimes.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    // Invariant 1: NO lead_proposals insert (draft helper threw before insert).
    assert.equal(
      proposalInserts.length,
      0,
      'lead_proposals must NOT be inserted on the draft-failure path',
    )

    // Invariant 2: exactly one escalation notification with the "create manually"
    // copy was sent to the seller.
    assert.equal(
      notificationInserts.length,
      1,
      'escalation notification must be inserted exactly once on draft failure',
    )
    const notif = notificationInserts[0]
    assert.equal(notif.profile_id, SELLER_ID, 'escalation goes to the seller')
    assert.equal(notif.source_kind, 'prototype_decision_received')
    assert.equal(notif.source_event_id, DECISION_ID)
    assert.equal(notif.domain, 'leads')
    assert.equal(notif.title, 'Cliente aceptó el prototipo (acción manual requerida)')
    assert.ok(
      typeof notif.body === 'string' && (notif.body as string).includes('manualmente'),
      'escalation body must instruct the seller to create the proposal manually',
    )
    assert.ok(
      typeof notif.body === 'string' && (notif.body as string).includes('falló'),
      'escalation body must surface that draft generation failed',
    )
    assert.equal(
      notif.href,
      `/dashboard/leads/${LEAD_ID}`,
      'escalation notification deep-links to the lead detail page',
    )
  } finally {
    if (previousOpenAi !== undefined) {
      process.env.OPENAI_API_KEY = previousOpenAi
    }
  }
})
