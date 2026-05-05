# TDR-004: API Pagination — Offset + Cursor Strategy

**Status:** Planned  
**Date:** 2026-05-04  
**Change:** `api-pagination`  
**Spec:** `openspec/changes/api-pagination/spec.md`

---

## Problem

Every GET collection endpoint returns the full table on every request with no upper bound. As tables grow, each mount of the dashboard triggers a full scan of `leads`, `tasks`, and `projects`. There is no mechanism to fetch subsequent pages, and activity feeds have no natural stopping point.

---

## Decision

Two pagination shapes, selected by data access pattern:

| Shape | Endpoints | Query params | Response meta |
|-------|-----------|-------------|---------------|
| **Offset** | leads, tasks, projects | `?page&limit` | `{ page, limit, total, pageCount }` |
| **Cursor** | activity feeds, notifications, updates, earnings/history, proposals, prototypes | `?cursor&limit` | `{ nextCursor, limit }` |

Offset is used where total count and jump-to-page are meaningful (CRUD boards). Cursor is used where the feed is append-only and total count is expensive or irrelevant.

Directories (`users/admin`, `users/delivery`) receive a server-side limit cap only — no meta wrapper, no breaking shape change.

---

## Implementation Pattern

### Shared infrastructure — `lib/server/pagination/`

```ts
// schema.ts
export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

// cursor.ts
export function encodeCursor(payload: { createdAt: string; id: string }): string
export function decodeCursor(token: string): { createdAt: string; id: string } | null  // null on any error

// envelope.ts
export function buildOffsetResponse<T>(
  rows: T[],
  opts: { page: number; limit: number; total: number }
): { data: T[]; meta: { page: number; limit: number; total: number; pageCount: number } }

export function buildCursorResponse<T extends { created_at: string; id: string }>(
  rows: T[],
  opts: { limit: number }
): { data: T[]; meta: { nextCursor: string | null; limit: number } }
// buildCursorResponse receives limit+1 rows, slices to limit, sets nextCursor from last item
```

### Offset repository pattern

```ts
// lib/server/leads/repository.ts
export async function listLeads(
  client: SupabaseClient,
  { page, limit }: { page: number; limit: number }
): Promise<{ rows: Lead[]; total: number }> {
  const from = (page - 1) * limit
  const to = from + limit - 1
  const { data, count, error } = await client
    .from('leads')
    .select(leadSelect, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0 }
}
```

### Cursor repository pattern

```ts
// lib/server/leads/activity-repository.ts
export async function listLeadActivity(
  client: SupabaseClient,
  leadId: string,
  { cursor, limit }: { cursor?: { createdAt: string; id: string }; limit: number }
): Promise<LeadActivity[]> {
  let q = client
    .from('lead_activity')
    .select(activitySelect)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })  // tie-break for identical timestamps
    .limit(limit + 1)                   // over-fetch by 1 to detect next page

  if (cursor) {
    q = q.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    )
  }

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}
```

### Route handler pattern

```ts
// app/api/leads/route.ts
export async function GET(request: NextRequest): Promise<NextResponse> {
  const principal = await getAuthenticatedPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const query = offsetPaginationSchema.parse({
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })

  const client = createServerClient()
  const { rows, total } = await listLeads(client, query)

  return NextResponse.json(buildOffsetResponse(rows, { ...query, total }))
}
```

---

## Anti-patterns

- **Do NOT** call `decodeCursor` and return 400 on null — treat null cursor as first page.
- **Do NOT** run `attachPrototypeWorkspaces` before slicing — always enrich the page slice only.
- **Do NOT** use `count: 'estimated'` for the current data volume — `exact` is correct and cheap here.
- **Do NOT** modify `lib/data-context.tsx` in this change — frontend pagination is a separate scope.
- **Do NOT** add `meta` to Group D endpoints (`users/admin`, `users/delivery`) — shape is frozen.

---

## Error cases

| Case | Behavior |
|------|----------|
| `page=0` | Zod rejects with validation error → 400 |
| `limit=999` | Zod rejects → 400 |
| `cursor=garbage` | `decodeCursor` returns null → treated as no cursor → first page, 200 |
| Supabase `.range()` error | throw → caught by route error boundary → 500 |
| `count` is null from Supabase | default to 0 in repository |

---

## Testing considerations

Strict TDD mode is enabled. Tests for `lib/server/pagination/` MUST be written before the shared module is consumed by any route.

Per-route tests are thin: parse params, call repository, verify envelope shape. The bulk of invariant coverage lives in the shared module tests.

Test for the `projects` enrichment: assert that `attachPrototypeWorkspaces` receives only the page slice (mock the function and capture the argument length).

---

## Tradeoffs

**Offset vs cursor for Group A**: Offset was chosen because leads, tasks, and projects are rendered in tabular/board views where `total` and `pageCount` are user-facing. Cursor pagination would provide better stability under concurrent inserts but would require a fundamentally different UI model. The risk of duplicate rows at page boundaries is documented and acceptable for these operational volumes.

**Default limit=100**: High default is intentional. The frontend currently loads all items in a single fetch. Keeping the default high ensures zero regression while the UI pagination work is pending.

**Cursor encoding**: Base64url JSON of `{ createdAt, id }` over a simple offset because activity feeds are append-only. New rows inserted at the head do not shift existing cursor positions. The `id` field resolves timestamp collisions without requiring a dedicated sequence column.
