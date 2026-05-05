# Change Proposal: api-pagination

## Intent

Introduce a consistent, performant pagination contract across every GET collection endpoint in the nooncode-app Next.js API surface. Today, every list endpoint returns the full table ordered by `created_at desc` with no upper bound, which means each request grows unbounded with table size, the Supabase client always fetches every row, and the data-context refresh path on the frontend reloads the entire dataset on every interaction. We will standardize on two pagination shapes — offset-based for high-volume CRUD collections and opaque cursor-based for time-ordered activity feeds — backed by a shared schema, a shared response envelope, and Supabase `.range()` calls in the repositories. The change is non-breaking for existing frontend consumers because the response shape stays `{ data, meta? }` and the data-context only reads `payload.data`.

## Scope

### IN scope

- Shared pagination infrastructure: Zod schemas (`offsetPaginationSchema`, `cursorPaginationSchema`), response envelope helpers, opaque cursor encode/decode utilities.
- **Group A — Offset pagination** for high-volume CRUD collections:
  - `GET /api/leads`
  - `GET /api/tasks`
  - `GET /api/projects` (including the `attachPrototypeWorkspaces` enrichment step, which now runs only on the page slice)
- **Group B — Cursor pagination** for unbounded activity feeds:
  - `GET /api/leads/[leadId]/activity`
  - `GET /api/tasks/[taskId]/activity`
  - `GET /api/leads/[leadId]/proposals`
- **Group C — Add cursor pagination** to feeds that already accept `?limit`:
  - `GET /api/notifications` (preserve `meta.unreadCount`)
  - `GET /api/updates` (preserve `meta.domains`)
  - `GET /api/earnings/history` (keep cap 200)
  - `GET /api/prototypes`
- **Group D — Limit cap only** for small directory lists (no envelope change):
  - `GET /api/users/admin`
  - `GET /api/users/delivery`
- Tests for every changed endpoint and repository (TDD strict mode).
- Repository-layer changes to use `.range(from, to)` and to return `{ rows, total }` for offset endpoints.

### OUT of scope

- `GET /api/projects/[projectId]/activity` — merges two query streams in-memory; needs a DB view or unified query before pagination is meaningful. **Deferred** to a follow-up change.
- `GET /api/rewards` (composite object, not a collection).
- `GET /api/inbound/pm-queue` (small admin queue, not user-facing volume).
- **Frontend pagination** — this change ships ONLY the backend contract. No changes to `lib/data-context.tsx`, hooks, or UI components. The data-context will continue calling the same endpoints and reading only `payload.data`; it will receive the first page and render it as before. Frontend pagination (load-more, infinite scroll, page controls) is a separate follow-up change scoped to the UI layer.
- POST / PATCH / DELETE endpoints.
- Search and filter parameters (separate concern).

> **Why backend-only first**: the API contract is a prerequisite for the UI work. Shipping the backend with generous defaults (`limit=100`) ensures zero regression on the frontend while the pagination infrastructure is in place and ready to be consumed.

## Approach

### 1. Two pagination shapes

| Shape | Use case | Query params | Response meta |
|---|---|---|---|
| **Offset** | CRUD collections where total count is meaningful and users want to jump to a page | `?page=1&limit=25` | `{ page, limit, total, pageCount }` |
| **Cursor** | Append-only or time-ordered feeds where deep pagination is rare and total count is expensive | `?cursor=<opaque>&limit=25` | `{ nextCursor, limit }` |

Default `limit = 100`, max `limit = 100` (except `/api/earnings/history` which keeps its 200 cap). The high default ensures the frontend data-context receives a functionally complete dataset while the UI pagination work is pending. Once the frontend wires in explicit `?page` or `?cursor` params, the default can be lowered.

### 2. Opaque cursor format

Cursors are base64-encoded JSON of `{ createdAt: string, id: string }`. Pairing the timestamp with the row id resolves the timestamp-collision tie-break, keeps the cursor self-contained (no server-side state), and prevents clients from forging arbitrary offsets.

```ts
// lib/server/pagination/cursor.ts
encodeCursor({ createdAt, id }) -> base64url
decodeCursor(token) -> { createdAt, id } | null   // returns null on malformed input
```

### 3. Shared Zod schema

Following the canonical pattern in `lib/server/notifications/schema.ts` (coerce + min/max/default):

```ts
// lib/server/pagination/schema.ts
export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
```

### 4. Response envelope

```ts
// lib/server/pagination/envelope.ts
buildOffsetResponse<T>(rows: T[], { page, limit, total }) -> {
  data: T[],
  meta: { page, limit, total, pageCount: Math.ceil(total / limit) }
}

buildCursorResponse<T>(rows: T[], { limit, getCursor }) -> {
  data: T[],
  meta: { nextCursor: string | null, limit }
}
```

`buildCursorResponse` over-fetches by one row (`limit + 1`) and uses the extra row to produce `nextCursor`; if no extra row, `nextCursor: null`.

### 5. Supabase repository changes

Offset (Group A):
```ts
const from = (page - 1) * limit;
const to = from + limit - 1;
const { data, count, error } = await client
  .from('leads')
  .select('*', { count: 'exact' })
  .order('created_at', { ascending: false })
  .range(from, to);
return { rows: data ?? [], total: count ?? 0 };
```

Cursor (Groups B and C):
```ts
let q = client.from('lead_activity')
  .select('*')
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(limit + 1);
if (cursor) {
  q = q.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
}
```

Note: the secondary `.order('id', { ascending: false })` is added wherever cursor pagination is used, to guarantee a stable, total ordering.

### 6. Frontend impact

`lib/data-context.tsx` calls `readApiResponse<T>()` which only inspects `payload.data`. Adding `meta` is non-breaking. The data-context will continue to receive only the first page (25 items) until the follow-up UI change wires in pagination controls — this is an acceptable, deliberate trade-off because the bottleneck today is the unbounded fetch, not the missing UI.

## Affected Modules

### New files

- `lib/server/pagination/schema.ts` — shared Zod schemas
- `lib/server/pagination/envelope.ts` — response builders
- `lib/server/pagination/cursor.ts` — opaque cursor encode/decode
- `lib/server/pagination/__tests__/schema.test.ts`
- `lib/server/pagination/__tests__/envelope.test.ts`
- `lib/server/pagination/__tests__/cursor.test.ts`

### Modified — Group A (offset)

- `app/api/leads/route.ts`
- `app/api/tasks/route.ts`
- `app/api/projects/route.ts`
- `lib/server/leads/repository.ts` — `listLeads` returns `{ rows, total }`
- `lib/server/tasks/repository.ts` — `listTasks` returns `{ rows, total }`
- `lib/server/projects/repository.ts` — `listProjects` returns `{ rows, total }`; `attachPrototypeWorkspaces` runs on slice only

### Modified — Group B (cursor)

- `app/api/leads/[leadId]/activity/route.ts`
- `app/api/tasks/[taskId]/activity/route.ts`
- `app/api/leads/[leadId]/proposals/route.ts`
- Corresponding repository functions (`listLeadActivity`, `listTaskActivity`, `listLeadProposals`)

### Modified — Group C (add cursor, preserve existing meta)

- `app/api/notifications/route.ts`
- `app/api/updates/route.ts`
- `app/api/earnings/history/route.ts`
- `app/api/prototypes/route.ts`

### Modified — Group D (limit cap only)

- `app/api/users/admin/route.ts`
- `app/api/users/delivery/route.ts`

### Tests

One test file per modified route under the existing test layout, plus repository-level tests where the repository signature changes.

## Implementation Phases

### Phase 1 — Shared infrastructure (no behavior change)

1. Create `lib/server/pagination/{schema,envelope,cursor}.ts` with full unit test coverage.
2. Verify schemas reject invalid input (negative page, limit > 100, malformed cursor).
3. Verify cursor round-trips and rejects forged tokens cleanly (returns `null`, never throws).
4. Verify offset envelope computes `pageCount` correctly including edge cases (empty page, partial last page).
5. Verify cursor envelope's `limit + 1` over-fetch logic.

**Exit criteria:** all pagination utilities published, 100% test coverage on the shared module, no consumers yet.

### Phase 2 — Group A: offset pagination on CRUD collections

1. Update `lib/server/leads/repository.ts` — `listLeads({ page, limit })` returns `{ rows, total }`.
2. Update `app/api/leads/route.ts` — parse with `offsetPaginationSchema`, call `buildOffsetResponse`.
3. Repeat for tasks.
4. Repeat for projects, ensuring `attachPrototypeWorkspaces` runs on the page slice only.
5. Update tests for each route + repository.

**Exit criteria:** the three CRUD endpoints accept `?page&limit`, return `{ data, meta: { page, limit, total, pageCount } }`, default behavior is page 1 / 25 items, frontend `data-context` continues to render without changes.

### Phase 3 — Group B: cursor pagination on activity feeds

1. Update `listLeadActivity`, `listTaskActivity`, `listLeadProposals` to accept `{ cursor, limit }` and apply the secondary ordering on `id`.
2. Update the three corresponding routes to parse `cursorPaginationSchema` and use `buildCursorResponse`.
3. Tests cover: first page (no cursor), middle page, last page (`nextCursor: null`), invalid cursor (treated as no cursor).

**Exit criteria:** the three activity endpoints paginate by cursor, never return more than `limit` items, and `nextCursor` is null only at the end.

### Phase 4 — Group C and D: feeds with existing limit + small directories

1. **Group C**: extend `notifications`, `updates`, `earnings/history`, and `prototypes` to accept `?cursor`. Preserve existing meta keys (`unreadCount`, `domains`) by spreading them into the envelope.
2. **Group D**: cap `?limit` on `users/admin` and `users/delivery` (default 25, max 100) without changing the response envelope.
3. Tests confirm existing meta keys are preserved on Group C and that Group D rejects oversized limits.

**Exit criteria:** every in-scope GET collection endpoint enforces a max page size; activity-shaped endpoints expose a cursor; CRUD endpoints expose offset pagination.

## Rollback Plan

The change is additive at the response level: `meta` is new, `data` is unchanged in shape, and default query params produce a response that is a strict subset of today's response (first 25 rows instead of all rows).

Per-phase rollback:

- **Phase 1** — pure addition; revert by deleting `lib/server/pagination/`.
- **Phase 2 / 3 / 4** — each route change is a single commit. Revert the offending commit to restore the previous unbounded behavior. Repository signature changes are confined to the same commit as the route change, so revert is atomic.

If a partial rollout is needed (e.g., `/api/projects` regresses but leads/tasks are fine), revert only the projects commit; the shared infrastructure and the other endpoints are independent.

Operational rollback if discovered in production:

1. Revert the commit on `main` and redeploy.
2. The frontend is forward-compatible — older clients see `data` as before; newer clients that started reading `meta` will see it disappear, which is a graceful degradation (no `meta` means "treat as full set").

## Open Questions

1. **Default page size — 25 or 50?** Proposal says 25 (conservative, matches typical UI pagination). Confirm before Phase 2.
2. **Should `count: 'exact'` be used on every offset query?** It costs an extra COUNT scan. Alternative: `count: 'estimated'` for very large tables. For nooncode-app's current data volume (low thousands), `exact` is fine — but flag for revisit if any table exceeds ~100k rows.
3. **Cursor ordering tie-break — created_at + id, or created_at + a sequence column?** Proposal uses `id` because every table has it. Confirm no table uses a non-orderable id type (e.g., random UUID without a created_at companion).
4. **Limit on `/api/earnings/history`** — keep the existing 200 cap, or align to the global 100? Proposal: keep 200 because the endpoint is read by an analytics view that legitimately needs the wider window.
5. **Frontend follow-up** — should the data-context start exposing `meta` to consumers now (forward-compatible plumbing), or wait for the UI change? Proposal: wait. The data-context contract today is "give me the list," and surfacing `meta` without UI consumers invites premature coupling.

## Risks

### High

- **`/api/projects` enrichment step (`attachPrototypeWorkspaces`) on the page slice** — today this runs over the entire result set. Running it over a 25-row slice is correct and cheaper, but if any caller relied on the side effects of running the enrichment on every project (it shouldn't — enrichment is pure), behavior changes. **Mitigation:** review `attachPrototypeWorkspaces` for any side effects in Phase 2 task 4, add a test that asserts enrichment is applied only to returned rows.

### Medium

- **`data-context.tsx` now receives only the first 25 rows** — any UI that assumed "the full list is in context" will silently render partial data. **Mitigation:** grep for direct consumers of `dataContext.leads`, `dataContext.tasks`, `dataContext.projects`. If any iterate expecting completeness (e.g., dashboards counting items), document them in the verify phase as follow-up UI work; do not block the API change.

- **Cursor stability under concurrent inserts** — between page 1 and page 2, new rows can be inserted at the head. Cursor pagination handles this gracefully (the new rows simply won't appear in subsequent pages of the same scan), but offset pagination on Group A will show duplicates if a row is inserted at position 1 between requests. **Mitigation:** documented behavior; acceptable for CRUD collections where the user is expected to refresh.

### Low

- **Forged or stale cursors** — clients could pass an arbitrary base64 string. **Mitigation:** `decodeCursor` returns `null` on any decode/parse error, and the route treats `null` as "no cursor" rather than 400. This is consistent with how `notifications` already handles a malformed `?limit`.

- **Supabase `count: 'exact'` on large tables** — potential perf regression. **Mitigation:** flagged as Open Question 2; current data volume is well within the safe range for `exact`.

- **Test surface area** — every endpoint gets a new test file. **Mitigation:** the shared schema/envelope tests cover the bulk of the logic; per-endpoint tests are thin (parse params, call repo, build envelope).
