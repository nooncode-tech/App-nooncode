begin;

drop policy if exists "projects_select_mixed_scope" on public.projects;

create policy "projects_select_delivery_scope"
on public.projects
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'pm')
        or projects.created_by = auth.uid()
        or exists (
          select 1
          from public.leads lead
          where lead.id = projects.source_lead_id
            and (
              lead.assigned_to = auth.uid()
              or lead.created_by = auth.uid()
            )
        )
        or (
          viewer.role = 'developer'
          and viewer.legacy_mock_id is not null
          and (
            viewer.legacy_mock_id = any (coalesce(projects.team_legacy_user_ids, '{}'::text[]))
            or exists (
              select 1
              from public.tasks task
              where task.project_id = projects.id
                and task.assigned_legacy_user_id = viewer.legacy_mock_id
            )
          )
        )
      )
  )
);

commit;
