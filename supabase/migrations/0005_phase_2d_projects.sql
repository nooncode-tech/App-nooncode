begin;

alter type public.lead_activity_type add value if not exists 'project_created';

create type public.project_status as enum (
  'backlog',
  'in_progress',
  'review',
  'delivered',
  'completed'
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  source_lead_id uuid references public.leads(id) on delete set null,
  source_proposal_id uuid unique references public.lead_proposals(id) on delete set null,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  name text not null,
  description text,
  client_name text not null,
  status public.project_status not null default 'backlog',
  budget numeric(12, 2) not null default 0 check (budget >= 0),
  pm_legacy_user_id text,
  team_legacy_user_ids text[] not null default '{}',
  handoff_ready_at timestamptz,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_projects_status on public.projects(status);
create index idx_projects_source_lead_id on public.projects(source_lead_id);
create index idx_projects_source_proposal_id on public.projects(source_proposal_id);
create index idx_projects_created_by on public.projects(created_by);
create index idx_projects_created_at on public.projects(created_at desc);

create trigger trg_projects_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

create or replace function public.handle_project_insert_side_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_lead_id is not null then
    perform public.log_lead_activity(
      new.source_lead_id,
      'project_created',
      coalesce(auth.uid(), new.created_by),
      null,
      jsonb_build_object(
        'projectId', new.id,
        'projectName', new.name,
        'proposalId', new.source_proposal_id,
        'projectStatus', new.status
      ),
      new.created_at
    );

    update public.leads
    set status = 'won'
    where id = new.source_lead_id
      and status <> 'won';
  end if;

  return new;
end;
$$;

create trigger trg_projects_insert_side_effects
after insert on public.projects
for each row
execute function public.handle_project_insert_side_effects();

alter table public.projects enable row level security;

grant select, insert, update on public.projects to authenticated;

create policy "projects_select_mixed_scope"
on public.projects
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager', 'pm', 'developer')
        or projects.created_by = auth.uid()
        or exists (
          select 1
          from public.leads lead
          where lead.id = projects.source_lead_id
            and (
              lead.assigned_to = auth.uid()
              or lead.created_by = auth.uid()
            )
        )
      )
  )
);

create policy "projects_insert_from_handoff_scope"
on public.projects
for insert
to authenticated
with check (
  created_by = auth.uid()
  and source_lead_id is not null
  and source_proposal_id is not null
  and exists (
    select 1
    from public.user_profiles viewer
    join public.lead_proposals proposal
      on proposal.id = projects.source_proposal_id
    join public.leads lead
      on lead.id = projects.source_lead_id
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and proposal.lead_id = lead.id
      and proposal.status = 'handoff_ready'
      and (
        viewer.role in ('admin', 'sales_manager', 'sales', 'pm')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

create policy "projects_update_delivery_scope"
on public.projects
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'pm')
  )
)
with check (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'pm')
  )
);

commit;
