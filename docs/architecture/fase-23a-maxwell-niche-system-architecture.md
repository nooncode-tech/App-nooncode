# Architecture — Maxwell Lead Engine V1: Sistema de Nichos

| Field | Value |
|---|---|
| Iteration | `fase-23a-maxwell-niche-system` |
| Spec source | `specs/fase-23a-maxwell-niche-system.md` (authoritative) |
| Handoff source | `docs/handoffs/2026-05-25-maxwell-niche-system-spec.md` |
| Architecture date | 2026-05-25 |
| Status | Frozen — Backend ∥ Frontend may implement against these contracts |
| Outcome | Ready (handoff to Backend ∥ Frontend) |

This document **freezes 6 contracts** for the niche-system iteration. Backend and Frontend must implement against these literal contracts. Any divergence reroutes to Architecture. Anything not specified here is governed by the spec or is preserved as-is from current behavior.

---

## C1 — Deterministic 5-leads / 2-niches distribution algorithm

### Inputs

```typescript
interface DistributionInput {
  niches: Niche[]              // 0, 1, or 2 entries; resolved via getNicheById(); unknown ids dropped upstream
  candidatesByNiche: Map<string, Candidate[]>
  // key: niche.id (or "__generic__" when niches.length === 0)
  // value: post-dedupe candidate pool already filtered by hasUsefulContact
  totalCap: 5                  // hard global cap
}

interface DistributionOutput {
  perNicheTargets: Map<string, { maxToPublish: number; minRequired: number }>
  // The engine still runs auditCandidates per chunk; this only constrains
  // how many publishable audits are accepted per niche before moving on.
  flags: {
    minNotMet: boolean         // at least one niche fell below its minimum quota
    fallbackAbsorbed: boolean  // the other niche absorbed slack
  }
}
```

### Cases (matrix)

| Case | niches.length | A available | B available | Outcome | Rationale |
|------|---------------|-------------|-------------|---------|-----------|
| 0 | 0 | n/a | n/a | Generic mode preserved byte-identical. One bucket `__generic__` with target `{ max:5, min:1 }`. | Backward compat. No change to historical behavior. |
| 1 | 1 | 5+ | n/a | A gets `{ max:5, min:1 }`. | Single-niche specialization. |
| 1 | 1 | <5 | n/a | A publishes all it can; status `insufficient` if `<3` (existing rule preserved). | No change to insufficient rule. |
| 2 | 2 | ≥3 | ≥3 | A `{ max:3, min:2 }`, B `{ max:3, min:2 }`. Total 5: who gets the 5th = tie-break (see below). | Spec §Distribución “mínimo 2 por nicho”. |
| 2 | 2 | =4 | =1 | **A `{ max:5, min:2 }`, B `{ max:5, min:2 }`. B falls short → A absorbs.** `flags.minNotMet=true`, `flags.fallbackAbsorbed=true`. Final: 4 from A, 1 from B = 5 total. | Graceful fallback. Decision: do NOT force `insufficient` just because B<min; the seller still gets value. |
| 2 | 2 | =0 | =5 | B publishes 5. `flags.minNotMet=true` (A=0<2). Equivalent to single-niche mode for B. | Same fallback principle. |
| 2 | 2 | =0 | =0 | Both empty → `insufficient` globally. | Existing rule. |
| 2 | 2 | =1 | =1 | 1+1=2 published; status `insufficient` (publishedLeads < 3 per existing rule). `flags.minNotMet=true`. | Existing `insufficient` rule still governs. |

### Tie-break for "who gets the 5th" (case A≥3 ∧ B≥3)

```
Compute topScoreA = max(audit.scoring.total) over A's published-and-pending pool.
Compute topScoreB = max(audit.scoring.total) over B's published-and-pending pool.
IF topScoreA > topScoreB  → 5th lead goes to A.
IF topScoreB > topScoreA  → 5th lead goes to B.
IF topScoreA == topScoreB → 5th lead goes to the niche whose id is lexicographically smaller.
```

The tie-break is deterministic (no `Math.random`, no insertion order dependence beyond what the alphabetical sort guarantees).

### Pseudocode (engine integration)

```
nicheIds = request.nicheIds ?? []
niches   = nicheIds.map(getNicheById).filter(Boolean)   // unknown ids silently dropped
searchTargets = niches.length > 0 ? niches : [undefined] // undefined => generic

allPublished = []
publishedByNicheId = new Map()   // nicheId -> Lead[]; key '__generic__' for the undefined case
auditedCount = 0
rejectedCount = 0
duplicateCount = 0

FOR EACH niche IN searchTargets:
  IF allPublished.length >= 5: break

  // Per-niche caps decided up front (Case matrix above)
  IF niches.length == 2:
    nicheMax = 3
    nicheMin = 2
  ELSE:
    nicheMax = 5
    nicheMin = 1
  // Slack absorption: if the previous niche under-published vs its max,
  // expand this niche's cap by the slack (so e.g. A=4 B=1 still totals 5).
  slack = 5 - allPublished.length - nicheMax
  IF slack > 0 AND niches.length == 2: nicheMax = min(5 - allPublished.length, nicheMax + slack)

  candidates = fetchCandidates(baseCenter, radiusKm, niche)  // whitelist Overpass per niche
  dedup      = dedupeAgainstLeadsTable(candidates)
  unique     = candidates without dup-keys
  publishedThisNiche = []

  FOR EACH chunk in chunkCandidates(unique.slice(0, 60), 20).slice(0, 3):
    IF publishedThisNiche.length >= nicheMax: break
    IF allPublished.length >= 5: break
    audits = auditCandidates(chunk, locale, radiusKm, niche)
    auditedCount += chunk.length
    FOR EACH audit in audits:
      IF publishedThisNiche.length >= nicheMax: break
      IF allPublished.length >= 5: break
      IF isValid(audit):
        lead = createLead(... buildLeadInsert(principal, runId, candidate, audit, niche))
        publishedThisNiche.push(lead)
        allPublished.push(lead)
      ELSE:
        rejectedCount += 1

  publishedByNicheId.set(niche?.id ?? '__generic__', publishedThisNiche)

// After both niches processed, if we ran A first and stopped at exactly 3 because A had 4
// available but cap was 3, AND B published <3, do a "5th-lead reclaim" pass on A's leftover
// audited+publishable buffer. (Optional refinement; if implementation buffer doesn't exist,
// skip — case matrix permits A=3 B=2 as the canonical 5/2 outcome.)
```

### Per-niche cap = 60 candidates (NOT aggregated)

The existing `slice(0, 60)` cap that bounds Overpass results into auditing applies **per niche**, not aggregated. Rationale: the 60-candidate ceiling exists to bound the OpenAI cost per audit pass. Each niche is its own audit pass; sharing 60 between two niches would starve the less-covered niche.

### Daily search limit = 1 per request, NOT per niche

`assertDailySearchLimit` counts `maxwell_search_runs` rows per `requested_by` per day. **One row per HTTP request is inserted, regardless of how many niches that request runs sequentially.** A search with `nicheIds: [a, b]` counts as 1 of the 3 daily searches. Rationale: the user pressed "Buscar" once; charging two of three daily attempts because the system internally iterates niches would be a UX surprise.

### Status determination (preserved + extended)

```
status = allPublished.length >= 3 ? 'completed'
       : allPublished.length >  0 ? 'insufficient'
       : 'insufficient'
```

The `flags.minNotMet` and `flags.fallbackAbsorbed` are **logged** (server log + `maxwell_search_runs.message`) but do not change the HTTP status. The wire response is unchanged in shape; the `leadsByNiche` array surfaces the per-niche reality (e.g., `leads: []` for a niche that returned nothing).

---

## C2 — `maxwellAuditSchema` invariance

### Frozen guarantee

The Zod schema `maxwellAuditSchema` (lines 38–103 of `lib/server/maxwell/lead-engine.ts`) is **byte-identical** before and after this iteration. Backend may NOT add, remove, rename, or re-type any field in this schema. No optional fields, no additional unions, no extra keys on `salesSpeech`, no changes to `scoring`, no changes to `audit.pains`.

### Where the change lands

`auditCandidates(candidates, locale, radiusKm, niche?)`:

- The function signature gains one optional positional argument `niche?: Niche`.
- When `niche` is provided, the `system` prompt has **one extra line** inserted **before** the existing `No prometas resultados garantizados.` line:

```
${niche ? `\nNicho objetivo: ${niche.label}. Contexto adicional: ${niche.auditHint}` : ''}
```

- When `niche` is `undefined`, the `system` prompt is byte-identical to today's prompt.
- `model: openai('gpt-5.5')` replaces `model: openai('gpt-4o-mini')` per ADR-026. Two literal sites: line 415 in current file (and any chat-companion call — confirmed only one inside `lead-engine.ts`).

### Consumers protected

The following consumers read fields of the audit object and remain operational without modification:

- `buildLeadInsert(...)` reads `audit.business.*`, `audit.audit.*`, `audit.opportunity.*`, `audit.scoring.*`, `audit.confidence`, `audit.objections`, `audit.salesSpeech` → all unchanged.
- `components/lead-detail.tsx` reads `lead.maxwell_snapshot.audit.*`, `.opportunity.*`, `.scoring.*`, `.salesSpeech.*` → all unchanged.
- `maxwell_lead_feedback` table receives ratings on published leads → schema unchanged, FK unchanged.
- `tests/server/maxwell/lead-engine.test.ts` and friends → no editing required (R4 holds).

### Regression checkpoint for Testing

Recommended (not blocking): a unit test that mocks `generateObject` and asserts the system prompt sent to the model:
- Without `niche`: prompt contains `gpt-5.5`-era body, **does not** contain `Nicho objetivo`.
- With `niche`: prompt contains the literal `Nicho objetivo: ${niche.label}. Contexto adicional: ${niche.auditHint}`.

---

## C3 — ADR-026 reference

Full ADR lives at `docs/adrs/ADR-026-maxwell-lead-engine-gpt-5-5-model-selection.md` (created in the same iteration as this document).

Architectural decision summary (binding on Backend):

- Replace `openai('gpt-4o-mini')` with `openai('gpt-5.5')` **only inside `lib/server/maxwell/lead-engine.ts`**. Two sites: the `auditCandidates` declaration body (currently line 415) and any companion `generateObject` call inside the file. Other usages of `gpt-4o-mini` elsewhere in the repo are out of scope.
- Rollback is a one-line revert of the literal at each site. Backend records the line numbers in the PR description for trivial rollback later.
- Runtime availability of the `gpt-5.5` model ID is not Architecture-validated; it is a runtime smoke-test obligation for the PR reviewer / operator before merging to `develop`. Spec already documents this as `PARTIAL`-acceptable.

---

## C4 — `/api/maxwell/niche-preferences` endpoint contract

### Path

`app/api/maxwell/niche-preferences/route.ts` (new)

### Auth

Reuse `getCurrentPrincipal()` from `lib/server/auth/session`. The principal type already exposes `userId` and `role`.

### Role gate

Allowed roles: `'sales'`, `'pm'`, `'admin'`. Any other role (including `'sales_manager'` and `'developer'`) returns `403`.

Rationale for excluding `sales_manager`: a sales_manager does not personally run Maxwell searches (it is a sales-personal preference); admin can preview as a maintainer. If product later opens this to `sales_manager`, this is a one-line whitelist extension.

### GET

```
GET /api/maxwell/niche-preferences

Auth:   required
Roles:  sales | pm | admin (else 403)

Response 200:
  { data: { preferredNicheIds: string[] } }

Notes:
  - Empty array `[]` is a valid state (user has not yet picked).
  - Unknown ids that may have survived from a future catalog change are
    returned as-is — server does not silently strip; client decides via
    getNicheById() whether to render or treat as "unknown".

Errors:
  401  { error: 'Unauthorized', requestId? }
  403  { error: 'Forbidden',    requestId? }
  500  { error: '<msg>',         requestId? }
```

### PATCH

```
PATCH /api/maxwell/niche-preferences
Content-Type: application/json

Body schema (Zod):
  z.object({
    preferredNicheIds: z.array(z.string()).max(2)
  })

Server-side post-Zod validation (whitelist):
  for each id in body.preferredNicheIds:
    if getNicheById(id) === undefined:
      return 400 with body
        { error: 'Invalid niche id', code: 'NICHE_UNKNOWN', invalidId: id, requestId? }

Response 200:
  { data: { preferredNicheIds: string[] } }   // echo of the saved state

Errors:
  400  { error: 'Validation failed', code?: 'NICHE_UNKNOWN', invalidId?, requestId? }
  401  { error: 'Unauthorized', requestId? }
  403  { error: 'Forbidden',     requestId? }
  500  { error: '<msg>',          requestId? }
```

### Supabase client choice — DECISION: **admin client + explicit ownership check**

```typescript
const adminClient = createSupabaseAdminClient()
const { error } = await adminClient
  .from('user_profiles')
  .update({ preferred_niche_ids: body.preferredNicheIds })
  .eq('id', principal.userId)     // explicit ownership pin
```

**Why not the user-client (anon JWT)?**

The existing migration `0001_phase_1a_auth_profiles.sql` grants column-level UPDATE only to `(full_name, avatar_url, locale, timezone, last_login_at)`. The `policy "profiles_update_self_limited"` permits the row, but Postgres still enforces the column grant, which means an `UPDATE ... SET preferred_niche_ids = ...` from the `authenticated` role would silently no-op or error. The same constraint applies to `notification_preferences` (added by `0031`) — that endpoint may be relying on out-of-band grant changes, and Architecture is **not** going to inherit that hidden coupling.

Going admin-client gives us:
- Independence from a column-level grant migration we don't want to author here (would expand scope).
- Explicit ownership check in code (`principal.userId === target.id`) that is reviewable and testable.
- Pattern parity with `lib/server/website-integration.ts`, `lib/server/prototypes/service.ts`, `lib/server/payments/refund-service.ts`.

**Security note** (forwarded to Security skill): the admin client bypasses RLS, so the route handler MUST pin `.eq('id', principal.userId)` on both the SELECT (GET) and UPDATE (PATCH) statements. The handler MUST NEVER accept a target user id from the request body or query string.

### Logger / rate-limit posture

- Use `withRequestLogger` (or the equivalent `lib/server/api/logger.ts` helper used by recently added routes — confirm against `app/api/notifications/preferences/route.ts` and one freshly merged route; if older `toErrorResponse` pattern is the local convention, that is also acceptable for parity).
- No dedicated per-IP rate-limit. Justification: low surface, low payload, gated by auth + role. The general infra rate-limit (if any at the platform level) is sufficient.
- The `requestId` must be propagated to error envelopes (per existing convention).

### Side effects

- DB write: `user_profiles.preferred_niche_ids` updated.
- Trigger `trg_user_profiles_updated_at` fires (already exists) → `updated_at` bumps.
- No notifications, no audit log entries (out of scope for V1).

---

## C5 — Wire contract `LeadWire.nicheId` and `leadsByNiche`

### `LeadWire.nicheId`

```typescript
// lib/leads/serialization.ts
export interface LeadWire {
  // ... existing fields ...
  nicheId: string | null     // wire is JSON-friendly; explicit null over undefined
}

export function deserializeLead(lead: LeadWire): Lead {
  return {
    // ... existing fields ...
    nicheId: lead.nicheId ?? undefined,
  }
}
```

```typescript
// lib/types.ts
export interface Lead {
  // ... existing fields ...
  nicheId?: string           // domain-side: undefined when absent
}
```

Mapping invariant: `null` on the wire ↔ `undefined` on the domain. Backend mappers honor this both directions.

### `leadsByNiche` in `/api/maxwell/lead-searches` response

```typescript
{
  data: {
    runId: string
    status: 'completed' | 'insufficient' | 'needs_review' | 'failed'
    leads: LeadWire[]                                  // flat list, always present
    leadsByNiche?: Array<{                             // present iff request.nicheIds.length > 0
      nicheId: string
      nicheLabel: string                               // resolved server-side; client need not lookup
      leads: LeadWire[]                                // may be empty []; the entry still appears
    }>
    counts: SearchCounts
    radiusKm: number
    message: string
  }
}
```

Frozen invariants:

- `leadsByNiche` is `undefined` when the request was niche-less. UI falls back to the flat `leads` list.
- When present, `leadsByNiche` includes **all** niches sent in the request, in the request order, even if `leads.length === 0` for some of them. This lets the UI render "Nicho X: sin resultados" without inferring missing groups.
- `nicheLabel` comes from `getNicheById(nicheId).label` server-side at response build time. If `getNicheById` returns `undefined` (catalog drift; shouldn't happen mid-request), the entry is **omitted** from the array (defensive, no exception).
- The flat `leads` list is the union of all `leadsByNiche[].leads` and remains the authoritative "everything published this run" list. Order: niche A's leads followed by niche B's leads (same order as `request.nicheIds`).

### `MaxwellLeadSearchResult` (server-side internal type)

```typescript
export interface MaxwellLeadSearchResult {
  runId: string
  status: 'completed' | 'insufficient' | 'needs_review' | 'failed'
  leads: LeadRowWithProfiles[]
  leadsByNiche?: Array<{
    nicheId: string
    nicheLabel: string
    leads: LeadRowWithProfiles[]
  }>
  counts: SearchCounts
  radiusKm: number
  message: string
}
```

The route handler maps `LeadRowWithProfiles[]` → `LeadWire[]` via `mapLeadRowToWire` per group.

### `data-context.tsx` propagation (additive, ≤2 lines per mapper)

```typescript
// mapLeadDraftToRequest
return {
  // ... existing fields ...
  nicheId: leadData.nicheId ?? null,
}

// mapLeadUpdatesToRequest
if (updates.nicheId !== undefined) {
  payload.nicheId = updates.nicheId ?? null
}
```

---

## C6 — Shared component: `components/maxwell/niche-selector.tsx`

### Decision: shared component (NOT inline)

The 3 callsites (`app/dashboard/leads/page.tsx`, `app/dashboard/settings/page.tsx`, `components/lead-form-dialog.tsx`) differ only in `maxSelections` (1 vs 2) and surrounding layout. Visual model (family chips → expand to micro-niches → checkbox/selection) is identical. Extracting avoids ≥80% UI duplication and centralizes the catalog rendering behavior.

### File

`components/maxwell/niche-selector.tsx` (new — placed under `components/maxwell/` to mirror the server-side `lib/server/maxwell/` namespace).

### Props (frozen)

```typescript
import type { Niche, NicheFamily } from '@/lib/server/maxwell/niches'

export interface NicheSelectorProps {
  selectedIds: string[]                     // controlled — parent owns state
  onChange: (ids: string[]) => void         // emits next selectedIds (full replacement)
  maxSelections: number                     // 1 for lead-form-dialog, 2 for leads/settings
  disabled?: boolean                        // disables all interaction
  className?: string                        // wrapper className passthrough
}
```

### Behavior contract

- Renders the 20 families from `NICHE_FAMILIES` as compact chips/cards.
- Click on a family expands its micro-niches (resolved via `getNichesByFamily(familyId)`). Only one family is expanded at a time (collapses the previously expanded one).
- Click on a micro-niche toggles its presence in `selectedIds`. The component calls `onChange(nextIds)` with the full new array (controlled component pattern).
- When `selectedIds.length >= maxSelections`, micro-niches NOT already in `selectedIds` render as disabled (visual cue + click no-op). Already-selected items remain clickable (to deselect).
- The selected count is displayed: `"X / maxSelections seleccionados"`.
- Each selected micro-niche shows a small "Quitar" affordance (close icon) to remove it without expanding its family.
- Family labels come from `NICHE_FAMILIES[i].label`; micro-niche labels from `Niche.label`.
- Empty `selectedIds` is a valid render state (no items chosen).
- `disabled` prop disables every chip and every checkbox.
- `className` is appended to the outermost wrapper.

### Out of scope for the component

- The component does **not** fetch the user's preferred niches. The parent (e.g. `leads/page.tsx`, `settings/page.tsx`) fetches `/api/maxwell/niche-preferences` and passes the returned `preferredNicheIds` as the initial `selectedIds`.
- The component does **not** call the PATCH endpoint. The parent decides when to persist (immediate vs on-button-click).
- The component does **not** import any server-side modules at runtime. The Niche / NicheFamily types and helpers come from `lib/server/maxwell/niches.ts` — TypeScript type-only imports plus pure-data exports (`NICHE_FAMILIES`, `NICHES`, `getNichesByFamily`) are safe to import from a Client Component because the file is data-only (no `import 'server-only'`). Backend MUST keep `niches.ts` free of server-only imports (no `cookies()`, no `createSupabaseAdminClient()`, no env-dependent code).
- The component does NOT render a search/typeahead for niches in V1. Family-first browsing is the only interaction model.
- The component does NOT need tests for V1. Frontend may leave a `TODO(testing)` if it wishes.

### Visual hints (non-binding, Frontend may iterate)

- Families as `<button>` chips in a wrapping flex row.
- Expanded micro-niches as a vertically stacked list of `<label>` rows with a checkbox or pressable item.
- Counter rendered above the family chips.
- Use existing Tailwind/shadcn primitives consistent with `settings/page.tsx` and `lead-form-dialog.tsx`.

---

## Module boundaries

| Module | Owns | Does NOT own |
|--------|------|--------------|
| `lib/server/maxwell/niches.ts` | The catalog (20 families, 126 micro-niches) and pure helpers (`getNicheById`, `getNichesByFamily`, `getNicheFamily`). Pure data + types. | Any business logic, any DB call, any side effect, any HTTP transport. |
| `lib/server/maxwell/lead-engine.ts` | Search orchestration, Overpass whitelist generation per niche, audit prompt assembly (`auditHint` injection), distribution algorithm, `niche_id` propagation into `LeadInsert`, `niche_ids` persistence into `maxwell_search_runs`. | Niche catalog (delegated to `niches.ts`). Wire serialization (delegated to mappers + route handler). |
| `lib/server/leads/{schema,mappers,repository}.ts` | `nicheId` validation + DB↔wire mapping for `leads` table. The 3 confined `(row as any)` casts (per spec) live exclusively in `mappers.ts` with TODO comments. | The catalog. The endpoint. The selector UI. |
| `app/api/maxwell/lead-searches/route.ts` | Translating `MaxwellLeadSearchResult` into the wire response shape (C5), including `leadsByNiche` when present. Logger + error envelope. | Distribution logic (delegated to engine). |
| `app/api/maxwell/niche-preferences/route.ts` | GET/PATCH on `user_profiles.preferred_niche_ids` with role gate + whitelist validation (C4). Uses admin client with explicit ownership pin. | The catalog (uses `getNicheById` only for whitelist validation). The UI. |
| `components/maxwell/niche-selector.tsx` | Pure controlled UI for selecting nodes from the catalog (C6). | Fetching preferences. Persisting preferences. Server-only behavior. |
| Page-level callsites (`leads/page.tsx`, `settings/page.tsx`, `lead-form-dialog.tsx`) | Fetching preferences, holding selection state, persisting (or forwarding) selections, integrating selector into form/search flow. | Rendering the chip-and-checkbox UI directly (delegated to the shared component). |

---

## Database design

The migration is exactly the spec's three additive nullable columns. No new tables, no FKs, no indexes (the niche id has cardinality 126 so an index would help only for analytics queries, which are out of scope V1).

```sql
-- supabase/migrations/0061_phase_23b_maxwell_niche_system.sql
begin;

-- 1. leads — supports manual + Maxwell leads, NULL means "no niche tagged"
alter table public.leads
  add column if not exists niche_id text;

-- 2. maxwell_search_runs — traceability of which niches a run targeted
alter table public.maxwell_search_runs
  add column if not exists niche_ids text[];

-- 3. user_profiles — seller-preferred default niches (max 2 enforced at API layer)
alter table public.user_profiles
  add column if not exists preferred_niche_ids text[] not null default '{}';

commit;
```

Idempotent (`if not exists`), additive, nullable except `preferred_niche_ids` which defaults to `'{}'`. RLS unchanged: existing `leads` / `maxwell_search_runs` policies cover the new columns by default. `user_profiles.preferred_niche_ids` is written exclusively by the admin-client route handler (per C4), so no column-level grant change is required.

**Filename rename contingency** (per spec R1): if the parallel session does not consume `0060`, this migration renames to `0060_phase_23b_maxwell_niche_system.sql` pre-merge — pure rename, no SQL change.

---

## Allowed shortcuts (with accountability)

| Shortcut | Why acceptable now | Risk introduced | Future work created |
|----------|--------------------|-----------------|---------------------|
| 3 `(row as any)` casts in `mappers.ts` for the new `niche_id` column | Avoids regenerating `database.types.ts` mid-iteration while a parallel session has its own migration in flight (R3). | Type system does not enforce that `row.niche_id` is `string | null`. A typo in the column name (`niche_id` vs `nicheId`) compiles silently. | Post-merge PR runs `supabase gen types typescript` and removes the 3 casts. Owners: whoever opens that follow-up PR. |
| No browser smoke E2E in this iteration | Validator is expected to return PARTIAL by design (per spec §Success criterion). | A frontend regression on the selector → search → grouped-results flow could ship undetected to dev/staging. | Manual browser smoke (logged in `docs/validations/`) after merge; possibly a Playwright suite in a later iteration. |
| `gpt-5.5` literal without pre-validation against the OpenAI API | Decision frozen by user. ADR-026 documents rollback. | If `gpt-5.5` is not a valid model id at runtime, every Maxwell search fails with a `failed` status. | Runtime smoke by operator before merging to `develop`. Rollback is a one-line revert. |
| Per-niche audit calls iterate sequentially (not in parallel) | Simpler control flow, same auth surface, easier rate-limit accounting. Two niches = 2× the latency, which is acceptable for an async user-initiated search. | Latency doubles when both niches need to be audited. | Optional `Promise.all` refactor in a later perf iteration if the latency turns out to bite. |

## Forbidden shortcuts

| Shortcut | Why forbidden |
|----------|---------------|
| Modifying `maxwellAuditSchema` (any shape change, including "making `salesSpeech.whatsapp` optional to skip a niche-specific edge case") | Breaks `components/lead-detail.tsx`, breaks all archived `maxwell_snapshot` JSONB consumers. Audit shape is contract. |
| Pulling `nicheId` into the body of `/api/maxwell/niche-preferences` (PATCH) as a single value (e.g., `{ preferredNicheId: string }`) | The spec freezes the field as an array `preferredNicheIds: string[]` (max 2). Single-value sugar diverges from the user-facing multi-niche model. |
| Adding a per-IP rate-limit middleware to `/api/maxwell/niche-preferences` | Out of scope for V1. Low surface. Future iteration may add `lib/server/api/rate-limit.ts` if abuse surfaces. |
| Reading `request.body.targetUserId` (or any client-supplied id) in `/api/maxwell/niche-preferences` | Hard security boundary. The principal-pinned `.eq('id', principal.userId)` is the only identifier the handler uses. |
| Skipping the whitelist validation `getNicheById(id)` on PATCH | Lets clients persist arbitrary strings into `preferred_niche_ids`, which then leak into Overpass queries downstream (R5). Hard boundary. |
| Regenerating `database.types.ts` in this PR | Coordination boundary with the parallel session (R3, R4). Confined casts are the accepted price. |
| Calling Overpass with raw `tag` strings interpolated without escaping | Niche tags come from the static catalog (TypeScript constants), so injection isn't possible — but the implementation still must use the same template structure the spec lists (`["key"="value"]`) and must NOT accept tags from any external input. |
| Editing any existing test file | Hard boundary per spec. Add new test files; if an existing test breaks, that's a real bug to fix in the implementation. |

---

## Risks propagated from Router / Analysis (binding on Backend + Frontend)

| Code | Constraint Architecture imposes |
|------|---------------------------------|
| R3 | The 3 `(row as any)` casts must live in `mappers.ts` only: `mapLeadRowToWire`, `mapCreateLeadInputToInsert`, `mapUpdateLeadInputToUpdate`. Each cast carries a `// TODO(types-regen): cast until database.types.ts is regenerated post-merge` comment. Backend may not add casts elsewhere. |
| R4 | No file outside the spec's "Affected files" table is touched. No regeneration of `database.types.ts`. |
| R5 | Whitelist server-side ABSOLUTELY. The `/api/maxwell/niche-preferences` PATCH whitelists via `getNicheById`; the `/api/maxwell/lead-searches` request validation also passes `nicheIds` through `getNicheById` and silently drops unknowns before they reach Overpass. |
| R10 | `lib/data-context.tsx` receives exactly two additive lines (one per mapper). No refactor of surrounding code. |
| R11 | The `auditHint` is a tone-and-context hint. The Zod schema parses any model output that matches the existing shape; copy variance is acceptable. |
| R13 | UI degrades to "Nicho desconocido" when `getNicheById(id)` returns undefined for a persisted `lead.nicheId`. No exception thrown. |
| R14 | Rural zones may return `insufficient` for whitelisted Overpass queries; this is expected behavior. Documented in the addendum to `docs/product/maxwell-lead-engine-v1.md`. |

---

## Handoff to Backend (ordered)

Backend may begin immediately. Implementation order, all literal-against-contract:

1. **`supabase/migrations/0061_phase_23b_maxwell_niche_system.sql`** — create exactly the SQL block in §Database design. Apply via MCP `apply_migration` when ready.
2. **`lib/server/maxwell/niches.ts`** — create as pure-data module per spec §1 (20 families, 126 micro-niches, helpers). No server-only imports.
3. **`lib/server/leads/schema.ts`** — add `nicheId: z.string().optional().nullable()` to `baseLeadShape`; explicitly add `nicheId: baseLeadShape.nicheId` to `updateLeadSchema`.
4. **`lib/server/leads/mappers.ts`** — apply the 3 confined `(row as any)` casts with TODO comments per spec §4 + R3.
5. **`lib/server/leads/repository.ts`** — add `niche_id` to `leadSelect`.
6. **`lib/server/maxwell/lead-engine.ts`** — apply spec changes A–H. Implement distribution per C1 (case matrix + tie-break + per-niche cap + slack absorption). Implement audit prompt per C2. Switch model literal per C3. Persist `niche_ids` into `maxwell_search_runs` insert. Adjust `buildLeadInsert` to accept and write `niche_id`. Refactor `runMaxwellLeadSearch` to iterate `searchTargets` sequentially.
7. **`app/api/maxwell/lead-searches/route.ts`** — extend response with `leadsByNiche` per C5; resolve `nicheLabel` server-side via `getNicheById`.
8. **`app/api/maxwell/niche-preferences/route.ts`** — implement GET + PATCH per C4. Admin client + explicit ownership pin. Whitelist via `getNicheById`. Role gate.
9. **`lib/leads/serialization.ts`** + **`lib/types.ts`** + **`lib/data-context.tsx`** — propagate `nicheId` per C5 (wire ↔ domain ↔ context).
10. **Tests** — add the 4 new test files described in spec §Testing methodology. Mock `generateObject`. No existing test edits.

Backend may treat Frontend's work as independent: contracts C4 and C5 fully decouple the two surfaces. Backend ships the migration + endpoint + engine; Frontend ships the selector + page integrations.

## Handoff to Frontend (ordered)

Frontend may begin immediately, in parallel with Backend. Implementation order:

1. **`components/maxwell/niche-selector.tsx`** — implement per C6. Pure controlled component, no fetching, no server imports beyond type/data imports from `lib/server/maxwell/niches.ts`. (Niches file is data-only; safe.)
2. **`app/dashboard/leads/page.tsx`** — add `selectedNicheIds` state initialized from `GET /api/maxwell/niche-preferences` (on mount); render `<NicheSelector maxSelections={2} ... />` before the location buttons; include `nicheIds: selectedNicheIds` in the search payload; render `leadsByNiche` as two stacked sections when present and length ≥ 1 (per spec; if only one niche, single-section grouping is acceptable), fall back to flat `leads` otherwise.
3. **`app/dashboard/settings/page.tsx`** — add the gated `Prospección` tab for `sales | pm`, render `<NicheSelector maxSelections={2} ... />` wired to PATCH the endpoint (immediate persistence on change is acceptable; debounce optional).
4. **`components/lead-form-dialog.tsx`** — extend `LeadFormState` and `editLead` prop with `nicheId: string`; render `<NicheSelector maxSelections={1} ... />` between "Fuente" and "Origen del lead"; map `formData.nicheId || undefined` into the submitted lead.

Frontend may stub the endpoint contract locally (constant return) until Backend's PATCH/GET is live — both will land in the same PR.

## Confirmation of parallel readiness

Backend and Frontend can work in parallel:

- Contracts C1, C2, C3, C5 (server-side) bind Backend.
- Contract C6 (component) binds Frontend.
- Contract C4 (endpoint) is the only cross-boundary surface; both sides have its full wire shape frozen above and can stub independently.
- No shared file conflicts: Backend touches `lib/server/**`, `supabase/migrations/**`, `app/api/**/route.ts`; Frontend touches `components/**`, `app/dashboard/**/page.tsx`, plus the same `app/api/maxwell/lead-searches/route.ts` response consumption (read-only from Frontend's perspective).
- `lib/data-context.tsx` is a single-line change per mapper (R10); Frontend's page work depends on it but not on its mid-state — the page can render with the existing `Lead` type until the additive `nicheId?` lands.

Outcome: **Ready for Implementation** (PARTIAL acceptable at Validator).
