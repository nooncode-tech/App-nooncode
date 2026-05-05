begin;

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
              and leads.assigned_to is null
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
              and leads.assigned_to is null
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
              and leads.assigned_to is null
              and leads.assignment_status <> 'released_no_response'
            )
          )
        )
      )
  )
);

commit;
