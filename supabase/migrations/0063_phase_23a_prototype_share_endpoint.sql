-- 0063_phase_23a_prototype_share_endpoint.sql
--
-- Phase 23A (ADR-028 implementation, App-side):
-- Materializes the persistence delta required for the `prototype-share`
-- inbound webhook (NoonWeb → App) firmed by ADR-028 + cross-repo-webhook-v1.md §5A.
-- The handler ships in the same iteration as this migration; together they
-- replace the previously-missing upstream that issues `share_token` on
-- workspace creation from a NoonWeb studio session.
--
-- Four atomic elements (single-file migration per ADR-014):
--
--   1. Add four new columns to `public.prototype_workspaces`:
--      - `external_session_id text` — the NoonWeb `studio_session.id` that
--        triggered the share. First column on this table that carries the
--        upstream session id; ties the workspace to its origin for trace
--        correlation and resource-dedup (see element 2).
--      - `v0_chat_id text` — the V0 chat identifier that built this
--        artifact. Upstream-of-token identity per ADR-028 D2: regenerate
--        ⇒ new chat ⇒ new workspace ⇒ new token.
--      - `generated_html text` — srcdoc fallback for client-portal render
--        when `demo_url` is unreachable. Semantically distinct from the
--        existing `generated_content` (which is v0 source code for audit
--        per migration 0046) per ADR-028 Q-piedra-1.
--      - `webhook_event_id uuid` — soft FK to `website_webhook_events.id`
--        (on delete set null). Enables the ledger-replay reconstruction
--        path symmetric with `prototype_decisions.webhook_event_id` from
--        migration 0060 element 4 (`composePrototypeShareReplayResponseFromLedger`
--        joins on this column). NULL on rows created outside the
--        `prototype-share` endpoint — legacy RPC-created workspaces and
--        any future ingestion path are unaffected.
--
--      All three are NULLABLE. The existing `prototype_workspaces` rows
--      created via the `request_lead_prototype` RPC (legacy seller flow)
--      will continue to work — they have NULL on the new columns; the
--      `prototype-share` upstream populates them on the rows it creates.
--
--      Columns NOT introduced (reuse decision per ADR-028 Q-piedra-1):
--      - `deployed_url` — reuses existing `demo_url` column from migration
--        0046 (identical semantic: v0-hosted preview URL).
--      - `generated_at` — already exists from migration 0033 element 3.
--
--   2. Create UNIQUE PARTIAL INDEX on `(external_session_id, v0_chat_id)`.
--      This is the application-level resource-dedup key per ADR-028 D4.
--      A request that arrives with a pair matching an existing
--      non-superseded workspace returns the existing share_token (HTTP 200
--      idempotent: true) instead of inserting a duplicate row.
--
--      PARTIAL: only enforced when BOTH columns are non-null. Legacy rows
--      (NULL on both) are not affected. This is the only safe shape — a
--      non-partial UNIQUE would block any future row with NULL on either
--      column (PostgreSQL treats NULL as not-equal under standard UNIQUE).
--
--   3. Extend `public.website_webhook_events.endpoint` CHECK constraint
--      (originally from migration 0051, extended in 0060 with
--      'prototype-decision') to include 'prototype-share'. The handler
--      MUST sit behind the existing transport ledger per ADR-016. The
--      pattern is identical to 0060 element 5:
--      drop + recreate the CHECK with the extended set.
--
-- Token issuance note (load-bearing for the handler iteration; NOT in this
-- migration):
--   The `prototype-share` endpoint owns workspace creation AND token
--   issuance via direct INSERT INTO prototype_workspaces ... share_token =
--   gen_random_uuid()::text. The existing `request_lead_prototype` RPC
--   (migration 0060:281-505) is `security definer` with auth.uid()
--   required and role-gated to admin/sales_manager/sales — NOT reachable
--   from the service_role context this endpoint runs in. The handler
--   reuses the same `gen_random_uuid()::text` token generation mechanism
--   per ADR-023 D2; the UNIQUE constraint on `share_token` already exists
--   in 0060 line 140. See ADR-028 Q-piedra-1.
--
-- ROLLBACK companion (DO NOT RUN unless reverting):
--   begin;
--   -- Reverse element 3:
--   alter table public.website_webhook_events
--     drop constraint if exists website_webhook_events_endpoint_check;
--   alter table public.website_webhook_events
--     add constraint website_webhook_events_endpoint_check
--     check (endpoint in ('inbound-proposal','payment-confirmed','prototype-decision'));
--   --
--   -- Reverse element 2:
--   drop index if exists public.ux_prototype_workspaces_session_chat;
--   drop index if exists public.idx_prototype_workspaces_webhook_event_id;
--   --
--   -- Reverse element 1:
--   alter table public.prototype_workspaces
--     drop column if exists webhook_event_id;
--   alter table public.prototype_workspaces
--     drop column if exists generated_html;
--   alter table public.prototype_workspaces
--     drop column if exists v0_chat_id;
--   alter table public.prototype_workspaces
--     drop column if exists external_session_id;
--   commit;
--
-- @see docs/adrs/ADR-028-prototype-share-cross-repo-upstream-wire.md
-- @see docs/integrations/cross-repo-webhook-v1.md §5A
-- @see docs/adrs/ADR-016-transport-level-webhook-ledger-pattern.md (transport ledger)
-- @see docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md (token semantics D2, D3)

begin;

-- ------------------------------------------------------------------------
-- Element 1: add columns to prototype_workspaces
-- ------------------------------------------------------------------------

alter table public.prototype_workspaces
  add column if not exists external_session_id text,
  add column if not exists v0_chat_id text,
  add column if not exists generated_html text,
  add column if not exists webhook_event_id uuid
    references public.website_webhook_events(id) on delete set null;

-- ------------------------------------------------------------------------
-- Element 2: indexes for resource dedup + replay-path FK-join
-- ------------------------------------------------------------------------

-- Resource-dedup index per ADR-028 D4 / §5A.3. PARTIAL because legacy rows
-- with NULL on either column would otherwise block any future row.
create unique index if not exists ux_prototype_workspaces_session_chat
  on public.prototype_workspaces (external_session_id, v0_chat_id)
  where external_session_id is not null
    and v0_chat_id is not null;

-- Replay-path FK-join index. Matches the partial-index pattern used for
-- `prototype_decisions.webhook_event_id` (migration 0060 element 4).
create index if not exists idx_prototype_workspaces_webhook_event_id
  on public.prototype_workspaces (webhook_event_id)
  where webhook_event_id is not null;

-- ------------------------------------------------------------------------
-- Element 3: extend website_webhook_events.endpoint CHECK constraint
-- ------------------------------------------------------------------------

-- Originally declared inline in migration 0051 line 7; extended in 0060
-- with 'prototype-decision'. Postgres auto-named the constraint
-- `website_webhook_events_endpoint_check`. Pattern mirrors 0060 element 5:
-- drop + recreate.
alter table public.website_webhook_events
  drop constraint if exists website_webhook_events_endpoint_check;

alter table public.website_webhook_events
  add constraint website_webhook_events_endpoint_check
  check (endpoint in (
    'inbound-proposal',
    'payment-confirmed',
    'prototype-decision',
    'prototype-share'
  ));

commit;
