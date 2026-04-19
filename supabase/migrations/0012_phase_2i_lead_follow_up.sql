begin;

alter table public.leads
add column next_follow_up_at timestamptz;

create index idx_leads_next_follow_up_at
on public.leads(next_follow_up_at)
where next_follow_up_at is not null;

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

  if old_row.next_follow_up_at is distinct from new_row.next_follow_up_at then
    changed_fields := array_append(changed_fields, 'nextFollowUpAt');
  end if;

  return changed_fields;
end;
$$;

commit;
