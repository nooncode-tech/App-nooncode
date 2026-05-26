# spec.md — fase-3-g22-prototype-signed-read-handler-impl

## Title and metadata

- **Iteration name:** `fase-3-g22-prototype-signed-read-handler-impl`
- **Date:** 2026-05-26
- **Author:** Pedro (`noondevelop@gmail.com`), with `system-analysis` skill
- **Status:** Draft → pending operator Approval gate before Backend kickoff
- **Router mode:** **New Build** (greenfield handler; no legacy code on the surface)
- **Depth:** **LITE** (per router decision `docs/handoffs/2026-05-26-g22-handler-router-decision.md` §2: contracts firmed in ADR-024, single-file deliverable + tests + minor docs touches)
- **Active skill chain:** `system-analysis` (this spec) → `system-backend` (handler + repository helper + inline sanitization) → `system-testing` (integration-first per prototype-decision precedent) → `system-security` (HMAC GET surface + sanitization egress + cache header composition) → `system-docs` (`cross-repo-webhook-v1.md` §6 status flip + `docs/api-auth-matrix.md` row + `docs/context/project.context.core.md` treat-as flip + roadmap §16 G22 row + close-out handoff) → `system-validator` → close-out (operator merge)
- **Architecture iteration this depends on:** **ADR-024** (Accepted 2026-05-25) — all 7 decisions D1-D7 are immutable inputs. No new ADR is produced this iteration. If any landmine forces an amendment (see Risks R-1 / R-3), iteration **pauses** and re-enters Architecture per router escalation triggers §6.
- **Branch base:** `feat/g22-prototype-signed-read-handler` from `develop @ d41e6ed` (post-PR #110 merge), per router §2

---

## Business objective

Materialize the firmed wire contract `GET /api/integrations/website/prototype-signed-read/[token]` (ADR-024 + `docs/integrations/cross-repo-webhook-v1.md` §6) so that NoonWeb's D-slice render of `/maxwell/prototipo/[token]` can fetch prototipo content, minimal lead context, and decision state at render time over signed HTTPS. Without this iteration, NoonWeb-dev cannot start the D-slice (the prototipo page has no data source) and the Pull pattern B.2 read path of the Maxwell chat lead-creation flow remains the only un-implemented surface between operator chat ingestion and client decision capture. This iteration is the symmetric **read** counterpart to the **write** endpoint shipped in PR #110 (`fase-3-adr-023-b-c-slice-prototype-decision-impl`).

---

## Scope — in

### Handler implementation

- **Route file:** `app/api/integrations/website/prototype-signed-read/[token]/route.ts` exporting `GET` handler.
  - Runtime: `'nodejs'`. `dynamic = 'force-dynamic'` (per sibling pattern; cache headers are advisory for NoonWeb edge per ADR-024 D7, not for App internal cache).
  - Reads URL path-param `token`; reuses `verifyWebsiteWebhookSignature` from `lib/server/website-webhook-auth.ts` with `bodyText = ''` (zero-body convention per ADR-024 D1 + §2.1 cross-repo doc note).
  - Calls `assertRateLimit` with namespace `'prototype-signed-read'`, limit `60`, window `60_000` ms, key `${token}:${remoteIp}` (combined per ADR-024 D6). The handler computes `remoteIp` inline from `x-forwarded-for` / `x-real-ip` / `cf-connecting-ip` (mirroring `getClientIp` in `lib/server/api/rate-limit.ts` since that helper is not exported).
  - Sets `Cache-Control: private, max-age=30, stale-while-revalidate=60` on `200`; `Cache-Control: no-store` on every 4xx/5xx response (per ADR-024 D7).
  - Lifecycle check order per ADR-024 D2 §"Tombstone case": lead-deleted first → token-superseded second → decision lookup third. Deterministic.
  - Returns `{ data: { workspace, leadContext, prototype, decision, lifecycle, serverTime }, requestId }` per ADR-024 D3 / cross-repo doc §6.4 closed shape.
  - On error, returns `{ error, code, requestId }` per §8 common envelope with the `PROTOTYPE_READ_*` code namespace from D2.
  - Emits one `logger.info('website.prototype_signed_read.served', { token_hash, workspace_id, decision_status, server_time, requestId })` on success. Emits `logger.warn` on rejected / failed paths with `errorToLogContext`.
  - **No transport ledger participation** — declined-by-design per ADR-024 D1.

### Repository helper (new in `lib/server/prototypes/repository.ts`)

- **`getPrototypeWorkspaceByShareToken(client, token)`** — NEW helper.
  - Signature: `async function getPrototypeWorkspaceByShareToken(client: SupabaseClient<Database>, shareToken: string): Promise<PrototypeSignedReadRow | null>`.
  - Returns the workspace row joined with the parent lead's render-relevant columns (`leads.company`, `leads.name`, `leads.maxwell_snapshot` per OQ-1 RESOLVED — see Open Questions and ADR-024 §Amendments A1) and any existing `prototype_decisions` row. Single-row result by `share_token` UNIQUE constraint (migration 0060 element 2).
  - Returns `null` only on token-not-found. Soft-tombstone state (`share_token_superseded_at IS NOT NULL`, parent lead missing) is conveyed by the row payload itself (the handler maps to `410 *_TOKEN_SUPERSEDED` / `410 *_LEAD_DELETED`).
  - **DOES NOT** filter on `share_token_superseded_at` in SQL — the handler needs to see superseded rows to map them to `410 PROTOTYPE_READ_TOKEN_SUPERSEDED`. Filtering at SQL-layer would conflate "not found" with "superseded".
  - Built with `createSupabaseAdminClient()` at the call site (handler uses service-role; matches the symmetric POST handler pattern).
  - Type augmentation: a dedicated `PrototypeSignedReadRow` type may be added to `lib/server/prototypes/types.ts` OR derived inline from `Database['public']['Tables']['prototype_workspaces']['Row']` joined with the lead and decision shapes. Backend chooses; constraint: no schema change and no new `database.types.ts` regen needed (all columns exist post-migration 0060).
  - **RLS posture:** the handler runs with service-role (admin client), so RLS bypass is the expected and intended path — symmetric with the POST `prototype-decision` handler (which uses `createSupabaseAdminClient()` per migration 0060 element 4 RLS commentary: "service_role writes only via the C-slice webhook handler"). **No new RLS policy is added** — the existing `prototype_workspaces_select_visible_scope` + `prototype_decisions_select_visible_scope` policies cover authenticated SELECT; the GET handler does not consume them. **AC-10 verifies** an authenticated (non-service-role) role cannot SELECT by `share_token` from `prototype_workspaces` via the anon GoTrue boundary (defense-in-depth posture documented; no policy change).

### Inline sanitization (per ADR-024 D4)

- **Pattern:** the handler constructs the response object **field-by-field from named source values**. No `{ ...workspaceRow }` spreads. No `Object.assign(response, leadRow)`.
- **Positive allowlist (13 fields per ADR-024 D3):**
  ```
  data.workspace.id              ← workspaceRow.id
  data.workspace.version         ← derived: count of workspaces under same lead with created_at ≤ this.created_at
  data.workspace.generatedAt     ← workspaceRow.created_at (as ISO 8601 UTC)
  data.leadContext.businessName  ← leadRow.company ?? leadRow.name (per ADR-024 §Amendments A1, OQ-1 RESOLVED 2026-05-26)
  data.leadContext.projectTypeLabel ← humanizeLabel(leadRow.maxwell_snapshot ->> 'project_type' ?? 'Sitio Web') (per ADR-024 §Amendments A1)
  data.prototype.deployedUrl     ← workspaceRow.demo_url (nullable)
  data.prototype.generatedHtml   ← workspaceRow.generated_content (nullable)
  data.decision.status           ← 'pending' | decisionRow.decision ('accepted' | 'rejected')
  data.decision.notes            ← decisionRow.notes when status='rejected' AND non-null; else null
  data.decision.decidedAt        ← decisionRow.decided_at (ISO 8601); null when pending
  data.lifecycle.tokenSuperseded ← derived: workspaceRow.share_token_superseded_at IS NOT NULL (always false on 200)
  data.lifecycle.iterationNumber ← equals workspace.version for now (forward-compat slot)
  data.serverTime                ← new Date().toISOString() at handler time
  ```
- **Explicit strip-list enforcement (per ADR-024 D3 + cross-repo doc §6.11):** allowlist construction is the primary defense; the strip-list (`lead_proposals.*`, `seller_fees.*`, `user_wallets.*`, `user_profiles.*`, `leads.{notes,score,next_follow_up_at,lead_origin,assigned_to,created_by}`, `prototype_workspaces.{created_by,updated_at,share_token,share_token_superseded_at}`, `prototype_credit_settings.*`, `prototype_decisions.{client_user_agent,webhook_event_id}`, raw `leads.project_type` enum) is asserted by tests (AC-8) — no field outside the 13-field allowlist appears in the JSON response under any fixture.
- **Canary log:** `logger.warn('prototype.signed_read.allowlist.unexpected_field', { fieldName })` if the source row contains a top-level column whose value is non-null AND not on the allowlist AND not on the explicit strip-list. Implementation: a tiny audit pass over `Object.keys(workspaceRow ∪ leadRow ∪ decisionRow)`. **The warning is non-blocking** — the response still uses the allowlist.

### Project-type label derivation

- The handler derives `projectTypeLabel` from the raw enum value (the literal column name TBD per OQ-1). Mapping is **inline in the handler module** (small `const PROJECT_TYPE_LABELS: Record<string, string>` map). No shared helper. If the enum has 5 or fewer expected values (`landing`, `webapp`, `ecommerce`, etc.), inline is appropriate. **Default fallback:** if the source enum is `null` or unmapped, the label is `'Sitio Web'` (generic, non-misleading). Mapping table is documented in the handler module's JSDoc.

### Tests

- **New test file:** `tests/server/api/integrations/website/prototype-signed-read.test.ts` mirroring the integration-first pattern of `tests/server/api/integrations/website/prototype-decision.test.ts`.
- **Scope:** unit-style integration tests against a mocked Supabase client (same `makeMockClient` harness pattern as the sibling). HMAC end-to-end + Vercel-edge cache behavior + real Supabase reads are deferred to **smoke A G22** (future iteration; see Scope-out).

### Documentation touches (within this iteration's PR, NOT a separate PR per memory `feedback_develop_pr_only_or_local`)

- `docs/integrations/cross-repo-webhook-v1.md` §6 status banner: flip `firmed by ADR-024 (2026-05-25). Endpoint code lands in a follow-up handler iteration (App-side)` → `firmed by ADR-024 (2026-05-25). Endpoint shipped <YYYY-MM-DD> via PR #<N> (App-side handler).`
- `docs/api-auth-matrix.md` — append row: `GET /api/integrations/website/prototype-signed-read/[token]` · auth: HMAC (`NOON_WEBSITE_WEBHOOK_SECRET`, zero-body signing) · rate-limit: 60/min, key `${token}:${ip}` · cache: `private, max-age=30, stale-while-revalidate=60` on 200, `no-store` on 4xx/5xx · ledger: declined-by-design.
- `docs/context/project.context.core.md` — flip the existing rule line 459 framing **"future ... endpoint"** → **"implemented endpoint"** (treat-as content remains identical to ADR-024 contract; no plan-IDs / R-codes added per memory `feedback_context_docs_no_plan_refs`).
- `docs/context/project.context.full.md` — append endpoint to its surface inventory section if such a section exists (Backend chain confirms during impl).
- `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §16 row 9 (G22) — flip status to RESOLVED post-merge per memory `feedback_keep_roadmap_in_sync`.
- Close-out handoff `docs/handoffs/2026-05-26-g22-prototype-signed-read-handler-closure.md` (or equivalent date-tagged path) — capture firmed endpoint + next-session priorities (typically: smoke A G22 + NoonWeb-side D-slice arrancar).

---

## Scope — out

- **Smoke A G22** (end-to-end live HMAC GET fire-script symmetric to `docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs`). Sibling iteration after merge, per established pattern. Landmine #5 from router decision §8: **resistir** the temptation to bundle.
- **`lib/security/project-isolation.ts` + `sanitizeForClient()` formal helper.** Per ADR-024 D4: inline allowlist is the locked default; the formal module is **E-1 conditional**. If during implementation the sanitization logic exceeds ~2h of expansion (nested traversal, recursive depth checks, DTO mapping), Backend **pauses** and opens sibling iteration `fase-3-sanitization-shared-helper` per router escalation §6 trigger #1.
- **Ledger entry for reads** in `website_webhook_events`. Per ADR-024 D1 + router escalation §6 trigger #3: **HARD STOP**. Future analytics on render-fetch lives in NoonWeb (which already sees the hit) or a dedicated analytics surface; ADR-024 D1 is the architectural source-of-truth and cannot be silently re-litigated.
- **NoonWeb-side D-slice render** of `/maxwell/prototipo/[token]`. Different repo (`noon-web-main`), different owner (NoonWeb-dev). This iteration is **the data source** NoonWeb consumes; the render layer is out of this repo entirely.
- **New env vars.** ADR-024 D1: reuses `NOON_WEBSITE_WEBHOOK_SECRET`. **No infra change.**
- **Migration `0061+_*.sql`.** No schema change. All required columns (`share_token`, `share_token_superseded_at`) shipped in migration `0060_phase_23a_prototype_decisions.sql` (already merged via PR #108/110). `database.types.ts` regen is **not needed**.
- **Auth helpers consolidation (G24).** Webhook-authed endpoint; no `requireSession/requirePrincipal/requireRole/requireDashboardAccess` call.
- **Internal cache layer in App.** ADR-024 D7: handler is server-rendered at request time; cache headers are advisory for NoonWeb edge / browser. No in-process cache module is added.
- **Vercel Analytics / Sentry spans.** Structured logs are the audit trail (ADR-024 D1 §"Observability"). No analytics-event surface lands this iteration.
- **Rename of `PROTOTYPE_DECISION_TOKEN_EXPIRED` to `_TOKEN_SUPERSEDED`** on the write-side. ADR-024 D2 §"Symmetry with ADR-023 D5 codes": deferred to a future Docs amendment to avoid cascading a contract change to NoonWeb-dev who has already read ADR-023.
- **Pull pattern B.1 (Push) variants.** Locked by L-2 + ADR-023 D8 + ADR-024 context. Out of scope by definition.
- **Bilateral NoonWeb-dev coordination ceremony.** The contract is already firmed by ADR-024 + cross-repo doc §6; NoonWeb-dev acknowledgment was requested as part of PR #105 / ADR-024 closure. This iteration ships against the firmed contract; no new coordination cycle is opened.

---

## Acceptance criteria

Each criterion is observable via the integration test suite, a direct DB query, or static-file inspection.

1. **AC-1 — Happy 200 (pending decision):** A signed GET with valid `x-noon-timestamp`, valid `x-noon-signature` (HMAC-SHA256 of `${timestamp}.` with `NOON_WEBSITE_WEBHOOK_SECRET`), and a token resolving to a non-superseded workspace **with no `prototype_decisions` row** returns:
   - HTTP `200`,
   - body matching ADR-024 D3 closed shape with `data.decision.status === 'pending'` and `data.decision.notes === null` and `data.decision.decidedAt === null`,
   - `Cache-Control: private, max-age=30, stale-while-revalidate=60`,
   - `data.workspace.id` equal to the resolved workspace row id,
   - `data.lifecycle.tokenSuperseded === false`,
   - response body **does NOT contain** `share_token` or `share_token_superseded_at` anywhere (token strip-list invariant; ADR-024 D3 §"sanitization strip-list").

2. **AC-2 — Happy 200 (accepted decision):** Same as AC-1 but with an existing `prototype_decisions` row where `decision='accepted'`, `notes=null`, `decided_at` populated:
   - `data.decision.status === 'accepted'`,
   - `data.decision.notes === null` (sanitizer returns null even if column had a value; ADR-024 D3),
   - `data.decision.decidedAt` is the row's `decided_at` as ISO 8601,
   - HTTP `200` + standard `Cache-Control`.

3. **AC-3 — Happy 200 (rejected decision):** Same as AC-1 but with `decision='rejected'`, `notes='No coincide...'`:
   - `data.decision.status === 'rejected'`,
   - `data.decision.notes === 'No coincide...'` (echoed verbatim, sanitizer **does NOT** strip notes on rejected per ADR-024 D3 field-by-field rationale).

4. **AC-4 — 404 token not found:** A signed GET with a token that does not match any `prototype_workspaces.share_token` row returns `{ error, code: 'PROTOTYPE_READ_TOKEN_NOT_FOUND', requestId }` with HTTP `404` and `Cache-Control: no-store`.

5. **AC-5 — 410 token superseded:** A signed GET against a token whose row has `share_token_superseded_at IS NOT NULL` returns `{ error, code: 'PROTOTYPE_READ_TOKEN_SUPERSEDED', requestId }` with HTTP `410` and `Cache-Control: no-store`. (Even if a decision row also exists; supersede beats decision-state in the response code.)

6. **AC-6 — 410 lead deleted:** A signed GET against a token whose `prototype_workspaces` row exists but whose parent `leads` row has been hard-deleted (defensive code path; FK cascade should normally remove the workspace too) returns `{ error, code: 'PROTOTYPE_READ_LEAD_DELETED', requestId }` with HTTP `410` and `Cache-Control: no-store`. Lead-deleted is checked **before** token-superseded per ADR-024 D2 §"Tombstone case" deterministic order.

7. **AC-7 — 401 HMAC mismatch:** A GET with `x-noon-signature` not matching the HMAC of `${timestamp}.` returns `{ error, code: 'WEBSITE_WEBHOOK_AUTH_FAILED', requestId }` with HTTP `401` and `Cache-Control: no-store`. (Subsumes timestamp-skew failure since `assertRecentTimestamp` is part of `verifyWebsiteWebhookSignature` and throws the same `WebsiteWebhookError`; one consolidated test covers both per router test minimums note.)

8. **AC-8 — Sanitization allowlist holds:** Given a fixture workspace row decorated with operator-internal fields (`created_by`, `updated_at` populated), a fixture lead row decorated with operator-internal fields (`notes`, `score`, `lead_origin`, `assigned_to`, `created_by`, `next_follow_up_at`), and a fixture decision row decorated with `client_user_agent` and `webhook_event_id`, the 200 JSON response body when stringified **contains none of:** `created_by`, `updated_at`, `notes` (when status is 'pending' or 'accepted'), `score`, `lead_origin`, `assigned_to`, `next_follow_up_at`, `client_user_agent`, `webhook_event_id`, `share_token`, `share_token_superseded_at`, raw `project_type` enum string. The test grep-asserts each forbidden field name is absent from the serialized response body.

9. **AC-9 — Cache header exactness:** AC-1's 200 response carries the literal header value `Cache-Control: private, max-age=30, stale-while-revalidate=60` byte-for-byte (no `s-maxage`, no `public`, no extra directives). 4xx/5xx responses carry `Cache-Control: no-store` byte-for-byte.

10. **AC-10 — RLS posture defensive check:** A direct SELECT from `anon` GoTrue role against `public.prototype_workspaces` filtered by `share_token = '<known>'` returns zero rows (the existing `prototype_workspaces` RLS policies do not include an unauthenticated lookup-by-share-token path). The handler's reliance on service-role bypass is therefore the only legitimate read path. This is a **defense-in-depth invariant**, not a behavior change. (Optional Backend test; if test harness for anon-role SELECT is not present in this repo, AC-10 is satisfied by manual SQL verification recorded in the PR description.)

11. **AC-11 — GET idempotency:** Same token + same valid HMAC (same timestamp) sent twice returns **byte-identical response bodies** (modulo `requestId` which is per-request and modulo `serverTime` which moves with wall-clock; the rest of `data.{workspace, leadContext, prototype, decision, lifecycle}` must be deep-equal). Concurrent reads do not collide.

12. **AC-12 — Rate-limit 429:** A 61st request within 60s under the same `${token}:${remoteIp}` key returns `{ error, code: 'RATE_LIMITED', requestId }` with HTTP `429` and `Cache-Control: no-store`. (`assertRateLimit` throws `RateLimitExceededError` which already maps to 429 via `toErrorResponse`.) Tested via the in-memory limiter engine; the Upstash engine path is not exercised in unit tests.

13. **AC-13 — Project gates green:** `pnpm lint`, `pnpm typecheck`, full test suite pass. No regression in sibling `prototype-decision` tests.

14. **AC-14 — Docs touches landed:** All six docs touches enumerated under Scope-in "Documentation touches" are present in the same PR. `project.context.core.md` line 459 reframed from "future" to "implemented" without adding plan-refs.

---

## Affected files and modules

### New files

- `app/api/integrations/website/prototype-signed-read/[token]/route.ts` — handler (GET).
- `tests/server/api/integrations/website/prototype-signed-read.test.ts` — integration-style tests mirroring the sibling prototype-decision test pattern.
- `docs/handoffs/2026-05-26-g22-prototype-signed-read-handler-closure.md` — close-out handoff (Docs skill writes at iteration close).

### Modified files

- `lib/server/prototypes/repository.ts` — append `getPrototypeWorkspaceByShareToken` helper. May also add a dedicated SELECT projection (`prototypeSignedReadSelect` const) that joins lead + decision in a single round-trip.
- `lib/server/prototypes/types.ts` — possibly augment with `PrototypeSignedReadRow` type (Backend chooses inline-typed-at-call-site vs named-type).
- `docs/integrations/cross-repo-webhook-v1.md` §6 status banner — flip "endpoint code lands in follow-up" → "endpoint shipped" with PR ref + date.
- `docs/api-auth-matrix.md` — append row for new endpoint.
- `docs/context/project.context.core.md` — reframe line 459 from "future endpoint" to "implemented endpoint" (no plan-refs).
- `docs/context/project.context.full.md` — append endpoint to surface inventory if such section exists.
- `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` — §16 row 9 (G22) status flip post-merge per memory `feedback_keep_roadmap_in_sync`.

### Read-only references (no modification expected)

- `app/api/integrations/website/prototype-decision/route.ts` — sibling handler shape (PR #110); structural mirror reference.
- `tests/server/api/integrations/website/prototype-decision.test.ts` — test pattern mirror.
- `lib/server/website-webhook-auth.ts` — HMAC verifier; reused **unchanged** (the parameterized `bodyText` lets the GET pass `''`).
- `lib/server/api/rate-limit.ts` — `assertRateLimit` reused **unchanged**; `getClientIp` logic replicated inline in the handler since it is not exported.
- `lib/server/api/request.ts` — `getRequestId` + `jsonWithRequestId` reused unchanged.
- `lib/server/api/errors.ts` + `lib/server/api/logger.ts` — reused unchanged.
- `lib/server/supabase/admin.ts` — `createSupabaseAdminClient` reused unchanged.
- `lib/server/supabase/database.types.ts` — read-only; all required columns shipped in migration 0060 (verified: rows 1199-1200, 1217-1218, 1235-1236, 2385-2386 carry `share_token` + `share_token_superseded_at`).
- `supabase/migrations/0060_phase_23a_prototype_decisions.sql` — read-only; element 2 ships `share_token text not null unique` + `share_token_superseded_at timestamptz null`; element 7's `request_lead_prototype` RPC sets supersede.
- `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md` — anchor; all D1-D7 are immutable inputs.

---

## Dependencies

### Internal

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| ADR-024 (Architecture decisions D1-D7) | ✅ Accepted 2026-05-25 | Without it, no contract; iteration unscoped | system-architecture (closed) |
| `docs/integrations/cross-repo-webhook-v1.md` §6 (Inbound read endpoints) | ✅ Published 2026-05-25 | NoonWeb cannot build D-slice without it; impl drifts without anchor | system-architecture (closed) |
| Migration 0060 (`share_token`, `share_token_superseded_at`, RPC `request_lead_prototype` supersede) | ✅ Merged via PR #108 / refined in PR #110 | Without it, no `share_token` column to resolve against | Backend (closed) |
| `lib/server/website-webhook-auth.ts` HMAC verifier with parameterized `bodyText` | ✅ Live | Without it, no inbound auth; GET zero-body convention impossible | Backend (existing) |
| `lib/server/api/rate-limit.ts` `assertRateLimit` accepting `options.key` | ✅ Live | Without it, combined-key rate-limit impossible | Backend (existing) |
| `lib/server/supabase/admin.ts` `createSupabaseAdminClient` | ✅ Live | Without it, no service-role read | Backend (existing) |
| `lib/server/prototypes/repository.ts` (extending) | ✅ Live (existing helpers `getPrototypeWorkspaceByLeadId` / `getPrototypeWorkspaceById`) — but **no `getPrototypeWorkspaceByShareToken` yet** | This iteration adds the helper; not blocking, but a landmine if Backend tries to silently reuse `getPrototypeWorkspaceById` (different key column) | This iteration |

### External

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| NoonWeb's D-slice rendering against this endpoint | ⚠️ Not built (D-slice TBD) | Without it, the endpoint is inert post-merge; first real exercise lands when NoonWeb ships | NoonWeb-dev |

### Contract

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| Wire shape per ADR-024 D3 / cross-repo doc §6.4 | ✅ Frozen | Any deviation breaks NoonWeb integration on first GET | system-architecture (closed) |
| Error code namespace `PROTOTYPE_READ_*` per ADR-024 D2 | ✅ Frozen | Renamed/typo'd codes break NoonWeb UX mapping | system-architecture (closed) |
| Cache header strings per ADR-024 D7 (byte-exact) | ✅ Frozen | Different directives break NoonWeb edge cache behavior | system-architecture (closed) |
| HMAC empty-body convention per ADR-024 D1 + cross-repo §2.1 note | ✅ Frozen | Without it, NoonWeb signs the wrong input and 401s every request | system-architecture (closed) |

### Infra

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| `NOON_WEBSITE_WEBHOOK_SECRET` env var | ✅ Live (shared with three inbound POST entries) | Without it, HMAC fails on every endpoint | Operator |
| `NOON_RATE_LIMIT_DISABLED` env var (optional test seam) | ✅ Live | Without it, tests must seed rate-limit budget per-namespace | Operator (test-time only) |

### Data

| Dependency | Status | Impact if missing | Owner |
|---|---|---|---|
| `prototype_workspaces.share_token` column (UNIQUE, NOT NULL) | ✅ Live (migration 0060 element 2) | Without it, no lookup key | Closed |
| `prototype_workspaces.share_token_superseded_at` column (timestamptz, nullable) | ✅ Live (migration 0060 element 2) | Without it, no supersede check | Closed |
| `prototype_decisions` table | ✅ Live (migration 0060 element 4) | Without it, no decision lookup; handler would always return 'pending' | Closed |
| `leads.company`, `leads.name`, `leads.maxwell_snapshot` (JSONB) sourcing `businessName` + `projectTypeLabel` | ✅ **RESOLVED 2026-05-26** via ADR-024 §Amendments A1 (OQ-1) | Mapping locked — repository helper includes these 3 columns in SELECT projection | Closed |

---

## Assumptions

1. **A-1 — `verifyWebsiteWebhookSignature` is GET-compatible as-written.** Empirically verified 2026-05-26 by Analysis: the function signature is `verifyWebsiteWebhookSignature(headers: Headers, bodyText: string)` and computes HMAC over `${timestamp}.${bodyText}`. The handler will pass `bodyText = ''` (zero-body convention per ADR-024 D1). **No amendment to ADR-024 needed; landmine #1 from router decision is RESOLVED — verifier is body-parameterized, not body-coupled.** Cross-repo doc §2.1 already documents the empty-body convention.

2. **A-2 — `assertRateLimit` accepts arbitrary `options.key` strings.** Empirically verified 2026-05-26: line 15 of `lib/server/api/rate-limit.ts` declares `key?: string | null`. The combined-key `${token}:${remoteIp}` is supported without primitive changes.

3. **A-3 — Service-role read via `createSupabaseAdminClient()` is the intended access path.** Symmetric with the POST `prototype-decision` handler (PR #110) which uses the admin client. RLS bypass on read is intentional per ADR-024 implicit posture (the handler is not authenticated by a Supabase user session; it is authenticated by HMAC envelope at the HTTP layer). **AC-10 documents this as a defense-in-depth posture, not a behavior change.**

4. **A-4 — `workspace.version` can be derived without a dedicated column.** Migration 0060 does not add an explicit `version` column to `prototype_workspaces`. The version is computed at read-time as: `count(workspaces where lead_id = same AND created_at <= this.created_at)`. **This is one extra query** (the workspace row + the version count). Backend may optimize into the main query as a window-function subselect or a `SELECT count(*) FROM prototype_workspaces WHERE lead_id = $1 AND created_at <= $2` follow-up. If Backend finds the derivation expensive, the response may stabilize on iteration boundaries (no real-time recount per render). The locked invariant is: `workspace.version === lifecycle.iterationNumber === number of workspaces created at or before this one under the same lead`.

5. **A-5 — `data.prototype.deployedUrl` maps to `prototype_workspaces.demo_url`** (confirmed via `prototypeWorkspaceSelect` in existing repository helpers + migration 0020 history). `data.prototype.generatedHtml` maps to `prototype_workspaces.generated_content`. Both nullable in current schema (consistent with "build in progress" nullable state per ADR-024 D3).

6. **A-6 — `gen_random_uuid()::text` token entropy (~122 bits CSPRNG) is sufficient for signed-read posture at pilot scale.** Inherited from `fase-3-g22-signed-read-spec.md` A-6 + migration 0060 element 2 backfill. Future hardening (rotating signing key, prefix, etc.) is a re-evaluation trigger per ADR-024 §"Re-evaluation triggers", not this iteration.

7. **A-7 — Lead hard-delete cascades remove the workspace row via FK `prototype_workspaces.lead_id REFERENCES leads(id) ON DELETE CASCADE`.** Migration 0020 establishes the FK; the AC-6 defensive path (workspace exists but lead is gone) covers the race window where the workspace row outlives a concurrent lead delete by milliseconds. In steady state the cascade should make this path unreachable.

8. **A-8 — `getClientIp` logic can be replicated inline** (4 lines, reading 3 headers) without introducing a circular import or refactoring `rate-limit.ts` to export it. Backend may instead export `getClientIp` from `lib/server/api/rate-limit.ts` in this iteration as a minor refactor; the choice is Backend's. **No new shared module is introduced.**

9. **A-9 — The `share_token` column value is treated as opaque by the handler** — passed through `verifyWebsiteWebhookSignature` only as part of the rate-limit key string. The handler does NOT URL-decode the token (Next.js path-param decoding happens at the routing layer) nor case-fold (uuid-text is case-significant by Postgres `text` comparison).

10. **A-10 — `prototype_decisions` row, if present, is unique by `prototype_workspace_id`** (migration 0060 element 4 `ux_prototype_decisions_workspace_one_terminal`). The handler reads at most one decision row per workspace.

If any assumption breaks during Backend implementation, the responsible skill stops and updates this spec with a dated note before proceeding.

---

## Open questions

### OQ-1 — Source columns for `data.leadContext.businessName` and `data.leadContext.projectTypeLabel`

**Status:** ✅ **RESOLVED 2026-05-26 by ADR-024 §Amendments A1** (Option A — amend ADR-024 to reflect actual schema; operator-approved).

**Resolution:**

- `data.leadContext.businessName` ← `leads.company ?? leads.name` (handler coalesces; `name` is NOT NULL per migration 0020, so the field is always populated).
- `data.leadContext.projectTypeLabel` ← `humanizeLabel(leads.maxwell_snapshot ->> 'project_type' ?? 'Sitio Web')`. The humanization map is inline in the handler module; values like `'landing'` → `'Landing Page'`, `'webapp'` → `'Web App'`, `'ecommerce'` → `'E-commerce'`. Unknown values pass through humanized via title-case fallback. The `'Sitio Web'` default applies when the snapshot is missing or has no `project_type` key.

**Backend constraints (carried forward):**

- The new repository helper `getPrototypeWorkspaceByShareToken` MUST include `leads.company`, `leads.name`, and `leads.maxwell_snapshot` in its SELECT projection.
- The humanization map lives inline in the handler module (`const PROJECT_TYPE_LABELS: Record<string, string>`). If it grows >5 entries or requires localization in a future iteration, extract to `lib/maxwell/project-type-labels.ts`. Out of scope for this iteration.
- Tests assert: (a) `businessName = company` when `company` is non-null; (b) `businessName = name` when `company` is null and `name` is present; (c) `projectTypeLabel` derived correctly for 2-3 sample snapshot values; (d) `projectTypeLabel = 'Sitio Web'` when snapshot is `{}` or missing `project_type` key.

**Historical context (pre-resolution candidates considered):**

- **For `businessName`:** (a) `leads.company` with fallback to `leads.name` ← **SELECTED**. (b) `leads.name` alone — rejected (name is often the contact person, not the business). (c) `maxwell_snapshot ->> 'business_name'` — rejected (snapshot field unverified in ingest path; `company` is the operator-curated truth). (d) Add new `leads.business_name` column — rejected (changes schema to fit contract; ADR amendment is cheaper).
- **For `projectTypeLabel`:** (a) `lead_proposals.project_type` — rejected (no proposal exists at prototipo render time). (b) `leads.maxwell_snapshot ->> 'project_type'` with `'Sitio Web'` default ← **SELECTED**. (c) `prototype_workspaces.metadata ->> 'project_type'` — rejected (column not in current select projection).

**Why Option A (amend ADR) over Option B (schema backfill) or Option C (inline mapping with contract drift):** the endpoint has not shipped, so NoonWeb-dev has no client implementation to break. Amending the ADR is ~30min in docs, restores contract truth, and the pending NoonWeb-dev acknowledgment of §6 (per `docs/handoffs/2026-05-25-maxwell-chat-cross-repo-contracts-noonweb-handoff.md`) now covers the corrected mapping at no additional coordination cost.

### OQ-2 — Exact `getClientIp` reuse strategy

**Status:** OPEN — Backend operational choice.

Two options:
- (a) Replicate the 4-line logic inline in the handler (current `getClientIp` reads `x-forwarded-for` first-hop, then `x-real-ip`, then `cf-connecting-ip`, then literal `'unknown'`). Smallest scope.
- (b) Export `getClientIp` from `lib/server/api/rate-limit.ts` and import it in the handler. Tiny refactor (one `export` keyword); single source of truth for IP extraction.

**Recommendation:** **(b)** — single `export` keyword is a 1-line refactor with zero behavior change and prevents drift between the rate-limit primitive's internal IP extraction (used for IP-only fallback) and the handler's combined-key composition.

**Backend resolves at implementation.** Either is acceptable; (b) is preferred.

### OQ-3 — Test harness for `assertRateLimit` budget reset between tests

**Status:** OPEN — Backend operational choice.

`lib/server/api/rate-limit.ts` exports `resetRateLimitStoreForTests()` and `__setRateLimitEngineForTests()`. The sibling `prototype-decision.test.ts` does not exercise rate-limit because its tests target the synchronous handler helper, not the route. **AC-12 (rate-limit 429) requires the route file to be exercised in tests** OR a contract-level assertion that the route calls `assertRateLimit` with the documented options. Backend chooses between:
- (a) Direct route invocation (build a `Request` mock + import the route's `GET`) and exercise the rate-limit with `resetRateLimitStoreForTests` between tests.
- (b) Handler-helper extraction (move the lifecycle logic into a testable function symmetric to `receiveWebsitePrototypeDecision`); the route file imports and orchestrates. Easier to test.

**Recommendation:** **(b)** — symmetric with the sibling pattern (`receiveWebsitePrototypeDecision` is in `lib/server/website-integration.ts`, the route is a thin wrapper). A handler helper `serveWebsitePrototypeSignedRead(client, token)` keeps tests at the helper level and exercises the route at a smoke level later (smoke A G22, separate iteration).

Backend decides during implementation; either preserves AC coverage.

---

## Risks

| ID | Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| **R-1** | **OQ-1 misresolution (wrong lead-column mapping for `businessName` / `projectTypeLabel`).** Backend picks `leads.company` when operator intent was `leads.maxwell_snapshot ->> 'business_name'`, ships, NoonWeb renders wrong text on the prototipo page. Detection requires either a smoke A run or NoonWeb operator feedback — hard to detect via unit tests because the test fixtures match whatever Backend chose. | Medium | Medium | **High** | Backend MUST pause if OQ-1 is not resolvable within 30 minutes; surface to operator for the column-mapping call. The PR description MUST explicitly state which columns map to which response fields (one line each). NoonWeb-dev review of the PR can catch divergence from the cross-repo doc §6.4 wording. |
| **R-2** | **Sanitization scope creep — E-1 escalation.** Backend starts inline allowlist per ADR-024 D4, discovers a nested shape (e.g., `maxwell_snapshot` JSONB needs structured field extraction for `projectTypeLabel`), and the work expands past 2h. Per ADR-024 D4 + router escalation §6 trigger #1: **PAUSE and open sibling `fase-3-sanitization-shared-helper`**. Risk: Backend instead silently absorbs the expansion and ships sloppy or over-scoped sanitization. | Medium | High | **High** | Backend MUST checkpoint sanitization effort at the 1.5h mark and decide pause-or-continue **explicitly**. The handler module's JSDoc records the E-1 decision. If E-1 fires, this spec is updated with a dated note + the sibling spec is opened before Backend resumes. |
| **R-3** | **Repository helper `getPrototypeWorkspaceByShareToken` touches RLS unintentionally.** Backend writes the helper using the service-role admin client (correct) but later refactors a sibling helper to use the same client, inadvertently bypassing RLS on a surface that should respect it. Per router escalation §6 trigger #2. | Low | Medium | **Medium** | The new helper docs (JSDoc on the function) explicitly state "service-role; intentional RLS bypass per ADR-024; do not reuse this client pattern for authenticated-user surfaces". Security skill reviews the helper at iteration close. |
| **R-4** | **HMAC GET timing-attack surface differs from POST.** The verifier uses `crypto.timingSafeEqual` (verified line 54 of `website-webhook-auth.ts`), so the signature comparison itself is timing-safe. But: the rate-limit `${token}:${ip}` key includes the token — a probing attacker can observe rate-limit responses to enumerate tokens. | Low | Medium | **Low** | The token namespace is `~122 bits` of CSPRNG entropy per A-6; brute enumeration is infeasible. The rate-limit fail-mode (429) does not reveal whether the token exists (a non-existent token would consume the rate-limit budget before the 404 returns — same observable behavior). Acceptable risk. Security skill confirms at close. |
| **R-5** | **Cache header + rate-limit composition leak.** Per router landmine #4: a `Cache-Control: private, max-age=30, swr=60` response on a 200 may be served from NoonWeb edge cache for subsequent identical requests — those served-from-cache requests **do not hit App** and therefore **do not consume the rate-limit budget**. An attacker holding a valid token + valid HMAC can therefore exceed the App-side 60/min budget per `(token, ip)` by leveraging the edge cache. | Low | Low | **Low** | This is **intentional** per ADR-024 D6 + D7 composition — the rate-limit defends App-side resources; edge-cached hits do not consume App resources. NoonWeb edge cache is a per-tenant `private` bucket (D7), so cross-tenant amplification is impossible. Security skill documents this in the close-out review as acceptable-by-design. |
| **R-6** | **`workspace.version` derivation race.** The version count `count(workspaces where lead_id = same AND created_at <= this.created_at)` can change if a regenerate fires between two reads. Two concurrent GETs may see different `version` values for the same workspace. | Low | Low | **Low** | The derivation is stable within a single render (single round-trip); cross-render drift is a non-issue because the **token itself** invalidates on regenerate (V1's token gets `share_token_superseded_at`, V2's row has a new token). A reader observing version drift on V1's token is observing the moment of supersede — the next read returns 410. Self-healing. |
| **R-7** | **`docs/context/project.context.full.md` "surface inventory" section may not exist.** Backend touches based on a memory of a section that has been refactored away; the touch becomes a no-op or a misplaced edit. | Low | Low | **Low** | Docs chain greps the file for an explicit surface-inventory section before editing; if absent, the touch is skipped and noted in the close-out handoff. Not blocking. |
| **R-8** | **Smoke A scope creep.** Tempting to include a smoke-fire mjs script in this iteration since the sibling PR #110 did so. Router landmine #5: out-of-scope. | Low | Low | **Low** | Spec scope-out item is the contract; Validator enforces. Smoke A is a follow-up iteration. |

---

## Recommended testing methodology

**Integration-first**, per the prototype-decision precedent (sibling test pattern in `tests/server/api/integrations/website/prototype-decision.test.ts`).

**Justification:** the iteration's correctness criterion is **wire-contract observable behavior** (HTTP request/response shape, cache headers, status codes, sanitization-allowlist invariant). Integration tests against a mocked Supabase client exercise the handler's full request → response path, including HMAC verification, rate-limit invocation, repository lookup, lifecycle branching, sanitization, and header composition. Unit tests would require splitting the handler into testable atoms that obscure the test contract. TDD is over-rotation given the contract is firmed externally by ADR-024. CDD / BDD adds ceremony without value at LITE depth.

**Concrete test list (Testing chain expands as needed):**

| # | Test | AC reference |
|---|---|---|
| 1 | Happy 200 pending (no decision row) — verifies wire shape, cache header, allowlist | AC-1, AC-9 |
| 2 | Happy 200 accepted (decision row with status='accepted') | AC-2 |
| 3 | Happy 200 rejected (decision row with status='rejected', notes populated) | AC-3 |
| 4 | 404 token not found | AC-4 |
| 5 | 410 token superseded (`share_token_superseded_at IS NOT NULL`) | AC-5 |
| 6 | 410 lead deleted (workspace row exists, parent lead row null) | AC-6 |
| 7 | 401 HMAC mismatch / timestamp skew (consolidated per router test minimums) | AC-7 |
| 8 | Sanitization allowlist — fixture row decorated with operator-internal fields; grep-assert absence | AC-8 |
| 9 | 429 rate-limit budget exhausted | AC-12 |
| 10 | Idempotency — same token + same HMAC twice, deep-equal response bodies modulo `requestId` + `serverTime` | AC-11 |
| 11 | RLS defensive — anon role direct SELECT returns zero rows (optional; manual SQL verification acceptable) | AC-10 |

Sibling pattern consolidations from the prototype-decision test file apply: `makeMockClient` harness, fixture row constants, `assert.rejects` for thrown errors. The HMAC signature verifier has its own unit tests (`tests/server/website-webhook-auth.test.ts` if present), so this iteration's tests **focus on handler behavior, not HMAC mechanics**, and use a test seam to inject pre-verified state where convenient.

**Test surface for AC-9 cache-header byte-exactness:** assertions on `Response.headers.get('Cache-Control')` strict-equality to the documented string. Any whitespace variation or directive reordering fails.

---

## Definition of Done

- [ ] Handler `app/api/integrations/website/prototype-signed-read/[token]/route.ts` shipped, matching ADR-024 D1-D7 + cross-repo §6 byte-for-byte on response shape, error codes, cache headers, rate-limit posture, HMAC empty-body signing.
- [ ] `getPrototypeWorkspaceByShareToken` helper added to `lib/server/prototypes/repository.ts` with JSDoc explaining service-role intentional bypass.
- [ ] Inline sanitization positive allowlist in place; no `{ ...row }` spreads; canary `logger.warn` for unknown fields wired.
- [ ] Integration tests at `tests/server/api/integrations/website/prototype-signed-read.test.ts` covering all 14 AC.
- [ ] `pnpm lint`, `pnpm typecheck`, full test suite green; no regression in sibling tests.
- [ ] Documentation touches all in the same PR:
  - [ ] `docs/integrations/cross-repo-webhook-v1.md` §6 status banner flipped to "shipped" with PR ref.
  - [ ] `docs/api-auth-matrix.md` row appended.
  - [ ] `docs/context/project.context.core.md` line 459 reframed "future" → "implemented" (no plan-refs).
  - [ ] `docs/context/project.context.full.md` surface inventory updated (if section exists).
  - [ ] Roadmap `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §16 row 9 (G22) flipped RESOLVED post-merge.
  - [ ] Close-out handoff written at `docs/handoffs/2026-05-26-g22-prototype-signed-read-handler-closure.md` (or equivalent).
- [ ] OQ-1 (column mapping) resolved explicitly in the PR description.
- [ ] OQ-2 and OQ-3 (operational choices) resolved during Backend; recorded inline in code or in the close-out handoff.
- [ ] Security skill review confirms: HMAC GET surface acceptable, sanitization egress allowlist holds, cache-header composition acceptable per R-5 documentation, no new RLS surface introduced.
- [ ] PR opened with title referencing this spec + ADR-024. Per memory `feedback_no_auto_merge_prs`: do NOT auto-merge; operator merges.
- [ ] `system-validator` returns COMPLETE.
- [ ] Spec lifecycle: Draft → Approved → Implemented on Validator COMPLETE.

---

## Chunking decision

**Single iteration, single chunk. No sub-chunks. LITE depth.**

**Reasoning:**
1. Contracts firmed completely in ADR-024 D1-D7; no architectural negotiation remains.
2. Single-file deliverable (handler `route.ts`) + one repository helper + one test file + minor docs touches. ~5-6 files of net change.
3. Sibling pattern from PR #110 is directly mirror-able; the handler iteration is a translation, not a design exercise.
4. No cross-module impact beyond reading existing columns; no data flow change.

**Re-cut triggers (per router escalation §6):**
- **E-1 sanitization scope expansion >2h** → pause Backend, open sibling `fase-3-sanitization-shared-helper`, resume after.
- **RLS touches required for `share_token` lookup** → pause Backend, re-enter Architecture for RLS review.
- **HMAC verifier amendment needed for GET** → ruled out by A-1 verification 2026-05-26 (verifier is body-parameterized). Not anticipated.
- ~~OQ-1 unresolvable in 30 minutes → pause Backend~~ — **OBSOLETE 2026-05-26** (OQ-1 RESOLVED via ADR-024 §Amendments A1; mapping locked before Backend starts).

If any trigger fires, this spec is updated with a dated note and the iteration scope re-cut.

---

## Success criterion

**A signed GET from NoonWeb's server to `/api/integrations/website/prototype-signed-read/[token]` with a valid token + valid HMAC envelope returns the firmed ADR-024 D3 13-field closed payload (with `decision.status` reflecting persistence state pending / accepted / rejected) + `Cache-Control: private, max-age=30, stale-while-revalidate=60` headers; a token superseded by regenerate returns `410 PROTOTYPE_READ_TOKEN_SUPERSEDED` with `no-store`; a deleted parent lead returns `410 PROTOTYPE_READ_LEAD_DELETED`; an unknown token returns `404 PROTOTYPE_READ_TOKEN_NOT_FOUND`; an invalid HMAC returns `401 WEBSITE_WEBHOOK_AUTH_FAILED`; a budget-exhausted request returns `429`; and the response body never contains any operator-internal field outside the 13-field allowlist — all observable end-to-end against a mocked Supabase client at the integration-test level and ready for live smoke A in a follow-up iteration.**

---

## Lifecycle

- **Status:** Draft — 2026-05-26 (analysis output; pending operator Approval gate before Backend kickoff)
- **Definition of Ready check:** acceptance criteria testable ✅; scope bounded ✅; methodology decided ✅ (integration-first per prototype-decision precedent); dependencies classified ✅; risks rated ✅; architectural inputs locked ✅ (ADR-024 D1-D7 + A1); landmines empirically verified ✅ (HMAC verifier body-parameterized, share_token columns present, repository helper missing → flagged in scope, leads schema mismatch → RESOLVED 2026-05-26 via ADR-024 §Amendments A1). **All blockers cleared.** Spec is **READY for Backend** without further operator gate.
- **Supersedes:** nothing.
- **Superseded by:** nothing.
- **Amended by:** ADR-024 §Amendments A1 (2026-05-26) — OQ-1 resolution; lead-context source column mapping locked.
- **Related specs:**
  - `specs/fase-3-g22-signed-read-spec.md` (predecessor — contract-firming iteration that produced ADR-024; **NOT** superseded, this spec extends).
  - `specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md` (sibling — write-side handler; shipped PR #110; structural mirror for this read-side handler).
  - `specs/fase-3-prototipo-decision-cross-repo-contract.md` (write-side contract iteration; produced ADR-023).
- **Related ADRs:**
  - **ADR-024** (D1-D7 immutable inputs).
  - ADR-023 (D3 token invalidation inherited via ADR-024; D8 discharged by ADR-024; D7 iteration-cap context).
  - ADR-010 (App is operator-only; signed-read is server-to-server).
  - ADR-013 (seller-fee strip invariant; reaffirmed in sanitization strip-list).
  - ADR-016 (transport ledger — declined by design for reads per ADR-024 D1).
- **Related handoffs:**
  - **`docs/handoffs/2026-05-26-g22-handler-router-decision.md`** (Tier-0 input; router decision).
  - `docs/handoffs/2026-05-25-maxwell-chat-cross-repo-contracts-noonweb-handoff.md` (NoonWeb-dev sign-off solicitation for ADR-024 + ADR-023 contracts; the contract foundation this iteration ships against).
  - `docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs` (sibling smoke script; reference for future smoke A G22, **NOT in scope** this iteration).
- **Open issues at Approval gate:**
  - OQ-1 — column mapping for `businessName` + `projectTypeLabel`. Recommendation in place; operator may pre-resolve OR Backend resolves with 30-min escalation rule.
  - OQ-2 — `getClientIp` inline vs export. Backend operational choice; recommendation: export.
  - OQ-3 — test surface for rate-limit AC-12. Backend operational choice; recommendation: handler-helper extraction pattern.

**Landmines verified empirically by Analysis 2026-05-26 (router decision §8):**

- **Landmine #1 (HMAC GET body):** RESOLVED. `verifyWebsiteWebhookSignature` is parameterized on `bodyText`; GET passes `''`. No ADR-024 amendment needed. Cross-repo doc §2.1 already documents the empty-body convention.
- **Landmine #2 (repository helper missing):** CONFIRMED. `getPrototypeWorkspaceByShareToken` does not exist. New helper proposed in Scope-in §"Repository helper" with explicit shape, RLS posture, and error-handling notes. Backend implements; no RLS policy change needed.
- **Landmine #3 (column shape):** PARTIAL. `share_token text not null unique` + `share_token_superseded_at timestamptz null` confirmed present in `database.types.ts` rows 1199-1200, 1217-1218, 1235-1236, 2385-2386. CSPRNG entropy (~122 bits via `gen_random_uuid()::text`) accepted per A-6.
- **Landmine #4 (cache + rate-limit composition):** DOCUMENTED as R-5 (acceptable by design per ADR-024 D6/D7 composition).
- **Landmine #5 (smoke A scope):** RESPECTED — explicit scope-out item.
- **Landmine #6 (develop is PR-only):** RESPECTED — all docs touches bundle in the same PR per memory.
- **NEW landmine surfaced (not in router decision):** `leads.business_name` / `leads.project_type` columns DO NOT EXIST in the live schema. Opened as OQ-1. **RESOLVED 2026-05-26 via ADR-024 §Amendments A1** (Option A — amend ADR to reflect schema). Mapping locked: `businessName ← leads.company ?? leads.name`; `projectTypeLabel ← humanizeLabel(leads.maxwell_snapshot ->> 'project_type' ?? 'Sitio Web')`. Cost: ~30min docs amendment; no NoonWeb-dev re-coordination required (§6 was already pending acknowledgment).

Status changes recorded inline as dated notes when transitioned. Spec is not edited after Implemented; follow-up iterations (smoke A G22, NoonWeb D-slice render) create new spec files and reference this one.
