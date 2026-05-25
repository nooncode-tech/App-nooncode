#!/usr/bin/env node
/**
 * B1.3b smoke — dispara requests HTTP firmados contra NoonApp.
 *
 * Uso desde la workstation del dev NoonWeb:
 *
 *   export NOON_WEBSITE_WEBHOOK_SECRET="<el-mismo-secret-que-tiene-NoonApp>"
 *   node b1-3b-noonweb-fire.mjs <scenario>
 *
 * Scenarios disponibles:
 *   1   → inbound-proposal happy path (sess_b13b_smoke_001)
 *   2   → inbound-proposal retry idempotente (mismo payload de Scenario 1)
 *   3a  → inbound-proposal missing signature header
 *   3b  → inbound-proposal tampered signature
 *   3c  → inbound-proposal stale timestamp (-10 min)
 *   3d  → inbound-proposal missing timestamp header (bug F-1 evidence)
 *   5   → payment-confirmed happy path (sess _001 + pay _001)
 *   6   → payment-confirmed retry idempotente
 *   7-setup → inbound-proposal con marker _002 (precondition para 7)
 *   7   → payment-confirmed con _002 (debe rechazar 409)
 *
 * Output: HTTP status + response body. NO loguea la firma raw.
 */

import crypto from 'node:crypto'

const APP_BASE = 'https://nooncode-app-pi.vercel.app'
const SECRET = process.env.NOON_WEBSITE_WEBHOOK_SECRET

if (!SECRET) {
  console.error('ERROR: NOON_WEBSITE_WEBHOOK_SECRET no está seteado en el environment.')
  process.exit(1)
}

const SCENARIO = process.argv[2]
if (!SCENARIO) {
  console.error('Uso: node b1-3b-noonweb-fire.mjs <scenario>')
  console.error('Scenarios: 1, 2, 3a, 3b, 3c, 3d, 5, 6, 7-setup, 7')
  process.exit(1)
}

// ---- Payloads ----

const PAYLOAD_INBOUND_001 = {
  external_source: 'noon_website',
  external_session_id: 'sess_b13b_smoke_001',
  external_proposal_id: 'prop_b13b_smoke_001',
  customer: {
    name: 'B1.3b Smoke Test',
    email: 'b13b.smoke@nooncode.com',
    company: 'B1.3b Test Co',
  },
  proposal: {
    title: 'Smoke test inbound proposal',
    body: 'Verificación cross-repo webhook v1.',
    amount: 350,
    currency: 'USD',
  },
  maxwell: {
    summary: 'Smoke test inbound — no real session',
  },
  metadata: {
    score: 80,
    smoke: 'b13b',
  },
}

const PAYLOAD_INBOUND_002 = {
  ...PAYLOAD_INBOUND_001,
  external_session_id: 'sess_b13b_smoke_002',
  external_proposal_id: 'prop_b13b_smoke_002',
}

const PAYLOAD_INBOUND_3D = {
  ...PAYLOAD_INBOUND_001,
  external_session_id: 'sess_b13b_smoke_3d_001',
  external_proposal_id: 'prop_b13b_smoke_3d_001',
}

const PAYLOAD_PAYMENT_001 = {
  external_source: 'noon_website',
  external_session_id: 'sess_b13b_smoke_001',
  external_proposal_id: 'prop_b13b_smoke_001',
  external_payment_id: 'pay_b13b_smoke_001',
  maxwell: {},
  handoff: {
    summary: 'Smoke test payment confirmation',
  },
  payment: {
    amount: 350,
    currency: 'USD',
    provider: 'stripe_test',
    paid_at: new Date().toISOString(),
  },
  metadata: {
    smoke: 'b13b',
  },
}

const PAYLOAD_PAYMENT_002 = {
  ...PAYLOAD_PAYMENT_001,
  external_session_id: 'sess_b13b_smoke_002',
  external_proposal_id: 'prop_b13b_smoke_002',
  external_payment_id: 'pay_b13b_smoke_002',
}

// ---- Helpers ----

function signHeaders(bodyText, opts = {}) {
  const now = Math.floor(Date.now() / 1000)
  const timestamp = opts.timestampOverride ?? now.toString()
  const signaturePayload = `${timestamp}.${bodyText}`
  const signature = crypto.createHmac('sha256', SECRET).update(signaturePayload).digest('hex')

  const headers = { 'content-type': 'application/json' }
  if (!opts.omitTimestamp) headers['x-noon-timestamp'] = timestamp
  if (!opts.omitSignature) {
    headers['x-noon-signature'] = opts.tamperedSignature
      ? 'sha256=deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef'
      : `sha256=${signature}`
  }
  return headers
}

async function fire(path, payload, signOpts = {}, scenarioLabel) {
  const body = JSON.stringify(payload)
  const headers = signHeaders(body, signOpts)

  console.log(`\n=== Scenario ${scenarioLabel} ===`)
  console.log(`POST ${APP_BASE}${path}`)
  console.log(`Headers sent: ${Object.keys(headers).join(', ')}`)
  if (signOpts.timestampOverride) console.log(`Timestamp override: ${signOpts.timestampOverride}`)
  if (signOpts.omitTimestamp) console.log(`Timestamp header: OMITTED`)
  if (signOpts.omitSignature) console.log(`Signature header: OMITTED`)
  if (signOpts.tamperedSignature) console.log(`Signature: TAMPERED (deadbeef)`)
  console.log(`Body external ids: session=${payload.external_session_id} proposal=${payload.external_proposal_id}${payload.external_payment_id ? ` payment=${payload.external_payment_id}` : ''}`)

  try {
    const response = await fetch(`${APP_BASE}${path}`, {
      method: 'POST',
      headers,
      body,
    })
    const responseText = await response.text()
    let responseJson = null
    try { responseJson = JSON.parse(responseText) } catch { /* not json */ }

    console.log(`\n→ HTTP ${response.status}`)
    console.log(`→ Response body:`)
    if (responseJson) {
      // Compact, no sensitive fields
      const safe = { ...responseJson }
      if (safe.data) {
        console.log(`  data:`, JSON.stringify(safe.data, null, 2))
      }
      if (safe.error) console.log(`  error: ${safe.error}`)
      if (safe.code) console.log(`  code: ${safe.code}`)
      if (safe.requestId) console.log(`  requestId: ${safe.requestId}`)
    } else {
      console.log(`  (raw) ${responseText.slice(0, 500)}`)
    }
    console.log(`\nCopiá esto al canal con Pedro: HTTP ${response.status}${responseJson?.code ? ` code=${responseJson.code}` : ''}${responseJson?.data?.idempotent !== undefined ? ` idempotent=${responseJson.data.idempotent}` : ''}${responseJson?.data?.linkId ? ` linkId=${responseJson.data.linkId}` : ''}`)
  } catch (err) {
    console.error(`\n→ NETWORK ERROR: ${err.message}`)
  }
}

// ---- Scenario dispatcher ----

const PATH_INBOUND = '/api/integrations/website/inbound-proposal'
const PATH_PAYMENT = '/api/integrations/website/payment-confirmed'

switch (SCENARIO) {
  case '1':
    await fire(PATH_INBOUND, PAYLOAD_INBOUND_001, {}, '1 (inbound-proposal happy path)')
    break
  case '2':
    await fire(PATH_INBOUND, PAYLOAD_INBOUND_001, {}, '2 (inbound-proposal idempotent retry)')
    break
  case '3a':
    await fire(PATH_INBOUND, PAYLOAD_INBOUND_001, { omitSignature: true }, '3a (missing signature)')
    break
  case '3b':
    await fire(PATH_INBOUND, PAYLOAD_INBOUND_001, { tamperedSignature: true }, '3b (tampered signature)')
    break
  case '3c': {
    const staleTs = (Math.floor(Date.now() / 1000) - 600).toString()
    await fire(PATH_INBOUND, PAYLOAD_INBOUND_001, { timestampOverride: staleTs }, '3c (stale timestamp -10min)')
    break
  }
  case '3d':
    await fire(PATH_INBOUND, PAYLOAD_INBOUND_3D, { omitTimestamp: true }, '3d (missing timestamp header — F-1 evidence)')
    break
  case '5':
    await fire(PATH_PAYMENT, PAYLOAD_PAYMENT_001, {}, '5 (payment-confirmed happy path)')
    break
  case '6':
    await fire(PATH_PAYMENT, PAYLOAD_PAYMENT_001, {}, '6 (payment-confirmed idempotent retry)')
    break
  case '7-setup':
    await fire(PATH_INBOUND, PAYLOAD_INBOUND_002, {}, '7-setup (inbound-proposal _002, NO aprobar)')
    break
  case '7':
    await fire(PATH_PAYMENT, PAYLOAD_PAYMENT_002, {}, '7 (payment-confirmed _002 — debe rechazar 409)')
    break
  default:
    console.error(`Scenario desconocido: ${SCENARIO}`)
    console.error('Scenarios: 1, 2, 3a, 3b, 3c, 3d, 5, 6, 7-setup, 7')
    process.exit(1)
}
