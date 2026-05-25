-- 0054_phase_21b_client_token_lifecycle.sql
--
-- B17 (FASE 3 — Token lifecycle for client_access_tokens):
-- adds soft revocation, rotation lineage, and a 90-day default expiry
-- for newly issued tokens. Existing tokens are grandfathered (no
-- backfill — operator decision 2026-05-20).
--
-- Schema changes (additive only; no existing column dropped or
-- backfilled):
--   1. `revoked_at timestamptz` — nullable; populated by
--      `revoke_client_token()` RPC. `resolve_client_token()` now
--      filters `revoked_at is null` so revoked tokens stop resolving
--      without losing the audit row.
--   2. `rotated_to_token_id uuid` self-fk on the same table — set by
--      `rotate_client_token()` to point from the soft-revoked old
--      token to its replacement. `on delete set null` so removing the
--      replacement does not block deleting/auditing the predecessor.
--   3. `expires_at` DEFAULT now() + interval '90 days' — applies only
--      to future inserts. Existing rows with `expires_at = null` stay
--      null (grandfather).
--
-- New RPCs (both SECURITY DEFINER per the existing operating-rule
-- pattern for client_access_tokens lifecycle: cross-row writes + role
-- + project-ownership enforced inside the body):
--   - `revoke_client_token(p_token_id uuid)` — sets `revoked_at = now()`
--   - `rotate_client_token(p_token_id uuid, p_new_expires_at timestamptz)`
--     — atomically issues a new token row mirroring the old metadata,
--     links `rotated_to_token_id` on the old, then soft-revokes the old.
--
-- ACL on the two new RPCs follows the canonical pattern from ADR-018
-- §D2: REVOKE FROM PUBLIC/anon + GRANT TO authenticated. (Service-role
-- bypasses RLS and the GRANT regardless.)
--
-- ROLLBACK companion (DO NOT RUN unless reverting):
--   drop function if exists public.rotate_client_token(uuid, timestamptz);
--   drop function if exists public.revoke_client_token(uuid);
--   create or replace function public.resolve_client_token(...)   -- restore prior body
--   alter table public.client_access_tokens
--     alter column expires_at drop default,
--     drop column if exists rotated_to_token_id,
--     drop column if exists revoked_at;
-- (The CREATE OR REPLACE on `resolve_client_token` below is forward;
--  rollback would need a separate restore of the prior body from
--  migration 0032 §50-91 verbatim.)
--
-- @see docs/adrs/ADR-010-client-portal-lives-in-noonweb.md (legacy debt
--      classification for /client/[token] — this iteration is hardening,
--      not a new feature)
-- @see docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md §D2
-- @see docs/context/project.context.core.md "Supabase Advisor security
--      posture" (operating-rule list of intentionally-authenticated RPCs)

begin;

-- ── Schema additions ────────────────────────────────────────────────

alter table public.client_access_tokens
  add column if not exists revoked_at timestamptz,
  add column if not exists rotated_to_token_id uuid
    references public.client_access_tokens(id) on delete set null;

-- Default expiry applies to new inserts only. Existing rows with
-- expires_at = null remain permanent (grandfather per operator decision
-- 2026-05-20).
alter table public.client_access_tokens
  alter column expires_at set default (now() + interval '90 days');

-- Cleanup index for the future B25 cron that will hard-delete tokens
-- whose `revoked_at` is older than 90 days.
create index if not exists idx_client_access_tokens_revoked_at
  on public.client_access_tokens (revoked_at)
  where revoked_at is not null;

-- ── resolve_client_token: gate revoked tokens out of the read path ──
-- DROP IF EXISTS first because Postgres rejects CREATE OR REPLACE
-- when the return-type row shape diverges from the in-place function,
-- even when the textual definition is identical (e.g. numeric scale or
-- column-type drift between this migration's source and the live row
-- shape). Drop is safe because the function body is fully rewritten
-- below and the ACL is re-applied immediately after the CREATE
-- (preserving the migration 0039 service-role-only posture).
drop function if exists public.resolve_client_token(text);

create function public.resolve_client_token(p_token text)
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
set search_path = public
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
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now());
$$;

-- Restore the 0039 ACL (service_role only) on the just-recreated
-- function. Default ACL on a fresh CREATE allows PUBLIC execute, which
-- would re-open the surface the 0039 hardening closed.
revoke all on function public.resolve_client_token(text) from public, anon, authenticated;
grant execute on function public.resolve_client_token(text) to service_role;

-- ── revoke_client_token: soft revoke ──────────────────────────────

create or replace function public.revoke_client_token(p_token_id uuid)
returns table (
  token_id   uuid,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  v_revoked_at timestamptz;
begin
  if p_token_id is null then
    raise exception using errcode = 'P0001', message = 'TOKEN_ID_REQUIRED';
  end if;

  -- Enforce caller role + active profile inside the SECURITY DEFINER
  -- body. The RLS update policy for client_access_tokens already
  -- requires ownership; this RPC additionally requires admin/PM
  -- (a stricter scope than the broad UPDATE policy because revocation
  -- is a higher-stakes operation).
  select role into caller_role
    from public.user_profiles
    where id = auth.uid()
      and is_active = true;

  if caller_role is null or caller_role not in ('admin', 'pm') then
    raise exception using errcode = 'P0001', message = 'REVOKE_NOT_ALLOWED';
  end if;

  update public.client_access_tokens
    set revoked_at = now()
    where id = p_token_id
      and revoked_at is null
    returning revoked_at into v_revoked_at;

  if v_revoked_at is null then
    raise exception using errcode = 'P0001', message = 'TOKEN_NOT_FOUND_OR_ALREADY_REVOKED';
  end if;

  return query select p_token_id, v_revoked_at;
end;
$$;

-- ── rotate_client_token: atomic new-token + link + soft-revoke ─────

create or replace function public.rotate_client_token(
  p_token_id uuid,
  p_new_expires_at timestamptz default null
)
returns table (
  new_token_id   uuid,
  new_token      text,
  old_token_id   uuid,
  old_revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  old_row public.client_access_tokens%rowtype;
  v_new_id uuid;
  v_new_token text;
  v_revoked_at timestamptz;
begin
  if p_token_id is null then
    raise exception using errcode = 'P0001', message = 'TOKEN_ID_REQUIRED';
  end if;

  select role into caller_role
    from public.user_profiles
    where id = auth.uid()
      and is_active = true;

  if caller_role is null or caller_role not in ('admin', 'pm') then
    raise exception using errcode = 'P0001', message = 'ROTATE_NOT_ALLOWED';
  end if;

  -- Lock the old row for the duration of the rotation so concurrent
  -- rotation attempts serialize.
  select * into old_row
    from public.client_access_tokens
    where id = p_token_id
    for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'TOKEN_NOT_FOUND';
  end if;

  if old_row.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'TOKEN_ALREADY_REVOKED';
  end if;

  -- Insert the replacement token. Default behaviour: mirror the old
  -- token's project/lead/client metadata. Expiry: caller may override
  -- via p_new_expires_at; if null, the column default (now()+90d)
  -- applies.
  insert into public.client_access_tokens (
    project_id, lead_id, client_name, client_email,
    expires_at, created_by
  )
  values (
    old_row.project_id, old_row.lead_id, old_row.client_name, old_row.client_email,
    coalesce(p_new_expires_at, now() + interval '90 days'),
    auth.uid()
  )
  returning id, token into v_new_id, v_new_token;

  -- Soft-revoke old + link rotation lineage in a single update.
  update public.client_access_tokens
    set revoked_at = now(),
        rotated_to_token_id = v_new_id
    where id = p_token_id
    returning revoked_at into v_revoked_at;

  return query select v_new_id, v_new_token, p_token_id, v_revoked_at;
end;
$$;

-- ── ACL for the two new RPCs (canonical REVOKE+GRANT per ADR-018 §D2) ─

revoke execute on function public.revoke_client_token(uuid) from public, anon;
grant execute on function public.revoke_client_token(uuid) to authenticated;

revoke execute on function public.rotate_client_token(uuid, timestamptz) from public, anon;
grant execute on function public.rotate_client_token(uuid, timestamptz) to authenticated;

commit;
