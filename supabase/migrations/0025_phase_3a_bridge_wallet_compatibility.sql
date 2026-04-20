begin;

-- Actualiza ensure_monetary_wallet para sembrar available_to_spend desde créditos existentes
-- Conversión del bridge: 1 crédito = $1.00 USD (temporal hasta Fase 2)
create or replace function public.ensure_monetary_wallet()
returns public.wallet_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  credits_balance  numeric(12,2) := 0;
  account_row      public.wallet_accounts%rowtype;
  is_new_wallet    boolean := false;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.user_profiles p
    where p.id = current_user_id and p.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  -- Verificar si el wallet monetario ya existe
  if not exists (select 1 from public.wallet_accounts where profile_id = current_user_id) then
    is_new_wallet := true;

    -- Leer créditos existentes para sembrar available_to_spend
    select (coalesce(free_credits_balance, 0) + coalesce(earned_credits_balance, 0))::numeric(12,2)
    into credits_balance
    from public.user_wallets
    where profile_id = current_user_id;

    credits_balance := coalesce(credits_balance, 0);

    insert into public.wallet_accounts (profile_id, available_to_spend)
    values (current_user_id, credits_balance)
    on conflict (profile_id) do nothing;
  end if;

  select * into account_row
  from public.wallet_accounts
  where profile_id = current_user_id;

  return account_row;
end;
$$;

-- Sembrar wallet_accounts para todos los usuarios existentes que ya tienen user_wallets
-- y cuyo wallet_accounts.available_to_spend sigue en 0 (creados antes del bridge)
update public.wallet_accounts wa
set
  available_to_spend = (
    select (coalesce(uw.free_credits_balance, 0) + coalesce(uw.earned_credits_balance, 0))::numeric(12,2)
    from public.user_wallets uw
    where uw.profile_id = wa.profile_id
  ),
  updated_at = now()
where wa.available_to_spend = 0
  and exists (
    select 1 from public.user_wallets uw
    where uw.profile_id = wa.profile_id
      and (uw.free_credits_balance + uw.earned_credits_balance) > 0
  );

-- Actualiza request_lead_prototype para también debitar wallet_accounts y registrar en wallet_ledger_entries
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
  current_user_id    uuid := auth.uid();
  current_profile    public.user_profiles%rowtype;
  target_lead        public.leads%rowtype;
  wallet_row         public.user_wallets%rowtype;
  monetary_account   public.wallet_accounts%rowtype;
  configured_cost    integer;
  existing_workspace_id uuid;
  next_workspace_id  uuid;
  next_operation_id  uuid := gen_random_uuid();
  free_to_consume    integer := 0;
  earned_to_consume  integer := 0;
  remaining_cost     integer := 0;
  monetary_debit     numeric(12,2) := 0;
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

  -- Asegurar wallet de créditos
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

  -- Crear workspace
  insert into public.prototype_workspaces (
    lead_id, requested_by_profile_id, current_stage, status, last_operation_id
  )
  values (target_lead_id, current_user_id, 'sales', 'pending_generation', next_operation_id)
  returning id into next_workspace_id;

  -- Calcular consumo de créditos
  free_to_consume    := least(wallet_row.free_credits_balance, configured_cost);
  remaining_cost     := configured_cost - free_to_consume;
  earned_to_consume  := least(wallet_row.earned_credits_balance, remaining_cost);
  monetary_debit     := configured_cost::numeric(12,2);

  -- Debitar wallet de créditos (sistema original — se mantiene intacto)
  update public.user_wallets wallet
  set
    free_credits_balance   = wallet.free_credits_balance - free_to_consume,
    earned_credits_balance = wallet.earned_credits_balance - earned_to_consume,
    updated_at             = clock_timestamp()
  where wallet.profile_id = current_user_id
  returning * into wallet_row;

  -- Registros originales en user_wallet_entries
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

  -- Bridge: debitar wallet_accounts.available_to_spend y registrar en wallet_ledger_entries
  insert into public.wallet_accounts (profile_id, available_to_spend)
  values (current_user_id, 0)
  on conflict (profile_id) do nothing;

  update public.wallet_accounts
  set
    available_to_spend = greatest(0, available_to_spend - monetary_debit),
    updated_at         = clock_timestamp()
  where profile_id = current_user_id
  returning * into monetary_account;

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
      'leadId',        target_lead_id,
      'leadName',      target_lead.name,
      'requestCost',   configured_cost,
      'operationId',   next_operation_id
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

revoke all on function public.ensure_monetary_wallet() from public;
grant execute on function public.ensure_monetary_wallet() to authenticated;

revoke all on function public.request_lead_prototype(uuid) from public;
grant execute on function public.request_lead_prototype(uuid) to authenticated;

commit;
