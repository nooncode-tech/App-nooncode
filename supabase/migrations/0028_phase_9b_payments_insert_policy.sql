begin;

-- Allow authenticated sales roles to insert payment records and stripe customers
grant insert on public.payments to authenticated;
grant insert on public.stripe_customers to authenticated;

create policy "payments_insert_sales_scope"
on public.payments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'sales')
  )
);

create policy "stripe_customers_insert_sales_scope"
on public.stripe_customers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'sales')
  )
);

commit;
