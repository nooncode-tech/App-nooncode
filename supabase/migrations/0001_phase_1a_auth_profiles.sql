begin;

create type public.user_role as enum (
  'admin',
  'sales_manager',
  'sales',
  'pm',
  'developer'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  full_name text not null,
  role public.user_role not null,
  is_active boolean not null default true,
  avatar_url text,
  legacy_mock_id text unique,
  locale text not null default 'es-MX',
  timezone text not null default 'America/Mexico_City',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_user_profiles_role on public.user_profiles(role);
create index idx_user_profiles_active_role on public.user_profiles(is_active, role);

create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

grant select on public.user_profiles to authenticated;
grant update (full_name, avatar_url, locale, timezone, last_login_at)
on public.user_profiles
to authenticated;

create policy "profiles_select_self"
on public.user_profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles_update_self_limited"
on public.user_profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

commit;
