import assert from 'node:assert/strict'
import test from 'node:test'

import { serveWebsitePrototypeSignedRead } from '@/lib/server/website-integration'

// Integration coverage for the synchronous business handler of the
// `prototype-signed-read` GET endpoint (G22 / ADR-024).
//
// Covers:
//   - AC-1 happy 200 (pending decision)
//   - AC-2 happy 200 (accepted decision)
//   - AC-3 happy 200 (rejected decision)
//   - AC-4 404 token not found
//   - AC-5 410 token superseded
//   - AC-6 410 lead deleted
//   - AC-8 sanitization allowlist (no forbidden field appears in response)
//   - AC-9 cache-header exactness (helper returns the byte-exact value)
//   - AC-11 GET idempotency (two helper calls produce deep-equal body
//                            modulo `serverTime`)
//
// Out of scope here (per spec §"Tests"):
//   - AC-7 401 HMAC mismatch — covered by tests/server/website-webhook-auth.test.ts
//     (the `WebsiteWebhookError` path lives at the route layer; the helper
//     never sees an unsigned request).
//   - AC-10 RLS defensive check — covered by manual SQL recorded in the PR
//     description; this repo has no anon-role SELECT harness in unit tests.
//   - AC-12 rate-limit 429 — covered by tests/server/api/rate-limit.test.ts
//     (the helper does not consume the limiter; `assertRateLimit` is the route
//     layer's responsibility).

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOKEN = 'share-token-test-01234567abcd'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const LEAD_ID = '22222222-2222-4222-8222-222222222222'
const WORKSPACE_CREATED_AT = '2026-05-26T10:00:00.000Z'
const DECIDED_AT = '2026-05-26T11:15:30.000Z'

interface Result {
  data: unknown
  error: unknown
}

// Lookup fixture: shape that matches what PostgREST returns from
// `from('prototype_workspaces').select(...joins...).eq('share_token', x).maybeSingle()`
// before `getPrototypeWorkspaceByShareToken` normalizes embedded relations.
function workspaceLookupFixture(opts: {
  superseded?: boolean
  lead?: 'present' | 'deleted'
  decision?: 'accepted' | 'rejected' | null
  rejectionNotes?: string | null
  withSensitiveFields?: boolean // AC-8 fixture decoration
} = {}): Result {
  if (opts.lead === 'deleted') {
    return {
      data: {
        id: WORKSPACE_ID,
        lead_id: LEAD_ID,
        created_at: WORKSPACE_CREATED_AT,
        demo_url: 'https://v0.dev/demo/x',
        generated_html: null,
        share_token_superseded_at: opts.superseded ? '2026-05-26T09:00:00.000Z' : null,
        lead: null,
        decisions: [],
      },
      error: null,
    }
  }

  const leadRow: Record<string, unknown> = {
    id: LEAD_ID,
    name: 'Acme Contact',
    company: 'Acme Industries',
    maxwell_snapshot: { project_type: 'landing' },
  }

  if (opts.withSensitiveFields) {
    // Decorate with operator-internal fields that MUST NOT appear in the
    // egress response body. The allowlist construction in
    // `serveWebsitePrototypeSignedRead` MUST drop these.
    leadRow.notes = 'INTERNAL CRM NOTE — must not leak'
    leadRow.score = 99
    leadRow.lead_origin = 'maxwell_search'
    leadRow.assigned_to = 'seller-uuid-internal'
    leadRow.created_by = 'admin-uuid-internal'
    leadRow.next_follow_up_at = '2026-06-01T00:00:00.000Z'
  }

  const decisions: Array<Record<string, unknown>> = []
  if (opts.decision !== null && opts.decision !== undefined) {
    const decisionRow: Record<string, unknown> = {
      decision: opts.decision,
      notes: opts.decision === 'rejected' ? (opts.rejectionNotes ?? 'No me convence el diseño.') : null,
      decided_at: DECIDED_AT,
    }
    if (opts.withSensitiveFields) {
      decisionRow.client_user_agent = 'INTERNAL-UA-must-not-leak'
      decisionRow.webhook_event_id = 'event-uuid-internal'
    }
    decisions.push(decisionRow)
  }

  const workspaceData: Record<string, unknown> = {
    id: WORKSPACE_ID,
    lead_id: LEAD_ID,
    created_at: WORKSPACE_CREATED_AT,
    demo_url: 'https://v0.dev/demo/x',
    generated_content: null,
    share_token_superseded_at: opts.superseded ? '2026-05-26T09:00:00.000Z' : null,
    lead: leadRow,
    decisions,
  }
  if (opts.withSensitiveFields) {
    workspaceData.created_by = 'admin-uuid-internal'
    workspaceData.updated_at = '2026-05-26T10:30:00.000Z'
    workspaceData.share_token = 'RAW-TOKEN-INTERNAL-must-not-leak'
  }

  return { data: workspaceData, error: null }
}

// Sibling list for version count: bounded by Gate B (≤3 per lead). For V1
// scenarios we return a single-element array.
function versionListFixture(workspaceCount = 1): Result {
  const rows: Array<{ id: string; created_at: string }> = []
  for (let i = 0; i < workspaceCount; i += 1) {
    rows.push({
      id: i === workspaceCount - 1 ? WORKSPACE_ID : `sibling-${i}`,
      created_at: WORKSPACE_CREATED_AT,
    })
  }
  return { data: rows, error: null }
}

// ---------------------------------------------------------------------------
// Mock client. Two query shapes supported:
//   1. `.from(t).select(...).eq('share_token', x).maybeSingle()` → workspace lookup
//   2. `.from(t).select(...).eq('lead_id', x).order(...).order(...)` (awaited as
//      thenable) → version-count list
// ---------------------------------------------------------------------------

function makeMockClient(opts: {
  workspaceLookup?: Result
  versionList?: Result
}) {
  const lookup = opts.workspaceLookup ?? { data: null, error: null }
  const list = opts.versionList ?? { data: [], error: null }

  function chainFor() {
    // Loose typing — the Supabase JS chain surface is intentionally wide; the
    // mock only implements the slice the helper actually exercises.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {}

    chain.select = () => chain
    chain.eq = () => chain
    chain.order = () => chain

    chain.maybeSingle = () => Promise.resolve(lookup)

    // Make the chain awaitable for the version-count terminal pattern
    // `select().eq().order().order()`. Awaits resolve with the list shape.
    chain.then = (
      onfulfilled?: ((value: Result) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(list).then(onfulfilled, onrejected)

    return chain
  }

  return {
    from: () => chainFor(),
  } as never
}

// ---------------------------------------------------------------------------
// AC-1 — Happy 200, pending decision
// ---------------------------------------------------------------------------

test('prototype-signed-read: happy 200 (pending decision)', async () => {
  const client = makeMockClient({
    workspaceLookup: workspaceLookupFixture({ decision: null }),
    versionList: versionListFixture(1),
  })

  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)

  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return

  assert.equal(result.status, 200)
  assert.equal(result.cacheControl, 'private, max-age=30, stale-while-revalidate=60')
  assert.equal(result.body.data.workspace.id, WORKSPACE_ID)
  assert.equal(result.body.data.workspace.version, 1)
  assert.equal(result.body.data.workspace.generatedAt, WORKSPACE_CREATED_AT)
  assert.equal(result.body.data.leadContext.businessName, 'Acme Industries')
  assert.equal(result.body.data.leadContext.projectTypeLabel, 'Landing Page')
  assert.equal(result.body.data.prototype.deployedUrl, 'https://v0.dev/demo/x')
  assert.equal(result.body.data.prototype.generatedHtml, null)
  assert.equal(result.body.data.decision.status, 'pending')
  assert.equal(result.body.data.decision.notes, null)
  assert.equal(result.body.data.decision.decidedAt, null)
  assert.equal(result.body.data.lifecycle.tokenSuperseded, false)
  assert.equal(result.body.data.lifecycle.iterationNumber, 1)
  assert.ok(typeof result.body.data.serverTime === 'string')
  assert.equal(result.log.level, 'info')
})

// ---------------------------------------------------------------------------
// AC-2 — Happy 200, accepted decision
// ---------------------------------------------------------------------------

test('prototype-signed-read: happy 200 (accepted decision)', async () => {
  const client = makeMockClient({
    workspaceLookup: workspaceLookupFixture({ decision: 'accepted' }),
    versionList: versionListFixture(1),
  })

  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)

  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return

  assert.equal(result.status, 200)
  assert.equal(result.body.data.decision.status, 'accepted')
  // Sanitizer rule per ADR-024 D3: `decision.notes` is null for 'accepted'
  // even if a notes column had a value.
  assert.equal(result.body.data.decision.notes, null)
  assert.equal(result.body.data.decision.decidedAt, DECIDED_AT)
})

// ---------------------------------------------------------------------------
// AC-3 — Happy 200, rejected decision (notes echoed)
// ---------------------------------------------------------------------------

test('prototype-signed-read: happy 200 (rejected decision; notes echoed verbatim)', async () => {
  const client = makeMockClient({
    workspaceLookup: workspaceLookupFixture({
      decision: 'rejected',
      rejectionNotes: 'No coincide con la vision del cliente.',
    }),
    versionList: versionListFixture(1),
  })

  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)

  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return

  assert.equal(result.status, 200)
  assert.equal(result.body.data.decision.status, 'rejected')
  assert.equal(result.body.data.decision.notes, 'No coincide con la vision del cliente.')
  assert.equal(result.body.data.decision.decidedAt, DECIDED_AT)
})

// ---------------------------------------------------------------------------
// AC-4 — 404 token not found
// ---------------------------------------------------------------------------

test('prototype-signed-read: 404 token not found', async () => {
  const client = makeMockClient({
    workspaceLookup: { data: null, error: null },
  })

  const result = await serveWebsitePrototypeSignedRead('does-not-exist-token', client)

  assert.equal(result.kind, 'error')
  if (result.kind !== 'error') return

  assert.equal(result.status, 404)
  assert.equal(result.cacheControl, 'no-store')
  assert.equal(result.body.code, 'PROTOTYPE_READ_TOKEN_NOT_FOUND')
})

// ---------------------------------------------------------------------------
// AC-5 — 410 token superseded
// ---------------------------------------------------------------------------

test('prototype-signed-read: 410 token superseded', async () => {
  const client = makeMockClient({
    workspaceLookup: workspaceLookupFixture({ superseded: true, decision: null }),
  })

  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)

  assert.equal(result.kind, 'error')
  if (result.kind !== 'error') return

  assert.equal(result.status, 410)
  assert.equal(result.cacheControl, 'no-store')
  assert.equal(result.body.code, 'PROTOTYPE_READ_TOKEN_SUPERSEDED')
})

// ---------------------------------------------------------------------------
// AC-6 — 410 lead deleted (lead-deleted beats token-superseded per ADR-024 D2)
// ---------------------------------------------------------------------------

test('prototype-signed-read: 410 lead deleted (precedes superseded check)', async () => {
  const client = makeMockClient({
    // Lead deleted AND superseded — handler must surface LEAD_DELETED, not SUPERSEDED.
    workspaceLookup: workspaceLookupFixture({ lead: 'deleted', superseded: true }),
  })

  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)

  assert.equal(result.kind, 'error')
  if (result.kind !== 'error') return

  assert.equal(result.status, 410)
  assert.equal(result.cacheControl, 'no-store')
  assert.equal(result.body.code, 'PROTOTYPE_READ_LEAD_DELETED')
})

// ---------------------------------------------------------------------------
// AC-8 — Sanitization allowlist: forbidden fields absent from response body
// ---------------------------------------------------------------------------

test('prototype-signed-read: allowlist strips operator-internal fields', async () => {
  const client = makeMockClient({
    workspaceLookup: workspaceLookupFixture({
      decision: 'rejected',
      rejectionNotes: 'cliente quería otra cosa',
      withSensitiveFields: true,
    }),
    versionList: versionListFixture(1),
  })

  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return

  const serialized = JSON.stringify(result.body)

  // Forbidden field names that MUST NOT appear anywhere in the serialized body.
  // (Names alone are checked — a positive allowlist is the structural defense.)
  const forbiddenFieldNames = [
    'created_by',
    'updated_at',
    'score',
    'lead_origin',
    'assigned_to',
    'next_follow_up_at',
    'client_user_agent',
    'webhook_event_id',
    'share_token',
    'share_token_superseded_at',
    'maxwell_snapshot',
    'project_type', // raw key from maxwell_snapshot — only `projectTypeLabel` is exposed
  ]

  for (const forbidden of forbiddenFieldNames) {
    assert.ok(
      !serialized.includes(`"${forbidden}"`),
      `Response body MUST NOT contain forbidden field name "${forbidden}". Got: ${serialized}`,
    )
  }

  // Defensive: the internal-marker strings MUST NOT leak either.
  assert.ok(
    !serialized.includes('INTERNAL CRM NOTE'),
    'Internal lead notes MUST NOT leak to response body',
  )
  assert.ok(
    !serialized.includes('INTERNAL-UA-must-not-leak'),
    'Internal client_user_agent MUST NOT leak to response body',
  )
  assert.ok(
    !serialized.includes('RAW-TOKEN-INTERNAL-must-not-leak'),
    'Raw share_token MUST NEVER appear in response body (ADR-024 D3 + D4)',
  )
})

// ---------------------------------------------------------------------------
// AC-9 — Cache header exactness (byte-for-byte per ADR-024 D7)
// ---------------------------------------------------------------------------

test('prototype-signed-read: cache headers are byte-exact', async () => {
  const okClient = makeMockClient({
    workspaceLookup: workspaceLookupFixture({ decision: null }),
    versionList: versionListFixture(1),
  })
  const okResult = await serveWebsitePrototypeSignedRead(TOKEN, okClient)
  assert.equal(okResult.cacheControl, 'private, max-age=30, stale-while-revalidate=60')

  const errClient = makeMockClient({ workspaceLookup: { data: null, error: null } })
  const errResult = await serveWebsitePrototypeSignedRead('does-not-exist', errClient)
  assert.equal(errResult.cacheControl, 'no-store')
})

// ---------------------------------------------------------------------------
// AC-11 — GET idempotency (deep-equal bodies modulo serverTime)
// ---------------------------------------------------------------------------

test('prototype-signed-read: two calls produce deep-equal bodies modulo serverTime', async () => {
  // Note: `makeMockClient` returns a fresh chain per `.from(...)` call but the
  // captured `lookup` / `list` are stable across all calls within the same
  // client. So both helper invocations see the same DB state.
  const client = makeMockClient({
    workspaceLookup: workspaceLookupFixture({ decision: 'accepted' }),
    versionList: versionListFixture(1),
  })

  const a = await serveWebsitePrototypeSignedRead(TOKEN, client)
  const b = await serveWebsitePrototypeSignedRead(TOKEN, client)

  assert.equal(a.kind, 'ok')
  assert.equal(b.kind, 'ok')
  if (a.kind !== 'ok' || b.kind !== 'ok') return

  // Strip serverTime (wall-clock, expected to differ) and compare the rest deeply.
  const stripServerTime = (body: typeof a.body) => {
    const cloned = JSON.parse(JSON.stringify(body))
    delete cloned.data.serverTime
    return cloned
  }
  assert.deepEqual(stripServerTime(a.body), stripServerTime(b.body))
})

// ---------------------------------------------------------------------------
// Bonus — project-type label humanization (covers OQ-1 RESOLVED via A1)
// ---------------------------------------------------------------------------

test('prototype-signed-read: projectTypeLabel defaults to "Sitio Web" when maxwell_snapshot is empty', async () => {
  const lookup = workspaceLookupFixture({ decision: null })
  // Force the maxwell_snapshot to be empty (no project_type field).
  ;(lookup.data as Record<string, unknown>).lead = {
    id: LEAD_ID,
    name: 'Beta Contact',
    company: null,
    maxwell_snapshot: {},
  }

  const client = makeMockClient({ workspaceLookup: lookup, versionList: versionListFixture(1) })

  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)
  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return

  // businessName falls back to lead.name when company is null.
  assert.equal(result.body.data.leadContext.businessName, 'Beta Contact')
  // projectTypeLabel falls back to 'Sitio Web' when snapshot has no project_type.
  assert.equal(result.body.data.leadContext.projectTypeLabel, 'Sitio Web')
})

// ---------------------------------------------------------------------------
// Regression — handoff 2026-05-30 prototipo-demo-url-field:
// `generatedHtml` is sourced from `generated_html` ONLY. A stray URL in
// `generated_content` (legacy inbound bug) MUST NOT be exposed as HTML.
// ---------------------------------------------------------------------------

test('prototype-signed-read: generatedHtml comes from generated_html, never generated_content', async () => {
  const lookup = workspaceLookupFixture({ decision: null })
  const ws = lookup.data as Record<string, unknown>
  // The bug shape: demo_url null, the v0 preview URL stranded in
  // generated_content, generated_html absent.
  ws.demo_url = null
  ws.generated_content = 'https://demo-kzmpmz6v5tp32sqgbjnm.vusercontent.net?__v0_token=abc'
  ws.generated_html = null

  const client = makeMockClient({ workspaceLookup: lookup, versionList: versionListFixture(1) })
  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)

  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  // The URL must NOT leak into generatedHtml (it would render as plain text in
  // an iframe srcDoc). With no demo_url and no real HTML, both are null.
  assert.equal(result.body.data.prototype.deployedUrl, null)
  assert.equal(result.body.data.prototype.generatedHtml, null)
  assert.ok(
    !JSON.stringify(result.body).includes('vusercontent.net'),
    'generated_content URL MUST NOT appear anywhere in the signed-read body',
  )
})

test('prototype-signed-read: generatedHtml echoes real inline HTML from generated_html', async () => {
  const lookup = workspaceLookupFixture({ decision: null })
  const ws = lookup.data as Record<string, unknown>
  ws.demo_url = null
  ws.generated_html = '<h1>Hola</h1>'

  const client = makeMockClient({ workspaceLookup: lookup, versionList: versionListFixture(1) })
  const result = await serveWebsitePrototypeSignedRead(TOKEN, client)

  assert.equal(result.kind, 'ok')
  if (result.kind !== 'ok') return
  assert.equal(result.body.data.prototype.deployedUrl, null)
  assert.equal(result.body.data.prototype.generatedHtml, '<h1>Hola</h1>')
})
