# Iteration spec — Maxwell Lead Engine V1: Sistema de Nichos

## Iteration metadata

| Field | Value |
|---|---|
| Iteration ID | `fase-23a-maxwell-niche-system` |
| Phase label | Phase 23 — Maxwell Lead Engine specialization |
| Phase code in DB | `phase_23b` (override of source-spec `phase_23a` to avoid collision with the parallel session's `0059_phase_23a_prototype_decisions.sql`, per Router R1) |
| Mode | New Build (additive feature on top of an existing real module) |
| Depth | FULL |
| Route | Analysis → Architecture → Backend ∥ Frontend → Refactor → Testing → Security (mandatory) → Docs → Validator |
| Skipped skills | Audit, Infra |
| Branch | `feat/maxwell-niche-system` |
| Worktree | `D:/Pedro/Proyectos/Noon/App-nooncode-niches/` |
| Base | `origin/develop` @ `863d0ea` (Merge PR #108 — `feat/prototype-flow-complete`, último merge en develop al momento de crear el worktree) |
| Date opened | 2026-05-25 |
| Authoritative source | `docs/handoffs/2026-05-25-maxwell-niche-system-spec.md` (1064 lines) |
| Lifecycle | active — does not supersede any prior spec |

## Goal

Permitir que los sellers de NoonApp ejecuten búsquedas Maxwell Lead Engine V1 filtradas por nicho de negocio, eligiendo hasta 2 nichos por búsqueda (de un catálogo durable de 20 familias / 126 micro-nichos), con resultados agrupados por nicho en la UI, salesSpeech calibrado al nicho específico vía `auditHint`, y un nicho predeterminado opcional persistido por seller en `user_profiles.preferred_niche_ids`. La creación manual de leads acepta un único nicho opcional. Todos los leads (Maxwell y manuales) quedan etiquetados con `niche_id` para trazabilidad y filtrado futuro.

### What this iteration ENTREGA
- Catálogo durable de 20 familias + 126 micro-nichos (datos puros).
- Migración aditiva `0061_phase_23b_maxwell_niche_system.sql` con 3 columnas nullable (`leads.niche_id TEXT`, `maxwell_search_runs.niche_ids TEXT[]`, `user_profiles.preferred_niche_ids TEXT[] DEFAULT '{}'`). Prefix `0061` reserva `0060` para la sesión paralela (que tiene `0059_phase_23a_prototype_decisions.sql` untracked y deberá renumerar a `0060` al hacer rebase contra `develop` post PR #108). **Contingencia pre-merge**: si la sesión paralela mergea con un número distinto a `0060` o no mergea, renombrar `0061 → 0060` aquí (zero-risk porque la migración aún no se aplicó a ningún entorno).
- Refactor del Lead Engine para búsqueda secuencial por nicho con whitelist Overpass y distribución determinística 5-leads/2-nichos.
- Selector de nicho de dos niveles reutilizable en `leads/page.tsx`, `settings/page.tsx` y `lead-form-dialog.tsx`.
- Endpoint `GET/PATCH /api/maxwell/niche-preferences` (`sales`, `pm`, `admin`).
- Cambio de modelo `gpt-4o-mini` → `gpt-5.5` (solo en `lib/server/maxwell/lead-engine.ts`, justificado en ADR-026 con plan de rollback).
- Tests unitarios nuevos: distribución 2-nichos, whitelist Overpass, endpoint niche-preferences.

### What this iteration NO entrega (diferido por diseño)
- Regeneración de `lib/server/supabase/database.types.ts` — diferido a post-merge (un PR aparte ejecutará `supabase gen types typescript` contra la migración aplicada y eliminará los `(row as any)` confinados).
- Browser smoke E2E del flujo nuevo (selector → búsqueda → resultados agrupados → preferencias persistidas) — diferido por scope; el Validator devolverá PARTIAL por diseño.
- Cambio del modelo `gpt-4o-mini` en otros archivos del repo (solo `lead-engine.ts` migra).
- Migración de leads históricos sin `niche_id` (quedan `NULL`; la UI los trata como "sin nicho").
- Query Overpass genérico cuando no se selecciona nicho — preserva exactamente el comportamiento actual.
- Cualquier cambio en `app/api/leads/[leadId]/route.ts`, tests existentes, o la lógica de scoring/dedupe/radio/límites de batch.

## Affected files

### New (4)
| Path | Reason |
|---|---|
| `lib/server/maxwell/niches.ts` | Datos puros — 20 familias, 126 micro-nichos, tipos y helpers `getNicheById` / `getNichesByFamily` / `getNicheFamily`. Sin lógica de negocio. |
| `app/api/maxwell/niche-preferences/route.ts` | `GET` + `PATCH` para `user_profiles.preferred_niche_ids`. Roles `sales`, `pm`, `admin`. Patrón espejo de `app/api/notifications/preferences/route.ts`. |
| `supabase/migrations/0061_phase_23b_maxwell_niche_system.sql` | Aditiva, 3 columnas nullable. `0061` porque `0059_phase_18c_prototype_handoff_ready_status.sql` ya existe en `origin/develop` (PR #108 mergeado), y `0060` queda reservado para la sesión paralela que renumerará su `0059_phase_23a_prototype_decisions.sql` untracked. Phase label `phase_23b` evita colisión con `phase_23a_prototype_decisions`. **Contingencia pre-merge**: si la sesión paralela mergea con número distinto a `0060` o no mergea, renombrar `0061 → 0060` aquí (zero-risk). |
| `docs/adrs/ADR-026-maxwell-lead-engine-gpt-5-5-model-selection.md` | Documenta el switch `gpt-4o-mini` → `gpt-5.5`, criterios de aceptación, plan de rollback y scope-out (solo el auditor del Lead Engine). Creación condicional a que Architecture confirme el ADR. |

### Modified (11 archivos de código + 1 doc + 1 roadmap externo)

| Path | Reason |
|---|---|
| `lib/server/maxwell/lead-engine.ts` | 8 cambios: modelo `gpt-5.5` (×2), import `Niche`/`getNicheById`, `nicheIds` en schema de request, `leadsByNiche?` en `MaxwellLeadSearchResult`, `niche?` en `fetchCandidates` (whitelist Overpass tags), `niche?` en `auditCandidates` (inyectar `auditHint` al system prompt sin tocar el schema), `niche_id` en `buildLeadInsert`, búsquedas secuenciales en `runMaxwellLeadSearch` con distribución determinística + persistencia de `niche_ids` en `maxwell_search_runs`. |
| `lib/server/leads/schema.ts` | Añadir `nicheId: z.string().optional().nullable()` a `baseLeadShape` y declararlo explícitamente en `updateLeadSchema` (no hereda automáticamente del shape base, per nota de la spec). |
| `lib/server/leads/mappers.ts` | `mapLeadRowToWire`: `nicheId: (row as any).niche_id ?? null` con TODO; `mapCreateLeadInputToInsert`: `niche_id: input.nicheId ?? null` con TODO; `mapUpdateLeadInputToUpdate`: añadir branch `if (input.nicheId !== undefined) update.niche_id = input.nicheId ?? null`. |
| `lib/server/leads/repository.ts` | Añadir `niche_id` al `leadSelect`. |
| `lib/leads/serialization.ts` | `LeadWire`: `nicheId: string \| null`; `deserializeLead`: `nicheId: lead.nicheId ?? undefined`. |
| `lib/types.ts` | `Lead`: `nicheId?: string`. `LeadDraft` lo hereda vía `Omit`. |
| `lib/data-context.tsx` | `mapLeadDraftToRequest`: `nicheId: leadData.nicheId ?? null`; `mapLeadUpdatesToRequest`: branch `if (updates.nicheId !== undefined) payload.nicheId = updates.nicheId ?? null`. |
| `app/api/maxwell/lead-searches/route.ts` | Pasar `leadsByNiche` (con `mapLeadRowToWire` aplicado por grupo) en la respuesta cuando exista. |
| `app/dashboard/leads/page.tsx` | `MaxwellSearchResponse.data.leadsByNiche?`; `selectedNicheIds: string[]` con fetch a `/api/maxwell/niche-preferences` al montar para preseleccionar; selector de nicho de 2 niveles antes de los botones de ubicación (`maxSelections=2`); render 2 secciones agrupadas cuando `leadsByNiche` con ≥2 grupos, lista única en otro caso. |
| `app/dashboard/settings/page.tsx` | Nuevo tab `Prospección` (gated por `isSalesOrPm`) con selector de 2 niveles (`maxSelections=2`) que guarda vía `PATCH /api/maxwell/niche-preferences`. |
| `components/lead-form-dialog.tsx` | `LeadFormState.nicheId: string`; `editLead?.nicheId?: string`; selector de 2 niveles `maxSelections=1` entre "Fuente" y "Origen del lead", visible en creación y edición; envío con `nicheId: formData.nicheId \|\| undefined`. |
| `docs/product/maxwell-lead-engine-v1.md` | Addendum: sistema de nichos (selector, 2-nichos/búsqueda, modelo `gpt-5.5`, distribución determinística, contraste vs comportamiento genérico previo). |
| `D:/Pedro/Archivos Pedro/noon-app/roadmap/noonapp-roadmap.md` | Sync per MEMORY.md (ruta absoluta externa al repo). |

### Selector de nicho — componente compartido

El selector de 2 niveles se usa en 3 superficies. La decisión sobre extraer un componente reutilizable vs inline-duplicar queda **delegada a Architecture** (ver §Escalations to Architecture). El spec source no prescribe el componente — solo el comportamiento esperado.

## Dependencies

### Internal (sobre código existente del repo)
- **`lib/server/maxwell/lead-engine.ts`** (727 LOC) — refactor estructural; preserva contratos públicos (`runMaxwellLeadSearch`, `MaxwellLeadSearchResult`, `maxwellAuditSchema`) excepto por la adición de `leadsByNiche?`.
- **`maxwell_search_runs`** (migration 0038) — la nueva columna `niche_ids TEXT[]` aditiva. El insert existente debe seguir compilando porque `niche_ids` es nullable.
- **`leads`** — la nueva columna `niche_id TEXT` aditiva, nullable, sin FK (el catálogo vive en TS, no en DB).
- **`user_profiles`** — la nueva columna `preferred_niche_ids TEXT[] DEFAULT '{}'`. No requiere RLS adicional: el `GET/PATCH` opera sobre el principal autenticado.
- **`app/api/notifications/preferences/route.ts`** — patrón de referencia para el nuevo endpoint.
- **Tipos cliente (`lib/types.ts`, `lib/leads/serialization.ts`, `lib/data-context.tsx`)** — propagación de `nicheId` por el camino frontend.
- **`components/lead-form-dialog.tsx`** — alteración del estado de form sin romper validación.

### External (sobre infraestructura/servicios)
- **OpenAI `gpt-5.5`** — disponibilidad asumida. Plan B: rollback a `gpt-4o-mini` documentado en ADR-026 (R2 resuelto por usuario).
- **Overpass API (OpenStreetMap)** — sin cambios de endpoint. La query whitelist con `["key"="value"]` por nicho debe seguir siendo aceptada (sintaxis estándar OQL). La query genérica existente queda intacta.
- **Supabase remoto `pdotsdahsrnnsoroxbfe`** — la migración `0060` se aplica vía MCP `apply_migration` (Backend); el ledger `supabase_migrations.schema_migrations` se actualiza automáticamente.

### Sobre la sesión paralela (App-nooncode main repo)
- La sesión paralela del usuario está activa con **untracked** `supabase/migrations/0059_phase_23a_prototype_decisions.sql` y `app/api/integrations/website/prototype-decision/` (visible en `git status` del repo principal). No comparten archivos con esta iteración. **Coordinación:** documentar en PR description que ambas iteraciones convergen sobre `develop`; el merge order es libre pero el primero en llegar deja al segundo con un rebase trivial sobre la última migración. No hay dependencia de código entre ambas.

## Risks

### Inherited from Router (R1–R9)

| Code | Description | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R1 | Collision en label `phase_23a` con `0059_phase_23a_prototype_decisions.sql` de la sesión paralela, y collision potencial en prefix si ambas sesiones renumeran al mismo número tras rebase contra `develop` post PR #108. | High (ya observada) | Medium (no rompe nada en runtime pero contamina ledger / búsqueda por phase label) | Medium | Override: migración renombrada a `0061_phase_23b_maxwell_niche_system.sql`, reservando `0060` para la sesión paralela. Contingencia: si la sesión paralela termina sin usar `0060`, renombrar `0061 → 0060` pre-merge (operación trivial: rename SQL + sed en spec/docs, cero impacto en lógica). Decisión congelada en este spec. |
| R2 | Modelo `gpt-5.5` literal puede no existir o fallar en runtime. | Low–Medium | High (rompe el auditor → todos los runs fallan o caen como `failed`) | High | ADR-026 documenta switch, plan de rollback explícito a `gpt-4o-mini` (un cambio de literal en 2 sitios), criterios de aceptación. Resuelto por decisión del usuario: usar `gpt-5.5` literal. |
| R3 | Regenerar `database.types.ts` ahora puede traer drift no controlado de migraciones de la sesión paralela o de cambios remotos no reflejados. | Medium | Medium | Diferido a un PR post-merge dedicado. Casts `(row as any)` confinados a 3 sitios en `mappers.ts` con TODO inventory. Validator devuelve PARTIAL por este motivo. |
| R4 | Tests existentes pueden romper por el cambio de shape (`MaxwellLeadSearchResult.leadsByNiche?`). | Low | Medium | Field es `optional`; no toca tests existentes (regla del spec). Si rompe, Testing surface el detalle y se ajusta sin editar las aserciones existentes. |
| R5 | Endpoint `niche-preferences` puede divergir del patrón de `notifications/preferences` si Architecture no lo congela. | Medium | Low | Architecture produce contrato durable (path, métodos, payload, error codes, RLS posture). |
| R6 | Distribución `5 leads / 2 nichos` con casos borde (un nicho no produce candidatos, ambos producen ≤2, etc.) es ambigua en el spec. | Medium | Medium–High | Algoritmo determinístico debe quedar congelado en Architecture antes de Backend (ver §Escalations). |
| R7 | UI selector de 2 niveles puede inflar el alcance si Architecture no decide el shape del componente compartido. | Medium | Medium | Architecture decide: componente reutilizable vs inline-duplicar. Spec source dice "selector de 2 niveles" sin prescribir reutilización. |
| R8 | `salesSpeech` schema invariance: inyectar `auditHint` al system prompt no debe modificar el shape devuelto por el modelo. | Medium | High (rompe contrato downstream con `components/lead-detail.tsx`) | High | Architecture congela invariance: `maxwellAuditSchema` queda intacto; el cambio es solo en el system prompt (texto). |
| R9 | Coordinación con sesión paralela puede crear conflictos en `docs/context/project.context.core.md` al cierre. | Low | Low | Cada iteración escribe en bullets separados; el merge es trivial. PR description menciona la otra sesión. |

### New risks discovered during analysis

| Code | Description | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R10 | `lib/data-context.tsx` es un archivo grande (~lineal con varias responsabilidades). Tocar `mapLeadDraftToRequest` y `mapLeadUpdatesToRequest` puede colisionar con cambios de otra iteración (refactor wallet/earnings activos en historia reciente). | Low | Low | Cambios son aditivos de 1–2 líneas, en funciones puras. Diff revisable. Si colisiona, rebase trivial. |
| R11 | El `auditHint` está pensado para ser concatenado al system prompt en español. Si el modelo `gpt-5.5` cambia el tono/estructura del speech generado solo por una pista de contexto en el prompt, podría romper aserciones del consumer (`components/lead-detail.tsx`) que esperan ciertas keys. El schema Zod las protege, pero el contenido puede variar. | Medium | Low | El Zod schema (`maxwellAuditSchema.salesSpeech`) ya parsea las variantes (in-person, phone, WhatsApp). Mientras el shape se respete, las variaciones de copy son aceptables. Testing puede agregar smoke con `auditHint` mockeado para asegurar el shape persiste. |
| R12 | La columna `user_profiles.preferred_niche_ids TEXT[] DEFAULT '{}'` requiere que la RLS existente sobre `user_profiles` permita al user actualizar **su propio** registro. Si la política `update` actual está limitada a admin o no contempla `preferred_niche_ids`, el `PATCH` rompe en producción. | Medium | High | **Security** (mandatorio en el chain) revisa la política. Si requiere cambio de RLS, escalar de vuelta a Architecture. Alternativa segura: el endpoint usa `createSupabaseAdminClient()` con service_role, validando que `principal.profileId` coincide con el target. |
| R13 | El catálogo de 126 micro-nichos vive solo en TypeScript. Si un `leads.niche_id` queda con un valor que después se elimina del catálogo, la UI debe degradar gracefully ("Sin nicho" / "Nicho desconocido"). | Low | Low | Selector usa `getNicheById(id)` y trata `undefined` como "nicho desconocido" en lecturas. Sin acción adicional necesaria para V1. |
| R14 | El sistema de nichos cambia parcialmente la query Overpass (whitelist por tags) — si los tags no devuelven nodos en una zona dada (zonas rurales, OSM sin cobertura), la búsqueda devolverá `insufficient` aunque haya leads reales. | Medium | Medium | Comportamiento esperado y aceptable. La UX queda igual que cuando hoy una búsqueda no encuentra resultados. El usuario puede reintentar sin nicho para fallback. Documentar en addendum de `maxwell-lead-engine-v1.md`. |

## Out-of-scope explícito

Lo siguiente NO se toca, NO se refactoriza, NO se "mejora" — incluso si parece tentador:

- **`app/api/leads/[leadId]/route.ts`** — la spec source NO lo lista. El PATCH de lead seguirá funcionando con `nicheId` porque la cadena `data-context → /api/leads → schema → mappers → repository` ya lo propaga.
- **Tests existentes** — `tests/server/maxwell/lead-engine.test.ts`, `tests/server/leads/*`, ningún test existente se edita. Solo se **agregan** tests nuevos.
- **Modelo `gpt-4o-mini` en archivos distintos a `lead-engine.ts`** — si aparece en `lib/server/maxwell/chat.ts` u otros, NO se toca. El switch a `gpt-5.5` está acotado al auditor del Lead Engine.
- **Query Overpass genérico** — cuando `nicheIds` está vacío o ausente, la query existente queda intacta byte-a-byte.
- **Lógica de scoring** (0–100), **deduplicación** (`maxwell_dedupe_key`), **radio dinámico**, **límites de batch** (3 × 20), **filtro `score ≥ 60`**, **límite diario 3 búsquedas/seller** — todos invariantes.
- **Flujo de propuesta, pago, prototipo, hand-off** — invariante.
- **`database.types.ts`** — regeneración diferida.
- **Browser smoke E2E** — diferido por scope.
- **RLS de `leads`, `maxwell_search_runs`** — no requieren cambios porque las columnas nuevas son nullable y no introducen nuevos permisos. Solo `user_profiles.preferred_niche_ids` requiere revisar la política update (ver R12).
- **Migración de leads históricos** — quedan `niche_id = NULL`. Sin backfill.

## Escalations to Architecture

Architecture **debe** congelar los siguientes contratos antes de habilitar Backend o Frontend:

1. **Algoritmo determinístico de distribución 5 leads / 2 nichos** (R6):
   - Casos borde a resolver: (a) nicho A produce 4 candidatos publicables, nicho B produce 1 → ¿4+1 o 3+2 con tie-break? (b) nicho A produce 0, nicho B produce 5 → ¿0+5 o `insufficient`? (c) ambos producen ≥3 → ¿3+3 = 6 (excede 5) o 3+2 con cuál es el "5to" (mayor score global o alternancia)?
   - El spec source dice "El 5to lead va al nicho con el candidato de mayor score disponible" — Architecture debe convertirlo a pseudocódigo determinístico y testeable.

2. **Invariance del schema `maxwellAuditSchema`** (R8): congelar como ADR ligero o nota de Architecture: el cambio de `auditCandidates` para inyectar `auditHint` es **solo prompt-level**; el Zod schema permanece byte-a-byte idéntico. Architecture publica regression-checkpoint para Testing.

3. **ADR-026 `gpt-5.5` model selection** (R2): Architecture confirma o ajusta el ADR. Si confirma, Backend lo aplica como literal; si ajusta a `gpt-4o-mini` por cualquier motivo, Backend NO toca el modelo y Architecture cierra la decisión.

4. **Contract de `/api/maxwell/niche-preferences`** (R5):
   - `GET` → `{ data: { preferredNicheIds: string[] } }`, 200 / 401 / 403.
   - `PATCH` → body `{ preferredNicheIds: string[] }` validado por `z.array(z.string()).max(2)`, 200 / 400 / 401 / 403.
   - Roles permitidos: `sales`, `pm`, `admin`.
   - Cliente Supabase: ¿user-client (requiere RLS update sobre own row) o admin-client (con validación de `principal.profileId === target`)? — decisión de Architecture (ver R12).
   - Logger / rate-limit posture: ¿se aplica el patrón de `lib/server/api/{logger,rate-limit,request}.ts` o queda fuera por baja superficie? Decisión de Architecture.

5. **Wire contract `LeadWire.nicheId` y `leadsByNiche`**:
   - `LeadWire.nicheId: string | null` (congelado por el spec).
   - `leadsByNiche?: Array<{ nicheId: string; nicheLabel: string; leads: LeadWire[] }>` — Architecture confirma o ajusta. Decide si se serializa con `nicheLabel` (DX-friendly, evita doble lookup en cliente) o solo `nicheId` (lookup cliente vía `getNicheById`).

6. **Decisión componente compartido vs inline** (R7): Architecture decide si crear `components/niche-selector.tsx` (o equivalente) reutilizado por los 3 callsites, o si cada callsite implementa el selector inline. Criterio: si los 3 callsites comparten ≥80% de la UI, extraer; si difieren mucho (e.g. `maxSelections` distinto, layout distinto), permitir duplicación controlada.

## Testing methodology

**Methodology**: unit-first, integration-on-demand, no editar tests existentes.

- **No se modifica ningún test existente.** Si un test rompe por la adición de `leadsByNiche?` opcional, eso es un bug real que Backend debe corregir sin tocar la aserción existente.
- **Tests nuevos a agregar** (Testing skill los produce; Backend deja TODO en cada PR de implementación si decide pre-poblar):
  - `tests/server/maxwell/niche-distribution.test.ts` — algoritmo determinístico de 5/2 nichos con todos los edge cases listados en §Escalations #1.
  - `tests/server/maxwell/overpass-niche-whitelist.test.ts` — la query Overpass generada para 1 nicho y 2 nichos incluye los tags correctos y NO contiene la query genérica.
  - `tests/server/api/maxwell/niche-preferences.test.ts` — `GET` y `PATCH` con: rol `developer` recibe 403, rol `sales` puede leer/escribir, `preferredNicheIds.length > 2` rechaza con 400, lista vacía es válida (reset).
  - `tests/server/maxwell/audit-hint-prompt.test.ts` — opcional: con un nicho dado, el system prompt enviado al modelo contiene el `auditHint` exacto; sin nicho, no contiene la línea `Nicho objetivo`.
- **Mocking del modelo**: los tests no deben llamar a OpenAI real. Reusar el patrón de `tests/server/maxwell/lead-engine.test.ts` para mockear `generateObject`.
- **Cobertura mínima**: distribución 5/2 (100% branches), endpoint preferences (happy + 403 + 400), whitelist Overpass (1 niche + 2 niches).
- **Browser smoke diferido** — registrar TODO en PR description y en `docs/context/project.context.core.md` como "needs fresh runtime validation after merge".

## Closure obligations

El Validator no devuelve COMPLETE hasta verificar que existen y están actualizados:

1. **`docs/context/project.context.core.md`** — bullet en la sección "Maxwell Lead Engine V1" describiendo: catálogo de 126 nichos, selector de 2 niveles en 3 superficies, búsqueda secuencial con distribución 5/2, modelo `gpt-5.5`, nuevo endpoint, migración `0061_phase_23b_maxwell_niche_system.sql`, casts `(row as any)` confinados y TODO de regen. Sin R-codes ni Sprint refs (per MEMORY.md).
2. **`specs/fase-23a-maxwell-niche-system.md`** — este archivo. Permanece inmutable después del cierre de la iteración (per CLAUDE.md).
3. **`docs/adrs/ADR-026-maxwell-lead-engine-gpt-5-5-model-selection.md`** — NEW, **condicional a Architecture**. Si Architecture confirma el switch, Docs lo cierra como `Accepted`; si Architecture lo rechaza, ADR no se crea y se documenta el rechazo en el spec de cierre.
4. **`docs/product/maxwell-lead-engine-v1.md`** — addendum con: tabla de modelos actualizada, sección "Sistema de nichos", referencia al endpoint `/api/maxwell/niche-preferences`, mención de la distribución 5/2.
5. **`D:/Pedro/Archivos Pedro/noon-app/roadmap/noonapp-roadmap.md`** — sync per MEMORY.md (ruta absoluta externa al repo, no en git de este worktree).
6. **PR description** — debe incluir:
   - Inventario explícito de los 3 casts `(row as any)` en `mappers.ts` con TODOs.
   - Razón de diferir `database.types.ts` regen + plan del PR post-merge.
   - Razón de diferir browser smoke + plan de validación post-merge.
   - Coordinación con la sesión paralela (`0059_phase_23a_prototype_decisions.sql`), con explicación del override `phase_23a → phase_23b`.
   - Confirmación de que ningún test existente fue modificado.
   - Resumen de archivos nuevos / modificados (4 / 11).

## Success criterion

La iteración es COMPLETE-pending-validation cuando:
- `pnpm test` pasa (incluyendo los nuevos tests unitarios) y ningún test pre-existente fue editado.
- `pnpm build` / `pnpm typecheck` pasan con los casts `(row as any)` en su lugar (solo 3 sitios, todos con TODO).
- La migración `0061_phase_23b_maxwell_niche_system.sql` se aplica idempotentemente contra `pdotsdahsrnnsoroxbfe` vía MCP `apply_migration` y el ledger refleja la fila.
- `app/api/maxwell/lead-searches` acepta payload con `nicheIds: [<id>]` o `nicheIds: [<id1>, <id2>]` sin romper el modo sin-nicho.
- `app/api/maxwell/niche-preferences` responde `GET` y `PATCH` con la validación esperada por rol.
- Los 3 selectores UI (`leads/page.tsx`, `settings/page.tsx`, `lead-form-dialog.tsx`) compilan y renderizan el selector de 2 niveles con `maxSelections` correcto en cada uno.
- El Validator devuelve **PARTIAL** con la razón explícita: "browser smoke + types regen diferidos por diseño" (resultado esperado per Router §5).

## Lifecycle

| Field | Value |
|---|---|
| State | `active` |
| Created | 2026-05-25 |
| Supersedes | none |
| Superseded by | none |
| Closed | TBD (al merge del PR) |
| Follow-ups esperados | (1) PR post-merge para regenerar `database.types.ts` y eliminar los 3 casts `(row as any)`; (2) iteración de browser smoke E2E del flujo nuevo; (3) eventual rollback a `gpt-4o-mini` si `gpt-5.5` falla en runtime (ADR-026 lo cubre). |

## Handoff payload to Architecture

- **Task summary**: añadir sistema de nichos a Maxwell Lead Engine V1 (catálogo 20/126, selector 2-niveles, distribución 5/2, modelo `gpt-5.5`, endpoint preferences, migración aditiva `0060_phase_23b`).
- **Scope boundary**: explícito en este spec, secciones Goal e Out-of-scope.
- **Included / excluded files**: tablas Affected files y Out-of-scope.
- **Dependencies**: internas (Lead Engine, migration system, notifications-preferences pattern), externas (OpenAI `gpt-5.5`, Overpass), coordinación con sesión paralela.
- **Assumptions**: `gpt-5.5` está disponible; RLS update sobre own `user_profiles.preferred_niche_ids` es viable (Architecture/Security confirma); distribución 5/2 acepta tie-break por max score.
- **Open questions** (escaladas explícitamente):
  1. ¿Pseudocódigo exacto del algoritmo determinístico de distribución? (R6 / §Escalations #1)
  2. ¿`auditHint` solo en prompt o también afecta schema? (R8 / §Escalations #2 — esperado: solo prompt)
  3. ¿`niche-preferences` usa user-client + RLS o admin-client + principal-check? (R12 / §Escalations #4)
  4. ¿`leadsByNiche` incluye `nicheLabel` o solo `nicheId`? (§Escalations #5)
  5. ¿Componente compartido o inline-duplicado? (R7 / §Escalations #6)
- **Risks that may alter design**: R6, R8, R12 son los críticos. R2 está mitigado por decisión usuario + ADR-026.
- **Recommended depth**: FULL (Router ya decidió).
- **Chunking decision**: single iteration (default). Contingencia: si Architecture surface complejidad inesperada en algún sub-problema (e.g. distribución determinística trivialmente correcta es imposible sin breaking-change), proponer re-chunk en (A) catálogo + tipos + migración, (B) engine + endpoint, (C) UI — pero solo si Architecture lo justifica.
- **Success criterion**: explícito en §Success criterion.
