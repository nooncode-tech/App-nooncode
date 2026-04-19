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
