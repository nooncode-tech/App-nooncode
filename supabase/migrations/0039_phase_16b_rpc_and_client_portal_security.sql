begin;

-- Harden client portal token ownership. The token is a bearer credential for the
-- external client, but internal users must only manage tokens for projects they
-- are allowed to operate.
drop policy if exists "client_access_tokens_select_scope" on public.client_access_tokens;
drop policy if exists "client_access_tokens_insert_scope" on public.client_access_tokens;
drop policy if exists "client_access_tokens_update_scope" on public.client_access_tokens;

grant select, insert, update on public.client_access_tokens to authenticated;

create policy "client_access_tokens_select_scope"
on public.client_access_tokens for select to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and (
        viewer.role in ('admin', 'sales_manager', 'pm')
        or exists (
          select 1
          from public.projects project
          left join public.leads lead on lead.id = project.source_lead_id
          where project.id = client_access_tokens.project_id
            and (
              project.created_by = auth.uid()
              or lead.assigned_to = auth.uid()
              or lead.created_by = auth.uid()
            )
        )
      )
  )
);

create policy "client_access_tokens_insert_scope"
on public.client_access_tokens for insert to authenticated
with check (
  exists (
    select 1
    from public.user_profiles viewer
    join public.projects project on project.id = client_access_tokens.project_id
    left join public.leads lead on lead.id = project.source_lead_id
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and project.payment_activated = true
      and (
        viewer.role in ('admin', 'sales_manager', 'pm')
        or project.created_by = auth.uid()
        or lead.assigned_to = auth.uid()
        or lead.created_by = auth.uid()
      )
  )
);

create policy "client_access_tokens_update_scope"
on public.client_access_tokens for update to authenticated
using (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'pm')
  )
)
with check (
  exists (
    select 1
    from public.user_profiles viewer
    where viewer.id = auth.uid()
      and viewer.is_active = true
      and viewer.role in ('admin', 'pm')
  )
);

-- Public client-token resolution is exposed through Next.js routes, not direct
-- PostgREST RPC. Keep the existing function bodies, pin search_path, and make
-- them service-role only.
alter function public.resolve_client_token(text) set search_path = public;
alter function public.touch_client_token(text) set search_path = public;

-- Service-only RPCs. These are called by trusted server routes/webhooks using
-- the service role after application-level checks. They must not be callable
-- by anon or regular authenticated users via PostgREST.
revoke all on function public.activate_paid_proposal(uuid, text, timestamptz, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.credit_wallet_bucket(uuid, numeric, text, public.monetary_entry_type, text, text, uuid, uuid, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_wallet_payout(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.attach_payout_transfer(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_wallet_payout(text, uuid) from public, anon, authenticated;
revoke all on function public.release_wallet_payout(uuid, text) from public, anon, authenticated;
revoke all on function public.reverse_wallet_payout_by_transfer(text, uuid) from public, anon, authenticated;
revoke all on function public.admin_credit_earnings(uuid, numeric, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.consolidate_pending_earnings(uuid, numeric) from public, anon, authenticated;
revoke all on function public.enqueue_user_notification(uuid, text, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_client_token(text) from public, anon, authenticated;
revoke all on function public.touch_client_token(text) from public, anon, authenticated;

grant execute on function public.activate_paid_proposal(uuid, text, timestamptz, uuid, jsonb, text) to service_role;
grant execute on function public.credit_wallet_bucket(uuid, numeric, text, public.monetary_entry_type, text, text, uuid, uuid, jsonb, text, timestamptz) to service_role;
grant execute on function public.reserve_wallet_payout(uuid, uuid, text) to service_role;
grant execute on function public.attach_payout_transfer(uuid, text) to service_role;
grant execute on function public.complete_wallet_payout(text, uuid) to service_role;
grant execute on function public.release_wallet_payout(uuid, text) to service_role;
grant execute on function public.reverse_wallet_payout_by_transfer(text, uuid) to service_role;
grant execute on function public.admin_credit_earnings(uuid, numeric, text, text, text, uuid, text) to service_role;
grant execute on function public.consolidate_pending_earnings(uuid, numeric) to service_role;
grant execute on function public.enqueue_user_notification(uuid, text, uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_client_token(text) to service_role;
grant execute on function public.touch_client_token(text) to service_role;

-- Authenticated RPCs that intentionally rely on auth.uid() keep authenticated
-- execution, but anon/public access is removed explicitly.
revoke all on function public.review_proposal(uuid, text) from public, anon;
revoke all on function public.claim_released_lead(uuid) from public, anon;
revoke all on function public.release_lead_as_no_response(uuid) from public, anon;
revoke all on function public.request_lead_prototype(uuid) from public, anon;
revoke all on function public.ensure_current_user_wallet() from public, anon;
revoke all on function public.ensure_monetary_wallet() from public, anon;
revoke all on function public.handoff_prototype_workspace_to_delivery(uuid) from public, anon;
revoke all on function public.link_lead_prototype_workspace_to_project(uuid, uuid) from public, anon;
revoke all on function public.maxwell_confirmed_sales_count(uuid) from public, anon;

grant execute on function public.review_proposal(uuid, text) to authenticated;
grant execute on function public.claim_released_lead(uuid) to authenticated;
grant execute on function public.release_lead_as_no_response(uuid) to authenticated;
grant execute on function public.request_lead_prototype(uuid) to authenticated;
grant execute on function public.ensure_current_user_wallet() to authenticated;
grant execute on function public.ensure_monetary_wallet() to authenticated;
grant execute on function public.handoff_prototype_workspace_to_delivery(uuid) to authenticated;
grant execute on function public.link_lead_prototype_workspace_to_project(uuid, uuid) to authenticated;
grant execute on function public.maxwell_confirmed_sales_count(uuid) to authenticated;

commit;
