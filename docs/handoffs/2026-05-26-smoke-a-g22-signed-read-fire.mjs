#!/usr/bin/env node
/**
 * Smoke A G22 — fire HMAC-signed GETs against
 *   /api/integrations/website/prototype-signed-read/[token]
 *
 * Verifies PR #112 (G22 handler — ADR-024 + A1) against live deployment
 * without requiring NoonWeb D-slice. Sibling pattern to the POST decision
 * smoke at `2026-05-26-smoke-a-prototype-decision-fire.mjs`.
 *
 * Prerequisites (operator):
 *   1. PR #112 deployed (production or Vercel preview).
 *   2. Create test fixtures via Supabase MCP / SQL — see runbook §1.
 *   3. Export env vars listed below.
 *   4. Run scenarios in order (1 → 8). Some scenarios skip if their fixture
 *      env var is missing — partial runs are supported.
 *   5. Verify response bodies + cache headers per runbook §3.
 *
 * Required env vars:
 *   NOON_WEBSITE_WEBHOOK_SECRET    — shared HMAC secret (same as POST smoke).
 *
 * Optional env vars (one per scenario fixture; missing → scenario skipped):
 *   SMOKE_G22_TOKEN_PENDING        — V1 share_token, no decision row yet
 *                                    (drives scenarios 5 + 6).
 *   SMOKE_G22_TOKEN_SUPERSEDED     — V1 share_token whose workspace was
 *                                    regenerated to V2 (V1.share_token_superseded_at
 *                                    is non-null); drives scenario 7.
 *   SMOKE_G22_TOKEN_REJECTED       — V1 share_token with a 'rejected'
 *                                    prototype_decisions row; drives scenario 8.
 *
 *   APP_BASE                        — target deployment (default: production URL).
 *
 * Usage:
 *   export NOON_WEBSITE_WEBHOOK_SECRET="..."
 *   export SMOKE_G22_TOKEN_PENDING="..."
 *   export SMOKE_G22_TOKEN_SUPERSEDED="..."
 *   export SMOKE_G22_TOKEN_REJECTED="..."
 *   # Optional: export APP_BASE="https://nooncode-app-pr-112.vercel.app"
 *   node 2026-05-26-smoke-a-g22-signed-read-fire.mjs <scenario>
 *
 * Scenarios:
 *   1   → token-not-found            (dummy token → 404 PROTOTYPE_READ_TOKEN_NOT_FOUND)
 *   2   → missing-signature          (omit x-noon-signature header → 401 WEBSITE_WEBHOOK_AUTH_FAILED)
 *   3   → tampered-signature         (deadbeef signature → 401)
 *   4   → stale-timestamp            (-10 min skew → 401)
 *   5   → happy-pending              (real PENDING token → 200 + cache `private, max-age=30, stale-while-revalidate=60`)
 *   6   → happy-pending-replay       (fire 5 twice → byte-identical body modulo serverTime + requestId)
 *   7   → superseded                 (V1 token after V2 regenerate → 410 PROTOTYPE_READ_TOKEN_SUPERSEDED + no-store)
 *   8   → happy-rejected             (token with rejected decision → 200 + decision.status='rejected', notes echoed)
 */

import crypto from 'node:crypto'

const APP_BASE = process.env.APP_BASE ?? 'https://nooncode-app-pi.vercel.app'
const SECRET = process.env.NOON_WEBSITE_WEBHOOK_SECRET
const TOKEN_PENDING = process.env.SMOKE_G22_TOKEN_PENDING
const TOKEN_SUPERSEDED = process.env.SMOKE_G22_TOKEN_SUPERSEDED
const TOKEN_REJECTED = process.env.SMOKE_G22_TOKEN_REJECTED

if (!SECRET) {
  console.error('ERROR: NOON_WEBSITE_WEBHOOK_SECRET no esta seteado.')
  process.exit(1)
}

const SCENARIO = process.argv[2]
if (!SCENARIO) {
  console.error('Uso: node 2026-05-26-smoke-a-g22-signed-read-fire.mjs <scenario>')
  console.error('Scenarios: 1, 2, 3, 4, 5, 6, 7, 8')
  process.exit(1)
}

const PATH_PREFIX = '/api/integrations/website/prototype-signed-read'

// Sentinels for HMAC headers
const TAMPERED_SIGNATURE = 'sha256=deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef'
const STALE_SKEW_SECONDS = 600 // 10 min back — outside the ±5min window

// ---- Helpers ----

function signHeaders(opts = {}) {
  const now = Math.floor(Date.now() / 1000)
  const timestamp = opts.timestampOverride ?? now.toString()
  // GET endpoints sign over `${timestamp}.` (zero-body convention per ADR-024 D1).
  const signaturePayload = `${timestamp}.`
  const signature = crypto.createHmac('sha256', SECRET).update(signaturePayload).digest('hex')

  const headers = {}
  if (!opts.omitTimestamp) headers['x-noon-timestamp'] = timestamp
  if (!opts.omitSignature) {
    headers['x-noon-signature'] = opts.tamperedSignature
      ? TAMPERED_SIGNATURE
      : `sha256=${signature}`
  }
  return { headers, timestamp }
}

async function fire(token, signOpts = {}, label) {
  const { headers, timestamp } = signHeaders(signOpts)
  const url = `${APP_BASE}${PATH_PREFIX}/${encodeURIComponent(token)}`

  console.log(`\n--- ${label} ---`)
  console.log(`GET ${url.replace(token, token.slice(0, 8) + '...')}`)
  console.log(`Headers: ${Object.keys(headers).join(', ') || '(none)'}`)
  console.log(`Timestamp: ${signOpts.omitTimestamp ? 'OMITTED' : timestamp}${signOpts.timestampOverride ? ' (override)' : ''}`)
  console.log(`Token (first 8): ${token.slice(0, 8)}`)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    })
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not json */ }

    const cacheControl = response.headers.get('cache-control') ?? '(absent)'

    console.log(`\nResponse: HTTP ${response.status}`)
    console.log(`Cache-Control: ${cacheControl}`)
    if (json) {
      if (json.data) {
        // Truncate noisy generated_html/deployedUrl to keep output readable.
        const trimmed = JSON.parse(JSON.stringify(json.data))
        if (trimmed.prototype?.generatedHtml && trimmed.prototype.generatedHtml.length > 80) {
          trimmed.prototype.generatedHtml = trimmed.prototype.generatedHtml.slice(0, 80) + '...'
        }
        console.log(`  data:`, JSON.stringify(trimmed, null, 2))
      }
      if (json.error) console.log(`  error: ${json.error}`)
      if (json.code) console.log(`  code: ${json.code}`)
      if (json.requestId) console.log(`  requestId: ${json.requestId}`)
    } else {
      console.log(`  (raw) ${text.slice(0, 500)}`)
    }

    const compact = `HTTP ${response.status}` +
      (json?.code ? ` code=${json.code}` : '') +
      (json?.data?.decision?.status ? ` decision.status=${json.data.decision.status}` : '') +
      (json?.data?.workspace?.version !== undefined ? ` workspace.version=${json.data.workspace.version}` : '') +
      (json?.data?.lifecycle?.tokenSuperseded !== undefined ? ` tokenSuperseded=${json.data.lifecycle.tokenSuperseded}` : '')
    console.log(`\nResumen: ${compact}`)
    return { response, json, cacheControl, timestamp }
  } catch (err) {
    console.error(`\nNETWORK ERROR: ${err.message}`)
    return null
  }
}

function requireToken(envValue, envName, scenarioLabel) {
  if (!envValue) {
    console.error(`ERROR: Scenario ${scenarioLabel} requiere ${envName} env var (ver runbook §1).`)
    process.exit(1)
  }
  return envValue
}

const DUMMY_TOKEN = '00000000-0000-4000-8000-000000000000'

// ---- Scenario dispatcher ----

async function runScenario() {
  switch (SCENARIO) {
    case '1':
      console.log(`=== Scenario 1: token-not-found ===`)
      console.log(`Expected: HTTP 404 code=PROTOTYPE_READ_TOKEN_NOT_FOUND, Cache-Control: no-store`)
      await fire(DUMMY_TOKEN, {}, 'fire 1.1')
      break

    case '2':
      console.log(`=== Scenario 2: missing-signature ===`)
      console.log(`Expected: HTTP 401 code=WEBSITE_WEBHOOK_AUTH_FAILED, Cache-Control: no-store`)
      await fire(DUMMY_TOKEN, { omitSignature: true }, 'fire 2.1')
      break

    case '3':
      console.log(`=== Scenario 3: tampered-signature ===`)
      console.log(`Expected: HTTP 401 code=WEBSITE_WEBHOOK_AUTH_FAILED, Cache-Control: no-store`)
      await fire(DUMMY_TOKEN, { tamperedSignature: true }, 'fire 3.1')
      break

    case '4': {
      console.log(`=== Scenario 4: stale-timestamp (-10min) ===`)
      console.log(`Expected: HTTP 401 code=WEBSITE_WEBHOOK_AUTH_FAILED, Cache-Control: no-store`)
      const staleTs = (Math.floor(Date.now() / 1000) - STALE_SKEW_SECONDS).toString()
      await fire(DUMMY_TOKEN, { timestampOverride: staleTs }, 'fire 4.1')
      break
    }

    case '5': {
      console.log(`=== Scenario 5: happy 200 pending ===`)
      console.log(`Expected: HTTP 200, decision.status=pending, Cache-Control: private, max-age=30, stale-while-revalidate=60`)
      const token = requireToken(TOKEN_PENDING, 'SMOKE_G22_TOKEN_PENDING', '5')
      await fire(token, {}, 'fire 5.1')
      break
    }

    case '6': {
      console.log(`=== Scenario 6: happy 200 pending — replay (byte-identical except serverTime+requestId) ===`)
      console.log(`Expected: 2 x HTTP 200 with same workspace/leadContext/prototype/decision/lifecycle.iterationNumber.`)
      console.log(`         serverTime + requestId may differ. Cache-Control identical on both.`)
      const token = requireToken(TOKEN_PENDING, 'SMOKE_G22_TOKEN_PENDING', '6')
      const first = await fire(token, {}, 'fire 6.1 (first read)')
      if (!first) break
      await new Promise((r) => setTimeout(r, 500)) // brief gap to make serverTime drift visible
      const second = await fire(token, {}, 'fire 6.2 (second read)')
      if (!second) break
      console.log(`\nCompare bodies (excluding serverTime + requestId):`)
      const stripVolatile = (json) => {
        if (!json?.data) return null
        const clone = JSON.parse(JSON.stringify(json))
        if (clone.data?.serverTime) delete clone.data.serverTime
        if (clone.requestId) delete clone.requestId
        return clone
      }
      const a = JSON.stringify(stripVolatile(first.json))
      const b = JSON.stringify(stripVolatile(second.json))
      console.log(`  fire 6.1 stable body length: ${a?.length}`)
      console.log(`  fire 6.2 stable body length: ${b?.length}`)
      console.log(`  Byte-identical (excl. serverTime/requestId): ${a === b ? 'YES' : 'NO'}`)
      console.log(`  Cache-Control match: ${first.cacheControl === second.cacheControl ? 'YES' : 'NO'}`)
      break
    }

    case '7': {
      console.log(`=== Scenario 7: token-superseded (410) ===`)
      console.log(`Expected: HTTP 410 code=PROTOTYPE_READ_TOKEN_SUPERSEDED, Cache-Control: no-store`)
      const token = requireToken(TOKEN_SUPERSEDED, 'SMOKE_G22_TOKEN_SUPERSEDED', '7')
      await fire(token, {}, 'fire 7.1')
      break
    }

    case '8': {
      console.log(`=== Scenario 8: happy 200 rejected ===`)
      console.log(`Expected: HTTP 200, decision.status=rejected, decision.notes echoed verbatim,`)
      console.log(`         Cache-Control: private, max-age=30, stale-while-revalidate=60`)
      const token = requireToken(TOKEN_REJECTED, 'SMOKE_G22_TOKEN_REJECTED', '8')
      await fire(token, {}, 'fire 8.1')
      break
    }

    default:
      console.error(`Scenario desconocido: ${SCENARIO}`)
      console.error(`Scenarios disponibles: 1, 2, 3, 4, 5, 6, 7, 8`)
      process.exit(1)
  }
}

await runScenario()
