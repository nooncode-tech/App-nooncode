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
