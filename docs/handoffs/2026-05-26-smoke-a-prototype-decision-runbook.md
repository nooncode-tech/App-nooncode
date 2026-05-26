# Smoke A — prototype-decision endpoint verification runbook (2026-05-26)

> **Propósito:** verificar PR #110 (B+C slice ADR-023 implementation) end-to-end contra ambiente real, sin depender de NoonWeb D-slice. Usa el script `2026-05-26-smoke-a-prototype-decision-fire.mjs` para firmar payloads HMAC y POSTear al endpoint nuevo. Verificación de side-effects vía queries Supabase.
>
> **Naturaleza:** smoke test unilateral. Patrón heredado de B1.3b (`b1-3b-noonweb-fire-script.mjs`). NO requiere coordinación NoonWeb-dev; el contract es bit-identical al firmado en `docs/integrations/cross-repo-webhook-v1.md` §5.
>
> **Cuándo correr:**
> - Pre-merge: contra Vercel preview deployment de PR #110 (URL típicamente `https://nooncode-app-pr-110.vercel.app`).
> - Post-merge: contra producción (default `APP_BASE`).
>
> **Coste de ejecución:** ~10-15 min para los 7 scenarios + verificación Supabase manual entre 5/7.

---

## §0. Pre-flight

### 0.1 Confirmar el target deployment

```sh
curl -s -o /dev/null -w "%{http_code}\n" "$APP_BASE/api/integrations/website/prototype-decision" -X POST
# Esperado: 401 (sin HMAC) o similar — confirma que la ruta existe.
```

### 0.2 Confirmar migration 0060 aplicada al target Supabase

Producción ya tiene la migration aplicada (ledger row `20260525195022`). Si target es un Supabase branch separado (preview environment con branch DB), confirmar primero:

```sql
select count(*) from public.prototype_decisions;
-- 0 (tabla existe pero vacía)

select max_iterations_per_lead from public.prototype_credit_settings;
-- 3

select count(*) from supabase_migrations.schema_migrations where name = 'phase_23a_prototype_decisions';
-- 1
```

### 0.3 Acceso a Supabase MCP o Dashboard SQL Editor

Necesario para crear fixtures (§1) y verificar side-effects (§3). Si MCP no está disponible, usar Dashboard SQL Editor directamente.

---

## §1. Crear los dos fixtures

Necesitamos 2 leads + 2 prototype_workspaces (uno para reject scenarios, uno para accept scenarios). Los share_tokens se generan por la RPC `request_lead_prototype`.

> **Importante:** estos fixtures son test data en producción. Limpieza en §4 al final.

### 1.1 Crear los dos leads de smoke

```sql
-- Reemplazar <SELLER_PROFILE_ID> con el profile_id de un seller activo.
-- Esto se puede obtener con: select id, role from public.profiles where role='sales' limit 1;

with seller as (
  select id from public.profiles where role = 'sales' limit 1
)
insert into public.leads (id, name, source, current_stage, status, owner_profile_id, created_at, updated_at)
select gen_random_uuid(), 'SMOKE-A REJECT fixture', 'smoke_test', 'sales', 'new', seller.id, now(), now()
from seller
returning id, name;
-- Guardar el id retornado como SMOKE_REJECT_LEAD_ID.

with seller as (
  select id from public.profiles where role = 'sales' limit 1
)
insert into public.leads (id, name, source, current_stage, status, owner_profile_id, created_at, updated_at)
select gen_random_uuid(), 'SMOKE-A ACCEPT fixture', 'smoke_test', 'sales', 'new', seller.id, now(), now()
from seller
returning id, name;
-- Guardar el id retornado como SMOKE_ACCEPT_LEAD_ID.
```

### 1.2 Confirmar wallet de credits del seller (Gate A)

La RPC `request_lead_prototype` cobra `prototype_credit_settings.request_cost` (1 credit). Confirmar saldo:

```sql
select wa.available_balance, pcs.request_cost
  from public.wallet_accounts wa
  cross join public.prototype_credit_settings pcs
 where wa.profile_id = (select id from public.profiles where role = 'sales' limit 1)
   and wa.bucket = 'credits';
-- available_balance debe ser >= 2 (vamos a llamar la RPC dos veces).
```

Si el seller no tiene credits, top-up via:

```sql
-- Reemplazar <SELLER_PROFILE_ID> y agregar 10 credits para holgura.
select public.credit_wallet_bucket(
  '<SELLER_PROFILE_ID>'::uuid,
  10,
  'credits',
  'manual_credit',
  'smoke_a',
  'smoke_a_topup_2026_05_26',
  null,
  'admin',
  jsonb_build_object('reason', 'smoke A topup'),
  'smoke_a_topup_2026_05_26'
);
```

### 1.3 Generar los dos workspaces vía RPC

```sql
-- Workspace para REJECT scenarios
select * from public.request_lead_prototype('<SMOKE_REJECT_LEAD_ID>'::uuid);
-- Retorna prototype_workspace_id + share_token. Anotar como
-- SMOKE_REJECT_WORKSPACE_ID + SMOKE_REJECT_TOKEN.

-- Workspace para ACCEPT scenarios
select * from public.request_lead_prototype('<SMOKE_ACCEPT_LEAD_ID>'::uuid);
-- Anotar como SMOKE_ACCEPT_WORKSPACE_ID + SMOKE_ACCEPT_TOKEN.
```

Alternativamente, leer los tokens directamente:

```sql
select id, lead_id, share_token, status
  from public.prototype_workspaces
 where lead_id in ('<SMOKE_REJECT_LEAD_ID>', '<SMOKE_ACCEPT_LEAD_ID>');
```

### 1.4 Verificar Gate B no se dispara (cap = default 3, count = 1 cada lead)

```sql
select lead_id, count(*) as workspace_count
  from public.prototype_workspaces
 where lead_id in ('<SMOKE_REJECT_LEAD_ID>', '<SMOKE_ACCEPT_LEAD_ID>')
 group by lead_id;
-- Cada uno debe tener count=1.
```

---

## §2. Configurar el environment y correr scenarios

### 2.1 Export env vars

```sh
export NOON_WEBSITE_WEBHOOK_SECRET="<el-secret-de-prod>"
export SMOKE_REJECT_TOKEN="<token-del-§1.3>"
export SMOKE_REJECT_WORKSPACE_ID="<uuid-del-§1.3>"
export SMOKE_ACCEPT_TOKEN="<token-del-§1.3>"
export SMOKE_ACCEPT_WORKSPACE_ID="<uuid-del-§1.3>"

# Opcional — preview deployment. Default: producción.
# export APP_BASE="https://nooncode-app-pr-110.vercel.app"
```

### 2.2 Correr scenarios en orden

```sh
cd D:\Pedro\Proyectos\Noon\App-nooncode

node docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs 1
node docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs 2
node docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs 3
node docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs 4
node docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs 5
# >>> Correr verificación §3.5 ANTES de scenario 6 <<<
node docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs 6
node docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs 7
# >>> Correr verificación §3.7 <<<
```

### 2.3 Outputs esperados (compactos)

| Scenario | Resumen esperado |
|---|---|
| 1 | `HTTP 404 code=PROTOTYPE_DECISION_TOKEN_NOT_FOUND` |
| 2 | `HTTP 400` (zod validation error, sin code namespace-específico — viene del schema parse) |
| 3 | `HTTP 401 code=WEBSITE_WEBHOOK_AUTH_FAILED` |
| 4 | `HTTP 409 code=PROTOTYPE_DECISION_IDENTIFIER_MISMATCH` |
| 5.1 | `HTTP 201 idempotent=false draftQueued=false decisionId=…` |
| 5.2 | `HTTP 200 idempotent=true draftQueued=false decisionId=…` (mismo decisionId que 5.1) |
| 6 | `HTTP 409 code=PROTOTYPE_DECISION_ALREADY_DECIDED` |
| 7.1 | `HTTP 201 idempotent=false draftQueued=true decisionId=…` |
| 7.2 | `HTTP 200 idempotent=true draftQueued=false decisionId=…` (mismo decisionId que 7.1) |

Cualquier desviación → pausar y revisar logs Vercel (`vercel logs <deployment-url>` o Dashboard Function Logs).

---

## §3. Verificaciones Supabase (post-scenarios)

### 3.5 Después de scenario 5 (reject)

**Decisión persistida:**

```sql
select id, prototype_workspace_id, lead_id, decision, notes,
       client_user_agent, webhook_event_id, decided_at
  from public.prototype_decisions
 where prototype_workspace_id = '<SMOKE_REJECT_WORKSPACE_ID>';
-- 1 row esperado. decision='rejected'. webhook_event_id NOT NULL. notes contiene el texto del payload.
```

**Notificación al seller (1 row):**

```sql
select n.id, n.recipient_profile_id, n.source_kind, n.title, n.body, n.created_at
  from public.user_notifications n
 where n.source_event_id = (
   select id from public.prototype_decisions
    where prototype_workspace_id = '<SMOKE_REJECT_WORKSPACE_ID>'
 );
-- 1 row. title menciona "rechazo" o similar. body contiene los notes truncados.
```

**NO Maxwell draft (rejected path no dispara fire-and-forget):**

```sql
select count(*) from public.lead_proposals
 where lead_id = '<SMOKE_REJECT_LEAD_ID>'
   and review_status = 'draft'
   and created_at >= now() - interval '5 minutes';
-- 0 esperado.
```

**Ledger row presente y con attempt_count=2 después del replay:**

```sql
select id, endpoint, status, attempt_count, signature_hash
  from public.website_webhook_events
 where endpoint = 'prototype-decision'
   and signature_hash = (
     select sw.signature_hash
       from public.website_webhook_events sw
      where sw.endpoint = 'prototype-decision'
      order by created_at desc
      limit 1
   );
-- attempt_count >= 2 (1 del fire original + 1+ del replay).
-- status='processed'.
```

### 3.7 Después de scenario 7 (accept)

**Decisión persistida:**

```sql
select id, prototype_workspace_id, lead_id, decision, notes,
       webhook_event_id, decided_at
  from public.prototype_decisions
 where prototype_workspace_id = '<SMOKE_ACCEPT_WORKSPACE_ID>';
-- 1 row. decision='accepted'. notes IS NULL.
```

**Maxwell draft creado (lead_proposals draft):**

```sql
select id, lead_id, title, body, amount, project_type, complexity,
       review_status, created_at
  from public.lead_proposals
 where lead_id = '<SMOKE_ACCEPT_LEAD_ID>'
   and review_status = 'draft'
   and created_at >= now() - interval '5 minutes';
-- 1 row esperado.
-- title + body populated (Maxwell-generated).
-- project_type + complexity populated.
-- amount = computePricing(project_type, complexity, 'outbound', 0).activationBase
--          (ADR-013-compliant placeholder; seller-fee pendiente).
```

**NO seller_fees row para el draft (ADR-013 invariant):**

```sql
select count(*) from public.seller_fees
 where lead_proposal_id = (
   select id from public.lead_proposals
    where lead_id = '<SMOKE_ACCEPT_LEAD_ID>'
      and review_status = 'draft'
    order by created_at desc
    limit 1
 );
-- 0 esperado. Seller debe elegir fee desde la UI antes de submit-to-PM.
```

**Notificación al seller (1 row, copy de "Maxwell preparó borrador"):**

```sql
select id, source_kind, title, body, created_at
  from public.user_notifications
 where source_event_id = (
   select id from public.prototype_decisions
    where prototype_workspace_id = '<SMOKE_ACCEPT_WORKSPACE_ID>'
 );
-- 1 row. title menciona "aceptación" + "borrador" o similar.
```

**Ledger row processed con attempt_count >= 2 post-replay:** (mismo patrón que §3.5).

### 3.6 Después de scenario 6 (already-decided)

**NO nueva decision row** (constraint UNIQUE en `prototype_workspace_id` impide segundo INSERT):

```sql
select count(*) from public.prototype_decisions
 where prototype_workspace_id = '<SMOKE_REJECT_WORKSPACE_ID>';
-- 1 esperado (la de scenario 5, NO se agrega segunda).
```

**NO segundo notification, NO Maxwell draft:**

```sql
select count(*) from public.user_notifications
 where source_event_id = (
   select id from public.prototype_decisions
    where prototype_workspace_id = '<SMOKE_REJECT_WORKSPACE_ID>'
 );
-- 1 esperado (la de scenario 5).
```

---

## §4. Cleanup post-smoke

> **Importante:** estos fixtures pollute la lista de leads del seller. Limpiar al cerrar.

```sql
-- Borra todo en cascade gracias a las FKs CASCADE en prototype_decisions y prototype_workspaces.
delete from public.leads where id in (
  '<SMOKE_REJECT_LEAD_ID>',
  '<SMOKE_ACCEPT_LEAD_ID>'
);
-- Confirma: el delete elimina los workspaces (FK CASCADE) y los decisions (FK CASCADE).
-- Los lead_proposals draft del scenario 7 también se eliminan (FK CASCADE en lead_proposals.lead_id).
-- Las user_notifications NO se eliminan automáticamente (FK SET NULL); operator puede limpiarlas opcionalmente:

delete from public.user_notifications
 where source_event_id is null
   and title like '%SMOKE-A%';  -- ajustar según el copy real
```

Verificar:

```sql
select count(*) from public.leads where name like 'SMOKE-A%';
-- 0 esperado.
```

---

## §5. Mapping a Acceptance Criteria del spec

| AC | Cubierto por scenarios | Notas |
|---|---|---|
| AC-3 (accept happy path) | 7.1 + §3.7 verificación Supabase | ✅ |
| AC-4 (reject happy path) | 5.1 + §3.5 verificación Supabase | ✅ |
| AC-5 (idempotent replay) | 5.2 + 7.2 | ✅ — bit-identical timestamp+body+signature |
| AC-6 (7 error codes) | 1 (404), 2 (400), 3 (401), 4 (409 mismatch), 6 (409 already-decided) | **5 de 7 cubiertos.** Faltantes: 410 TOKEN_EXPIRED (requiere regenerar mid-smoke) + 410 LEAD_DELETED (requiere borrar el lead mid-smoke) — ver §6 opcional |
| AC-7 (HMAC + rate limit) | 3 (HMAC). Rate limit no exercised (no fire >120/min) | Parcial — HMAC reuse confirmada |
| AC-8 (Maxwell draft amount per ADR-013) | §3.7 verificación de `amount` | ✅ — query SQL valida invariant |
| AC-9 (Maxwell draft failure path) | Out of smoke scope — requiere mock failure | Cubierto por unit tests, no smoke |
| AC-10 (RLS verification) | Out of smoke scope — separate operator post-merge check per CN-2 | Cubierto por static proof + live INSERT denial |

**Cobertura smoke A:** 5 de 12 ACs directamente verificados end-to-end; 3 ACs reforzados (AC-1, AC-2, AC-11 ya verificados pre-smoke); 4 ACs out-of-scope para smoke unilateral.

---

## §6. Scenarios opcionales (no automatizados)

### 6.1 410 TOKEN_EXPIRED

Requiere superseded el token a mitad del smoke:

```sql
-- Antes de re-fire del scenario 4 con el REJECT_TOKEN, marcar el token como superseded:
update public.prototype_workspaces
   set share_token_superseded_at = now()
 where id = '<SMOKE_REJECT_WORKSPACE_ID>';

-- Luego firmar otro POST con SMOKE_REJECT_TOKEN:
-- Expected: HTTP 410 PROTOTYPE_DECISION_TOKEN_EXPIRED.

-- Revertir:
update public.prototype_workspaces
   set share_token_superseded_at = null
 where id = '<SMOKE_REJECT_WORKSPACE_ID>';
```

### 6.2 410 LEAD_DELETED

Requiere borrar el lead mid-smoke (destructive). Generalmente skipped — el path es defensivo, no operativo.

### 6.3 Rate limit (429)

Disparar >120 requests/min al endpoint. Útil solo si se sospecha del rate-limit infra. Reuses la misma infra que `inbound-proposal` y `payment-confirmed` ya probadas live (B1.3a/b smokes).

---

## §7. Reportar resultados

Después de correr los 7 scenarios + verificaciones Supabase, captar el resumen en un comment del PR #110:

```markdown
## Smoke A executed 2026-MM-DD against <APP_BASE>

| Scenario | Expected | Got | Verdict |
|---|---|---|---|
| 1 | HTTP 404 TOKEN_NOT_FOUND | HTTP 404 PROTOTYPE_DECISION_TOKEN_NOT_FOUND | PASS |
| 2 | HTTP 400 | HTTP 400 | PASS |
| 3 | HTTP 401 | HTTP 401 WEBSITE_WEBHOOK_AUTH_FAILED | PASS |
| 4 | HTTP 409 IDENTIFIER_MISMATCH | HTTP 409 PROTOTYPE_DECISION_IDENTIFIER_MISMATCH | PASS |
| 5.1 | HTTP 201 draftQueued=false | … | … |
| 5.2 | HTTP 200 idempotent=true | … | … |
| 6 | HTTP 409 ALREADY_DECIDED | … | … |
| 7.1 | HTTP 201 draftQueued=true | … | … |
| 7.2 | HTTP 200 idempotent=true draftQueued=false | … | … |

### Supabase verifications

- §3.5: prototype_decisions / user_notifications / no lead_proposals draft → PASS/FAIL
- §3.7: prototype_decisions / lead_proposals draft (amount=…) / user_notifications / NO seller_fees → PASS/FAIL
- §3.6: idempotency at unique-constraint level → PASS/FAIL

### Cleanup

- Fixtures eliminados: ✅
```

---

## §8. Landmines

- **Fixture creation requiere credits del seller.** Si no hay budget de credits, scenario fixture creation falla. Top-up paso del §1.2.
- **Si el target deployment usa preview con Supabase branch separado**, los fixtures no se ven en prod y vice versa. Confirmar `APP_BASE` apunta al mismo Supabase donde se crearon los fixtures.
- **Bit-identical replay**: el script captura el timestamp del primer fire y lo reusa. Si la latencia entre fires excede el window de HMAC (~5min), el replay aún debería funcionar — el window se valida solo en HMAC verify, y como el timestamp es el del primer fire, el window sigue siendo válido relativo a ese timestamp (no a "now").
- **Maxwell draft puede fallar silenciosamente.** Si la primera invocación de fire-and-forget al pipeline Maxwell falla (env config, LLM unreachable), el draft no aparece en `lead_proposals` pero la decision row sí. Estructura log esperada: `prototype.decision.accepted.draft_creation_failed`. Verificar Vercel logs si §3.7 no encuentra el draft.
- **Notification source_kind = 'lead_activity'** per OQ-3 Backend resolution. Si en el futuro se migra a `'prototype_decision_received'` (CHECK constraint extension), los queries del §3 se deben actualizar.
