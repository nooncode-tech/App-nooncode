-- Phase 17A: production hardening foundation for Stripe webhook idempotency.
-- This table records only operational metadata, not full Stripe payloads.

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  api_version text,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failed_at timestamptz,
  last_error text
);

create index if not exists stripe_webhook_events_status_idx
  on public.stripe_webhook_events (status);

create index if not exists stripe_webhook_events_event_type_idx
  on public.stripe_webhook_events (event_type);

create index if not exists stripe_webhook_events_received_at_idx
  on public.stripe_webhook_events (received_at desc);

alter table public.stripe_webhook_events enable row level security;

drop policy if exists "stripe_webhook_events_admin_read" on public.stripe_webhook_events;
create policy "stripe_webhook_events_admin_read"
  on public.stripe_webhook_events
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
