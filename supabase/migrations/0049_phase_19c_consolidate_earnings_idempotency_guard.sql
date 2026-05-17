-- Phase 19c — Extra idempotency guard for consolidate_payment_earnings RPC
-- Surfaced during the Path C closure (2026-05-17): the legacy
-- `POST /api/admin/earnings/consolidate` endpoint (still in production
-- as a fallback) moves `wallet_accounts.pending → available_to_withdraw`
-- and inserts a consolidation ledger entry, but does NOT transition the
-- `seller_fees.state` from `confirmed` to `pending_payout`. If an admin
-- invokes the legacy endpoint and the cron runs 7+ days later on the
-- same payment, the cron's state-machine guard (state must be
-- `confirmed`) passes — but the wallet would be double-consolidated
-- because the original `pending` ledger entries remain in place.
--
-- This migration adds a second idempotency guard on
-- `consolidate_payment_earnings`: before transitioning state or moving
-- buckets, check whether a consolidation ledger entry already exists
-- for the payment. If yes, return no-op even if the state machine has
-- not been transitioned (it will get transitioned by the same RPC on
-- the next cron run since `confirmed` is still the source state).
--
-- This closes the latent double-consolidation hazard (roadmap §16 G15)
-- without requiring the legacy admin endpoint to be refactored or
-- deprecated in this iteration.

begin;

create or replace function public.consolidate_payment_earnings(
  p_payment_id uuid,
  p_actor_profile_id uuid default null
)
returns table (
  payment_id uuid,
  seller_fee_id uuid,
  prior_state public.seller_fee_state,
  new_state public.seller_fee_state,
  actors_consolidated int,
  amount_consolidated numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_fee_row public.seller_fees%rowtype;
  v_actor_row record;
  v_total_amount numeric(12,2) := 0;
  v_actor_count int := 0;
  v_now timestamptz := clock_timestamp();
  v_prior_consolidation_exists boolean := false;
begin
  if p_payment_id is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ID_REQUIRED';
  end if;

  -- Acquire lock on the seller_fees row associated with this payment.
  select * into v_seller_fee_row
  from public.seller_fees
  where payment_id = p_payment_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'SELLER_FEE_NOT_FOUND_FOR_PAYMENT';
  end if;

  -- Idempotency guard 1 (state machine): only `confirmed` proceeds.
  if v_seller_fee_row.state is distinct from 'confirmed' then
    return query select
      p_payment_id,
      v_seller_fee_row.id,
      v_seller_fee_row.state,
      v_seller_fee_row.state,
      0,
      0::numeric;
    return;
  end if;

  -- Idempotency guard 2 (ledger-based, NEW in 0049): a consolidation
  -- entry already exists for this payment. This catches the case where
  -- the legacy `POST /api/admin/earnings/consolidate` admin endpoint
  -- moved the wallet bucket without transitioning the state machine.
  -- Without this guard, the cron would double-consolidate.
  select exists(
    select 1
    from public.wallet_ledger_entries
    where reference_id = p_payment_id::text
      and reference_type = 'consolidation'
      and balance_bucket = 'available_to_withdraw'
      and status = 'confirmed'
  ) into v_prior_consolidation_exists;

  if v_prior_consolidation_exists then
    -- A previous consolidation occurred via another path. Transition
    -- the state machine to `pending_payout` for consistency, but skip
    -- the wallet bucket moves entirely.
    update public.seller_fees
    set
      state = 'pending_payout',
      pending_payout_at = v_now,
      updated_at = v_now
    where id = v_seller_fee_row.id;

    return query select
      p_payment_id,
      v_seller_fee_row.id,
      'confirmed'::public.seller_fee_state,
      'pending_payout'::public.seller_fee_state,
      0,
      0::numeric;
    return;
  end if;

  -- State machine transition: confirmed → pending_payout.
  update public.seller_fees
  set
    state = 'pending_payout',
    pending_payout_at = v_now,
    updated_at = v_now
  where id = v_seller_fee_row.id;

  -- Move pending → available_to_withdraw for each actor wallet.
  for v_actor_row in
    select profile_id, sum(amount) as bucket_amount
    from public.wallet_ledger_entries
    where reference_id = p_payment_id::text
      and reference_type = 'payment'
      and balance_bucket = 'pending'
      and status = 'confirmed'
      and entry_type = 'earnings_distribution'
    group by profile_id
  loop
    update public.wallet_accounts
    set
      pending = pending - v_actor_row.bucket_amount,
      available_to_withdraw = available_to_withdraw + v_actor_row.bucket_amount,
      updated_at = v_now
    where profile_id = v_actor_row.profile_id;

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
    ) values (
      v_actor_row.profile_id,
      v_actor_row.bucket_amount,
      'USD',
      'earnings_distribution',
      'available_to_withdraw',
      'confirmed',
      'consolidation',
      p_payment_id::text,
      p_actor_profile_id,
      jsonb_build_object(
        'consolidatedFrom', 'pending',
        'consolidatedAt', v_now,
        'paymentId', p_payment_id
      ),
      v_now
    );

    v_total_amount := v_total_amount + v_actor_row.bucket_amount;
    v_actor_count := v_actor_count + 1;
  end loop;

  return query select
    p_payment_id,
    v_seller_fee_row.id,
    'confirmed'::public.seller_fee_state,
    'pending_payout'::public.seller_fee_state,
    v_actor_count,
    v_total_amount;
end;
$$;

-- Permissions remain identical to 0048.
revoke execute on function public.consolidate_payment_earnings(uuid, uuid) from anon;
revoke execute on function public.consolidate_payment_earnings(uuid, uuid) from authenticated;
grant execute on function public.consolidate_payment_earnings(uuid, uuid) to service_role;

commit;
