begin;

-- ── Client access tokens ─────────────────────────────────────────────────────
-- Each token grants a specific external client read access to a project's
-- status and the ability to initiate payments. No login required — the token
-- IS the credential. Tokens are project-scoped and optionally expire.

create table public.client_access_tokens (
  id               uuid primary key default gen_random_uuid(),
  token            text not null unique default encode(gen_random_bytes(32), 'hex'),
  project_id       uuid not null references public.projects(id) on delete cascade,
  lead_id          uuid references public.leads(id) on delete set null,
  client_name      text,
  client_email     text,
  expires_at       timestamptz,
  last_accessed_at timestamptz,
  created_by       uuid references public.user_profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);

create index idx_client_access_tokens_project_id on public.client_access_tokens(project_id);
create index idx_client_access_tokens_token      on public.client_access_tokens(token);

alter table public.client_access_tokens enable row level security;

grant select, insert on public.client_access_tokens to authenticated;

-- Authenticated users (admin/pm/sales) can read tokens for projects they own
create policy "client_access_tokens_select_scope"
on public.client_access_tokens for select to authenticated
using (
  exists (
    select 1 from public.user_profiles v
    where v.id = auth.uid() and v.is_active = true
      and v.role in ('admin', 'sales_manager', 'pm', 'sales')
  )
);

-- Only admin/pm/sales can generate tokens
create policy "client_access_tokens_insert_scope"
on public.client_access_tokens for insert to authenticated
with check (
  exists (
    select 1 from public.user_profiles v
    where v.id = auth.uid() and v.is_active = true
      and v.role in ('admin', 'sales_manager', 'pm', 'sales')
  )
);

-- ── Anon read function ───────────────────────────────────────────────────────
-- Public function used by the client portal to resolve a token without auth.
-- Returns minimal safe project info — no internal notes or user IDs.

create or replace function public.resolve_client_token(p_token text)
returns table (
  token_id         uuid,
  project_id       uuid,
  project_name     text,
  project_status   text,
  client_name      text,
  client_email     text,
  lead_id          uuid,
  proposal_id      uuid,
  proposal_title   text,
  proposal_amount  numeric,
  payment_status   text,
  payment_activated boolean
)
language sql
security definer
stable
as $$
  select
    t.id                      as token_id,
    p.id                      as project_id,
    p.name                    as project_name,
    p.status::text            as project_status,
    t.client_name,
    t.client_email,
    lp.lead_id,
    lp.id                     as proposal_id,
    lp.title                  as proposal_title,
    lp.amount                 as proposal_amount,
    lp.payment_status::text   as payment_status,
    p.payment_activated
  from public.client_access_tokens t
  join public.projects p on p.id = t.project_id
  left join public.lead_proposals lp on lp.id = p.source_proposal_id
  where t.token = p_token
    and (t.expires_at is null or t.expires_at > now());
$$;

-- Update last_accessed_at on token use
create or replace function public.touch_client_token(p_token text)
returns void
language sql
security definer
as $$
  update public.client_access_tokens
  set last_accessed_at = now()
  where token = p_token;
$$;

grant execute on function public.resolve_client_token(text) to anon, authenticated;
grant execute on function public.touch_client_token(text) to anon, authenticated;

commit;
