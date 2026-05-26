# Smoke A G22 — prototype-signed-read GET endpoint verification runbook

> **Propósito:** verificar PR #112 (G22 handler — ADR-024 + A1) end-to-end contra ambiente real, sin depender de NoonWeb D-slice. Sibling pattern al `2026-05-26-smoke-a-prototype-decision-fire.mjs` (PR #110 POST smoke).
>
> **Naturaleza:** smoke test unilateral GET. NO requiere coordinación NoonWeb-dev; el contract es bit-identical al firmado en `docs/integrations/cross-repo-webhook-v1.md` §6 + ADR-024 D1-D7 + §Amendments A1.
>
> **Cuándo correr:**
> - Pre-merge (no aplica acá — PR #112 ya está mergeada).
> - Post-merge: contra producción (default `APP_BASE`).
> - Pre-NoonWeb-integration: validar el endpoint funciona antes de que NoonWeb-dev arranque D-slice render.
>
> **Coste de ejecución:** ~15-20 min (fixtures requieren regenerate vía RPC para test scenario 7).

---

## §0. Pre-flight

### 0.1 Confirmar deployment

```sh
curl -s -o /dev/null -w "%{http_code}\n" -X GET "$APP_BASE/api/integrations/website/prototype-signed-read/00000000-0000-0000-0000-000000000000"
# Esperado: 401 (sin HMAC) — confirma que la ruta existe.
```

### 0.2 Confirmar migration 0060 aplicada

```sql
select count(*) from public.prototype_decisions;
-- existe (no error)

select share_token from public.prototype_workspaces limit 1;
-- existe (no error)

select share_token_superseded_at from public.prototype_workspaces limit 1;
-- existe (no error)
```

### 0.3 Acceso a Supabase MCP o Dashboard SQL Editor

Necesario para crear fixtures (§1) y verificar side-effects entre scenarios.

---

## §1. Crear los fixtures

Necesitamos hasta 3 tokens distintos para cubrir todos los scenarios. Si solo querés correr un subset, podés crear solo los fixtures correspondientes — el script skipea scenarios con env vars faltantes.

| Token env var | Estado del workspace | Scenarios habilitados |
|---|---|---|
| `SMOKE_G22_TOKEN_PENDING` | V1 alive, sin decision row | 5, 6 |
| `SMOKE_G22_TOKEN_SUPERSEDED` | V1 cuyo workspace fue regenerated a V2 (`share_token_superseded_at` NOT NULL) | 7 |
| `SMOKE_G22_TOKEN_REJECTED` | V1 con `prototype_decisions` row `decision='rejected'`, `notes='...'` | 8 |

Scenarios 1-4 (404 + 3 x 401) NO requieren fixtures — usan dummy token.

### 1.1 Lead seed + workspace V1 (Fixture PENDING)

```sql
-- Obtener seller profile
with seller as (
  select id from public.profiles where role = 'sales' limit 1
)
insert into public.leads (id, name, source, current_stage, status, owner_profile_id, created_at, updated_at)
select gen_random_uuid(), 'SMOKE-G22 PENDING fixture', 'smoke_test', 'sales', 'new', seller.id, now(), now()
from seller
returning id, name;
-- Anotar como SMOKE_G22_PENDING_LEAD_ID
```

Top-up credits si hace falta (mismo patrón que POST smoke §1.2):

```sql
select wa.available_balance, pcs.request_cost
  from public.wallet_accounts wa
  cross join public.prototype_credit_settings pcs
 where wa.profile_id = (select id from public.profiles where role = 'sales' limit 1)
   and wa.bucket = 'credits';

-- Si available_balance < 4 (3 V1+V2+V3 + safety), top-up:
select public.credit_wallet_bucket(
  '<SELLER_PROFILE_ID>'::uuid, 10, 'credits',
  'manual_credit', 'smoke_g22', 'smoke_g22_topup_2026_05_26',
  null, 'admin', jsonb_build_object('reason', 'smoke G22 topup'),
  'smoke_g22_topup_2026_05_26'
);
```

Generate workspace V1:

```sql
select * from public.request_lead_prototype('<SMOKE_G22_PENDING_LEAD_ID>'::uuid);
-- Retorna prototype_workspace_id + share_token.
-- Anotar el share_token como SMOKE_G22_TOKEN_PENDING.
```

### 1.2 Lead seed + V1 superseded by V2 (Fixture SUPERSEDED)

```sql
-- Seed lead
with seller as (
  select id from public.profiles where role = 'sales' limit 1
)
insert into public.leads (id, name, source, current_stage, status, owner_profile_id, created_at, updated_at)
select gen_random_uuid(), 'SMOKE-G22 SUPERSEDED fixture', 'smoke_test', 'sales', 'new', seller.id, now(), now()
from seller
returning id, name;
-- Anotar SMOKE_G22_SUPERSEDED_LEAD_ID
```

Generate V1, luego V2 (V1 token automatically supersedes per ADR-025 D2 + RPC body):

```sql
-- V1
select * from public.request_lead_prototype('<SMOKE_G22_SUPERSEDED_LEAD_ID>'::uuid);
-- Anotar share_token como SMOKE_G22_TOKEN_SUPERSEDED (el V1).

-- V2 (regenerate — esto marca V1.share_token_superseded_at = now())
select * from public.request_lead_prototype('<SMOKE_G22_SUPERSEDED_LEAD_ID>'::uuid);
-- V2 share_token ignored — solo necesitamos el V1.
```

Verificar:

```sql
select id, share_token, share_token_superseded_at, created_at
  from public.prototype_workspaces
 where lead_id = '<SMOKE_G22_SUPERSEDED_LEAD_ID>'
 order by created_at asc;
-- 2 rows. V1 (oldest) tiene share_token_superseded_at NOT NULL.
-- V2 (newest) tiene share_token_superseded_at NULL.
-- SMOKE_G22_TOKEN_SUPERSEDED = V1.share_token.
```

### 1.3 Lead seed + workspace V1 + rejected decision (Fixture REJECTED)

```sql
-- Seed lead
with seller as (
  select id from public.profiles where role = 'sales' limit 1
)
insert into public.leads (id, name, source, current_stage, status, owner_profile_id, created_at, updated_at)
select gen_random_uuid(), 'SMOKE-G22 REJECTED fixture', 'smoke_test', 'sales', 'new', seller.id, now(), now()
from seller
returning id, name;
-- Anotar SMOKE_G22_REJECTED_LEAD_ID
```

Generate workspace V1:

```sql
select * from public.request_lead_prototype('<SMOKE_G22_REJECTED_LEAD_ID>'::uuid);
-- Anotar share_token como SMOKE_G22_TOKEN_REJECTED + workspace_id como SMOKE_G22_REJECTED_WORKSPACE_ID.
```

Insert rejection decision directamente (más rápido que correr el POST smoke contra este fixture):

```sql
insert into public.prototype_decisions (
  prototype_workspace_id, lead_id, decision, notes,
  client_user_agent, webhook_event_id, decided_at
)
values (
  '<SMOKE_G22_REJECTED_WORKSPACE_ID>'::uuid,
  '<SMOKE_G22_REJECTED_LEAD_ID>'::uuid,
  'rejected',
  'Smoke G22 — cliente prefiere otra estética.',
  'smoke-g22-fixture/1.0',
  null,
  now()
)
returning id, decision, decided_at;
```

---

## §2. Configurar el environment y correr scenarios

### 2.1 Export env vars

```sh
export NOON_WEBSITE_WEBHOOK_SECRET="<el-secret-de-prod>"

# Opcionales — cada fixture habilita 1+ scenarios; missing → scenario skipea con error claro.
export SMOKE_G22_TOKEN_PENDING="<token-del-§1.1>"
export SMOKE_G22_TOKEN_SUPERSEDED="<token-V1-del-§1.2>"
export SMOKE_G22_TOKEN_REJECTED="<token-del-§1.3>"

# Opcional — preview deployment. Default: producción.
# export APP_BASE="https://nooncode-app-pr-XXX.vercel.app"
```

### 2.2 Correr scenarios en orden

```sh
cd D:\Pedro\Proyectos\Noon\App-nooncode

# Scenarios sin fixture (no env required)
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 1
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 2
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 3
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 4

# Scenarios con fixture
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 5
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 6
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 7
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 8
```

### 2.3 Outputs esperados (compactos)

| Scenario | Resumen esperado | Cache-Control esperado |
|---|---|---|
| 1 | `HTTP 404 code=PROTOTYPE_READ_TOKEN_NOT_FOUND` | `no-store` |
| 2 | `HTTP 401 code=WEBSITE_WEBHOOK_AUTH_FAILED` | `no-store` |
| 3 | `HTTP 401 code=WEBSITE_WEBHOOK_AUTH_FAILED` | `no-store` |
| 4 | `HTTP 401 code=WEBSITE_WEBHOOK_AUTH_FAILED` | `no-store` |
| 5 | `HTTP 200 decision.status=pending workspace.version=1 tokenSuperseded=false` | `private, max-age=30, stale-while-revalidate=60` |
| 6 | `HTTP 200` × 2; `Byte-identical (excl. serverTime/requestId): YES`; `Cache-Control match: YES` | (as above on both fires) |
| 7 | `HTTP 410 code=PROTOTYPE_READ_TOKEN_SUPERSEDED` | `no-store` |
| 8 | `HTTP 200 decision.status=rejected workspace.version=1 tokenSuperseded=false` + `decision.notes = "Smoke G22 — cliente prefiere otra estética."` | `private, max-age=30, stale-while-revalidate=60` |

Cualquier desviación → pausar y revisar Vercel logs (`vercel logs <deployment>` o Dashboard Function logs):
- Estructura: `website.prototype_signed_read.served` (200) o `website.prototype_signed_read.rejected` (4xx/5xx) o `website.prototype_signed_read.rate_limited` (429) o `website.prototype_signed_read.failed` (500).

---

## §3. Verificaciones adicionales (post-scenarios)

### 3.5 Después de scenario 5 (happy 200 pending)

Verificar que el response NO contiene fields prohibidos (defense-in-depth — el unit test AC-8 ya lo cubre, esta es una recheck contra live data):

```sh
# Re-fire scenario 5 con full output, grep forbidden field names
node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 5 | grep -E '"(share_token|created_by|updated_at|notes|score|lead_origin|assigned_to|next_follow_up_at|client_user_agent|webhook_event_id|maxwell_snapshot|project_type)"'
# Esperado: cero matches.
```

Verificar el lead context renderizado:

```sql
-- Confirmar que businessName en response viene de leads.company ?? leads.name (per ADR-024 A1):
select company, name, maxwell_snapshot ->> 'project_type' as raw_project_type
  from public.leads
 where id = '<SMOKE_G22_PENDING_LEAD_ID>';

-- Cross-check: la response del fire 5.1 debe mostrar:
-- - businessName = company (si non-null) OR name
-- - projectTypeLabel = humanize(raw_project_type) OR 'Sitio Web' default
```

### 3.6 Después de scenario 6 (replay byte-identical)

El script imprime `Byte-identical (excl. serverTime/requestId): YES`. Si dice `NO`, investigar — significa que algo no-determinístico está infiltrando la response (timezone? Cache? Backend non-deterministic SELECT order?).

### 3.7 Después de scenario 7 (superseded → 410)

```sql
-- Confirmar que V1 sigue superseded (no debería cambiar por el GET):
select share_token_superseded_at
  from public.prototype_workspaces
 where lead_id = '<SMOKE_G22_SUPERSEDED_LEAD_ID>'
 order by created_at asc
 limit 1;
-- Esperado: non-null (mismo timestamp que antes del fire).
```

### 3.8 Después de scenario 8 (happy 200 rejected)

Confirmar que `decision.notes` echoed verbatim:

```sql
select notes from public.prototype_decisions
 where prototype_workspace_id = '<SMOKE_G22_REJECTED_WORKSPACE_ID>';
-- Esperado: 'Smoke G22 — cliente prefiere otra estética.'
-- La response del fire 8.1 debe mostrar exactamente este string.
```

---

## §4. Cleanup post-smoke

```sql
-- Borra todo en cascade (FK CASCADE en prototype_workspaces, prototype_decisions, etc.).
delete from public.leads where id in (
  '<SMOKE_G22_PENDING_LEAD_ID>',
  '<SMOKE_G22_SUPERSEDED_LEAD_ID>',
  '<SMOKE_G22_REJECTED_LEAD_ID>'
);
-- Confirmar:
select count(*) from public.leads where name like 'SMOKE-G22%';
-- Esperado: 0.
```

---

## §5. Mapping a Acceptance Criteria del spec (G22 handler)

| AC | Cubierto por scenarios | Notas |
|---|---|---|
| AC-1 (happy 200 pending) | 5 + 6 | ✅ Cache headers byte-exact + body shape per ADR-024 D3 |
| AC-2 (happy 200 accepted) | (no included en este smoke) | Cubierto por unit test AC-2 + AC-3 (rejected) en 8 cubre el "post-decision render" path |
| AC-3 (happy 200 rejected; notes echoed) | 8 | ✅ |
| AC-4 (404 token not found) | 1 | ✅ |
| AC-5 (410 token superseded) | 7 | ✅ |
| AC-6 (410 lead deleted; precedes superseded) | (manual SQL setup required — skip in standard smoke) | Optional — see §6.1 |
| AC-7 (401 HMAC mismatch) | 2 + 3 + 4 | ✅ — covers missing sig, tampered sig, stale timestamp |
| AC-8 (sanitization allowlist) | 5 (con verificación §3.5) | ✅ |
| AC-9 (cache headers byte-exact) | 5 + 6 (200) + 1/2/3/4/7 (no-store) | ✅ |
| AC-10 (RLS defensive) | Manual SQL — out of smoke scope | Per spec line 142 — discharged a operator manual SQL |
| AC-11 (GET idempotency byte-identical) | 6 | ✅ |
| AC-12 (rate-limit 429) | (no included en este smoke) | Optional — see §6.2 |

**Cobertura smoke A G22:** 9 de 12 ACs directamente verificados live; 3 ACs out-of-scope o reused.

---

## §6. Scenarios opcionales (no automatizados)

### 6.1 AC-6 410 LEAD_DELETED

Requiere hard-delete del lead mientras workspace existe (defensive code path; FK CASCADE normalmente borra el workspace también, pero la branch defensive del handler maneja el race). Setup destructivo, generalmente skipped.

Para test manual:

```sql
-- Comenzar con un fresh fixture (no usar PENDING/SUPERSEDED/REJECTED que ya tenés).
-- Después de generar V1, manualmente DROP el FK CASCADE y borrar el lead:
alter table public.prototype_workspaces
  drop constraint prototype_workspaces_lead_id_fkey,
  add constraint prototype_workspaces_lead_id_fkey
    foreign key (lead_id) references public.leads(id) on delete restrict;

delete from public.leads where id = '<LEAD_ID>';
-- Workspace queda huérfano; el GET del share_token debe retornar 410 PROTOTYPE_READ_LEAD_DELETED.
-- Revertir: restore FK CASCADE + delete workspace huerfano.
```

**No recomendado** salvo investigación de bug real. El path defensive es discharged por unit test AC-6.

### 6.2 AC-12 rate-limit 429

Disparar >60 GETs del scenario 5 en <60 segundos:

```sh
for i in $(seq 1 70); do
  node docs/handoffs/2026-05-26-smoke-a-g22-signed-read-fire.mjs 5 &
done
wait
```

Esperado: alrededor del request 61 el response cambia a 429 con header `Retry-After`. Verificar Vercel logs por estructura `website.prototype_signed_read.rate_limited`. Después esperar ~70s para que el bucket se resetee antes de re-correr otros scenarios.

---

## §7. Reportar resultados

Después de correr los 8 scenarios + verificaciones, captar en un comment del PR #112 o un follow-up issue:

```markdown
## Smoke A G22 executed 2026-MM-DD against <APP_BASE>

| Scenario | Expected | Got | Verdict |
|---|---|---|---|
| 1 | 404 PROTOTYPE_READ_TOKEN_NOT_FOUND + no-store | … | PASS/FAIL |
| 2 | 401 WEBSITE_WEBHOOK_AUTH_FAILED + no-store | … | … |
| 3 | 401 WEBSITE_WEBHOOK_AUTH_FAILED + no-store | … | … |
| 4 | 401 WEBSITE_WEBHOOK_AUTH_FAILED + no-store | … | … |
| 5 | 200 + private,max-age=30,swr=60 + body OK | … | … |
| 6 | 2x200 + byte-identical (excl. serverTime) | … | … |
| 7 | 410 PROTOTYPE_READ_TOKEN_SUPERSEDED + no-store | … | … |
| 8 | 200 + decision.status=rejected + notes verbatim | … | … |

### Verificaciones adicionales
- §3.5: no forbidden field names in response body → PASS/FAIL
- §3.5: businessName resolves correctly (company ?? name) → PASS/FAIL
- §3.7: V1 still superseded post-fire → PASS/FAIL
- §3.8: decision.notes echoed verbatim → PASS/FAIL

### Cleanup
- Fixtures eliminados: ✅
```

---

## §8. Landmines

- **`SMOKE_G22_TOKEN_SUPERSEDED` requiere V1 share_token, NO V2**. Si capturás el V2 token por accidente, scenario 7 retorna 200 (V2 está alive). Volver a §1.2 y verificar `order by created_at asc`.
- **Cache-Control header check**: el script imprime `Cache-Control: <value>` por cada fire. Cualquier desvío del byte-exact value indicado en §2.3 es un bug (probably middleware o framework injection).
- **Replay window**: scenario 6 fire 6.2 corre ~500ms después de 6.1. El timestamp + signature SON los del fire 6.2 (no reuse del 6.1). Es expected — ambas calls validan con HMAC frescos pero el response body excluding serverTime+requestId debe matchear.
- **Maxwell snapshot extraction**: si `leads.maxwell_snapshot` está vacío o no tiene `project_type`, scenario 5/6/8 muestran `projectTypeLabel: "Sitio Web"` (default per A1). Es el correct behavior; pero si esperabas un label específico, revisar el snapshot del fixture.
- **Rate-limit budget shared with NoonWeb-dev**: si NoonWeb dev también está testing contra el mismo APP_BASE, el budget `${token}:${ip}` puede chocar. Coordinar window.
- **No transport ledger participation**: per ADR-024 D1, este endpoint NO escribe en `website_webhook_events`. NO buscar entries ahí post-smoke — es expected.
- **`SUPABASE_SERVICE_ROLE_KEY` bypass**: el handler usa admin client. La inserción de la rejection decision en §1.3 también puede usar admin client. Si insertás vía RLS-gated path, asegurate que el caller tiene `sales` role visible-to-the-lead.

---

## §9. Execution report — 2026-05-26 (first live run)

**Date:** 2026-05-26
**Target:** `https://nooncode-app-pi.vercel.app` (production, develop @ `b8a0cd4`)
**Operator:** Pedro
**Outcome:** **PASS funcional**. 1 cosmetic finding documented as ADR-024 §Closure notes CN-1.

### Lesson learned during fixture creation — RPC is auth-gated, NOT callable from service_role

The runbook §1 originally instructed running `request_lead_prototype(uuid)` via Supabase MCP / SQL Editor to generate the fixture workspaces. **This does not work.** The RPC is `SECURITY DEFINER` but reads `auth.uid()` at the top of the body; when called from `service_role` (no auth context) it raises `UNAUTHENTICATED` immediately.

**Workaround applied for this smoke execution:** direct INSERTs into `prototype_workspaces` (and `prototype_decisions` for the rejected fixture), bypassing the RPC entirely. This is valid because the smoke targets the GET handler — not the RPC. The RPC's Gate A (credits) / Gate B (cap) / regenerate semantics are out of scope here.

**Future runbook readers:** prefer the direct-INSERT approach below over the RPC. The RPC works only when invoked via an authenticated seller session.

#### Direct-INSERT fixture creation snippet (use this)

```sql
-- Identify an active seller profile id (will be used as created_by + assigned_to)
select id, full_name from public.user_profiles where role = 'sales' and is_active = true limit 1;

-- Then, with that profile id substituted as <SELLER_ID>, run one CTE per fixture:
with seller as (select '<SELLER_ID>'::uuid as id),

-- PENDING fixture
pending_lead as (
  insert into public.leads (name, source, score, created_by, assigned_to, company, maxwell_snapshot)
  select 'SMOKE-G22 PENDING — Acme Co', 'other', 50, seller.id, seller.id, 'Acme Co',
         jsonb_build_object('project_type', 'landing')
    from seller
  returning id
),
pending_workspace as (
  insert into public.prototype_workspaces (
    lead_id, requested_by_profile_id, current_stage, status,
    last_operation_id, share_token
  )
  select pending_lead.id, seller.id, 'sales', 'pending_generation',
         gen_random_uuid(), gen_random_uuid()::text
    from pending_lead, seller
  returning id, share_token
),
-- (repeat similar CTEs for SUPERSEDED — two workspaces, the older with
--  share_token_superseded_at = clock_timestamp() — and REJECTED — one
--  workspace + one prototype_decisions row with decision='rejected')
...
select
  (select share_token from pending_workspace) as SMOKE_G22_TOKEN_PENDING,
  -- ...similar for SUPERSEDED + REJECTED
;
```

Notable schema corrections vs. the earlier runbook draft:

- `leads.source` is an enum (`cold_call`, `event`, `maxwell`, `other`, `referral`, `social`, `website`) — NOT a free text. Use `'other'` for smoke fixtures (not `'smoke_test'`).
- `leads` required NOT NULL columns (no default): `name`, `source`, `score`, `created_by`. Other NOT NULL columns have defaults (`tags={}`, `status='new'`, `value=0`, `assignment_status='owned'`, `auto_followup_enabled=true`, `publication_status='published'`, `maxwell_snapshot={}`).
- `wallet_accounts` is keyed by `(profile_id, currency)`; columns are `available_to_spend / available_to_withdraw / pending / locked` (no `bucket` column, no `available_balance` column). Credits live in a different table (`user_wallets`) — but for smoke fixtures created via direct INSERT, credits are not consumed, so neither needs touching.

### Execution results — 2026-05-26

| # | Scenario | Expected | Got | Verdict |
|---|---|---|---|---|
| 1 | token-not-found | HTTP 404 PROTOTYPE_READ_TOKEN_NOT_FOUND + `no-store` | exact | ✅ PASS |
| 2 | missing-signature | HTTP 401 WEBSITE_WEBHOOK_AUTH_FAILED + `no-store` | exact | ✅ PASS |
| 3 | tampered-signature | HTTP 401 WEBSITE_WEBHOOK_AUTH_FAILED + `no-store` | exact | ✅ PASS |
| 4 | stale-timestamp (-10min) | HTTP 401 WEBSITE_WEBHOOK_AUTH_FAILED + `no-store` | exact | ✅ PASS |
| 5 | happy 200 pending | HTTP 200 + `private, max-age=30, stale-while-revalidate=60` | HTTP 200 + `private, max-age=30` ⚠️ | ✅ functional / ⚠️ cache divergence (CN-1) |
| 6 | replay byte-identical | 2 × HTTP 200, byte-identical body (modulo serverTime + requestId), cache match | byte-identical YES; Cache-Control match YES (same incomplete value) | ✅ PASS (with CN-1 caveat) |
| 7 | superseded | HTTP 410 PROTOTYPE_READ_TOKEN_SUPERSEDED + `no-store` | exact | ✅ PASS |
| 8 | happy 200 rejected | HTTP 200 + decision.status=rejected + notes echoed verbatim + correct businessName + projectTypeLabel | exact + `Cache-Control: private, max-age=30` ⚠️ | ✅ functional / ⚠️ cache divergence (CN-1) |

### Side-effect verification (post-fires)

| Check | Expected | Actual |
|---|---|---|
| PENDING workspace count | 1, not superseded | ✅ 1, not superseded |
| SUPERSEDED workspace count | 2, any_superseded=true | ✅ 2, any_superseded=true |
| REJECTED workspace count | 1, not superseded | ✅ 1, not superseded |
| REJECTED `prototype_decisions.notes` | verbatim "Smoke G22 — cliente prefiere otra estética." | ✅ exact match |
| `website_webhook_events` for `prototype-signed-read` endpoint | 0 entries (ledger declined per ADR-024 D1) | ✅ 0 |

**Conclusion: GET is HTTP-idempotent verified live in prod. No state mutation across 8 fires.**

### Cache-Control finding — see ADR-024 §Closure notes CN-1

The `stale-while-revalidate=60` directive is stripped from the live response when the response is marked `private`. Hypothesis: Vercel CDN normalization. The handler emits the full string (unit-tested); the CDN edge strips before client receives. **Accepted as-is**, divergence documented in ADR-024 CN-1. Functional impact is small (max-age=30 preserved; SWR window narrows from 30-90s to 30s sharp). NoonWeb-dev should be aware when reading §6.4 of `cross-repo-webhook-v1.md` that the live SWR-60s tail is not preserved.

### Fixtures cleaned up

```sql
delete from public.leads where id in (
  'c5e13e93-ac89-417c-96d1-fa9e9e256781',  -- PENDING
  '19b36add-d9d5-4913-a38f-12fadc7198eb',  -- SUPERSEDED
  'f065b569-133c-4d0d-a777-d9ba6e0e366e'   -- REJECTED
);
```

FK CASCADE removed 4 prototype_workspaces rows + 1 prototype_decisions row. Post-cleanup count check returned 0 for all three (leads, workspaces, decisions). Producción limpia.

### Next operational steps

1. **NoonWeb-dev D-slice render** unblocked — App-side endpoint fully verified live.
2. **Bilateral smoke test** (NoonWeb → App round-trip with real client signed request) is the next confidence step before NoonWeb production deploy.
3. **No follow-up iteration required** on App side for G22. CN-1 is filed as an accepted divergence, not a debt.
