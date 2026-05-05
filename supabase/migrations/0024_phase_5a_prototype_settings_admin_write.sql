begin;

-- Phase 5A: grant admin users write access to prototype_credit_settings.
-- The table was created in 0020 with select-only for authenticated users.
-- Admins need insert+update to configure the prototype request cost from the UI.

grant insert, update on public.prototype_credit_settings to authenticated;

create policy "prototype_credit_settings_upsert_admin"
on public.prototype_credit_settings
for all
to authenticated
using (
  exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active = true
  )
);

commit;
