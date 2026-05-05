# Spec: api-pagination

**Change:** api-pagination  
**Date:** 2026-05-04  
**Status:** Draft  
**Stack:** Next.js 16 App Router · TypeScript · Supabase SSR · pnpm

---

## 1. Overview

### Intent

Introduce consistent, predictable pagination across all GET collection endpoints in the nooncode-app API. The change standardises two pagination shapes and adds a limit-cap retrofit to a third group of existing endpoints.

### In scope

| Group | Shape | Endpoints |
|---|---|---|
| A — Offset | `?page&limit` with envelope | `/api/leads`, `/api/tasks`, `/api/projects` |
| B — Cursor | `?cursor&limit` with envelope | `/api/leads/[leadId]/activity`, `/api/tasks/[taskId]/activity`, `/api/leads/[leadId]/proposals` |
| C — Retrofit | existing `?limit` + new `?cursor` accepted; meta keys preserved | `/api/notifications`, `/api/updates`, `/api/earnings/history`, `/api/prototypes` |
| D — Limit cap | server-side default/max of 100; no envelope change | `/api/users/admin`, `/api/users/delivery` |

### Out of scope

- `GET /api/projects/[projectId]/activity` — deferred (merges two in-memory streams; pagination requires stream-level refactor).
- `/api/rewards`, `/api/inbound/pm-queue` — not paginated in this change.
- **All frontend changes** — data-context, UI components, and display logic are explicitly excluded. Adding `meta` to responses is non-breaking because data-context reads only `payload.data`.

### Shared infrastructure location

All reusable pagination code MUST live under `lib/server/pagination/`:

```
lib/server/pagination/
  schema.ts    # Zod validation schemas
  cursor.ts    # encode / decode opaque cursors
  envelope.ts  # buildOffsetResponse / buildCursorResponse helpers
```

---

## 2. Shared Pagination Infrastructure

### 2.1 `schema.ts` — Query parameter validation

#### Scenario: offsetPaginationSchema — default values applied when params are absent

```
Given no query parameters are provided
When offsetPaginationSchema.parse({}) is called
Then the result MUST be { page: 1, limit: 100 }
```

#### Scenario: offsetPaginationSchema — explicit values pass through

```
Given query parameters { page: "2", limit: "10" }
When offsetPaginationSchema.parse({ page: "2", limit: "10" }) is called
Then the result MUST be { page: 2, limit: 10 }
```

#### Scenario: offsetPaginationSchema — limit clamped to max

```
Given query parameters { limit: "500" }
When offsetPaginationSchema.parse({ limit: "500" }) is called
Then the result MUST be { page: 1, limit: 100 }
  And no error MUST be thrown
```

#### Scenario: offsetPaginationSchema — page must be a positive integer

```
Given query parameters { page: "0" }
When offsetPaginationSchema.parse({ page: "0" }) is called
Then a ZodError MUST be thrown
  And the error path MUST reference "page"
```

#### Scenario: offsetPaginationSchema — non-numeric values rejected

```
Given query parameters { page: "abc", limit: "xyz" }
When offsetPaginationSchema.parse({ page: "abc", limit: "xyz" }) is called
Then a ZodError MUST be thrown
```

#### Scenario: cursorPaginationSchema — default values applied when params are absent

```
Given no query parameters are provided
When cursorPaginationSchema.parse({}) is called
Then the result MUST be { cursor: undefined, limit: 100 }
```

#### Scenario: cursorPaginationSchema — explicit cursor and limit pass through

```
Given query parameters { cursor: "eyJjcmVhdGVkQXQiOiIyMDI1LTAxLTAxIiwiaWQiOiIxMjMifQ", limit: "25" }
When cursorPaginationSchema.parse(...) is called
Then the result MUST be { cursor: "eyJjcmVhdGVkQXQiOiIyMDI1LTAxLTAxIiwiaWQiOiIxMjMifQ", limit: 25 }
```

#### Scenario: cursorPaginationSchema — limit clamped to max

```
Given query parameters { limit: "999" }
When cursorPaginationSchema.parse({ limit: "999" }) is called
Then the result MUST be { cursor: undefined, limit: 100 }
  And no error MUST be thrown
```

#### Scenario: cursorPaginationSchema — missing cursor is not an error

```
Given query parameters { limit: "50" }
When cursorPaginationSchema.parse({ limit: "50" }) is called
Then the result MUST be { cursor: undefined, limit: 50 }
  And no error MUST be thrown
```

---

### 2.2 `cursor.ts` — Opaque cursor encode / decode

The cursor format is: `base64url( JSON.stringify({ createdAt: string, id: string }) )`.

#### Scenario: encode + decode round-trip preserves values

```
Given a cursor payload { createdAt: "2025-03-15T12:00:00.000Z", id: "abc-123" }
When encodeCursor({ createdAt, id }) is called
  And decodeCursor(result) is called on the output
Then decodeCursor MUST return { createdAt: "2025-03-15T12:00:00.000Z", id: "abc-123" }
```

#### Scenario: decode returns null for malformed base64

```
Given a string "not-valid-base64!!!"
When decodeCursor("not-valid-base64!!!") is called
Then the result MUST be null
  And no exception MUST be thrown
```

#### Scenario: decode returns null for valid base64 but invalid JSON

```
Given a base64url-encoded string of "hello world" (not JSON)
When decodeCursor(input) is called
Then the result MUST be null
  And no exception MUST be thrown
```

#### Scenario: decode returns null for valid JSON but missing required fields

```
Given a base64url-encoded string of '{"foo":"bar"}'
When decodeCursor(input) is called
Then the result MUST be null
  And no exception MUST be thrown
```

#### Scenario: decode returns null for empty string

```
Given an empty string ""
When decodeCursor("") is called
Then the result MUST be null
  And no exception MUST be thrown
```

#### Scenario: forged or tampered cursor is silently treated as no cursor

```
Given a cursor string that was manually crafted (not from encodeCursor)
  And the cursor decodes to a structurally valid object { createdAt, id }
When a handler receives this cursor
Then the handler MUST process it as a valid cursor (no 400 returned)
  And it SHALL return the next page starting from the given position
Note: security is provided by Supabase RLS, not cursor integrity checks
```

---

### 2.3 `envelope.ts` — Response builders

#### Scenario: buildOffsetResponse — standard page in the middle

```
Given data = [item1, item2, ...item10]  (10 items)
  And meta inputs: page=2, limit=10, total=35
When buildOffsetResponse({ data, page, limit, total }) is called
Then the result MUST be:
  {
    data: [item1...item10],
    meta: {
      page: 2,
      limit: 10,
      total: 35,
      pageCount: 4
    }
  }
```

#### Scenario: buildOffsetResponse — empty result set

```
Given data = []
  And meta inputs: page=1, limit=100, total=0
When buildOffsetResponse({ data: [], page: 1, limit: 100, total: 0 }) is called
Then the result MUST be:
  {
    data: [],
    meta: { page: 1, limit: 100, total: 0, pageCount: 0 }
  }
```

#### Scenario: buildOffsetResponse — partial last page

```
Given data = [item1, item2, item3]  (3 items)
  And meta inputs: page=4, limit=10, total=33
When buildOffsetResponse({ data, page: 4, limit: 10, total: 33 }) is called
Then meta.pageCount MUST be 4
  And meta.page MUST be 4
  And data.length MUST be 3
```

#### Scenario: buildOffsetResponse — pageCount rounds up

```
Given total=11, limit=10
When pageCount is computed
Then pageCount MUST be 2  (Math.ceil(11/10) = 2)
```

#### Scenario: buildCursorResponse — more items exist (nextCursor present)

```
Given the handler over-fetched limit+1 items (e.g. 11 items when limit=10)
When buildCursorResponse({ items: fetchedItems, limit: 10 }) is called
Then data MUST contain exactly 10 items (the first limit items)
  And meta.nextCursor MUST be a non-null base64url string
  And meta.limit MUST be 10
```

#### Scenario: buildCursorResponse — last page (nextCursor absent)

```
Given the handler over-fetched limit+1 items but received fewer or equal to limit (e.g. 7 items when limit=10)
When buildCursorResponse({ items: fetchedItems, limit: 10 }) is called
Then data MUST contain exactly 7 items
  And meta.nextCursor MUST be null
  And meta.limit MUST be 10
```

#### Scenario: buildCursorResponse — empty result

```
Given fetchedItems = []
When buildCursorResponse({ items: [], limit: 100 }) is called
Then data MUST be []
  And meta.nextCursor MUST be null
```

#### Scenario: buildCursorResponse — nextCursor encodes the last item of the returned page

```
Given 11 items fetched for limit=10
  And the 10th item (last of the page) has createdAt="2025-05-01T00:00:00Z", id="row-10"
When buildCursorResponse({ items, limit: 10 }) is called
  And meta.nextCursor is decoded with decodeCursor
Then the decoded value MUST be { createdAt: "2025-05-01T00:00:00Z", id: "row-10" }
```

---

## 3. Group A — Offset Pagination

Applies to: `GET /api/leads`, `GET /api/tasks`, `GET /api/projects`.

All scenarios in this group apply to each endpoint unless stated otherwise.

### Common contract

- Query params: `page` (integer ≥ 1, default 1) and `limit` (integer 1–100, default 100, max 100).
- Supabase query MUST use `.range(from, to)` with `{ count: 'exact' }`.
- The response MUST conform to the offset envelope shape:
  ```json
  { "data": [...], "meta": { "page": 1, "limit": 100, "total": N, "pageCount": P } }
  ```

### 3.1 `GET /api/leads`

#### Scenario: default request returns page 1 with limit 100

```
Given the user is authenticated
  And there are 250 leads in the database
When GET /api/leads is called with no query params
Then the response status MUST be 200
  And data MUST contain 100 items
  And meta MUST be { page: 1, limit: 100, total: 250, pageCount: 3 }
```

#### Scenario: explicit page and limit

```
Given the user is authenticated
  And there are 35 leads
When GET /api/leads?page=2&limit=10 is called
Then the response status MUST be 200
  And data MUST contain 10 items (leads 11–20)
  And meta MUST be { page: 2, limit: 10, total: 35, pageCount: 4 }
```

#### Scenario: limit exceeding max is clamped to 100

```
Given the user is authenticated
When GET /api/leads?limit=500 is called
Then the response status MUST be 200
  And meta.limit MUST be 100
  And at most 100 items MUST be returned
```

#### Scenario: empty result set

```
Given the user is authenticated
  And there are no leads in the database
When GET /api/leads is called
Then the response status MUST be 200
  And the response MUST be { data: [], meta: { page: 1, limit: 100, total: 0, pageCount: 0 } }
```

#### Scenario: unauthenticated request rejected

```
Given no valid session cookie or auth header is present
When GET /api/leads is called
Then the response status MUST be 401
```

---

### 3.2 `GET /api/tasks`

Same scenarios as §3.1 apply with tasks instead of leads.

#### Scenario: default request returns page 1 with limit 100

```
Given the user is authenticated
  And there are 200 tasks
When GET /api/tasks is called with no query params
Then the response status MUST be 200
  And data MUST contain 100 items
  And meta MUST be { page: 1, limit: 100, total: 200, pageCount: 2 }
```

#### Scenario: explicit page and limit

```
Given the user is authenticated
  And there are 55 tasks
When GET /api/tasks?page=3&limit=20 is called
Then the response status MUST be 200
  And data MUST contain 15 items (tasks 41–55, partial last page)
  And meta MUST be { page: 3, limit: 20, total: 55, pageCount: 3 }
```

#### Scenario: limit exceeding max is clamped to 100

```
Given the user is authenticated
When GET /api/tasks?limit=9999 is called
Then the response status MUST be 200
  And meta.limit MUST be 100
```

#### Scenario: empty result

```
Given the user is authenticated
  And there are no tasks
When GET /api/tasks is called
Then the response status MUST be 200
  And the response MUST be { data: [], meta: { page: 1, limit: 100, total: 0, pageCount: 0 } }
```

#### Scenario: unauthenticated request rejected

```
Given no valid session
When GET /api/tasks is called
Then the response status MUST be 401
```

---

### 3.3 `GET /api/projects`

Same as §3.1 base scenarios, plus enrichment-specific scenarios.

#### Scenario: default request returns page 1 with limit 100

```
Given the user is authenticated
  And there are 150 projects
When GET /api/projects is called with no query params
Then the response status MUST be 200
  And data MUST contain 100 items
  And meta MUST be { page: 1, limit: 100, total: 150, pageCount: 2 }
```

#### Scenario: enrichment runs only on the returned page slice

```
Given the user is authenticated
  And there are 50 projects with associated data (e.g. task counts, lead names)
  And the current request is page=2, limit=10
When GET /api/projects?page=2&limit=10 is called
Then the enrichment step MUST run against exactly 10 project records
  And the enrichment step MUST NOT be called for the 40 projects not in the current page
  And the response data MUST contain the enriched version of those 10 projects
```

#### Scenario: enrichment result is included in response data

```
Given the user is authenticated
  And a project has associated stats
When GET /api/projects is called
Then each item in data MUST include the enrichment fields (e.g. taskCount, leadName)
```

#### Scenario: limit exceeding max is clamped

```
Given the user is authenticated
When GET /api/projects?limit=200 is called
Then meta.limit MUST be 100
  And at most 100 projects MUST be returned
```

#### Scenario: empty result

```
Given the user is authenticated
  And there are no projects
When GET /api/projects is called
Then the response MUST be { data: [], meta: { page: 1, limit: 100, total: 0, pageCount: 0 } }
```

#### Scenario: unauthenticated request rejected

```
Given no valid session
When GET /api/projects is called
Then the response status MUST be 401
```

---

## 4. Group B — Cursor Pagination

Applies to:
- `GET /api/leads/[leadId]/activity`
- `GET /api/tasks/[taskId]/activity`
- `GET /api/leads/[leadId]/proposals`

All scenarios apply to each endpoint unless stated otherwise.

### Common contract

- Query params: `cursor` (opaque string, optional) and `limit` (integer 1–100, default 100, max 100).
- Supabase query MUST use composite ORDER `created_at DESC, id DESC` with a `.or(...)` filter when a cursor is provided.
- Over-fetch strategy: query MUST request `limit + 1` rows; if `limit + 1` rows are returned, trim to `limit` and encode the last retained row as `nextCursor`.
- Malformed or missing cursor MUST fall back to the first page — no 400 MUST ever be returned due to cursor format.
- Response shape:
  ```json
  { "data": [...], "meta": { "nextCursor": "<string|null>", "limit": 100 } }
  ```

---

### 4.1 `GET /api/leads/[leadId]/activity`

#### Scenario: first page — no cursor provided, more items exist

```
Given the user is authenticated
  And lead "lead-1" has 150 activity entries
When GET /api/leads/lead-1/activity is called with no cursor
Then the response status MUST be 200
  And data MUST contain 100 items (most recent first)
  And meta.nextCursor MUST be a non-null opaque string
  And meta.limit MUST be 100
```

#### Scenario: second page — valid cursor provided

```
Given the user is authenticated
  And a valid cursor obtained from the first page response
When GET /api/leads/lead-1/activity?cursor=<validCursor> is called
Then the response status MUST be 200
  And data MUST contain items that follow the cursor position (ordered created_at DESC, id DESC)
  And each returned item MUST have a created_at earlier than or equal to the cursor's createdAt
```

#### Scenario: last page — nextCursor is null

```
Given the user is authenticated
  And lead "lead-1" has 120 activity entries
  And the first page returned items 1–100 with a cursor
When GET /api/leads/lead-1/activity?cursor=<validCursor> is called
Then the response status MUST be 200
  And data MUST contain 20 items
  And meta.nextCursor MUST be null
```

#### Scenario: invalid / malformed cursor treated as first page

```
Given the user is authenticated
When GET /api/leads/lead-1/activity?cursor=INVALID_GARBAGE is called
Then the response status MUST be 200
  And data MUST contain the first page of results
  And meta.nextCursor MUST be null or a valid cursor (depending on total count)
  And the response MUST NOT have status 400
```

#### Scenario: empty activity list

```
Given the user is authenticated
  And lead "lead-1" has no activity entries
When GET /api/leads/lead-1/activity is called
Then the response status MUST be 200
  And data MUST be []
  And meta.nextCursor MUST be null
```

#### Scenario: unauthenticated request rejected

```
Given no valid session
When GET /api/leads/lead-1/activity is called
Then the response status MUST be 401
```

---

### 4.2 `GET /api/tasks/[taskId]/activity`

Same scenarios as §4.1 with task activity entries instead of lead activity.

#### Scenario: first page — more items exist

```
Given the user is authenticated
  And task "task-1" has 200 activity entries
When GET /api/tasks/task-1/activity is called with no cursor
Then the response status MUST be 200
  And data MUST contain 100 items
  And meta.nextCursor MUST be non-null
```

#### Scenario: explicit limit smaller than default

```
Given the user is authenticated
  And task "task-1" has 30 activity entries
When GET /api/tasks/task-1/activity?limit=10 is called
Then data MUST contain 10 items
  And meta.nextCursor MUST be non-null (20 remain)
  And meta.limit MUST be 10
```

#### Scenario: invalid cursor falls back to first page — no 400

```
Given the user is authenticated
When GET /api/tasks/task-1/activity?cursor=not-a-cursor is called
Then the response status MUST be 200
  And data MUST reflect the first page
```

#### Scenario: empty activity list

```
Given the user is authenticated
  And task "task-1" has no activity
When GET /api/tasks/task-1/activity is called
Then data MUST be []
  And meta.nextCursor MUST be null
```

#### Scenario: unauthenticated request rejected

```
Given no valid session
When GET /api/tasks/task-1/activity is called
Then the response status MUST be 401
```

---

### 4.3 `GET /api/leads/[leadId]/proposals`

Same cursor contract as §4.1 applied to proposal entries.

#### Scenario: first page — no cursor, more proposals exist

```
Given the user is authenticated
  And lead "lead-2" has 110 proposals
When GET /api/leads/lead-2/proposals is called with no cursor
Then the response status MUST be 200
  And data MUST contain 100 items
  And meta.nextCursor MUST be non-null
```

#### Scenario: second page — valid cursor

```
Given the user is authenticated
  And a valid cursor from the first page
When GET /api/leads/lead-2/proposals?cursor=<validCursor> is called
Then data MUST contain the remaining 10 proposals
  And meta.nextCursor MUST be null
```

#### Scenario: malformed cursor returns first page — not 400

```
Given the user is authenticated
When GET /api/leads/lead-2/proposals?cursor=zzz is called
Then the response status MUST be 200
  And the response MUST NOT be status 400
```

#### Scenario: empty proposals list

```
Given the user is authenticated
  And lead "lead-2" has no proposals
When GET /api/leads/lead-2/proposals is called
Then data MUST be []
  And meta.nextCursor MUST be null
```

#### Scenario: unauthenticated request rejected

```
Given no valid session
When GET /api/leads/lead-2/proposals is called
Then the response status MUST be 401
```

---

## 5. Group C — Retrofit Existing Limit Endpoints

Applies to:
- `GET /api/notifications`
- `GET /api/updates`
- `GET /api/earnings/history`
- `GET /api/prototypes`

### Contract

- The existing `?limit` query parameter MUST continue to work as before.
- A new `?cursor` query parameter MUST be accepted (cursor pagination added).
- Existing meta keys in each endpoint's response MUST be preserved alongside the new pagination fields.
- If no `cursor` is provided, the behavior MUST be backward-compatible with previous responses.

---

### 5.1 `GET /api/notifications`

#### Scenario: existing limit behaviour preserved

```
Given the user is authenticated
  And there are 50 notifications
When GET /api/notifications?limit=20 is called (as before this change)
Then the response status MUST be 200
  And data MUST contain at most 20 notifications
  And meta.unreadCount MUST be present in the response
```

#### Scenario: cursor accepted — first page

```
Given the user is authenticated
  And there are 150 notifications
When GET /api/notifications is called with no cursor
Then data MUST contain at most 100 notifications
  And meta.nextCursor MUST be present if more items exist
  And meta.unreadCount MUST still be present
```

#### Scenario: cursor accepted — subsequent page

```
Given the user is authenticated
  And a valid cursor from the previous response
When GET /api/notifications?cursor=<validCursor> is called
Then data MUST start after the cursor position
  And meta.unreadCount MUST still be present
```

#### Scenario: malformed cursor treated as first page

```
Given the user is authenticated
When GET /api/notifications?cursor=garbage is called
Then the response status MUST be 200
  And data MUST reflect the first page
  And no 400 MUST be returned
```

#### Scenario: unauthenticated request rejected

```
Given no valid session
When GET /api/notifications is called
Then the response status MUST be 401
```

---

### 5.2 `GET /api/updates`

#### Scenario: existing limit behaviour preserved

```
Given the user is authenticated
  And there are 30 updates
When GET /api/updates?limit=10 is called
Then the response status MUST be 200
  And data MUST contain at most 10 updates
  And meta.domains MUST be present in the response
```

#### Scenario: cursor accepted — first page

```
Given the user is authenticated
When GET /api/updates is called with no cursor
Then data MUST contain at most 100 updates
  And meta.domains MUST still be present
  And meta.nextCursor MUST be present if more items exist
```

#### Scenario: cursor accepted — subsequent page

```
Given a valid cursor from the previous response
When GET /api/updates?cursor=<validCursor> is called
Then data MUST start after the cursor position
  And meta.domains MUST still be present
```

#### Scenario: malformed cursor — no 400

```
Given the user is authenticated
When GET /api/updates?cursor=bad-cursor is called
Then the response status MUST be 200
```

---

### 5.3 `GET /api/earnings/history`

#### Scenario: existing limit behaviour preserved

```
Given the user is authenticated
  And there are 80 earnings history entries
When GET /api/earnings/history?limit=25 is called
Then the response status MUST be 200
  And data MUST contain at most 25 entries
```

#### Scenario: cursor accepted

```
Given the user is authenticated
When GET /api/earnings/history is called with no cursor
Then data MUST contain at most 100 entries
  And meta.nextCursor MUST be present if more entries exist
```

#### Scenario: malformed cursor — no 400

```
Given the user is authenticated
When GET /api/earnings/history?cursor=junk is called
Then the response status MUST be 200
  And data MUST reflect the first page
```

---

### 5.4 `GET /api/prototypes`

#### Scenario: existing limit behaviour preserved

```
Given the user is authenticated
When GET /api/prototypes?limit=50 is called
Then the response status MUST be 200
  And data MUST contain at most 50 prototypes
```

#### Scenario: cursor accepted

```
Given the user is authenticated
When GET /api/prototypes is called
Then data MUST contain at most 100 prototypes
  And meta.nextCursor MUST be present if more prototypes exist
```

#### Scenario: malformed cursor — no 400

```
Given the user is authenticated
When GET /api/prototypes?cursor=nope is called
Then the response status MUST be 200
```

---

## 6. Group D — Limit Cap

Applies to: `GET /api/users/admin`, `GET /api/users/delivery`.

### Contract

- A server-side default of `limit=100` MUST be applied when no `limit` param is provided.
- If `limit` exceeds 100, it MUST be silently clamped to 100.
- The response shape MUST remain unchanged — no `meta` wrapper is added.
- No cursor pagination is introduced for these endpoints.

---

### 6.1 `GET /api/users/admin`

#### Scenario: default limit applied when no param

```
Given the user is an authenticated admin
  And there are 150 admin users
When GET /api/users/admin is called with no query params
Then the response status MUST be 200
  And the response MUST contain at most 100 admin users
  And the response shape MUST be unchanged (no meta wrapper)
```

#### Scenario: explicit limit within range respected

```
Given the user is an authenticated admin
When GET /api/users/admin?limit=50 is called
Then the response MUST contain at most 50 admin users
```

#### Scenario: limit exceeding max clamped silently

```
Given the user is an authenticated admin
When GET /api/users/admin?limit=500 is called
Then the response MUST contain at most 100 admin users
  And no 400 MUST be returned
  And the response shape MUST NOT include a meta key
```

#### Scenario: unauthenticated request rejected

```
Given no valid admin session
When GET /api/users/admin is called
Then the response status MUST be 401
```

---

### 6.2 `GET /api/users/delivery`

Same scenarios as §6.1 with delivery users.

#### Scenario: default limit applied

```
Given the user is authenticated
  And there are 200 delivery users
When GET /api/users/delivery is called with no params
Then at most 100 delivery users MUST be returned
  And the response shape MUST remain unchanged
```

#### Scenario: limit clamped silently

```
Given the user is authenticated
When GET /api/users/delivery?limit=9999 is called
Then at most 100 delivery users MUST be returned
  And no 400 MUST be returned
```

---

## 7. Non-Regression Scenarios

### 7.1 Frontend data-context compatibility

#### Scenario: data-context receives first page without breaking

```
Given data-context reads payload.data to populate UI state
  And GET /api/leads previously returned a flat array
When GET /api/leads is called after this change
Then payload.data MUST still be an array of leads
  And payload.meta (new field) MUST be ignored safely by data-context
  And the UI MUST render correctly without any frontend code change
```

#### Scenario: payload.data shape is unchanged

```
Given a leads response before this change contained items with fields { id, name, status, ... }
When GET /api/leads?page=1&limit=100 is called after this change
Then each item in data MUST have the same TypeScript type as before
  And no existing field MUST be removed or renamed
  And the only structural difference MUST be the addition of the top-level meta key
```

#### Scenario: group C endpoints remain backward-compatible on first page

```
Given a consumer that calls GET /api/notifications without pagination params
When GET /api/notifications is called after this change
Then the first page response MUST match the previous response in content for up to 100 items
  And all previously present meta keys (e.g. unreadCount) MUST still be present
```

#### Scenario: group D endpoints remain fully backward-compatible

```
Given a consumer that calls GET /api/users/admin
When GET /api/users/admin is called after this change
Then the response MUST have the same shape as before
  And the only observable change MUST be that the result set is capped at 100 items
```

---

## 8. Testing Requirements (Strict TDD Mode)

Per the project's Strict TDD policy, the following rules MUST be observed:

1. Unit tests for `lib/server/pagination/schema.ts`, `cursor.ts`, and `envelope.ts` MUST be written before or alongside the implementation of those files.
2. Integration tests for each endpoint MUST cover at minimum: default request, explicit page/cursor, limit clamping, empty result, and 401.
3. No endpoint implementation is considered complete until its test suite passes.
4. Cursor round-trip MUST be covered by at least one pure unit test (encode → decode → verify).
5. `buildCursorResponse` over-fetch logic MUST be covered by tests for the boundary cases: `items.length === limit` (last page) and `items.length === limit + 1` (has more).

---

## 9. RFC 2119 Compliance Summary

All SHALL and MUST statements in this document are normative. All SHOULD statements are strong recommendations that MAY be deviated from with justification. All MAY statements are optional.

Key invariants:
- **Malformed cursors MUST never return 400** — always fall back to first page.
- **Limit MUST be clamped server-side** — client cannot request more than 100 rows per call.
- **Enrichment in Group A MUST run only on the returned slice** — not the full table.
- **Group D endpoints MUST NOT gain a meta wrapper** — response shape is frozen.
- **Group C existing meta keys MUST be preserved** — unreadCount, domains are non-optional.
