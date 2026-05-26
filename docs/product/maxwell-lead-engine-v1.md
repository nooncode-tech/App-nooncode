# Maxwell Lead Engine V1 - NoonApp Product Context

## Source documents

Canonical source PDFs are versioned in this repo:

- `docs/product/source/LeadEngine_Codex_FIXED.pdf`
- `docs/product/source/NoonApp_Seller_Speech_Codex_Addendum.pdf`

This Markdown file is the operational digest for future engineering sessions. If the PDFs and this digest disagree, inspect the PDFs first and update this digest after validating repo reality.

## Product boundary

Maxwell Lead Engine V1 belongs only to NoonApp outbound.

- Website is out of scope.
- Website inbound Maxwell is out of scope.
- Payments, client workspace, post-payment handoff, developer board, earnings rules, and sensitive permissions are out of scope unless a later plan explicitly scopes them.
- The module exists to help sellers find, audit, qualify, and work nearby outbound leads inside NoonApp.

The expected product path is:

1. Seller opens NoonApp, preferably from mobile.
2. Seller searches nearby leads using current location or a manual zone fallback.
3. The server calculates the allowed radius from confirmed won sales.
4. Maxwell finds candidates, audits them, scores them, filters duplicates and low-quality leads, and saves only actionable opportunities.
5. Leads appear in the seller board with compact cards and detailed expandable audit context.
6. Seller can work the lead, request a prototype if useful, and provide feedback on lead quality.

## Hard product rules

- Quality before volume. Do not publish weak leads just to fill the board.
- Published leads require score >= 60.
- Leads need a clear pain, observable evidence, a concrete Noon solution, useful contact channel, and seller action.
- High priority is score 80+.
- If data is inferred, mark it as probable or low confidence. Do not present guesses as facts.
- Do not use paid external tools for V1.
- Use GPT-first reasoning with free optional helpers only when they do not block the flow.
- Do not create duplicate businesses. Reuse, enrich, or review existing records.
- If fewer than 3 strong leads are found after limits, show the valid leads and mark the search as insufficient.

## Current implementation audit

| Requirement | Status | Repo evidence |
|---|---|---|
| Seller starts search from NoonApp leads page | implemented | `/dashboard/leads`, `POST /api/maxwell/lead-searches` |
| Current location search | implemented | browser geolocation in `app/dashboard/leads/page.tsx` |
| Manual zone fallback | implemented | manual zone dialog plus Nominatim geocoding |
| Radius by confirmed won sales | implemented | `maxwell_confirmed_sales_count(uuid)` and `radiusKmForConfirmedSales(...)` |
| PM/Admin wider radius | implemented | role radius logic in `lib/server/maxwell/lead-engine.ts` |
| Free candidate source | implemented | OpenStreetMap Overpass and Nominatim |
| GPT-first audit | implemented | `generateObject(...)` with structured Zod schema |
| Strict score >= 60 publish rule | implemented | server-side publish filter |
| Batch limits 20 candidates, 3 batches, max 60 | implemented | `chunkCandidates(..., 20).slice(0, 3)` |
| Publish 3-5 leads or insufficient result | implemented | server returns `completed` or `insufficient` |
| Duplicate prevention | implemented | `maxwell_dedupe_key` unique index plus server duplicate check |
| Structured lead snapshot | implemented | `maxwell_snapshot` stores business, audit, opportunity, scoring, objections, speech, and source |
| Compact lead card | implemented | `components/lead-card.tsx` keeps Maxwell summary compact |
| Full details surface | implemented | `components/lead-detail.tsx` shows Maxwell audit details and speech section |
| Seller speech variants | implemented | `MaxwellSalesSpeech` with in-person, phone, and WhatsApp variants |
| Browser/device text-to-speech | implemented | `speechSynthesis` and `SpeechSynthesisUtterance` in lead detail |
| Copy speech | implemented | lead detail copy action |
| TTS fallback | implemented | text remains visible and copyable when speech synthesis is unavailable |
| Seller feedback/reporting | implemented | `maxwell_lead_feedback` and `/api/leads/[leadId]/maxwell-feedback` |
| Prototype request from lead | implemented | `components/lead-prototype-card.tsx` and `/api/leads/[leadId]/prototype` |
| Take lead workflow | partial | Maxwell-created leads are assigned to requester; released leads can be claimed, but there is no separate "take Maxwell lead" publication marketplace yet |
| Search progress states | partial | UI stages exist, but they are client-side timer states rather than server-streamed stage updates |
| Metrics from spec | partial | search runs and feedback are durable; full event set such as lead_viewed, lead_contacted, and lead_reported_* is not fully instrumented as separate analytics |
| Runtime smoke after latest PDFs | needs runtime validation | build/type/lint and browser checks still need to be rerun after this documentation sync |

## Seller speech requirements

Every Maxwell-generated lead should include a `salesSpeech` block.

Required variants:

- `inPerson`: for in-person/local visit, approximately 45-75 seconds.
- `phoneCall`: for short phone call, approximately 20-40 seconds.
- `whatsapp`: for first written contact, 3-6 lines.

Tone rules:

- Helpful, local, consultative, and low pressure.
- Based on the audited business, detected pain, evidence, Noon opportunity, prototype idea, and recommended seller action.
- Never aggressive, manipulative, invasive, or guarantee-based.
- Use prudent language for inferred issues: "could", "possible", "opportunity", "may help".

UI rule:

- Do not put the full speech in the compact lead card.
- Keep the compact card focused on score, pain, opportunity, tags, and actions.
- Speech lives in lead details with controls for variant selection, play, stop, and copy.

## Security and audit notes

Current Supabase Advisor pending items are intentionally not solved by this product-context sync:

- `Leaked password protection` must be enabled manually in Supabase Auth settings.
- The remaining authenticated RPC warnings are currently intentional and documented as hardening debt.
- Strict-audit hardening would move sensitive RPC actions behind Next.js server routes using `service_role`, then revoke direct `authenticated` execute grants.
- Do not mix that hardening into Maxwell product work unless a dedicated security plan scopes every affected flow.

Known authenticated RPCs that require careful treatment before strict audit closure include proposal review, lead claim/release, wallet/prototype flows, prototype handoff, and Maxwell radius calculation.

## Recommended next slice

Before adding more Maxwell behavior, run a focused runtime validation:

- `npm.cmd run typecheck`
- `npm.cmd run lint`
- `npm.cmd run build`
- Browser smoke on `/dashboard/leads`

Then validate:

- current-location search and permission denial fallback
- manual-zone search
- insufficient leads result
- duplicate prevention
- lead detail audit content
- speech variant switching, play, stop, copy, and no-TTS fallback
- feedback submission
- prototype request path from a Maxwell lead

Any missing behavior should be implemented as a small Leads/Maxwell slice only. Do not reopen website, inbound, payments, workspace, developer board, or post-payment logic.

## Addendum — Sistema de nichos (Maxwell V1.1)

Esta iteración añade segmentación por nicho al Lead Engine V1 sin romper el flujo genérico.

### Catálogo

- 20 familias de negocio agrupando 126 micro-nichos (`lib/server/maxwell/niches.ts`).
- Cada micro-nicho declara `overpassTags` (whitelist de tags OSM) y `auditHint` (pista de contexto que se inyecta al system prompt del auditor).
- El catálogo vive en TypeScript (sin FK en DB). Si un `leads.niche_id` queda con un id obsoleto, la UI lo trata como "Nicho desconocido".

### Búsqueda por nicho

- El payload de `/api/maxwell/lead-searches` acepta opcionalmente `nicheIds: string[]` (máximo 2). IDs desconocidos se descartan silenciosamente vía whitelist.
- Cuando hay nichos, Maxwell ejecuta búsquedas Overpass **secuenciales**, una por nicho, con la whitelist `[key=value]` correspondiente.
- Distribución 5 leads / 2 nichos (Architecture C1) — algoritmo en dos fases:
  - **Fase 1 — recolección por nicho**: cada nicho se audita secuencialmente y recolecta hasta 3 audits publicables (cap suficiente para el escenario peor del 2-nichos). En modo 1-nicho/genérico el cap sube a 5.
  - **Fase 2 — asignación con tie-break** (`allocateLeads`):
    - 0/1 nicho: cap = `min(pool.length, 5)`.
    - 2 nichos, ambos con ≥3 publicables: el nicho con `max(topScore)` toma 3, el otro 2. Empate de topScore → desempate lexicográfico por `nicheId` (menor recibe 3).
    - 2 nichos con slack (uno < 3 publicables): el otro absorbe hasta total = 5. Casos canónicos: `[1, 4]`, `[3, 1]`, `[0, 5]`, `[2, 2]`.
  - Los leads se insertan en orden determinístico (orden del request × ranking interno por score descendente).
- El límite diario de 3 búsquedas/seller cuenta **por request HTTP**, no por nicho.
- El cap de 60 candidatos por audit pass aplica **por nicho**, no agregado.

### Modelo

- Auditor: `openai('gpt-5.5')` reemplaza `gpt-4o-mini` (ADR-026). Rollback = revertir un único literal.
- El `salesSpeech` calibra el tono al nicho via `auditHint` en el system prompt. El schema `maxwellAuditSchema` es invariante.

### Búsqueda genérica preservada

Cuando `nicheIds` está ausente o vacío, la query Overpass es byte-idéntica a la legacy (`amenity|shop|tourism|office|craft|healthcare`). El comportamiento histórico no cambia.

### Endpoint nuevo

`GET / PATCH /api/maxwell/niche-preferences` (`sales` | `pm` | `admin`):

- Almacena `user_profiles.preferred_niche_ids` (array de hasta 2 ids del catálogo).
- Admin-client con ownership pin (`.eq('id', principal.userId)`).
- Whitelist server-side: `getNicheById` rechaza ids desconocidos con `400 NICHE_UNKNOWN`.

### UI

- **`/dashboard/leads`**: selector de 2 niveles (familia → micro-nicho) con `maxSelections=2`, hidratado desde `niche-preferences`. Resultados agrupados por nicho cuando hay grupos; lista única en otro caso.
- **`/dashboard/settings` → tab Prospección** (gated `sales|pm|admin`): persiste preferencias vía PATCH.
- **Formulario manual de lead**: selector con `maxSelections=1` entre "Fuente" y "Origen del lead".

### Limitaciones conocidas

- Zonas rurales sin cobertura OSM detallada pueden devolver `insufficient` cuando se filtra por nicho. Workaround: reintentar sin nichos para fallback genérico.
- Browser smoke E2E del flujo nuevo queda diferido (Validator devuelve PARTIAL por diseño).
- `database.types.ts` no se regenera en esta PR; existen 3 casts confinados en `mappers.ts` + 4 casts puente en `repository.ts` con TODOs.

### Migración

`supabase/migrations/0061_phase_23b_maxwell_niche_system.sql` agrega 3 columnas nullable y aditivas: `leads.niche_id TEXT`, `maxwell_search_runs.niche_ids TEXT[]`, `user_profiles.preferred_niche_ids TEXT[] DEFAULT '{}'`. Idempotente, sin cambios de RLS.
