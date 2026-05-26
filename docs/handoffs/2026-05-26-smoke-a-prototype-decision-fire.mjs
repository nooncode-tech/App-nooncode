#!/usr/bin/env node
/**
 * Smoke A — fire HMAC-signed requests at POST /api/integrations/website/prototype-decision
 *
 * Verifies PR #110 (B+C slice ADR-023 implementation) without requiring
 * NoonWeb D-slice. Runs against either Vercel preview (pre-merge) or production
 * (post-merge) — both hit the same Supabase prod DB.
 *
 * Prerequisites (operator):
 *   1. Migration 0060 applied to target Supabase (already done in prod,
 *      ledger row 20260525195022).
 *   2. Create two test fixtures via Supabase MCP / SQL — see runbook §1.
 *   3. Export env vars listed below.
 *   4. Run scenarios in order (1 → 7).
 *   5. Verify side-effects via Supabase queries between scenarios — see runbook §3.
 *
 * Required env vars:
 *   NOON_WEBSITE_WEBHOOK_SECRET   — shared HMAC secret (same as B1.3b).
 *   SMOKE_REJECT_TOKEN            — share_token of fixture A (will receive reject).
 *   SMOKE_REJECT_WORKSPACE_ID     — uuid of the workspace owning REJECT_TOKEN.
 *   SMOKE_ACCEPT_TOKEN            — share_token of fixture B (will receive accept).
 *   SMOKE_ACCEPT_WORKSPACE_ID     — uuid of the workspace owning ACCEPT_TOKEN.
 *
 * Optional env vars:
 *   APP_BASE                      — target deployment (default: production URL).
 *
 * Usage:
 *   export NOON_WEBSITE_WEBHOOK_SECRET="..."
 *   export SMOKE_REJECT_TOKEN="..."
 *   export SMOKE_REJECT_WORKSPACE_ID="..."
 *   export SMOKE_ACCEPT_TOKEN="..."
 *   export SMOKE_ACCEPT_WORKSPACE_ID="..."
 *   # Optional: export APP_BASE="https://nooncode-app-pr-110.vercel.app"
 *   node 2026-05-26-smoke-a-prototype-decision-fire.mjs <scenario>
 *
 * Scenarios:
 *   1   → token-not-found        (dummy UUIDs → 404 PROTOTYPE_DECISION_TOKEN_NOT_FOUND)
 *   2   → invalid-decision-enum  (decision=`maybe` → 400 validation)
 *   3   → missing-signature      (omit HMAC header → 401 WEBSITE_WEBHOOK_AUTH_FAILED)
 *   4   → identifier-mismatch    (real REJECT token + wrong workspace UUID → 409)
 *   5   → reject + replay        (fires twice, same timestamp → 201 then 200 idempotent)
 *   6   → already-decided        (after 5, decision=accepted, fresh ts → 409)
 *   7   → accept + replay        (fires twice → 201 draftQueued=true then 200 idempotent draftQueued=false)
 */

import crypto from 'node:crypto'

const APP_BASE = process.env.APP_BASE ?? 'https://nooncode-app-pi.vercel.app'
const SECRET = process.env.NOON_WEBSITE_WEBHOOK_SECRET
const REJECT_TOKEN = process.env.SMOKE_REJECT_TOKEN
const REJECT_WORKSPACE_ID = process.env.SMOKE_REJECT_WORKSPACE_ID
const ACCEPT_TOKEN = process.env.SMOKE_ACCEPT_TOKEN
const ACCEPT_WORKSPACE_ID = process.env.SMOKE_ACCEPT_WORKSPACE_ID

if (!SECRET) {
  console.error('ERROR: NOON_WEBSITE_WEBHOOK_SECRET no esta seteado.')
  process.exit(1)
}

const SCENARIO = process.argv[2]
if (!SCENARIO) {
  console.error('Uso: node 2026-05-26-smoke-a-prototype-decision-fire.mjs <scenario>')
  console.error('Scenarios: 1, 2, 3, 4, 5, 6, 7')
  process.exit(1)
}

const PATH = '/api/integrations/website/prototype-decision'

const SCENARIOS_NEED_REJECT = ['4', '5', '6']
const SCENARIOS_NEED_ACCEPT = ['7']

if (SCENARIOS_NEED_REJECT.includes(SCENARIO)) {
  if (!REJECT_TOKEN || !REJECT_WORKSPACE_ID) {
    console.error(`ERROR: Scenario ${SCENARIO} requiere SMOKE_REJECT_TOKEN y SMOKE_REJECT_WORKSPACE_ID.`)
    process.exit(1)
  }
}
if (SCENARIOS_NEED_ACCEPT.includes(SCENARIO)) {
  if (!ACCEPT_TOKEN || !ACCEPT_WORKSPACE_ID) {
    console.error(`ERROR: Scenario ${SCENARIO} requiere SMOKE_ACCEPT_TOKEN y SMOKE_ACCEPT_WORKSPACE_ID.`)
    process.exit(1)
  }
}

// ---- Helpers ----

function signHeaders(bodyText, opts = {}) {
  const now = Math.floor(Date.now() / 1000)
  const timestamp = opts.timestampOverride ?? now.toString()
  const signaturePayload = `${timestamp}.${bodyText}`
  const signature = crypto.createHmac('sha256', SECRET).update(signaturePayload).digest('hex')

  const headers = { 'content-type': 'application/json' }
  if (!opts.omitTimestamp) headers['x-noon-timestamp'] = timestamp
  if (!opts.omitSignature) headers['x-noon-signature'] = `sha256=${signature}`
  return { headers, timestamp }
}

async function fire(payload, signOpts = {}, label) {
  const body = JSON.stringify(payload)
  const { headers, timestamp } = signHeaders(body, signOpts)

  console.log(`\n--- ${label} ---`)
  console.log(`POST ${APP_BASE}${PATH}`)
  console.log(`Headers: ${Object.keys(headers).join(', ')}`)
  console.log(`Timestamp: ${signOpts.omitTimestamp ? 'OMITTED' : timestamp}`)
  console.log(`Token (first 8): ${payload.token ? payload.token.slice(0, 8) : '(none)'}`)
  console.log(`Workspace UUID: ${payload.prototype_workspace_id ?? '(none)'}`)
  console.log(`Decision: ${payload.decision ?? '(none)'}`)

  try {
    const response = await fetch(`${APP_BASE}${PATH}`, {
      method: 'POST',
      headers,
      body,
    })
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not json */ }

    console.log(`\nResponse: HTTP ${response.status}`)
    if (json) {
      if (json.data) console.log(`  data:`, JSON.stringify(json.data, null, 2))
      if (json.error) console.log(`  error: ${json.error}`)
      if (json.code) console.log(`  code: ${json.code}`)
      if (json.requestId) console.log(`  requestId: ${json.requestId}`)
    } else {
      console.log(`  (raw) ${text.slice(0, 500)}`)
    }

    const compact = `HTTP ${response.status}` +
      (json?.code ? ` code=${json.code}` : '') +
      (json?.data?.idempotent !== undefined ? ` idempotent=${json.data.idempotent}` : '') +
      (json?.data?.draftPropuestaQueued !== undefined ? ` draftQueued=${json.data.draftPropuestaQueued}` : '') +
      (json?.data?.decisionId ? ` decisionId=${json.data.decisionId.slice(0, 8)}…` : '')
    console.log(`\nResumen: ${compact}`)
    return { response, json, timestamp }
  } catch (err) {
    console.error(`\nNETWORK ERROR: ${err.message}`)
    return null
  }
}

// ---- Payloads ----

const DUMMY_TOKEN = '00000000-0000-4000-8000-000000000000'
const DUMMY_WORKSPACE_ID = '11111111-1111-4000-8000-111111111111'

function buildPayload({ token, workspaceId, decision, notes }) {
  const payload = {
    token,
    prototype_workspace_id: workspaceId,
    decision,
    client: { user_agent: 'noon-smoke-a/1.0' },
    metadata: { smoke: 'A', date: '2026-05-26' },
    external_source: 'noon_website',
  }
  if (notes !== undefined) payload.notes = notes
  return payload
}

// ---- Scenario dispatcher ----

async function runScenario() {
  switch (SCENARIO) {
    case '1':
      console.log(`=== Scenario 1: token-not-found ===`)
      console.log(`Expected: HTTP 404 code=PROTOTYPE_DECISION_TOKEN_NOT_FOUND`)
      await fire(
        buildPayload({ token: DUMMY_TOKEN, workspaceId: DUMMY_WORKSPACE_ID, decision: 'rejected', notes: 'smoke 1' }),
        {},
        'fire 1.1'
      )
      break

    case '2':
      console.log(`=== Scenario 2: invalid-decision-enum ===`)
      console.log(`Expected: HTTP 400 (zod validation rejects decision="maybe")`)
      await fire(
        buildPayload({ token: DUMMY_TOKEN, workspaceId: DUMMY_WORKSPACE_ID, decision: 'maybe', notes: 'smoke 2' }),
        {},
        'fire 2.1'
      )
      break

    case '3':
      console.log(`=== Scenario 3: missing-signature ===`)
      console.log(`Expected: HTTP 401 code=WEBSITE_WEBHOOK_AUTH_FAILED`)
      await fire(
        buildPayload({ token: DUMMY_TOKEN, workspaceId: DUMMY_WORKSPACE_ID, decision: 'rejected', notes: 'smoke 3' }),
        { omitSignature: true },
        'fire 3.1'
      )
      break

    case '4':
      console.log(`=== Scenario 4: identifier-mismatch ===`)
      console.log(`Expected: HTTP 409 code=PROTOTYPE_DECISION_IDENTIFIER_MISMATCH`)
      await fire(
        buildPayload({
          token: REJECT_TOKEN,
          workspaceId: DUMMY_WORKSPACE_ID,  // wrong UUID
          decision: 'rejected',
          notes: 'smoke 4',
        }),
        {},
        'fire 4.1'
      )
      break

    case '5': {
      console.log(`=== Scenario 5: reject + bit-identical replay ===`)
      console.log(`Expected: fire 1 → HTTP 201; fire 2 (same ts) → HTTP 200 idempotent=true`)
      const payload5 = buildPayload({
        token: REJECT_TOKEN,
        workspaceId: REJECT_WORKSPACE_ID,
        decision: 'rejected',
        notes: 'Cliente decidio que el prototipo no encaja con la vision. Smoke A scenario 5.',
      })
      const first = await fire(payload5, {}, 'fire 5.1 (original)')
      if (!first) break
      console.log(`\n  Reusando timestamp ${first.timestamp} para el replay...`)
      await fire(payload5, { timestampOverride: first.timestamp }, 'fire 5.2 (bit-identical replay)')
      console.log(`\nVerificacion Supabase pendiente — ver runbook §3 Scenario 5.`)
      break
    }

    case '6':
      console.log(`=== Scenario 6: already-decided conflicting ===`)
      console.log(`PRECONDITION: Scenario 5 ya corrio (REJECT workspace tiene decision=rejected).`)
      console.log(`Expected: HTTP 409 code=PROTOTYPE_DECISION_ALREADY_DECIDED`)
      await fire(
        buildPayload({
          token: REJECT_TOKEN,
          workspaceId: REJECT_WORKSPACE_ID,
          decision: 'accepted',  // conflicting decision
          notes: 'smoke 6 — intento conflictivo',
        }),
        {},
        'fire 6.1'
      )
      break

    case '7': {
      console.log(`=== Scenario 7: accept + bit-identical replay ===`)
      console.log(`Expected: fire 1 → HTTP 201 draftQueued=true; fire 2 (same ts) → HTTP 200 idempotent=true draftQueued=false`)
      const payload7 = buildPayload({
        token: ACCEPT_TOKEN,
        workspaceId: ACCEPT_WORKSPACE_ID,
        decision: 'accepted',
        notes: null,
      })
      const first = await fire(payload7, {}, 'fire 7.1 (original)')
      if (!first) break
      console.log(`\n  Reusando timestamp ${first.timestamp} para el replay...`)
      await fire(payload7, { timestampOverride: first.timestamp }, 'fire 7.2 (bit-identical replay)')
      console.log(`\nVerificacion Supabase pendiente — ver runbook §3 Scenario 7.`)
      break
    }

    default:
      console.error(`Scenario desconocido: ${SCENARIO}`)
      console.error(`Scenarios disponibles: 1, 2, 3, 4, 5, 6, 7`)
      process.exit(1)
  }
}

await runScenario()
