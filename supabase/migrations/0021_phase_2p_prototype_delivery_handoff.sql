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
