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
