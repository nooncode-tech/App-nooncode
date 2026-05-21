-- Phase 22a — GDPR sentinel profile (B16 Art. 17 erasure anchor)
--
-- Pre-seeds a fixed `auth.users` + `user_profiles` row pair used as the
-- sentinel target for ANONYMIZE-in-place actor columns during GDPR Art. 17
-- erasure (ADR-019 §D1). The sentinel UUID `00000000-0000-0000-0000-
-- 000000000000` is the RFC 4122 nil UUID, guaranteed never to collide with
-- a `gen_random_uuid()` value.
--
-- The `auth.users` row has no password and no confirmed email; it cannot
-- authenticate. The matching `user_profiles` row carries `is_active = false`
-- so it is hidden from active-user queries.
--
-- Idempotent: `on conflict do nothing` on both inserts. Safe to re-apply.
--
-- Verification (post-apply):
--   select id, email from auth.users
--     where id = '00000000-0000-0000-0000-000000000000';
--   select id, email, role, is_active, legacy_mock_id from public.user_profiles
--     where id = '00000000-0000-0000-0000-000000000000';
--
-- Rollback (operational, DO NOT RUN unless backing out B16 entirely):
--   DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000';
--   -- cascades to user_profiles by FK (migration 0001 §22)
--
-- References:
--   - docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md §D1, §D4
--   - specs/fase-3-b16-gdpr-art-15-17.md §Architecture Decisions
--   - RFC 4122 §4.1.7 (nil UUID), RFC 6761 §6.4 (.invalid TLD)
--
-- Backend verification note (ADR-019 §D4 binding):
--   The `auth.users` column list below matches Supabase's documented shape
--   as of GoTrue v2.x at the time this migration was authored. If Supabase
--   has added a NOT NULL column without a default since then, this INSERT
--   will fail; extend the column list with an explicit NULL or default
--   value and document the extension in this header comment.

begin;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'deleted-user@noon.invalid',
  null,
  null,
  now(),
  now(),
  jsonb_build_object('provider', 'sentinel', 'providers', jsonb_build_array('sentinel')),
  jsonb_build_object('purpose', 'gdpr-erasure-sentinel'),
  false,
  false,
  false
)
on conflict (id) do nothing;

insert into public.user_profiles (
  id,
  email,
  full_name,
  role,
  is_active,
  legacy_mock_id,
  locale,
  timezone
) values (
  '00000000-0000-0000-0000-000000000000',
  'deleted-user@noon.invalid',
  'Deleted User',
  'developer',
  false,
  'gdpr-sentinel',
  'es-MX',
  'America/Mexico_City'
)
on conflict (id) do nothing;

commit;
