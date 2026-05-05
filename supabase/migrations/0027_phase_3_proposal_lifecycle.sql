begin;

-- Enum para estado de revisión interna de propuestas
create type public.proposal_review_status as enum (
  'pending_review',
  'approved',
  'rejected',
  'expired',
  'cancelled'
);

-- Nuevos campos en lead_proposals
alter table public.lead_proposals
  add column if not exists review_status   public.proposal_review_status not null default 'pending_review',
  add column if not exists first_opened_at timestamptz,
  add column if not exists expires_at      timestamptz,
  add column if not exists version_number  integer not null default 1,
  add column if not exists superseded_by   uuid references public.lead_proposals(id) on delete set null,
  add column if not exists is_special_case boolean not null default false,
  add column if not exists reviewer_id     uuid references public.user_profiles(id) on delete set null,
  add column if not exists reviewed_at     timestamptz;

-- Trigger: calcula expires_at automáticamente cuando se registra la primera apertura
create or replace function public.sync_proposal_expiry_on_first_open()
returns trigger
language plpgsql
as $$
begin
  if new.first_opened_at is not null and old.first_opened_at is null then
    new.expires_at = new.first_opened_at + interval '15 days';
  end if;
  return new;
end;
$$;

create trigger trg_lead_proposals_sync_expiry
before update on public.lead_proposals
for each row
execute function public.sync_proposal_expiry_on_first_open();

-- Extender source_kind check constraint en user_notifications para soportar proposal_review
alter table public.user_notifications
  drop constraint if exists user_notifications_source_kind_check;

alter table public.user_notifications
  add constraint user_notifications_source_kind_check
  check (source_kind in ('lead_activity', 'task_activity', 'project_activity', 'proposal_review'));

-- Trigger: notifica a admin/pm cuando se crea una propuesta nueva (pending_review)
create or replace function public.notify_on_proposal_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient record;
  lead_name text := 'un lead';
begin
  select name into lead_name from public.leads where id = new.lead_id;

  for recipient in
    select id from public.user_profiles
    where role in ('admin', 'pm') and is_active = true
  loop
    insert into public.user_notifications (
      profile_id, source_kind, source_event_id, domain, title, body, href
    )
    values (
      recipient.id,
      'proposal_review',
      new.id,
      'sales',
      'Propuesta pendiente de revisión',
      'La propuesta "' || new.title || '" para ' || lead_name || ' requiere aprobación.',
      '/dashboard/leads'
    )
    on conflict (profile_id, source_kind, source_event_id) do nothing;
  end loop;

  return new;
end;
$$;

create trigger trg_lead_proposals_notify_on_create
after insert on public.lead_proposals
for each row
execute function public.notify_on_proposal_created();

-- RPC: review_proposal — admin/pm aprueba, rechaza o cancela una propuesta
create or replace function public.review_proposal(
  p_proposal_id uuid,
  p_action       text  -- 'approve' | 'reject' | 'cancel'
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

  if p_action not in ('approve', 'reject', 'cancel') then
    raise exception using errcode = 'P0001', message = 'INVALID_ACTION';
  end if;

  select * into proposal_row
  from public.lead_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROPOSAL_NOT_FOUND';
  end if;

  if proposal_row.review_status not in ('pending_review', 'approved') then
    raise exception using errcode = 'P0001', message = 'PROPOSAL_NOT_REVIEWABLE';
  end if;

  update public.lead_proposals
  set
    review_status = case p_action
      when 'approve' then 'approved'::public.proposal_review_status
      when 'reject'  then 'rejected'::public.proposal_review_status
      when 'cancel'  then 'cancelled'::public.proposal_review_status
    end,
    reviewer_id   = caller_id,
    reviewed_at   = clock_timestamp(),
    updated_at    = clock_timestamp()
  where id = p_proposal_id
  returning * into proposal_row;

  -- Notificar al creador de la propuesta cuando se aprueba o rechaza
  if p_action in ('approve', 'reject') then
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
        else 'Propuesta rechazada'
      end,
      case p_action
        when 'approve' then 'Tu propuesta "' || proposal_row.title || '" fue aprobada y puede enviarse al cliente.'
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

-- Índice para filtrar por review_status eficientemente
create index if not exists idx_lead_proposals_review_status
on public.lead_proposals(review_status, created_at desc);

commit;
