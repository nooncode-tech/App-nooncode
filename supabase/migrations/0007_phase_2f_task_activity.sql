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
