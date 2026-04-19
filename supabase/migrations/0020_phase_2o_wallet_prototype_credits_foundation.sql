begin;

create type public.wallet_entry_type as enum (
  'free_grant',
  'earnings_credit',
  'manual_adjustment',
  'prototype_request_debit',
  'prototype_continue_debit'
);

create type public.wallet_bucket as enum (
  'free',
  'earned'
);

create type public.prototype_stage as enum (
  'sales',
  'delivery'
);

create type public.prototype_workspace_status as enum (
  'pending_generation',
  'ready',
  'delivery_active',
  'archived'
);

create table public.prototype_credit_settings (
  singleton_key boolean primary key default true check (singleton_key = true),
  request_cost integer not null check (request_cost > 0),
  updated_by_profile_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_prototype_credit_settings_updated_at
before update on public.prototype_credit_settings
for each row
execute function public.set_updated_at();

create table public.user_wallets (
  profile_id uuid primary key references public.user_profiles(id) on delete cascade,
  free_credits_balance integer not null default 0 check (free_credits_balance >= 0),
  earned_credits_balance integer not null default 0 check (earned_credits_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_wallets_updated_at
before update on public.user_wallets
for each row
execute function public.set_updated_at();

create table public.prototype_workspaces (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  requested_by_profile_id uuid not null references public.user_profiles(id) on delete restrict,
  current_stage public.prototype_stage not null default 'sales',
  status public.prototype_workspace_status not null default 'pending_generation',
  last_operation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_prototype_workspaces_project_id
on public.prototype_workspaces(project_id);

create index idx_prototype_workspaces_requested_by_profile_id
on public.prototype_workspaces(requested_by_profile_id);

create index idx_prototype_workspaces_created_at
on public.prototype_workspaces(created_at desc);

create trigger trg_prototype_workspaces_updated_at
before update on public.prototype_workspaces
for each row
execute function public.set_updated_at();

create table public.user_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.user_profiles(id) on delete cascade,
  entry_type public.wallet_entry_type not null,
  bucket public.wallet_bucket not null,
  delta_credits integer not null check (delta_credits <> 0),
  operation_id uuid not null,
  actor_profile_id uuid references public.user_profiles(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  prototype_workspace_id uuid references public.prototype_workspaces(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_wallet_entries_prototype_reference check (
    (
      entry_type in ('prototype_request_debit', 'prototype_continue_debit')
      and lead_id is not null
      and prototype_workspace_id is not null
    )
    or entry_type not in ('prototype_request_debit', 'prototype_continue_debit')
  )
);

create index idx_user_wallet_entries_profile_created_at
on public.user_wallet_entries(profile_id, created_at desc);

create index idx_user_wallet_entries_operation_id
on public.user_wallet_entries(operation_id);

create index idx_user_wallet_entries_lead_id
on public.user_wallet_entries(lead_id);

create index idx_user_wallet_entries_prototype_workspace_id
on public.user_wallet_entries(prototype_workspace_id);

alter table public.prototype_credit_settings enable row level security;
alter table public.user_wallets enable row level security;
alter table public.prototype_workspaces enable row level security;
alter table public.user_wallet_entries enable row level security;

grant select on public.prototype_credit_settings to authenticated;
grant select on public.user_wallets to authenticated;
grant select on public.prototype_workspaces to authenticated;
grant select on public.user_wallet_entries to authenticated;

create policy "prototype_credit_settings_select_authenticated"
on public.prototype_credit_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
  )
);

create policy "user_wallets_select_self"
on public.user_wallets
for select
to authenticated
using (
  profile_id = auth.uid()
  and exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
  )
);

create policy "prototype_workspaces_select_visible_scope"
on public.prototype_workspaces
for select
to authenticated
using (
  requested_by_profile_id = auth.uid()
  or exists (
    select 1
    from public.leads visible_lead
    where visible_lead.id = prototype_workspaces.lead_id
  )
  or (
    prototype_workspaces.project_id is not null
    and exists (
      select 1
      from public.projects visible_project
      where visible_project.id = prototype_workspaces.project_id
    )
  )
);

create policy "user_wallet_entries_select_self"
on public.user_wallet_entries
for select
to authenticated
using (
  profile_id = auth.uid()
  and exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
  )
);

create or replace function public.ensure_current_user_wallet()
returns public.user_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_profile public.user_profiles%rowtype;
  wallet_row public.user_wallets%rowtype;
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

  insert into public.user_wallets (profile_id)
  values (current_user_id)
  on conflict (profile_id) do nothing;

  select *
  into wallet_row
  from public.user_wallets wallet
  where wallet.profile_id = current_user_id;

  return wallet_row;
end;
$$;

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
  current_user_id uuid := auth.uid();
  current_profile public.user_profiles%rowtype;
  target_lead public.leads%rowtype;
  wallet_row public.user_wallets%rowtype;
  configured_cost integer;
  existing_workspace_id uuid;
  next_workspace_id uuid;
  next_operation_id uuid := gen_random_uuid();
  free_to_consume integer := 0;
  earned_to_consume integer := 0;
  remaining_cost integer := 0;
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

  select settings.request_cost
  into configured_cost
  from public.prototype_credit_settings settings
  where settings.singleton_key = true;

  if configured_cost is null then
    raise exception using errcode = 'P0001', message = 'PROTOTYPE_REQUEST_NOT_CONFIGURED';
  end if;

  select workspace.id
  into existing_workspace_id
  from public.prototype_workspaces workspace
  where workspace.lead_id = target_lead_id
  limit 1;

  if existing_workspace_id is not null then
    raise exception using errcode = 'P0001', message = 'PROTOTYPE_WORKSPACE_EXISTS';
  end if;

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

  insert into public.prototype_workspaces (
    lead_id,
    requested_by_profile_id,
    current_stage,
    status,
    last_operation_id
  )
  values (
    target_lead_id,
    current_user_id,
    'sales',
    'pending_generation',
    next_operation_id
  )
  returning id into next_workspace_id;

  free_to_consume := least(wallet_row.free_credits_balance, configured_cost);
  remaining_cost := configured_cost - free_to_consume;
  earned_to_consume := least(wallet_row.earned_credits_balance, remaining_cost);

  update public.user_wallets wallet
  set
    free_credits_balance = wallet.free_credits_balance - free_to_consume,
    earned_credits_balance = wallet.earned_credits_balance - earned_to_consume,
    updated_at = clock_timestamp()
  where wallet.profile_id = current_user_id
  returning *
  into wallet_row;

  if free_to_consume > 0 then
    insert into public.user_wallet_entries (
      profile_id,
      entry_type,
      bucket,
      delta_credits,
      operation_id,
      actor_profile_id,
      lead_id,
      prototype_workspace_id,
      metadata,
      created_at
    )
    values (
      current_user_id,
      'prototype_request_debit',
      'free',
      free_to_consume * -1,
      next_operation_id,
      current_user_id,
      target_lead_id,
      next_workspace_id,
      jsonb_build_object(
        'leadName', target_lead.name,
        'requestCost', configured_cost,
        'stage', 'sales'
      ),
      clock_timestamp()
    );
  end if;

  if earned_to_consume > 0 then
    insert into public.user_wallet_entries (
      profile_id,
      entry_type,
      bucket,
      delta_credits,
      operation_id,
      actor_profile_id,
      lead_id,
      prototype_workspace_id,
      metadata,
      created_at
    )
    values (
      current_user_id,
      'prototype_request_debit',
      'earned',
      earned_to_consume * -1,
      next_operation_id,
      current_user_id,
      target_lead_id,
      next_workspace_id,
      jsonb_build_object(
        'leadName', target_lead.name,
        'requestCost', configured_cost,
        'stage', 'sales'
      ),
      clock_timestamp()
    );
  end if;

  return query
  select
    next_workspace_id,
    free_to_consume,
    earned_to_consume,
    wallet_row.free_credits_balance,
    wallet_row.earned_credits_balance;
end;
$$;

revoke all on function public.ensure_current_user_wallet() from public;
grant execute on function public.ensure_current_user_wallet() to authenticated;

revoke all on function public.request_lead_prototype(uuid) from public;
grant execute on function public.request_lead_prototype(uuid) to authenticated;

commit;
