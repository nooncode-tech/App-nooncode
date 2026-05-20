# spec.md — fase-2-d-g7-types-regen-override-retirement

## template-session-start

### SESSION METADATA
- Date: 2026-05-20
- Session ID: `fase-2-d-g7-types-regen-override-retirement`
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec). Downstream chain per router: system-refactor → system-testing → system-validator (with system-docs piggybacked on the closure step). Skipped per router: system-architecture (no contract design — the schema is authoritative and regen lands what it lands), system-audit (repo state is fully understood post-B26-R5 merge), system-frontend (no UI), system-security (no new auth/permission/secret surface — types-only mechanical refactor), system-infra (no env, no migration, no deploy gate beyond CI).
- Router mode: Refactor.
- Depth: **FULL**. Justified because (a) the prior G7 regen (commit `210feca`) shipped successfully but the router cites "partial-regen failure" risk that warrants explicit dependency mapping; (b) the consumer surface for the seller-fees casts touches business-critical paths (Stripe webhook activation, seller fee state machine); (c) FULL depth ensures the spec captures the full re-typecheck blast radius rather than a LITE one-line scope.

### OBJECTIVE
- Regenerate `lib/server/supabase/database.types.ts` from the remote project `pdotsdahsrnnsoroxbfe` to land the `list_schema_migrations` RPC entry (added by migration `0052` on 2026-05-20) and to retire the residual manual override marker block. Remove the four `as unknown as SellerFeeRow` / `(client as any).from('seller_fees')` casts in `lib/server/seller-fees/repository.ts` lines 31, 77, 93, 111, 132, 170 that have been unnecessary since commit `210feca` (the `seller_fees` table block has been canonical in `database.types.ts` lines 1256-1354 since 2026-05-17). Close the G7 active risk recorded in `docs/context/project.context.core.md` ~line 304 (the "G7 follow-up: clean regen + reconcile 4 override blocks" wording).
- Motivating evidence: a fresh CLI regen against `pdotsdahsrnnsoroxbfe` (executed 2026-05-20 18:26 ART, in-skill, with `SUPABASE_ACCESS_TOKEN=<REDACTED>`) produced a 2880-line output. Normalized diff against the current 2876-line `database.types.ts` shows only TWO real deltas: (i) three comment lines at lines 1940-1942 (`// MANUAL OVERRIDE #4 (B15 / ADR-016 D10) — added 2026-05-20.` and two follow-up comments) absent from regen; (ii) a new `list_schema_migrations` entry under `Database['public']['Functions']` at line ~2304 of the regen output, currently absent from the local file because `database.types.ts` has not been regenerated since migration `0052` landed (commit `0a59b4d`). No table schema changes, no enum changes, no other RPC changes — the regen surface is one comment block to drop + one function entry to add.
- Output: a regen-clean `database.types.ts`, six fewer casts in `seller-fees/repository.ts`, `lib/server/seller-fees/types.ts` simplification (the comment block citing "kept manual until the next regeneration" becomes stale and the `SellerFeeRow` interface can either be kept as a documentation alias or replaced by `Database['public']['Tables']['seller_fees']['Row']` directly — refactor decides), and `docs/context/project.context.core.md` G7 risk entry closed.

### CONTEXT USED
- `project.context.core.md`: yes — confirmed the G7 active risk entry at ~line 304 (the schema↔ledger desync paragraph that ends "Priority of `fase-0-b4b-ledger-reconciliation` iteration bumped from 'no fixed date' to 'scheduled before next code-level migration push to remote.'"). The router's claim that this entry "explicitly ties" the seller-fees casts to G7 is interpreted as the **manual override surface tracked since ADR-014 §Deferred follow-ups** — closing the casts closes the operational debt mentioned there.
- `project.context.full.md`: not loaded — the change is mechanical (CLI regen + cast removal) and architecture-free. Refactor may load it if the cast removal surfaces unexpected consumers.
- `project.context.history.md`: not loaded — the relevant history (commit `210feca` G7 regen on 2026-05-17; commit `0a59b4d` migration 0052 on 2026-05-20) is captured in this spec's §Context.
- Reason `full` was excluded: redundant for a types-regen refactor with bounded consumer surface (the casts are localized to one file and one types module).
- Reason `history` was excluded: the two material prior events are referenced verbatim.

### ROUTER DECISION
- Mode: Refactor.
- Depth: FULL. Justified above and reinforced by: the consumer surface is small but business-critical (Stripe payment activation reads seller_fees), and the regen carries no schema-level surprises (pre-confirmed empirically in §Precondition gate below).
- Chain: router (closed) → analysis (now) → refactor → testing → docs → validator.
- Why analysis is the active skill now: nothing downstream can start until (a) the precondition gate result is known (MCP unavailable in current toolset; CLI fallback empirically green); (b) the actual delta between regen and current file is bounded (one comment block + one function entry — vastly smaller than the router's "4 override blocks" framing, which reflected historical state already absorbed by `210feca`); (c) the consumer surface for the cast retirement is enumerated; (d) the success criterion is observable (`npm run typecheck` green, `npm test` 355/355, zero `// MANUAL OVERRIDE` markers remain, zero `as unknown as SellerFeeRow` casts remain in `lib/server/seller-fees/`).
- Reroute already known at start: no. The chain is single-PR, sequential, no chunking. Escalation paths are documented in Risks (R1 — unexpected consumer breakage from cast removal; R2 — regen surfaces unanticipated drift).

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules" below.
- Contracts or architecture inputs available:
  - `lib/server/supabase/database.types.ts` lines 1940-1942 — the only remaining explicit `// MANUAL OVERRIDE` marker block (override #4 from B15/ADR-016 D10). Three comment lines, no code.
  - `lib/server/supabase/database.types.ts` lines 1943-1999 — the `website_webhook_events` table block. **The table block itself is canonical in regen output** (verified); only the three comment lines above it are local-only. Regen drops the comment lines.
  - `lib/server/supabase/database.types.ts` lines 1256-1354 — the `seller_fees` table block. Canonical in both local and regen. The casts in `lib/server/seller-fees/repository.ts` are unnecessary because this block has existed since commit `210feca` (2026-05-17).
  - `lib/server/supabase/database.types.ts` lines 244-356 — `lead_proposals` table block including `complexity` (line 249) and `project_type` (line 261). Canonical in both local and regen. The prior override block was absorbed by `210feca`.
  - `lib/server/supabase/database.types.ts` lines 1111-1183 — `prototype_workspaces` table block including `demo_url` (line 1116) and `chat_url` (line 1113). Canonical in both local and regen. Prior override absorbed by `210feca`.
  - `lib/server/supabase/database.types.ts` lines 2474-2488 — `lead_activity_type` enum with all 14 values including the 5 `seller_fee_*` ones. Aligned with `lib/types.ts` line 181-191. **No drift remains here** — the `UpdateFeedEventType` alignment cited by the router was already absorbed by `210feca`.
  - `lib/types.ts` lines 181-191 — `LeadActivityType` union with all 14 values. Aligned with the enum above. `UpdateFeedEventType` (line 367) is `LeadActivityType | TaskActivityType | ProjectActivityType` and inherits the alignment automatically.
  - `lib/server/seller-fees/repository.ts` lines 31, 77, 93, 111, 132, 170 — the six casts to retire. Line 31 is `(client as any).from('seller_fees')`; lines 77, 93, 111, 132, 170 are `as unknown as SellerFeeRow` (or `| null` variant).
  - `lib/server/seller-fees/types.ts` lines 1-4, 19-38 — `SellerFeeRow` hand-written interface. Refactor decides whether to (a) keep it as a doc-only alias matching the generated `Database['public']['Tables']['seller_fees']['Row']`, (b) replace usages with the generated type directly and delete the interface, or (c) leave it and just drop the obsolete comment block. Analysis recommends (a) for migration-trace continuity but does not bind.
  - `lib/server/migrations/ledger-adapter.ts` lines 48-53 — `SchemaMigrationsRow` inline interface added by B26-R5. **Per ADR-017 §D4 + ADR-018 §D5 this stays inline as the "5th override would have been"** — the router prompt confirms this is intentional. Out of scope for cast retirement.
  - `tests/server/seller-fees/repository.test.ts` — uses a custom `makeMockClient` test-double (lines 17-40); does not depend on the override-block shape. Cast retirement should not break the tests, but `npm test` 355/355 baseline must be preserved.
- Relevant handoffs received from router:
  - 8 explicit validator gates — mirrored in §Definition of Done.
  - 3 explicit escalation triggers — mirrored in §Re-route triggers.
  - 3-step precondition gate (MCP → CLI → BLOCKED) — empirically resolved in §Precondition Gate Result.
  - Constraint: regen must come from `pdotsdahsrnnsoroxbfe`; manual edits to the generated file are forbidden if both precondition paths fail.
- External dependencies or environment assumptions:
  - The Supabase access token `<SUPABASE_ACCESS_TOKEN_REDACTED — read from .mcp.json at runtime, never commit>` is valid and present in `.mcp.json` (file is gitignored). Refactor must NOT commit the token; it lives in env vars at command time only.
  - The remote project `pdotsdahsrnnsoroxbfe` has the post-`0052` schema (with `public.list_schema_migrations()`). Confirmed empirically — the regen output includes the entry.
  - The `npx supabase` CLI v2.100.1 is installed (`npx supabase --version` → `2.100.1`). Confirmed empirically.
  - The current ledger has 54 rows and the disk has 56 migration files post-`0052`. Confirmed indirectly via the B26-R5 spec's smoke target.

### RISK SNAPSHOT
- Known risks before starting: see "## Risks" below (R1-R5).
- Known blockers before starting: none. Precondition gate satisfied via CLI fallback.
- Known assumptions before starting:
  - The regen output is byte-for-byte deterministic for the current remote schema state (any non-deterministic differences would surface as additional diff hunks; the empirical 2880 vs 2876 line count delta is fully explained by the 3 comment lines dropped + 7 function entry lines added).
  - Consumer files outside `lib/server/seller-fees/` do NOT depend on `SellerFeeRow` from `lib/server/seller-fees/types.ts` in a way that breaks if the interface stays as a documentation alias. Confirmed by `Grep "SellerFeeRow"` returning only repository.ts internal references.
  - The seller-fees test double (`makeMockClient` in `tests/server/seller-fees/repository.test.ts`) does not depend on the cast layer; it operates at the `data` field of the supabase-js response envelope, which the typed accessor still returns.
  - `npm test` 355/355 baseline holds across the regen + cast retirement (any regression points to a real type-level bug previously masked by `as any` / `as unknown as`).

### CONTINUITY NOTES
- Previous session relevant: commit `210feca` (chore(g7): regenerate database.types.ts + reconcile type drift, 2026-05-17). That commit absorbed the 3 historical override blocks (seller_fees, prototype_workspaces.demo_url+chat_url, lead_proposals.project_type+complexity) and aligned `LeadActivityType` with the post-0043 enum. The "G7 follow-up" entry in ADR-014 §Deferred follow-ups was already half-closed by that commit; this iteration closes the remainder (B15 override #4 marker + 0052 RPC entry + seller-fees casts).
- Subsequent session relevant: commit `0a59b4d` (R5 resolution via SECURITY DEFINER RPC, 2026-05-20). That added migration `0052` to remote (ledger row 54 of 54). The regen for this iteration was triggered by that migration landing.
- Expected next skill after this session: system-refactor with the regen-output ready to write, the cast-retirement diff localized to `lib/server/seller-fees/repository.ts` + (optionally) `types.ts`, and the doc-context update text for `project.context.core.md` G7 risk closure.

---

## Task Summary

Regenerate `lib/server/supabase/database.types.ts` from the remote schema of project `pdotsdahsrnnsoroxbfe` via `npx supabase gen types typescript --project-id pdotsdahsrnnsoroxbfe` (the precondition gate's CLI fallback path; MCP tool is not available in the current toolset). The regen lands two changes: (i) drops the three `// MANUAL OVERRIDE #4` comment lines at current file lines 1940-1942, (ii) adds a `list_schema_migrations` entry under `Database['public']['Functions']` at line ~2304 of the regen, post-`list_open_prototype_workspaces_by_lead` and pre-`log_lead_activity`. All other table, enum, and function definitions are byte-identical between current and regen.

Retire the six unnecessary casts in `lib/server/seller-fees/repository.ts`:
- Line 31: `(client as any).from('seller_fees')` → `client.from('seller_fees')` (the regenerated `Database` types now know the table).
- Lines 77, 170: `data as unknown as SellerFeeRow` → `data` (or typed via the generated `Row` shape).
- Lines 93, 111, 132: `(data ?? null) as unknown as SellerFeeRow | null` → `data ?? null`.

Decide the fate of `SellerFeeRow` in `lib/server/seller-fees/types.ts`: refactor's call between (a) keep as documentation alias, (b) replace with `Database['public']['Tables']['seller_fees']['Row']`, or (c) leave + drop stale comment.

Close the G7 active risk in `docs/context/project.context.core.md` by updating the existing entry (no R-codes, no Sprint IDs per MEMORY rule). The remaining sub-bullet ("manual override surface" / "kept manual until the next regeneration of database.types.ts") is removed; the rest of the schema↔ledger desync paragraph stays as-is.

**Externally:** no behavioral change. The endpoint surface, the seller-fees state machine, the Stripe webhook activation path — all observably identical. The only external change is `npm run typecheck` and `npm test` continue to be green (proving the casts were genuinely unnecessary).

**Internally:** the manual-override surface goes from one marked block + six implicit casts to zero. Future seller-fees consumers can use `Database['public']['Tables']['seller_fees']['Row']` directly.

---

## Scope Boundary

### Included

- **Types regeneration** `lib/server/supabase/database.types.ts`:
  - Replace the file content with the output of `npx supabase gen types typescript --project-id pdotsdahsrnnsoroxbfe` executed with `SUPABASE_ACCESS_TOKEN` set.
  - Result: 2880 lines (up from 2876). The deltas are exactly: (i) three comment lines removed at current lines 1940-1942; (ii) seven lines added for the `list_schema_migrations` function entry around line 2304 of the new file.
  - Verify with a normalized diff (CRLF/LF) that no other changes appear. If any other diff hunk surfaces, refactor must triage before committing (likely a contract change from another team that needs coordination — escalation trigger R2).
  - Preserve the existing top-of-file comment ("Allows to automatically instantiate createClient with right options...") which is part of the regen template and is identical in both versions.

- **Cast retirement** `lib/server/seller-fees/repository.ts`:
  - Line 22-32 (the `sellerFeesTable` helper with `(client as any)` cast): replace with direct typed calls. Either delete the helper and call `client.from('seller_fees')` inline, or keep the helper but type it as `DatabaseClient` returning the typed builder.
  - Line 77: `return data as unknown as SellerFeeRow` → `return data` (with optional `satisfies SellerFeeRow` if the alias is preserved).
  - Line 93: `return (data ?? null) as unknown as SellerFeeRow | null` → `return data ?? null`.
  - Line 111: same as line 93.
  - Line 132: same as line 93.
  - Line 170: same as line 77.
  - The `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments on lines 28 and 30 are removed when the `(client as any)` cast goes away.
  - The 2026-05-11-dated comment block at lines 1-10 and 22-27 (explaining the cast workaround) is rewritten or deleted to reflect the closed state.

- **`SellerFeeRow` interface decision** `lib/server/seller-fees/types.ts`:
  - Refactor chooses one of three paths:
    - **(a) Keep as documentation alias.** Replace the body with `export type SellerFeeRow = Database['public']['Tables']['seller_fees']['Row']`. The alias serves as a single import point and preserves call-site readability. **Analysis recommends (a).**
    - **(b) Delete and replace usages.** Update all imports of `SellerFeeRow` in `repository.ts`, `service.ts`, `activity.ts`, and tests to use `Database['public']['Tables']['seller_fees']['Row']` directly. More verbose at call sites; fewer types to maintain.
    - **(c) Leave the hand-written interface, drop the stale comment.** Lowest-touch but creates ongoing risk that the interface drifts from the generated `Row` shape if a future migration adds a column. **Analysis does not recommend (c).**
  - The 2026-05-11 file header comment ("Manual types for the seller_fees entity introduced in migrations 0043_phase_18a_seller_fees.sql and 0044_phase_18b_seller_fees_rls.sql. ... kept manual until the next regeneration of database.types.ts.") becomes stale regardless of path chosen; refactor rewrites it.

- **Doc context closure** `docs/context/project.context.core.md`:
  - The Active risks paragraph at ~line 304 (the schema↔ledger desync) is preserved AS-IS for the ledger desync portion. The G7-derived sub-finding about "manual override blocks pending future regen" is removed if it exists as a separate bullet, OR the existing wording is updated to reflect "zero override blocks remain; cast retirement closed".
  - **No B-codes, R-codes, Sprint IDs, plan-IDs per MEMORY rule.** The closure entry reads in plain operational terms: "G7 follow-up closed (2026-05-20): `database.types.ts` regenerated from remote; zero manual override blocks remain; `lib/server/seller-fees/repository.ts` casts retired; future column-additive migrations may be absorbed via single-command regen."
  - `docs/context/project.context.history.md` is appended (one paragraph) describing the regen + cast retirement.

- **Baseline preservation:**
  - `npm run typecheck` exit 0.
  - `npm test` exits with 355/355 pass (no regression from the B15 baseline preserved through B26 and B26-R5).
  - No new lint errors. The `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments removed from `repository.ts` go away cleanly.

### Excluded

- **No schema migration.** Migration `0052` is already applied (commit `0a59b4d`). No new SQL file in `supabase/migrations/`.
- **No RPC contract redesign.** The regen ADDS `list_schema_migrations` to the typed surface; it does not change the RPC's behavior or wire shape. The B26-R5 adapter (`lib/server/migrations/ledger-adapter.ts` line 143) currently uses `'list_schema_migrations' as never` as the RPC name cast — refactor MAY drop the `as never` after regen (since the function is now in the typed `Database['public']['Functions']` index), but this is OPTIONAL and explicitly out of scope for the success criteria. The escalation trigger R3 covers the case where refactor wants to do this; the recommendation is to leave it for a follow-up iteration to keep this PR's scope tight.
- **No `lib/server/migrations/ledger-adapter.ts` change.** Per ADR-017 §D4 + ADR-018 §D5, `SchemaMigrationsRow` stays inline as the "what would have been the 5th override block" — explicitly tracked as a kept convention, not a debt. Refactor MUST NOT touch this file. If refactor sees an opportunity to simplify the `(await client.rpc(... as never)) as { data, error }` cast in lines 143-146, that is a separate iteration.
- **No NoonWeb-side change.** No cross-repo coupling exists for `database.types.ts` (it is App-internal).
- **No new env var.** No new secret. The CLI regen uses an existing access token already documented in `.mcp.json` (gitignored).
- **No behavioral change** for any seller-fees consumer. The cast retirement is type-level only. The Stripe webhook activation path, the seller fee state machine, the lead activity timeline — all observably identical pre/post.
- **No response shape change** for any endpoint. No public API surface affected.
- **No test fixture flip.** The existing `tests/server/seller-fees/*.test.ts` mocks operate at the supabase-js response envelope level (the `data` field), not at the cast layer. Tests pass without modification. If a test fails, that signals the cast was masking a real type-level bug — escalation trigger R1.
- **No retirement of the B26-R5 inline `SchemaMigrationsRow`** in `lib/server/migrations/ledger-adapter.ts`. See above.
- **No regen of `lib/types.ts` `LeadActivityType` union.** It already includes all 14 values aligned with the enum (verified at lines 181-191). No change needed.
- **No regen of `lib/types.ts` `UpdateFeedEventType`.** It is `LeadActivityType | TaskActivityType | ProjectActivityType` (line 367) and inherits the alignment automatically. No change needed.
- **No `payment_activation` type reconciliation.** The router's gate #4 ("Payment activation type annotation reconciled (`string | null` instead of `string | undefined`)") cannot be reconciled without a concrete source-of-truth file showing the drift. A grep for `payment_activation` returns zero matches in `lib/server/`; the file the router likely meant is `lib/server/payments/activation.ts` which uses `string | null | undefined` coercion (lines 39, 41, 43) via `?? undefined` patterns. **No drift exists today** — the regen does NOT change `activate_paid_proposal`'s arg or return types (confirmed via normalized diff). The gate is interpreted as "verify post-regen that `lib/server/payments/activation.ts` still typechecks", which becomes part of the `npm run typecheck` validator gate. **No code change in `lib/server/payments/activation.ts`.**
- **No `UpdateFeedEventType` reconciliation as a separate task.** Gate #3 from the router ("`UpdateFeedEventType` union aligned with `lead_activity_type` enum") was already satisfied by commit `210feca`. The gate is interpreted as "verify post-regen alignment holds", which is implicit in `npm run typecheck` passing.
- **No B-code, R-code, Sprint ID, or plan-ID references in `docs/context/*.md`** per MEMORY rule.
- **No chunking.** Single PR, single iteration.

---

## Precondition Gate Result

### Step 1 — MCP tool path
- Tool name from router prompt: `mcp__plugin_supabase_supabase__generate_typescript_types`.
- Verification via `ToolSearch` queries `+supabase`, `+plugin_supabase`, `+supabase +mcp generate types`, `+typescript generate types`: **all returned "No matching deferred tools found"**.
- **Result: MCP path UNAVAILABLE in current toolset.** Either the MCP server is not registered in this session, or the toolset has been pruned. Falling through to step 2 per router §7.

### Step 2 — CLI fallback path
- Command: `SUPABASE_ACCESS_TOKEN=<SUPABASE_ACCESS_TOKEN_REDACTED — read from .mcp.json at runtime, never commit> npx supabase gen types typescript --project-id pdotsdahsrnnsoroxbfe`.
- CLI version: `2.100.1` (verified via `npx supabase --version`).
- Execution: returned a clean 2880-line TypeScript output. No errors. No prompts. Token authenticated successfully.
- Output captured to `/tmp/regen.ts` for diff inspection.
- Normalized diff against the current file (after CRLF→LF normalization): **EXACTLY TWO HUNKS, both expected**:
  - Hunk 1 (lines 1937-1942 of current → 1937-1939 of regen): three comment lines `// MANUAL OVERRIDE #4 (B15 / ADR-016 D10) — added 2026-05-20.` / `// Reason: Supabase MCP types regen unavailable this session.` / `// Queue "clean regen + reconcile 4 override blocks" follow-up when MCP/CLI auth refreshes.` are REMOVED.
  - Hunk 2 (lines 2301 of current → 2304-2310 of regen): seven lines ADDED for the new `list_schema_migrations` function entry:
    ```ts
    list_schema_migrations: {
      Args: never
      Returns: {
        name: string
        version: string
      }[]
    }
    ```
- **Result: CLI fallback GREEN. Iteration is unblocked.**

### Step 3 — BLOCKED outcome
- Not reached. CLI fallback succeeded.

### Refactor handoff for the regen step
- Refactor MUST re-run the same command at implementation time (the schema state may have evolved between spec write and implementation, though no concurrent migration is anticipated for this session).
- Refactor MUST normalize line endings to match the existing project convention (the file is LF-terminated in git; if the CLI emits CRLF on Windows, refactor pipes through `dos2unix` or saves as UTF-8 LF).
- Refactor MUST verify the diff hunks are exactly the two listed above before committing. Any additional hunk is an escalation trigger (R2).

---

## Inventory of Override Blocks (the 4 to retire)

**Per empirical verification on 2026-05-20, only ONE override marker remains in the file.** The router's "4 manual override blocks" framing reflects the historical state before commit `210feca` (2026-05-17) which absorbed three of them. The current state is:

| # | Citation | Lines | Added by | Overrides | Post-regen shape |
|---|---|---|---|---|---|
| 1 | Historical (seller_fees) — **already absorbed by 210feca** | N/A (canonical at lines 1256-1354) | B3 / migration 0043 (2026-05-11) | `seller_fees` table | Canonical block exists at lines 1256-1354 of current file; identical in regen. No change. |
| 2 | Historical (prototype_workspaces.demo_url + chat_url) — **already absorbed by 210feca** | N/A (canonical at lines 1111-1183) | F-V06 / migration 0046 (2026-05-17) | `demo_url`, `chat_url` columns | Canonical columns exist at lines 1113, 1116 of current file; identical in regen. No change. |
| 3 | Historical (lead_proposals.project_type + complexity) — **already absorbed by 210feca** | N/A (canonical at lines 244-356) | migration 0047 (2026-05-17) | `complexity`, `project_type` columns | Canonical columns exist at lines 249, 261 of current file; identical in regen. No change. |
| 4 | **`MANUAL OVERRIDE #4`** | lines 1940-1942 (three comment lines only; the table block at 1943-1999 is canonical) | B15 / ADR-016 D10 (2026-05-20, commit `ffcaa43`) | `website_webhook_events` table | The table block itself is byte-identical to regen. Only the three comment lines are local-only and are removed by regen. The canonical block at regen lines 1937-1996 (post-removal) matches the existing local block at lines 1943-1999. |

**Conclusion:** the iteration retires ONE explicit override marker block (3 comment lines at file lines 1940-1942). The other three "override blocks" cited in the router prompt are historical and were already absorbed by the prior G7 regen. Post-this-iteration, the file contains ZERO `// MANUAL OVERRIDE` markers.

---

## Inventory of Drift Fixes (2)

**Per empirical verification on 2026-05-20, the two drift surfaces the router cites are ALREADY ALIGNED in the current file.** The "drift fixes" become "drift verifications" — `npm run typecheck` post-regen confirms no regression. Specifically:

### Drift #1 — `UpdateFeedEventType` union vs `lead_activity_type` enum
- **Current state:** ALIGNED.
- `lib/types.ts` line 181: `LeadActivityType` = 14-value union including all 5 `seller_fee_*` values.
- `lib/types.ts` line 367: `UpdateFeedEventType = LeadActivityType | TaskActivityType | ProjectActivityType` inherits the alignment automatically.
- `lib/server/supabase/database.types.ts` lines 2474-2488: `lead_activity_type` enum with all 14 values.
- `lib/server/supabase/database.types.ts` lines 2731-2746: enum array with all 14 values.
- **Action:** none. `npm run typecheck` post-regen confirms alignment holds.

### Drift #2 — `payment_activation` `string | null` vs `string | undefined`
- **Current state:** NO DRIFT IN GENERATED TYPES. The router's framing likely refers to the historical coercion in `lib/server/payments/activation.ts` lines 39, 41, 43 where caller-side `?? undefined` patterns absorb `null` inputs because the RPC arg types in the generated file are `string | undefined` (optional). The regen does NOT change these arg types — `activate_paid_proposal` is byte-identical in current and regen.
- `lib/server/payments/activation.ts` lines 39, 41, 43: `input.providerPaymentIntentId ?? undefined`, `input.actorProfileId ?? undefined`, `input.projectDescription ?? undefined`. These are intentional coercions, not drift.
- **Action:** none. `npm run typecheck` post-regen confirms the activation.ts pattern still typechecks. **The router's gate #4 is interpreted as "no regression in payment-activation typing", satisfied by the typecheck green.**

**Conclusion:** the iteration verifies two drift surfaces are aligned (negative result — no drift exists). No code change required in `lib/types.ts`, no code change required in `lib/server/payments/activation.ts`.

---

## Consumer Surface Inventory

Files that import from `lib/server/supabase/database.types.ts` or depend on the seller-fees casts, listed for re-typecheck risk register. **This is a risk register, not a literal must-fix list.** `npm run typecheck` exercises all of them; any new error post-regen points refactor at the specific file.

### Direct consumers of regenerated types
- `lib/server/seller-fees/types.ts` — imports `Database`. Consumes `Database['public']['Tables']['lead_activities']['Insert']` at line 67. Low risk (the type is unchanged in regen).
- `lib/server/seller-fees/repository.ts` — imports `Database`. The cast retirement is concentrated here.
- `lib/server/seller-fees/service.ts` — imports types module. Consumes `SellerFeeRow` (alias). Low risk if alias is preserved (path a); medium risk if alias is replaced (path b) because call sites need to update.
- `lib/server/seller-fees/activity.ts` — uses `lead_activity_type` enum values; consumes the canonical enum. Low risk.
- `lib/server/migrations/ledger-adapter.ts` — imports `SupabaseClient` from `@supabase/supabase-js`, not `Database`. Uses `client.rpc('list_schema_migrations' as never)`. **The `as never` cast may now be droppable** post-regen, but explicitly out of scope for this iteration (R3 escalation if refactor tries).
- `lib/server/payments/activation.ts` — imports `Database`, `Json`. Consumes RPC arg types for `activate_paid_proposal`. Verified unchanged in regen.
- `lib/server/wallet/repository.ts` — imports `Database`. Uses a similar `as never` cast pattern for monetary wallet tables (per the comment at `lib/server/seller-fees/repository.ts:22-27`). **OUT OF SCOPE** — wallet casts are not part of this iteration; they may have their own follow-up.
- `lib/server/wallet/types.ts` — imports `Database`. Low risk.
- Any file under `lib/server/` that types a Supabase client builder as `SupabaseClient<Database>` — broad risk surface but generally absorbs the regen cleanly because table shapes are unchanged.

### Indirect consumers (UI / API routes that pass through `lib/types.ts`)
- `lib/types.ts` itself — does NOT import `database.types.ts` directly. The drift verification at the boundary (e.g., `LeadActivityType` union manually mirrored from the enum) is the only coupling. Verified aligned.
- `app/api/leads/route.ts` and any API route that types responses against `LeadActivityType` — low risk (no change in union).
- React components consuming `UpdateFeedEventType` (`components/`, `app/dashboard/`) — low risk (no change in union).

### Test files
- `tests/server/seller-fees/repository.test.ts` — operates on the supabase-js envelope `data` field, not the cast layer. Tests pass without modification (analysis pre-verified the structure at lines 17-40).
- `tests/server/seller-fees/service.test.ts`, `tests/server/seller-fees/activity.test.ts` — similar shape. Low risk.
- `tests/server/migrations/health.test.ts` — pure-function tests only (per B26-R5 spec). Untouched by this iteration.
- Other tests under `tests/server/` — low risk; they typically operate at the response envelope level.

### Total surface estimate
- **Files likely to need re-typecheck attention:** ~20-30. None require code changes BEYOND `lib/server/seller-fees/repository.ts` (and optionally `lib/server/seller-fees/types.ts` per path chosen).
- **Files at risk of breaking:** 0-2. The cast retirement only fails if a cast was hiding a real type bug, in which case the fix is local to that one site.
- **Escalation trigger threshold per router:** >10 files breaking → escalate to backend skill. Analysis assesses likelihood as LOW.

---

## Open Questions

These are bounded with default answers so refactor does not block waiting.

### Q1 — `SellerFeeRow` interface disposition in `lib/server/seller-fees/types.ts`
- **Options:** (a) keep as documentation alias mapped to `Database['public']['Tables']['seller_fees']['Row']`; (b) delete and replace all usages with the generated type directly; (c) leave the hand-written interface and just drop the stale comment.
- **Default (if refactor doesn't decide):** (a). Lowest-touch, preserves the import path readability, makes future regens safe (if the table schema evolves, the alias auto-updates).
- **Decision authority:** refactor.

### Q2 — `sellerFeesTable` helper disposition in `lib/server/seller-fees/repository.ts` (lines 22-32)
- **Options:** (a) delete the helper entirely; call `client.from('seller_fees')` inline at each call site; (b) keep the helper but type it properly (return `client.from('seller_fees')` with the typed return); (c) keep the helper as-is just without the `(client as any)` cast.
- **Default (if refactor doesn't decide):** (a). The helper exists only because the cast was needed. Once the cast is gone, the helper is a one-line wrapper with no value. Inline call sites are clearer.
- **Decision authority:** refactor.

### Q3 — Closure entry wording in `docs/context/project.context.core.md`
- **Options:** (a) append a new operating-rules entry stating G7 follow-up closed; (b) edit the existing schema↔ledger desync paragraph at ~line 304 to add a closure note; (c) both.
- **Default (if docs doesn't decide):** (a). Append a new entry of the form "Manual override surface in `database.types.ts` closed (2026-05-20): types regenerated from remote schema; `lib/server/seller-fees/` casts retired; no override markers remain. Future column-additive migrations are absorbed via the documented regen command." NO B-code, NO R-code, NO Sprint ID per MEMORY rule.
- **Decision authority:** docs / validator.

### Q4 — `lib/server/migrations/ledger-adapter.ts` line 143 `as never` cast retirement
- **Options:** (a) retire the `'list_schema_migrations' as never` cast and the surrounding `as { data, error }` cast post-regen (since the function is now typed in `Database['public']['Functions']`); (b) leave as-is, document as a follow-up.
- **Default (if refactor doesn't decide):** (b). Per ADR-017 §D4 + ADR-018 §D5, the inline cast pattern is the intentional convention. The `as never` cast was workaround-shaped; with proper typing the cast becomes a no-op, but the doc comments around it cite the convention. Touching it requires updating those comments and pulls in scope creep. Defer to a follow-up iteration. Analysis recommends explicitly leaving as-is and listing it as an excluded improvement.
- **Decision authority:** refactor. Strongly recommended to defer.

---

## Risks

| # | Risk | Probability | Impact | Severity | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R1 | **Cast was hiding a real type bug.** One of the six `as unknown as SellerFeeRow` casts in `repository.ts` was masking a genuine type mismatch (e.g., the `select(sellerFeeSelect)` string omits a required column, or the return shape differs from `SellerFeeRow`). Post-cast-retirement, `npm run typecheck` fails or `npm test` regresses. | Low | Medium (refactor must localize the fix; could expand scope if multiple bugs are unmasked) | Medium | Refactor runs `npm run typecheck` after each cast removal incrementally. If a failure surfaces, refactor decides whether to fix-in-iteration (LOW impact bug) or escalate to a separate iteration (HIGH impact bug). | Refactor / Validator |
| R2 | **Regen surfaces an unexpected diff hunk beyond the two anticipated.** A concurrent contract change from another team (e.g., a new migration landed since 2026-05-20 18:26 ART) introduces an additional change in the regen output. | Low (no concurrent migration anticipated in this session) | Low-Medium (the additional change is benign type drift; refactor reviews and decides whether to include it in this PR or split) | Low | Refactor diffs the regen against the current file before writing; any unexpected hunk is triaged. If trivially additive (new column on existing table), absorb. If shape-changing (new RPC, removed column), split into a separate iteration. | Refactor |
| R3 | **Refactor over-reaches into `ledger-adapter.ts` `as never` cast retirement.** The temptation to "clean up" the B26-R5 inline cast is real but explicitly out of scope. Doing so couples this iteration to ADR-017 §D4 + ADR-018 §D5 convention review. | Low-Medium (it is a tempting one-line change) | Medium (scope creep; may delay closure) | Medium | Spec explicitly excludes it in §Excluded. Refactor adheres. Validator gates on it. | Refactor / Validator |
| R4 | **Prior G7 regen ran on 2026-05-17 and the codebase was on commit `210feca`; today the codebase is on commit `0a59b4d` (B26-R5 merged). The intervening commits added the B15 `website_webhook_events` table (commit `ffcaa43`) and the B26 + B26-R5 work.** A naive re-run of the prior G7 procedure would re-introduce the historical override blocks. | Very Low (the regen against current remote schema is the canonical truth; it cannot re-introduce overrides that no longer exist) | Low | Low | Refactor uses the regen output directly; does NOT cherry-pick from the prior regen. The diff inspection step catches any deviation. | Refactor |
| R5 | **CLI access token expires or is rotated between spec write and refactor execution.** The token `<REDACTED>` in `.mcp.json` is valid as of 2026-05-20 18:26 ART. If refactor's session runs later and the token is rotated, the CLI fallback fails. | Very Low (no rotation event anticipated; token is the same one used by `.mcp.json` for general MCP server access) | High (BLOCKED outcome if both MCP and CLI fail) | Medium | Refactor re-verifies the precondition before regen. If the CLI fails, escalates to user for fresh token. No manual edits to `database.types.ts` per router §7. | Refactor / User |

---

## Acceptance Criteria

This iteration is **COMPLETE** when all 8 validator gates pass, made testable here with concrete commands. The gates mirror the router's §5 list.

1. **`database.types.ts` regenerated from remote (timestamp + diff evidence).**
   - Command: `SUPABASE_ACCESS_TOKEN=… npx supabase gen types typescript --project-id pdotsdahsrnnsoroxbfe > lib/server/supabase/database.types.ts` (with appropriate line-ending normalization).
   - Evidence: `git diff lib/server/supabase/database.types.ts` shows exactly two hunks (override comment removal + `list_schema_migrations` function entry addition).
   - Verification: line count 2880; `grep -c "MANUAL OVERRIDE" lib/server/supabase/database.types.ts` returns 0.

2. **Zero manual override blocks remain in the file.**
   - Command: `grep -nE "MANUAL OVERRIDE|MANUAL EDIT|hand-written|hand-edited" lib/server/supabase/database.types.ts`.
   - Evidence: zero matches.

3. **`UpdateFeedEventType` union aligned with `lead_activity_type` enum.**
   - Verification: `lib/types.ts` line 367 `UpdateFeedEventType` is `LeadActivityType | TaskActivityType | ProjectActivityType`. `lib/types.ts` lines 181-191 `LeadActivityType` has 14 values. `lib/server/supabase/database.types.ts` `lead_activity_type` enum has 14 values matching. **Pre-verified aligned; gate satisfied by `npm run typecheck` exit 0.**

4. **Payment activation type annotation reconciled.**
   - Verification: `lib/server/payments/activation.ts` typechecks against regen. **Pre-verified no drift; gate satisfied by `npm run typecheck` exit 0.**

5. **`npm run typecheck` green.**
   - Command: `npm run typecheck`.
   - Evidence: exit code 0; no `tsc` errors.

6. **`npm test` green (355/355 baseline maintained).**
   - Command: `npm test`.
   - Evidence: `tests 355 / pass 355 / fail 0`.

7. **`lib/server/seller-fees/` casts removed.**
   - Command: `grep -nE "as unknown as SellerFeeRow|as any\)\.from\('seller_fees'\)|client as any" lib/server/seller-fees/`.
   - Evidence: zero matches.

8. **`docs/context/project.context.core.md` updated.**
   - Evidence: a new operating-rules entry or an edited paragraph references G7 closure with NO B-codes, NO R-codes, NO Sprint IDs per MEMORY rule. The change is dated 2026-05-20 and describes the operational reality (zero override blocks, casts retired).

---

## Methodology Declaration

**Integration-first per router.** No new tests unless reconciliation introduces new code paths.

Justification:
- The existing 355-test suite covers all consumer paths (Stripe webhook, seller fee state machine, migration health endpoint, wallet operations).
- The cast retirement is a type-level refactor; runtime behavior is invariant.
- Writing new unit tests for the cast removal would test the TypeScript compiler, not the application.
- Validator gates #5 and #6 (typecheck + test) ARE the integration validation.
- TDD inappropriate — no new behavior.
- BDD inappropriate — no user-visible change.
- CDD inappropriate — no UI change.

If during refactor a test fails, the failure points at a real bug (R1) and the fix-or-escalate decision is taken by refactor with validator approval.

---

## Re-route Triggers

Lifted verbatim from router §6, with file-level concretion.

### Trigger 1 — RPC return shape changes
- **Router wording:** "RPC return shape changes → escalate to architecture".
- **Concrete trigger condition:** the regen output adds or modifies an entry under `Database['public']['Functions']` BEYOND the anticipated `list_schema_migrations` entry, AND the change affects an RPC currently consumed by application code (`activate_paid_proposal`, `consolidate_earnings_for_proposal`, `request_lead_prototype`, etc. — see the existing functions index in the file).
- **Action:** halt refactor. Escalate to system-architecture. Architecture decides whether the contract change is acceptable, requires consumer updates, or requires a coordination round with the team that landed the migration.
- **Files to inspect on trigger:** the regen diff hunk identifies the affected RPC; consumer search via `Grep "<rpc_name>"` in `lib/server/` enumerates the files needing update.

### Trigger 2 — Consumer breakage > 10 files OR touches business logic
- **Router wording:** "Consumer breakage > 10 files or touches business logic → bring in backend as distinct skill".
- **Concrete trigger condition:** `npm run typecheck` post-regen surfaces type errors in MORE THAN 10 files, OR surfaces errors in files outside `lib/server/seller-fees/` and `lib/server/payments/` (these two paths are pre-anticipated as the touchpoint).
- **Action:** halt refactor. Escalate to system-backend as a distinct skill. Backend decides whether the breakage is mechanical (rename, optional-marker, null-handling) or business-logic-shaped (in which case it returns to architecture).
- **Files to inspect on trigger:** the `tsc` output lists each failing file; backend prioritizes by domain (payments > seller-fees > wallet > rest).

### Trigger 3 — Drift cannot be reconciled without schema migration
- **Router wording:** "Drift cannot be reconciled without schema migration → BLOCKED, surface to user".
- **Concrete trigger condition:** the regen exposes a type mismatch between the local schema (file: `supabase/migrations/`) and the remote schema (project: `pdotsdahsrnnsoroxbfe`), AND the mismatch is not closable by code-level changes (e.g., a column exists in remote that has no migration file locally — recovery surface).
- **Action:** halt refactor. Mark iteration BLOCKED. Surface to user with the specific drift, the ADR-014 §Reconciliation playbook citation, and the recommended next iteration (`fase-0-b4b-ledger-reconciliation` or similar).
- **Files to inspect on trigger:** diff hunks identify the drifting object; cross-reference against `supabase/migrations/` listing.

### Implicit trigger 4 — Precondition gate fails at refactor time
- **Trigger condition:** the MCP path is still unavailable AND the CLI fallback fails at refactor execution time (token expired, network outage, project unreachable).
- **Action:** mark iteration BLOCKED. Surface to user for fresh token. NO manual edits to `database.types.ts` per router §7.

---

## Lifecycle Declaration

- **Status:** Draft (pending refactor execution).
- **Moves to Approved:** when refactor confirms the precondition gate at execution time (re-runs `npx supabase gen types …` and observes the same two-hunk diff) and the cast retirement plan is signed off (Q1, Q2 default-or-explicit).
- **Moves to Implemented:** when validator returns COMPLETE.
- **Closure:** this iteration **closes the G7 active risk** referenced in `docs/context/project.context.core.md` (the "manual override surface in `database.types.ts`" / "kept manual until the next regeneration" wording). The schema↔ledger desync portion of that paragraph is NOT closed by this iteration — it remains tracked for `fase-0-b4b-ledger-reconciliation`. Refactor / docs must scope the closure note precisely to the override surface, not to the desync.
- **Supersedes:** none. This iteration extends the prior G7 work of commit `210feca` (which absorbed 3 of the 4 historical override blocks); the residual override #4 + the cast retirement + the `list_schema_migrations` entry are net-new closure steps.
- **No superseding spec planned.**

---

## Handoff to system-refactor

System-refactor is the next active skill. Inputs already on disk (this spec). Required outputs from refactor before testing can validate:

1. **Regen executed** with the documented CLI command; output written to `lib/server/supabase/database.types.ts` with LF line endings.
2. **Diff verified** to contain exactly the two anticipated hunks; any deviation triggers R2 (escalate or absorb).
3. **Casts retired** in `lib/server/seller-fees/repository.ts` lines 31, 77, 93, 111, 132, 170; lint-disable comments at lines 28, 30 removed.
4. **`SellerFeeRow` decision signed** (Q1 default-or-explicit) in `lib/server/seller-fees/types.ts`.
5. **`sellerFeesTable` helper decision signed** (Q2 default-or-explicit) in `lib/server/seller-fees/repository.ts`.
6. **`npm run typecheck` green** post-changes.
7. **`npm test` green** post-changes (355/355).
8. **Context update text** drafted for `docs/context/project.context.core.md` (G7 closure entry, no B-codes/R-codes/Sprint IDs per MEMORY rule) — docs skill applies it.

When refactor is done: hand off to system-testing for validation evidence capture, then system-docs for context closure, then system-validator for final COMPLETE gate.

---

## Verdict

**READY-FOR-IMPLEMENTATION** (handoff to system-refactor).

- Precondition gate satisfied (CLI fallback empirically green; regen output captured; diff bounded to two anticipated hunks).
- Consumer surface bounded (~6 cast sites, all in one file; ~20-30 indirect consumers absorbed by `npm run typecheck`).
- Risks rated and mitigated.
- Methodology declared (integration-first via typecheck + test).
- Re-route triggers concretized with file-level conditions.
- Lifecycle declared (G7 active risk closure).

**Next handoff:** `system-refactor`.
