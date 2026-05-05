begin;

-- Función: admin_credit_earnings
-- Admin o PM acredita ganancias manualmente a un usuario.
-- Las ganancias van primero a `pending`. Deben ser consolidadas
-- explícitamente a `available_to_withdraw` tras validación.
create or replace function public.admin_credit_earnings(
  target_profile_id  uuid,
  credit_amount      numeric(12,2),
  earning_type       text,  -- 'activation' | 'membership' | 'milestone' | 'manual'
  channel            text,  -- 'inbound' | 'outbound' | null
  p_reference_type   text   default null,
  p_reference_id     uuid   default null,
  p_notes            text   default null
)
returns public.wallet_ledger_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id      uuid := auth.uid();
  caller_profile public.user_profiles%rowtype;
  target_profile public.user_profiles%rowtype;
  entry_row      public.wallet_ledger_entries%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select * into caller_profile
  from public.user_profiles p
  where p.id = caller_id and p.is_active = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if caller_profile.role not in ('admin', 'pm') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if credit_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_AMOUNT';
  end if;

  if earning_type not in ('activation', 'membership', 'milestone', 'manual') then
    raise exception using errcode = 'P0001', message = 'INVALID_EARNING_TYPE';
  end if;

  select * into target_profile
  from public.user_profiles p
  where p.id = target_profile_id and p.is_active = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'TARGET_PROFILE_NOT_FOUND';
  end if;

  -- Crear wallet monetaria del usuario destino si no existe
  insert into public.wallet_accounts (profile_id)
  values (target_profile_id)
  on conflict (profile_id) do nothing;

  -- Acreditar en bucket `pending` (no retirable hasta consolidación)
  update public.wallet_accounts
  set
    pending    = pending + credit_amount,
    updated_at = clock_timestamp()
  where profile_id = target_profile_id;

  -- Registrar en ledger monetario
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
    target_profile_id,
    credit_amount,
    'USD',
    'earnings_distribution',
    'pending',
    'confirmed',
    p_reference_type,
    p_reference_id,
    caller_id,
    jsonb_build_object(
      'earningType', earning_type,
      'channel',     channel,
      'notes',       p_notes,
      'creditedBy',  caller_profile.full_name
    ),
    clock_timestamp()
  )
  returning * into entry_row;

  return entry_row;
end;
$$;

revoke all on function public.admin_credit_earnings(uuid, numeric, text, text, text, uuid, text) from public;
grant execute on function public.admin_credit_earnings(uuid, numeric, text, text, text, uuid, text) to authenticated;

-- Función: consolidate_pending_earnings
-- Admin mueve saldo de `pending` a `available_to_withdraw` tras validación.
create or replace function public.consolidate_pending_earnings(
  target_profile_id uuid,
  consolidate_amount numeric(12,2)
)
returns public.wallet_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id    uuid := auth.uid();
  caller_role  text;
  account_row  public.wallet_accounts%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select role into caller_role
  from public.user_profiles
  where id = caller_id and is_active = true;

  if caller_role not in ('admin') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if consolidate_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_AMOUNT';
  end if;

  select * into account_row
  from public.wallet_accounts
  where profile_id = target_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WALLET_NOT_FOUND';
  end if;

  if account_row.pending < consolidate_amount then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_PENDING';
  end if;

  update public.wallet_accounts
  set
    pending               = pending - consolidate_amount,
    available_to_withdraw = available_to_withdraw + consolidate_amount,
    updated_at            = clock_timestamp()
  where profile_id = target_profile_id
  returning * into account_row;

  -- Registrar movimiento en ledger
  insert into public.wallet_ledger_entries (
    profile_id, amount, currency, entry_type, balance_bucket, status,
    reference_type, actor_profile_id, metadata, created_at
  )
  values (
    target_profile_id, consolidate_amount, 'USD',
    'earnings_distribution', 'available_to_withdraw', 'confirmed',
    'consolidation', caller_id,
    jsonb_build_object('consolidatedFrom', 'pending'),
    clock_timestamp()
  );

  return account_row;
end;
$$;

revoke all on function public.consolidate_pending_earnings(uuid, numeric) from public;
grant execute on function public.consolidate_pending_earnings(uuid, numeric) to authenticated;

-- Índice para filtrar earnings_distribution eficientemente
create index if not exists idx_wallet_ledger_entries_entry_type
on public.wallet_ledger_entries(profile_id, entry_type, created_at desc);

commit;
