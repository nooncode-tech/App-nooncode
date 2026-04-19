begin;

-- Payment status enum
create type public.payment_status as enum (
  'pending',
  'succeeded',
  'failed',
  'refunded',
  'disputed'
);

-- Payment type enum
create type public.payment_type as enum (
  'full_project',
  'phase'
);

-- Stripe customer records linked to leads (external client)
create table public.stripe_customers (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_stripe_customers_stripe_customer_id
on public.stripe_customers(stripe_customer_id);

create trigger trg_stripe_customers_updated_at
before update on public.stripe_customers
for each row
execute function public.set_updated_at();

-- Payment records linked to proposals/projects
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.lead_proposals(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  stripe_customer_id text,
  stripe_payment_intent_id text unique,
  stripe_checkout_session_id text unique,
  payment_type public.payment_type not null default 'full_project',
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'USD',
  status public.payment_status not null default 'pending',
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_currency_length check (char_length(currency) between 3 and 8)
);

create index idx_payments_proposal_id on public.payments(proposal_id);
create index idx_payments_project_id on public.payments(project_id);
create index idx_payments_stripe_payment_intent_id on public.payments(stripe_payment_intent_id);
create index idx_payments_stripe_checkout_session_id on public.payments(stripe_checkout_session_id);
create index idx_payments_status on public.payments(status);
create index idx_payments_created_at on public.payments(created_at desc);

create trigger trg_payments_updated_at
before update on public.payments
for each row
execute function public.set_updated_at();

-- Add payment_status column to lead_proposals so UI can track payment state
alter table public.lead_proposals
  add column if not exists payment_status public.payment_status,
  add column if not exists paid_at timestamptz;

-- Add payment_activated column to projects so project activation is tracked
alter table public.projects
  add column if not exists payment_activated boolean not null default false,
  add column if not exists payment_activated_at timestamptz;

-- RLS
alter table public.stripe_customers enable row level security;
alter table public.payments enable row level security;

grant select on public.stripe_customers to authenticated;
grant select on public.payments to authenticated;

-- Only admin/sales_manager/sales can see stripe customers for their leads
create policy "stripe_customers_select_sales_scope"
on public.stripe_customers
for select
to authenticated
using (
  exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer on viewer.id = auth.uid()
    where lead.id = stripe_customers.lead_id
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

-- Payments visible to admin, pm, and the seller who owns the lead
create policy "payments_select_scope"
on public.payments
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'pm')
  )
  or exists (
    select 1
    from public.lead_proposals proposal
    join public.leads lead on lead.id = proposal.lead_id
    where proposal.id = payments.proposal_id
      and (
        lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

commit;
