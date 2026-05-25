-- Phase 19d — Wallet reversal RPC for refund flow (Path G, closes G14)
--
-- Implements the atomic wallet reversal triggered by Stripe refund
-- webhooks. Per ADR-015 §Consequences §Refund-after-consolidation, the
-- existing refund handler (`handleChargeRefunded` in the Stripe webhook)
-- reverses payment + project + seller_fees + earnings_ledger but does
-- NOT touch wallet_accounts — leaving the seller's `pending` or
-- `available_to_withdraw` bucket inflated after refund. Path G closes
-- that gap.
--
-- The RPC `debit_wallet_for_refund(p_payment_id, p_actor_profile_id)`
-- detects which bucket currently holds each actor's credit:
--   - If a `consolidation` entry exists for the payment, the credit
--     was already moved to `available_to_withdraw` — debit that bucket.
--   - Otherwise, the credit is still in `pending` — debit that bucket.
--
-- Idempotent via a guard on a prior `service_debit + refund` entry for
-- the same payment. Atomic via implicit Postgres transaction. The
-- seller_fees state machine transition to `cancelled` is handled by
-- the caller (handleChargeRefunded) — this RPC only touches the wallet
-- side.
--
-- Caso C (post-payout refund): if the seller's earnings were already
-- transferred via Stripe Connect (`seller_fees.state = 'paid_out'`),
-- the funds are no longer in any wallet bucket (they were locked then
-- transferred). This RPC skips actors whose ledger entries indicate
-- they were already paid out and surfaces the count in
-- `actors_skipped` for downstream alerting / manual reconciliation.

begin;

create or replace function public.debit_wallet_for_refund(
  p_payment_id uuid,
  p_actor_profile_id uuid default null
)
returns table (
  payment_id uuid,
  actors_debited int,
  actors_skipped_already_paid_out int,
  amount_debited numeric,
  bucket_used text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_row record;
  v_total_amount numeric(12,2) := 0;
  v_actor_count int := 0;
  v_skipped_count int := 0;
  v_now timestamptz := clock_timestamp();
  v_prior_refund_exists boolean := false;
  v_post_consolidation boolean := false;
  v_bucket text;
begin
  if p_payment_id is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_ID_REQUIRED';
  end if;

  -- Idempotency guard: if we already debited for this refund, no-op.
  select exists(
    select 1
    from public.wallet_ledger_entries
    where reference_id = p_payment_id::text
      and reference_type = 'refund'
      and entry_type = 'service_debit'
      and status = 'confirmed'
  ) into v_prior_refund_exists;

  if v_prior_refund_exists then
    return query select
      p_payment_id,
      0,
      0,
      0::numeric,
      'noop_already_refunded'::text;
    return;
  end if;

  -- Detect whether the payment was consolidated. A consolidation entry
  -- exists if any wallet_ledger_entries row has reference_type =
  -- 'consolidation' for this payment (written by
  -- consolidate_payment_earnings RPC in migration 0048).
  select exists(
    select 1
    from public.wallet_ledger_entries
    where reference_id = p_payment_id::text
      and reference_type = 'consolidation'
      and balance_bucket = 'available_to_withdraw'
      and status = 'confirmed'
  ) into v_post_consolidation;

  if v_post_consolidation then
    v_bucket := 'available_to_withdraw';
  else
    v_bucket := 'pending';
  end if;

  -- For each actor that received a credit in the source bucket, debit
  -- the equivalent amount. The source bucket is the same as the
  -- original consolidation target (post-consolidation) or the original
  -- credit bucket (pre-consolidation).
  --
  -- For post-consolidation refunds, we also need to handle the case
  -- where the seller's available_to_withdraw was subsequently moved to
  -- `locked` (payout initiated) or fully out (paid_out). In those
  -- cases, the bucket no longer has the funds and we cannot debit.
  -- The seller_fees.state is checked by the caller, not here — but the
  -- wallet_accounts balance for the bucket is checked here as a
  -- defensive measure.
  for v_actor_row in
    select profile_id, sum(amount) as bucket_amount
    from public.wallet_ledger_entries
    where reference_id = p_payment_id::text
      and reference_type in ('payment', 'consolidation')
      and balance_bucket = v_bucket
      and status = 'confirmed'
      and entry_type = 'earnings_distribution'
    group by profile_id
  loop
    -- Defensive bucket-balance check: only debit if the wallet
    -- actually has the funds available. If a seller has already
    -- moved the funds to `locked` (payout initiated) or further out,
    -- we skip and surface the case for manual reconciliation.
    declare
      v_current_bucket_balance numeric(12,2);
    begin
      if v_bucket = 'pending' then
        select pending into v_current_bucket_balance
        from public.wallet_accounts
        where profile_id = v_actor_row.profile_id;
      else
        select available_to_withdraw into v_current_bucket_balance
        from public.wallet_accounts
        where profile_id = v_actor_row.profile_id;
      end if;

      if coalesce(v_current_bucket_balance, 0) < v_actor_row.bucket_amount then
        -- Funds already moved out of this bucket (likely to `locked`
        -- via payout initiation, or already paid_out via Stripe
        -- Connect transfer). Skip this actor; downstream alerting.
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      -- Debit the bucket on wallet_accounts.
      if v_bucket = 'pending' then
        update public.wallet_accounts
        set
          pending = pending - v_actor_row.bucket_amount,
          updated_at = v_now
        where profile_id = v_actor_row.profile_id;
      else
        update public.wallet_accounts
        set
          available_to_withdraw = available_to_withdraw - v_actor_row.bucket_amount,
          updated_at = v_now
        where profile_id = v_actor_row.profile_id;
      end if;

      -- Append the audit ledger entry recording the refund debit.
      -- entry_type = 'service_debit' (Noon-initiated reversal).
      -- reference_type = 'refund' for idempotency lookup + audit trail.
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
        'service_debit',
        v_bucket,
        'confirmed',
        'refund',
        p_payment_id::text,
        p_actor_profile_id,
        jsonb_build_object(
          'reversedFrom', v_bucket,
          'refundedAt', v_now,
          'paymentId', p_payment_id,
          'postConsolidation', v_post_consolidation
        ),
        v_now
      );

      v_total_amount := v_total_amount + v_actor_row.bucket_amount;
      v_actor_count := v_actor_count + 1;
    end;
  end loop;

  return query select
    p_payment_id,
    v_actor_count,
    v_skipped_count,
    v_total_amount,
    v_bucket;
end;
$$;

revoke execute on function public.debit_wallet_for_refund(uuid, uuid) from anon;
revoke execute on function public.debit_wallet_for_refund(uuid, uuid) from authenticated;
grant execute on function public.debit_wallet_for_refund(uuid, uuid) to service_role;

commit;
