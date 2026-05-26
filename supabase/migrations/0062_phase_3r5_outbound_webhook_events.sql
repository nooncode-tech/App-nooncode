-- Phase 3 R5 (G23): outbound webhook ledger for `proposal_review_decision`.
-- See ADR-027 for rationale and the full D1-D12 firm decision pack.
-- Mirrors ADR-016 anatomy (inbound ledger) for the OUTBOUND direction:
--   - Sibling table to `website_webhook_events` (inbound), distinct schema.
--   - State machine: `pending | delivered | dead_letter | replayed` (ADR-027 D2).
--   - RLS posture: admin-only SELECT; ALL writes flow via `service_role`.
--   - Soft FKs on `link_id`, `proposal_id` (no FK constraint — forensic durability;
--     a row deletion on the partner tables must not cascade-purge audit history).
--   - Hash-only payload posture (no raw JSON bytes stored). PII surface unchanged
--     vs ADR-016 D7.
--
-- Retention: documented 180-day policy aligned with the inbound ledger (ADR-016 D8).
-- Cleanup cron deferred to a future iteration.

create table if not exists public.outbound_webhook_events (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null
    check (endpoint in ('proposal-review-decision')),
  external_proposal_id text not null,
  decision text not null
    check (decision in ('approved','rejected','changes_requested','cancelled')),
  link_id uuid,
  proposal_id uuid,
  status text not null default 'pending'
    check (status in ('pending','delivered','dead_letter','replayed')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  max_attempts integer not null default 3
    check (max_attempts > 0),
  next_retry_at timestamptz,
  last_attempted_at timestamptz,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  replayed_at timestamptz,
  replayed_by_event_id uuid,
  last_error text,
  last_http_status integer,
  payload_hash text not null,
  signature_header text,
  idempotency_key text not null,
  request_id text,
  actor_id uuid,
  alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `alerted_at` (ADR-027 D6, additive on top of the locked D2 column set):
-- timestamped when the `webhook-failure-alert` cron has enqueued admin
-- notifications for a `dead_letter` row. Functionally identical dedupe is
-- already provided by `enqueue_user_notification`'s
-- (profile_id, source_kind, source_event_id) UNIQUE constraint, but
-- persisting the marker on the ledger row keeps the cron's scan cheap
-- (it can filter `alerted_at IS NULL` instead of revisiting every old
-- dead-letter row for an RPC-level no-op).

comment on table public.outbound_webhook_events is
  'Outbound webhook delivery ledger (ADR-027). Mirrors website_webhook_events anatomy for the outbound direction.';

-- Indexes (ADR-027 D2 § Indexes — verbatim).
create index if not exists outbound_webhook_events_pending_retry_idx
  on public.outbound_webhook_events (next_retry_at)
  where status = 'pending' and next_retry_at is not null;

create index if not exists outbound_webhook_events_external_proposal_idx
  on public.outbound_webhook_events (external_proposal_id);

create index if not exists outbound_webhook_events_idempotency_key_idx
  on public.outbound_webhook_events (idempotency_key);

create index if not exists outbound_webhook_events_status_idx
  on public.outbound_webhook_events (status);

create index if not exists outbound_webhook_events_link_idx
  on public.outbound_webhook_events (link_id)
  where link_id is not null;

create index if not exists outbound_webhook_events_dead_lettered_at_idx
  on public.outbound_webhook_events (dead_lettered_at desc)
  where dead_lettered_at is not null;

create index if not exists outbound_webhook_events_created_at_idx
  on public.outbound_webhook_events (created_at desc);

-- Trigger: maintain updated_at on every UPDATE (reuses existing helper
-- public.set_updated_at created by earlier phases — see 0001/0002/0034).
drop trigger if exists outbound_webhook_events_set_updated_at on public.outbound_webhook_events;
create trigger outbound_webhook_events_set_updated_at
  before update on public.outbound_webhook_events
  for each row
  execute function public.set_updated_at();

-- RLS: admin-only SELECT. NO insert/update/delete policies — all writes via
-- service_role (createSupabaseAdminClient). Mirrors ADR-016 D7 verbatim.
alter table public.outbound_webhook_events enable row level security;

drop policy if exists "outbound_webhook_events_admin_read"
  on public.outbound_webhook_events;
create policy "outbound_webhook_events_admin_read"
  on public.outbound_webhook_events
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

grant select on public.outbound_webhook_events to authenticated;
grant all on public.outbound_webhook_events to service_role;
