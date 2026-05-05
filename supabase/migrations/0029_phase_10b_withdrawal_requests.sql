begin;

create type public.withdrawal_status as enum ('pending', 'approved', 'rejected', 'completed');

create table public.withdrawal_requests (
  id                 uuid primary key default gen_random_uuid(),
  actor_id           uuid not null references public.user_profiles(id) on delete restrict,
  amount             numeric(12, 2) not null check (amount > 0),
  currency           text not null default 'USD',
  status             public.withdrawal_status not null default 'pending',
  notes              text,
  requested_at       timestamptz not null default now(),
  processed_at       timestamptz,
  processed_by_id    uuid references public.user_profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index idx_withdrawal_requests_actor_id on public.withdrawal_requests(actor_id);
create index idx_withdrawal_requests_status   on public.withdrawal_requests(status);
create index idx_withdrawal_requests_requested_at on public.withdrawal_requests(requested_at desc);

create trigger trg_withdrawal_requests_updated_at
before update on public.withdrawal_requests
for each row execute function public.set_updated_at();

alter table public.withdrawal_requests enable row level security;

grant select, insert on public.withdrawal_requests to authenticated;

-- Actors see their own requests; admin/pm see all
create policy "withdrawal_requests_select_scope"
on public.withdrawal_requests for select to authenticated
using (
  actor_id = auth.uid()
  or exists (
    select 1 from public.user_profiles v
    where v.id = auth.uid() and v.is_active = true and v.role in ('admin', 'pm')
  )
);

-- Only the actor can open a withdrawal request for themselves
create policy "withdrawal_requests_insert_scope"
on public.withdrawal_requests for insert to authenticated
with check (actor_id = auth.uid());

commit;
