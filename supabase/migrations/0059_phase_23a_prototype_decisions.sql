-- 0059_phase_23a_prototype_decisions.sql
--
-- Phase 23A (ADR-023 + ADR-025 implementation, B-slice):
-- Materializes the persistence layer for the cross-repo `prototype-decision`
-- webhook (NoonWeb → App) firmed by ADR-023 + cross-repo-webhook-v1.md §5.
-- C-slice (route + handler + Maxwell draft fire-and-forget) ships in the
-- same iteration; this migration is the data layer.
--
-- Six atomic elements per ADR-025 D3 (single-file migration per ADR-014):
--
--   1. Drop `prototype_workspaces.lead_id UNIQUE` constraint; replace with
--      non-unique index `idx_prototype_workspaces_lead_id`. Required because
--      Gate B regenerate (ADR-023 D3) issues V1 / V2 / V3 workspace rows
--      under the same lead. R1 grep pass (Backend 2026-05-25) confirmed one
--      semantic-refactor target — `getPrototypeWorkspaceByLeadId` in
--      `lib/server/prototypes/repository.ts` — refactored in the same PR.
--
--   2. Add `prototype_workspaces.share_token text` (App-issued opaque token
--      per ADR-023 D2) + backfill via `gen_random_uuid()::text` + final
--      state `text not null unique`. Add `share_token_superseded_at
--      timestamptz null` for state-driven invalidation per ADR-023 D3.
--
--   3. Add `prototype_credit_settings.max_iterations_per_lead integer not
--      null default 3 check (max_iterations_per_lead > 0)`. The Gate B cap
--      per ADR-023 D7 + ADR-025 D2 (lifetime cap, no status filter).
--
--   4. Create `public.prototype_decisions` table + 3 indexes per ADR-023 D4
--      + the partial index `idx_prototype_decisions_webhook_event_id` per
--      ADR-025 A1 (drives the FK-join replay path; keeps the ledger schema
--      generic per ADR-016 D9) + RLS policies mirroring `prototype_workspaces`
--      RLS scope verbatim (admin/sales_manager all; sales own; pm
--      lead-visible). No `authenticated` write policies — service_role
--      writes only via the C-slice webhook handler.
--
--   5. Extend `website_webhook_events.endpoint` CHECK constraint (originally
--      from migration 0051) to include `'prototype-decision'`.
--
--   6. Extend `user_notifications.source_kind` CHECK constraint (extended
--      most recently in migration 0055) to include
--      `'prototype_decision_received'` per OQ-3 resolution (Backend
--      2026-05-25). Cleanest semantic fit — the source IS a prototype
--      decision webhook, not a lead activity.
--
--   7. `create or replace function public.request_lead_prototype(uuid)`
--      with the dual-gate body per ADR-025 A2 (Gate B FIRST then Gate A;
--      no status filter on the cap predicate) + regenerate semantics
--      (mark prior workspace's `share_token_superseded_at = clock_timestamp()`
--      BEFORE inserting the new workspace; issue fresh `share_token` via
--      `gen_random_uuid()::text` on the new row). Bridge dual-write to
--      `wallet_accounts` + `wallet_ledger_entries` preserved verbatim from
--      migration 0025 (ADR-009 grandfather exception).
--
-- ROLLBACK companion (DO NOT RUN unless reverting):
--   begin;
--   -- Reverse element 7: restore the pre-regenerate RPC body. Caller must
--   --   copy from migration 0025 directly; the diff is structurally
--   --   significant (Gate B removed, regenerate semantics removed) and a
--   --   plain `drop function` would break grants.
--   --
--   -- Reverse element 6:
--   alter table public.user_notifications
--     drop constraint if exists user_notifications_source_kind_check;
--   alter table public.user_notifications
--     add constraint user_notifications_source_kind_check
--     check (source_kind in (
--       'lead_activity','task_activity','project_activity','proposal_review',
--       'project_sla_breach','webhook_failure'
--     ));
--   -- (Delete any 'prototype_decision_received' rows first or the CHECK fails.)
--   --
--   -- Reverse element 5:
--   alter table public.website_webhook_events
--     drop constraint if exists website_webhook_events_endpoint_check;
--   alter table public.website_webhook_events
--     add constraint website_webhook_events_endpoint_check
--     check (endpoint in ('inbound-proposal','payment-confirmed'));
--   --
--   -- Reverse element 4:
--   drop table if exists public.prototype_decisions;
--   --
--   -- Reverse element 3:
--   alter table public.prototype_credit_settings
--     drop column if exists max_iterations_per_lead;
--   --
--   -- Reverse element 2:
--   alter table public.prototype_workspaces
--     drop column if exists share_token_superseded_at;
--   alter table public.prototype_workspaces
--     drop column if exists share_token;
--   --
--   -- Reverse element 1: restore UNIQUE constraint (requires deduping any
--   --   rows that share a lead_id first; this is data-destructive in the
--   --   regenerate world).
--   drop index if exists public.idx_prototype_workspaces_lead_id;
--   alter table public.prototype_workspaces
--     add constraint prototype_workspaces_lead_id_key unique (lead_id);
--   commit;
--
-- @see docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md
-- @see docs/adrs/ADR-025-prototype-decision-impl-architecture-firmups.md
-- @see docs/integrations/cross-repo-webhook-v1.md §5
-- @see specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md

begin;

-- ------------------------------------------------------------------------
-- Element 1: drop `prototype_workspaces.lead_id` UNIQUE; add non-unique index
-- ------------------------------------------------------------------------

-- The UNIQUE constraint was declared inline as `lead_id uuid not null unique
-- references ...` in migration 0020 line 56. Postgres auto-names that to
-- `prototype_workspaces_lead_id_key`.
alter table public.prototype_workspaces
  drop constraint if exists prototype_workspaces_lead_id_key;

create index if not exists idx_prototype_workspaces_lead_id
  on public.prototype_workspaces(lead_id);

-- ------------------------------------------------------------------------
-- Element 2: add share_token + share_token_superseded_at
-- ------------------------------------------------------------------------

alter table public.prototype_workspaces
  add column if not exists share_token text,
  add column if not exists share_token_superseded_at timestamptz;

-- Backfill share_token for any pre-existing rows. `gen_random_uuid()::text`
-- per ADR-023 D2 (App-issued opaque) and spec A-6 (UUID-v4 entropy is
-- sufficient for V1; rotation hardening is a future iteration trigger).
update public.prototype_workspaces
   set share_token = gen_random_uuid()::text
 where share_token is null;

alter table public.prototype_workspaces
  alter column share_token set not null;

-- Final-state UNIQUE on share_token (token lookup is the authoritative
-- resolution per ADR-023 D2; uniqueness is load-bearing).
alter table public.prototype_workspaces
  add constraint prototype_workspaces_share_token_key unique (share_token);

-- ------------------------------------------------------------------------
-- Element 3: add prototype_credit_settings.max_iterations_per_lead
-- ------------------------------------------------------------------------

alter table public.prototype_credit_settings
  add column if not exists max_iterations_per_lead integer not null default 3
    check (max_iterations_per_lead > 0);

-- ------------------------------------------------------------------------
-- Element 4: prototype_decisions table + indexes + RLS
-- ------------------------------------------------------------------------

create table if not exists public.prototype_decisions (
  id uuid primary key default gen_random_uuid(),
  prototype_workspace_id uuid not null
    references public.prototype_workspaces(id) on delete cascade,
  lead_id uuid not null
    references public.leads(id) on delete cascade,
  decision text not null check (decision in ('accepted', 'rejected')),
  notes text,
  client_user_agent text,
  webhook_event_id uuid
    references public.website_webhook_events(id) on delete set null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Indexes per ADR-023 D4 lines 108-117.
create index if not exists idx_prototype_decisions_workspace
  on public.prototype_decisions(prototype_workspace_id);

create index if not exists idx_prototype_decisions_lead
  on public.prototype_decisions(lead_id);

create index if not exists idx_prototype_decisions_decided_at
  on public.prototype_decisions(decided_at desc);

-- One terminal decision per workspace (accepted OR rejected, not both, not
-- twice) — ADR-023 D4 line 116-117.
create unique index if not exists ux_prototype_decisions_workspace_one_terminal
  on public.prototype_decisions(prototype_workspace_id);

-- Partial index for the FK-join replay path per ADR-025 A1 / D1. Partial
-- because `webhook_event_id` is nullable (FK on delete set null).
create index if not exists idx_prototype_decisions_webhook_event_id
  on public.prototype_decisions(webhook_event_id)
  where webhook_event_id is not null;

-- RLS. Mirror `prototype_workspaces_select_visible_scope` (migration 0020
-- line 151-170) policy intent verbatim. Service-role writes only (no
-- authenticated INSERT/UPDATE/DELETE policy granted).
alter table public.prototype_decisions enable row level security;

grant select on public.prototype_decisions to authenticated;

drop policy if exists "prototype_decisions_select_visible_scope" on public.prototype_decisions;
create policy "prototype_decisions_select_visible_scope"
on public.prototype_decisions
for select
to authenticated
using (
  -- Reuse workspace visibility — a row is visible if its parent workspace
  -- is visible under the existing prototype_workspaces RLS policy.
  exists (
    select 1
    from public.prototype_workspaces workspace
    where workspace.id = prototype_decisions.prototype_workspace_id
      and (
        workspace.requested_by_profile_id = auth.uid()
        or exists (
          select 1
          from public.leads visible_lead
          where visible_lead.id = workspace.lead_id
        )
        or (
          workspace.project_id is not null
          and exists (
            select 1
            from public.projects visible_project
            where visible_project.id = workspace.project_id
          )
        )
      )
  )
);

-- ------------------------------------------------------------------------
-- Element 5: extend website_webhook_events.endpoint CHECK
-- ------------------------------------------------------------------------

-- The CHECK was declared inline in migration 0051 line 7. Postgres
-- auto-names that to `website_webhook_events_endpoint_check`.
alter table public.website_webhook_events
  drop constraint if exists website_webhook_events_endpoint_check;

alter table public.website_webhook_events
  add constraint website_webhook_events_endpoint_check
  check (endpoint in ('inbound-proposal', 'payment-confirmed', 'prototype-decision'));

-- ------------------------------------------------------------------------
-- Element 6: extend user_notifications.source_kind CHECK (OQ-3 resolution)
-- ------------------------------------------------------------------------

-- DROP-and-ADD pattern from migration 0055 (Postgres requires explicit
-- replacement to change a CHECK definition).
alter table public.user_notifications
  drop constraint if exists user_notifications_source_kind_check;

alter table public.user_notifications
  add constraint user_notifications_source_kind_check
  check (source_kind in (
    'lead_activity',
    'task_activity',
    'project_activity',
    'proposal_review',
    'project_sla_breach',
    'webhook_failure',
    'prototype_decision_received'
  ));

-- ------------------------------------------------------------------------
-- Element 7: rewrite request_lead_prototype(uuid) with dual-gate + regen
-- ------------------------------------------------------------------------
--
-- Changes vs migration 0025:
--   - Removed `PROTOTYPE_WORKSPACE_EXISTS` short-circuit. Multiple
--     workspaces per lead are legal under ADR-023 D3 (regenerate).
--   - Added Gate B (iteration cap) per ADR-025 D2. Evaluated FIRST per
--     ADR-025 A2 (before Gate A so a cap-exceeded request does not
--     deduct credits).
--   - On regenerate, mark the prior workspace's
--     `share_token_superseded_at = clock_timestamp()` BEFORE inserting
--     the new workspace, per ADR-023 D3 + ADR-025 A1.
--   - Issue fresh `share_token` on the new workspace via
--     `gen_random_uuid()::text` per ADR-023 D2.
--   - Gate A semantics preserved verbatim (`INSUFFICIENT_CREDITS`).
--   - Bridge dual-write to wallet_accounts + wallet_ledger_entries
--     preserved verbatim from 0025 (ADR-009 grandfathered exception).

create or replace function public.request_lead_prototype(target_lead_id uuid)
returns table (
  prototype_workspace_id uuid,
  consumed_free integer,
  consumed_earned integer,
  free_balance integer,
  earned_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id     uuid := auth.uid();
  current_profile     public.user_profiles%rowtype;
  target_lead         public.leads%rowtype;
  wallet_row          public.user_wallets%rowtype;
  monetary_account    public.wallet_accounts%rowtype;
  configured_cost     integer;
  max_iterations      integer;
  workspace_count     integer;
  next_workspace_id   uuid;
  next_share_token    text := gen_random_uuid()::text;
  next_operation_id   uuid := gen_random_uuid();
  free_to_consume     integer := 0;
  earned_to_consume   integer := 0;
  remaining_cost      integer := 0;
  monetary_debit      numeric(12,2) := 0;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select *
    into current_profile
    from public.user_profiles profile
   where profile.id = current_user_id
     and profile.is_active = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if current_profile.role not in ('admin', 'sales_manager', 'sales') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select *
    into target_lead
    from public.leads lead
   where lead.id = target_lead_id
     and (
       current_profile.role in ('admin', 'sales_manager')
       or (
         current_profile.role = 'sales'
         and (
           lead.assigned_to = current_user_id
           or (
             lead.created_by = current_user_id
             and lead.assigned_to is null
             and lead.assignment_status <> 'released_no_response'
           )
         )
       )
     );

  if not found then
    raise exception using errcode = 'P0001', message = 'LEAD_NOT_FOUND';
  end if;

  select settings.request_cost,
         coalesce(settings.max_iterations_per_lead, 3)
    into configured_cost, max_iterations
    from public.prototype_credit_settings settings
   where settings.singleton_key = true;

  if configured_cost is null then
    raise exception using errcode = 'P0001', message = 'PROTOTYPE_REQUEST_NOT_CONFIGURED';
  end if;

  -- Gate B (lifetime cap) — evaluated FIRST per ADR-025 A2.
  -- No status filter per ADR-025 D2 / D2 forbidden rule.
  select count(*)
    into workspace_count
    from public.prototype_workspaces
   where lead_id = target_lead_id;

  if workspace_count >= max_iterations then
    raise exception using errcode = 'P0001', message = 'ITERATION_CAP_REACHED';
  end if;

  -- Gate A (credits) — ensure wallet, lock row, check sufficiency.
  insert into public.user_wallets (profile_id)
    values (current_user_id)
    on conflict (profile_id) do nothing;

  select *
    into wallet_row
    from public.user_wallets wallet
   where wallet.profile_id = current_user_id
     for update;

  if (wallet_row.free_credits_balance + wallet_row.earned_credits_balance) < configured_cost then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_CREDITS';
  end if;

  -- Regenerate semantics per ADR-023 D3 + ADR-025 A1:
  -- Supersede the share token of every prior non-superseded workspace under
  -- this lead. There is always at most one current (non-superseded) row by
  -- construction (this RPC is the only writer of share_token_superseded_at
  -- via supersede; ADR-023 D3 forbids any other supersede source).
  update public.prototype_workspaces
     set share_token_superseded_at = clock_timestamp(),
         updated_at                = clock_timestamp()
   where lead_id = target_lead_id
     and share_token_superseded_at is null;

  -- Create the new workspace with a fresh share_token.
  insert into public.prototype_workspaces (
    lead_id,
    requested_by_profile_id,
    current_stage,
    status,
    last_operation_id,
    share_token
  )
  values (
    target_lead_id,
    current_user_id,
    'sales',
    'pending_generation',
    next_operation_id,
    next_share_token
  )
  returning id into next_workspace_id;

  -- Compute credit consumption (free first, earned for remainder).
  free_to_consume    := least(wallet_row.free_credits_balance, configured_cost);
  remaining_cost     := configured_cost - free_to_consume;
  earned_to_consume  := least(wallet_row.earned_credits_balance, remaining_cost);
  monetary_debit     := configured_cost::numeric(12,2);

  -- Debit the credit wallet (legacy bucket model — kept for backward
  -- compatibility per ADR-009; the bridge dual-write below is the canonical
  -- record from FASE 2 onward).
  update public.user_wallets wallet
     set free_credits_balance   = wallet.free_credits_balance - free_to_consume,
         earned_credits_balance = wallet.earned_credits_balance - earned_to_consume,
         updated_at             = clock_timestamp()
   where wallet.profile_id = current_user_id
   returning *
     into wallet_row;

  -- Original-form ledger entries on user_wallet_entries.
  if free_to_consume > 0 then
    insert into public.user_wallet_entries (
      profile_id, entry_type, bucket, delta_credits, operation_id,
      actor_profile_id, lead_id, prototype_workspace_id, metadata, created_at
    )
    values (
      current_user_id, 'prototype_request_debit', 'free', free_to_consume * -1,
      next_operation_id, current_user_id, target_lead_id, next_workspace_id,
      jsonb_build_object('leadName', target_lead.name, 'requestCost', configured_cost, 'stage', 'sales'),
      clock_timestamp()
    );
  end if;

  if earned_to_consume > 0 then
    insert into public.user_wallet_entries (
      profile_id, entry_type, bucket, delta_credits, operation_id,
      actor_profile_id, lead_id, prototype_workspace_id, metadata, created_at
    )
    values (
      current_user_id, 'prototype_request_debit', 'earned', earned_to_consume * -1,
      next_operation_id, current_user_id, target_lead_id, next_workspace_id,
      jsonb_build_object('leadName', target_lead.name, 'requestCost', configured_cost, 'stage', 'sales'),
      clock_timestamp()
    );
  end if;

  -- Bridge: debit wallet_accounts.available_to_spend and record in
  -- wallet_ledger_entries per ADR-009 grandfather exception.
  insert into public.wallet_accounts (profile_id, available_to_spend)
    values (current_user_id, 0)
    on conflict (profile_id) do nothing;

  update public.wallet_accounts
     set available_to_spend = greatest(0, available_to_spend - monetary_debit),
         updated_at         = clock_timestamp()
   where profile_id = current_user_id
   returning *
     into monetary_account;

  insert into public.wallet_ledger_entries (
    profile_id, amount, currency, entry_type, balance_bucket, status,
    reference_type, reference_id, actor_profile_id, metadata, created_at
  )
  values (
    current_user_id,
    monetary_debit * -1,
    'USD',
    'service_debit',
    'available_to_spend',
    'confirmed',
    'prototype_workspace',
    next_workspace_id,
    current_user_id,
    jsonb_build_object(
      'leadId',      target_lead_id,
      'leadName',    target_lead.name,
      'requestCost', configured_cost,
      'operationId', next_operation_id
    ),
    clock_timestamp()
  );

  return query
  select
    next_workspace_id,
    free_to_consume,
    earned_to_consume,
    wallet_row.free_credits_balance,
    wallet_row.earned_credits_balance;
end;
$$;

-- Grants preserved verbatim from migration 0020 / 0025 / 0039.
revoke all on function public.request_lead_prototype(uuid) from public, anon;
grant execute on function public.request_lead_prototype(uuid) to authenticated;

commit;
