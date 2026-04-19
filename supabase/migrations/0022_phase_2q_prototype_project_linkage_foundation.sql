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
