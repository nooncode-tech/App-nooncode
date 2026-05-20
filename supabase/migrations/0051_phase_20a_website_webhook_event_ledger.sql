-- Phase 20a: transport-level idempotency ledger for NoonWeb v1 inbound webhooks.
-- See ADR-016 for rationale. Identity key is (endpoint, signature_hash); see D2.
-- Retention: 180 days documented policy; cleanup cron deferred to B15-bis.

create table if not exists public.website_webhook_events (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null check (endpoint in ('inbound-proposal','payment-confirmed')),
  signature_hash text not null,
  payload_hash text not null,
  signature_header text not null,
  request_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failed_at timestamptz,
  status text not null default 'processing'
    check (status in ('processing','processed','failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error text,
  external_session_id text,
  external_proposal_id text,
  external_payment_id text,
  link_id uuid
);

create unique index if not exists website_webhook_events_endpoint_signature_hash_key
  on public.website_webhook_events (endpoint, signature_hash);

create index if not exists website_webhook_events_received_at_idx
  on public.website_webhook_events (received_at desc);

create index if not exists website_webhook_events_status_idx
  on public.website_webhook_events (status);

create index if not exists website_webhook_events_endpoint_idx
  on public.website_webhook_events (endpoint);

create index if not exists website_webhook_events_external_session_id_idx
  on public.website_webhook_events (external_session_id)
  where external_session_id is not null;

alter table public.website_webhook_events enable row level security;

drop policy if exists "website_webhook_events_admin_read" on public.website_webhook_events;
create policy "website_webhook_events_admin_read"
  on public.website_webhook_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles profile
      where profile.id = auth.uid()
        and profile.role = 'admin'
        and profile.is_active = true
    )
  );
