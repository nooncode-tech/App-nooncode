# spec.md — fase-3-b16-gdpr-art-15-17

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-21
- Session ID: fase-3-b16-gdpr-art-15-17
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-architecture → system-backend → (system-refactor conditional) → system-testing → system-security → system-docs → system-validator
- Router mode: New Build (docs/runbook character)
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope the implementation of two operator-run Node scripts plus a runbook that operationalise GDPR Art. 15 (Right of Access — export) and Art. 17 (Right to Erasure) for collaborator records (`user_profiles`-rooted PII) inside the NoonApp Supabase database. The scripts must be safe to run by hand in production with reversible dry-run output and a single committed runbook entry that the on-call operator can follow without prior context.
- Why this work matters now: NoonApp went live for an internal pilot (FASE 1 closed) with real collaborator data (names, emails, payout details, ledgers). The pilot is small and contained, but the legal obligation to satisfy a deletion or access request lands the instant the first collaborator asks for it. The B15 security review explicitly flagged that an Art. 15/17 request today would require ad-hoc SQL across ~25 tables, with the ledger-immutability question (`wallet_ledger_entries`, `earnings_ledger`, `payouts`) unresolved. B16 closes that operational gap. It is NOT a feature surface — no UI, no API endpoint — but it is a release-readiness gate.

### CONTEXT USED
- `project.context.core.md` reviewed: yes (default operating context)
- `project.context.full.md` reviewed: yes (the table inventory and ledger immutability question require structural truth)
- `project.context.history.md` reviewed: spot-checked for prior GDPR mentions; only ADR-016 and B15 review touch the topic at the column level
- Reason `full` was included: this iteration touches the ledger tables (`wallet_ledger_entries`, `earnings_ledger`, `payouts`) whose immutability is load-bearing for financial audit. Wrong design = either legal exposure (PII not actually erased) or ledger corruption (anonymisation that breaks aggregations). Architecture must be invoked.

### ROUTER DECISION
- Why this mode is correct: New Build with docs/runbook character. The Node scripts and the runbook are net-new; no existing helpers are being modified. The character is closer to operator tooling than to product feature work, but the inventory and the ledger-anonymisation question force Full depth.
- Why this depth is correct: Full. The ledger anonymisation strategy is an ADR-required decision (see Open Questions). Under-scoping by skipping Architecture would yield a script that either leaves PII in the ledger or breaks the financial audit invariant.
- Why this skill is the right active skill now: nothing else can route until the table inventory is closed and the open decisions are flagged for Architecture. Architecture cannot design the anonymisation contract without an exhaustive table classification.
- Reroute already known at start: no.

### SCOPE
- In scope: see `## Scope Boundary`.
- Explicitly out of scope: see `## Scope Boundary`.
- Success criterion: see `## Success Criterion`.

### INPUTS
- Files/modules involved: see `## Affected Files / Modules`.
- Contracts or architecture inputs available:
  - `docs/validations/B15 security review 2026-05-20.md` §S5 — the only prior GDPR analysis in the repo; identifies `website_inbound_links.inbound_payload` as the inbound PII surface and confirms B15's transport ledger is pseudonymous.
  - `docs/adrs/ADR-016-transport-level-webhook-ledger-pattern.md` — confirms `website_webhook_events` carries no direct PII (hashes only); used in the inventory classification.
  - `supabase/migrations/0001_phase_1a_auth_profiles.sql` — `user_profiles.id` is `references auth.users(id) on delete cascade`, which makes `auth.users` deletion the canonical cascade root. This is load-bearing for the auth-side deletion decision below.
  - `lib/server/supabase/database.types.ts` — canonical generated types used to cross-verify the inventory.
- Relevant handoffs received: router decision logged in task list (#5 completed). User-confirmed character: scripts + runbook, no UI, no API endpoint.
- External dependencies or environment assumptions: Supabase service-role key required (operator-side environment); no new infra. No NoonWeb-side coordination needed (website-side erasure is NoonWeb B14's scope).

### RISK SNAPSHOT
- Known risks before starting: see `## Risks`.
- Known blockers before starting: none. The ledger-immutability decision is an Open Question for Architecture but does not block scoping.
- Known assumptions before starting: see `## Assumptions`.

### CONTINUITY NOTES
- Previous session relevant to this one: B15 (PR #80) closed the website webhook ledger with explicit GDPR analysis at the column level; it is the operational precedent for how we reason about PII column-by-column.
- Expected next skill after this session if all goes well: system-architecture — produce the ADR on ledger-anonymisation strategy (sentinel UUID vs NULL vs row-deletion-with-balance-rebalance), define the contract for the two scripts (`export-user-data`, `erase-user-data`), and decide on dry-run semantics.

---

## Task Summary

Build two operator-run Node scripts and one runbook that satisfy GDPR Art. 15 (export) and Art. 17 (erasure) for collaborator records in the NoonApp Supabase database:

1. **`scripts/gdpr/export-user-data.ts`** — given an identifier (email or `user_profiles.id`), produces a single output (format TBD by Architecture: single JSON, JSON-per-table folder, or CSV bundle) containing all rows across the PII / `profile_id`-linked table inventory. No mutation. Re-runnable.
2. **`scripts/gdpr/erase-user-data.ts`** — given the same identifier, executes the per-table classification (CASCADE-delete vs ANONYMIZE-in-place vs EXPORT-only) inside a single transaction (or compensating sequence — Architecture decides). Supports `--dry-run` to print the planned actions without mutation.
3. **`docs/runbooks/gdpr-art-15-17.md`** — single-source operator runbook covering: when this runbook applies, prerequisites (env, access, ticket reference), step-by-step procedures for Art. 15 and Art. 17, post-run verification queries, retention policy for the exported artefact on the operator side, and the escalation path for cross-repo erasure (NoonWeb B14).

Out of band from this iteration but explicitly named so they are not forgotten:
- Website-side client PII erasure (the public clients NoonWeb collects, stored in `website_inbound_links.inbound_payload`, `stripe_customers`, `projects.client_name`, `client_access_tokens.client_email`) — owned by **NoonWeb B14**, NOT this iteration. This iteration's runbook references it and stops at the App boundary.
- Per-actor-role tiered erasure (e.g., admin requesting a sales rep's deletion vs a sales rep self-requesting) — UI/permission concerns; the scripts run as service-role operator tooling and trust the operator.

---

## Scope Boundary

### In scope

- `scripts/gdpr/export-user-data.ts` (new) — Art. 15 export script. Reads-only. Output format and structure TBD by Architecture.
- `scripts/gdpr/erase-user-data.ts` (new) — Art. 17 erasure script. Per-table classification applied per inventory. `--dry-run` flag mandatory; default behavior TBD by Architecture (Open Question).
- Possible helpers under `lib/server/gdpr/*` if Architecture decides to factor shared logic (table list, classifier, sentinel UUID resolver). NOT prescribed here.
- `docs/runbooks/gdpr-art-15-17.md` (new) — operator runbook per `## Task Summary`.
- `docs/context/project.context.core.md` — append the operating rule that GDPR Art. 15/17 requests are handled via the B16 scripts + runbook; cross-reference NoonWeb B14 for client-side scope.
- Roadmap (operator's Desktop file) — closure entry on session end per memory rule.
- ADR (number TBD) on the ledger-anonymisation strategy IF Architecture decides anonymisation is the chosen approach. If Architecture decides full row deletion with cascade is safer, the ADR may be unnecessary — that itself is an Architecture decision.
- Tests:
  - Unit tests for the classifier (each table → expected verdict).
  - Integration test: seed a synthetic profile with rows across the inventory, run export, assert all rows appear in the output; run erasure (dry-run first, then live), assert post-state matches the classification.
  - Dry-run safety test: assert no mutations occur when `--dry-run` is passed.
- Documentation:
  - The runbook itself (the main artefact).
  - The retention rule for the exported file on the operator side (the runbook must answer this — flagged for system-docs).

### Explicitly out of scope

- **Website-side (NoonWeb) client PII erasure.** NoonWeb owns its own erasure flow under its B14. This iteration's runbook documents the boundary and the escalation but does not implement the website-side action.
- **UI / dashboard surface for GDPR requests.** No `/dashboard/admin/gdpr` page, no API endpoint. Scripts are CLI-only, run by the operator with service-role credentials.
- **`auth.users` row deletion (Supabase Auth-side).** Pending Architecture's decision (Open Question): the script MAY invoke `supabase.auth.admin.deleteUser()` for full closure (since `user_profiles.id → auth.users.id ON DELETE CASCADE` means deleting auth.users.id cascades to user_profiles), OR it MAY skip auth-side and leave the orphaned `auth.users` row for the operator to clean up via Supabase Dashboard. Architecture decides; if YES, it stays in scope; if NO, it moves out.
- **Automated detection of new PII columns.** No CI check that fails if a new migration adds a PII column without classifying it in the script. Possible future iteration; tracked as a risk here.
- **Per-actor-role tiered erasure semantics.** Operator-trust model only.
- **Backup-side scrubbing.** Supabase PITR and any external backup snapshots are NOT scrubbed by this iteration. The runbook documents this gap and the standard GDPR justification (retention period covers it).
- **Notification to the data subject.** The runbook may suggest sending a confirmation email manually, but the script does not send anything.
- **Cross-repo unified GDPR portal.** A future iteration may unify App + Website erasure under one operator surface. Not B16.

---

## Affected Files / Modules

| File | Change |
|---|---|
| `scripts/gdpr/export-user-data.ts` (new) | Node script — Art. 15 export. Reads-only. CLI flags: `--email <e>` or `--profile-id <uuid>`, `--output <path>`, `--format <json\|csv>` (Architecture decides supported formats) |
| `scripts/gdpr/erase-user-data.ts` (new) | Node script — Art. 17 erasure. CLI flags: `--email <e>` or `--profile-id <uuid>`, `--dry-run` (default TBD by Architecture), `--reason <text>` (audit trail), `--include-auth` (decided by Architecture) |
| `lib/server/gdpr/*` (new, conditional) | IF Architecture decides to factor shared helpers (e.g., `inventory.ts`, `classifier.ts`, `anonymizer.ts`); module boundary NOT prescribed here |
| `docs/runbooks/gdpr-art-15-17.md` (new) | Operator runbook — full text |
| `docs/context/project.context.core.md` | Append operating rule on GDPR handling + cross-ref to NoonWeb B14 |
| `docs/adrs/ADR-<n>-gdpr-ledger-anonymization.md` (new, conditional) | IF Architecture decides anonymisation requires a formal decision document |
| `tests/server/gdpr/*` (new) | Unit + integration tests per `### In scope` Tests |
| `docs/context/project.context.history.md` | Closure entry on session end (per session-templates) |
| Roadmap (operator's Desktop file) | Closure snapshot on session end (per memory rule) |

---

## Authoritative PII / `profile_id`-linked table inventory

This is the load-bearing section. Verdict legend:

- **EXPORT-only** = appears in Art. 15 export; NOT touched on Art. 17.
- **CASCADE-delete** = owned by the user; deleted on Art. 17 (either via FK cascade or explicit DELETE).
- **ANONYMIZE-in-place** = financial/audit immutability — keep row, NULL or sentinel-replace `profile_id` / actor columns, redact any free-text PII columns.
- **SKIP-with-reason** = no PII / no FK to `user_profiles`.
- **OPEN-DECISION** = Architecture must decide between CASCADE-delete and ANONYMIZE-in-place (or a hybrid).

### Tables with FK to `public.user_profiles(id)` (collaborator scope)

| # | Table | PII / FK columns | Verdict (proposed) | Notes |
|---|---|---|---|---|
| 1 | `user_profiles` | `id` (PK→auth.users), `email`, `full_name`, `avatar_url`, `legacy_mock_id`, `locale`, `timezone`, `last_login_at`, `notification_preferences` | **CASCADE-delete** | The root row. `id` cascades from `auth.users` so deleting `auth.users` cascades here; deleting here directly also works. `role` is operational metadata, but the row as a whole is the subject's PII container. |
| 2 | `leads.assigned_to`, `leads.created_by` | uuid FKs | **OPEN-DECISION** | `assigned_to` is `ON DELETE SET NULL` (safe), `created_by` is `ON DELETE RESTRICT` (blocks). The `leads` rows themselves contain CLIENT PII (`name`, `email`, `phone`, `company`), not collaborator PII. The collaborator linkage can be NULLed for `created_by` via explicit UPDATE before delete. Architecture must decide: nullify created_by + leave the lead, OR keep lead and only nullify assignment. |
| 3 | `lead_activities.actor_profile_id` | uuid FK, `note_body` (free text — may mention the actor by name) | **ANONYMIZE-in-place** | `ON DELETE SET NULL` is the FK default. Free-text `note_body` may incidentally contain the actor's name; risk classed as LOW (audit immutability outweighs). |
| 4 | `lead_proposals.created_by` | uuid FK | **OPEN-DECISION** | `ON DELETE RESTRICT`. `title`/`body`/`amount` are commercial content, not collaborator PII. Same shape as `leads.created_by`. |
| 5 | `projects.created_by`, `projects.developer_user_id` | uuid FKs | **OPEN-DECISION** | `created_by` is `ON DELETE RESTRICT`; `developer_user_id` is `ON DELETE SET NULL`. `client_name` on `projects` is CLIENT PII (NoonWeb B14 scope, not here). |
| 6 | `tasks.created_by`, `tasks.assigned_legacy_user_id` | uuid FK + legacy text FK | **OPEN-DECISION** | `created_by` is `ON DELETE RESTRICT`; `assigned_legacy_user_id` is `ON DELETE SET NULL`. |
| 7 | `task_activities.actor_profile_id` | uuid FK | **ANONYMIZE-in-place** | Same shape as #3 — `ON DELETE SET NULL`. |
| 8 | `project_activities.actor_profile_id` | uuid FK | **ANONYMIZE-in-place** | Same shape as #3 — `ON DELETE SET NULL`. |
| 9 | `user_notifications.profile_id` | uuid FK | **CASCADE-delete** | `ON DELETE CASCADE` is already set. These are the subject's personal inbox — no audit need to retain. |
| 10 | `wallet_accounts.profile_id` | PK FK | **OPEN-DECISION** (ledger anchor) | `ON DELETE CASCADE` is already set, but cascading deletes `wallet_ledger_entries` (the audit row) via the FK chain. Architecture must decide: keep the wallet account (with balances zeroed if non-zero) and anonymise, OR cascade-delete and lose the audit. **This is the load-bearing ADR decision.** |
| 11 | `wallet_ledger_entries.profile_id`, `wallet_ledger_entries.actor_profile_id` | uuid FKs | **OPEN-DECISION** (ledger immutability) | `profile_id` cascades from `wallet_accounts.profile_id` (since the parent FK is cascade). Financial audit invariant requires these rows to persist. Architecture: anonymise `profile_id` to a sentinel UUID, NULL `actor_profile_id` (already SET NULL), wipe `metadata` JSONB. |
| 12 | `payout_methods.profile_id` | uuid FK + `details` JSONB (bank/binance routing PII) | **CASCADE-delete** | `ON DELETE CASCADE` is set. `details` is hot PII (account numbers). Safe to delete. |
| 13 | `payout_batches.created_by_profile_id` | uuid FK | **ANONYMIZE-in-place** | `ON DELETE SET NULL`. Batches are admin/operator-created; keeping the batch row is the immutability concern, not collaborator-personal. |
| 14 | `payouts.profile_id` | uuid FK | **OPEN-DECISION** (ledger immutability) | `ON DELETE RESTRICT` blocks deletion. Financial record of disbursement. Anonymise to sentinel UUID is the proposed path; Architecture confirms. |
| 15 | `earnings_ledger.actor_id` | uuid FK | **ANONYMIZE-in-place** | `ON DELETE SET NULL` is set — Architecture may keep that behavior or replace with a sentinel UUID. Either way, the row persists. |
| 16 | `seller_fees.seller_profile_id` | uuid FK | **OPEN-DECISION** | `ON DELETE RESTRICT`. State machine record tied to monetary entity. Same shape as `payouts` — anonymise to sentinel UUID likely. |
| 17 | `withdrawal_requests.actor_id`, `withdrawal_requests.processed_by_id` | uuid FKs | **OPEN-DECISION** | `actor_id` is `ON DELETE RESTRICT`; `processed_by_id` is `ON DELETE SET NULL`. Same ledger shape — anonymise the actor reference to a sentinel UUID. |
| 18 | `points_ledger.actor_id` | uuid FK | **OPEN-DECISION** | `ON DELETE RESTRICT`. Same shape as `withdrawal_requests`. |
| 19 | `point_redemptions.actor_id` | uuid FK | **OPEN-DECISION** | `ON DELETE RESTRICT`. Same shape. |
| 20 | `user_wallets.profile_id` | PK FK | **CASCADE-delete** | `ON DELETE CASCADE`. Prototype credits balance — non-financial, no audit need to retain (no real money). |
| 21 | `user_wallet_entries.profile_id`, `user_wallet_entries.actor_profile_id` | uuid FKs | **CASCADE-delete** | `profile_id` cascades from `user_wallets`; `actor_profile_id` is `ON DELETE SET NULL`. Prototype credits ledger — non-financial. |
| 22 | `prototype_workspaces.requested_by_profile_id` | uuid FK | **OPEN-DECISION** | `ON DELETE RESTRICT`. Linked to `leads` (which contain client PII) and `projects`. Likely anonymise. |
| 23 | `prototype_credit_settings.updated_by_profile_id` | uuid FK (singleton row) | **ANONYMIZE-in-place** | `ON DELETE SET NULL`. Operational metadata. |
| 24 | `client_access_tokens.created_by` | uuid FK | **ANONYMIZE-in-place** | `ON DELETE SET NULL`. The token row itself contains CLIENT PII (`client_name`, `client_email`) — that's NoonWeb B14 scope; the collaborator linkage just gets NULLed. |
| 25 | `maxwell_search_runs.requested_by` | uuid FK | **CASCADE-delete** | `ON DELETE CASCADE` is set. Search history — personal to the requesting collaborator, no audit need. |
| 26 | `maxwell_lead_feedback.profile_id` | uuid FK | **CASCADE-delete** | `ON DELETE CASCADE` is set. Same reason. |

### Tables with NO FK to user_profiles, classification still relevant

| # | Table | Scope | Verdict | Notes |
|---|---|---|---|---|
| 27 | `payments` | proposal → lead → no direct collaborator PII; `metadata` JSONB MAY contain operator notes | **SKIP-with-reason** | Financial record. No collaborator PII. The `lead` lineage references CLIENT PII, not collaborator. Out of B16 scope (NoonWeb B14 for client-side). |
| 28 | `provider_events` | Stripe/Binance webhook log | **SKIP-with-reason** | No collaborator PII. `payload` JSONB may contain client info, which is NoonWeb B14 scope. |
| 29 | `stripe_webhook_events` | event_id, type, status (no payload) | **SKIP-with-reason** | ADR-016 / B15 review confirmed: no PII. Pseudonymous. |
| 30 | `stripe_customers` | `email`, `name`, lead_id | **SKIP-with-reason** (App-side) | CLIENT PII. NoonWeb B14 scope. App-side script does not touch this. Mentioned in runbook for escalation. |
| 31 | `website_inbound_links` | `inbound_payload` JSONB with full client PII | **SKIP-with-reason** (App-side) | CLIENT PII. NoonWeb B14 scope. The runbook escalates. |
| 32 | `website_webhook_events` | hashes + pseudonymous external_ids only | **SKIP-with-reason** | ADR-016 + B15 review confirmed: no direct PII. |
| 33 | `reward_store_items` | catalog data | **SKIP-with-reason** | No PII. |
| 34 | `leads` (the row itself, separate from FK linkage in #2) | `name`, `email`, `phone`, `company`, `notes` | **SKIP-with-reason** | CLIENT PII — NoonWeb owns the source. App-side script does NOT delete lead rows just because a collaborator (e.g., the seller who created them) is being erased; the lead is owned by the client, not the collaborator. The FK linkage handling in #2 is the only thing this iteration does to leads. |
| 35 | `lead_proposals`, `tasks`, `projects` (the rows themselves, separate from FK linkage) | commercial content, no collaborator PII | **SKIP-with-reason** | Same reasoning as #34. |

### Verification

This inventory was cross-checked against:
- `supabase/migrations/0001` through `0056` (Grep on `references public.user_profiles` and `references auth.users` — 30 matches total accounted for above).
- `lib/server/supabase/database.types.ts` (generated types confirm column shapes match).
- Tables with PII columns that do NOT reference `user_profiles` but are explicitly client-side (NoonWeb B14 scope) are listed in row 30-34 for completeness.

Any table NOT in this inventory either does not exist in the public schema or has no PII and no `user_profiles` FK. Architecture should re-verify against the live schema before implementation.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | infra | present (operator-side env) | Scripts cannot connect with admin privileges | Operator |
| `NEXT_PUBLIC_SUPABASE_URL` | infra | present | Scripts cannot reach the database | Operator |
| `@supabase/supabase-js` admin client | external | already used in scripts/ | Cannot construct service-role client | App |
| `supabase.auth.admin.deleteUser()` | contract | available via service-role | If Architecture decides to use it: needed for auth.users cleanup | Supabase Auth |
| ADR on ledger anonymisation strategy | contract | NOT present — Architecture must produce | Erasure script cannot be written deterministically | Architecture |
| NoonWeb B14 (cross-repo) | external | NOT in scope here | Client-side PII (`website_inbound_links.inbound_payload`, `stripe_customers`, etc.) remains in NoonApp DB after this iteration runs | NoonWeb |

---

## Assumptions

- Each Art. 15/17 request maps to exactly one `user_profiles` row (the operator pre-resolves multi-account merges manually). The script does not handle "find all profiles for email X across history".
- The operator runs the scripts from a trusted local environment with the service-role key. No remote / multi-tenant invocation surface is in scope.
- The data subject is a **collaborator** (NoonApp user with a `user_profiles` row), NOT an end client of a NoonApp customer. End-client erasure (the people the collaborators sell to / build for) is NoonWeb B14's domain.
- The ledger immutability requirement is real (financial audit, Stripe reconciliation, internal reporting) but anonymisation is legally acceptable per common GDPR interpretation when full deletion would break legitimate-interest financial records. Architecture confirms the legal posture is acceptable.
- Stripe Connect / external provider records (Stripe Dashboard, Binance) are NOT touched by this iteration. The runbook documents that the operator must separately request deletion from those providers if the data subject demands it.
- Backup snapshots (Supabase PITR, any external backup copies) are NOT scrubbed. Standard retention period defense applies.

---

## Open Questions

These are the items Architecture must decide. They do NOT block this spec from being marked Ready, but they DO block backend implementation from starting.

1. **Ledger anonymisation sentinel**: pick a real all-zeros UUID `00000000-0000-0000-0000-000000000000`, or NULL the column, or use a dedicated `00000000-0000-0000-0000-deleted00000` sentinel? Constraints: `wallet_ledger_entries.profile_id` is `not null`; `seller_fees.seller_profile_id` is `not null`; `withdrawal_requests.actor_id` is `not null`; `points_ledger.actor_id` is `not null`; `payouts.profile_id` is `not null`. NULL is not viable for these — sentinel UUID is required, but the value must either match an existing or pre-seeded sentinel row in `user_profiles`, OR the FK must be temporarily dropped during erasure (NOT recommended).
2. **`auth.users` row deletion**: invoke `supabase.auth.admin.deleteUser(profileId)` from the erase script, OR skip auth-side and document the manual cleanup in the runbook? Cascading via `auth.users` deletion would clean `user_profiles` automatically (the FK is `ON DELETE CASCADE`), which might be preferred over deleting `user_profiles` directly.
3. **Export format**: single JSON file (one root object with per-table keys), or a folder with one JSON-per-table, or a CSV bundle (one CSV per table zipped)? JSON is simplest; CSV is what regulators typically expect.
4. **Dry-run default**: default to dry-run (operator must pass `--execute` or `--no-dry-run` to actually mutate), or default to live (operator must pass `--dry-run` for safety)? Default-dry-run is safer but slower for legitimate runs.
5. **Operator auth for the script**: env var only (current pattern in `scripts/`), interactive prompt for confirmation (read-host style), or no auth (file-system trust as in `scripts/seed-phase-1a-users.ts`)? Default-interactive-confirmation seems prudent given the destructive nature.
6. **Retention of the exported file on the operator side**: the runbook must answer this. Proposal: encrypt at-rest on operator machine, delivered to the data subject via the agreed channel (e.g., signed download link or in-person handoff), then deleted from the operator machine within N days. Concrete N TBD by system-docs.
7. **Transactional safety**: single BEGIN…COMMIT around all per-table operations, or compensating sequence with checkpoint logging? Single transaction is cleaner; if the ledger tables are large, a single transaction may lock for too long. Architecture decides.
8. **Treatment of `leads.created_by` / `lead_proposals.created_by` / `tasks.created_by` / `projects.created_by` (all `ON DELETE RESTRICT`)**: anonymise in-place (set to sentinel UUID), or leave the row intact and accept that historical "created by" remains? Linked to (1) above.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| Orphan FK after partial delete (a row referencing the deleted profile via `ON DELETE RESTRICT` blocks the cascade mid-transaction) | HIGH | HIGH | HIGH | Architecture must order operations so RESTRICT FKs are anonymised BEFORE the parent delete. Inventory above flags every RESTRICT FK explicitly. Dry-run must catch this. |
| Double-export (running the script twice and sending two copies of the data) | LOW | MEDIUM | LOW | Idempotent by construction (export is read-only). Runbook documents the convention "name the output file with the timestamp + ticket reference". |
| Accidental delete of operator/admin profile (e.g., typo in profile-id) | MEDIUM | CRITICAL | HIGH | Pre-flight check in the script: refuse to operate on `user_profiles.role = 'admin'` without `--allow-admin` explicit flag. Runbook + interactive confirmation required for any erase. |
| Ledger anonymisation breaks aggregate queries (e.g., `select sum(amount) where actor_id = X`) | LOW | MEDIUM | MEDIUM | Pre-anonymisation snapshot in the export; post-anonymisation verification query that the sum-by-time bucket is unchanged. Documented in runbook. |
| Transactional lock contention on `wallet_ledger_entries` / `earnings_ledger` if many rows | MEDIUM | MEDIUM | MEDIUM | Architecture decides whether to chunk the operation. Off-hours run documented in runbook. |
| `auth.users` not deleted, leaving an orphan auth row that can still log in (until disabled) | MEDIUM | HIGH | HIGH | Either include auth-side delete (Open Q #2) OR mandate in runbook that operator sets `user_profiles.is_active = false` + manually disables auth user in Supabase Dashboard BEFORE running the erase script. |
| New PII column added in a future migration without classifying it here | HIGH (over time) | MEDIUM | MEDIUM | Architecture: consider a CI check or a doc-rule that every new table/column must update this spec or a sibling registry. Out of B16 scope, but flagged. |
| Backup snapshots retain the deleted data | CERTAIN | LOW (legal) | LOW | Standard GDPR retention defense (backups are out of the operational data plane). Runbook documents the position. |
| Cross-repo gap (NoonWeb B14 not yet shipped) | CERTAIN (today) | MEDIUM | MEDIUM | Runbook explicitly escalates to NoonWeb operator with the list of tables/columns to clear. This iteration delivers App-side; NoonWeb closes the loop later. |
| Operator runs erase without prior export (data subject's Art. 15 request unanswered) | LOW (process) | MEDIUM | LOW | Runbook MUST require running export FIRST, with the export artefact preserved before the erase is even attempted. Script-level: erase refuses to run unless an export artefact path is provided as proof. |

---

## Cross-repo impact

**NoonWeb (`noon-web-main`)**: not directly impacted by this iteration. The collaborator data lives in NoonApp's Supabase database, which NoonWeb does not read or write. However:

- The same data subject MAY also exist as a client in NoonWeb's database (less likely for collaborators but theoretically possible if a collaborator also bought through the website). The runbook escalates this case to NoonWeb's GDPR procedure (B14).
- Client-side PII (the customers that collaborators sell to / build for) lives partly in NoonApp's DB (`website_inbound_links`, `stripe_customers`, `projects.client_name`, `client_access_tokens`, `leads.name/email`) AND in NoonWeb's DB. Erasure of a client requires BOTH B14 (NoonWeb) AND a separate App-side cleanup, which is NOT part of B16. A future iteration may unify this.

**Webhook contracts**: not touched. No NoonApp → NoonWeb or NoonWeb → NoonApp signature change.

**Stripe**: not touched directly. The operator must separately request data deletion from Stripe per Stripe's own GDPR procedure; runbook references this.

---

## Acceptance criteria (Validator gate input)

The iteration is COMPLETE when all of the following hold:

1. `scripts/gdpr/export-user-data.ts` exists, is executable via `tsx` or `pnpm run` (whichever convention Architecture picks), accepts `--email` or `--profile-id`, and produces an output artefact containing every row across the inventory tables that references the resolved profile.
2. `scripts/gdpr/erase-user-data.ts` exists, accepts the same identifier flags + `--dry-run` (default per Architecture), and on dry-run prints a per-table plan matching the inventory classification.
3. Live erase run (in a test database with seeded synthetic data) leaves the database in the state described by the inventory:
   - CASCADE-delete rows are gone.
   - ANONYMIZE-in-place rows have `profile_id` / actor columns replaced with the sentinel (per Architecture decision); free-text PII columns are redacted.
   - EXPORT-only rows are untouched.
4. The script refuses to run against an `admin` profile without explicit `--allow-admin`.
5. The script refuses to run erase unless an export artefact path is provided (operator proves Art. 15 was satisfied first).
6. `docs/runbooks/gdpr-art-15-17.md` is checked in and contains: prerequisites, Art. 15 procedure, Art. 17 procedure, post-run verification queries, retention of exported file on operator side, escalation to NoonWeb B14, escalation to Stripe.
7. `docs/context/project.context.core.md` has the new operating rule.
8. Tests: unit tests for the classifier + integration test that round-trips a synthetic profile (seed → export → erase → verify post-state) pass.
9. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` are green.
10. ADR on ledger-anonymisation strategy (if Architecture produces one) is checked in.
11. Validator (system-validator skill) returns COMPLETE.

---

## Recommended Route Depth

**Full.** Touches ledger immutability (load-bearing financial audit invariant) and produces an operator-facing runbook against real PII. Architecture is mandatory because the anonymisation strategy is a design decision, not an implementation detail. Security is mandatory because PII + service-role + destructive operation. Docs is mandatory because the runbook IS the artefact.

## Chunking Decision

**Single iteration.** Router already decided no chunking. The scope is large in surface area (26+ tables) but small in code volume (two scripts + helpers + one runbook). Splitting into export-only-first vs erase-only-later would lose the round-trip verification test, which is the strongest guard against drift between the two scripts.

## Recommended Testing Methodology

**Integration-first.** The script's correctness is best demonstrated by a seed → export → erase → verify round-trip against a synthetic profile spanning the full inventory. Unit tests on the classifier (table → verdict) supplement but are secondary. TDD is impractical because the classification is data-driven, not algorithmic.

## Success Criterion

A single operator with access to the runbook can satisfy a GDPR Art. 15 (export) or Art. 17 (erasure) request against a collaborator account in NoonApp end-to-end, with the App-side data plane left in a verifiably correct state (per the inventory classification) and the cross-repo escalation to NoonWeb / Stripe explicitly documented.

---

## Lifecycle markers

- Status: Ready (Architecture appendix signed 2026-05-21; ADR-019 anchors §D1, §D2, §D8)
- Supersedes: null
- Created: 2026-05-21
- Owner: System (Pedro / noondevelop@gmail.com)
- Last updated: 2026-05-21 (Architecture Decisions appendix added)

---

## Architecture Decisions

Signed by system-architecture on 2026-05-21. Anchors the 8 Open Questions; backend implements without re-deciding. Long-term structural decisions (Q1, Q2, Q8) are captured in **`docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md`**; this section signs all 8 plus the contracts.

### Q1–Q8 decisions

| # | Question | Decision | One-line justification |
|---|---|---|---|
| Q1 | Ledger sentinel UUID strategy | **(a) Pre-seed fixed sentinel row** at `id = '00000000-0000-0000-0000-000000000000'` with matching `auth.users` row, `email = 'deleted-user@noon.invalid'`, `role = 'developer'`, `is_active = false` | RFC 4122 nil UUID; no collision with `gen_random_uuid()`; FK integrity preserved on all `not null` actor columns; see ADR-019 §D1. |
| Q2 | `auth.users` deletion timing | **(c) `supabase.auth.admin.deleteUser(profileId)` invoked LAST**, after all `public.*` anonymization completes | Anonymizing first keeps the live `user_profiles` row readable throughout the run; the cascade fires once at a known boundary; see ADR-019 §D2. |
| Q3 | Export format | **Single JSON file**: one root object keyed by table name, each value an array of rows. Output filename: `gdpr-export-<profile-id>-<ISO8601-utc>.json` | Single artefact is simplest to deliver (signed link / in-person handoff), trivially machine-parseable, and the runbook can prescribe SHA-256 fingerprint verification on one file. CSV bundle and JSON-per-table folder both create N artefacts to track. |
| Q4 | Dry-run default for erase | **Default-safe: `--execute` required to mutate.** Without `--execute`, the script runs in dry-run mode and prints the per-table plan. | Blast radius of erasure is non-reversible; requiring explicit `--execute` matches the convention of every destructive Supabase Admin operation. Cost is one extra flag per legitimate run; benefit is making accidental erasure impossible. |
| Q5 | Operator auth pattern beyond env | **Env var (`SUPABASE_SERVICE_ROLE_KEY`) + interactive typed confirmation**: the operator must type the target email or profile-id exactly (case-sensitive) when prompted, AND set env var `I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1`. Both required. | Env-var-only is the existing scripts/ convention but insufficient for destructive ops; interactive typed confirmation guards against pasted/copy-pasted wrong identifiers; second-factor file would require infra not present. |
| Q6 | Exported file retention on operator side | **90 days from delivery to the data subject**, mirroring `client_access_tokens` default (migration 0054). Operator deletes the local artefact after 90 days OR upon written confirmation of receipt, whichever comes first. Encrypted at rest on operator machine (operator-side OS-level FDE assumed). | Aligns with existing token-lifecycle policy in the codebase, so the operator has a single retention rule to remember. 90 days is also the standard GDPR "reasonable response" window doubled. |
| Q7 | Transactional safety | **Single Postgres transaction (`BEGIN…COMMIT`) for all `public.*` anonymization and explicit DELETEs. `supabase.auth.admin.deleteUser()` runs AFTER the `COMMIT` (it is a separate Auth-API call, not part of the SQL transaction).** | Single transaction guarantees atomicity of the anonymization pass — a mid-failure rolls everything back to pre-run state. Lock contention risk is acceptable: the inventory targets ROWS scoped to one profile, not full-table scans. Auth-side delete is a single API call that either succeeds or fails cleanly; if it fails after `COMMIT`, the operator re-runs only the auth-side delete (the runbook documents the recovery query). |
| Q8 | `created_by` family (RESTRICT FKs) | **Anonymize to sentinel UUID** — see Q1 + ADR-019 §D3 | Commercial/financial artifacts (leads, proposals, tasks, projects, payouts, etc.) are not the collaborator's personal property; anonymization preserves the audit shape while removing the personal linkage. |

### Contract — `scripts/gdpr/export-user-data.ts`

**CLI signature:**

```
tsx scripts/gdpr/export-user-data.ts \
  (--email <addr> | --profile-id <uuid>) \
  --output <path-to-write> \
  [--ticket <ticket-ref>]
```

**Required env:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Behavior:**
1. Parse CLI args. Exactly one of `--email` / `--profile-id` required; reject if both or neither.
2. Validate env (fail-fast with clear error on missing).
3. Construct service-role Supabase client.
4. Resolve `profile_id` from email if `--email` was passed (lookup `user_profiles.email`); refuse with exit 2 if no match.
5. For each table in `TABLE_INVENTORY` (CASCADE-delete + ANONYMIZE-in-place + OPEN-DECISION verdicts, plus the parent `user_profiles` row), `SELECT *` filtered by the table's `profile_id` / actor column.
6. Assemble result object:
   ```ts
   {
     gdpr_export_metadata: {
       schema_version: '1.0.0',
       generated_at_utc: ISO8601 string,
       profile_id: UUID,
       email_at_export_time: string,
       full_name_at_export_time: string,
       ticket_ref: string | null,
       inventory_tables_covered: string[],
     },
     tables: {
       user_profiles: [...],
       wallet_ledger_entries: [...],
       payouts: [...],
       // ... one key per inventory table
     }
   }
   ```
7. Write to `--output` path as pretty-printed JSON (2-space indent).
8. Print a one-line summary to stdout: `Exported N rows across M tables to <path>.`

**Exit codes:**
- `0` — success, file written.
- `1` — env / CLI validation error.
- `2` — profile not found.
- `3` — Supabase query failure (per-table error surfaced; abort).
- `4` — output file write error.

**Side effects:** none (reads only).

**Idempotency:** re-runnable. The runbook convention is to use a timestamp-suffixed output path so re-runs do not overwrite prior artefacts.

**Errors:** every Supabase error is wrapped with the table name and re-thrown; no silent skips.

### Contract — `scripts/gdpr/erase-user-data.ts`

**CLI signature:**

```
tsx scripts/gdpr/erase-user-data.ts \
  (--email <addr> | --profile-id <uuid>) \
  --export-artefact <path-to-prior-export-json> \
  --reason <text> \
  [--execute] \
  [--allow-admin] \
  [--ticket <ticket-ref>]
```

**Required env:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1` (required ONLY when `--execute` is also passed; ignored in dry-run)

**Behavior:**
1. Parse CLI args. Validate.
2. Validate env.
3. Resolve `profile_id` from `--email` if needed (refuse with exit 2 if not found).
4. Read the `--export-artefact` file; verify it is a valid JSON file with a top-level `gdpr_export_metadata.profile_id` matching the resolved profile-id. Refuse with exit 5 if missing, malformed, or mismatched.
5. Pre-flight checks:
   - Verify sentinel row exists: `select 1 from user_profiles where id = '00000000-0000-0000-0000-000000000000'`. Refuse with exit 6 if not. (Backend pre-implementation checklist: the sentinel migration must have been applied first.)
   - Verify target profile is not the sentinel itself.
   - Verify target profile's `role` is not `admin` unless `--allow-admin` was passed.
6. If `--execute` is NOT set (dry-run, the default):
   - Print the per-table plan: for each inventory table, print `<table>: <verdict> (N rows would be <action>)`. Action is `DELETED`, `ANONYMIZED-to-sentinel`, `EXPORT-only`, or `SKIPPED`.
   - Exit 0. No mutations.
7. If `--execute` is set:
   - Verify `I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1`. Refuse with exit 7 if not.
   - Interactive prompt: print the resolved profile's email + full_name + profile-id, then prompt `Type the email or profile-id to confirm:`. If input does not exactly match the resolved email or profile-id (case-sensitive), abort with exit 8.
   - Open a Postgres transaction (`BEGIN`).
   - Per the inventory ordering:
     - Step 1 — ANONYMIZE-in-place: UPDATE each table to set actor column = sentinel UUID; redact free-text PII columns to `'[redacted]'` per inventory; wipe metadata JSONB to `{}`.
     - Step 2 — OPEN-DECISION → anonymize (per ADR-019 §D3): UPDATE each RESTRICT-FK creator column to sentinel UUID.
     - Step 3 — Explicit DELETEs for CASCADE-delete tables that do NOT cascade from `user_profiles` FK (e.g., the script may issue explicit DELETEs for resilience; cascading FKs handle the rest at step 5).
   - `COMMIT` the transaction.
   - Step 4 — Invoke `supabase.auth.admin.deleteUser(profileId)`. This cascades through `auth.users → user_profiles → (CASCADE-FK children)`.
   - Step 5 — Verification queries: for each inventory table, count rows still referencing original profile-id (must be 0) and count rows referencing sentinel (must equal pre-erase anonymize-count). Print the verification table to stdout.
   - Exit 0 on full success.

**Exit codes:**
- `0` — success (dry-run printed, or live erase completed + verified).
- `1` — env / CLI validation error.
- `2` — profile not found.
- `3` — Supabase query failure during dry-run or anonymization (transaction rolled back).
- `4` — auth-side delete failure (anonymization committed; runbook documents the recovery).
- `5` — export artefact missing, malformed, or mismatched.
- `6` — sentinel profile not seeded.
- `7` — destructive env var not set.
- `8` — interactive confirmation mismatch.
- `9` — admin target without `--allow-admin`.
- `10` — post-erase verification mismatch (anonymized rows count off).

**Side effects (when `--execute` passes):** mutates `public.*` per inventory; deletes `auth.users` row; cascades to `user_profiles` and CASCADE-FK children.

**Idempotency:** running erase against an already-erased profile-id returns exit 2 (profile not found) cleanly. Running dry-run against an active profile is always safe.

**Audit trail:** at the END of a successful `--execute` run, the script appends a line to `<repo>/.gdpr-erasure-audit.log` (operator-local file, gitignored) with timestamp, profile-id (the original), ticket-ref, reason, and verification-pass status. This is operator-local, not committed.

### Module boundaries

**Decision: factor helpers under `lib/server/gdpr/`.**

The two scripts share the inventory, the export read logic, and the post-erase verification logic. Factoring keeps the scripts thin and makes the logic unit-testable.

```
lib/server/gdpr/
├── inventory.ts      # TABLE_INVENTORY constant + verdict enum
├── export.ts         # exportUserData()
├── erase.ts          # eraseUserData() + dry-run plan generator
└── sentinel.ts       # SENTINEL_PROFILE_ID constant + sentinel-existence guard
```

**Public function signatures (TypeScript):**

```ts
// lib/server/gdpr/sentinel.ts
export const SENTINEL_PROFILE_ID = '00000000-0000-0000-0000-000000000000' as const

export async function assertSentinelExists(
  client: SupabaseClient<Database>
): Promise<void>
// Throws if the sentinel user_profiles row is missing.

// lib/server/gdpr/inventory.ts
export type TableVerdict =
  | 'CASCADE-delete'
  | 'ANONYMIZE-in-place'
  | 'EXPORT-only'
  | 'SKIP-with-reason'

export interface TableInventoryEntry {
  table: string
  verdict: TableVerdict
  // Column on the table that filters rows belonging to the target profile.
  // null means the table has no per-profile filter and is handled specially.
  filterColumn: string | null
  // Columns to set to the sentinel UUID during ANONYMIZE-in-place.
  // Empty array for CASCADE-delete / EXPORT-only.
  actorColumnsToSentinel: string[]
  // Free-text PII columns to redact to '[redacted]'.
  freeTextColumnsToRedact: string[]
  // JSONB columns to wipe to {}.
  jsonbColumnsToWipe: string[]
  // Whether the FK cascades from user_profiles delete (i.e., the script does
  // NOT need to issue an explicit DELETE — the auth-side delete handles it).
  cascadesFromUserProfiles: boolean
  notes: string
}

export const TABLE_INVENTORY: readonly TableInventoryEntry[]

// lib/server/gdpr/export.ts
export interface ExportArtefact {
  gdpr_export_metadata: {
    schema_version: '1.0.0'
    generated_at_utc: string
    profile_id: string
    email_at_export_time: string
    full_name_at_export_time: string
    ticket_ref: string | null
    inventory_tables_covered: string[]
  }
  tables: Record<string, unknown[]>
}

export async function exportUserData(
  client: SupabaseClient<Database>,
  profileId: string,
  opts: { ticketRef?: string | null }
): Promise<ExportArtefact>

// lib/server/gdpr/erase.ts
export interface ErasePlan {
  profile_id: string
  per_table: Array<{
    table: string
    verdict: TableVerdict
    row_count: number
    planned_action: 'DELETE' | 'ANONYMIZE' | 'EXPORT-only' | 'SKIP'
  }>
}

export interface EraseResult {
  profile_id: string
  per_table: Array<{
    table: string
    rows_affected: number
    verification_remaining_for_original: number
    verification_sentinel_count: number
  }>
  auth_user_deleted: boolean
}

export async function planErase(
  client: SupabaseClient<Database>,
  profileId: string
): Promise<ErasePlan>

export async function eraseUserData(
  client: SupabaseClient<Database>,
  profileId: string,
  opts: {
    reason: string
    ticketRef?: string | null
    allowAdmin?: boolean
  }
): Promise<EraseResult>
// Throws on any per-step failure; transaction is rolled back automatically.
// Does NOT prompt interactively — the script wraps this function in the
// confirmation prompt before calling. Does NOT check the destructive env
// var — the script enforces that.
```

### Sentinel bootstrap migration (signal to Backend)

ADR-019 §D4 pins the migration contents. Backend writes `supabase/migrations/<NEXT>_phase_22a_gdpr_sentinel_profile.sql` (expected next number `0057`, subject to actual sequence at implementation time). The SQL is reproduced verbatim in ADR-019 §D4 — backend writes byte-for-byte modulo the migration number prefix.

### Allowed shortcuts

| Shortcut | Why acceptable now | Risk introduced | Future work created |
|---|---|---|---|
| Single output JSON file (vs CSV bundle) | Operator deals with one artefact, easier to fingerprint and deliver | If a data subject requests CSV specifically, the operator must convert externally | Possible future `--format csv` flag if a regulator request demands it |
| No automated free-text PII redaction (lead/task/project activity notes) | Risk is LOW per inventory; full-text NLP scanning is out of scope | A collaborator's name might persist in `note_body` after erasure | Tracked as a future iteration (Art. 16 rectification flow) |
| Operator-local audit log (`.gdpr-erasure-audit.log`) instead of DB audit table | Avoids creating a new table that itself becomes a PII surface | Audit trail is not centralised; operator-machine-bound | If multiple operators ever run erasures, formalize a central log |
| Synchronous, non-chunked transaction | Inventory is row-scoped to one profile; locks are narrow | Theoretical lock contention on a very active collaborator profile | Documented in runbook: run off-hours |
| Backup snapshots not scrubbed | Standard GDPR retention defense | Subject's data persists in PITR for the retention window | Runbook documents the position; no code action |

### Forbidden shortcuts

| Shortcut | Why prohibited |
|---|---|
| Use NULL instead of the sentinel UUID on not-null actor columns | The columns reject NULL. Would require either dropping the not-null constraint (schema change) or marking the FK NOT VALID (footgun). |
| Drop the FK constraint temporarily during erasure | Permanent NOT VALID constraints are invisible to schema readers and break the next ledger write. ADR-019 §D1 rejects this. |
| Flip `created_by` family from RESTRICT to CASCADE | Would delete leads / projects / tasks / proposals on collaborator erasure; those carry CLIENT PII and commercial value not owned by the collaborator. |
| Delete `auth.users` before anonymization | Cascade fires immediately; loses the read surface needed for the anonymization pass and verification queries. |
| Skip the export-artefact-path requirement on erase | Art. 15 satisfaction must precede Art. 17 execution. Operator could otherwise erase without ever providing the data to the subject. |
| Allow `--execute` without `I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1` AND interactive typed confirmation | Single-guard env-var or single-guard prompt would each be defeatable by accident; both required is the minimum guard for non-reversible operation. |
| Per-erasure mapping audit table (the rejected Q1 option (c)) | The mapping table is itself a PII surface; ADR-019 §D1 rejects this. |

### Pre-implementation checklist for Backend

Before writing any script or helper code, backend MUST:

1. **Verify no in-flight migration adds a new `profile_id`-FK table.** Run `Grep` on `supabase/migrations/` for `references public.user_profiles` and `references auth.users` and cross-check against `TABLE_INVENTORY`. If a migration newer than spec date (2026-05-21) adds a table, escalate back to system-analysis to update the inventory before continuing.
2. **Verify the live `auth.users` column shape** in the target Supabase project matches the INSERT column list in ADR-019 §D4. If columns have been added with NOT NULL + no default since migration 0001, extend the migration's INSERT and document the extension in the migration header comment.
3. **Apply the sentinel bootstrap migration FIRST**, before any work on the erase script. The erase script's pre-flight check refuses to run if the sentinel row is missing; CI will fail otherwise.
4. **Regenerate `lib/server/supabase/database.types.ts`** after the sentinel migration is applied. The new rows in `auth.users` / `user_profiles` do not change the generated types, but applying the migration is a good time to refresh types and confirm no unrelated drift has crept in.
5. **Confirm `tsx` is the test-runner / executor for scripts** (existing `scripts/` convention). If `pnpm run` wrappers are added, document them in `package.json` and the runbook.
6. **Cross-check `TABLE_INVENTORY` against the live schema** with a one-off Grep + database.types.ts inspection. Any divergence between spec inventory and generated types must be raised to system-analysis as a Correction-by-Architecture before backend codes the inventory constant.
7. **Confirm the `payout_methods.details` JSONB shape** — the inventory verdicts CASCADE-delete (the row goes with `ON DELETE CASCADE` chain). If any column inside `details` is also referenced by an audit table somewhere not in the inventory, escalate.
8. **`SUPABASE_SERVICE_ROLE_KEY` is operator-side only** — never commit, never put in CI / Vercel. The scripts are operator-run from a trusted machine. Confirm `.env.local` is `.gitignore`-protected.

### Outcome

**Ready.** Backend can pick this up cold and write the two scripts + four helpers + one migration without re-deciding anything. All 8 Open Questions are signed; ADR-019 anchors the structural three; contracts are byte-level explicit; module boundaries are signed; pre-implementation checklist is bound.

### Correction by Architecture

None. The spec inventory was cross-checked against `0001` through `0056` and against `lib/server/supabase/database.types.ts` shape inference; no table mis-classification was detected. The 35-table inventory holds.



---

## template-session-close
> Filled per session-templates skill before the iteration is declared closed.

### WORK COMPLETED
- (deferred — this spec is the system-analysis output; implementation chunks are tracked by their own commits, each calling back to this spec)

### FINDINGS
- The PII / `profile_id`-linked surface in NoonApp covers 26 collaborator-scoped tables. The load-bearing decision is how to anonymise the four "ledger" tables (`wallet_ledger_entries`, `earnings_ledger`, `payouts`, `seller_fees`, plus the points/withdrawal siblings) given their `not null` actor columns and financial audit immutability requirement.
- The website (NoonWeb) side of the same data subject (when relevant) is NOT in B16 scope and stays under NoonWeb B14. The runbook escalates explicitly.
- `auth.users` deletion path via `supabase.auth.admin.deleteUser()` is the cleanest cascade root but is an Architecture decision (Open Q #2).

### NEXT STEPS
- system-architecture: produce the ADR on ledger anonymisation, decide the 8 Open Questions, hand off contracts for the two scripts.
- system-backend: implement scripts + helpers per the contracts.
- system-security: PII handling + service-role auth review.
- system-testing: integration round-trip test.
- system-docs: runbook + retention rule for the exported file.
- system-validator: gate the iteration.
