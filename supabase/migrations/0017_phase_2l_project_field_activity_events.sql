begin;

alter type public.project_activity_type add value if not exists 'pm_changed';
alter type public.project_activity_type add value if not exists 'team_changed';
alter type public.project_activity_type add value if not exists 'schedule_changed';

create or replace function public.normalize_legacy_user_ids(input_ids text[])
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_agg(distinct normalized_id order by normalized_id),
    '{}'::text[]
  )
  from (
    select nullif(trim(raw_id), '') as normalized_id
    from unnest(coalesce(input_ids, '{}'::text[])) as raw_ids(raw_id)
  ) normalized
  where normalized_id is not null;
$$;

create or replace function public.find_profile_name_by_legacy_mock_id(target_legacy_mock_id text)
returns text
language sql
stable
set search_path = public
as $$
  select profile.full_name
  from public.user_profiles profile
  where profile.legacy_mock_id = target_legacy_mock_id
  limit 1;
$$;

create or replace function public.collect_profile_names_by_legacy_mock_ids(target_legacy_mock_ids text[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(result.full_name order by result.full_name),
    '[]'::jsonb
  )
  from (
    select distinct profile.full_name
    from public.user_profiles profile
    where profile.legacy_mock_id = any (public.normalize_legacy_user_ids(target_legacy_mock_ids))
  ) result;
$$;

create or replace function public.handle_project_update_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  normalized_old_team_ids text[];
  normalized_new_team_ids text[];
begin
  actor_id := coalesce(auth.uid(), new.created_by, old.created_by);
  normalized_old_team_ids := public.normalize_legacy_user_ids(old.team_legacy_user_ids);
  normalized_new_team_ids := public.normalize_legacy_user_ids(new.team_legacy_user_ids);

  if new.status is distinct from old.status then
    perform public.log_project_activity(
      new.id,
      'status_changed',
      actor_id,
      jsonb_build_object(
        'projectName', new.name,
        'fromStatus', old.status,
        'toStatus', new.status
      ),
      clock_timestamp()
    );
  end if;

  if new.pm_legacy_user_id is distinct from old.pm_legacy_user_id then
    perform public.log_project_activity(
      new.id,
      'pm_changed',
      actor_id,
      jsonb_build_object(
        'projectName', new.name,
        'fromPmId', old.pm_legacy_user_id,
        'toPmId', new.pm_legacy_user_id,
        'fromPmName', public.find_profile_name_by_legacy_mock_id(old.pm_legacy_user_id),
        'toPmName', public.find_profile_name_by_legacy_mock_id(new.pm_legacy_user_id)
      ),
      clock_timestamp()
    );
  end if;

  if normalized_new_team_ids is distinct from normalized_old_team_ids then
    perform public.log_project_activity(
      new.id,
      'team_changed',
      actor_id,
      jsonb_build_object(
        'projectName', new.name,
        'fromTeamIds', to_jsonb(normalized_old_team_ids),
        'toTeamIds', to_jsonb(normalized_new_team_ids),
        'fromTeamNames', public.collect_profile_names_by_legacy_mock_ids(normalized_old_team_ids),
        'toTeamNames', public.collect_profile_names_by_legacy_mock_ids(normalized_new_team_ids)
      ),
      clock_timestamp()
    );
  end if;

  if new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    perform public.log_project_activity(
      new.id,
      'schedule_changed',
      actor_id,
      jsonb_build_object(
        'projectName', new.name,
        'fromStartDate', old.start_date,
        'toStartDate', new.start_date,
        'fromEndDate', old.end_date,
        'toEndDate', new.end_date
      ),
      clock_timestamp()
    );
  end if;

  return new;
end;
$$;

commit;
