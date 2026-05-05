begin;

drop policy if exists "tasks_select_delivery_scope" on public.tasks;

create policy "tasks_select_delivery_scope"
on public.tasks
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
        or tasks.assigned_legacy_user_id = viewer.legacy_mock_id
      )
  )
);

commit;
