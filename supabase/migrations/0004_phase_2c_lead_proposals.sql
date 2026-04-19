begin;

alter type public.lead_activity_type add value if not exists 'proposal_created';
alter type public.lead_activity_type add value if not exists 'proposal_status_changed';

create type public.proposal_status as enum (
  'draft',
  'sent',
  'accepted',
  'rejected',
  'handoff_ready'
);

create table public.lead_proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  title text not null,
  body text not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'USD',
  status public.proposal_status not null default 'draft',
  sent_at timestamptz,
  accepted_at timestamptz,
  handoff_ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_proposals_currency_length check (char_length(currency) between 3 and 8)
);

create index idx_lead_proposals_lead_id_created_at
on public.lead_proposals(lead_id, created_at desc);

create index idx_lead_proposals_status
on public.lead_proposals(status);

create trigger trg_lead_proposals_updated_at
before update on public.lead_proposals
for each row
execute function public.set_updated_at();

create or replace function public.sync_lead_proposal_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'sent' and old.status is distinct from new.status and new.sent_at is null then
    new.sent_at = now();
  end if;

  if new.status = 'accepted' and old.status is distinct from new.status and new.accepted_at is null then
    new.accepted_at = now();
  end if;

  if new.status = 'handoff_ready' and old.status is distinct from new.status then
    if new.accepted_at is null then
      new.accepted_at = now();
    end if;

    if new.handoff_ready_at is null then
      new.handoff_ready_at = now();
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_lead_proposals_sync_status_timestamps
before update on public.lead_proposals
for each row
execute function public.sync_lead_proposal_status_timestamps();

create or replace function public.log_lead_proposal_insert_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_lead_activity(
    new.lead_id,
    'proposal_created',
    coalesce(auth.uid(), new.created_by),
    null,
    jsonb_build_object(
      'proposalId', new.id,
      'title', new.title,
      'status', new.status,
      'amount', new.amount,
      'currency', new.currency
    ),
    new.created_at
  );

  return new;
end;
$$;

create or replace function public.log_lead_proposal_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    perform public.log_lead_activity(
      new.lead_id,
      'proposal_status_changed',
      auth.uid(),
      null,
      jsonb_build_object(
        'proposalId', new.id,
        'title', new.title,
        'fromStatus', old.status,
        'toStatus', new.status
      ),
      now()
    );
  end if;

  return new;
end;
$$;

create trigger trg_lead_proposals_log_insert_activity
after insert on public.lead_proposals
for each row
execute function public.log_lead_proposal_insert_activity();

create trigger trg_lead_proposals_log_update_activity
after update on public.lead_proposals
for each row
execute function public.log_lead_proposal_update_activity();

alter table public.lead_proposals enable row level security;

grant select, insert, update on public.lead_proposals to authenticated;

create policy "lead_proposals_select_sales_scope"
on public.lead_proposals
for select
to authenticated
using (
  exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer
      on viewer.id = auth.uid()
    where lead.id = lead_proposals.lead_id
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

create policy "lead_proposals_insert_sales_scope"
on public.lead_proposals
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer
      on viewer.id = auth.uid()
    where lead.id = lead_proposals.lead_id
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'sales')
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

create policy "lead_proposals_update_sales_scope"
on public.lead_proposals
for update
to authenticated
using (
  exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer
      on viewer.id = auth.uid()
    where lead.id = lead_proposals.lead_id
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
)
with check (
  exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer
      on viewer.id = auth.uid()
    where lead.id = lead_proposals.lead_id
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

commit;
