-- Phase 18b — Seller-fee state machine: RLS policies
-- Adds the role-aware SELECT policies on public.seller_fees per
-- docs/adrs/ADR-007-seller-fee-state-machine.md §Consequences rule 2.
--
-- This migration is the security half of B3 Chunk 1
-- (specs/fase-0-b3-seller-fee-selector.md). It MUST be applied AFTER
-- 0043_phase_18a_seller_fees.sql which creates the table and enables RLS
-- with no policies (deny-all default).
--
-- Role visibility (master spec v3 §24.3):
--   - admin, pm:               see all rows (audit/exception)
--   - sales, sales_manager:    see own rows only (where seller_profile_id = auth.uid())
--   - developer:               structurally excluded (no SELECT policy matches)
--   - client / anonymous:      no access (not authenticated)
--
-- INSERT / UPDATE / DELETE are intentionally not exposed to authenticated
-- users. Only service_role (which bypasses RLS) writes to this table, via
-- the service layer in lib/server/seller-fees/ introduced in Chunk 2.
--
-- Pattern mirrors:
--   - supabase/migrations/0027_phase_10a_commissions.sql §earnings_ledger_select_scope
--   - supabase/migrations/0004_phase_2c_lead_proposals.sql §lead_proposals_select_sales_scope

begin;

-- Grant base SELECT to authenticated. Per-row authorization is enforced by
-- the policies below. Without the GRANT, even policy-matching rows are denied.
grant select on public.seller_fees to authenticated;

-- Admin and PM see every seller_fees row. Mirrors earnings_ledger pattern.
create policy "seller_fees_select_admin_pm"
on public.seller_fees
for select
to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'pm')
  )
);

-- Sellers (sales / sales_manager roles) see only their own seller_fees rows.
-- "Own" means seller_profile_id = auth.uid(), locked at proposal generation
-- per ADR-007. Lead reassignment after the fee row exists does not transfer
-- ownership; the original seller retains visibility into the fee they selected.
create policy "seller_fees_select_seller_own"
on public.seller_fees
for select
to authenticated
using (
  seller_profile_id = auth.uid()
  and exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('sales', 'sales_manager')
  )
);

-- No SELECT policy for 'developer' role: structurally excluded per ADR-007
-- §Consequences rule 2. A developer querying public.seller_fees receives
-- zero rows because no policy matches their role. This is the authoritative
-- enforcement of master spec v3 §13.3 (developer must not see seller fee).

-- No INSERT / UPDATE / DELETE policies: writes are service_role-only and
-- routed through the service layer in lib/server/seller-fees/ (Chunk 2).
-- Authenticated users without service_role privileges cannot mutate this
-- table by any path, including direct REST calls.

commit;
