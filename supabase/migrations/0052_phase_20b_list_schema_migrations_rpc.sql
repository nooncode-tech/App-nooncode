-- Phase 20b — list_schema_migrations RPC (B26 R5 resolution, Path B)
--
-- Resolves ADR-017 §R5 — the B26 migration-health endpoint's cross-schema
-- SELECT against `supabase_migrations.schema_migrations` fails on production
-- with PostgREST `Invalid schema: supabase_migrations` because that schema
-- is not in the project's exposed `db-schemas` list. Rather than widen the
-- PostgREST exposure surface (Path A), we bound privilege to one SECURITY
-- DEFINER function in `public` (Path B). See ADR-018.
--
-- Function ownership: implicit `postgres` (migration applier on Supabase-
-- managed projects). DEFINER runs as `postgres`, which has unrestricted
-- access to all schemas including `supabase_migrations`. Hardened
-- `search_path = pg_catalog, supabase_migrations` prevents a future
-- `public`-CREATE attacker from shadowing the read target.
--
-- Volatility: STABLE. Reads no app data, mutates nothing. The planner may
-- cache results within a transaction; the underlying ledger table changes
-- only when new migrations land via `supabase db push` or manual INSERT.
--
-- GRANT scope: service_role only. PUBLIC, anon, authenticated explicitly
-- REVOKEd defense-in-depth. The B26 admin route is the only caller-facing
-- gate; the RPC is unreachable for unauthenticated and authenticated
-- session-holders.
--
-- B26-SEC-F3 binding requirements (docs/validations/B26 security review
-- 2026-05-20.md §S12) satisfied by:
--   1. Standalone iteration spec
--      → specs/fase-2-c-b26-r5-followup-rpc-migration.md
--   2. Standalone migration file
--      → this file
--   3. Standalone security review of GRANT scope
--      → docs/validations/B26-R5 security review 2026-05-20.md
--   4. Reversible REVOKE+DROP companion
--      → the Rollback block below (pasteable verbatim)
--
-- Rollback (run as postgres or via Dashboard SQL Editor):
--   REVOKE EXECUTE ON FUNCTION public.list_schema_migrations() FROM service_role;
--   DROP FUNCTION IF EXISTS public.list_schema_migrations();
--
-- Ledger cleanup if migration was tracked via `supabase db push`:
--   DELETE FROM supabase_migrations.schema_migrations
--    WHERE version = '0052' AND name = 'phase_20b_list_schema_migrations_rpc';
--
-- References:
--   - docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md
--   - docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md §D4, §R5
--   - docs/adrs/ADR-014-migration-ledger-reconciliation.md (row format)
--   - supabase/migrations/0050_phase_19d_debit_wallet_for_refund_rpc.sql
--     (precedent shape: SECURITY DEFINER + GRANT EXECUTE + REVOKE)

begin;

drop function if exists public.list_schema_migrations();

create function public.list_schema_migrations()
returns table (
  version text,
  name text
)
language sql
stable
security definer
set search_path = pg_catalog, supabase_migrations
as $$
  select version, name
  from supabase_migrations.schema_migrations
$$;

revoke execute on function public.list_schema_migrations() from public;
revoke execute on function public.list_schema_migrations() from anon, authenticated;
grant  execute on function public.list_schema_migrations() to service_role;

commit;
