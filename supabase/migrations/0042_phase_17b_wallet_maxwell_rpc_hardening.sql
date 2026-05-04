-- Phase 17B: harden low-coupling RPCs behind server-side service_role calls.
-- This slice intentionally does not touch proposal review, lead claim/release,
-- prototype request, prototype handoff, or project linkage RPCs.

create or replace function public.ensure_user_wallet_for_profile(p_profile_id uuid)
returns public.user_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_row public.user_wallets%rowtype;
begin
  if p_profile_id is null then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_profile_id
      and profile.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  insert into public.user_wallets (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select *
  into wallet_row
  from public.user_wallets wallet
  where wallet.profile_id = p_profile_id;

  return wallet_row;
end;
$$;

create or replace function public.ensure_monetary_wallet_for_profile(p_profile_id uuid)
returns public.wallet_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  credits_balance numeric(12,2) := 0;
  account_row public.wallet_accounts%rowtype;
begin
  if p_profile_id is null then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.user_profiles profile
    where profile.id = p_profile_id
      and profile.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.wallet_accounts account
    where account.profile_id = p_profile_id
  ) then
    select (coalesce(free_credits_balance, 0) + coalesce(earned_credits_balance, 0))::numeric(12,2)
    into credits_balance
    from public.user_wallets
    where profile_id = p_profile_id;

    credits_balance := coalesce(credits_balance, 0);

    insert into public.wallet_accounts (profile_id, available_to_spend)
    values (p_profile_id, credits_balance)
    on conflict (profile_id) do nothing;
  end if;

  select *
  into account_row
  from public.wallet_accounts account
  where account.profile_id = p_profile_id;

  return account_row;
end;
$$;

revoke all on function public.ensure_user_wallet_for_profile(uuid) from public, anon, authenticated;
revoke all on function public.ensure_monetary_wallet_for_profile(uuid) from public, anon, authenticated;
grant execute on function public.ensure_user_wallet_for_profile(uuid) to service_role;
grant execute on function public.ensure_monetary_wallet_for_profile(uuid) to service_role;

revoke all on function public.ensure_current_user_wallet() from public, anon, authenticated;
revoke all on function public.ensure_monetary_wallet() from public, anon, authenticated;
revoke all on function public.maxwell_confirmed_sales_count(uuid) from public, anon, authenticated;
grant execute on function public.maxwell_confirmed_sales_count(uuid) to service_role;
