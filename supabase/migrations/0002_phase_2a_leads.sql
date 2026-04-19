begin;

create type public.lead_status as enum (
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost'
);

create type public.lead_source as enum (
  'website',
  'referral',
  'cold_call',
  'social',
  'event',
  'other'
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  legacy_mock_id text unique,
  name text not null,
  email text not null check (email = lower(email)),
  phone text,
  company text,
  source public.lead_source not null,
  status public.lead_status not null default 'new',
  score integer not null check (score >= 0 and score <= 100),
  value numeric(12, 2) not null default 0 check (value >= 0),
  assigned_to uuid references public.user_profiles(id) on delete set null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  notes text,
  tags text[] not null default '{}',
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_status on public.leads(status);
create index idx_leads_assigned_to on public.leads(assigned_to);
create index idx_leads_created_by on public.leads(created_by);
create index idx_leads_created_at on public.leads(created_at desc);
create index idx_leads_company on public.leads(company);
create index idx_leads_email on public.leads(email);

create trigger trg_leads_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

alter table public.leads enable row level security;

grant select, insert, update, delete on public.leads to authenticated;

create policy "leads_select_sales_scope"
on public.leads
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or leads.assigned_to = auth.uid()
        or leads.created_by = auth.uid()
      )
  )
);

create policy "leads_insert_sales_scope"
on public.leads
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'sales')
  )
  and created_by = auth.uid()
  and (
    assigned_to is null
    or assigned_to = auth.uid()
    or exists (
      select 1
      from public.user_profiles viewer
      where viewer.id = auth.uid()
        and viewer.is_active = true
        and viewer.role in ('admin', 'sales_manager')
    )
  )
);

create policy "leads_update_sales_scope"
on public.leads
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or leads.assigned_to = auth.uid()
        or leads.created_by = auth.uid()
      )
  )
)
with check (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or leads.assigned_to = auth.uid()
        or leads.created_by = auth.uid()
      )
  )
);

create policy "leads_delete_sales_scope"
on public.leads
for delete
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or leads.assigned_to = auth.uid()
        or leads.created_by = auth.uid()
      )
  )
);

commit;
