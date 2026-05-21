-- 0056_phase_21d_consolidate_payment_earnings_ambiguity_fix.sql
--
-- HOTFIX: column reference "payment_id" is ambiguous in
-- consolidate_payment_earnings() body. Production cron run
-- 2026-05-21T00:41:00Z hit this on the first naturally eligible
-- payment (id=352754d4-b2b7-4faa-b52d-b88bf9788850), blocking real
-- earnings consolidation.
--
-- Root cause (latent since migration 0049 2026-05-17):
-- the function's RETURNS TABLE declares an OUT parameter named
-- `payment_id uuid`. Inside the function body, the bare reference
-- `payment_id` in `where payment_id = p_payment_id` (line 56 of 0049)
-- is ambiguous to Postgres — it could mean the OUT parameter or the
-- column on `public.seller_fees`. PG's runtime resolver rejects this
-- with `column reference "payment_id" is ambiguous` (errcode 42702).
--
-- The bug did NOT surface in unit tests (which mock the RPC) and did
-- NOT surface in earlier production runs because no payment had
-- crossed the 7-day cooling window since 0049 shipped 2026-05-17.
-- The 2026-05-21 daily cron run was the first natural exercise.
--
-- Fix: qualify the column reference with the table name
-- (`seller_fees.payment_id`), so Postgres can disambiguate from the
-- OUT parameter. The rest of the function body is preserved
-- byte-identical to 0049 — same idempotency guards, same actor loop,
-- same return shape.
--
-- ROLLBACK companion (DO NOT RUN unless reverting — would re-introduce
-- the ambiguity bug):
--   restore the 0049 function body verbatim with `where payment_id = p_payment_id`.
--
-- @see docs/adrs/ADR-015 (earnings consolidation lifecycle)
-- @see supabase/migrations/0048_phase_19b_consolidate_earnings_rpc.sql (original RPC)
-- @see supabase/migrations/0049_phase_19c_consolidate_earnings_idempotency_guard.sql
--      (latest version pre-this-fix)

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
  -- Column reference is fully qualified to disambiguate from the
  -- RETURNS TABLE OUT parameter `payment_id` — the 2026-05-21 fix.
  select * into v_seller_fee_row
  from public.seller_fees
  where seller_fees.payment_id = p_payment_id
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

  -- Idempotency guard 2 (ledger-based, introduced in 0049): a
  -- consolidation entry already exists for this payment. This catches
  -- the case where the legacy `POST /api/admin/earnings/consolidate`
  -- admin endpoint moved the wallet bucket without transitioning the
  -- state machine. Without this guard, the cron would double-consolidate.
  select exists(
    select 1
    from public.wallet_ledger_entries
    where reference_id = p_payment_id::text
      and reference_type = 'consolidation'
      and balance_bucket = 'available_to_withdraw'
      and status = 'confirmed'
  ) into v_prior_consolidation_exists;

  if v_prior_consolidation_exists then
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

commit;
