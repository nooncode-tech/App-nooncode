# B1.3b — Plan Maestro · Smoke E2E cross-repo NoonWeb ↔ NoonApp

**Fecha:** 2026-05-18
**Doc-tipo:** Runbook autocontenido para ejecutar la iteración `fase-1-b1-3b-inbound-smoke-cross-repo` end-to-end.
**Owner:** Pedro (App side) coordinado con dev NoonWeb (Web side).
**Tiempo estimado del smoke:** 90-120 min en ventana coordinada.

---

## Índice

1. [Resumen ejecutivo (¿qué? ¿por qué? ¿cómo?)](#1-resumen-ejecutivo)
2. [Status actual — lo que está listo y lo pendiente](#2-status-actual)
3. [Plan paso a paso de la sesión](#3-plan-paso-a-paso)
4. [Mensaje verbatim para el dev NoonWeb](#4-mensaje-verbatim-para-el-dev-noonweb)
5. [Tu checklist + queries por scenario](#5-tu-checklist--queries-por-scenario)
6. [Reglas de captura de evidencia (Security mandatory)](#6-reglas-de-captura-de-evidencia)
7. [Failure modes + decision points](#7-failure-modes--decision-points)
8. [Post-smoke — cierre del flow](#8-post-smoke--cierre-del-flow)
9. [Referencias y trazabilidad](#9-referencias-y-trazabilidad)

---

## 1. Resumen ejecutivo

### ¿Qué es B1.3b?

El **último smoke E2E en vivo del contrato webhook v1 cross-repo** entre NoonWeb (sitio público) y NoonApp (workspace interno). Es la verificación final antes de que NoonApp pueda recibir leads inbound reales del website en producción.

### ¿Por qué hoy?

- B1.3a (outbound smoke) cerró 2026-05-17 con `$1` real, Scenarios 1-8 PASS. La mitad outbound está validada.
- B1.3b inbound es el **último bloqueador externo** de **B1.5 pilot sign-off**. Sin él, FASE 1 cutover queda al 99%, no al 100%.
- El dev NoonWeb confirmó disponibilidad hoy. Esta ventana se pierde si no la usamos.

### ¿Qué vamos a ejercer?

**8 scenarios** (más 1 OPTIONAL elevado a STRONGLY-RECOMMENDED por Security review):

| # | Scenario | Quién dispara | Esperado |
|---|---|---|---|
| 1 | `inbound-proposal` happy path | dev NoonWeb | HTTP 201 + lead/proposal creados |
| 2 | `inbound-proposal` retry idempotente | dev NoonWeb | HTTP 200 + `idempotent: true` |
| 3a | Missing signature header | dev NoonWeb | HTTP 401 |
| 3b | Tampered signature | dev NoonWeb | HTTP 401 |
| 3c | Stale timestamp >5min | dev NoonWeb | HTTP 401 |
| **3d** | **Missing timestamp header (Security upgraded)** | **dev NoonWeb** | **HTTP 201 (bug F-1 confirmado) — evidence verbatim** |
| 4 | PM Approve → outbound `proposal-review-decision` | vos (App side) | DB shows `review_webhook_status='sent'` + dev confirma recepción NoonWeb |
| 5 | `payment-confirmed` happy path | dev NoonWeb | HTTP 201 + project activated |
| 6 | `payment-confirmed` retry idempotente | dev NoonWeb | HTTP 200 + `idempotent: true` |
| 7 | `payment-confirmed` pre-PM-approval | dev NoonWeb | HTTP 409 `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL` |

**No usamos dinero real** — test mode end-to-end. El dev NoonWeb firma payloads HMAC con `external_payment_id = pay_b13b_smoke_*` directamente, sin pasar por Stripe Live.

---

## 2. Status actual

### ✅ Lo que está listo (no tocar)

| Item | Estado |
|---|---|
| PR #65 (Path G — wallet reversal RPC) | Mergeado 2026-05-17, deployed |
| Develop HEAD | `f3626d9` |
| Producción Vercel | Deploy `nooncode-njuz0y936-...` Ready, último de hace ~50min |
| Repo `nooncode-org/App-nooncode` | PUBLIC (temporal, post-smoke vuelve a PRIVATE) |
| `NOON_WEBSITE_WEBHOOK_SECRET` (Vercel Production) | Set, válido (endpoint inbound App responde 401 a unsigned ✅) |
| Spec autoritativo | `specs/fase-1-b1-3b-inbound-smoke-cross-repo.md` |
| Pre-flight Infra | READY-WITH-WARNINGS |
| Security review | GATE-OPEN-WITH-FOLLOW-UPS |

### ⚠️ Warnings activos (aceptados para arrancar)

| Warning | Mitigación |
|---|---|
| **F-1 HIGH** — Q2 timestamp divergence: `lib/server/website-webhook-auth.ts:30-32` early-returns si `x-noon-timestamp` falta → request con HMAC válido contra `bodyText` solo se aceptaría. Viola contrato §2.3. | **NO bloquea smoke.** Scenario 3d lo evidencia en producción. **BLOQUEA B1.5 pilot sign-off**: requiere iteración hija `fase-1-b1-3c-hmac-timestamp-required-fix` (~3 líneas + unit test). |
| **F-3 MEDIUM** — Repo PUBLIC durante smoke | Re-flip a PRIVATE post-smoke (task #6 pending) o entrada date-bounded en Active risks (máx 7 días). |
| **F-4 MEDIUM** — `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` no verificable estáticamente: Vercel UI muestra valor "vacío" después de Save, pero CLI muestra row existente. Bug Vercel UI o valor empty real. **Decisión operativa:** verificar empíricamente en Scenario 4 — si status='sent', el env var está correcto; si status='skipped', el env var está empty y bloqueamos el smoke. | Aceptado riesgo. Reset rápido si falla Scenario 4. |
| **G11** Vercel auto-deploys siguen rotos | Mitigación: Deploy Hook manual si hay hotfix mid-smoke. |
| **HMAC parity App↔Web** | El dev NoonWeb debe confirmar hash del secret antes de Scenario 1 (no el cleartext). Ver §4 punto 1. |

### 🔵 Lo pendiente operativo (tu acción)

| # | Acción | Cuándo | Tiempo |
|---|---|---|---|
| 1 | Mandar §4 verbatim al dev NoonWeb | Ya | 1 min |
| 2 | Verificar tus preconditions §5.1 | Antes del smoke | 5 min |
| 3 | Coord ventana 90-120 min con dev NoonWeb | Cuando esté listo | externo |
| 4 | Ejecutar smoke (yo asisto) | Coordinated | 90-120 min |
| 5 | Post-smoke: re-flip a PRIVATE | Inmediato post | 30 sec |
| 6 | Schedule iteración hija `fase-1-b1-3c HMAC fix` | Próxima sesión | externo |

---

## 3. Plan paso a paso

```
┌─ HOY (esta sesión) ──────────────────────────────────────────────────────┐
│                                                                          │
│  [Step 1] Vos: confirmás tus 4 preconditions (§5.1)                      │
│      └─ Si falla cualquiera → fix antes de avanzar                       │
│                                                                          │
│  [Step 2] Vos: mandás §4 al dev NoonWeb                                  │
│      └─ Esperás confirmación: hash del HMAC secret + signing format OK   │
│                                                                          │
│  [Step 3] Coord ventana 90-120 min con dev NoonWeb                       │
│      └─ Pones tab Supabase SQL Editor abierto                            │
│      └─ Pones tab browser logueado admin@noon.app                        │
│      └─ Pones tab Vercel Functions logs (para 3a/3b/3c verify)           │
│                                                                          │
│  [Step 4] EJECUCIÓN — secuencia estricta:                                │
│      ├─ Scenario 1 (dev NoonWeb fires) → Pedro queries → PASS/FAIL       │
│      ├─ Scenario 2 (dev NoonWeb fires) → Pedro queries → PASS/FAIL       │
│      ├─ Scenarios 3a/3b/3c (3 disparos negativos) → Pedro check logs     │
│      ├─ Scenario 3d (1 disparo sin timestamp) → Pedro check 201 expected │
│      ├─ Scenario 4 (Pedro hace Approve UI) → check status='sent'         │
│      │    └─ Si status='skipped' → STOP, fix env var, re-execute         │
│      ├─ Scenario 5 (dev NoonWeb fires) → Pedro queries Q4 oracle         │
│      ├─ Scenario 6 (dev NoonWeb retry) → Pedro queries idempotency       │
│      └─ Scenario 7 (dev NoonWeb fires _002) → Pedro queries 409          │
│                                                                          │
│  [Step 5] Post-smoke captura: yo (system-testing) estructuro evidence    │
│      en `docs/validations/B1.3b inbound smoke 2026-05-18.md` con         │
│      verdicts PASS/FAIL/N/A por scenario + Q4 oracle output + F-1 evidence│
│                                                                          │
│  [Step 6] Yo (system-docs) actualizo:                                    │
│      ├─ `docs/context/project.context.core.md` Active risks + Closed     │
│      ├─ `docs/context/project.context.history.md`                        │
│      └─ Roadmap (Desktop) §6 + §17                                       │
│                                                                          │
│  [Step 7] Yo (system-validator) doy verdict:                             │
│      COMPLETE / PARTIAL / BLOCKED                                        │
│                                                                          │
│  [Step 8] Vos cierras operativo:                                         │
│      ├─ Re-flip repo a PRIVATE (`gh repo edit ... --visibility private`)│
│      └─ Crear iteración hija para F-1 fix (próxima sesión OK)            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Mensaje verbatim para el dev NoonWeb

> Copiá y pegá esta sección entera al canal directo (Slack/WhatsApp/email) que usen.

---

### ✂️ INICIO DEL MENSAJE ✂️

Hola — necesito coordinar con vos hoy una sesión de **~90-120 min** para hacer el **smoke E2E del cross-repo webhook v1**. Es la primera (y última) verificación end-to-end en prod live del flow inbound (Web → App) antes de que NoonApp esté lista para recibir leads reales del website.

**Contrato bajo test:** `docs/integrations/cross-repo-webhook-v1.md` (versión idéntica en ambos repos).

**No usamos dinero real** — test mode end-to-end. Para Scenarios 5/6/7 firmás un payload con `external_payment_id = pay_b13b_smoke_<n>` directamente, sin Stripe Live charge en tu lado.

### Lo que vamos a ejercer

| # | Scenario | Quién dispara | Esperado |
|---|---|---|---|
| 1 | `inbound-proposal` happy path | vos (NoonWeb) | HTTP 201 + lead/proposal creados en App |
| 2 | `inbound-proposal` retry idempotente | vos | HTTP 200 + `idempotent: true`, sin rows nuevas |
| 3a | Missing signature header | vos | HTTP 401 `WEBSITE_WEBHOOK_AUTH_FAILED` |
| 3b | Tampered signature | vos | HTTP 401 `WEBSITE_WEBHOOK_AUTH_FAILED` |
| 3c | Stale timestamp (>5 min) | vos | HTTP 401 `WEBSITE_WEBHOOK_AUTH_FAILED` |
| **3d** | **Missing timestamp header** | **vos** | **EXPECTED 401 per contrato, ACTUAL probable 201 por bug F-1. Documentamos.** |
| 4 | PM Approve → outbound a NoonWeb | yo (App) | NoonWeb loguea recepción 2xx |
| 5 | `payment-confirmed` happy path | vos | HTTP 201 + project activated |
| 6 | `payment-confirmed` retry idempotente | vos | HTTP 200 + `idempotent: true` |
| 7 | `payment-confirmed` pre-PM-approval | vos | HTTP 409 `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL` |

### Endpoints

**App-side** (target de tus POSTs):
```
https://nooncode-app-pi.vercel.app/api/integrations/website/inbound-proposal
https://nooncode-app-pi.vercel.app/api/integrations/website/payment-confirmed
```

**NoonWeb-side** (target del outbound del App en Scenario 4):
```
https://noon-main.vercel.app/api/integrations/noon-app/proposal-review-decision
```

### Pre-flight tuyo (necesario antes de empezar)

1. **Paridad HMAC secret.** Tu env var `NOON_WEBSITE_WEBHOOK_SECRET` en NoonWeb Production tiene que ser byte-idéntico al de NoonApp Production. Manera segura: **compará HASHES**, no cleartext. Corré:
   ```bash
   echo -n "$NOON_WEBSITE_WEBHOOK_SECRET" | sha256sum
   ```
   y pasame los primeros 8 chars hex del output. Yo confirmo si matchea mi lado.

2. **Tu tooling firma `signedPayload = "${timestamp}.${bodyText}"`** (punto literal entre timestamp y body), no solo `bodyText`. Verificá tu helper antes.

3. **Tu clock skew < 4 min**. `timedatectl status` o equivalente.

### Markers de test obligatorios (literal)

| Campo | Valor |
|---|---|
| `customer.email` | `b13b.smoke@nooncode.com` |
| `customer.name` | `B1.3b Smoke Test` |
| `customer.company` | `B1.3b Test Co` |
| `external_session_id` | `sess_b13b_smoke_001` (Scenario 7 usa `_002`) |
| `external_proposal_id` | `prop_b13b_smoke_001` (Scenario 7 usa `_002`) |
| `external_payment_id` | `pay_b13b_smoke_001` (Scenario 7 usa `_002`) |
| `proposal.title` | `Smoke test inbound proposal` |
| `proposal.body` | `Verificación cross-repo webhook v1.` |
| `proposal.amount` | `350` (USD, dólares no cents) |
| `proposal.currency` | `USD` |

### Payload Scenario 1 (`inbound-proposal` happy path)

```json
{
  "external_source": "noon_website",
  "external_session_id": "sess_b13b_smoke_001",
  "external_proposal_id": "prop_b13b_smoke_001",
  "customer": {
    "name": "B1.3b Smoke Test",
    "email": "b13b.smoke@nooncode.com",
    "company": "B1.3b Test Co"
  },
  "proposal": {
    "title": "Smoke test inbound proposal",
    "body": "Verificación cross-repo webhook v1.",
    "amount": 350,
    "currency": "USD"
  },
  "maxwell": {
    "summary": "Smoke test inbound — no real session"
  },
  "metadata": {
    "score": 80,
    "smoke": "b13b"
  }
}
```

### Payload Scenario 5 (`payment-confirmed` happy path, después de Scenario 4 aprobado)

```json
{
  "external_source": "noon_website",
  "external_session_id": "sess_b13b_smoke_001",
  "external_proposal_id": "prop_b13b_smoke_001",
  "external_payment_id": "pay_b13b_smoke_001",
  "maxwell": {},
  "handoff": {
    "summary": "Smoke test payment confirmation"
  },
  "payment": {
    "amount": 350,
    "currency": "USD",
    "provider": "stripe_test",
    "paid_at": "2026-05-18T20:30:00Z"
  },
  "metadata": {
    "smoke": "b13b"
  }
}
```

### Payload Scenario 7 (pre-PM-approval rejection)

Mismo payload que Scenario 5 pero con todos los external ids en `_002`. Antes tenés que disparar un `inbound-proposal` con `external_session_id: "sess_b13b_smoke_002"`, `external_proposal_id: "prop_b13b_smoke_002"` (yo NO lo apruebo del lado App) y luego mandar el `payment-confirmed` con `external_payment_id: "pay_b13b_smoke_002"`. Esperado HTTP 409.

### Cómo firmás cada request

```js
const secret = process.env.NOON_WEBSITE_WEBHOOK_SECRET
const timestamp = Math.floor(Date.now() / 1000).toString()
const body = JSON.stringify(payload)
const signature = crypto.createHmac('sha256', secret)
  .update(`${timestamp}.${body}`).digest('hex')

const headers = {
  'content-type': 'application/json',
  'x-noon-timestamp': timestamp,
  'x-noon-signature': `sha256=${signature}`,
}
```

### Casos especiales por scenario

- **3a** (missing signature): omitís `x-noon-signature` header, mantenés `x-noon-timestamp`. Body cualquier (idealmente Scenario 1 body con marker `_001`).
- **3b** (tampered signature): mandás `x-noon-signature: sha256=deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef`. Resto idéntico.
- **3c** (stale timestamp): poné `timestamp = Math.floor(Date.now() / 1000) - 600` (10 min atrás). Firmás con ese timestamp. Resto idéntico.
- **3d** (missing timestamp): omitís `x-noon-timestamp` header completamente, mandás `x-noon-signature` válido. Esperamos HTTP 201 (bug F-1 ya identificado). Es Security follow-up, no test fail.

### Protocolo de comunicación durante el smoke

Después de cada scenario:
1. Vos: mandás el HTTP status code + un excerpt corto del response body (sin firma).
2. Yo: corro queries Supabase y confirmo si DB matchea expected.
3. Avanzamos al siguiente solo si current PASS o FAIL documentado.

Si la response no es la esperada (excepto 3d que ya esperamos 201), pausamos antes de avanzar.

### Out-of-scope para vos

- Vos NO verificás nada del lado App (yo lo hago).
- Vos NO necesitás Stripe Live en NoonWeb.
- Vos NO ejecutás nada del lado NoonApp.

### Si sospechás compromise del secret

(Paste accidental, screenshot, terminal recording.) Parás el smoke YA y avisás. Rotamos coordinado y reagendamos.

---

### ✂️ FIN DEL MENSAJE ✂️

---

## 5. Tu checklist + queries por scenario

### 5.1 Preconditions del operador (antes de mandar §4)

| # | Item | Cómo verificar |
|---|---|---|
| 1 | Develop HEAD `f3626d9` en local | `git log --oneline -1` |
| 2 | Browser logueado como `admin@noon.app` en `https://nooncode-app-pi.vercel.app` | Cargar `/dashboard`, ver avatar de admin |
| 3 | Acceso Supabase Dashboard SQL Editor a `pdotsdahsrnnsoroxbfe` | Abrir tab → query test `SELECT NOW()` |
| 4 | Repo PUBLIC | `gh repo view nooncode-org/App-nooncode --json visibility` → `"PUBLIC"` |
| 5 | Baseline DB clean (no rows previas con marker) | Query baseline (ver §5.2) |

### 5.2 Query baseline (correr antes del smoke)

```sql
SELECT COUNT(*) AS link_count FROM website_inbound_links
 WHERE external_session_id LIKE 'sess_b13b_smoke_%';
-- Esperado: 0

SELECT COUNT(*) AS lead_count FROM leads
 WHERE email = 'b13b.smoke@nooncode.com';
-- Esperado: 0
```

### 5.3 Queries oracle por scenario

#### Scenario 1 verify (después de que dev NoonWeb confirme HTTP 201)

```sql
-- Esperado: 1 row, current_status='proposal_pending_review', external_payment_id IS NULL
SELECT id AS link_id, lead_id, proposal_id, current_status,
       external_session_id, external_proposal_id, external_payment_id,
       review_webhook_status, created_at
  FROM website_inbound_links
 WHERE external_session_id = 'sess_b13b_smoke_001';

-- Esperado: 1 row, status='proposal', source='website'
SELECT id, name, email, company, source, status, score, value, created_at
  FROM leads WHERE email = 'b13b.smoke@nooncode.com';

-- Esperado: 1 row, review_status='pending_review', status='draft' o 'sent', payment_status IS NULL
SELECT id, lead_id, title, amount, currency, review_status, status, payment_status, created_at
  FROM lead_proposals
 WHERE id = (SELECT proposal_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');
```

#### Scenario 2 verify (retry idempotente)

```sql
-- Esperado: same row id, no row nuevo
SELECT id, lead_id, proposal_id, current_status, created_at, updated_at
  FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001';

-- Esperado: 1
SELECT COUNT(*) AS total FROM website_inbound_links
 WHERE external_session_id = 'sess_b13b_smoke_001';
```

#### Scenarios 3a/3b/3c verify (Vercel logs, no DB)

```
Vercel Dashboard → Functions → buscar `inbound-proposal` runtime logs
Esperado: 3 entries `website.inbound_proposal.rejected` warn status 401, con 3 mensajes distintos:
- Missing webhook signature.
- Invalid webhook signature.
- Webhook timestamp is outside the allowed window.

NO pegar valor real del header x-noon-signature en evidence. Truncá: sha256=4a2b...REDACTED...c91f
```

#### Scenario 3d verify (bug F-1 evidence)

```sql
-- Por bug F-1, probablemente row creado HTTP 201 cuando contrato dice 401.
-- El dev NoonWeb debería usar un external_session_id distinto (sess_b13b_smoke_3d_001) para no chocar.
SELECT id, current_status, external_session_id, created_at
  FROM website_inbound_links
 WHERE external_session_id LIKE 'sess_b13b_smoke_3d_%'
 ORDER BY created_at DESC LIMIT 1;
```

Documentar ACTUAL behavior verbatim. **Si retorna 201 = bug F-1 evidenced en producción.**

#### Scenario 4 — TU acción (UI App-side)

1. Browser logueado `admin@noon.app` → `/dashboard/pm-queue`.
2. Localizar el lead/proposal de Scenario 1 (email `b13b.smoke@nooncode.com`, más reciente).
3. Click **Aprobar**.
4. Esperar response del browser (Network tab DevTools).

```sql
-- Esperado: review_status='approved', current_status='review_webhook_sent', review_webhook_status='sent'
SELECT lp.id, lp.review_status, lp.reviewed_at, lp.reviewer_id,
       wil.current_status, wil.review_webhook_status,
       wil.review_webhook_attempted_at, wil.review_webhook_sent_at,
       wil.review_webhook_error
  FROM lead_proposals lp
  JOIN website_inbound_links wil ON wil.proposal_id = lp.id
 WHERE wil.external_session_id = 'sess_b13b_smoke_001';
```

**Decisión crítica F-4:**
- `review_webhook_status='sent'` → env var OK, F-4 closed positively. Pingueá al dev NoonWeb que confirme recepción 2xx en su lado.
- `review_webhook_status='skipped'` → env var STILL empty. **STOP smoke.** Fix env var (vía CLI con `--token` o Dashboard UI con paste exacto). Re-execute Scenario 4.
- `review_webhook_status='failed'` con error message → URL incorrecta o NoonWeb endpoint con problema. Investigar.

#### Scenario 5 verify (después de payment-confirmed happy path)

```sql
-- Esperado: current_status='project_activated', external_payment_id, payment_confirmed_at, project_id populated
SELECT id, current_status, external_payment_id, payment_confirmed_at, project_id
  FROM website_inbound_links
 WHERE external_session_id = 'sess_b13b_smoke_001';

-- Esperado: payment_status='succeeded', paid_at populated
SELECT id, payment_status, paid_at FROM lead_proposals
 WHERE id = (SELECT proposal_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');

-- Esperado: 1 row, status='succeeded', external_payment_id matches
SELECT id, proposal_id, amount, currency, status, paid_at, metadata
  FROM payments
 WHERE metadata->>'external_payment_id' = 'pay_b13b_smoke_001';

-- Esperado: 1 row, payment_activated=true, source_proposal_id matches
SELECT id, source_proposal_id, name, status, payment_activated, created_at
  FROM projects
 WHERE id = (SELECT project_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');
```

**Q4 oracle (registrar verbatim, sin interpretar):**

```sql
SELECT we.id, we.account_id, we.amount, we.entry_type, we.reference_type, we.reference_id
  FROM wallet_ledger_entries we
 WHERE we.reference_id::text IN (
   SELECT proposal_id::text FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001'
   UNION ALL
   SELECT id::text FROM payments WHERE metadata->>'external_payment_id' = 'pay_b13b_smoke_001'
 );

SELECT id, proposal_id, amount, state, created_at FROM seller_fees
 WHERE proposal_id = (SELECT proposal_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');
```

Si retornan 0 rows → **expected** per contrato (inbound no genera seller_fees).
Si retornan rows → **finding nuevo**, registrar verbatim. NO bloquea continuación.

#### Scenario 6 verify (payment-confirmed retry idempotente)

```sql
SELECT COUNT(*) AS payments FROM payments WHERE metadata->>'external_payment_id' = 'pay_b13b_smoke_001';
SELECT COUNT(*) AS projects FROM projects WHERE id = (SELECT project_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');
-- Esperado en ambos: 1 (mismo row, no duplicate)
```

#### Scenario 7 verify (premature payment con `_002` markers)

```sql
-- Esperado: _002 sigue current_status='proposal_pending_review', NO transition a activated
SELECT id, current_status, external_payment_id, payment_confirmed_at, project_id
  FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_002';

-- Esperado: 0 rows
SELECT COUNT(*) AS rejected_payments FROM payments
 WHERE metadata->>'external_payment_id' = 'pay_b13b_smoke_002';
```

---

## 6. Reglas de captura de evidencia

**Security review §3 — MANDATORY, sin excepción.**

### MUST NOT pegar en evidence doc

| Item | Por qué |
|---|---|
| HMAC secret cleartext | Compromise event |
| `vercel env pull` output verbatim | Puede contener masked-but-shown secrets |
| Full `x-noon-signature` value paired con su `bodyText` | Permite replay attacks si F-1 unpatched |
| Stripe API keys, webhook secrets, `event.id` | Out-of-scope pero por hygiene |
| Authorization headers, cookies, bearer tokens | Sensitive |
| Internal emails ≠ `admin@noon.app` / `b13b.smoke@nooncode.com` | PII |
| Supabase service-role key / anon key | Critical secret |

### MAY pegar

| Item | Por qué |
|---|---|
| `requestId` values | Random, no oracle |
| `linkId`/`leadId`/`proposalId`/`projectId` UUIDs | RLS-protected |
| HTTP status codes | No risk |
| Error codes (`WEBSITE_WEBHOOK_AUTH_FAILED`, etc.) | Public per contract |
| ISO 8601 timestamps | No risk |
| Test markers (`sess_b13b_smoke_*`, etc.) | Designed for capture |
| Test customer payload (name/email/company markers) | No real PII |

### Si necesitás pegar header signature

Truncá: `sha256=4a2b...REDACTED...c91f` (8 primeros + 4 últimos hex chars). NUNCA pegar full value alongside `bodyText` literal.

### MUST INCLUDE (positive obligations)

- Sección "Security findings surfaced during smoke" con outcome de F-1 (Scenario 3d).
- Sección "Redaction discipline log" — declaración corta de que las reglas se aplicaron.
- Sección "Q4 oracle outcome" — lo que sea que pasó en Scenario 5 con wallet/seller_fees, verbatim.

---

## 7. Failure modes + decision points

### Catalogue de fallos posibles durante el smoke

| Síntoma | Causa probable | Action |
|---|---|---|
| Scenario 1 retorna 401 | HMAC secret divergence App↔Web | STOP. Rotar secret coordinado. Reagendar smoke. |
| Scenario 1 retorna 503 `INTEGRATION_ACTOR_NOT_FOUND` | No active admin/PM en App-side `user_profiles` | STOP. Verificar `SELECT id, role, is_active FROM user_profiles WHERE role IN ('admin','pm') AND is_active=true;`. Si está vacío, fix antes de continuar. |
| Scenario 1 retorna 429 | Rate limit (improbable — 120/min budget vs ~10 req total) | Esperar 60s. Re-fire. |
| Scenarios 3a/3b/3c retornan 201 (no 401) | Guard HMAC roto en producción | BLOCKED. Capturar verbatim. Iteración hija de patch. |
| Scenario 4 retorna `review_webhook_status='skipped'` | Env var `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` empty | STOP. Fix env var (CLI o Dashboard). Re-fire Scenario 4 only. |
| Scenario 4 retorna `review_webhook_status='failed'` | NoonWeb endpoint inaccesible o URL incorrecta | Verificar URL. Coordinar con dev NoonWeb. Re-fire. |
| Scenario 5 retorna 401 | Mismo HMAC issue que Scenario 1 | STOP, ya debería haberse detectado en Scenario 1. |
| Scenario 7 NO retorna 409 (acepta payment pre-PM-approval) | **BUG REAL bloqueante** del contrato §4.4 | BLOCKED. Capturar verbatim. Patch en iteración hija crítica. |
| Cualquier 500 | Server-side error | STOP. Capturar logs Vercel. Investigar antes de continuar. |
| Q4 wallet_ledger_entries rows aparecen | Inbound + activation está crediteando wallet inesperadamente | NO bloquea continuación. Registrar verbatim para FASE 3 follow-up. |

### Decisión: ¿cuándo declarar PARTIAL vs BLOCKED vs COMPLETE?

| Resultado | Verdict |
|---|---|
| 7/8 scenarios PASS (Scenario 3d FAIL-EXPECTED per F-1, ya declarado follow-up) + Q4 oracle registrado | **COMPLETE** |
| 1-2 scenarios fallan con failure mode identificado + iteración hija scoped | **PARTIAL** (lo cierra Validator) |
| Scenario 7 acepta pre-PM-approval payment / Scenarios 3a/b/c fallan / HMAC parity falla / 500 inexplicable | **BLOCKED** |

---

## 8. Post-smoke — cierre del flow

Una vez completado el smoke (sea cual sea el verdict):

### Tu acción operativa inmediata

1. **Re-flip repo a PRIVATE:**
   ```bash
   gh repo edit nooncode-org/App-nooncode --visibility private --accept-visibility-change-consequences
   ```
   Verificar:
   ```bash
   gh repo view nooncode-org/App-nooncode --json visibility
   # Esperado: {"visibility":"PRIVATE"}
   ```

2. **(Opcional) DB cleanup de test data.** Recomendación: dejar las rows (son grep-able por `external_session_id LIKE 'sess_b13b_smoke_%'` y sirven de traceability). Si querés limpiar:
   ```sql
   -- ORDER MATTERS por foreign keys
   DELETE FROM payments WHERE metadata->>'external_payment_id' LIKE 'pay_b13b_smoke_%';
   DELETE FROM projects WHERE id IN (SELECT project_id FROM website_inbound_links WHERE external_session_id LIKE 'sess_b13b_smoke_%' AND project_id IS NOT NULL);
   DELETE FROM website_inbound_links WHERE external_session_id LIKE 'sess_b13b_smoke_%';
   DELETE FROM lead_proposals WHERE lead_id IN (SELECT id FROM leads WHERE email = 'b13b.smoke@nooncode.com');
   DELETE FROM leads WHERE email = 'b13b.smoke@nooncode.com';
   ```

### Mi acción (yo lo hago automáticamente post-smoke)

3. **system-testing** crea `docs/validations/B1.3b inbound smoke 2026-05-18.md` con verdicts por scenario respetando redaction rules.
4. **system-docs** actualiza:
   - `docs/context/project.context.core.md` (Active risks + Closed-in-runtime)
   - `docs/context/project.context.history.md`
   - Roadmap (Desktop) §6 + §17
5. **system-validator** declara verdict COMPLETE/PARTIAL/BLOCKED.

### Próxima sesión (no hoy)

6. **Iteración hija `fase-1-b1-3c-hmac-timestamp-required-fix`** — patch del bug F-1 (~3 líneas + 1 unit test + redeploy). **BLOQUEA B1.5 pilot sign-off** hasta que se cierre.
7. **B1.5 pilot sign-off** — cierre operativo de FASE 1 cutover, requires:
   - B1.3b COMPLETE (esta iteración hoy)
   - F-1 patched
   - PITR verification (B1.4 §3.1 — Supabase Free plan, accepted-risk)
   - On-call list filled (B1.4 §8 — 3 TBD rows)

---

## 9. Referencias y trazabilidad

### Inputs autoritativos

- **Spec:** `specs/fase-1-b1-3b-inbound-smoke-cross-repo.md` (384 líneas, system-analysis output 2026-05-18)
- **Contrato wire-level:** `docs/integrations/cross-repo-webhook-v1.md` (481 líneas, v1)
- **Handoff de Execution (precursor):** `docs/handoffs/b1-3b-inbound-smoke-execution-package.md` (este doc lo absorbe; ese era el preliminar)
- **Predecesores B1.3a:** `docs/validations/B1.3a outbound smoke 2026-05-16.md`

### Outputs esperados

- **Evidence doc:** `docs/validations/B1.3b inbound smoke 2026-05-18.md` (system-testing lo crea)
- **Context update:** `docs/context/project.context.core.md` + `project.context.history.md` (system-docs)
- **Roadmap update:** `C:\Users\pbu50\Desktop\Noon App\roadmap\NoonApp Roadmap.md` §6 + §17 (system-docs)

### Iteración / chain del router

```
Modo: Infra-Deploy (variante validation release readiness)
Depth: FULL
Chain: Analysis → Infra → Security → [Execution Gate] → Testing → Docs → Validator → close
```

Status del chain HOY (2026-05-18):
- ✅ Analysis (spec emitted)
- ✅ Infra (READY-WITH-WARNINGS verdict)
- ✅ Security (GATE-OPEN-WITH-FOLLOW-UPS verdict)
- 🔄 **[Execution Gate]** ← acá estás
- ⏳ Testing
- ⏳ Docs
- ⏳ Validator

### Tasks activos relevantes

| # | Subject | Status |
|---|---|---|
| #6 | Re-flipear repo a PRIVATE post-smoke | pending |
| #10 | Execution Gate: ejecutar smoke E2E cross-repo | in_progress (acá) |
| #11 | system-testing: estructurar evidencia + verdicts | pending |
| #12 | system-docs: actualizar context + roadmap | pending |
| #13 | system-validator: COMPLETE/PARTIAL/BLOCKED | pending |
| #14 | Child iteration: fase-1-b1-3c HMAC timestamp required fix | pending |

---

## TL;DR — para ejecutar

1. Confirmá tus 4 preconditions (§5.1).
2. Copiá-pegá §4 al dev NoonWeb.
3. Esperá su confirmación (hash HMAC + signing format).
4. Cuando estén listos los dos, arrancamos. Yo asisto queries oracle scenario por scenario.
5. Post-smoke: re-flip a PRIVATE.

Cualquier cosa rara durante: pausamos, miramos §7 catalogue, decidimos.

Mis tasks (#11/12/13) las ejecuto yo automáticamente post-smoke con la evidencia que capturemos.
