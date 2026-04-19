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
begin;

create type public.lead_activity_type as enum (
  'created',
  'updated',
  'status_changed',
  'note_added'
);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type public.lead_activity_type not null,
  actor_profile_id uuid references public.user_profiles(id) on delete set null,
  note_body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint lead_activities_note_body_required check (
    (
      activity_type = 'note_added'
      and nullif(btrim(coalesce(note_body, '')), '') is not null
    )
    or activity_type <> 'note_added'
  )
);

create index idx_lead_activities_lead_id_created_at
on public.lead_activities(lead_id, created_at desc);

create index idx_lead_activities_actor_profile_id
on public.lead_activities(actor_profile_id);

create or replace function public.log_lead_activity(
  target_lead_id uuid,
  target_activity_type public.lead_activity_type,
  target_actor_profile_id uuid,
  target_note_body text,
  target_metadata jsonb,
  target_created_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_activities (
    lead_id,
    activity_type,
    actor_profile_id,
    note_body,
    metadata,
    created_at
  )
  values (
    target_lead_id,
    target_activity_type,
    target_actor_profile_id,
    target_note_body,
    coalesce(target_metadata, '{}'::jsonb),
    coalesce(target_created_at, now())
  );
end;
$$;

create or replace function public.collect_lead_update_fields(
  old_row public.leads,
  new_row public.leads
)
returns text[]
language plpgsql
immutable
as $$
declare
  changed_fields text[] := '{}';
begin
  if old_row.name is distinct from new_row.name then
    changed_fields := array_append(changed_fields, 'name');
  end if;

  if old_row.email is distinct from new_row.email then
    changed_fields := array_append(changed_fields, 'email');
  end if;

  if old_row.phone is distinct from new_row.phone then
    changed_fields := array_append(changed_fields, 'phone');
  end if;

  if old_row.company is distinct from new_row.company then
    changed_fields := array_append(changed_fields, 'company');
  end if;

  if old_row.source is distinct from new_row.source then
    changed_fields := array_append(changed_fields, 'source');
  end if;

  if old_row.score is distinct from new_row.score then
    changed_fields := array_append(changed_fields, 'score');
  end if;

  if old_row.value is distinct from new_row.value then
    changed_fields := array_append(changed_fields, 'value');
  end if;

  if old_row.assigned_to is distinct from new_row.assigned_to then
    changed_fields := array_append(changed_fields, 'assignedTo');
  end if;

  if old_row.notes is distinct from new_row.notes then
    changed_fields := array_append(changed_fields, 'notes');
  end if;

  if old_row.tags is distinct from new_row.tags then
    changed_fields := array_append(changed_fields, 'tags');
  end if;

  if old_row.last_contacted_at is distinct from new_row.last_contacted_at then
    changed_fields := array_append(changed_fields, 'lastContactedAt');
  end if;

  return changed_fields;
end;
$$;

create or replace function public.log_lead_insert_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_lead_activity(
    new.id,
    'created',
    coalesce(auth.uid(), new.created_by),
    null,
    jsonb_build_object('status', new.status),
    new.created_at
  );

  return new;
end;
$$;

create or replace function public.log_lead_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_fields text[];
begin
  if old.status is distinct from new.status then
    perform public.log_lead_activity(
      new.id,
      'status_changed',
      auth.uid(),
      null,
      jsonb_build_object(
        'fromStatus', old.status,
        'toStatus', new.status
      ),
      now()
    );
  end if;

  changed_fields := public.collect_lead_update_fields(old, new);

  if coalesce(array_length(changed_fields, 1), 0) > 0 then
    perform public.log_lead_activity(
      new.id,
      'updated',
      auth.uid(),
      null,
      jsonb_build_object('changedFields', changed_fields),
      now()
    );
  end if;

  return new;
end;
$$;

create trigger trg_leads_log_insert_activity
after insert on public.leads
for each row
execute function public.log_lead_insert_activity();

create trigger trg_leads_log_update_activity
after update on public.leads
for each row
execute function public.log_lead_update_activity();

insert into public.lead_activities (
  lead_id,
  activity_type,
  actor_profile_id,
  metadata,
  created_at
)
select
  leads.id,
  'created'::public.lead_activity_type,
  leads.created_by,
  jsonb_build_object('status', leads.status, 'backfilled', true),
  leads.created_at
from public.leads
where not exists (
  select 1
  from public.lead_activities existing
  where existing.lead_id = leads.id
    and existing.activity_type = 'created'
);

alter table public.lead_activities enable row level security;

grant select, insert on public.lead_activities to authenticated;

create policy "lead_activities_select_sales_scope"
on public.lead_activities
for select
to authenticated
using (
  exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer
      on viewer.id = auth.uid()
    where lead.id = lead_activities.lead_id
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

create policy "lead_activities_insert_note_sales_scope"
on public.lead_activities
for insert
to authenticated
with check (
  activity_type = 'note_added'
  and actor_profile_id = auth.uid()
  and exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer
      on viewer.id = auth.uid()
    where lead.id = lead_activities.lead_id
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'sales')
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

commit;
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
begin;

create type public.task_status as enum (
  'todo',
  'in_progress',
  'review',
  'done'
);

create type public.task_priority as enum (
  'low',
  'medium',
  'high',
  'urgent'
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  title text not null,
  description text,
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  assigned_legacy_user_id text references public.user_profiles(legacy_mock_id) on delete set null,
  due_date date,
  estimated_hours integer check (estimated_hours is null or estimated_hours >= 0),
  actual_hours integer check (actual_hours is null or actual_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tasks_project_id on public.tasks(project_id);
create index idx_tasks_status on public.tasks(status);
create index idx_tasks_assigned_legacy_user_id on public.tasks(assigned_legacy_user_id);
create index idx_tasks_created_by on public.tasks(created_by);
create index idx_tasks_created_at on public.tasks(created_at desc);

create trigger trg_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

alter table public.tasks enable row level security;

grant select, insert, update on public.tasks to authenticated;

create policy "tasks_select_delivery_scope"
on public.tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'pm')
        or tasks.assigned_legacy_user_id = viewer.legacy_mock_id
        or exists (
          select 1
          from public.projects project
          where project.id = tasks.project_id
            and project.created_by = auth.uid()
        )
      )
  )
);

create policy "tasks_insert_delivery_scope"
on public.tasks
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.user_profiles viewer
    join public.projects project
      on project.id = tasks.project_id
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'pm')
  )
);

create policy "tasks_update_delivery_scope"
on public.tasks
for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'pm')
        or tasks.assigned_legacy_user_id = viewer.legacy_mock_id
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
        viewer.role in ('admin', 'pm')
        or tasks.assigned_legacy_user_id = viewer.legacy_mock_id
      )
  )
);

commit;
begin;

create type public.task_activity_type as enum (
  'note_added'
);

create table public.task_activities (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  activity_type public.task_activity_type not null,
  actor_profile_id uuid references public.user_profiles(id) on delete set null,
  note_body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_activities_note_body_required check (
    (
      activity_type = 'note_added'
      and note_body is not null
      and btrim(note_body) <> ''
    )
    or activity_type <> 'note_added'
  )
);

create index idx_task_activities_task_id on public.task_activities(task_id);
create index idx_task_activities_created_at on public.task_activities(created_at desc);

alter table public.task_activities enable row level security;

grant select, insert on public.task_activities to authenticated;

create policy "task_activities_select_delivery_scope"
on public.task_activities
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'pm')
        or exists (
          select 1
          from public.tasks task
          where task.id = task_activities.task_id
            and task.assigned_legacy_user_id = viewer.legacy_mock_id
        )
        or exists (
          select 1
          from public.tasks task
          join public.projects project
            on project.id = task.project_id
          where task.id = task_activities.task_id
            and project.created_by = auth.uid()
        )
      )
  )
);

create policy "task_activities_insert_delivery_scope"
on public.task_activities
for insert
to authenticated
with check (
  actor_profile_id = auth.uid()
  and exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'pm')
        or exists (
          select 1
          from public.tasks task
          where task.id = task_activities.task_id
            and task.assigned_legacy_user_id = viewer.legacy_mock_id
        )
      )
  )
);

commit;
begin;

drop policy if exists "projects_select_mixed_scope" on public.projects;

create policy "projects_select_delivery_scope"
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
        viewer.role in ('admin', 'pm')
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
        or (
          viewer.role = 'developer'
          and viewer.legacy_mock_id is not null
          and (
            viewer.legacy_mock_id = any (coalesce(projects.team_legacy_user_ids, '{}'::text[]))
            or exists (
              select 1
              from public.tasks task
              where task.project_id = projects.id
                and task.assigned_legacy_user_id = viewer.legacy_mock_id
            )
          )
        )
      )
  )
);

commit;
begin;

drop policy if exists "tasks_select_delivery_scope" on public.tasks;

create policy "tasks_select_delivery_scope"
on public.tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'pm')
        or tasks.assigned_legacy_user_id = viewer.legacy_mock_id
      )
  )
);

commit;
begin;

alter type public.lead_activity_type add value if not exists 'released_no_response';
alter type public.lead_activity_type add value if not exists 'claimed';

create type public.lead_assignment_status as enum (
  'owned',
  'proposal_locked',
  'released_no_response'
);

alter table public.leads
add column assignment_status public.lead_assignment_status not null default 'owned',
add column locked_by_proposal_id uuid references public.lead_proposals(id) on delete set null,
add column locked_at timestamptz,
add column released_at timestamptz;

create index idx_leads_assignment_status on public.leads(assignment_status);
create index idx_leads_locked_by_proposal_id on public.leads(locked_by_proposal_id);

create or replace function public.collect_lead_update_fields(
  old_row public.leads,
  new_row public.leads
)
returns text[]
language plpgsql
immutable
as $$
declare
  changed_fields text[] := '{}';
begin
  if old_row.name is distinct from new_row.name then
    changed_fields := array_append(changed_fields, 'name');
  end if;

  if old_row.email is distinct from new_row.email then
    changed_fields := array_append(changed_fields, 'email');
  end if;

  if old_row.phone is distinct from new_row.phone then
    changed_fields := array_append(changed_fields, 'phone');
  end if;

  if old_row.company is distinct from new_row.company then
    changed_fields := array_append(changed_fields, 'company');
  end if;

  if old_row.source is distinct from new_row.source then
    changed_fields := array_append(changed_fields, 'source');
  end if;

  if old_row.score is distinct from new_row.score then
    changed_fields := array_append(changed_fields, 'score');
  end if;

  if old_row.value is distinct from new_row.value then
    changed_fields := array_append(changed_fields, 'value');
  end if;

  if old_row.assigned_to is distinct from new_row.assigned_to then
    changed_fields := array_append(changed_fields, 'assignedTo');
  end if;

  if old_row.notes is distinct from new_row.notes then
    changed_fields := array_append(changed_fields, 'notes');
  end if;

  if old_row.tags is distinct from new_row.tags then
    changed_fields := array_append(changed_fields, 'tags');
  end if;

  if old_row.last_contacted_at is distinct from new_row.last_contacted_at then
    changed_fields := array_append(changed_fields, 'lastContactedAt');
  end if;

  if old_row.assignment_status is distinct from new_row.assignment_status then
    changed_fields := array_append(changed_fields, 'assignmentStatus');
  end if;

  return changed_fields;
end;
$$;

create or replace function public.lock_lead_from_proposal_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('sent', 'accepted', 'handoff_ready')
    and old.status is distinct from new.status then
    update public.leads
    set
      assignment_status = 'proposal_locked',
      locked_by_proposal_id = new.id,
      locked_at = coalesce(locked_at, now()),
      released_at = null,
      status = case
        when status in ('new', 'contacted', 'qualified') then 'proposal'
        else status
      end
    where id = new.lead_id;
  end if;

  return new;
end;
$$;

create trigger trg_lead_proposals_lock_lead_on_sent
after update on public.lead_proposals
for each row
execute function public.lock_lead_from_proposal_status();

create or replace function public.release_lead_as_no_response(target_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.user_profiles;
  target_lead public.leads;
begin
  select *
  into current_profile
  from public.user_profiles
  where id = auth.uid()
    and is_active = true;

  if current_profile is null then
    raise exception 'Active profile required.';
  end if;

  if current_profile.role not in ('admin', 'sales_manager', 'sales') then
    raise exception 'Only sales roles can release leads.';
  end if;

  select *
  into target_lead
  from public.leads
  where id = target_lead_id
  for update;

  if target_lead is null then
    raise exception 'Lead not found.';
  end if;

  if target_lead.assignment_status <> 'proposal_locked' then
    raise exception 'Only proposal-locked leads can be released as no response.';
  end if;

  if current_profile.role = 'sales'
    and target_lead.assigned_to is distinct from auth.uid()
    and target_lead.created_by is distinct from auth.uid() then
    raise exception 'Only the lead owner can release it.';
  end if;

  update public.leads
  set
    assignment_status = 'released_no_response',
    assigned_to = null,
    locked_by_proposal_id = null,
    locked_at = null,
    released_at = now()
  where id = target_lead_id;

  perform public.log_lead_activity(
    target_lead_id,
    'released_no_response',
    auth.uid(),
    null,
    jsonb_build_object(
      'fromAssignmentStatus', target_lead.assignment_status,
      'toAssignmentStatus', 'released_no_response'
    ),
    now()
  );

  return target_lead_id;
end;
$$;

create or replace function public.claim_released_lead(target_lead_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.user_profiles;
  target_lead public.leads;
begin
  select *
  into current_profile
  from public.user_profiles
  where id = auth.uid()
    and is_active = true;

  if current_profile is null then
    raise exception 'Active profile required.';
  end if;

  if current_profile.role not in ('admin', 'sales_manager', 'sales') then
    raise exception 'Only sales roles can claim released leads.';
  end if;

  select *
  into target_lead
  from public.leads
  where id = target_lead_id
  for update;

  if target_lead is null then
    raise exception 'Lead not found.';
  end if;

  if target_lead.assignment_status <> 'released_no_response' then
    raise exception 'Only released leads can be claimed.';
  end if;

  update public.leads
  set
    assignment_status = 'owned',
    assigned_to = auth.uid(),
    locked_by_proposal_id = null,
    locked_at = null,
    released_at = null
  where id = target_lead_id;

  perform public.log_lead_activity(
    target_lead_id,
    'claimed',
    auth.uid(),
    null,
    jsonb_build_object(
      'fromAssignmentStatus', target_lead.assignment_status,
      'toAssignmentStatus', 'owned'
    ),
    now()
  );

  return target_lead_id;
end;
$$;

drop policy "leads_select_sales_scope" on public.leads;
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
        or (
          viewer.role = 'sales'
          and leads.assignment_status = 'released_no_response'
        )
      )
  )
);

drop policy "lead_activities_select_sales_scope" on public.lead_activities;
create policy "lead_activities_select_sales_scope"
on public.lead_activities
for select
to authenticated
using (
  exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer
      on viewer.id = auth.uid()
    where lead.id = lead_activities.lead_id
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
        or (
          viewer.role = 'sales'
          and lead.assignment_status = 'released_no_response'
        )
      )
  )
);

drop policy "lead_proposals_select_sales_scope" on public.lead_proposals;
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
        or (
          viewer.role = 'sales'
          and lead.assignment_status = 'released_no_response'
        )
      )
  )
);

drop policy "leads_update_sales_scope" on public.leads;
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
        or (
          viewer.role = 'sales'
          and (
            leads.assigned_to = auth.uid()
            or (
              leads.created_by = auth.uid()
              and leads.assignment_status <> 'released_no_response'
            )
          )
        )
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
        or (
          viewer.role = 'sales'
          and (
            leads.assigned_to = auth.uid()
            or (
              leads.created_by = auth.uid()
              and leads.assignment_status <> 'released_no_response'
            )
          )
        )
      )
  )
);

drop policy "leads_delete_sales_scope" on public.leads;
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
        or (
          viewer.role = 'sales'
          and (
            leads.assigned_to = auth.uid()
            or (
              leads.created_by = auth.uid()
              and leads.assignment_status <> 'released_no_response'
            )
          )
        )
      )
  )
);

commit;
begin;

drop policy "leads_update_sales_scope" on public.leads;
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
        or (
          viewer.role = 'sales'
          and (
            leads.assigned_to = auth.uid()
            or (
              leads.created_by = auth.uid()
              and leads.assigned_to is null
              and leads.assignment_status <> 'released_no_response'
            )
          )
        )
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
        or (
          viewer.role = 'sales'
          and (
            leads.assigned_to = auth.uid()
            or (
              leads.created_by = auth.uid()
              and leads.assigned_to is null
              and leads.assignment_status <> 'released_no_response'
            )
          )
        )
      )
  )
);

drop policy "leads_delete_sales_scope" on public.leads;
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
        or (
          viewer.role = 'sales'
          and (
            leads.assigned_to = auth.uid()
            or (
              leads.created_by = auth.uid()
              and leads.assigned_to is null
              and leads.assignment_status <> 'released_no_response'
            )
          )
        )
      )
  )
);

commit;
begin;

alter table public.leads
add column next_follow_up_at timestamptz;

create index idx_leads_next_follow_up_at
on public.leads(next_follow_up_at)
where next_follow_up_at is not null;

create or replace function public.collect_lead_update_fields(
  old_row public.leads,
  new_row public.leads
)
returns text[]
language plpgsql
immutable
as $$
declare
  changed_fields text[] := '{}';
begin
  if old_row.name is distinct from new_row.name then
    changed_fields := array_append(changed_fields, 'name');
  end if;

  if old_row.email is distinct from new_row.email then
    changed_fields := array_append(changed_fields, 'email');
  end if;

  if old_row.phone is distinct from new_row.phone then
    changed_fields := array_append(changed_fields, 'phone');
  end if;

  if old_row.company is distinct from new_row.company then
    changed_fields := array_append(changed_fields, 'company');
  end if;

  if old_row.source is distinct from new_row.source then
    changed_fields := array_append(changed_fields, 'source');
  end if;

  if old_row.score is distinct from new_row.score then
    changed_fields := array_append(changed_fields, 'score');
  end if;

  if old_row.value is distinct from new_row.value then
    changed_fields := array_append(changed_fields, 'value');
  end if;

  if old_row.assigned_to is distinct from new_row.assigned_to then
    changed_fields := array_append(changed_fields, 'assignedTo');
  end if;

  if old_row.notes is distinct from new_row.notes then
    changed_fields := array_append(changed_fields, 'notes');
  end if;

  if old_row.tags is distinct from new_row.tags then
    changed_fields := array_append(changed_fields, 'tags');
  end if;

  if old_row.last_contacted_at is distinct from new_row.last_contacted_at then
    changed_fields := array_append(changed_fields, 'lastContactedAt');
  end if;

  if old_row.next_follow_up_at is distinct from new_row.next_follow_up_at then
    changed_fields := array_append(changed_fields, 'nextFollowUpAt');
  end if;

  return changed_fields;
end;
$$;

commit;
begin;

alter type public.task_activity_type add value if not exists 'status_changed';
alter type public.task_activity_type add value if not exists 'actual_hours_updated';

create or replace function public.log_task_activity(
  target_task_id uuid,
  target_activity_type public.task_activity_type,
  target_actor_profile_id uuid,
  target_note_body text,
  target_metadata jsonb,
  target_created_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.task_activities (
    task_id,
    activity_type,
    actor_profile_id,
    note_body,
    metadata,
    created_at
  )
  values (
    target_task_id,
    target_activity_type,
    target_actor_profile_id,
    target_note_body,
    coalesce(target_metadata, '{}'::jsonb),
    coalesce(target_created_at, now())
  );
end;
$$;

create or replace function public.log_task_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    perform public.log_task_activity(
      new.id,
      'status_changed',
      auth.uid(),
      null,
      jsonb_build_object(
        'fromStatus', old.status,
        'toStatus', new.status
      ),
      clock_timestamp()
    );
  end if;

  if old.actual_hours is distinct from new.actual_hours then
    perform public.log_task_activity(
      new.id,
      'actual_hours_updated',
      auth.uid(),
      null,
      jsonb_build_object(
        'fromActualHours', old.actual_hours,
        'toActualHours', new.actual_hours
      ),
      clock_timestamp()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tasks_log_update_activity on public.tasks;

create trigger trg_tasks_log_update_activity
after update on public.tasks
for each row
execute function public.log_task_update_activity();

commit;
begin;

create type public.project_activity_type as enum (
  'status_changed'
);

create table public.project_activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  activity_type public.project_activity_type not null,
  actor_profile_id uuid references public.user_profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_project_activities_project_id on public.project_activities(project_id);
create index idx_project_activities_created_at on public.project_activities(created_at desc);

create or replace function public.log_project_activity(
  target_project_id uuid,
  next_activity_type public.project_activity_type,
  next_actor_profile_id uuid default null,
  next_metadata jsonb default '{}'::jsonb,
  occurred_at timestamptz default clock_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id uuid;
begin
  insert into public.project_activities (
    project_id,
    activity_type,
    actor_profile_id,
    metadata,
    created_at
  )
  values (
    target_project_id,
    next_activity_type,
    next_actor_profile_id,
    coalesce(next_metadata, '{}'::jsonb),
    occurred_at
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

create or replace function public.handle_project_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.log_project_activity(
      new.id,
      'status_changed',
      coalesce(auth.uid(), new.created_by, old.created_by),
      jsonb_build_object(
        'fromStatus', old.status,
        'toStatus', new.status
      ),
      clock_timestamp()
    );
  end if;

  return new;
end;
$$;

create trigger trg_projects_activity_after_update
after update on public.projects
for each row
execute function public.handle_project_update_activity();

alter table public.project_activities enable row level security;

grant select on public.project_activities to authenticated;

create policy "project_activities_select_visible_scope"
on public.project_activities
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    join public.projects project
      on project.id = project_activities.project_id
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager', 'pm')
        or project.created_by = auth.uid()
        or exists (
          select 1
          from public.leads lead
          where lead.id = project.source_lead_id
            and (
              lead.assigned_to = auth.uid()
              or lead.created_by = auth.uid()
            )
        )
        or (
          viewer.role = 'developer'
          and viewer.legacy_mock_id is not null
          and (
            viewer.legacy_mock_id = any (coalesce(project.team_legacy_user_ids, '{}'::text[]))
            or exists (
              select 1
              from public.tasks task
              where task.project_id = project.id
                and task.assigned_legacy_user_id = viewer.legacy_mock_id
            )
          )
        )
      )
  )
);

commit;
begin;

create or replace function public.handle_project_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.log_project_activity(
      new.id,
      'status_changed',
      coalesce(auth.uid(), new.created_by, old.created_by),
      jsonb_build_object(
        'projectName', new.name,
        'fromStatus', old.status,
        'toStatus', new.status
      ),
      clock_timestamp()
    );
  end if;

  return new;
end;
$$;

commit;
begin;

drop policy if exists "project_activities_select_visible_scope" on public.project_activities;

create policy "project_activities_select_visible_scope"
on public.project_activities
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
    from public.user_profiles viewer
    join public.projects project
      on project.id = project_activities.project_id
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        project.created_by = auth.uid()
        or exists (
          select 1
          from public.leads lead
          where lead.id = project.source_lead_id
            and (
              lead.assigned_to = auth.uid()
              or lead.created_by = auth.uid()
            )
        )
        or (
          viewer.role = 'developer'
          and viewer.legacy_mock_id is not null
          and (
            viewer.legacy_mock_id = any (coalesce(project.team_legacy_user_ids, '{}'::text[]))
            or exists (
              select 1
              from public.tasks task
              where task.project_id = project.id
                and task.assigned_legacy_user_id = viewer.legacy_mock_id
            )
          )
        )
      )
  )
);

commit;
begin;

alter type public.project_activity_type add value if not exists 'pm_changed';
alter type public.project_activity_type add value if not exists 'team_changed';
alter type public.project_activity_type add value if not exists 'schedule_changed';

create or replace function public.normalize_legacy_user_ids(input_ids text[])
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(distinct normalized_id order by normalized_id),
    '{}'::text[]
  )
  from (
    select nullif(trim(raw_id), '') as normalized_id
    from unnest(coalesce(input_ids, '{}'::text[])) as raw_ids(raw_id)
  ) normalized
  where normalized_id is not null;
$$;

create or replace function public.find_profile_name_by_legacy_mock_id(target_legacy_mock_id text)
returns text
language sql
stable
set search_path = public
as $$
  select profile.full_name
  from public.user_profiles profile
  where profile.legacy_mock_id = target_legacy_mock_id
  limit 1;
$$;

create or replace function public.collect_profile_names_by_legacy_mock_ids(target_legacy_mock_ids text[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(result.full_name order by result.full_name),
    '[]'::jsonb
  )
  from (
    select distinct profile.full_name
    from public.user_profiles profile
    where profile.legacy_mock_id = any (public.normalize_legacy_user_ids(target_legacy_mock_ids))
  ) result;
$$;

create or replace function public.handle_project_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  normalized_old_team_ids text[];
  normalized_new_team_ids text[];
begin
  actor_id := coalesce(auth.uid(), new.created_by, old.created_by);
  normalized_old_team_ids := public.normalize_legacy_user_ids(old.team_legacy_user_ids);
  normalized_new_team_ids := public.normalize_legacy_user_ids(new.team_legacy_user_ids);

  if new.status is distinct from old.status then
    perform public.log_project_activity(
      new.id,
      'status_changed',
      actor_id,
      jsonb_build_object(
        'projectName', new.name,
        'fromStatus', old.status,
        'toStatus', new.status
      ),
      clock_timestamp()
    );
  end if;

  if new.pm_legacy_user_id is distinct from old.pm_legacy_user_id then
    perform public.log_project_activity(
      new.id,
      'pm_changed',
      actor_id,
      jsonb_build_object(
        'projectName', new.name,
        'fromPmId', old.pm_legacy_user_id,
        'toPmId', new.pm_legacy_user_id,
        'fromPmName', public.find_profile_name_by_legacy_mock_id(old.pm_legacy_user_id),
        'toPmName', public.find_profile_name_by_legacy_mock_id(new.pm_legacy_user_id)
      ),
      clock_timestamp()
    );
  end if;

  if normalized_new_team_ids is distinct from normalized_old_team_ids then
    perform public.log_project_activity(
      new.id,
      'team_changed',
      actor_id,
      jsonb_build_object(
        'projectName', new.name,
        'fromTeamIds', to_jsonb(normalized_old_team_ids),
        'toTeamIds', to_jsonb(normalized_new_team_ids),
        'fromTeamNames', public.collect_profile_names_by_legacy_mock_ids(normalized_old_team_ids),
        'toTeamNames', public.collect_profile_names_by_legacy_mock_ids(normalized_new_team_ids)
      ),
      clock_timestamp()
    );
  end if;

  if new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    perform public.log_project_activity(
      new.id,
      'schedule_changed',
      actor_id,
      jsonb_build_object(
        'projectName', new.name,
        'fromStartDate', old.start_date,
        'toStartDate', new.start_date,
        'fromEndDate', old.end_date,
        'toEndDate', new.end_date
      ),
      clock_timestamp()
    );
  end if;

  return new;
end;
$$;

commit;
begin;

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.user_profiles(id) on delete cascade,
  source_kind text not null check (source_kind in ('lead_activity', 'task_activity', 'project_activity')),
  source_event_id uuid not null,
  domain text not null check (domain in ('sales', 'delivery')),
  title text not null,
  body text not null,
  href text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint user_notifications_read_consistency check (
    (is_read = true and read_at is not null)
    or (is_read = false and read_at is null)
  ),
  constraint user_notifications_unique_recipient_source unique (profile_id, source_kind, source_event_id)
);

create index idx_user_notifications_profile_created_at
on public.user_notifications(profile_id, created_at desc);

create index idx_user_notifications_profile_is_read_created_at
on public.user_notifications(profile_id, is_read, created_at desc);

create or replace function public.notification_label_for_lead_status(status_value public.lead_status)
returns text
language sql
immutable
as $$
  select case status_value
    when 'new' then 'Nuevo'
    when 'contacted' then 'Contactado'
    when 'qualified' then 'Calificado'
    when 'proposal' then 'En propuesta'
    when 'negotiation' then 'En negociacion'
    when 'won' then 'Ganado'
    when 'lost' then 'Perdido'
    else 'Actualizado'
  end;
$$;

create or replace function public.notification_label_for_proposal_status(status_value public.proposal_status)
returns text
language sql
immutable
as $$
  select case status_value
    when 'draft' then 'Borrador'
    when 'sent' then 'Enviada'
    when 'accepted' then 'Aceptada'
    when 'rejected' then 'Rechazada'
    when 'handoff_ready' then 'Lista para hand-off'
    else 'Actualizada'
  end;
$$;

create or replace function public.notification_label_for_project_status(status_value public.project_status)
returns text
language sql
immutable
as $$
  select case status_value
    when 'backlog' then 'Backlog'
    when 'in_progress' then 'En progreso'
    when 'review' then 'Revision'
    when 'delivered' then 'Entregado'
    when 'completed' then 'Completado'
    else 'Actualizado'
  end;
$$;

create or replace function public.notification_label_for_task_status(status_value public.task_status)
returns text
language sql
immutable
as $$
  select case status_value
    when 'todo' then 'Por hacer'
    when 'in_progress' then 'En progreso'
    when 'review' then 'Revision'
    when 'done' then 'Completada'
    else 'Actualizada'
  end;
$$;

create or replace function public.notification_format_hours(hours_value jsonb)
returns text
language sql
immutable
as $$
  select case
    when hours_value is null or hours_value = 'null'::jsonb then 'sin dato'
    when jsonb_typeof(hours_value) = 'number' then concat(hours_value #>> '{}', 'h')
    else 'sin dato'
  end;
$$;

create or replace function public.notification_jsonb_text_array(input_value jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(item order by item),
    '{}'::text[]
  )
  from jsonb_array_elements_text(coalesce(input_value, '[]'::jsonb)) as values(item);
$$;

create or replace function public.notification_format_name_list(input_names text[])
returns text
language plpgsql
immutable
as $$
declare
  normalized_names text[];
  visible_names text[];
  total_count integer;
begin
  normalized_names := coalesce(input_names, '{}'::text[]);
  total_count := coalesce(array_length(normalized_names, 1), 0);

  if total_count = 0 then
    return 'Sin equipo';
  end if;

  if total_count <= 3 then
    return array_to_string(normalized_names, ', ');
  end if;

  visible_names := normalized_names[1:3];
  return array_to_string(visible_names, ', ') || ' +' || (total_count - 3);
end;
$$;

create or replace function public.enqueue_user_notification(
  target_profile_id uuid,
  next_source_kind text,
  next_source_event_id uuid,
  next_domain text,
  next_title text,
  next_body text,
  next_href text,
  occurred_at timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_notifications (
    profile_id,
    source_kind,
    source_event_id,
    domain,
    title,
    body,
    href,
    created_at
  )
  values (
    target_profile_id,
    next_source_kind,
    next_source_event_id,
    next_domain,
    next_title,
    next_body,
    next_href,
    coalesce(occurred_at, clock_timestamp())
  )
  on conflict (profile_id, source_kind, source_event_id) do nothing;
end;
$$;

create or replace function public.handle_lead_activity_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_record public.leads%rowtype;
  proposal_title text;
  proposal_status_label text;
  project_name text;
  notification_title text;
  notification_body text;
begin
  if new.activity_type not in ('proposal_created', 'proposal_status_changed', 'project_created') then
    return new;
  end if;

  select *
  into lead_record
  from public.leads
  where id = new.lead_id;

  if not found then
    return new;
  end if;

  if new.activity_type = 'proposal_created' then
    proposal_title := coalesce(nullif(trim(new.metadata ->> 'title'), ''), 'Sin titulo');
    notification_title := 'Nueva propuesta creada';
    notification_body := 'Se creo "' || proposal_title || '" para ' || lead_record.name || '.';
  elsif new.activity_type = 'proposal_status_changed' then
    proposal_status_label := public.notification_label_for_proposal_status(
      (new.metadata ->> 'toStatus')::public.proposal_status
    );
    notification_title := 'Estado de propuesta actualizado';
    notification_body := 'La propuesta de ' || lead_record.name || ' ahora esta en ' || proposal_status_label || '.';
  else
    project_name := coalesce(nullif(trim(new.metadata ->> 'projectName'), ''), 'Proyecto sin nombre');
    notification_title := 'Proyecto creado desde lead';
    notification_body := '"' || project_name || '" ya forma parte del flujo visible de delivery.';
  end if;

  insert into public.user_notifications (
    profile_id,
    source_kind,
    source_event_id,
    domain,
    title,
    body,
    href,
    created_at
  )
  select distinct
    viewer.id,
    'lead_activity',
    new.id,
    'sales',
    notification_title,
    notification_body,
    '/dashboard/leads',
    new.created_at
  from public.user_profiles viewer
  where viewer.is_active = true
    and viewer.id is distinct from new.actor_profile_id
    and (
      viewer.role in ('admin', 'sales_manager')
      or viewer.id = lead_record.assigned_to
      or viewer.id = lead_record.created_by
    )
  on conflict (profile_id, source_kind, source_event_id) do nothing;

  return new;
end;
$$;

create or replace function public.handle_task_activity_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_record record;
  notification_title text;
  notification_body text;
begin
  if new.activity_type not in ('status_changed', 'actual_hours_updated') then
    return new;
  end if;

  select
    task.id,
    task.title,
    task.assigned_legacy_user_id,
    project.pm_legacy_user_id
  into task_record
  from public.tasks task
  join public.projects project
    on project.id = task.project_id
  where task.id = new.task_id;

  if not found then
    return new;
  end if;

  if new.activity_type = 'status_changed' then
    notification_title := 'Estado de tarea actualizado';
    notification_body := '"' || task_record.title || '" ahora esta en '
      || public.notification_label_for_task_status((new.metadata ->> 'toStatus')::public.task_status)
      || '.';
  else
    notification_title := 'Horas reales actualizadas';
    notification_body := '"' || task_record.title || '" cambio horas reales de '
      || public.notification_format_hours(new.metadata -> 'fromActualHours')
      || ' a '
      || public.notification_format_hours(new.metadata -> 'toActualHours')
      || '.';
  end if;

  insert into public.user_notifications (
    profile_id,
    source_kind,
    source_event_id,
    domain,
    title,
    body,
    href,
    created_at
  )
  select distinct
    viewer.id,
    'task_activity',
    new.id,
    'delivery',
    notification_title,
    notification_body,
    '/dashboard/tasks',
    new.created_at
  from public.user_profiles viewer
  where viewer.is_active = true
    and viewer.id is distinct from new.actor_profile_id
    and (
      viewer.role = 'admin'
      or (
        task_record.pm_legacy_user_id is not null
        and viewer.legacy_mock_id = task_record.pm_legacy_user_id
      )
      or (
        task_record.assigned_legacy_user_id is not null
        and viewer.legacy_mock_id = task_record.assigned_legacy_user_id
      )
    )
  on conflict (profile_id, source_kind, source_event_id) do nothing;

  return new;
end;
$$;

create or replace function public.handle_project_activity_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  project_record public.projects%rowtype;
  to_pm_name text;
  from_pm_name text;
  to_team_names text[];
  from_team_names text[];
  notification_title text;
  notification_body text;
begin
  if new.activity_type not in ('status_changed', 'pm_changed', 'team_changed', 'schedule_changed') then
    return new;
  end if;

  select *
  into project_record
  from public.projects
  where id = new.project_id;

  if not found then
    return new;
  end if;

  if new.activity_type = 'status_changed' then
    notification_title := 'Estado de proyecto actualizado';
    notification_body := '"' || project_record.name || '" ahora esta en '
      || public.notification_label_for_project_status((new.metadata ->> 'toStatus')::public.project_status)
      || '.';
  elsif new.activity_type = 'pm_changed' then
    from_pm_name := coalesce(nullif(trim(new.metadata ->> 'fromPmName'), ''), 'Sin PM');
    to_pm_name := coalesce(nullif(trim(new.metadata ->> 'toPmName'), ''), 'Sin PM');
    notification_title := 'PM del proyecto actualizado';
    notification_body := '"' || project_record.name || '" cambio PM de ' || from_pm_name || ' a ' || to_pm_name || '.';
  elsif new.activity_type = 'team_changed' then
    from_team_names := public.notification_jsonb_text_array(new.metadata -> 'fromTeamNames');
    to_team_names := public.notification_jsonb_text_array(new.metadata -> 'toTeamNames');
    notification_title := 'Equipo del proyecto actualizado';
    notification_body := '"' || project_record.name || '" cambio equipo de '
      || public.notification_format_name_list(from_team_names)
      || ' a '
      || public.notification_format_name_list(to_team_names)
      || '.';
  else
    notification_title := 'Fechas del proyecto actualizadas';
    notification_body := '"' || project_record.name || '" actualizo fechas a inicio '
      || coalesce(new.metadata ->> 'toStartDate', 'Sin fecha')
      || ' y fin '
      || coalesce(new.metadata ->> 'toEndDate', 'Sin fecha')
      || '.';
  end if;

  insert into public.user_notifications (
    profile_id,
    source_kind,
    source_event_id,
    domain,
    title,
    body,
    href,
    created_at
  )
  select distinct
    viewer.id,
    'project_activity',
    new.id,
    'delivery',
    notification_title,
    notification_body,
    case
      when viewer.role = 'sales_manager' then '/dashboard/notifications'
      else '/dashboard/projects'
    end,
    new.created_at
  from public.user_profiles viewer
  where viewer.is_active = true
    and viewer.id is distinct from new.actor_profile_id
    and (
      viewer.role in ('admin', 'sales_manager')
      or (
        project_record.pm_legacy_user_id is not null
        and viewer.legacy_mock_id = project_record.pm_legacy_user_id
      )
    )
  on conflict (profile_id, source_kind, source_event_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_lead_activities_notifications_after_insert on public.lead_activities;
create trigger trg_lead_activities_notifications_after_insert
after insert on public.lead_activities
for each row
execute function public.handle_lead_activity_notifications();

drop trigger if exists trg_task_activities_notifications_after_insert on public.task_activities;
create trigger trg_task_activities_notifications_after_insert
after insert on public.task_activities
for each row
execute function public.handle_task_activity_notifications();

drop trigger if exists trg_project_activities_notifications_after_insert on public.project_activities;
create trigger trg_project_activities_notifications_after_insert
after insert on public.project_activities
for each row
execute function public.handle_project_activity_notifications();

alter table public.user_notifications enable row level security;

grant select, update (is_read, read_at) on public.user_notifications to authenticated;

create policy "user_notifications_select_own"
on public.user_notifications
for select
to authenticated
using (profile_id = auth.uid());

create policy "user_notifications_mark_read_own"
on public.user_notifications
for update
to authenticated
using (profile_id = auth.uid())
with check (
  profile_id = auth.uid()
  and is_read = true
  and read_at is not null
);

commit;
begin;

drop policy if exists "projects_select_delivery_scope" on public.projects;

create policy "projects_select_delivery_scope"
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
        viewer.role in ('admin', 'sales_manager', 'pm')
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
        or (
          viewer.role = 'developer'
          and viewer.legacy_mock_id is not null
          and (
            viewer.legacy_mock_id = any (coalesce(projects.team_legacy_user_ids, '{}'::text[]))
            or exists (
              select 1
              from public.tasks task
              where task.project_id = projects.id
                and task.assigned_legacy_user_id = viewer.legacy_mock_id
            )
          )
        )
      )
  )
);

commit;
begin;

create type public.wallet_entry_type as enum (
  'free_grant',
  'earnings_credit',
  'manual_adjustment',
  'prototype_request_debit',
  'prototype_continue_debit'
);

create type public.wallet_bucket as enum (
  'free',
  'earned'
);

create type public.prototype_stage as enum (
  'sales',
  'delivery'
);

create type public.prototype_workspace_status as enum (
  'pending_generation',
  'ready',
  'delivery_active',
  'archived'
);

create table public.prototype_credit_settings (
  singleton_key boolean primary key default true check (singleton_key = true),
  request_cost integer not null check (request_cost > 0),
  updated_by_profile_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_prototype_credit_settings_updated_at
before update on public.prototype_credit_settings
for each row
execute function public.set_updated_at();

create table public.user_wallets (
  profile_id uuid primary key references public.user_profiles(id) on delete cascade,
  free_credits_balance integer not null default 0 check (free_credits_balance >= 0),
  earned_credits_balance integer not null default 0 check (earned_credits_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_wallets_updated_at
before update on public.user_wallets
for each row
execute function public.set_updated_at();

create table public.prototype_workspaces (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  requested_by_profile_id uuid not null references public.user_profiles(id) on delete restrict,
  current_stage public.prototype_stage not null default 'sales',
  status public.prototype_workspace_status not null default 'pending_generation',
  last_operation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_prototype_workspaces_project_id
on public.prototype_workspaces(project_id);

create index idx_prototype_workspaces_requested_by_profile_id
on public.prototype_workspaces(requested_by_profile_id);

create index idx_prototype_workspaces_created_at
on public.prototype_workspaces(created_at desc);

create trigger trg_prototype_workspaces_updated_at
before update on public.prototype_workspaces
for each row
execute function public.set_updated_at();

create table public.user_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.user_profiles(id) on delete cascade,
  entry_type public.wallet_entry_type not null,
  bucket public.wallet_bucket not null,
  delta_credits integer not null check (delta_credits <> 0),
  operation_id uuid not null,
  actor_profile_id uuid references public.user_profiles(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  prototype_workspace_id uuid references public.prototype_workspaces(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_wallet_entries_prototype_reference check (
    (
      entry_type in ('prototype_request_debit', 'prototype_continue_debit')
      and lead_id is not null
      and prototype_workspace_id is not null
    )
    or entry_type not in ('prototype_request_debit', 'prototype_continue_debit')
  )
);

create index idx_user_wallet_entries_profile_created_at
on public.user_wallet_entries(profile_id, created_at desc);

create index idx_user_wallet_entries_operation_id
on public.user_wallet_entries(operation_id);

create index idx_user_wallet_entries_lead_id
on public.user_wallet_entries(lead_id);

create index idx_user_wallet_entries_prototype_workspace_id
on public.user_wallet_entries(prototype_workspace_id);

alter table public.prototype_credit_settings enable row level security;
alter table public.user_wallets enable row level security;
alter table public.prototype_workspaces enable row level security;
alter table public.user_wallet_entries enable row level security;

grant select on public.prototype_credit_settings to authenticated;
grant select on public.user_wallets to authenticated;
grant select on public.prototype_workspaces to authenticated;
grant select on public.user_wallet_entries to authenticated;

create policy "prototype_credit_settings_select_authenticated"
on public.prototype_credit_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
  )
);

create policy "user_wallets_select_self"
on public.user_wallets
for select
to authenticated
using (
  profile_id = auth.uid()
  and exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
  )
);

create policy "prototype_workspaces_select_visible_scope"
on public.prototype_workspaces
for select
to authenticated
using (
  requested_by_profile_id = auth.uid()
  or exists (
    select 1
    from public.leads visible_lead
    where visible_lead.id = prototype_workspaces.lead_id
  )
  or (
    prototype_workspaces.project_id is not null
    and exists (
      select 1
      from public.projects visible_project
      where visible_project.id = prototype_workspaces.project_id
    )
  )
);

create policy "user_wallet_entries_select_self"
on public.user_wallet_entries
for select
to authenticated
using (
  profile_id = auth.uid()
  and exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
  )
);

create or replace function public.ensure_current_user_wallet()
returns public.user_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_profile public.user_profiles%rowtype;
  wallet_row public.user_wallets%rowtype;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select *
  into current_profile
  from public.user_profiles profile
  where profile.id = current_user_id
    and profile.is_active = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  insert into public.user_wallets (profile_id)
  values (current_user_id)
  on conflict (profile_id) do nothing;

  select *
  into wallet_row
  from public.user_wallets wallet
  where wallet.profile_id = current_user_id;

  return wallet_row;
end;
$$;

create or replace function public.request_lead_prototype(target_lead_id uuid)
returns table (
  prototype_workspace_id uuid,
  consumed_free integer,
  consumed_earned integer,
  free_balance integer,
  earned_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_profile public.user_profiles%rowtype;
  target_lead public.leads%rowtype;
  wallet_row public.user_wallets%rowtype;
  configured_cost integer;
  existing_workspace_id uuid;
  next_workspace_id uuid;
  next_operation_id uuid := gen_random_uuid();
  free_to_consume integer := 0;
  earned_to_consume integer := 0;
  remaining_cost integer := 0;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select *
  into current_profile
  from public.user_profiles profile
  where profile.id = current_user_id
    and profile.is_active = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if current_profile.role not in ('admin', 'sales_manager', 'sales') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select *
  into target_lead
  from public.leads lead
  where lead.id = target_lead_id
    and (
      current_profile.role in ('admin', 'sales_manager')
      or (
        current_profile.role = 'sales'
        and (
          lead.assigned_to = current_user_id
          or (
            lead.created_by = current_user_id
            and lead.assigned_to is null
            and lead.assignment_status <> 'released_no_response'
          )
        )
      )
    );

  if not found then
    raise exception using errcode = 'P0001', message = 'LEAD_NOT_FOUND';
  end if;

  select settings.request_cost
  into configured_cost
  from public.prototype_credit_settings settings
  where settings.singleton_key = true;

  if configured_cost is null then
    raise exception using errcode = 'P0001', message = 'PROTOTYPE_REQUEST_NOT_CONFIGURED';
  end if;

  select workspace.id
  into existing_workspace_id
  from public.prototype_workspaces workspace
  where workspace.lead_id = target_lead_id
  limit 1;

  if existing_workspace_id is not null then
    raise exception using errcode = 'P0001', message = 'PROTOTYPE_WORKSPACE_EXISTS';
  end if;

  insert into public.user_wallets (profile_id)
  values (current_user_id)
  on conflict (profile_id) do nothing;

  select *
  into wallet_row
  from public.user_wallets wallet
  where wallet.profile_id = current_user_id
  for update;

  if (wallet_row.free_credits_balance + wallet_row.earned_credits_balance) < configured_cost then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_CREDITS';
  end if;

  insert into public.prototype_workspaces (
    lead_id,
    requested_by_profile_id,
    current_stage,
    status,
    last_operation_id
  )
  values (
    target_lead_id,
    current_user_id,
    'sales',
    'pending_generation',
    next_operation_id
  )
  returning id into next_workspace_id;

  free_to_consume := least(wallet_row.free_credits_balance, configured_cost);
  remaining_cost := configured_cost - free_to_consume;
  earned_to_consume := least(wallet_row.earned_credits_balance, remaining_cost);

  update public.user_wallets wallet
  set
    free_credits_balance = wallet.free_credits_balance - free_to_consume,
    earned_credits_balance = wallet.earned_credits_balance - earned_to_consume,
    updated_at = clock_timestamp()
  where wallet.profile_id = current_user_id
  returning *
  into wallet_row;

  if free_to_consume > 0 then
    insert into public.user_wallet_entries (
      profile_id,
      entry_type,
      bucket,
      delta_credits,
      operation_id,
      actor_profile_id,
      lead_id,
      prototype_workspace_id,
      metadata,
      created_at
    )
    values (
      current_user_id,
      'prototype_request_debit',
      'free',
      free_to_consume * -1,
      next_operation_id,
      current_user_id,
      target_lead_id,
      next_workspace_id,
      jsonb_build_object(
        'leadName', target_lead.name,
        'requestCost', configured_cost,
        'stage', 'sales'
      ),
      clock_timestamp()
    );
  end if;

  if earned_to_consume > 0 then
    insert into public.user_wallet_entries (
      profile_id,
      entry_type,
      bucket,
      delta_credits,
      operation_id,
      actor_profile_id,
      lead_id,
      prototype_workspace_id,
      metadata,
      created_at
    )
    values (
      current_user_id,
      'prototype_request_debit',
      'earned',
      earned_to_consume * -1,
      next_operation_id,
      current_user_id,
      target_lead_id,
      next_workspace_id,
      jsonb_build_object(
        'leadName', target_lead.name,
        'requestCost', configured_cost,
        'stage', 'sales'
      ),
      clock_timestamp()
    );
  end if;

  return query
  select
    next_workspace_id,
    free_to_consume,
    earned_to_consume,
    wallet_row.free_credits_balance,
    wallet_row.earned_credits_balance;
end;
$$;

revoke all on function public.ensure_current_user_wallet() from public;
grant execute on function public.ensure_current_user_wallet() to authenticated;

revoke all on function public.request_lead_prototype(uuid) from public;
grant execute on function public.request_lead_prototype(uuid) to authenticated;

commit;
begin;

create or replace function public.handoff_prototype_workspace_to_delivery(target_workspace_id uuid)
returns public.prototype_workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_profile public.user_profiles%rowtype;
  workspace_row public.prototype_workspaces%rowtype;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select *
  into current_profile
  from public.user_profiles profile
  where profile.id = current_user_id
    and profile.is_active = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if current_profile.role not in ('admin', 'pm') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select *
  into workspace_row
  from public.prototype_workspaces workspace
  where workspace.id = target_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROTOTYPE_WORKSPACE_NOT_FOUND';
  end if;

  if workspace_row.project_id is null then
    raise exception using errcode = 'P0001', message = 'PROJECT_REQUIRED_FOR_HANDOFF';
  end if;

  if workspace_row.current_stage = 'delivery' then
    raise exception using errcode = 'P0001', message = 'PROTOTYPE_ALREADY_IN_DELIVERY';
  end if;

  if workspace_row.current_stage <> 'sales' or workspace_row.status <> 'pending_generation' then
    raise exception using errcode = 'P0001', message = 'INVALID_PROTOTYPE_HANDOFF_STATE';
  end if;

  update public.prototype_workspaces workspace
  set
    current_stage = 'delivery',
    updated_at = clock_timestamp()
  where workspace.id = target_workspace_id
  returning *
  into workspace_row;

  return workspace_row;
end;
$$;

revoke all on function public.handoff_prototype_workspace_to_delivery(uuid) from public;
grant execute on function public.handoff_prototype_workspace_to_delivery(uuid) to authenticated;

commit;
begin;

create or replace function public.link_lead_prototype_workspace_to_project(
  target_lead_id uuid,
  target_project_id uuid
)
returns table (
  prototype_workspace_id uuid,
  linked_project_id uuid,
  link_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_profile public.user_profiles%rowtype;
  target_project public.projects%rowtype;
  target_lead public.leads%rowtype;
  workspace_row public.prototype_workspaces%rowtype;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select *
  into current_profile
  from public.user_profiles profile
  where profile.id = current_user_id
    and profile.is_active = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  if current_profile.role not in ('admin', 'sales_manager', 'sales', 'pm') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  select *
  into target_project
  from public.projects project
  where project.id = target_project_id;

  if not found or target_project.source_lead_id is distinct from target_lead_id then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND_OR_MISMATCH';
  end if;

  if current_profile.role = 'sales' then
    select *
    into target_lead
    from public.leads lead
    where lead.id = target_lead_id
      and (
        lead.assigned_to = current_user_id
        or (
          lead.created_by = current_user_id
          and lead.assigned_to is null
          and lead.assignment_status <> 'released_no_response'
        )
      );

    if not found then
      raise exception using errcode = 'P0001', message = 'FORBIDDEN';
    end if;
  end if;

  select *
  into workspace_row
  from public.prototype_workspaces workspace
  where workspace.lead_id = target_lead_id
  for update;

  if not found then
    return query
    select null::uuid, null::uuid, 'missing_workspace'::text;
    return;
  end if;

  if workspace_row.project_id is null then
    update public.prototype_workspaces workspace
    set
      project_id = target_project_id,
      updated_at = clock_timestamp()
    where workspace.id = workspace_row.id
    returning *
    into workspace_row;

    return query
    select workspace_row.id, workspace_row.project_id, 'linked'::text;
    return;
  end if;

  if workspace_row.project_id = target_project_id then
    return query
    select workspace_row.id, workspace_row.project_id, 'already_linked_same_project'::text;
    return;
  end if;

  return query
  select workspace_row.id, workspace_row.project_id, 'already_linked_other_project'::text;
end;
$$;

revoke all on function public.link_lead_prototype_workspace_to_project(uuid, uuid) from public;
grant execute on function public.link_lead_prototype_workspace_to_project(uuid, uuid) to authenticated;

commit;
begin;

-- Phase 8A: record an explicit status_changed lead activity when a project
-- insert transitions the lead to 'won'. The existing trigger already updates
-- the lead row and logs project_created, but it does not record the status
-- change as a separate timeline entry. This migration replaces the trigger
-- function to add that entry only when the lead was not already 'won'.

create or replace function public.handle_project_insert_side_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prior_lead_status public.lead_status;
begin
  if new.source_lead_id is null then
    return new;
  end if;

  -- Capture the lead's current status before updating it.
  select status
  into prior_lead_status
  from public.leads
  where id = new.source_lead_id;

  -- Log the project_created activity.
  perform public.log_lead_activity(
    new.source_lead_id,
    'project_created',
    coalesce(auth.uid(), new.created_by),
    null,
    jsonb_build_object(
      'projectId',     new.id,
      'projectName',   new.name,
      'proposalId',    new.source_proposal_id,
      'projectStatus', new.status
    ),
    new.created_at
  );

  -- Update the lead status to won.
  update public.leads
  set status = 'won'
  where id = new.source_lead_id
    and status <> 'won';

  -- Log the status_changed activity only when the lead was not already won.
  if prior_lead_status is not null and prior_lead_status <> 'won' then
    perform public.log_lead_activity(
      new.source_lead_id,
      'status_changed',
      coalesce(auth.uid(), new.created_by),
      null,
      jsonb_build_object(
        'fromStatus', prior_lead_status::text,
        'toStatus',   'won'
      ),
      new.created_at
    );
  end if;

  return new;
end;
$$;

commit;
