-- 0053_phase_21a_security_definer_revoke_hardening.sql
--
-- B12 (FASE 3 — Supabase Advisor security walkthrough):
-- harden the two SECURITY DEFINER service-role-only RPCs whose EXECUTE
-- was inadvertently left open to PUBLIC / anon / authenticated when
-- migrations 0048 + 0050 landed.
--
-- Affected functions:
--   - public.consolidate_payment_earnings(p_payment_id uuid, p_actor_profile_id uuid)
--     Introduced by 0048_phase_19b_consolidate_earnings_rpc.sql.
--     Real callers: /api/cron/consolidate-earnings (with CRON_SECRET) and
--     legacy /api/admin/earnings/consolidate. Both use
--     createSupabaseAdminClient() → service_role.
--
--   - public.debit_wallet_for_refund(p_payment_id uuid, p_actor_profile_id uuid)
--     Introduced by 0050_phase_19d_debit_wallet_for_refund_rpc.sql.
--     Real callers: handleChargeRefunded() in app/api/webhooks/stripe/route.ts
--     via lib/server/earnings/refund-service.ts. service_role.
--
-- Zero callers use the authenticated or anon roles. The advisor warnings
-- (anon_security_definer_function_executable +
--  authenticated_security_definer_function_executable) are unambiguous
-- — REVOKE FROM PUBLIC/anon/authenticated and GRANT TO service_role only,
-- following the canonical pattern from ADR-018 §D2
-- (B26-R5 list_schema_migrations RPC).
--
-- This migration does NOT redefine the function bodies; it only adjusts
-- the privilege ACL. Behavior preserved.
--
-- ROLLBACK companion (DO NOT RUN unless reverting):
--   GRANT EXECUTE ON FUNCTION public.consolidate_payment_earnings(uuid, uuid)
--     TO PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.debit_wallet_for_refund(uuid, uuid)
--     TO PUBLIC, anon, authenticated;
-- (service_role grant is preserved across the rollback since service_role
--  is unaffected by REVOKE FROM PUBLIC.)
--
-- @see docs/adrs/ADR-018-r5-resolution-list-schema-migrations-rpc.md §D2
-- @see docs/context/project.context.core.md "Supabase Advisor security posture"

begin;

revoke execute on function public.consolidate_payment_earnings(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consolidate_payment_earnings(uuid, uuid) to service_role;

revoke execute on function public.debit_wallet_for_refund(uuid, uuid) from public, anon, authenticated;
grant execute on function public.debit_wallet_for_refund(uuid, uuid) to service_role;

commit;
