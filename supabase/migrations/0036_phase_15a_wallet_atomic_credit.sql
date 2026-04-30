begin;

alter table public.earnings_ledger
add column if not exists idempotency_key text;

alter table public.points_ledger
add column if not exists idempotency_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'earnings_ledger_idempotency_key_unique'
      and conrelid = 'public.earnings_ledger'::regclass
  ) then
    alter table public.earnings_ledger
    add constraint earnings_ledger_idempotency_key_unique unique (idempotency_key);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'points_ledger_idempotency_key_unique'
      and conrelid = 'public.points_ledger'::regclass
  ) then
    alter table public.points_ledger
    add constraint points_ledger_idempotency_key_unique unique (idempotency_key);
  end if;
end;
$$;

create unique index if not exists wallet_ledger_entries_idempotency_key_unique
on public.wallet_ledger_entries ((metadata ->> 'idempotencyKey'))
where metadata ? 'idempotencyKey';

create or replace function public.credit_wallet_bucket(
  p_profile_id uuid,
  p_amount numeric,
  p_currency text,
  p_entry_type public.monetary_entry_type,
  p_balance_bucket text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_actor_profile_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_created_at timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_currency char(3) := upper(left(coalesce(nullif(trim(p_currency), ''), 'USD'), 3))::char(3);
  next_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  ledger_entry_id uuid;
begin
  if p_profile_id is null then
    raise exception using errcode = 'P0001', message = 'PROFILE_REQUIRED';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'AMOUNT_MUST_BE_POSITIVE';
  end if;

  if p_balance_bucket not in ('available_to_spend', 'available_to_withdraw', 'pending', 'locked') then
    raise exception using errcode = 'P0001', message = 'INVALID_WALLET_BUCKET';
  end if;

  if not exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_profile_id
      and profile.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    next_metadata := next_metadata || jsonb_build_object('idempotencyKey', p_idempotency_key);
  end if;

  insert into public.wallet_accounts (profile_id, currency)
  values (p_profile_id, normalized_currency)
  on conflict (profile_id) do nothing;

  insert into public.wallet_ledger_entries (
    profile_id,
    amount,
    currency,
    entry_type,
    balance_bucket,
    status,
    reference_type,
    reference_id,
    actor_profile_id,
    metadata,
    created_at
  )
  values (
    p_profile_id,
    round(p_amount, 2),
    normalized_currency,
    p_entry_type,
    p_balance_bucket,
    'confirmed',
    p_reference_type,
    p_reference_id,
    p_actor_profile_id,
    next_metadata,
    p_created_at
  )
  on conflict do nothing
  returning id into ledger_entry_id;

  if ledger_entry_id is null then
    return false;
  end if;

  update public.wallet_accounts
  set
    available_to_spend = case
      when p_balance_bucket = 'available_to_spend' then available_to_spend + round(p_amount, 2)
      else available_to_spend
    end,
    available_to_withdraw = case
      when p_balance_bucket = 'available_to_withdraw' then available_to_withdraw + round(p_amount, 2)
      else available_to_withdraw
    end,
    pending = case
      when p_balance_bucket = 'pending' then pending + round(p_amount, 2)
      else pending
    end,
    locked = case
      when p_balance_bucket = 'locked' then locked + round(p_amount, 2)
      else locked
    end,
    updated_at = clock_timestamp()
  where profile_id = p_profile_id;

  return true;
end;
$$;

revoke all on function public.credit_wallet_bucket(
  uuid,
  numeric,
  text,
  public.monetary_entry_type,
  text,
  text,
  uuid,
  uuid,
  jsonb,
  text,
  timestamptz
) from public;

grant execute on function public.credit_wallet_bucket(
  uuid,
  numeric,
  text,
  public.monetary_entry_type,
  text,
  text,
  uuid,
  uuid,
  jsonb,
  text,
  timestamptz
) to service_role;

commit;
