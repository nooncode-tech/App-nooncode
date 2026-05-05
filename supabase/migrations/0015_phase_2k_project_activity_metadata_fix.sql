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
