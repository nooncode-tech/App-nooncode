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
