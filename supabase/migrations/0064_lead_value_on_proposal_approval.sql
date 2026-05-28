-- 0064_lead_value_on_proposal_approval.sql
--
-- Feature: when a lead proposal is approved by PM/admin (review_status ->
-- 'approved'), reflect the approved amount as the lead's headline value, so the
-- price shown on the Leads board card (lead.value, rendered in
-- components/lead-card.tsx:206) matches the accepted commercial figure.
--
-- Operator decision (2026-05-28): the sync fires on PM approval
-- (proposal_review_status = 'approved'), NOT on the seller-set
-- lead_proposals.status = 'accepted', nor on payment/won. PM approval is the
-- point at which the internal commercial figure becomes authoritative for the
-- board.
--
-- Mechanism: an AFTER UPDATE trigger on public.lead_proposals, in the same
-- family as the existing BEFORE UPDATE sync triggers
-- (sync_lead_proposal_status_timestamps from 0004,
-- sync_proposal_expiry_on_first_open from 0027). The review_status itself is
-- written by public.review_proposal (0027) and the website inbound review path
-- (0034/0035); a trigger catches every write path in one place instead of
-- editing each RPC.
--
-- SECURITY DEFINER so the cross-table write to public.leads bypasses the leads
-- RLS update policy (the reviewing PM is typically not the lead's
-- assignee/creator). Matches the security-definer posture of 0027's
-- notify_on_proposal_created. leads.updated_at is bumped automatically by the
-- pre-existing trg_leads_updated_at trigger (0002), so it is not set here.
--
-- amount is the proposal total (activation base + seller fee per ADR-013) — the
-- full figure the client is quoted. The sync fires only on the transition INTO
-- 'approved' (old.review_status is distinct from new.review_status) so repeated
-- approvals or unrelated column updates do not re-write the value.
--
-- No new columns; lib/server/supabase/database.types.ts is unchanged.

begin;

create or replace function public.sync_lead_value_on_proposal_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.review_status = 'approved'
     and old.review_status is distinct from new.review_status then
    update public.leads
       set value = new.amount
     where id = new.lead_id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_lead_value_on_proposal_approval() from public, anon;

create trigger trg_lead_proposals_sync_lead_value_on_approval
after update on public.lead_proposals
for each row
execute function public.sync_lead_value_on_proposal_approval();

commit;

-- ROLLBACK companion (DO NOT RUN unless reverting):
--   begin;
--   drop trigger if exists trg_lead_proposals_sync_lead_value_on_approval
--     on public.lead_proposals;
--   drop function if exists public.sync_lead_value_on_proposal_approval();
--   commit;
