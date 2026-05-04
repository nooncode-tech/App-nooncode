begin;

create unique index if not exists payments_succeeded_proposal_unique
on public.payments (proposal_id)
where status = 'succeeded';

create unique index if not exists payouts_external_reference_unique
on public.payouts (external_reference)
where external_reference is not null;

create or replace function public.activate_paid_proposal(
  p_payment_id uuid,
  p_provider_payment_intent_id text default null,
  p_paid_at timestamptz default clock_timestamp(),
  p_actor_profile_id uuid default null,
  p_payment_metadata jsonb default '{}'::jsonb,
  p_project_description text default null
)
returns table (
  payment_id uuid,
  proposal_id uuid,
  lead_id uuid,
  project_id uuid,
  activated_now boolean,
  payment_was_already_succeeded boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.payments%rowtype;
  proposal_row public.lead_proposals%rowtype;
  lead_row public.leads%rowtype;
  project_row public.projects%rowtype;
  paid_at_value timestamptz := coalesce(p_paid_at, clock_timestamp());
  actor_id uuid;
  was_succeeded boolean := false;
  project_was_active boolean := false;
  created_project boolean := false;
  next_metadata jsonb := coalesce(p_payment_metadata, '{}'::jsonb);
begin
  if p_payment_id is null then
    raise exception using errcode = 'P0001', message = 'PAYMENT_REQUIRED';
  end if;

  select *
  into payment_row
  from public.payments payment
  where payment.id = p_payment_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PAYMENT_NOT_FOUND';
  end if;

  was_succeeded := payment_row.status = 'succeeded';

  select *
  into proposal_row
  from public.lead_proposals proposal
  where proposal.id = payment_row.proposal_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROPOSAL_NOT_FOUND';
  end if;

  if proposal_row.review_status is distinct from 'approved' then
    raise exception using errcode = 'P0001', message = 'PROPOSAL_REQUIRES_PM_APPROVAL';
  end if;

  if proposal_row.amount is null or proposal_row.amount <= 0 then
    raise exception using errcode = 'P0001', message = 'PROPOSAL_AMOUNT_MUST_BE_POSITIVE';
  end if;

  select *
  into lead_row
  from public.leads lead
  where lead.id = proposal_row.lead_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'LEAD_NOT_FOUND';
  end if;

  actor_id := coalesce(p_actor_profile_id, proposal_row.created_by, lead_row.assigned_to, lead_row.created_by);

  if actor_id is null then
    raise exception using errcode = 'P0001', message = 'ACTOR_REQUIRED';
  end if;

  select *
  into project_row
  from public.projects project
  where project.source_proposal_id = proposal_row.id
  for update;

  if not found then
    insert into public.projects (
      source_lead_id,
      source_proposal_id,
      created_by,
      name,
      description,
      client_name,
      status,
      budget,
      team_legacy_user_ids,
      pm_legacy_user_id,
      handoff_ready_at,
      payment_activated,
      payment_activated_at
    )
    values (
      lead_row.id,
      proposal_row.id,
      actor_id,
      proposal_row.title,
      coalesce(nullif(trim(p_project_description), ''), proposal_row.body),
      coalesce(lead_row.company, lead_row.name),
      'backlog',
      proposal_row.amount,
      '{}',
      null,
      paid_at_value,
      true,
      paid_at_value
    )
    returning *
    into project_row;

    created_project := true;
    project_was_active := false;
  else
    project_was_active := project_row.payment_activated;

    update public.projects project
    set
      payment_activated = true,
      payment_activated_at = coalesce(project.payment_activated_at, paid_at_value),
      handoff_ready_at = coalesce(project.handoff_ready_at, paid_at_value),
      description = coalesce(project.description, nullif(trim(p_project_description), '')),
      updated_at = clock_timestamp()
    where project.id = project_row.id
    returning *
    into project_row;
  end if;

  next_metadata := payment_row.metadata
    || next_metadata
    || jsonb_build_object(
      'activatedByRpc', true,
      'activatedAt', paid_at_value,
      'projectId', project_row.id
    );

  update public.payments payment
  set
    project_id = project_row.id,
    stripe_payment_intent_id = coalesce(
      payment.stripe_payment_intent_id,
      nullif(trim(coalesce(p_provider_payment_intent_id, '')), '')
    ),
    status = 'succeeded',
    paid_at = coalesce(payment.paid_at, paid_at_value),
    metadata = next_metadata,
    updated_at = clock_timestamp()
  where payment.id = payment_row.id;

  update public.lead_proposals proposal
  set
    status = 'handoff_ready',
    accepted_at = coalesce(proposal.accepted_at, paid_at_value),
    handoff_ready_at = coalesce(proposal.handoff_ready_at, paid_at_value),
    payment_status = 'succeeded',
    paid_at = coalesce(proposal.paid_at, paid_at_value),
    updated_at = clock_timestamp()
  where proposal.id = proposal_row.id;

  update public.leads lead
  set
    status = 'won',
    updated_at = clock_timestamp()
  where lead.id = lead_row.id
    and lead.status <> 'won';

  update public.prototype_workspaces workspace
  set
    project_id = project_row.id,
    updated_at = clock_timestamp()
  where workspace.lead_id = lead_row.id
    and workspace.project_id is null;

  insert into public.client_access_tokens (
    project_id,
    lead_id,
    client_name,
    client_email,
    created_by
  )
  select
    project_row.id,
    lead_row.id,
    coalesce(lead_row.company, lead_row.name),
    lead_row.email,
    actor_id
  where not exists (
    select 1
    from public.client_access_tokens token
    where token.project_id = project_row.id
  );

  return query
  select
    payment_row.id,
    proposal_row.id,
    lead_row.id,
    project_row.id,
    (created_project or not project_was_active or not was_succeeded),
    was_succeeded;
end;
$$;

create or replace function public.reserve_wallet_payout(
  p_profile_id uuid,
  p_actor_profile_id uuid,
  p_notes text default null
)
returns table (
  payout_id uuid,
  batch_id uuid,
  profile_id uuid,
  amount numeric,
  currency text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.user_profiles%rowtype;
  wallet_row public.wallet_accounts%rowtype;
  batch_row public.payout_batches%rowtype;
  payout_row public.payouts%rowtype;
  reserve_amount numeric(12,2);
  reserve_currency char(3);
  period_start_value date := (current_date - interval '1 day')::date;
  period_end_value date := current_date;
begin
  if p_profile_id is null then
    raise exception using errcode = 'P0001', message = 'PROFILE_REQUIRED';
  end if;

  select *
  into profile_row
  from public.user_profiles profile
  where profile.id = p_profile_id
    and profile.is_active = true;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  select *
  into wallet_row
  from public.wallet_accounts wallet
  where wallet.profile_id = p_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WALLET_NOT_FOUND';
  end if;

  reserve_amount := round(wallet_row.available_to_withdraw, 2);
  reserve_currency := wallet_row.currency;

  if reserve_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'NO_BALANCE_AVAILABLE';
  end if;

  insert into public.payout_batches (
    period_start,
    period_end,
    status,
    total_amount,
    currency,
    created_by_profile_id,
    notes
  )
  values (
    period_start_value,
    period_end_value,
    'processing',
    reserve_amount,
    reserve_currency,
    p_actor_profile_id,
    p_notes
  )
  returning *
  into batch_row;

  insert into public.payouts (
    batch_id,
    profile_id,
    amount,
    currency,
    status,
    metadata
  )
  values (
    batch_row.id,
    p_profile_id,
    reserve_amount,
    reserve_currency,
    'pending',
    jsonb_build_object(
      'notes', p_notes,
      'reservedAt', clock_timestamp(),
      'reservedBy', p_actor_profile_id
    )
  )
  returning *
  into payout_row;

  update public.wallet_accounts wallet
  set
    available_to_withdraw = wallet.available_to_withdraw - reserve_amount,
    locked = wallet.locked + reserve_amount,
    updated_at = clock_timestamp()
  where wallet.profile_id = p_profile_id;

  insert into public.wallet_ledger_entries (
    profile_id,
    amount,
    currency,
    entry_type,
    balance_bucket,
    status,
    reference_type,
    reference_id,
    actor_profile_id,
    metadata
  )
  values
    (
      p_profile_id,
      -reserve_amount,
      reserve_currency,
      'balance_locked',
      'available_to_withdraw',
      'confirmed',
      'payout',
      payout_row.id,
      p_actor_profile_id,
      jsonb_build_object('idempotencyKey', 'payout:' || payout_row.id || ':reserve:available')
    ),
    (
      p_profile_id,
      reserve_amount,
      reserve_currency,
      'balance_locked',
      'locked',
      'confirmed',
      'payout',
      payout_row.id,
      p_actor_profile_id,
      jsonb_build_object('idempotencyKey', 'payout:' || payout_row.id || ':reserve:locked')
    )
  on conflict do nothing;

  return query
  select
    payout_row.id,
    batch_row.id,
    payout_row.profile_id,
    payout_row.amount,
    payout_row.currency::text;
end;
$$;

create or replace function public.attach_payout_transfer(
  p_payout_id uuid,
  p_external_reference text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_payout_id is null or nullif(trim(coalesce(p_external_reference, '')), '') is null then
    raise exception using errcode = 'P0001', message = 'PAYOUT_AND_TRANSFER_REQUIRED';
  end if;

  update public.payouts payout
  set
    external_reference = p_external_reference,
    status = 'processing',
    metadata = payout.metadata || jsonb_build_object('transferAttachedAt', clock_timestamp()),
    updated_at = clock_timestamp()
  where payout.id = p_payout_id
    and payout.status in ('pending', 'processing');

  if not found then
    raise exception using errcode = 'P0001', message = 'PAYOUT_NOT_ATTACHABLE';
  end if;

  return true;
end;
$$;

create or replace function public.complete_wallet_payout(
  p_external_reference text,
  p_payout_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payout_row public.payouts%rowtype;
begin
  select *
  into payout_row
  from public.payouts payout
  where (
    (p_external_reference is not null and payout.external_reference = p_external_reference)
    or (p_payout_id is not null and payout.id = p_payout_id)
  )
  for update;

  if not found then
    return false;
  end if;

  if payout_row.status = 'completed' then
    return false;
  end if;

  if payout_row.status = 'failed' then
    raise exception using errcode = 'P0001', message = 'PAYOUT_ALREADY_FAILED';
  end if;

  update public.wallet_accounts wallet
  set
    locked = wallet.locked - payout_row.amount,
    updated_at = clock_timestamp()
  where wallet.profile_id = payout_row.profile_id
    and wallet.locked >= payout_row.amount;

  if not found then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_LOCKED_BALANCE';
  end if;

  update public.payouts payout
  set
    status = 'completed',
    metadata = payout.metadata || jsonb_build_object('completedAt', clock_timestamp()),
    updated_at = clock_timestamp()
  where payout.id = payout_row.id;

  insert into public.wallet_ledger_entries (
    profile_id,
    amount,
    currency,
    entry_type,
    balance_bucket,
    status,
    reference_type,
    reference_id,
    metadata
  )
  values (
    payout_row.profile_id,
    -payout_row.amount,
    payout_row.currency,
    'withdrawal_confirmed',
    'locked',
    'confirmed',
    'payout',
    payout_row.id,
    jsonb_build_object(
      'idempotencyKey', 'payout:' || payout_row.id || ':completed',
      'externalReference', p_external_reference
    )
  )
  on conflict do nothing;

  if not exists (
    select 1
    from public.payouts payout
    where payout.batch_id = payout_row.batch_id
      and payout.status <> 'completed'
  ) then
    update public.payout_batches batch
    set status = 'completed', updated_at = clock_timestamp()
    where batch.id = payout_row.batch_id;
  end if;

  return true;
end;
$$;

create or replace function public.release_wallet_payout(
  p_payout_id uuid,
  p_reason text default 'payout_failed'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payout_row public.payouts%rowtype;
begin
  select *
  into payout_row
  from public.payouts payout
  where payout.id = p_payout_id
  for update;

  if not found then
    return false;
  end if;

  if payout_row.status = 'failed' then
    return false;
  end if;

  if payout_row.status = 'completed' then
    raise exception using errcode = 'P0001', message = 'PAYOUT_ALREADY_COMPLETED';
  end if;

  update public.wallet_accounts wallet
  set
    locked = wallet.locked - payout_row.amount,
    available_to_withdraw = wallet.available_to_withdraw + payout_row.amount,
    updated_at = clock_timestamp()
  where wallet.profile_id = payout_row.profile_id
    and wallet.locked >= payout_row.amount;

  if not found then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_LOCKED_BALANCE';
  end if;

  update public.payouts payout
  set
    status = 'failed',
    metadata = payout.metadata || jsonb_build_object('releasedAt', clock_timestamp(), 'releaseReason', p_reason),
    updated_at = clock_timestamp()
  where payout.id = payout_row.id;

  update public.payout_batches batch
  set status = 'failed', updated_at = clock_timestamp()
  where batch.id = payout_row.batch_id;

  insert into public.wallet_ledger_entries (
    profile_id,
    amount,
    currency,
    entry_type,
    balance_bucket,
    status,
    reference_type,
    reference_id,
    metadata
  )
  values
    (
      payout_row.profile_id,
      -payout_row.amount,
      payout_row.currency,
      'balance_unlocked',
      'locked',
      'confirmed',
      'payout',
      payout_row.id,
      jsonb_build_object('idempotencyKey', 'payout:' || payout_row.id || ':release:locked', 'reason', p_reason)
    ),
    (
      payout_row.profile_id,
      payout_row.amount,
      payout_row.currency,
      'balance_unlocked',
      'available_to_withdraw',
      'confirmed',
      'payout',
      payout_row.id,
      jsonb_build_object('idempotencyKey', 'payout:' || payout_row.id || ':release:available', 'reason', p_reason)
    )
  on conflict do nothing;

  return true;
end;
$$;

create or replace function public.reverse_wallet_payout_by_transfer(
  p_external_reference text,
  p_payout_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  payout_row public.payouts%rowtype;
  was_completed boolean;
begin
  select *
  into payout_row
  from public.payouts payout
  where (
    (p_external_reference is not null and payout.external_reference = p_external_reference)
    or (p_payout_id is not null and payout.id = p_payout_id)
  )
  for update;

  if not found then
    return false;
  end if;

  if payout_row.metadata ? 'reversedAt' then
    return false;
  end if;

  was_completed := payout_row.status = 'completed';

  if was_completed then
    update public.wallet_accounts wallet
    set
      available_to_withdraw = wallet.available_to_withdraw + payout_row.amount,
      updated_at = clock_timestamp()
    where wallet.profile_id = payout_row.profile_id;

    insert into public.wallet_ledger_entries (
      profile_id,
      amount,
      currency,
      entry_type,
      balance_bucket,
      status,
      reference_type,
      reference_id,
      metadata
    )
    values (
      payout_row.profile_id,
      payout_row.amount,
      payout_row.currency,
      'manual_adjustment',
      'available_to_withdraw',
      'confirmed',
      'payout',
      payout_row.id,
      jsonb_build_object(
        'idempotencyKey', 'payout:' || payout_row.id || ':reversal:available',
        'externalReference', p_external_reference
      )
    )
    on conflict do nothing;
  else
    update public.wallet_accounts wallet
    set
      locked = wallet.locked - payout_row.amount,
      available_to_withdraw = wallet.available_to_withdraw + payout_row.amount,
      updated_at = clock_timestamp()
    where wallet.profile_id = payout_row.profile_id
      and wallet.locked >= payout_row.amount;

    if not found then
      raise exception using errcode = 'P0001', message = 'INSUFFICIENT_LOCKED_BALANCE';
    end if;
  end if;

  update public.payouts payout
  set
    status = 'failed',
    metadata = payout.metadata || jsonb_build_object('reversedAt', clock_timestamp(), 'externalReference', p_external_reference),
    updated_at = clock_timestamp()
  where payout.id = payout_row.id;

  update public.payout_batches batch
  set status = 'failed', updated_at = clock_timestamp()
  where batch.id = payout_row.batch_id;

  return true;
end;
$$;

revoke all on function public.activate_paid_proposal(uuid, text, timestamptz, uuid, jsonb, text) from public;
revoke all on function public.reserve_wallet_payout(uuid, uuid, text) from public;
revoke all on function public.attach_payout_transfer(uuid, text) from public;
revoke all on function public.complete_wallet_payout(text, uuid) from public;
revoke all on function public.release_wallet_payout(uuid, text) from public;
revoke all on function public.reverse_wallet_payout_by_transfer(text, uuid) from public;

grant execute on function public.activate_paid_proposal(uuid, text, timestamptz, uuid, jsonb, text) to service_role;
grant execute on function public.reserve_wallet_payout(uuid, uuid, text) to service_role;
grant execute on function public.attach_payout_transfer(uuid, text) to service_role;
grant execute on function public.complete_wallet_payout(text, uuid) to service_role;
grant execute on function public.release_wallet_payout(uuid, text) to service_role;
grant execute on function public.reverse_wallet_payout_by_transfer(text, uuid) to service_role;

commit;
