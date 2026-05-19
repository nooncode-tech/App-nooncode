# B1.3b — Inbound smoke E2E cross-repo · paquete de Execution

**Fecha:** 2026-05-18
**Iteración:** `fase-1-b1-3b-inbound-smoke-cross-repo`
**Spec autoritativo:** `specs/fase-1-b1-3b-inbound-smoke-cross-repo.md`
**Contrato wire-level:** `docs/integrations/cross-repo-webhook-v1.md`
**Verdict pre-smoke:** GATE-OPEN-WITH-FOLLOW-UPS (system-security 2026-05-18)
**Smoke ejecutado entre:** Pedro (App side) ↔ dev NoonWeb (Web side)

---

## 0. Antes de arrancar — preconditions del operador (Pedro)

Ninguna de estas se ejecuta hasta que las cuatro estén ✅:

| # | Item | Cómo |
|---|---|---|
| 0.1 | F-4 cerrado: `NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL` correcto en Vercel | Dashboard UI: Settings → Environment Variables → click row → "Show" muestra `https://noon-main.vercel.app/api/integrations/noon-app/proposal-review-decision`. Redeploy auto del cambio Ready. |
| 0.2 | Repo todavía PUBLIC (precondition Vercel GitHub App) | `gh repo view nooncode-org/App-nooncode --json visibility` → `"PUBLIC"`. (Re-flip a PRIVATE post-smoke per task #6.) |
| 0.3 | Browser logueado como `admin@noon.app` en `https://nooncode-app-pi.vercel.app` | Necesario para Scenario 4 (PM Approve action). |
| 0.4 | Acceso a Supabase Dashboard SQL Editor para `pdotsdahsrnnsoroxbfe` | Necesario para todas las oracle queries de cada scenario. |

---

## 1. Mensaje a mandarle al dev NoonWeb

> Copiá-pegá esta sección en el canal directo (Slack/WhatsApp/email) que uses con el dev de NoonWeb. La sección está autocontenida — no necesita context externo.

---

### ✂️ Inicio del mensaje al dev NoonWeb ✂️

Hola — necesito coordinar con vos hoy una sesión de ~3h para hacer el **smoke E2E del cross-repo webhook v1**. Es la primera (y última) verificación end-to-end en prod live del flow inbound (Web → App) antes de que NoonApp esté operacionalmente lista para recibir leads reales del website.

**Contrato bajo test:** `docs/integrations/cross-repo-webhook-v1.md` (versión idéntica en ambos repos).

**Lo que vamos a ejercer:**

| # | Scenario | Quién dispara | Qué espera |
|---|---|---|---|
| 1 | `inbound-proposal` happy path | vos (NoonWeb) | HTTP 201 + lead/proposal creados en App |
| 2 | `inbound-proposal` idempotent retry | vos | HTTP 200 + `idempotent: true`, no rows nuevas |
| 3a | Missing signature header | vos | HTTP 401 `WEBSITE_WEBHOOK_AUTH_FAILED` |
| 3b | Tampered signature | vos | HTTP 401 `WEBSITE_WEBHOOK_AUTH_FAILED` |
| 3c | Stale timestamp (>5 min) | vos | HTTP 401 `WEBSITE_WEBHOOK_AUTH_FAILED` |
| **3d** | **Missing timestamp header (NEW per Security review)** | **vos** | **EXPECTED: 401. ACTUAL: 201 (bug F-1 confirmado). Documentamos behavior real.** |
| 4 | App PM approve → outbound `proposal-review-decision` a NoonWeb | yo (App) | NoonWeb receiver loguea recepción 2xx, App marca `review_webhook_status='sent'` |
| 5 | `payment-confirmed` happy path | vos | HTTP 201 + project activated |
| 6 | `payment-confirmed` idempotent retry | vos | HTTP 200 + `idempotent: true` |
| 7 | `payment-confirmed` pre-PM-approval (debe rechazar) | vos | HTTP 409 `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL` |

**No usamos dinero real** (test mode, sin Stripe Live charge en tu lado). Para scenarios 5/6/7 firmás un payload con `external_payment_id = pay_b13b_smoke_<n>` directamente — no hace falta una Checkout Session real.

**Endpoint App-side** (target de tus POSTs):
```
https://nooncode-app-pi.vercel.app/api/integrations/website/inbound-proposal
https://nooncode-app-pi.vercel.app/api/integrations/website/payment-confirmed
```

**Endpoint NoonWeb-side** (target del outbound del App en Scenario 4):
```
https://noon-main.vercel.app/api/integrations/noon-app/proposal-review-decision
```

### Pre-flight tuyo (necesario antes de empezar)

1. **Confirmar paridad del HMAC secret.** Tu env var `NOON_WEBSITE_WEBHOOK_SECRET` en NoonWeb Production tiene que ser byte-idéntico al de NoonApp Production. Manera segura: comparar HASHES, NO el cleartext. Corré `echo -n "$NOON_WEBSITE_WEBHOOK_SECRET" | sha256sum` de tu lado y mandame el output (primeros 8 chars hex sirven). Si no matchea con el mío, hay que rotar coordinado antes del smoke.

2. **Tu tooling de firma genera `signedPayload = "${timestamp}.${bodyText}"`** (con punto literal entre timestamp y body), no solo `bodyText`. Esto es §2.1 del contrato — verificá tu helper de signing antes.

3. **Tu workstation tiene clock skew razonable.** Si tu reloj está más de 4 min off, los signed requests fallan 401 stale (peor de los casos). `timedatectl status` o equivalente.

### Markers de test que tenés que usar (literal — yo filtro DB por estos)

| Campo | Valor |
|---|---|
| `customer.email` | `b13b.smoke@nooncode.com` |
| `customer.name` | `B1.3b Smoke Test` |
| `customer.company` | `B1.3b Test Co` |
| `external_session_id` | `sess_b13b_smoke_001` (incrementá `_002`, `_003` para Scenarios que necesitan sesiones distintas — Scenario 7 necesita una segunda sesión pending review) |
| `external_proposal_id` | `prop_b13b_smoke_001` (paralelo a session id) |
| `external_payment_id` | `pay_b13b_smoke_001` (Scenarios 5+6+7) |
| `proposal.title` | `Smoke test inbound proposal` |
| `proposal.body` | `Verificación cross-repo webhook v1.` |
| `proposal.amount` | `350` (USD, dólares no cents) |
| `proposal.currency` | `USD` |

### Payload templates verbatim

#### Scenario 1 — `inbound-proposal` happy path

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

#### Scenario 5 — `payment-confirmed` happy path (después de Scenario 4 aprobado)

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

#### Scenario 7 — pre-PM-approval rejection

Mismo payload que Scenario 5 pero con `external_session_id: "sess_b13b_smoke_002"` y `external_proposal_id: "prop_b13b_smoke_002"` y `external_payment_id: "pay_b13b_smoke_002"`. Antes necesitás disparar un `inbound-proposal` con esos nuevos external_ids (ver setup en spec). NO lo apruebo del lado App. Esperado 409.

### Cómo firmás cada request (ya lo sabés, pero conviene verbatim)

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

- **Scenario 3a** (missing signature): omitís `x-noon-signature` header, mantenés `x-noon-timestamp`. Body cualquiera (idealmente Scenario 1 body con marker `_001`).
- **Scenario 3b** (tampered signature): mandás `x-noon-signature: sha256=deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef0000deadbeef`. Resto idéntico.
- **Scenario 3c** (stale timestamp): poné `timestamp = Math.floor(Date.now() / 1000) - 600` (10 min atrás). Firmás con ese timestamp pero el resto idéntico.
- **Scenario 3d (NEW)** (missing timestamp): omitís `x-noon-timestamp` header completamente, mandás `x-noon-signature` válido. **NOTA**: por bug F-1 ya identificado, esperamos que App acepte HTTP 201 (vs 401 esperado por contrato). Documentamos lo que pase. Es Security follow-up, no test fail.

### Protocolo de comunicación durante el smoke

Después de cada scenario:
1. Vos: mandás el HTTP status code + un excerpt corto del response body (el `data.linkId` / `data.idempotent` / mensaje de error). NO me mandes la firma HMAC ni el body firmado.
2. Yo: corro la query Supabase de oracle y te confirmo si DB matchea expected.
3. Avanzamos al siguiente scenario solo si current PASS o FAIL identificado y documentado.

Si en algún scenario la response no es la esperada (NO el caso del Scenario 3d, que ya esperamos 201), pausamos antes de avanzar para evitar contaminar evidence.

### Out-of-scope para vos

- Vos NO necesitás verificar nada del lado App (yo lo hago).
- Vos NO necesitás levantar Stripe en NoonWeb (test mode = no charge real).
- Vos NO ejecutás nada del lado NoonApp.

### Communicación de fallback

Si en algún momento sospechás que el HMAC secret se filtró (paste accidental, screenshot, terminal recording), parás el smoke YA y avisamos. Rotamos secreto coordinado y reagendamos.

---

### ✂️ Fin del mensaje al dev NoonWeb ✂️

---

## 2. Tu (Pedro) checklist del smoke

### 2.1 Pre-flight (antes de enviar mensaje a NoonWeb dev)

- [ ] Preconditions 0.1-0.4 ✅
- [ ] `git log --oneline -3 origin/develop` muestra `f3626d9` como HEAD.
- [ ] `vercel ls` muestra deploy más reciente como Ready.
- [ ] Test query baseline (debe retornar 0 rows):
  ```sql
  SELECT COUNT(*) AS link_count FROM website_inbound_links
   WHERE external_session_id LIKE 'sess_b13b_smoke_%';
  SELECT COUNT(*) AS lead_count FROM leads
   WHERE email = 'b13b.smoke@nooncode.com';
  ```

### 2.2 Durante el smoke — queries oracle por scenario

#### Scenario 1 verify (después de que el dev confirme HTTP 201)

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

-- Esperado: 1 row, review_status='pending_review', status='draft'/'sent', payment_status IS NULL
SELECT id, lead_id, title, amount, currency, review_status, status, payment_status, created_at
  FROM lead_proposals
 WHERE id = (SELECT proposal_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');
```

#### Scenario 2 verify (después de retry idempotente)

```sql
-- Esperado: SAME row id que Scenario 1, NO row nuevo, updated_at puede haber cambiado
SELECT id AS link_id, lead_id, proposal_id, current_status, created_at, updated_at
  FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001';

SELECT COUNT(*) AS total_links FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001';
-- Esperado: 1 (no se creó row nuevo).
```

#### Scenarios 3a/3b/3c verify

```
Vercel Dashboard → Functions → buscar `inbound-proposal` runtime logs
Buscar 3 entries `website.inbound_proposal.rejected` warn con status: 401
y 3 codes distintos en el error message (Missing webhook signature / Invalid webhook signature / outside the allowed window).
```

NO pegar el `x-noon-signature` header value real. Redactá con `sha256=4a2b...REDACTED...c91f`.

#### Scenario 3d verify (Security follow-up — bug confirmado)

```sql
-- Si Scenario 3d returned 201 (per bug F-1), debería haber row nuevo con external_session_id distinto
SELECT id, current_status, external_session_id, created_at
  FROM website_inbound_links
 WHERE external_session_id LIKE 'sess_b13b_smoke_3d_%'
 ORDER BY created_at DESC LIMIT 1;
```

Documentar verbatim ACTUAL behavior. Esperado per código: row creado HTTP 201. Esperado per contrato: 401 rejection. **Discrepancia = evidence del bug F-1.**

#### Scenario 4 — Pedro action (App-side)

1. En el browser logueado como `admin@noon.app`, ir a `/dashboard/pm-queue`.
2. Localizar el lead/proposal de Scenario 1 (debería ser el más reciente con email `b13b.smoke@nooncode.com`).
3. Click **Aprobar** (o el botón equivalente).
4. Esperar respuesta HTTP del browser (Network tab DevTools).

```sql
-- Esperado post-approve: review_status='approved', reviewed_at populated, current_status='review_webhook_sent', review_webhook_status='sent'
SELECT lp.id, lp.review_status, lp.reviewed_at, lp.reviewer_id,
       wil.current_status, wil.review_webhook_status, wil.review_webhook_attempted_at, wil.review_webhook_sent_at, wil.review_webhook_error
  FROM lead_proposals lp
  JOIN website_inbound_links wil ON wil.proposal_id = lp.id
 WHERE wil.external_session_id = 'sess_b13b_smoke_001';
```

Después de la query, **pingear al dev NoonWeb** que confirme en su lado: ¿recibieron el POST a `https://noon-main.vercel.app/...`? ¿Qué request id loguearon? Si no recibieron → bug en outbound (registramos como finding).

#### Scenario 5 verify (después de payment-confirmed happy path)

```sql
-- Esperado: current_status='project_activated', external_payment_id, payment_confirmed_at, project_id populated
SELECT id, current_status, external_payment_id, payment_confirmed_at, project_id
  FROM website_inbound_links
 WHERE external_session_id = 'sess_b13b_smoke_001';

-- Esperado: 1 row, payment_status='succeeded', paid_at populated
SELECT id, payment_status, paid_at FROM lead_proposals
 WHERE id = (SELECT proposal_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');

-- Esperado: 1 row, status='succeeded', external_payment_id matches
SELECT id, proposal_id, amount, currency, status, paid_at, metadata
  FROM payments
 WHERE metadata->>'external_payment_id' = 'pay_b13b_smoke_001';

-- Esperado: 1 row, status='backlog' o similar per contrato, payment_activated=true, source_proposal_id matches
SELECT id, source_proposal_id, name, status, payment_activated, created_at
  FROM projects
 WHERE id = (SELECT project_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');
```

**Q4 spec — registrar verbatim (oracle abierto):**
```sql
-- ¿Hay wallet_ledger_entries para este proposal? ¿O seller_fees row?
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

Anotar lo que pase. NO interpretarlo en el momento — sin importar resultado, system-testing lo procesa después.

#### Scenario 6 verify (después de payment-confirmed retry idempotente)

```sql
SELECT COUNT(*) AS total_payments FROM payments WHERE metadata->>'external_payment_id' = 'pay_b13b_smoke_001';
SELECT COUNT(*) AS total_projects FROM projects WHERE id = (SELECT project_id FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_001');
-- Esperado en ambos: 1 (mismo row de Scenario 5, no duplicate)
```

#### Scenario 7 verify (después de premature payment con `_002` markers)

```sql
-- Esperado: link _002 sigue current_status='proposal_pending_review', NO transition a 'project_activated'
SELECT id, current_status, external_payment_id, payment_confirmed_at, project_id
  FROM website_inbound_links WHERE external_session_id = 'sess_b13b_smoke_002';

-- Esperado: 0 rows en payments para `pay_b13b_smoke_002`
SELECT COUNT(*) AS rejected_payments FROM payments WHERE metadata->>'external_payment_id' = 'pay_b13b_smoke_002';
```

### 2.3 Reglas de captura de evidencia (Security §3 — MANDATORY)

| MUST NOT pegar | MAY pegar |
|---|---|
| HMAC secret values (cleartext) | `requestId` (random) |
| `vercel env pull` output verbatim | `linkId`/`leadId`/`proposalId`/`projectId` UUIDs |
| Full `x-noon-signature` header value when paired con `bodyText` | HTTP status codes |
| Stripe keys / `event.id` (si aparecen accidentalmente) | Error codes (`WEBSITE_WEBHOOK_AUTH_FAILED`, etc.) |
| Authorization headers, cookies, bearer tokens | Timestamps ISO 8601 |
| Internal emails distintos de `admin@noon.app` / `b13b.smoke@nooncode.com` | `external_session_id`/`external_proposal_id`/`external_payment_id` con marker |
| Supabase service-role key / anon key | Test customer payload (name/email/company markers) |

**Si necesitás pegar header signature value:** truncá `sha256=4a2b...REDACTED...c91f` (8 primeros + 4 últimos hex chars).

### 2.4 Post-smoke cleanup

- [ ] Documentar verdict por scenario en `docs/validations/B1.3b inbound smoke 2026-05-18.md` (lo arma system-testing después con tu evidencia).
- [ ] Decidir: ¿Dejamos test rows en DB con markers (traceability) o cleanup? Recomendación: dejar, son grep-able por `external_session_id LIKE 'sess_b13b_smoke_%'`.
- [ ] Re-flip repo a PRIVATE (task #6) — `gh repo edit nooncode-org/App-nooncode --visibility private --accept-visibility-change-consequences`.
- [ ] Spec child iteration `fase-1-b1-3c-hmac-timestamp-required-fix` (task #14) — opcional ahora o en próxima sesión, pero antes de B1.5.

---

## 3. Communication protocol durante el smoke

| Quién dice | Cuándo | Qué dice |
|---|---|---|
| Dev NoonWeb | después de cada scenario response | HTTP status code + corte corto del body (no firma) |
| Pedro | después de cada response | "ok corro queries", luego "PASS / FAIL motivo" |
| Pedro | post-Scenario-4 approve | "fired" + pings dev NoonWeb para confirmar recepción |
| Cualquiera | si algo se ve raro | "PAUSE — ver mensaje arriba" antes de avanzar |

Tiempo estimado total: **~90-120 min** con dev NoonWeb online en paralelo. Más rápido si ambos están bien sincronizados; más lento si hay debug en HMAC parity o si Scenario 3d se demora en mintear payload sin timestamp.

---

## 4. Verdicts esperados por scenario

| # | Verdict esperado | Evidence requerida |
|---|---|---|
| 1 | PASS | HTTP 201 + DB row creado |
| 2 | PASS | HTTP 200 + `idempotent: true` + no row nuevo |
| 3a | PASS | HTTP 401 con `WEBSITE_WEBHOOK_AUTH_FAILED` |
| 3b | PASS | HTTP 401 con `WEBSITE_WEBHOOK_AUTH_FAILED` |
| 3c | PASS | HTTP 401 con `WEBSITE_WEBHOOK_AUTH_FAILED` (timestamp outside window) |
| 3d | **FAIL-EXPECTED** | HTTP 201 (bug F-1 evidenced) — documentar verbatim |
| 4 | PASS | DB shows review_webhook_status='sent' + dev NoonWeb confirma recepción 2xx |
| 5 | PASS | HTTP 201 + project activated. Q4 oracle resultado registrado verbatim. |
| 6 | PASS | HTTP 200 + `idempotent: true` + no duplicates |
| 7 | PASS | HTTP 409 `INBOUND_PAYMENT_REQUIRES_PM_APPROVAL` |

---

## 5. Si algo falla

Catalogue de failure modes (tomado de `docs/runbooks/cutover-pilot.md` adaptado a inbound):

- **All scenarios 401:** HMAC secret divergence (assumption A1 falló). PARAR. Coordinar rotación.
- **Scenario 4 outbound timeout:** NoonWeb endpoint inaccesible o env var con typo. PAUSAR Scenario 5+. Verificar F-4 manual otra vez.
- **Scenario 5 surfaces wallet writes inesperados:** Q4 finding. NO bloquea continuación; registrar verbatim.
- **Scenario 7 NO retorna 409 (acepta payment):** BUG REAL bloqueante. PARAR, registrar como BLOCKED. Iteration hija de patch.
- **Cualquier 500:** PARAR. Capturar logs Vercel, registrar como BLOCKED.

---

## 6. Referencias

- Spec: `specs/fase-1-b1-3b-inbound-smoke-cross-repo.md`
- Contrato: `docs/integrations/cross-repo-webhook-v1.md`
- Validation doc target: `docs/validations/B1.3b inbound smoke 2026-05-18.md` (lo creará system-testing)
- Security review: filed in agent session 2026-05-18 (resumen en este handoff §1 nota sobre Scenario 3d upgrade)
- Predecesores: `docs/validations/B1.3a outbound smoke 2026-05-16.md`
