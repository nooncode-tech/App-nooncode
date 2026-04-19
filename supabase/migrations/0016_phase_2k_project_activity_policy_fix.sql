begin;

drop policy if exists "project_activities_select_visible_scope" on public.project_activities;

create policy "project_activities_select_visible_scope"
on public.project_activities
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'pm')
  )
  or exists (
    select 1
    from public.user_profiles viewer
    join public.projects project
      on project.id = project_activities.project_id
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        project.created_by = auth.uid()
        or exists (
          select 1
          from public.leads lead
          where lead.id = project.source_lead_id
            and (
              lead.assigned_to = auth.uid()
              or lead.created_by = auth.uid()
            )
        )
        or (
          viewer.role = 'developer'
          and viewer.legacy_mock_id is not null
          and (
            viewer.legacy_mock_id = any (coalesce(project.team_legacy_user_ids, '{}'::text[]))
            or exists (
              select 1
              from public.tasks task
              where task.project_id = project.id
                and task.assigned_legacy_user_id = viewer.legacy_mock_id
            )
          )
        )
      )
  )
);

commit;
