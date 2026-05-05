# Technical Design: api-pagination

**Change:** api-pagination
**Date:** 2026-05-04
**Status:** Draft
**Stack:** Next.js 16 App Router · TypeScript · Supabase SSR · pnpm
**Related:** `proposal.md`, `spec.md`, TDR-004

---

## 1. Architecture overview

### 1.1 Module dependency diagram

```
                       ┌─────────────────────────────────────┐
                       │     app/api/<resource>/route.ts     │
                       │  (Next.js Route Handler — GET)      │
                       └──────────────┬──────────────────────┘
                                      │ parses URL.searchParams
                                      ▼
            ┌──────────────────────────────────────────────────┐
            │           lib/server/pagination/                 │
            │                                                  │
            │  schema.ts ──► offsetPaginationSchema            │
            │              cursorPaginationSchema              │
            │                                                  │
            │  cursor.ts ──► encodeCursor / decodeCursor       │
            │                                                  │
            │  envelope.ts ► buildOffsetResponse               │
            │                buildCursorResponse               │
            └──────────────┬───────────────────────────────────┘
                           │ used by
        ┌──────────────────┴──────────────────┐
        ▼                                     ▼
┌──────────────────────┐            ┌─────────────────────────┐
│ Route handler reads  │            │ lib/server/<x>/         │
│ Zod-parsed params,   │  delegates │  repository.ts          │
│ calls repository,    ├───────────►│  (Supabase query        │
│ wraps in envelope    │            │   builder calls)        │
└──────────┬───────────┘            └────────────┬────────────┘
           │                                     │
           │      ┌──────────────────────────────┘
           ▼      ▼
    ┌─────────────────────────────────────────────┐
    │   Supabase server client (createSupabase    │
    │   ServerClient — already in use)            │
    └─────────────────────────────────────────────┘
```

### 1.2 Integration with existing route + repository pattern

The codebase already follows a strict three-layer split:

1. **Route handler** (`app/api/.../route.ts`) — auth guard → Zod parse query → call repo → wrap response with `NextResponse.json`.
2. **Schema** (`lib/server/<resource>/schema.ts`) — Zod definitions for query/body shapes.
3. **Repository** (`lib/server/<resource>/repository.ts`) — Supabase query builder; returns plain rows.

`lib/server/pagination/` slots in **horizontally** as a peer of the existing per-resource modules. It is consumed in two places:

- The route handler imports `offsetPaginationSchema` / `cursorPaginationSchema` and the `buildXxxResponse` helpers.
- The repository receives `{ page, limit }` or `{ cursor, limit }` (already decoded — the route handler decodes the cursor before calling the repo) and returns `{ rows, total }` for offset or `rows` (length `limit + 1`) for cursor.

**No new layer is introduced.** The existing pattern is preserved; pagination is a cross-cutting concern injected into both the schema and repository steps.

### 1.3 Data flow — request to response

**Offset (Group A) example — `GET /api/leads?page=2&limit=25`:**

```
1. Request arrives at app/api/leads/route.ts → GET
2. requireRole(['admin', 'sales_manager', 'sales'])
3. const url = new URL(request.url)
4. const query = offsetPaginationSchema.parse({
     page: url.searchParams.get('page') ?? undefined,
     limit: url.searchParams.get('limit') ?? undefined,
   })  →  { page: 2, limit: 25 }
5. const client = await createSupabaseServerClient()
6. const { rows, total } = await listLeads(client, { page: 2, limit: 25 })
     ├─ from = (2 - 1) * 25 = 25
     ├─ to = 25 + 25 - 1 = 49
     └─ supabase.from('leads').select(leadSelect, { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(25, 49)
7. const data = rows.map(mapLeadRowToWire)
8. return NextResponse.json(
     buildOffsetResponse(data, { page: 2, limit: 25, total })
   )
```

**Cursor (Group B) example — `GET /api/leads/abc/activity?cursor=<token>&limit=25`:**

```
1. Request arrives at app/api/leads/[leadId]/activity/route.ts → GET
2. requireRole(['admin', 'sales_manager', 'sales'])
3. const { leadId } = routeParamsSchema.parse(await context.params)
4. const url = new URL(request.url)
5. const query = cursorPaginationSchema.parse({
     cursor: url.searchParams.get('cursor') ?? undefined,
     limit: url.searchParams.get('limit') ?? undefined,
   })
6. const decoded = query.cursor ? decodeCursor(query.cursor) : null
   // decoded === null on malformed input — handler treats as "no cursor"
7. const rows = await listLeadActivities(client, leadId, {
     cursor: decoded,
     limit: query.limit,
   })  // returns up to limit+1 rows
8. const data = rows
     .slice(0, query.limit)               // trim sentinel
     .map(mapLeadActivityRowToWire)
9. return NextResponse.json(
     buildCursorResponse(rows.map(mapLeadActivityRowToWire), {
       limit: query.limit,
       getCursor: (row) => ({ createdAt: row.createdAt, id: row.id }),
     })
   )
```

The cursor decoding happens **in the route handler**, not the repository. Reason: the repo signature stays purely typed (`CursorPayload | null`) and isolated from base64 transport concerns; the route owns transport.

---

## 2. Module contracts (interfaces)

### 2.1 `lib/server/pagination/schema.ts`

```ts
import { z } from 'zod'

// Final defaults: page=1, limit=100, max=100 (per spec §2.1).
export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

export type OffsetPaginationInput = z.infer<typeof offsetPaginationSchema>
export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>
```

### 2.2 `lib/server/pagination/cursor.ts`

```ts
export type CursorPayload = {
  createdAt: string  // ISO 8601 timestamp
  id: string         // row primary key (UUID or text)
}

export function encodeCursor(payload: CursorPayload): string
// Produces base64url(JSON.stringify(payload)). Pure function, never throws
// for well-typed input.

export function decodeCursor(token: string): CursorPayload | null
// Returns null on:
//   - empty / non-string input
//   - invalid base64url
//   - valid base64 but invalid JSON
//   - valid JSON but missing { createdAt: string, id: string }
// MUST NOT throw.
```

**Implementation note:** use `Buffer.from(token, 'base64url')` (Node ≥18, available in Next.js runtime) and a structural shape check on the decoded object. No external deps.

### 2.3 `lib/server/pagination/envelope.ts`

```ts
import type { CursorPayload } from './cursor'

export type OffsetMeta = {
  page: number
  limit: number
  total: number
  pageCount: number
}

export type CursorMeta = {
  nextCursor: string | null
  limit: number
}

export type OffsetResponse<T> = {
  data: T[]
  meta: OffsetMeta
}

export type CursorResponse<T> = {
  data: T[]
  meta: CursorMeta
}

export function buildOffsetResponse<T>(
  data: T[],
  params: { page: number; limit: number; total: number }
): OffsetResponse<T>
// pageCount = Math.ceil(total / limit); when total === 0 → pageCount = 0.

export function buildCursorResponse<T>(
  items: T[],
  params: {
    limit: number
    getCursor: (item: T) => CursorPayload
  }
): CursorResponse<T>
// items.length is expected to be 0..limit+1. If items.length > limit, the
// first `limit` items are returned as data and getCursor is invoked on the
// LAST RETAINED item (data[limit - 1]) to produce nextCursor. Otherwise
// nextCursor = null and all items are returned as data.
```

**Why `getCursor` is injected:** wire types vary per resource (snake_case vs camelCase, mapped vs raw). The envelope stays generic; each call site supplies the projection.

### 2.4 Repository signature changes (before → after)

| Repository function | Before | After |
|---|---|---|
| `listLeads(client)` | `Promise<LeadRowWithProfiles[]>` | `listLeads(client, { page, limit }): Promise<{ rows: LeadRowWithProfiles[]; total: number }>` |
| `listTasks(client)` | `Promise<TaskRow[]>` | `listTasks(client, { page, limit }): Promise<{ rows: TaskRow[]; total: number }>` |
| `listProjects(client)` | `Promise<ProjectRow[]>` | `listProjects(client, { page, limit }): Promise<{ rows: ProjectRow[]; total: number }>` |
| `listLeadActivities(client, leadId)` | `Promise<LeadActivityRow[]>` | `listLeadActivities(client, leadId, { cursor, limit }): Promise<LeadActivityRow[]>` (length ≤ `limit + 1`) |
| `listTaskActivities(client, taskId)` | `Promise<TaskActivityRow[]>` | `listTaskActivities(client, taskId, { cursor, limit }): Promise<TaskActivityRow[]>` |
| `listLeadProposals(client, leadId)` | `Promise<LeadProposalRow[]>` | `listLeadProposals(client, leadId, { cursor, limit }): Promise<LeadProposalRow[]>` |
| `listUserNotifications(client, profileId, limit)` | `Promise<UserNotificationRow[]>` | `listUserNotifications(client, profileId, { cursor, limit }): Promise<UserNotificationRow[]>` |
| `listUpdates(...)` (in `updates/service.ts`) | uses `limit` only | accepts `{ cursor, limit }`; service preserves `domains` aggregation |
| `listEarningsHistory / listAllEarningsHistory` | `(client, profileId?, limit)` | `(client, profileId?, { cursor, limit })` — note: limit cap stays at 200 |
| `listPrototypeWorkspaces(...)` | uses `limit` | accepts `{ cursor, limit }` |
| `listAdminUsers / listDeliveryUsers` | uses `limit` | uses `limit` (clamped to 100); **no cursor**, **no return shape change** |

**`CursorInput` shared shape (used as repo arg):**

```ts
type CursorInput = {
  cursor: CursorPayload | null  // already decoded by the route handler
  limit: number                 // pre-clamped by the schema (1..100)
}
```

---

## 3. Supabase query contracts

### 3.1 Offset queries (Group A)

```ts
// lib/server/leads/repository.ts (after change)
export async function listLeads(
  client: DatabaseClient,
  params: { page: number; limit: number }
): Promise<{ rows: LeadRowWithProfiles[]; total: number }> {
  const from = (params.page - 1) * params.limit
  const to = from + params.limit - 1

  const { data, count, error } = await client
    .from('leads')
    .select(leadSelect, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    throw new Error(`Failed to list leads: ${error.message}`)
  }

  return {
    rows: (data ?? []) as LeadRowWithProfiles[],
    total: count ?? 0,
  }
}
```

Identical pattern for `listTasks` and `listProjects`. `tasks` keeps its existing `tasks` joins; `projects` keeps the `attachPrototypeWorkspaces` enrichment but applies it to `data` (which is already the page slice — the slice happens at the SQL level via `.range()`, not in JS).

**`from`/`to` derivation rule:**

| page | limit | from | to |
|---|---|---|---|
| 1 | 100 | 0 | 99 |
| 1 | 25 | 0 | 24 |
| 2 | 25 | 25 | 49 |
| 4 | 10 | 30 | 39 |

### 3.2 Cursor queries (Group B and C)

```ts
// lib/server/leads/activity-repository.ts (after change)
export async function listLeadActivities(
  client: DatabaseClient,
  leadId: string,
  params: { cursor: CursorPayload | null; limit: number }
): Promise<LeadActivityRow[]> {
  let query = client
    .from('lead_activities')
    .select(leadActivitySelect)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(params.limit + 1)

  if (params.cursor) {
    // PostgREST .or() syntax — comma separates OR branches; and(...) groups
    // an inner AND. No spaces inside the string. Values are interpolated as
    // already-validated strings (createdAt is ISO 8601, id is UUID/text).
    query = query.or(
      `created_at.lt.${params.cursor.createdAt},and(created_at.eq.${params.cursor.createdAt},id.lt.${params.cursor.id})`
    )
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to list lead activities: ${error.message}`)
  }

  return (data ?? []) as LeadActivityRow[]
}
```

**Composite filter expression (PostgREST):**

```
created_at.lt.<cursor.createdAt>,and(created_at.eq.<cursor.createdAt>,id.lt.<cursor.id>)
```

Translation: "rows where `created_at < cursor.createdAt` **OR** (`created_at = cursor.createdAt` AND `id < cursor.id`)." This is the standard "keyset pagination tie-break" using `id` to disambiguate rows that share a timestamp.

**Order specification:**

| Column | Direction | Reason |
|---|---|---|
| `created_at` | DESC | Newest first; matches existing UX for activity feeds |
| `id` | DESC | Total ordering; required for stable cursor advancement |

**Per-cursor-endpoint table (resource → table → key columns):**

| Endpoint | Table | Order columns | leadId/taskId filter? |
|---|---|---|---|
| `/api/leads/[leadId]/activity` | `lead_activities` | `created_at`, `id` | `eq('lead_id', leadId)` |
| `/api/tasks/[taskId]/activity` | `task_activities` | `created_at`, `id` | `eq('task_id', taskId)` |
| `/api/leads/[leadId]/proposals` | `lead_proposals` | `created_at`, `id` | `eq('lead_id', leadId)` |
| `/api/notifications` | `user_notifications` | `created_at`, `id` | `eq('profile_id', profileId)` |
| `/api/updates` | (via `updates/service.ts`) | `created_at`, `id` | scoped by service visibility logic |
| `/api/earnings/history` | `earnings_history` | `created_at`, `id` | optional `eq('profile_id', userId)` |
| `/api/prototypes` | `prototype_workspaces` | `created_at`, `id` | optional `leadId` filter |

**Validation guard:** before interpolating `cursor.createdAt` and `cursor.id` into the `.or()` string, the route handler MUST trust `decodeCursor`'s structural check (`createdAt: string`, `id: string`). Because the schema already validates the cursor as base64-encoded JSON with these two string fields, no further escaping is required for safe values. As an extra precaution the repo MAY refuse cursor strings containing `,`, `(`, or `)`; in practice ISO timestamps and UUIDs cannot contain those, so a defensive regex is optional and reserved for a follow-up hardening pass.

---

## 4. Response envelope contracts

### 4.1 Offset response (Group A) — example

`GET /api/leads?page=2&limit=25` with 87 total leads:

```json
{
  "data": [
    { "id": "...", "name": "Acme Inc", "status": "qualified", "...": "..." }
  ],
  "meta": {
    "page": 2,
    "limit": 25,
    "total": 87,
    "pageCount": 4
  }
}
```

### 4.2 Cursor response — first page with more (Group B)

`GET /api/leads/abc/activity` (no cursor), 150 entries exist:

```json
{
  "data": [
    { "id": "act-150", "createdAt": "2026-05-04T12:00:00Z", "...": "..." }
  ],
  "meta": {
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA1LTAzVDA5OjAwOjAwWiIsImlkIjoiYWN0LTUxIn0",
    "limit": 100
  }
}
```

`nextCursor` decodes to `{ createdAt: "2026-05-03T09:00:00Z", id: "act-51" }` — the last row of the returned slice (data[99]).

### 4.3 Cursor response — last page

`GET /api/leads/abc/activity?cursor=<x>&limit=100`, only 30 rows remain:

```json
{
  "data": [
    { "id": "act-30", "createdAt": "2026-04-01T08:00:00Z", "...": "..." }
  ],
  "meta": {
    "nextCursor": null,
    "limit": 100
  }
}
```

### 4.4 Group C — preserved meta keys merged

`GET /api/notifications`:

```json
{
  "data": [ { "id": "...", "title": "...", "...": "..." } ],
  "meta": {
    "unreadCount": 7,
    "limit": 100,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIuLi4iLCJpZCI6Ii4uLiJ9"
  }
}
```

`GET /api/updates`:

```json
{
  "data": [ { "id": "...", "title": "...", "...": "..." } ],
  "meta": {
    "limit": 100,
    "domains": ["maxwell", "leads", "tasks"],
    "nextCursor": null
  }
}
```

### 4.5 Group D — unchanged shape

`GET /api/users/admin?limit=500`:

```json
{
  "data": [
    { "id": "...", "fullName": "...", "role": "admin", "...": "..." }
  ]
}
```

No `meta` key. The `limit` is silently clamped to 100 server-side; the response shape is byte-compatible with the pre-change response.

---

## 5. Group C retrofit strategy

The principle: **preserve every existing `meta` key, append the cursor pagination keys.** Nothing is removed; nothing is renamed. Frontend consumers reading `meta.unreadCount` or `meta.domains` continue working unchanged.

### 5.1 Notifications — `app/api/notifications/route.ts`

```ts
// BEFORE
const query = listNotificationsQuerySchema.parse({
  limit: url.searchParams.get('limit') ?? undefined,
})
const result = await listVisibleNotifications(client, principal, query.limit)
return NextResponse.json({
  data: result.items,
  meta: { unreadCount: result.unreadCount, limit: query.limit },
})

// AFTER
const query = cursorPaginationSchema.parse({
  cursor: url.searchParams.get('cursor') ?? undefined,
  limit: url.searchParams.get('limit') ?? undefined,
})
const decodedCursor = query.cursor ? decodeCursor(query.cursor) : null
const result = await listVisibleNotifications(client, principal, {
  cursor: decodedCursor,
  limit: query.limit,
})
// result.items is length 0..limit+1; service trims and returns nextCursor.
const wireItems = result.items.map(mapNotificationRowToWire)
const cursorEnvelope = buildCursorResponse(wireItems, {
  limit: query.limit,
  getCursor: (item) => ({ createdAt: item.createdAt, id: item.id }),
})
return NextResponse.json({
  data: cursorEnvelope.data,
  meta: {
    unreadCount: result.unreadCount,  // PRESERVED
    limit: query.limit,
    nextCursor: cursorEnvelope.meta.nextCursor,
  },
})
```

The `listNotificationsQuerySchema` is **deleted**; `cursorPaginationSchema` replaces it. The service function (`listVisibleNotifications`) is updated to accept `{ cursor, limit }` and to fetch `limit + 1` rows.

### 5.2 Updates — `app/api/updates/route.ts`

Same pattern. `meta.domains` is preserved by the service layer (it is computed independently from the row list — verify in the implementation phase that `domains` is computed against the **full visibility set**, not just the page slice; if it currently is computed from `result.items`, the service must be split into two queries to keep it stable).

### 5.3 Earnings history — `app/api/earnings/history/route.ts`

Special case: limit cap stays at **200** (not 100). The route handler defines a local schema variant:

```ts
const earningsHistorySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
```

This is the single deviation from `cursorPaginationSchema`. We do not export a second shared schema for one consumer; we inline the override and add a comment explaining the analytics-view rationale.

The current handler also does a manual `Math.min(Number(...), 200)` and uses `getCurrentPrincipal` instead of `requirePrincipal`. The Zod parse replaces the manual clamp; the auth pattern is left unchanged (out of scope).

### 5.4 Prototypes — `app/api/prototypes/route.ts`

The existing schema (`listPrototypeWorkspacesQuerySchema`) accepts `limit` and `leadId`. We **extend** it to also accept `cursor`:

```ts
// lib/server/prototypes/schema.ts (after change)
export const listPrototypeWorkspacesQuerySchema = z.object({
  cursor: z.string().optional(),                                     // NEW
  limit: z.coerce.number().int().min(1).max(100).default(100),       // CHANGED default 100
  leadId: z.string().uuid().optional(),
})
```

The route does not switch to `cursorPaginationSchema` because of the existing `leadId` extension. Instead, the existing schema absorbs the new cursor field, keeping the per-resource ergonomics while still benefiting from the shared `decodeCursor` and `buildCursorResponse` helpers.

### 5.5 Generic merge pattern (canonical form)

```ts
return NextResponse.json({
  data: cursorEnvelope.data,
  meta: {
    ...existingMetaKeys,                       // unreadCount, domains, etc.
    limit: query.limit,
    nextCursor: cursorEnvelope.meta.nextCursor,
  },
})
```

`existingMetaKeys` is a shorthand for whatever the endpoint already returned (`unreadCount`, `domains`, etc.). The cursor keys are appended, never substituted.

---

## 6. Test design

All test files live under `tests/server/` mirroring the runtime layout. Each file uses Vitest (existing convention — see `tests/server/website-webhook-auth.test.ts`).

### 6.1 Shared infrastructure tests

| Test file | Test cases (names only) |
|---|---|
| `tests/server/pagination/schema.test.ts` | `offsetPaginationSchema applies defaults`, `offsetPaginationSchema clamps limit to 100`, `offsetPaginationSchema rejects page=0`, `offsetPaginationSchema rejects non-numeric page`, `offsetPaginationSchema rejects non-numeric limit`, `cursorPaginationSchema applies defaults`, `cursorPaginationSchema accepts opaque cursor string`, `cursorPaginationSchema clamps limit`, `cursorPaginationSchema treats missing cursor as undefined` |
| `tests/server/pagination/cursor.test.ts` | `encode + decode round-trip preserves values`, `decode returns null for empty string`, `decode returns null for malformed base64`, `decode returns null for valid base64 non-JSON`, `decode returns null when fields missing`, `decode returns null when fields wrong type`, `encode produces base64url-safe characters only` |
| `tests/server/pagination/envelope.test.ts` | `buildOffsetResponse computes pageCount`, `buildOffsetResponse handles empty result`, `buildOffsetResponse handles partial last page`, `buildOffsetResponse pageCount rounds up`, `buildCursorResponse trims when limit+1 items received`, `buildCursorResponse returns null nextCursor on last page`, `buildCursorResponse handles empty items`, `buildCursorResponse encodes last retained item as nextCursor` |

**Mock policy for shared tests:** zero mocks. These are pure unit tests against pure functions. `encodeCursor`/`decodeCursor` are deterministic; `buildXxxResponse` is pure data transformation.

### 6.2 Group A — offset endpoint tests

| Test file | Test cases |
|---|---|
| `tests/server/api/leads/list-leads.test.ts` | `default request returns first page with limit 100`, `explicit page and limit returns slice`, `limit > 100 clamped`, `empty result returns empty data with meta.total = 0`, `unauthenticated returns 401` |
| `tests/server/api/tasks/list-tasks.test.ts` | same five scenarios for tasks |
| `tests/server/api/projects/list-projects.test.ts` | same five scenarios + `enrichment runs on page slice only` (asserts `attachPrototypeWorkspaces` is invoked with exactly `data.length` items) |

Repository tests:

| Test file | Test cases |
|---|---|
| `tests/server/leads/repository-list-leads.test.ts` | `listLeads computes from/to from page+limit`, `listLeads returns total from count`, `listLeads orders by created_at desc`, `listLeads returns rows: [] when supabase returns null` |
| `tests/server/tasks/repository-list-tasks.test.ts` | same shape |
| `tests/server/projects/repository-list-projects.test.ts` | same shape |

**Mock policy:** mock the Supabase client with a chainable test double. The pattern already exists in the codebase (see existing repository tests under `tests/server/`). Do **not** mock `lib/server/pagination/*` — use the real implementation. Only the Supabase boundary is mocked.

### 6.3 Group B — cursor endpoint tests

| Test file | Test cases |
|---|---|
| `tests/server/api/leads/lead-activity.test.ts` | `first page no cursor returns up to limit items with nextCursor`, `valid cursor returns next slice`, `last page returns nextCursor: null`, `malformed cursor falls back to first page (no 400)`, `empty list returns data:[] and nextCursor: null`, `unauthenticated returns 401` |
| `tests/server/api/tasks/task-activity.test.ts` | same six scenarios |
| `tests/server/api/leads/lead-proposals.test.ts` | same six scenarios |

Repository tests:

| Test file | Test cases |
|---|---|
| `tests/server/leads/activity-repository-list.test.ts` | `applies created_at desc + id desc order`, `requests limit+1 rows`, `applies .or() filter when cursor present`, `omits .or() when cursor null`, `propagates lead_id filter` |
| `tests/server/tasks/activity-repository-list.test.ts` | same shape |
| `tests/server/leads/proposal-repository-list.test.ts` | same shape |

### 6.4 Group C — retrofit endpoint tests

| Test file | Test cases |
|---|---|
| `tests/server/api/notifications/list-notifications.test.ts` | `existing limit param still works`, `cursor accepted on first page`, `meta.unreadCount preserved`, `malformed cursor returns first page`, `unauthenticated returns 401` |
| `tests/server/api/updates/list-updates.test.ts` | `existing limit still works`, `cursor accepted`, `meta.domains preserved`, `malformed cursor returns first page` |
| `tests/server/api/earnings/history.test.ts` | `default limit is 100`, `limit cap is 200 (special case)`, `cursor accepted`, `malformed cursor returns first page`, `admin path returns all earnings`, `non-admin path scopes to userId` |
| `tests/server/api/prototypes/list-prototypes.test.ts` | `existing leadId filter still works`, `cursor accepted`, `default limit is 100`, `malformed cursor returns first page` |

### 6.5 Group D — limit-cap-only tests

| Test file | Test cases |
|---|---|
| `tests/server/api/users/admin-list.test.ts` | `default returns ≤ 100 admins`, `explicit limit < 100 respected`, `limit > 100 clamped to 100`, `response shape unchanged (no meta)`, `unauthenticated returns 401` |
| `tests/server/api/users/delivery-list.test.ts` | same five scenarios for delivery users |

### 6.6 What to mock

| Layer | Mocking approach |
|---|---|
| `requireRole` / `requirePrincipal` | Mock to return a fake principal in success cases; mock to throw in 401 cases |
| `createSupabaseServerClient` | Mock to return a chainable query builder double |
| Repository functions | **Mock at the route layer** when testing routes; use **real** repos against a Supabase mock when testing repos |
| `decodeCursor`, `encodeCursor`, `buildXxxResponse` | **NEVER mock** — always use real implementations (they are pure) |
| `mapXxxRowToWire` | Use real mappers (already covered by their own tests) |

---

## 7. Implementation order and dependencies

The work splits into four phases. Phase 1 must complete before any of 2/3/4 starts. Phases 2, 3, and 4 are mostly independent and can run in parallel — except where a single repository file is touched by multiple endpoints (currently none; each endpoint has its own file).

### 7.1 Phase 1 — Shared infrastructure (BLOCKING for all later phases)

| Task | Depends on | Parallelizable? |
|---|---|---|
| 1.1 Write `tests/server/pagination/schema.test.ts` | — | with 1.2, 1.3 |
| 1.2 Write `tests/server/pagination/cursor.test.ts` | — | with 1.1, 1.3 |
| 1.3 Write `tests/server/pagination/envelope.test.ts` | — | with 1.1, 1.2 |
| 1.4 Implement `lib/server/pagination/schema.ts` | 1.1 | — |
| 1.5 Implement `lib/server/pagination/cursor.ts` | 1.2 | with 1.4, 1.6 |
| 1.6 Implement `lib/server/pagination/envelope.ts` | 1.3, 1.5 (imports `CursorPayload`) | with 1.4 |
| 1.7 Phase 1 gate: all three test suites green | 1.4, 1.5, 1.6 | — |

### 7.2 Phase 2 — Group A (offset)

Three independent vertical slices. Each slice = repo test + repo impl + route test + route impl, executed in TDD order.

| Slice | Files | Can run in parallel with |
|---|---|---|
| 2A — leads | `lib/server/leads/repository.ts`, `app/api/leads/route.ts`, two test files | 2B, 2C |
| 2B — tasks | `lib/server/tasks/repository.ts`, `app/api/tasks/route.ts`, two test files | 2A, 2C |
| 2C — projects | `lib/server/projects/repository.ts`, `app/api/projects/route.ts`, two test files (incl. enrichment-on-slice assertion) | 2A, 2B |

### 7.3 Phase 3 — Group B (cursor)

Three independent vertical slices, all parallelizable with each other and with Phase 2.

| Slice | Files |
|---|---|
| 3A — lead activity | `lib/server/leads/activity-repository.ts`, `app/api/leads/[leadId]/activity/route.ts`, two tests |
| 3B — task activity | `lib/server/tasks/activity-repository.ts`, `app/api/tasks/[taskId]/activity/route.ts`, two tests |
| 3C — lead proposals | `lib/server/leads/proposal-repository.ts`, `app/api/leads/[leadId]/proposals/route.ts`, two tests |

### 7.4 Phase 4 — Groups C and D

| Slice | Files | Notes |
|---|---|---|
| 4A — notifications | `app/api/notifications/route.ts`, `lib/server/notifications/{schema,service,repository}.ts`, tests | Service must preserve `unreadCount` (independent count query, already separate) |
| 4B — updates | `app/api/updates/route.ts`, `lib/server/updates/{schema,service,repository}.ts`, tests | Confirm `domains` is computed from full visibility set, not slice |
| 4C — earnings/history | `app/api/earnings/history/route.ts`, `lib/server/earnings/repository.ts`, tests | Local schema with max 200 |
| 4D — prototypes | `app/api/prototypes/route.ts`, `lib/server/prototypes/{schema,service,repository}.ts`, tests | Existing schema extended with `cursor` |
| 4E — users/admin | `app/api/users/admin/route.ts`, tests | Cap only — no envelope change |
| 4F — users/delivery | `app/api/users/delivery/route.ts`, tests | Cap only — no envelope change |

All Phase 4 slices are independent and parallelizable.

### 7.5 Execution order summary

```
[Phase 1: Shared infra]   (blocking gate)
        │
        ▼
┌───────┼───────┐ ─────► all parallel
▼       ▼       ▼
[Phase 2: A,B,C]
[Phase 3: A,B,C]
[Phase 4: A,B,C,D,E,F]
        │
        ▼
[sdd-verify]
```

Total parallelizable units after the gate: **15** (3 + 3 + 6 + 3 retrofit-update notes; in practice grouped into ~6 PRs by reviewer preference).

---

## 8. Architecture decisions

### ADR-1 — Cursor over offset for activity feeds

**Decision:** Activity feeds (Group B and Group C cursor-eligible) use opaque cursor pagination; CRUD collections (Group A) use offset pagination.

**Why:**
- Activity feeds are append-only and time-ordered. Users almost exclusively read the head; deep pagination is rare. Cursor is O(log n) per page (index seek on `created_at, id`); offset is O(n) (Postgres still walks every prior row to compute `OFFSET 25000`).
- Cursor pagination is stable under concurrent inserts at the head — a new row appearing between page 1 and page 2 simply doesn't appear in subsequent pages, no duplicates, no skips. Offset pagination would shift every row by +1 on insert, causing dupes/skips.
- CRUD collections benefit from `total` and `pageCount` for "showing 25 of 87" UX. Activity feeds don't — there is no useful "page 47 of 312" affordance for an audit trail.

**Tradeoffs accepted:**
- Cursor clients can't jump to "page 47" — by design, that operation is meaningless on a feed.
- Two response envelope shapes coexist. Mitigated by the shared envelope helpers and clear per-endpoint typing.

### ADR-2 — Default `limit = 100` (not 25 or 50)

**Decision:** Default limit is 100 across every paginated endpoint (with `/api/earnings/history` retaining 200 as a hard max).

**Why:**
- The frontend `data-context.tsx` reads `payload.data` and renders the entire returned set. A default of 25 would silently truncate every list view from "all leads" to "25 leads", breaking dashboards and counts. We must not regress UX in the same change that introduces the contract.
- 100 is a defensible upper bound for a single network round-trip on this dataset (low thousands of rows per table). It is small enough to keep payload latency < 200ms p99 on Supabase, and large enough to render a complete view for current users.
- Once the follow-up frontend pagination work ships and the data-context starts passing explicit `?page` / `?cursor` params, this default can be lowered without breaking anything (it only affects the no-params case).

**Tradeoffs accepted:**
- Slightly larger payloads for the no-params case than a "modern" 25-default API. Acceptable because nothing in the current frontend asks for pagination yet.
- The proposal's earlier draft (default 25) is overridden here in favor of zero-regression rollout. The spec already encodes 100 as the binding decision.

### ADR-3 — Opaque base64 cursor (not `?after_id=` or `?after_created_at=`)

**Decision:** Cursors are opaque base64url strings encoding `{ createdAt, id }`.

**Why:**
- **Self-contained, no server state.** A plain `?after_id=` cursor would require the server to look up the row's `created_at` to apply the composite WHERE. Opaque cursor carries both fields in one token — single round-trip, single index lookup.
- **Tie-break baked in.** Two rows can share a `created_at` (especially in fast-write activity tables). The `id` field disambiguates. A `?after_created_at=` alone would skip or duplicate rows on collision.
- **Forward-compatible.** If we later add a third sort column (e.g. `priority`), we extend the JSON payload — clients pass tokens through opaquely, the contract evolves without a new query parameter.
- **Discourages client-side fabrication.** Readable params (`?after_id=42`) invite clients to construct arbitrary tokens; opaque base64 makes it clear the token is server-generated. Note: this is **ergonomic**, not **security** — security comes from Supabase RLS, not cursor opacity. A malicious client crafting a structurally valid cursor sees only what RLS already permits.

**Tradeoffs accepted:**
- Cursors are not human-readable. Acceptable — they are debug-decodable in two lines (`Buffer.from(token, 'base64url').toString()`).
- Slight payload overhead vs. integer offset. Negligible (<100 bytes per token).

### ADR-4 — No `meta` envelope for Group D (users/admin, users/delivery)

**Decision:** Group D endpoints get a server-side limit cap (default 100, max 100) but their response shape stays a bare `{ data: [...] }`.

**Why:**
- These are **directory lookups for select dropdowns**, not paginatable lists. The frontend uses them to populate "assign to" pickers; the user expects the entire small set.
- Adding `meta` would force every consumer to update their type signatures even though no one will ever call `?page=` or `?cursor=` on them. That is gratuitous churn.
- The cap (100) is purely defensive — to bound the worst-case payload if the user table grows unexpectedly. It is not a pagination feature; the response is byte-compatible with today's response for any deployment with ≤100 admins/delivery users (the realistic case for the foreseeable future).

**Tradeoffs accepted:**
- Two endpoints have a non-standard contract (no envelope). Acceptable — they are clearly labeled as Group D in spec §6 and proposal §3, and the inconsistency is bounded to two routes that serve a fundamentally different use case.
- If admin/delivery user counts ever exceed 100, those views silently truncate. Mitigation: add a runtime warning log when the query returns exactly 100 rows so we notice before users do. (Optional follow-up; not in this change's scope.)

---

## 9. Risk and rollback summary (cross-reference)

See `proposal.md` §"Rollback Plan" and §"Risks". This design does not change those — it implements them. The most operationally important invariants:

- Each phase's commits are independently revertable.
- Frontend is forward-compatible: removing `meta` is a graceful degradation.
- `decodeCursor` returning `null` (never throwing) is the safety net that prevents any cursor-related 400 from reaching production.

---

## 10. Out-of-scope reminders

This design covers the **backend contract only**. The following are explicitly deferred and MUST NOT be implemented in this change:

- Frontend `data-context` changes (it continues reading `payload.data`).
- UI pagination controls (page numbers, infinite scroll, load-more).
- `GET /api/projects/[projectId]/activity` (requires DB-level union view).
- POST/PATCH/DELETE pagination semantics.
- Search and filter parameters.

A follow-up change (`ui-pagination`) will consume the `meta` field once this contract ships.
