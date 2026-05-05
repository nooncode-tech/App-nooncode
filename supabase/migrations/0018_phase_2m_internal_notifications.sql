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
