# ADR-015: Earnings consolidation atomicity via Postgres RPC

**Status:** Accepted
**Date:** 2026-05-17 (amended same day with idempotency guard 2 — migration 0049, see §Amendment)
**Deciders:** Engineering team
**Supersedes:** None
**Related:** ADR-007 (seller-fee state machine), `docs/contracts/seller-fee-state-machine.md`, `specs/fase-3-earnings-lifecycle.md`.

## Amendment 2026-05-17 — Idempotency guard 2 (migration 0049)

During the closure of Path C the team identified that the legacy `POST /api/admin/earnings/consolidate` endpoint (preserved for backwards compatibility, not refactored in this iteration) moves the wallet bucket without transitioning the `seller_fees` state machine. If an admin invokes the legacy endpoint and the cron then processes the same payment 7+ days later, the state machine guard (`state must be confirmed`) passes — but the wallet would be double-consolidated because the original `pending` ledger entries remain in place.

Migration 0049 (`phase_19c_consolidate_earnings_idempotency_guard.sql`) adds a second idempotency check inside the RPC: before processing, query `wallet_ledger_entries WHERE reference_type='consolidation' AND reference_id=payment_id`. If a consolidation entry already exists (from any path), the RPC transitions the state machine to `pending_payout` for consistency and skips the wallet bucket move entirely. The shape of the response distinguishes from the state-not-confirmed no-op by reporting `prior_state='confirmed'` + `new_state='pending_payout'` + `actors_consolidated=0`.

This change preserves all of the safety properties of the original ADR (atomicity via implicit transaction, row lock via `SELECT FOR UPDATE`, state-machine guard) and adds defense-in-depth against the legacy endpoint hazard. The legacy endpoint itself is documented for future deprecation in roadmap §16 G15.

---

## Context

The earnings consolidation step (`pending → available_to_withdraw` in the wallet bucket model + `confirmed → pending_payout` in the `seller_fees` state machine) touches three surfaces that must move together or not at all:

1. `seller_fees.state` for the single seller_fees row associated with the payment.
2. `wallet_accounts.pending` and `wallet_accounts.available_to_withdraw` for each actor who received a credit at payment time (seller; developer if assigned at payment time).
3. `wallet_ledger_entries` — append-only audit log; each consolidation creates paired rows recording the bucket move.

Today the two halves of the operation live in separate functions (`lib/server/seller-fees/service.ts::markPendingPayout` for the state machine; `lib/server/earnings/admin.ts::consolidateEarnings` for the wallet bucket). They are never invoked together in production — there is no caller for `markPendingPayout` outside its own unit tests, and `consolidateEarnings` is gated behind a manual admin endpoint that does not touch the state machine.

This iteration (`specs/fase-3-earnings-lifecycle.md`) introduces an automatic Vercel Cron trigger that fires on every eligible payment daily. Without explicit atomicity, two failure modes can corrupt seller earnings:

- **Partial application:** the state machine flip succeeds but the wallet bucket move fails (or vice versa). The system ends in an inconsistent state — `seller_fees.state = 'pending_payout'` while `wallet_accounts.pending` still contains the un-moved amount, or the wallet shows the funds as withdrawable while the state machine still claims they are unconfirmed.
- **Race with concurrent operations:** the Stripe refund webhook (`handleChargeRefunded`) and the cron consolidate run simultaneously. Without locking, the refund's `seller_fees → cancelled` transition could fire after the consolidation's `seller_fees → pending_payout` has read the row but before it writes back. The state machine would end in `pending_payout` for a payment that has been refunded — leaving the seller withdrawable on cancelled money.

Both modes are real risks once the cron runs daily in Production. Architecture must decide between:

- **A. Postgres RPC** that does all three updates inside a single transaction with `SELECT FOR UPDATE` row locks.
- **B. Application-layer composition** with compensating logic (try the state flip, then try the wallet move, and if the wallet move fails, attempt to revert the state flip).

---

## Decision

The consolidation operation is implemented as a single Postgres RPC `consolidate_payment_earnings(p_payment_id uuid, p_actor_profile_id uuid)` defined in migration `0048_phase_19b_consolidate_earnings_rpc.sql`. The RPC executes the state machine transition + the wallet bucket move + the audit ledger inserts inside an implicit transaction (Postgres `plpgsql` functions are transactional by default when invoked via `client.rpc(...)`), with explicit `SELECT FOR UPDATE` locking on the `seller_fees` row.

The TypeScript service layer (`lib/server/earnings/consolidation-service.ts::consolidateEarningsForPayment`) is a thin wrapper that invokes the RPC and translates Postgres error messages into typed application errors. It does not retain any of the consolidation logic in TS — the SQL function is the canonical authority.

The pre-existing application-layer functions stay as supporting primitives:

- `lib/server/seller-fees/service.ts::markPendingPayout` continues to exist but is **not called from the production consolidation path**. It is preserved for unit-test purposes and as an opt-in primitive if a future caller needs only the state machine flip.
- `lib/server/earnings/admin.ts::consolidateEarnings` is refactored to delegate to the new service. Its public signature is preserved for backwards compatibility, but internally the function now invokes the RPC.

---

## Rationale

### Why RPC over application-layer

Three reasons:

1. **True transactional atomicity.** A single `plpgsql` function executes inside one Postgres transaction. Either all three updates commit or none do. There is no time window in which the system can be observed in a partial state. Application-layer composition (Option B) gives weaker guarantees: between the two RPCs (`markPendingPayout` and the wallet move), other transactions can observe and act on the half-updated state. Compensating logic in TS can attempt to revert, but the revert itself can fail, leaving the system in an even worse state.

2. **Race protection via `SELECT FOR UPDATE`.** The RPC opens with `SELECT * FROM seller_fees WHERE payment_id = p_payment_id FOR UPDATE`. Any concurrent transaction that touches the same `seller_fees` row (e.g., the refund handler reading the row to flip it to `cancelled`) blocks until our transaction commits. This serializes the two operations safely. Without row locking, both transactions can read the `confirmed` state, both can decide they are allowed to transition, and the second commit silently wins — leading to the refund-overwriting-consolidation or consolidation-overwriting-refund hazard depending on order.

3. **Idempotency guard inside the lock.** Re-running the cron on the same payment is a no-op because the RPC, immediately after acquiring the lock, checks `if state IS DISTINCT FROM 'confirmed' THEN RETURN`. The check + the state transition both happen inside the locked section, so two concurrent cron runs (e.g., a manual `?dryRun=false` invocation racing the scheduled run) cannot both transition. The slower one observes the state as `pending_payout` after the faster one commits and returns cleanly.

### Why preserve application-layer primitives

`markPendingPayout` and `consolidateEarnings` are not deleted because:

- **`markPendingPayout` has unit tests** that exercise the state machine in isolation. Deleting it would force the tests to spin up a Postgres mock or invoke the full RPC stack. The simpler path is to keep the unit-level primitive available; production just chooses to compose at the SQL layer instead.
- **`consolidateEarnings` (admin.ts) preserves backwards compatibility for the manual admin endpoint.** External callers (operator scripts, the legacy `POST /api/admin/earnings/consolidate` route) pass `targetProfileId + amount`, not `paymentId`. The refactored function translates the input shape into the new RPC call internally. Future iterations can replace the admin endpoint's input shape to also be payment-centric, but that is a UX change not gated by this ADR.

### Why the RPC takes `p_payment_id` instead of `p_seller_fee_id`

A single payment generates multiple wallet ledger entries (one per actor: seller, developer, noon — though noon's `actor_id IS NULL` and is excluded from wallet credits). The payment is the natural unit of consolidation — all actors of the same payment consolidate together. Taking the seller_fee id would force the RPC to either ignore the developer / noon side (incomplete) or to lookup the payment from the seller_fee (redundant). Taking the payment id keeps the lookup direction natural: find the seller_fee + all actor wallet entries from the payment id.

### Why `30 6 * * *` (6:30 AM UTC) for the cron schedule

The existing cron entry runs at `0 9 * * *`. Picking `30 6 * * *` gives 2.5 hours of separation, which is generous slack in case the consolidation cron grows to process many payments and overruns its initial expectation of a few seconds. 6:30 AM UTC is also off-peak for most user timezones (3:30 AM EST, 12:30 AM PST, 8:30 AM CET) — minimizes the chance that an operator triggering a manual consolidation collides with the scheduled one.

---

## Consequences

### Atomicity invariant restored

After this iteration, any caller (the cron, the admin endpoint, or a future UI button) hits the same RPC. The state machine and the wallet bucket model are guaranteed to stay in sync across the consolidation step.

### Database becomes the source of truth for the operation

Moving the logic into SQL means the operational semantics live in a migration file (`0048_phase_19b_consolidate_earnings_rpc.sql`). Any future iteration that wants to tweak the consolidation rules (different cooling period for different actors, different conditions on what constitutes "consolidatable", etc.) requires a new migration. This is heavier than editing a TS file but is the correct trade-off for an operation that mutates monetary balances.

### Test surface

The RPC is tested end-to-end against a real Postgres instance (Supabase test project or local pg). The TS wrapper is tested with the same mocking pattern used for other RPC wrappers in the codebase (`activatePaidProposal`, `creditWalletBucket`). Unit tests for `markPendingPayout` continue to pass as-is because that function is preserved.

### Future migration: developer assigned post-payment

If a future iteration wants to retroactively credit the developer when they are assigned after payment, the new logic lives in a separate RPC (e.g., `credit_developer_for_payment`). This ADR does not preempt that design; it simply ensures the current consolidation path is correct for the case where the developer was either assigned at payment time or never assigned.

### Refund-after-consolidation gap stays open

Stripe permits refunds up to 180 days by default. A 7-day cooling period leaves a 173-day window where a refund can fire on an already-consolidated payment. Today the refund handler flips `seller_fees.state → cancelled` and updates `earnings_ledger.status → cancelled`, but it does NOT debit `wallet_accounts.available_to_withdraw`. After this iteration ships, a post-consolidation refund will leave the seller's `available_to_withdraw` inflated until Path G (wallet reversal RPC) lands. This is documented in roadmap §16 G14 as an accepted pilot risk.

### Risk register

| Risk | Mitigation |
|---|---|
| Cron retries silently double-consolidate | Idempotency guard inside the locked section returns early when state is not `confirmed` |
| Refund webhook + cron run simultaneously | `SELECT FOR UPDATE` serializes; the second one observes the state as no-longer-`confirmed` and returns |
| RPC fails partway through (DB connection drop) | Postgres transaction aborts; all three updates roll back; cron retry processes the row on the next run |
| Operator manual invocation races scheduled cron | Same lock; second invocation is a no-op after the first commits |
| Future tweak to consolidation logic requires migration | Accepted trade-off; the operation is monetary and the SQL function is the right home |
| RPC argument-name mismatch with TS wrapper | Caught at typecheck time after `generate_typescript_types` regen post-migration |

---

## Implementation contract

### Migration `0048_phase_19b_consolidate_earnings_rpc.sql`

Creates the function:

```sql
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
  -- Acquire lock on the seller_fees row associated with this payment
  select * into v_seller_fee_row
  from public.seller_fees
  where payment_id = p_payment_id
  for update;

  -- Idempotency guard: only proceed from `confirmed`
  if not found then
    raise exception using errcode = 'P0001', message = 'SELLER_FEE_NOT_FOUND_FOR_PAYMENT';
  end if;

  if v_seller_fee_row.state is distinct from 'confirmed' then
    -- Already processed or in an unexpected state — return no-op
    return query select
      p_payment_id,
      v_seller_fee_row.id,
      v_seller_fee_row.state,
      v_seller_fee_row.state,
      0,
      0::numeric;
    return;
  end if;

  -- State machine: confirmed → pending_payout
  update public.seller_fees
  set
    state = 'pending_payout',
    pending_payout_at = v_now,
    updated_at = v_now
  where id = v_seller_fee_row.id;

  -- For each actor wallet entry tied to this payment in the `pending` bucket,
  -- move the amount to `available_to_withdraw` and write the audit pair.
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
    -- Update wallet account totals atomically
    update public.wallet_accounts
    set
      pending = pending - v_actor_row.bucket_amount,
      available_to_withdraw = available_to_withdraw + v_actor_row.bucket_amount,
      updated_at = v_now
    where profile_id = v_actor_row.profile_id;

    -- Append audit ledger entry recording the consolidation
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

grant execute on function public.consolidate_payment_earnings(uuid, uuid) to service_role;
revoke execute on function public.consolidate_payment_earnings(uuid, uuid) from anon, authenticated;
```

### TS wrapper signature

```typescript
export interface ConsolidatePaymentEarningsResult {
  payment_id: string
  seller_fee_id: string
  prior_state: string
  new_state: string
  actors_consolidated: number
  amount_consolidated: number
}

export async function consolidateEarningsForPayment(
  adminClient: SupabaseClient,
  input: { paymentId: string; actorProfileId?: string | null }
): Promise<ConsolidatePaymentEarningsResult>
```

### Cron entry

```json
{
  "path": "/api/cron/consolidate-earnings",
  "schedule": "30 6 * * *"
}
```

### Env var

`EARNINGS_CONSOLIDATION_COOLING_DAYS` (default 7, positive integer).

---

## References

- `docs/contracts/seller-fee-state-machine.md` — entity contract; transition `Confirmed → Pending payout` per spec §24.4
- `docs/adrs/ADR-007-seller-fee-state-machine.md` — defers `pending_payout` mechanics; this ADR closes that follow-up
- `docs/product/master-spec-v3.md` §24.4 — earnings states canonical definition
- `specs/fase-3-earnings-lifecycle.md` — iteration spec authored alongside this ADR
- `lib/server/seller-fees/service.ts::markPendingPayout` — preserved application-layer primitive (not called from production)
- `lib/server/earnings/admin.ts::consolidateEarnings` — refactored to delegate to the new RPC
- `supabase/migrations/0037_phase_15b_payment_activation_and_payout_safety.sql` — example of an existing transactional RPC (`activate_paid_proposal`) following the same pattern this ADR adopts
