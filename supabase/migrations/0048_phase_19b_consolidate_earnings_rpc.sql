-- Phase 19b — Earnings consolidation atomic RPC
-- Implements the atomic consolidation operation defined in ADR-015 and
-- scoped by specs/fase-3-earnings-lifecycle.md.
--
-- The function `consolidate_payment_earnings(p_payment_id, p_actor_profile_id)`
-- transitions the seller_fees state machine (confirmed → pending_payout) and
-- moves all actor wallet entries for that payment from the `pending` bucket
-- to `available_to_withdraw` inside a single Postgres transaction with
-- `SELECT FOR UPDATE` row locking on the seller_fees row.
--
-- Idempotency: re-invocation on an already-consolidated payment is a no-op
-- — the function returns the current state and zero actors consolidated.
-- Race protection: concurrent invocations (e.g., cron + manual admin) and
-- concurrent refunds (`handleChargeRefunded`) are serialized via the row
-- lock on seller_fees, preventing partial / overlapping state transitions.
--
-- See ADR-015 §Implementation contract for the canonical spec of behavior.

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
begin
  if p_payment_id is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ID_REQUIRED';
  end if;

  -- Acquire lock on the seller_fees row associated with this payment.
  -- Any concurrent transaction touching the same seller_fees row (refund
  -- handler, manual admin invocation) blocks until we commit.
  select * into v_seller_fee_row
  from public.seller_fees
  where payment_id = p_payment_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'SELLER_FEE_NOT_FOUND_FOR_PAYMENT';
  end if;

  -- Idempotency guard: only `confirmed` transitions to `pending_payout`.
  -- States `potential`, `pending_payout`, `paid_out`, `cancelled` are
  -- treated as no-ops (already processed or in an unexpected lifecycle
  -- branch — refund cancellation, prior consolidation, etc.).
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

  -- State machine transition: confirmed → pending_payout.
  update public.seller_fees
  set
    state = 'pending_payout',
    pending_payout_at = v_now,
    updated_at = v_now
  where id = v_seller_fee_row.id;

  -- For each actor (seller, optionally developer) with a pending-bucket
  -- credit tied to this payment, move the funds to available_to_withdraw
  -- and append the audit-pair ledger entry.
  --
  -- Excludes `actor_id = null` rows (noon share has no wallet target).
  -- Excludes any ledger row already with status != 'confirmed'
  -- (defense-in-depth: prevents consolidating refunded or cancelled rows).
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
    -- Move bucket totals on wallet_accounts.
    update public.wallet_accounts
    set
      pending = pending - v_actor_row.bucket_amount,
      available_to_withdraw = available_to_withdraw + v_actor_row.bucket_amount,
      updated_at = v_now
    where profile_id = v_actor_row.profile_id;

    -- Append the audit ledger entry recording the consolidation.
    -- Pairs with the original `pending` credit by sharing the same
    -- reference_id (payment uuid). The metadata captures the transition
    -- direction and timestamp for downstream auditing.
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

-- Restrict execution: only service_role (admin client) may invoke. Anon /
-- authenticated cannot call this function directly even via PostgREST.
revoke execute on function public.consolidate_payment_earnings(uuid, uuid) from anon;
revoke execute on function public.consolidate_payment_earnings(uuid, uuid) from authenticated;
grant execute on function public.consolidate_payment_earnings(uuid, uuid) to service_role;

commit;
