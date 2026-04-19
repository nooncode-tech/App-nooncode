begin;

create type public.lead_activity_type as enum (
  'created',
  'updated',
  'status_changed',
  'note_added'
);

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type public.lead_activity_type not null,
  actor_profile_id uuid references public.user_profiles(id) on delete set null,
  note_body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint lead_activities_note_body_required check (
    (
      activity_type = 'note_added'
      and nullif(btrim(coalesce(note_body, '')), '') is not null
    )
    or activity_type <> 'note_added'
  )
);

create index idx_lead_activities_lead_id_created_at
on public.lead_activities(lead_id, created_at desc);

create index idx_lead_activities_actor_profile_id
on public.lead_activities(actor_profile_id);

create or replace function public.log_lead_activity(
  target_lead_id uuid,
  target_activity_type public.lead_activity_type,
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
  insert into public.lead_activities (
    lead_id,
    activity_type,
    actor_profile_id,
    note_body,
    metadata,
    created_at
  )
  values (
    target_lead_id,
    target_activity_type,
    target_actor_profile_id,
    target_note_body,
    coalesce(target_metadata, '{}'::jsonb),
    coalesce(target_created_at, now())
  );
end;
$$;

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

  return changed_fields;
end;
$$;

create or replace function public.log_lead_insert_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_lead_activity(
    new.id,
    'created',
    coalesce(auth.uid(), new.created_by),
    null,
    jsonb_build_object('status', new.status),
    new.created_at
  );

  return new;
end;
$$;

create or replace function public.log_lead_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_fields text[];
begin
  if old.status is distinct from new.status then
    perform public.log_lead_activity(
      new.id,
      'status_changed',
      auth.uid(),
      null,
      jsonb_build_object(
        'fromStatus', old.status,
        'toStatus', new.status
      ),
      now()
    );
  end if;

  changed_fields := public.collect_lead_update_fields(old, new);

  if coalesce(array_length(changed_fields, 1), 0) > 0 then
    perform public.log_lead_activity(
      new.id,
      'updated',
      auth.uid(),
      null,
      jsonb_build_object('changedFields', changed_fields),
      now()
    );
  end if;

  return new;
end;
$$;

create trigger trg_leads_log_insert_activity
after insert on public.leads
for each row
execute function public.log_lead_insert_activity();

create trigger trg_leads_log_update_activity
after update on public.leads
for each row
execute function public.log_lead_update_activity();

insert into public.lead_activities (
  lead_id,
  activity_type,
  actor_profile_id,
  metadata,
  created_at
)
select
  leads.id,
  'created'::public.lead_activity_type,
  leads.created_by,
  jsonb_build_object('status', leads.status, 'backfilled', true),
  leads.created_at
from public.leads
where not exists (
  select 1
  from public.lead_activities existing
  where existing.lead_id = leads.id
    and existing.activity_type = 'created'
);

alter table public.lead_activities enable row level security;

grant select, insert on public.lead_activities to authenticated;

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
      )
  )
);

create policy "lead_activities_insert_note_sales_scope"
on public.lead_activities
for insert
to authenticated
with check (
  activity_type = 'note_added'
  and actor_profile_id = auth.uid()
  and exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer
      on viewer.id = auth.uid()
    where lead.id = lead_activities.lead_id
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'sales')
      and (
        viewer.role in ('admin', 'sales_manager')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

commit;
