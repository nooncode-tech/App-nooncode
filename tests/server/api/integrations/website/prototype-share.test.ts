import assert from 'node:assert/strict'
import test from 'node:test'

import {
  receiveWebsitePrototypeShare,
  websitePrototypeSharePayloadSchema,
} from '@/lib/server/website-integration'

// Integration coverage for the synchronous business handler of the
// `prototype-share` inbound webhook (ADR-028 + cross-repo-webhook-v1.md §5A).
//
// Covers:
//   - Happy path: new workspace creation with fresh share_token
//   - Idempotent replay: existing (session, chat) returns the existing token
//   - Terminal-state errors: accepted decision OR status='archived' -> 409
//   - Lead resolution: existing website_inbound_links row OR fresh prospect
//   - Supersede semantics: prior workspaces under lead are invalidated
//   - Schema validation: deployed_url+generated_html both null, non-https URL
//
// Out of scope here:
//   - HMAC signature verification (covered by tests/server/website-webhook-auth.test.ts)
//   - Route-level rate-limit, ledger record/replay (covered by webhook-events tests
//     and the unit-test coverage of composePrototypeShareReplayResponseFromLedger
//     which exercises the FK-join path)
//   - The actual UUID format of share_token (randomUUID() is stdlib-validated)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = 'studio-sess-7777-abcd'
const V0_CHAT_ID = 'v0-chat-9999-efgh'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const PRIOR_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const LEAD_ID = '33333333-3333-4333-8333-333333333333'
const EXISTING_LEAD_ID = '44444444-4444-4444-8444-444444444444'
const LINK_ID = '55555555-5555-4555-8555-555555555555'
const ACTOR_ID = '66666666-6666-4666-8666-666666666666'
const WEBHOOK_EVENT_ID = '77777777-7777-4777-8777-777777777777'
const EXISTING_TOKEN = 'existing-share-token-v1-abc'
const CREATED_AT = '2026-05-27T10:00:00.000Z'
const UPDATED_AT = '2026-05-27T10:00:01.000Z'
const DEPLOYED_URL = 'https://prototipo-test.vercel.app/'
const GENERATED_AT = '2026-05-27T09:55:00.000Z'

function makePayload(overrides: Record<string, unknown> = {}) {
  return websitePrototypeSharePayloadSchema.parse({
    external_source: 'noon_website',
    external_session_id: SESSION_ID,
    lead: {
      business_name: 'Cafe Mendoza',
      project_type_label: 'Landing Page',
      customer: {
        name: 'Juan Perez',
        email: 'juan@cafemendoza.com',
        phone: '+5491155667788',
        whatsapp: null,
        company: 'Cafe Mendoza SRL',
      },
    },
    prototype: {
      v0_chat_id: V0_CHAT_ID,
      version_number: 1,
      deployed_url: DEPLOYED_URL,
      generated_html: null,
      generated_at: GENERATED_AT,
    },
    metadata: {},
    ...overrides,
  })
}

interface RecordedOp {
  table: string
  op: string
  args: unknown[]
}

type Script = Record<string, Array<{ data: unknown; error: unknown }>>

/**
 * Lightweight Supabase mock. Supports the chain methods the handler uses:
 * `.select`, `.insert`, `.update`, `.eq`, `.is`, `.in`, `.order`, `.limit`,
 * `.maybeSingle`, `.single`, and awaiting a chain post-`.select()` after
 * `.update()` (returns rows directly).
 *
 * Scripts are keyed by table and termination shape:
 *   maybeSingleByTable: queue of responses to `.maybeSingle()` calls
 *   singleByTable: queue of responses to `.single()` calls (without prior insert)
 *   insertByTable: queue of responses to `.insert(...).select(...).single()`
 *   updateByTable: queue of responses to `.update(...)...await` (returns array data)
 */
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

  function pop(q: Script, table: string, ctx: string) {
    const arr = q[table]
    if (!arr || arr.length === 0) {
      throw new Error(`Mock: no scripted ${ctx} response for table "${table}"`)
    }
    return arr.shift()!
  }

  function chainFor(table: string) {
    let lastInsertResult: { data: unknown; error: unknown } | null = null
    let pendingUpdateResult: { data: unknown; error: unknown } | null = null

    const chain: Record<string, unknown> = {}

    chain.select = (...args: unknown[]) => {
      ops.push({ table, op: 'select', args })
      // If we just did an .update(), .select() terminates the chain with the
      // queued update result (e.g. supersedePriorWorkspacesUnderLead path).
      if (pendingUpdateResult) {
        const r = pendingUpdateResult
        pendingUpdateResult = null
        return Promise.resolve(r)
      }
      return chain
    }
    chain.insert = (...args: unknown[]) => {
      ops.push({ table, op: 'insert', args })
      lastInsertResult = queues.insert[table]?.shift() ?? { data: null, error: null }
      return chain
    }
    chain.update = (...args: unknown[]) => {
      ops.push({ table, op: 'update', args })
      pendingUpdateResult = queues.update[table]?.shift() ?? { data: null, error: null }
      return chain
    }
    chain.eq = (...args: unknown[]) => {
      ops.push({ table, op: 'eq', args })
      return chain
    }
    chain.is = (...args: unknown[]) => {
      ops.push({ table, op: 'is', args })
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
    _ops: ops,
  }
}

function existingWorkspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKSPACE_ID,
    lead_id: EXISTING_LEAD_ID,
    status: 'ready',
    share_token: EXISTING_TOKEN,
    share_token_superseded_at: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  }
}

function actorRow() {
  return { id: ACTOR_ID, role: 'admin' as const }
}

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    lead_id: EXISTING_LEAD_ID,
    external_source: 'noon_website',
    external_session_id: SESSION_ID,
    external_proposal_id: null,
    external_payment_id: null,
    current_status: 'proposal_pending_review',
    proposal_id: null,
    inbound_payload: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Happy path — new workspace creation
// ---------------------------------------------------------------------------

test('prototype-share: happy path creates fresh lead + workspace, returns 201-equivalent shape', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      // Step 1: findPrototypeWorkspaceBySessionChat -> none
      prototype_workspaces: [{ data: null, error: null }],
      // Step 2a: findLinkByExternalRef -> none
      website_inbound_links: [{ data: null, error: null }],
      // Step 2b: resolveIntegrationActorId
      user_profiles: [{ data: actorRow(), error: null }],
    },
    insertByTable: {
      // Fresh lead
      leads: [{ data: { id: LEAD_ID }, error: null }],
      // New workspace
      prototype_workspaces: [
        {
          data: {
            id: WORKSPACE_ID,
            share_token: 'fresh-token-uuid',
            created_at: CREATED_AT,
          },
          error: null,
        },
      ],
    },
    updateByTable: {
      // Step 3: supersedePriorWorkspacesUnderLead -> none to supersede
      prototype_workspaces: [{ data: [], error: null }],
    },
  })

  const result = await receiveWebsitePrototypeShare(
    makePayload(),
    WEBHOOK_EVENT_ID,
    client as never,
  )

  assert.equal(result.idempotent, false)
  assert.equal(result.prototypeWorkspaceId, WORKSPACE_ID)
  assert.equal(result.leadId, LEAD_ID)
  assert.equal(result.shareToken, 'fresh-token-uuid')
  assert.equal(result.versionNumber, 1)
  assert.equal(result.issuedAt, CREATED_AT)
  assert.deepEqual(result.supersededWorkspaceIds, [])

  // Verify lead insert carried status='prospect' (NOT 'proposal')
  const leadInsertOp = client._ops.find(
    (o) => o.table === 'leads' && o.op === 'insert',
  )
  assert.ok(leadInsertOp, 'leads insert must occur')
  const leadInserted = (leadInsertOp.args as unknown[])[0] as Record<string, unknown>
  assert.equal(leadInserted.status, 'prospect')
  assert.equal(leadInserted.source, 'website')

  // Verify workspace insert carried the dedup pair, webhook_event_id,
  // and demo_url (NOT deployed_url — that's a wire-only field name).
  const wsInsertOp = client._ops.find(
    (o) => o.table === 'prototype_workspaces' && o.op === 'insert',
  )
  assert.ok(wsInsertOp, 'prototype_workspaces insert must occur')
  const wsInserted = (wsInsertOp.args as unknown[])[0] as Record<string, unknown>
  assert.equal(wsInserted.lead_id, LEAD_ID)
  assert.equal(wsInserted.external_session_id, SESSION_ID)
  assert.equal(wsInserted.v0_chat_id, V0_CHAT_ID)
  assert.equal(wsInserted.demo_url, DEPLOYED_URL)
  assert.equal(wsInserted.webhook_event_id, WEBHOOK_EVENT_ID)
  assert.equal(wsInserted.generated_at, GENERATED_AT)
  assert.ok(
    typeof wsInserted.share_token === 'string' &&
      (wsInserted.share_token as string).length > 0,
    'share_token must be issued (non-empty string)',
  )
})

// ---------------------------------------------------------------------------
// Idempotent replay — existing (session, chat), non-terminal
// ---------------------------------------------------------------------------

test('prototype-share: existing non-terminal workspace returns idempotent: true with existing token', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      // findPrototypeWorkspaceBySessionChat -> hit
      prototype_workspaces: [{ data: existingWorkspaceRow(), error: null }],
      // existingWorkspaceIsTerminal -> no decision row
      prototype_decisions: [{ data: null, error: null }],
    },
  })

  const result = await receiveWebsitePrototypeShare(
    makePayload(),
    WEBHOOK_EVENT_ID,
    client as never,
  )

  assert.equal(result.idempotent, true)
  assert.equal(result.shareToken, EXISTING_TOKEN)
  assert.equal(result.prototypeWorkspaceId, WORKSPACE_ID)
  assert.equal(result.leadId, EXISTING_LEAD_ID)
  assert.equal(result.versionNumber, 1)
  assert.equal(result.issuedAt, UPDATED_AT)
  assert.deepEqual(result.supersededWorkspaceIds, [])

  // No insert or update should have occurred.
  const writeOps = client._ops.filter((o) => o.op === 'insert' || o.op === 'update')
  assert.equal(
    writeOps.length,
    0,
    'idempotent path performs no writes (workspace and lead untouched)',
  )
})

// ---------------------------------------------------------------------------
// Terminal — accepted decision blocks reshare
// ---------------------------------------------------------------------------

test('prototype-share: existing workspace with accepted decision returns 409 PROTOTYPE_SHARE_WORKSPACE_TERMINAL', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: existingWorkspaceRow(), error: null }],
      prototype_decisions: [
        { data: { id: 'd1', decision: 'accepted' }, error: null },
      ],
    },
  })

  await assert.rejects(
    () =>
      receiveWebsitePrototypeShare(
        makePayload(),
        WEBHOOK_EVENT_ID,
        client as never,
      ),
    (err: unknown) => {
      const e = err as { code: string; status: number }
      assert.equal(e.code, 'PROTOTYPE_SHARE_WORKSPACE_TERMINAL')
      assert.equal(e.status, 409)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Terminal — archived status blocks reshare
// ---------------------------------------------------------------------------

test('prototype-share: existing workspace with status=archived returns 409 PROTOTYPE_SHARE_WORKSPACE_TERMINAL', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [
        { data: existingWorkspaceRow({ status: 'archived' }), error: null },
      ],
      // existingWorkspaceIsTerminal short-circuits on status='archived'
      // before reaching the prototype_decisions query.
    },
  })

  await assert.rejects(
    () =>
      receiveWebsitePrototypeShare(
        makePayload(),
        WEBHOOK_EVENT_ID,
        client as never,
      ),
    (err: unknown) => {
      const e = err as { code: string; status: number }
      assert.equal(e.code, 'PROTOTYPE_SHARE_WORKSPACE_TERMINAL')
      assert.equal(e.status, 409)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Lead resolution — existing website_inbound_links row
// ---------------------------------------------------------------------------

test('prototype-share: existing inbound_link attaches workspace to existing lead (no fresh lead insert)', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: null, error: null }],
      // findLinkByExternalRef -> hit
      website_inbound_links: [{ data: linkRow(), error: null }],
      user_profiles: [{ data: actorRow(), error: null }],
    },
    insertByTable: {
      // ONLY the workspace insert — no leads insert.
      prototype_workspaces: [
        {
          data: {
            id: WORKSPACE_ID,
            share_token: 'fresh-token-uuid',
            created_at: CREATED_AT,
          },
          error: null,
        },
      ],
    },
    updateByTable: {
      prototype_workspaces: [{ data: [], error: null }],
    },
  })

  const result = await receiveWebsitePrototypeShare(
    makePayload(),
    WEBHOOK_EVENT_ID,
    client as never,
  )

  assert.equal(result.idempotent, false)
  assert.equal(result.leadId, EXISTING_LEAD_ID, 'lead reuses existing link.lead_id')

  // No lead insert should have happened.
  const leadInserts = client._ops.filter(
    (o) => o.table === 'leads' && o.op === 'insert',
  )
  assert.equal(
    leadInserts.length,
    0,
    'lead-resolution via existing link skips fresh-lead insert',
  )
})

// ---------------------------------------------------------------------------
// Supersede semantics — prior workspaces under the lead are invalidated
// ---------------------------------------------------------------------------

test('prototype-share: prior non-superseded workspaces under the lead are returned in supersededWorkspaceIds', async () => {
  const client = makeMockClient({
    maybeSingleByTable: {
      prototype_workspaces: [{ data: null, error: null }],
      website_inbound_links: [{ data: linkRow(), error: null }],
      user_profiles: [{ data: actorRow(), error: null }],
    },
    insertByTable: {
      prototype_workspaces: [
        {
          data: {
            id: WORKSPACE_ID,
            share_token: 'fresh-token-uuid',
            created_at: CREATED_AT,
          },
          error: null,
        },
      ],
    },
    updateByTable: {
      // supersedePriorWorkspacesUnderLead returns one prior workspace.
      prototype_workspaces: [
        { data: [{ id: PRIOR_WORKSPACE_ID }], error: null },
      ],
    },
  })

  const result = await receiveWebsitePrototypeShare(
    makePayload({ prototype: { v0_chat_id: 'new-chat', version_number: 2, deployed_url: DEPLOYED_URL, generated_html: null, generated_at: GENERATED_AT } }),
    WEBHOOK_EVENT_ID,
    client as never,
  )

  assert.deepEqual(result.supersededWorkspaceIds, [PRIOR_WORKSPACE_ID])

  // Verify the update ran on prototype_workspaces with the superseded_at field.
  const updateOp = client._ops.find(
    (o) => o.table === 'prototype_workspaces' && o.op === 'update',
  )
  assert.ok(updateOp, 'prototype_workspaces update must occur for supersede')
  const updatePayload = (updateOp.args as unknown[])[0] as Record<string, unknown>
  assert.ok(updatePayload.share_token_superseded_at, 'share_token_superseded_at set')
})

// ---------------------------------------------------------------------------
// Schema validation — both deployed_url and generated_html null
// ---------------------------------------------------------------------------

test('prototype-share: schema rejects payload where both deployed_url and generated_html are null', () => {
  assert.throws(
    () =>
      websitePrototypeSharePayloadSchema.parse({
        external_source: 'noon_website',
        external_session_id: SESSION_ID,
        lead: {
          business_name: 'Cafe Mendoza',
          project_type_label: 'Landing Page',
        },
        prototype: {
          v0_chat_id: V0_CHAT_ID,
          version_number: 1,
          deployed_url: null,
          generated_html: null,
          generated_at: GENERATED_AT,
        },
        metadata: {},
      }),
    /deployed_url.*generated_html/i,
  )
})

// ---------------------------------------------------------------------------
// Schema validation — deployed_url is not https
// ---------------------------------------------------------------------------

test('prototype-share: schema rejects http:// deployed_url (must be https)', () => {
  assert.throws(
    () =>
      websitePrototypeSharePayloadSchema.parse({
        external_source: 'noon_website',
        external_session_id: SESSION_ID,
        lead: {
          business_name: 'Cafe Mendoza',
          project_type_label: 'Landing Page',
        },
        prototype: {
          v0_chat_id: V0_CHAT_ID,
          version_number: 1,
          deployed_url: 'http://insecure.example.com',
          generated_html: null,
          generated_at: GENERATED_AT,
        },
        metadata: {},
      }),
    /https/i,
  )
})

// ---------------------------------------------------------------------------
// Schema validation — version_number < 1
// ---------------------------------------------------------------------------

test('prototype-share: schema rejects version_number < 1', () => {
  assert.throws(
    () =>
      websitePrototypeSharePayloadSchema.parse({
        external_source: 'noon_website',
        external_session_id: SESSION_ID,
        lead: {
          business_name: 'Cafe Mendoza',
          project_type_label: 'Landing Page',
        },
        prototype: {
          v0_chat_id: V0_CHAT_ID,
          version_number: 0,
          deployed_url: DEPLOYED_URL,
          generated_html: null,
          generated_at: GENERATED_AT,
        },
        metadata: {},
      }),
    /version_number/i,
  )
})

// ---------------------------------------------------------------------------
// Schema — empty business_name fails
// ---------------------------------------------------------------------------

test('prototype-share: schema rejects empty lead.business_name', () => {
  assert.throws(
    () =>
      websitePrototypeSharePayloadSchema.parse({
        external_source: 'noon_website',
        external_session_id: SESSION_ID,
        lead: {
          business_name: '   ',
          project_type_label: 'Landing Page',
        },
        prototype: {
          v0_chat_id: V0_CHAT_ID,
          version_number: 1,
          deployed_url: DEPLOYED_URL,
          generated_html: null,
          generated_at: GENERATED_AT,
        },
        metadata: {},
      }),
    /business_name/i,
  )
})

// ---------------------------------------------------------------------------
// Schema — generated_html alone (no deployed_url) is accepted
// ---------------------------------------------------------------------------

test('prototype-share: schema accepts generated_html fallback when deployed_url is null', () => {
  const parsed = websitePrototypeSharePayloadSchema.parse({
    external_source: 'noon_website',
    external_session_id: SESSION_ID,
    lead: {
      business_name: 'Cafe Mendoza',
      project_type_label: 'Landing Page',
    },
    prototype: {
      v0_chat_id: V0_CHAT_ID,
      version_number: 1,
      deployed_url: null,
      generated_html: '<!DOCTYPE html><html><body>Hi</body></html>',
      generated_at: GENERATED_AT,
    },
    metadata: {},
  })
  assert.equal(parsed.prototype.deployed_url, null)
  assert.ok(parsed.prototype.generated_html)
})

// ---------------------------------------------------------------------------
// Schema — optional customer email is lowercased + null on empty
// ---------------------------------------------------------------------------

test('prototype-share: schema lowercases customer.email and converts empty to null', () => {
  const parsed = websitePrototypeSharePayloadSchema.parse({
    external_source: 'noon_website',
    external_session_id: SESSION_ID,
    lead: {
      business_name: 'Cafe Mendoza',
      project_type_label: 'Landing Page',
      customer: {
        name: 'Juan',
        email: 'Juan@CafeMendoza.COM',
        phone: null,
        whatsapp: null,
        company: null,
      },
    },
    prototype: {
      v0_chat_id: V0_CHAT_ID,
      version_number: 1,
      deployed_url: DEPLOYED_URL,
      generated_html: null,
      generated_at: GENERATED_AT,
    },
    metadata: {},
  })
  assert.equal(parsed.lead.customer.email, 'juan@cafemendoza.com')

  const parsedEmpty = websitePrototypeSharePayloadSchema.parse({
    external_source: 'noon_website',
    external_session_id: SESSION_ID,
    lead: {
      business_name: 'Cafe Mendoza',
      project_type_label: 'Landing Page',
      customer: {
        name: 'Juan',
        email: '   ',
        phone: null,
        whatsapp: null,
        company: null,
      },
    },
    prototype: {
      v0_chat_id: V0_CHAT_ID,
      version_number: 1,
      deployed_url: DEPLOYED_URL,
      generated_html: null,
      generated_at: GENERATED_AT,
    },
    metadata: {},
  })
  assert.equal(parsedEmpty.lead.customer.email, null)
})
