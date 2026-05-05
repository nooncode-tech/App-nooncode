-- Phase 14A: Website inbound integration bridge.
-- Noon Website and Noon App remain separate products; this table stores only
-- the operational handoff lineage needed by the App.

alter type public.proposal_review_status add value if not exists 'changes_requested';

create table if not exists public.website_inbound_links (
  id uuid primary key default gen_random_uuid(),
  external_source text not null default 'noon_website',
  external_session_id text not null,
  external_proposal_id text not null,
  external_payment_id text,
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  proposal_id uuid not null unique references public.lead_proposals(id) on delete cascade,
  project_id uuid unique references public.projects(id) on delete set null,
  current_status text not null default 'proposal_pending_review',
  review_webhook_status text,
  review_webhook_attempted_at timestamptz,
  review_webhook_sent_at timestamptz,
  review_webhook_error text,
  payment_confirmed_at timestamptz,
  inbound_payload jsonb not null default '{}'::jsonb,
  payment_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_inbound_links_external_session_unique unique (external_source, external_session_id),
  constraint website_inbound_links_external_proposal_unique unique (external_source, external_proposal_id),
  constraint website_inbound_links_current_status_check check (
    current_status in (
      'proposal_pending_review',
      'proposal_approved',
      'proposal_rejected',
      'proposal_changes_requested',
      'proposal_cancelled',
      'review_webhook_sent',
      'review_webhook_failed',
      'payment_confirmed',
      'project_activated'
    )
  ),
  constraint website_inbound_links_review_webhook_status_check check (
    review_webhook_status is null
    or review_webhook_status in ('pending', 'sent', 'failed', 'skipped')
  )
);

create unique index if not exists website_inbound_links_external_payment_unique
  on public.website_inbound_links (external_source, external_payment_id)
  where external_payment_id is not null;

create index if not exists website_inbound_links_current_status_idx
  on public.website_inbound_links (current_status);

create index if not exists website_inbound_links_created_at_idx
  on public.website_inbound_links (created_at desc);

drop trigger if exists website_inbound_links_set_updated_at on public.website_inbound_links;
create trigger website_inbound_links_set_updated_at
  before update on public.website_inbound_links
  for each row
  execute function public.set_updated_at();

alter table public.website_inbound_links enable row level security;

drop policy if exists "website inbound links admin pm read" on public.website_inbound_links;
create policy "website inbound links admin pm read"
  on public.website_inbound_links
  for select
  using (
    exists (
      select 1
      from public.user_profiles viewer
      where viewer.id = auth.uid()
        and viewer.is_active
        and viewer.role in ('admin', 'pm')
    )
  );

grant select on public.website_inbound_links to authenticated;
grant all on public.website_inbound_links to service_role;
