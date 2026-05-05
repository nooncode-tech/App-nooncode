# Feature: API Pagination

## Intent
Every GET collection endpoint MUST enforce a maximum page size and return a `meta` envelope alongside `data`. Two pagination shapes are supported: offset-based for CRUD collections (leads, tasks, projects) and cursor-based for append-only feeds (activity logs, notifications, updates). The change is non-breaking — the frontend data-context reads only `payload.data` and is unaffected until it explicitly adopts pagination.

---

## Constraints

- `governed_by`: `openspec/changes/api-pagination/spec.md`, `openspec/changes/api-pagination/proposal.md`
- `out_of_scope`: frontend pagination UI, `projects/[projectId]/activity` (deferred — merges two streams), `rewards`, `inbound/pm-queue`
- `default_limit`: 100 for all endpoints
- `max_limit`: 100 (except `earnings/history` which caps at 200)

---

## Shared Infrastructure

### Scenario: offsetPaginationSchema accepts valid params
```
Given query params page=2 and limit=10
When parsed through offsetPaginationSchema
Then page resolves to 2 and limit resolves to 10
```

### Scenario: offsetPaginationSchema applies defaults
```
Given no query params
When parsed through offsetPaginationSchema
Then page resolves to 1 and limit resolves to 100
```

### Scenario: offsetPaginationSchema rejects page < 1
```
Given query param page=0
When parsed through offsetPaginationSchema
Then validation fails with an error on the page field
```

### Scenario: offsetPaginationSchema clamps limit to max
```
Given query param limit=999
When parsed through offsetPaginationSchema
Then validation fails with an error on the limit field
```

### Scenario: cursorPaginationSchema accepts cursor
```
Given query params cursor=<valid_opaque_token> and limit=20
When parsed through cursorPaginationSchema
Then cursor and limit are both present in the result
```

### Scenario: cursorPaginationSchema allows missing cursor
```
Given no cursor param
When parsed through cursorPaginationSchema
Then cursor is undefined and limit defaults to 100
```

### Scenario: cursor encode/decode round-trips
```
Given a cursor payload { createdAt: "2026-05-04T00:00:00Z", id: "abc-123" }
When encoded and then decoded
Then the result equals the original payload
```

### Scenario: decodeCursor returns null on malformed input
```
Given a base64url string that is not valid JSON
When decodeCursor is called
Then it returns null without throwing
```

### Scenario: buildOffsetResponse computes pageCount
```
Given 47 total rows, page=1, limit=10
When buildOffsetResponse is called
Then meta.pageCount equals 5
```

### Scenario: buildOffsetResponse handles empty results
```
Given 0 total rows
When buildOffsetResponse is called
Then data is [] and meta.total is 0 and meta.pageCount is 0
```

### Scenario: buildCursorResponse sets nextCursor when more rows exist
```
Given limit=10 and 11 rows returned from the over-fetch
When buildCursorResponse is called
Then data contains 10 items and meta.nextCursor is a non-null string
```

### Scenario: buildCursorResponse sets nextCursor to null on last page
```
Given limit=10 and 8 rows returned (fewer than limit)
When buildCursorResponse is called
Then data contains 8 items and meta.nextCursor is null
```

---

## Group A — Offset Pagination (leads, tasks, projects)

### Scenario: GET /api/leads returns first page with defaults
```
Given an authenticated user
And leads exist in the database
When GET /api/leads is called with no params
Then the response is { data: Lead[], meta: { page: 1, limit: 100, total: N, pageCount: M } }
And at most 100 leads are returned
```

### Scenario: GET /api/leads supports explicit page and limit
```
Given an authenticated user
And more than 10 leads exist
When GET /api/leads?page=2&limit=10 is called
Then data contains leads 11–20 (if they exist)
And meta.page is 2 and meta.limit is 10
```

### Scenario: GET /api/leads returns empty page beyond range
```
Given an authenticated user
And only 5 leads exist
When GET /api/leads?page=99&limit=10 is called
Then data is []
And meta.total is 5
```

### Scenario: GET /api/leads rejects unauthenticated request
```
Given no session cookie
When GET /api/leads is called
Then the response status is 401
```

### Scenario: GET /api/tasks returns paginated results (same contract as leads)
```
Given an authenticated user
When GET /api/tasks is called with no params
Then the response includes meta.page, meta.limit, meta.total, meta.pageCount
```

### Scenario: GET /api/projects enrichment runs only on returned slice
```
Given an authenticated user
And 50 projects exist with prototype workspaces
When GET /api/projects?page=1&limit=10 is called
Then data contains exactly 10 projects
And each returned project has its prototype workspace attached
And no project outside the current page is enriched
```

---

## Group B — Cursor Pagination (activity feeds)

### Scenario: GET /api/leads/[leadId]/activity returns first page
```
Given an authenticated user
And activity events exist for leadId
When GET /api/leads/{leadId}/activity is called with no cursor
Then data contains up to 100 events ordered by created_at DESC
And meta.nextCursor is non-null if more events exist
```

### Scenario: GET /api/leads/[leadId]/activity paginates with cursor
```
Given a valid nextCursor from a previous response
When GET /api/leads/{leadId}/activity?cursor={nextCursor} is called
Then data contains the next page of events
And no event from the previous page is repeated
```

### Scenario: GET /api/leads/[leadId]/activity treats malformed cursor as first page
```
Given cursor=this_is_not_valid_base64_json
When GET /api/leads/{leadId}/activity?cursor={invalid} is called
Then the response is equivalent to calling with no cursor
And the status is 200 (not 400)
```

### Scenario: GET /api/leads/[leadId]/activity returns null nextCursor on last page
```
Given fewer events remain than the requested limit
When the last page is fetched
Then meta.nextCursor is null
```

### Scenario: GET /api/tasks/[taskId]/activity follows the same cursor contract
```
Given an authenticated user with access to the task
When GET /api/tasks/{taskId}/activity is called
Then the response shape matches the cursor pagination envelope
```

### Scenario: GET /api/leads/[leadId]/proposals follows the same cursor contract
```
Given an authenticated user
When GET /api/leads/{leadId}/proposals is called with no cursor
Then data contains proposals ordered by created_at DESC
And meta.nextCursor is present if more proposals exist
```

---

## Group C — Retrofit existing limit endpoints

### Scenario: GET /api/notifications preserves unreadCount in meta
```
Given an authenticated user with unread notifications
When GET /api/notifications is called
Then meta contains both nextCursor (or null) and unreadCount
And unreadCount reflects the total unread regardless of page size
```

### Scenario: GET /api/notifications accepts cursor for next page
```
Given a valid nextCursor from a previous notifications response
When GET /api/notifications?cursor={nextCursor} is called
Then the next batch of notifications is returned without overlap
```

### Scenario: GET /api/updates preserves domains in meta
```
Given an authenticated user
When GET /api/updates is called
Then meta contains nextCursor and domains
```

### Scenario: GET /api/earnings/history keeps 200-row cap
```
Given an admin user
When GET /api/earnings/history?limit=300 is called
Then limit is clamped to 200 server-side
And meta.limit reflects the clamped value
```

### Scenario: GET /api/prototypes accepts cursor
```
Given an authenticated user
When GET /api/prototypes?cursor={cursor} is called
Then the next page of prototypes is returned with meta.nextCursor
```

---

## Group D — Limit cap (directory lists)

### Scenario: GET /api/users/delivery applies server-side limit
```
Given an admin user
When GET /api/users/delivery is called with no params
Then at most 100 users are returned
And the response shape is { data: DeliveryUser[] } (no meta added)
```

### Scenario: GET /api/users/admin applies server-side limit
```
Given an admin user
When GET /api/users/admin is called with no params
Then at most 100 users are returned
And the response shape is { data: AdminDirectoryUser[] } (no meta added)
```

---

## Non-regression

### Scenario: Frontend data-context receives data without breaking
```
Given the frontend data-context calls GET /api/leads with no params
When the API returns { data: Lead[], meta: { ... } }
Then readApiResponse unwraps payload.data and returns Lead[]
And meta is silently ignored
And no runtime error occurs
```

### Scenario: data shape of each item is unchanged
```
Given pagination is enabled on all Group A endpoints
When a single item from the paginated response is deserialized
Then it has the same fields as before pagination was introduced
```
