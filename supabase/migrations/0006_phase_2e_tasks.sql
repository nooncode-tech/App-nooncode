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
