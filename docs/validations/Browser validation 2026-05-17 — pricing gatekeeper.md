# Browser validation 2026-05-17 — Outbound proposal pricing gatekeeper (ADR-013)

**Iteration:** `fase-1-amount-non-editable-pricing-gatekeeper`
**ADR:** `docs/adrs/ADR-013-seller-fee-additive-pricing.md` (mergeado via PR #59 2026-05-17)
**Spec:** `specs/fase-1-amount-non-editable-pricing-gatekeeper.md` (mergeado via PR #59 2026-05-17)
**Implementation PR:** #60 — `feat(pricing): close outbound proposal-amount bypass via gatekeeper (ADR-013)` (branch `feature/fase-1-pricing-gatekeeper-chunk-1-schema`, commit `a0ac735`)
**Migration:** `supabase/migrations/0047_phase_19a_proposal_pricing_context.sql` (aplicada a `pdotsdahsrnnsoroxbfe` el 2026-05-17 via Supabase Dashboard SQL Editor; G7 desync continúa — no registrada en `supabase_migrations.schema_migrations`).
**Environment:** producción `https://nooncode-app-pi.vercel.app` (Vercel deploy disparado vía Deploy Hook tras merge de PR #60; auto-deploys de Vercel siguen rotos — G11). Modo `supabase` contra el proyecto productivo `pdotsdahsrnnsoroxbfe`.

---

## Setup

- Deploy verificado vía `GET /` → HTTP 200 y `POST /api/leads/<uuid>/proposals` → HTTP 401 (esperado, falta auth).
- Migration 0047 verificada en Table Editor: `lead_proposals.project_type` y `lead_proposals.complexity` presentes (ambos `text`, nullable).
- Tester: operator (Pedro) loggeado como seller en una ventana incógnito.
- SQL editor abierto en paralelo en Supabase Dashboard para validar cada paso.

---

## Scenarios

### Scenario 1 — Crear lead outbound

**Setup:** Form `Nuevo lead` desde `/dashboard/leads`.

**Steps:**
1. Llenar form con `lead_origin = outbound`.
2. Guardar.

**SQL verify:**
```sql
select id, name, lead_origin, assigned_to, created_at
from public.leads
where name = 'Pricing Test 2026-05-17'
order by created_at desc limit 1;
```

**Observed:** Row creada con `lead_origin = 'outbound'` y `assigned_to` poblado correctamente.

**Verdict:** **PASS**.

---

### Scenario 2 — UI del form de propuesta (cambios visibles)

**Steps:**
1. Abrir el lead → bloque `Registrar propuesta comercial`.

**Observed UI (post-fix):**

| Campo | Estado observado | Esperado |
|---|---|---|
| Título | Input editable | ✓ |
| **Tipo de proyecto** | Dropdown con 5 opciones (landing / ecommerce / webapp / mobile / saas_ai) | ✓ NUEVO |
| **Complejidad** | Dropdown con 3 opciones (low / medium / high) | ✓ NUEVO |
| Tu comisión (seller fee) | Dropdown $100/$300/$500 | ✓ |
| Bloque "Total al cliente" | Aparece cuando ambos dropdowns elegidos; muestra `Base + Comisión + Total` con copy `No editable.` | ✓ NUEVO |
| Placeholder cuando dropdowns vacíos | Border-dashed con texto `Selecciona tipo de proyecto y complejidad para calcular el monto final.` | ✓ NUEVO |
| `Monto estimado` input editable | **DESAPARECIDO** para outbound | ✓ (eliminación esperada) |
| Contenido (textarea) | Editable | ✓ |
| Botón `Guardar propuesta` | Deshabilitado mientras los dropdowns estén vacíos; habilitado al elegir ambos + título + body | ✓ |

**Verdict:** **PASS — UI cambió como ADR-013 § Decision 1 lo prescribe**.

---

### Scenario 3 — Combinaciones de la matriz (cálculo del Total)

**Steps:** Jugar con combinaciones sin guardar; verificar el bloque `Total al cliente` computado live.

| ProjectType | Complexity | sellerFee | Base esperado | Total esperado | Observado |
|---|---|---|---|---|---|
| Landing | Bajo | $100 | $49 | **$149** | $149 ✓ |
| Landing | Alto | $300 | $129 | **$429** | $429 ✓ |
| Web App | Medio | $500 | $179 | **$679** | $679 ✓ |
| SaaS/AI | Alto | $500 | $349 | **$849** | $849 ✓ |
| E-commerce | Medio | $100 | $129 | **$229** | $229 ✓ |

Todas las combinaciones probadas matchean `computePricing(projectType, complexity, 'outbound', sellerFee).activationFinal`.

**Verdict:** **PASS — UI consume `computePricing()` en tiempo real correctamente**.

---

### Scenario 4 — Guardar propuesta + persistencia de matriz coords

**Steps:**
1. Elegir `Landing` + `Bajo` + `$100` (la combinación mínima, total $149).
2. Llenar título y body.
3. Click `Guardar propuesta`.

**Observed UI:** Toast "Propuesta guardada"; propuesta aparece en la lista debajo con badge `pending_review`.

**SQL verify (lead_proposals):**
```sql
select id, title, amount, project_type, complexity, status, review_status, lead_id
from public.lead_proposals
where lead_id = '<uuid-paso-1>'
order by created_at desc limit 1;
```

**Observed:**
- `amount = 149` ✓ (no $1000 del valor estimado, no $0, no arbitrario)
- `project_type = 'landing'` ✓
- `complexity = 'low'` ✓
- `status = 'draft'` ✓
- `review_status = 'pending_review'` ✓

**SQL verify (seller_fees):**
```sql
select id, proposal_id, amount, state
from public.seller_fees
where proposal_id = '<uuid-proposal>'
limit 1;
```

**Observed:**
- `amount = 100` ✓ (el seller fee elegido)
- `state = 'potential'` ✓ (B3 state machine, correcto antes del pago)

**Verdict:** **PASS — proposal y seller_fees persisten coherentemente con la matriz**.

---

### Scenario 5 — Server-side guardrail (bypass attempt via DevTools fetch)

**Steps:** DevTools Console en la misma sesión autenticada:

```javascript
fetch('/api/leads/<lead-uuid>/proposals', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Bypass test',
    body: 'Trying to set amount=1 manually',
    amount: 1,
    currency: 'USD',
    status: 'draft',
    sellerFeeAmount: 100,
    projectType: 'landing',
    complexity: 'low',
  }),
}).then(r => r.json()).then(console.log)
```

**Observed:**
```json
{
  "error": "Outbound proposal amount ($1) does not match the canonical activation total ($149) for projectType=landing, complexity=low, sellerFee=100. The activation amount must come from the pricing matrix (lib/maxwell/pricing.ts).",
  "code": "PROPOSAL_AMOUNT_PRICING_MISMATCH"
}
```

HTTP 422.

**Verdict:** **PASS — el validator server-side rechaza el bypass como ADR-013 prescribe**. El payload con dropdowns válidos pero amount manipulado **no** persiste.

---

## Summary

| Scenario | Verdict |
|---|---|
| 1. Crear lead outbound | PASS |
| 2. UI cambios visibles (dropdowns, bloque total, input gone) | PASS |
| 3. Combinaciones matriz (cálculo correcto) | PASS |
| 4. Guardar + persistencia matriz coords | PASS |
| 5. Server-side guardrail (bypass attempt rejected) | PASS |

**5/5 PASS.** Iteration `fase-1-amount-non-editable-pricing-gatekeeper` validated end-to-end. ADR-013 § Decision 1 enforced both client-side (dropdowns + computed total + disabled save) and server-side (validator + 422 on mismatch).

---

## Out-of-scope (not exercised in this validation)

- **Maxwell tool integration (`create_proposal` con nuevos fields).** El tool acepta `projectType` + `complexity` y persiste vía el mismo path de inserción. Validable con un chat Maxwell real (`/api/maxwell` con `leadId`); deferred — el riesgo es bajo porque el path usa la misma DB insert con campos validados.
- **Webhook split end-to-end con un pago real.** Cualquier pago futuro (B1.3a-style) ahora va a procesar `amount = activationFinal` y splittear `base = amount - sellerFee = activationBase` correctamente. No re-ejercido aquí; cubierto por los 5 unit tests del webhook + 45 unit tests del validator + 14 unit tests del seller_fee state machine.
- **Refund con state machine reversal.** Path D refund endpoint (PR #55/#56) sigue funcional; sin cambios por este PR.
- **Legacy outbound proposals (pre-0047).** El validator hace skip cuando los campos son nulos; runbook §5.14 captura el behavior. No-op test.

---

## Cleanup (optional)

Si querés borrar el lead + propuesta de test:

```sql
-- 1. Borrar seller_fees rows
delete from public.seller_fees
where proposal_id in (
  select id from public.lead_proposals
  where lead_id = '<uuid-del-lead-test>'
);

-- 2. Borrar propuestas
delete from public.lead_proposals
where lead_id = '<uuid-del-lead-test>';

-- 3. Borrar el lead
delete from public.leads
where id = '<uuid-del-lead-test>';
```

Reemplazá `<uuid-del-lead-test>` por el UUID que obtuviste en Scenario 1. Los borrados son secuenciales (FK constraints).

Alternativa: dejar el lead como histórico de validación. No molesta porque no es un lead real y no impacta métricas operacionales.
