alter type public.lead_source add value if not exists 'maxwell';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'maxwell_publication_status') then
    create type public.maxwell_publication_status as enum (
      'published',
      'needs_review',
      'rejected',
      'refresh_needed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'maxwell_search_status') then
    create type public.maxwell_search_status as enum (
      'running',
      'completed',
      'insufficient',
      'needs_review',
      'failed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'maxwell_search_mode') then
    create type public.maxwell_search_mode as enum (
      'current_location',
      'manual_zone'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'maxwell_feedback_rating') then
    create type public.maxwell_feedback_rating as enum (
      'good',
      'bad',
      'duplicate',
      'not_relevant'
    );
  end if;
end $$;

create table if not exists public.maxwell_search_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.user_profiles(id) on delete cascade,
  mode public.maxwell_search_mode not null,
  center_latitude double precision,
  center_longitude double precision,
  zone_text text,
  radius_km integer not null check (radius_km > 0),
  locale text not null default 'es-MX',
  status public.maxwell_search_status not null default 'running',
  stage text not null default 'detecting_location',
  candidates_found integer not null default 0 check (candidates_found >= 0),
  candidates_audited integer not null default 0 check (candidates_audited >= 0),
  leads_published integer not null default 0 check (leads_published >= 0),
  leads_rejected integer not null default 0 check (leads_rejected >= 0),
  duplicates_found integer not null default 0 check (duplicates_found >= 0),
  message text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint maxwell_search_location_required check (
    (
      mode = 'current_location'
      and center_latitude is not null
      and center_longitude is not null
    )
    or (
      mode = 'manual_zone'
      and zone_text is not null
      and char_length(trim(zone_text)) > 0
    )
  )
);

create index if not exists idx_maxwell_search_runs_requested_by_created
on public.maxwell_search_runs(requested_by, created_at desc);

create index if not exists idx_maxwell_search_runs_status
on public.maxwell_search_runs(status);

alter table public.leads
  alter column email drop not null,
  add column if not exists publication_status public.maxwell_publication_status not null default 'published',
  add column if not exists maxwell_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists maxwell_search_run_id uuid references public.maxwell_search_runs(id) on delete set null,
  add column if not exists maxwell_expires_at timestamptz,
  add column if not exists maxwell_last_refreshed_at timestamptz,
  add column if not exists maxwell_dedupe_key text,
  add column if not exists maxwell_confidence text;

create index if not exists idx_leads_publication_status
on public.leads(publication_status);

create index if not exists idx_leads_maxwell_search_run_id
on public.leads(maxwell_search_run_id);

create unique index if not exists idx_leads_maxwell_dedupe_key_unique
on public.leads(maxwell_dedupe_key)
where maxwell_dedupe_key is not null;

create table if not exists public.maxwell_lead_feedback (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  search_run_id uuid references public.maxwell_search_runs(id) on delete set null,
  profile_id uuid not null references public.user_profiles(id) on delete cascade,
  rating public.maxwell_feedback_rating not null,
  note text,
  created_at timestamptz not null default now(),
  constraint maxwell_feedback_note_length check (note is null or char_length(note) <= 1000)
);

create index if not exists idx_maxwell_lead_feedback_lead_id
on public.maxwell_lead_feedback(lead_id, created_at desc);

create index if not exists idx_maxwell_lead_feedback_profile_id
on public.maxwell_lead_feedback(profile_id, created_at desc);

alter table public.maxwell_search_runs enable row level security;
alter table public.maxwell_lead_feedback enable row level security;

grant select, insert, update on public.maxwell_search_runs to authenticated;
grant select, insert on public.maxwell_lead_feedback to authenticated;

drop policy if exists "maxwell_search_runs_select_scope" on public.maxwell_search_runs;
create policy "maxwell_search_runs_select_scope"
on public.maxwell_search_runs
for select
to authenticated
using (
  requested_by = auth.uid()
  or exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'pm')
  )
);

drop policy if exists "maxwell_search_runs_insert_scope" on public.maxwell_search_runs;
create policy "maxwell_search_runs_insert_scope"
on public.maxwell_search_runs
for insert
to authenticated
with check (
  requested_by = auth.uid()
  and exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'sales', 'pm')
  )
);

drop policy if exists "maxwell_search_runs_update_scope" on public.maxwell_search_runs;
create policy "maxwell_search_runs_update_scope"
on public.maxwell_search_runs
for update
to authenticated
using (requested_by = auth.uid())
with check (requested_by = auth.uid());

drop policy if exists "maxwell_lead_feedback_select_scope" on public.maxwell_lead_feedback;
create policy "maxwell_lead_feedback_select_scope"
on public.maxwell_lead_feedback
for select
to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'sales_manager', 'pm')
  )
);

drop policy if exists "maxwell_lead_feedback_insert_scope" on public.maxwell_lead_feedback;
create policy "maxwell_lead_feedback_insert_scope"
on public.maxwell_lead_feedback
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and exists (
    select 1
    from public.leads lead
    join public.user_profiles viewer on viewer.id = auth.uid()
    where lead.id = maxwell_lead_feedback.lead_id
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager', 'pm')
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

create or replace function public.maxwell_confirmed_sales_count(p_profile_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct payment.id)::integer
  from public.payments payment
  join public.lead_proposals proposal on proposal.id = payment.proposal_id
  join public.leads lead on lead.id = proposal.lead_id
  where payment.status = 'succeeded'
    and (
      lead.assigned_to = p_profile_id
      or lead.created_by = p_profile_id
    );
$$;

revoke all on function public.maxwell_confirmed_sales_count(uuid) from public;
grant execute on function public.maxwell_confirmed_sales_count(uuid) to authenticated;
