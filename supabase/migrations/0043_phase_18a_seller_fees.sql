-- Phase 18a — Seller-fee state machine: structural foundation
-- Implements the storage layer for the seller-fee entity defined in
-- docs/contracts/seller-fee-state-machine.md and decided in
-- docs/adrs/ADR-007-seller-fee-state-machine.md.
--
-- This migration is the structural half of B3 Chunk 1
-- (specs/fase-0-b3-seller-fee-selector.md). It creates the state enum,
-- the seller_fees table with indexes and updated-at trigger, enables RLS
-- with no policies (deny-all by default), and extends the
-- lead_activity_type enum with the five state-transition values.
--
-- RLS policies that open SELECT per role are added in the follow-up
-- migration 0044_phase_18b_seller_fees_rls.sql (sub-PR 1c). No service
-- code yet writes to this table; Chunk 2 introduces the service layer.

begin;

-- New enum for the 5-state lifecycle per ADR-007 §State enum.
create type public.seller_fee_state as enum (
  'potential',
  'confirmed',
  'pending_payout',
  'paid_out',
  'cancelled'
);

-- Append the 5 state-transition activity types per ADR-007 §Activity logging.
-- Reuses the existing lead_activities table; no new activity surface introduced.
alter type public.lead_activity_type add value if not exists 'seller_fee_selected';
alter type public.lead_activity_type add value if not exists 'seller_fee_confirmed';
alter type public.lead_activity_type add value if not exists 'seller_fee_pending_payout';
alter type public.lead_activity_type add value if not exists 'seller_fee_paid_out';
alter type public.lead_activity_type add value if not exists 'seller_fee_cancelled';

-- State-bearing entity for outbound seller fees.
-- Additive to earnings_ledger (per ADR-007 §Consequences rule 10): both records
-- coexist after a confirmed outbound activation. earnings_ledger records the
-- monetary movement; seller_fees records the state.
create table public.seller_fees (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique
    references public.lead_proposals(id) on delete restrict,
  lead_id uuid not null
    references public.leads(id) on delete restrict,
  seller_profile_id uuid not null
    references public.user_profiles(id) on delete restrict,
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  state public.seller_fee_state not null default 'potential',
  payment_id uuid
    references public.payments(id) on delete restrict,
  payout_id uuid
    references public.payouts(id) on delete restrict,
  cancellation_reason text,
  formula_context_snapshot jsonb not null default '{}'::jsonb,
  selected_at timestamptz not null default now(),
  confirmed_at timestamptz,
  pending_payout_at timestamptz,
  paid_out_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- ADR-007 §Consequences rule 7: amount values constrained at DB layer,
  -- not just application. Adding a fourth value requires a new ADR + migration.
  constraint seller_fees_amount_allowed_values
    check (amount in (100, 300, 500)),
  -- ADR-007: multi-currency is out of scope for B3.
  constraint seller_fees_currency_supported
    check (currency = 'USD'),
  -- State-consistency checks: timestamps must match the state column.
  constraint seller_fees_confirmed_requires_payment
    check (state = 'potential' or payment_id is not null or state = 'cancelled'),
  constraint seller_fees_cancelled_requires_reason
    check (state <> 'cancelled' or cancellation_reason is not null)
);

comment on table public.seller_fees is
  'Seller-fee state machine for outbound proposals. One row per outbound proposal. State transitions are recorded in lead_activities with seller_fee_* activity types. See ADR-007 and docs/contracts/seller-fee-state-machine.md.';

comment on column public.seller_fees.proposal_id is
  'The outbound lead_proposals row this fee is attached to. UNIQUE: one seller_fee per proposal. New proposal version means new seller_fees row.';

comment on column public.seller_fees.seller_profile_id is
  'The seller who selected the fee at proposal generation. Locked at insert; lead reassignment after this row exists does not move the fee.';

comment on column public.seller_fees.amount is
  'Selected fee value in USD. Constrained to 100, 300, or 500 per ADR-007 §Consequences rule 7.';

comment on column public.seller_fees.state is
  'Current state in the 5-value lifecycle. Transitions are driven by the service layer in lib/server/seller-fees/ (Chunk 2). Cancellation from paid_out is forbidden as an automatic transition per ADR-007 §Consequences rule 3.';

comment on column public.seller_fees.formula_context_snapshot is
  'JSONB snapshot of the activation-payment formula as applied at fee selection (per contract §Conceptual data shape). Preserves historical context if base pricing changes later.';

-- Indexes for the access patterns the service layer and webhook handler use.
create index idx_seller_fees_lead_id
  on public.seller_fees(lead_id);

create index idx_seller_fees_seller_profile_id
  on public.seller_fees(seller_profile_id);

create index idx_seller_fees_state
  on public.seller_fees(state);

create index idx_seller_fees_payment_id
  on public.seller_fees(payment_id)
  where payment_id is not null;

create index idx_seller_fees_payout_id
  on public.seller_fees(payout_id)
  where payout_id is not null;

-- Standard updated_at trigger (reuse existing function from earlier migrations).
create trigger trg_seller_fees_updated_at
before update on public.seller_fees
for each row
execute function public.set_updated_at();

-- Enable RLS. No policies in this migration: the table is deny-all by default.
-- Sub-PR 1c (0044_phase_18b_seller_fees_rls.sql) adds the role-aware policies
-- per ADR-007 §Consequences rule 2 (developer role structurally excluded).
alter table public.seller_fees enable row level security;

commit;
