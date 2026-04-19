begin;

-- ── lead_origin ─────────────────────────────────────────────────────────────
-- Tracks whether the seller initiated contact (outbound) or the client arrived
-- on their own (inbound). Immutable after creation — drives commission logic.

create type public.lead_origin as enum ('inbound', 'outbound');

alter table public.leads
  add column lead_origin public.lead_origin;

-- ── developer_user_id on projects ────────────────────────────────────────────
-- Links a project to the real developer user profile so earnings can be
-- credited at payment time.

alter table public.projects
  add column developer_user_id uuid references public.user_profiles(id) on delete set null;

create index idx_projects_developer_user_id on public.projects(developer_user_id);

-- ── Earnings enums ───────────────────────────────────────────────────────────

create type public.earning_actor_role as enum ('seller', 'developer', 'noon');

create type public.earning_type as enum ('activation', 'monthly');

-- credited = amount recorded, awaiting payout cycle
-- paid_out = disbursed to actor
-- cancelled = reversed (e.g. refund)
create type public.earning_status as enum ('credited', 'paid_out', 'cancelled');

-- ── earnings_ledger ──────────────────────────────────────────────────────────
-- One row per earning event per actor. Noon's own share is stored with
-- actor_id = null and actor_role = 'noon'.

create table public.earnings_ledger (
  id                uuid primary key default gen_random_uuid(),
  actor_id          uuid references public.user_profiles(id) on delete set null,
  actor_role        public.earning_actor_role not null,
  earning_type      public.earning_type not null,
  amount            numeric(12, 2) not null check (amount > 0),
  currency          text not null default 'USD',
  lead_id           uuid references public.leads(id) on delete restrict,
  proposal_id       uuid references public.lead_proposals(id) on delete restrict,
  payment_id        uuid references public.payments(id) on delete restrict,
  status            public.earning_status not null default 'credited',
  credited_at       timestamptz not null default now(),
  paid_out_at       timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  constraint earnings_ledger_paid_out_requires_timestamp
    check (status <> 'paid_out' or paid_out_at is not null)
);

create index idx_earnings_ledger_actor_id on public.earnings_ledger(actor_id);
create index idx_earnings_ledger_payment_id on public.earnings_ledger(payment_id);
create index idx_earnings_ledger_lead_id on public.earnings_ledger(lead_id);
create index idx_earnings_ledger_credited_at on public.earnings_ledger(credited_at desc);

alter table public.earnings_ledger enable row level security;

grant select on public.earnings_ledger to authenticated;

-- Actors see their own earnings; admin and pm see all
create policy "earnings_ledger_select_scope"
on public.earnings_ledger
for select
to authenticated
using (
  actor_id = auth.uid()
  or exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'pm')
  )
);

commit;
