# Tasks: api-pagination

**Change:** api-pagination  
**Date:** 2026-05-04  
**Status:** Draft  
**Stack:** Next.js 16 App Router · TypeScript · Supabase SSR · pnpm

---

## Phase 1 — Shared Pagination Infrastructure (BLOCKING GATE)

> Nothing in Phase 2, 3, or 4 may start until task 1.7 is green.

---

### 1.0 Phase 1 entry — create module directory

**Files:** `lib/server/pagination/` (directory)  
**Acceptance:** Directory exists; no implementation files yet.  
**Dependencies:** none

---

### 1.1 Write schema tests

**Files:** `tests/server/pagination/schema.test.ts`  
**Acceptance:** Test file exists with all 9 test cases listed in design §6.1 (offsetPaginationSchema defaults, clamp, reject page=0, reject non-numeric; cursorPaginationSchema defaults, accepts cursor, clamps, treats missing cursor as undefined). All tests fail (red) because implementation does not exist yet.  
**Dependencies:** 1.0  
**Parallel with:** 1.2, 1.3

---

### 1.2 Write cursor tests

**Files:** `tests/server/pagination/cursor.test.ts`  
**Acceptance:** Test file exists with all 7 test cases (encode+decode round-trip, null for empty string, null for malformed base64, null for valid base64 non-JSON, null for missing fields, null for wrong field types, base64url-safe characters only). All tests fail (red).  
**Dependencies:** 1.0  
**Parallel with:** 1.1, 1.3

---

### 1.3 Write envelope tests

**Files:** `tests/server/pagination/envelope.test.ts`  
**Acceptance:** Test file exists with all 8 test cases (buildOffsetResponse: computes pageCount, empty result, partial last page, rounds up; buildCursorResponse: trims on limit+1, null nextCursor on last page, empty items, encodes last retained item). All tests fail (red).  
**Dependencies:** 1.0  
**Parallel with:** 1.1, 1.2

---

### 1.4 Implement `lib/server/pagination/schema.ts`

**Files:** `lib/server/pagination/schema.ts`  
**Acceptance:** `offsetPaginationSchema` and `cursorPaginationSchema` implemented exactly per design §2.1. Task 1.1 test suite passes (green). Exported types `OffsetPaginationInput`, `CursorPaginationInput` present.  
**Dependencies:** 1.1  
**Parallel with:** 1.5 (after 1.2), 1.6 (after 1.3 + 1.5)

---

### 1.5 Implement `lib/server/pagination/cursor.ts`

**Files:** `lib/server/pagination/cursor.ts`  
**Acceptance:** `encodeCursor` and `decodeCursor` implemented per design §2.2. Uses `Buffer.from(token, 'base64url')`, no external deps, `decodeCursor` NEVER throws, returns `null` on all malformed input. Task 1.2 test suite passes (green). `CursorPayload` type exported.  
**Dependencies:** 1.2  
**Parallel with:** 1.4

---

### 1.6 Implement `lib/server/pagination/envelope.ts`

**Files:** `lib/server/pagination/envelope.ts`  
**Acceptance:** `buildOffsetResponse` and `buildCursorResponse` implemented per design §2.3. `pageCount = Math.ceil(total / limit)`; when total=0 → pageCount=0. `buildCursorResponse` trims to `limit` items and encodes last retained as `nextCursor` when `items.length > limit`. Task 1.3 test suite passes (green). All types exported.  
**Dependencies:** 1.3, 1.5 (imports `CursorPayload`)  
**Parallel with:** 1.4

---

### 1.7 Phase 1 gate — all three test suites green

**Files:** none (verification only)  
**Acceptance:** Run `pnpm vitest tests/server/pagination/` — all tests pass with zero failures. Only after this task is confirmed may Phase 2, 3, and 4 tasks begin.  
**Dependencies:** 1.4, 1.5, 1.6

---

## Phase 2 — Group A: Offset Pagination (leads, tasks, projects)

> Requires: 1.7. Slices 2A, 2B, 2C are independent and fully parallel.

---

### Slice 2A — Leads

#### 2A.1 Write leads repository tests

**Files:** `tests/server/leads/repository-list-leads.test.ts`  
**Acceptance:** 4 test cases present (from/to derivation, total from count, ordered by created_at desc, rows:[] on null). All fail (red). Supabase client mocked via chainable test double.  
**Dependencies:** 1.7  
**Parallel with:** 2B.1, 2C.1

---

#### 2A.2 Update `listLeads` repository signature

**Files:** `lib/server/leads/repository.ts`  
**Acceptance:** `listLeads(client, { page, limit })` returns `Promise<{ rows: LeadRowWithProfiles[]; total: number }>`. Uses `.select(leadSelect, { count: 'exact' })`, `.order('created_at', { ascending: false })`, `.range(from, to)`. Task 2A.1 passes (green).  
**Dependencies:** 2A.1  
**Parallel with:** 2B.2, 2C.2

---

#### 2A.3 Write leads route tests

**Files:** `tests/server/api/leads/list-leads.test.ts`  
**Acceptance:** 5 test cases present (default page 1 limit 100, explicit page+limit, limit>100 clamped, empty result, 401). All fail (red). Repository mocked at route layer.  
**Dependencies:** 2A.2  
**Parallel with:** 2B.3, 2C.3

---

#### 2A.4 Update leads route handler

**Files:** `app/api/leads/route.ts`  
**Acceptance:** GET handler parses `offsetPaginationSchema` from URL search params, calls updated `listLeads`, wraps result with `buildOffsetResponse`. Returns `{ data, meta: { page, limit, total, pageCount } }`. Task 2A.3 passes (green).  
**Dependencies:** 2A.3  
**Parallel with:** 2B.4, 2C.4

---

### Slice 2B — Tasks

#### 2B.1 Write tasks repository tests

**Files:** `tests/server/tasks/repository-list-tasks.test.ts`  
**Acceptance:** Same 4 test cases as 2A.1 for tasks. All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 2A.1, 2C.1

---

#### 2B.2 Update `listTasks` repository signature

**Files:** `lib/server/tasks/repository.ts`  
**Acceptance:** `listTasks(client, { page, limit })` returns `Promise<{ rows: TaskRow[]; total: number }>`. Preserves existing task joins. Task 2B.1 passes (green).  
**Dependencies:** 2B.1  
**Parallel with:** 2A.2, 2C.2

---

#### 2B.3 Write tasks route tests

**Files:** `tests/server/api/tasks/list-tasks.test.ts`  
**Acceptance:** 5 test cases (default, explicit, clamp, empty, 401). All fail (red).  
**Dependencies:** 2B.2  
**Parallel with:** 2A.3, 2C.3

---

#### 2B.4 Update tasks route handler

**Files:** `app/api/tasks/route.ts`  
**Acceptance:** GET handler uses `offsetPaginationSchema`, calls updated `listTasks`, returns offset envelope. Task 2B.3 passes (green).  
**Dependencies:** 2B.3  
**Parallel with:** 2A.4, 2C.4

---

### Slice 2C — Projects

#### 2C.1 Write projects repository tests

**Files:** `tests/server/projects/repository-list-projects.test.ts`  
**Acceptance:** Same 4 test cases as 2A.1 for projects. All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 2A.1, 2B.1

---

#### 2C.2 Update `listProjects` repository signature

**Files:** `lib/server/projects/repository.ts`  
**Acceptance:** `listProjects(client, { page, limit })` returns `Promise<{ rows: ProjectRow[]; total: number }>`. Slice happens at SQL level via `.range()`; `attachPrototypeWorkspaces` enrichment runs ONLY on `data` (the page slice), not the full table. Task 2C.1 passes (green).  
**Dependencies:** 2C.1  
**Parallel with:** 2A.2, 2B.2

---

#### 2C.3 Write projects route tests

**Files:** `tests/server/api/projects/list-projects.test.ts`  
**Acceptance:** 5 base cases + 1 enrichment-on-slice assertion (enrichment invoked with exactly `data.length` items, not all projects). All fail (red).  
**Dependencies:** 2C.2  
**Parallel with:** 2A.3, 2B.3

---

#### 2C.4 Update projects route handler

**Files:** `app/api/projects/route.ts`  
**Acceptance:** GET handler uses `offsetPaginationSchema`, calls updated `listProjects`, applies enrichment to the page slice only, wraps with `buildOffsetResponse`. Task 2C.3 passes (green).  
**Dependencies:** 2C.3  
**Parallel with:** 2A.4, 2B.4

---

## Phase 3 — Group B: Cursor Pagination (activity feeds + proposals)

> Requires: 1.7. Slices 3A, 3B, 3C are independent and fully parallel with each other and with Phase 2.

---

### Slice 3A — Lead Activity

#### 3A.1 Write lead activity repository tests

**Files:** `tests/server/leads/activity-repository-list.test.ts`  
**Acceptance:** 5 test cases (created_at desc + id desc order, requests limit+1 rows, applies `.or()` when cursor present, omits `.or()` when cursor null, propagates lead_id filter). All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 3B.1, 3C.1

---

#### 3A.2 Update `listLeadActivities` repository signature

**Files:** `lib/server/leads/activity-repository.ts`  
**Acceptance:** `listLeadActivities(client, leadId, { cursor: CursorPayload | null, limit })` returns `Promise<LeadActivityRow[]>` (length ≤ limit+1). Uses `ORDER BY created_at DESC, id DESC`, `.limit(limit + 1)`, and the PostgREST `.or()` composite filter when cursor is non-null. Task 3A.1 passes (green).  
**Dependencies:** 3A.1  
**Parallel with:** 3B.2, 3C.2

---

#### 3A.3 Write lead activity route tests

**Files:** `tests/server/api/leads/lead-activity.test.ts`  
**Acceptance:** 6 test cases (first page no cursor + nextCursor present, valid cursor returns next slice, last page nextCursor=null, malformed cursor falls back to first page, empty list, 401). All fail (red).  
**Dependencies:** 3A.2  
**Parallel with:** 3B.3, 3C.3

---

#### 3A.4 Update lead activity route handler

**Files:** `app/api/leads/[leadId]/activity/route.ts`  
**Acceptance:** GET handler parses `cursorPaginationSchema`, calls `decodeCursor` (result may be null), calls updated `listLeadActivities`, wraps with `buildCursorResponse`. Malformed cursor → null → first-page query; NEVER returns 400 due to cursor. Task 3A.3 passes (green).  
**Dependencies:** 3A.3  
**Parallel with:** 3B.4, 3C.4

---

### Slice 3B — Task Activity

#### 3B.1 Write task activity repository tests

**Files:** `tests/server/tasks/activity-repository-list.test.ts`  
**Acceptance:** Same 5 test cases as 3A.1 for task activities (filter on task_id). All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 3A.1, 3C.1

---

#### 3B.2 Update `listTaskActivities` repository signature

**Files:** `lib/server/tasks/activity-repository.ts`  
**Acceptance:** `listTaskActivities(client, taskId, { cursor: CursorPayload | null, limit })` returns `Promise<TaskActivityRow[]>` (length ≤ limit+1). Same pattern as 3A.2. Task 3B.1 passes (green).  
**Dependencies:** 3B.1  
**Parallel with:** 3A.2, 3C.2

---

#### 3B.3 Write task activity route tests

**Files:** `tests/server/api/tasks/task-activity.test.ts`  
**Acceptance:** 6 test cases matching 3A.3 pattern for tasks. All fail (red).  
**Dependencies:** 3B.2  
**Parallel with:** 3A.3, 3C.3

---

#### 3B.4 Update task activity route handler

**Files:** `app/api/tasks/[taskId]/activity/route.ts`  
**Acceptance:** Same pattern as 3A.4 for task activity. Task 3B.3 passes (green).  
**Dependencies:** 3B.3  
**Parallel with:** 3A.4, 3C.4

---

### Slice 3C — Lead Proposals

#### 3C.1 Write lead proposals repository tests

**Files:** `tests/server/leads/proposal-repository-list.test.ts`  
**Acceptance:** Same 5 test cases as 3A.1 for proposals (filter on lead_id). All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 3A.1, 3B.1

---

#### 3C.2 Update `listLeadProposals` repository signature

**Files:** `lib/server/leads/proposal-repository.ts`  
**Acceptance:** `listLeadProposals(client, leadId, { cursor: CursorPayload | null, limit })` returns `Promise<LeadProposalRow[]>` (length ≤ limit+1). Same pattern as 3A.2. Task 3C.1 passes (green).  
**Dependencies:** 3C.1  
**Parallel with:** 3A.2, 3B.2

---

#### 3C.3 Write lead proposals route tests

**Files:** `tests/server/api/leads/lead-proposals.test.ts`  
**Acceptance:** 6 test cases matching 3A.3 pattern for proposals. All fail (red).  
**Dependencies:** 3C.2  
**Parallel with:** 3A.3, 3B.3

---

#### 3C.4 Update lead proposals route handler

**Files:** `app/api/leads/[leadId]/proposals/route.ts`  
**Acceptance:** Same pattern as 3A.4 for proposals. Task 3C.3 passes (green).  
**Dependencies:** 3C.3  
**Parallel with:** 3A.4, 3B.4

---

## Phase 4 — Groups C + D: Retrofit Existing Endpoints and Directory Caps

> Requires: 1.7. All Phase 4 slices are independent and parallel with each other and with Phases 2 and 3.

---

### Slice 4A — Notifications

#### 4A.1 Write notifications route tests

**Files:** `tests/server/api/notifications/list-notifications.test.ts`  
**Acceptance:** 5 test cases (existing limit param still works, cursor accepted on first page, meta.unreadCount preserved in all cases, malformed cursor returns first page, 401). All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 4B.1, 4C.1, 4D.1, 4E.1, 4F.1

---

#### 4A.2 Retrofit notifications service and route

**Files:** `app/api/notifications/route.ts`, `lib/server/notifications/service.ts` (or equivalent), `lib/server/notifications/schema.ts`  
**Acceptance:** Route uses `cursorPaginationSchema` (replaces `listNotificationsQuerySchema`). Service accepts `{ cursor: CursorPayload | null, limit }` and fetches `limit + 1` rows. Route builds cursor envelope; merges `meta.unreadCount` (preserved from independent count query). Response shape: `{ data, meta: { unreadCount, limit, nextCursor } }`. Task 4A.1 passes (green).  
**Dependencies:** 4A.1

---

### Slice 4B — Updates

#### 4B.1 Write updates route tests

**Files:** `tests/server/api/updates/list-updates.test.ts`  
**Acceptance:** 4 test cases (existing limit still works, cursor accepted, meta.domains preserved, malformed cursor returns first page). All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 4A.1, 4C.1, 4D.1, 4E.1, 4F.1

---

#### 4B.2 Verify domains computation scope

**Files:** `lib/server/updates/service.ts` (or equivalent)  
**Acceptance:** Confirm that `domains` is computed from the **full visibility set** (independent of the page slice). If currently computed from `result.items`, split into two queries (one for domains, one for page rows). Document the decision inline with a comment.  
**Dependencies:** 4B.1  
**Note:** This is an investigation + fix step. If domains is already computed independently, the task is trivially done — just add a comment confirming it.

---

#### 4B.3 Retrofit updates service and route

**Files:** `app/api/updates/route.ts`, `lib/server/updates/service.ts`, `lib/server/updates/schema.ts`  
**Acceptance:** Route uses `cursorPaginationSchema`. Service accepts `{ cursor, limit }`, fetches `limit + 1` rows. `meta.domains` preserved (from independent computation — see 4B.2). Response shape: `{ data, meta: { domains, limit, nextCursor } }`. Task 4B.1 passes (green).  
**Dependencies:** 4B.2

---

### Slice 4C — Earnings History

#### 4C.1 Write earnings history route tests

**Files:** `tests/server/api/earnings/history.test.ts`  
**Acceptance:** 6 test cases (default limit is 100, limit cap is 200 — special case, cursor accepted, malformed cursor returns first page, admin path returns all earnings, non-admin scopes to userId). All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 4A.1, 4B.1, 4D.1, 4E.1, 4F.1

---

#### 4C.2 Retrofit earnings history route and repository

**Files:** `app/api/earnings/history/route.ts`, `lib/server/earnings/repository.ts`  
**Acceptance:** Route defines local `earningsHistorySchema` (cursor optional, limit 1–200 default 100) — NOT shared `cursorPaginationSchema`. Manual `Math.min(..., 200)` clamp removed; replaced by Zod schema. Repository signature updated to `(client, profileId?, { cursor, limit })`. Cursor envelope added. Auth pattern (`getCurrentPrincipal`) left unchanged. Task 4C.1 passes (green).  
**Dependencies:** 4C.1

---

### Slice 4D — Prototypes

#### 4D.1 Write prototypes route tests

**Files:** `tests/server/api/prototypes/list-prototypes.test.ts`  
**Acceptance:** 4 test cases (existing leadId filter still works, cursor accepted, default limit is 100, malformed cursor returns first page). All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 4A.1, 4B.1, 4C.1, 4E.1, 4F.1

---

#### 4D.2 Extend prototypes schema and retrofit route

**Files:** `lib/server/prototypes/schema.ts`, `app/api/prototypes/route.ts`, `lib/server/prototypes/repository.ts` (or service)  
**Acceptance:** `listPrototypeWorkspacesQuerySchema` extended with `cursor: z.string().optional()` and `limit` default changed to 100. Route calls `decodeCursor`, passes `{ cursor: CursorPayload | null, limit }` to repository. Response uses `buildCursorResponse`. Existing `leadId` filter preserved. Task 4D.1 passes (green).  
**Dependencies:** 4D.1

---

### Slice 4E — Users Admin (limit cap only)

#### 4E.1 Write admin users route tests

**Files:** `tests/server/api/users/admin-list.test.ts`  
**Acceptance:** 5 test cases (default returns ≤100 admins, explicit limit <100 respected, limit>100 clamped to 100, response shape unchanged — no meta key, 401). All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 4A.1, 4B.1, 4C.1, 4D.1, 4F.1

---

#### 4E.2 Apply limit cap to admin users route

**Files:** `app/api/users/admin/route.ts`  
**Acceptance:** Server-side default limit=100, max=100 applied via Zod (or inline `Math.min`). No cursor pagination added. Response shape byte-compatible with current (no `meta` wrapper). Task 4E.1 passes (green).  
**Dependencies:** 4E.1

---

### Slice 4F — Users Delivery (limit cap only)

#### 4F.1 Write delivery users route tests

**Files:** `tests/server/api/users/delivery-list.test.ts`  
**Acceptance:** Same 5 test cases as 4E.1 for delivery users. All fail (red).  
**Dependencies:** 1.7  
**Parallel with:** 4A.1, 4B.1, 4C.1, 4D.1, 4E.1

---

#### 4F.2 Apply limit cap to delivery users route

**Files:** `app/api/users/delivery/route.ts`  
**Acceptance:** Same pattern as 4E.2. Response shape unchanged. Task 4F.1 passes (green).  
**Dependencies:** 4F.1

---

## Summary

| Phase | Tasks | Parallelism |
|---|---|---|
| 1 — Shared infrastructure | 1.0 → 1.7 (8 tasks) | 1.1/1.2/1.3 parallel; 1.4/1.5/1.6 parallel |
| 2 — Offset (A/B/C leads+tasks+projects) | 12 tasks | 3 independent slices fully parallel |
| 3 — Cursor (A/B/C activity+proposals) | 12 tasks | 3 independent slices fully parallel |
| 4 — Retrofit + caps (A–F) | 12 tasks | 6 independent slices fully parallel |
| **Total** | **44 tasks** | |

### Critical path (sequential minimum)

```
1.0 → [1.1 + 1.2 + 1.3 in parallel]
     → [1.4 + 1.5 in parallel] → 1.6
     → 1.7 (gate)
     → pick any single slice e.g. 2A.1 → 2A.2 → 2A.3 → 2A.4
```

Minimum sequential steps from start to first verified endpoint: **10 tasks** (Phase 1 gate = 7 steps, then one 4-step slice).

### Strict TDD enforcement

Every implementation task (x.2 / x.4 in Phases 2–4; 1.4–1.6 in Phase 1) has a preceding test task that must fail first. No implementation task may begin until its paired test task exists and all tests in it fail for the right reason (missing implementation, not syntax error).
