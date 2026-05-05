-- Phase 14B: allow PMs to request proposal corrections without treating them
-- as rejected proposals.

create or replace function public.review_proposal(
  p_proposal_id uuid,
  p_action       text
)
returns public.lead_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id    uuid := auth.uid();
  caller_role  text;
  proposal_row public.lead_proposals%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  select role into caller_role
  from public.user_profiles
  where id = caller_id and is_active = true;

  if caller_role not in ('admin', 'pm') then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN';
  end if;

  if p_action not in ('approve', 'reject', 'request_changes', 'cancel') then
    raise exception using errcode = 'P0001', message = 'INVALID_ACTION';
  end if;

  select * into proposal_row
  from public.lead_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROPOSAL_NOT_FOUND';
  end if;

  if proposal_row.review_status not in ('pending_review', 'approved', 'changes_requested') then
    raise exception using errcode = 'P0001', message = 'PROPOSAL_NOT_REVIEWABLE';
  end if;

  update public.lead_proposals
  set
    review_status = case p_action
      when 'approve'         then 'approved'::public.proposal_review_status
      when 'reject'          then 'rejected'::public.proposal_review_status
      when 'request_changes' then 'changes_requested'::public.proposal_review_status
      when 'cancel'          then 'cancelled'::public.proposal_review_status
    end,
    reviewer_id   = caller_id,
    reviewed_at   = clock_timestamp(),
    updated_at    = clock_timestamp()
  where id = p_proposal_id
  returning * into proposal_row;

  if p_action in ('approve', 'reject', 'request_changes') then
    insert into public.user_notifications (
      profile_id, source_kind, source_event_id, domain, title, body, href
    )
    values (
      proposal_row.created_by,
      'proposal_review',
      p_proposal_id,
      'sales',
      case p_action
        when 'approve' then 'Propuesta aprobada'
        when 'request_changes' then 'Ajustes solicitados'
        else 'Propuesta rechazada'
      end,
      case p_action
        when 'approve' then 'Tu propuesta "' || proposal_row.title || '" fue aprobada y puede enviarse al cliente.'
        when 'request_changes' then 'Tu propuesta "' || proposal_row.title || '" necesita ajustes antes de enviarse.'
        else 'Tu propuesta "' || proposal_row.title || '" fue rechazada. Revisa y actualiza antes de reenviar.'
      end,
      '/dashboard/leads'
    )
    on conflict (profile_id, source_kind, source_event_id) do update
      set title   = excluded.title,
          body    = excluded.body,
          is_read = false,
          read_at = null;
  end if;

  return proposal_row;
end;
$$;

revoke all on function public.review_proposal(uuid, text) from public;
grant execute on function public.review_proposal(uuid, text) to authenticated;
