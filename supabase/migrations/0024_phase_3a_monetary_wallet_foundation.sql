begin;

-- Enums nuevos (monetarios)
create type public.monetary_entry_type as enum (
  'deposit',
  'earnings_distribution',
  'service_debit',
  'withdrawal_request',
  'withdrawal_confirmed',
  'manual_adjustment',
  'balance_locked',
  'balance_unlocked'
);

create type public.payout_method_type as enum (
  'bank_transfer',
  'binance_pay'
);

create type public.batch_status as enum (
  'pending',
  'processing',
  'completed',
  'failed'
);

create type public.payout_status as enum (
  'pending',
  'processing',
  'completed',
  'failed'
);

create type public.provider_name as enum (
  'stripe',
  'binance'
);

create type public.provider_event_status as enum (
  'pending',
  'processed',
  'failed',
  'ignored'
);

-- wallet_accounts: una por usuario, 4 buckets de saldo separados
create table public.wallet_accounts (
  profile_id            uuid primary key references public.user_profiles(id) on delete cascade,
  available_to_spend    numeric(12,2) not null default 0 check (available_to_spend >= 0),
  available_to_withdraw numeric(12,2) not null default 0 check (available_to_withdraw >= 0),
  pending               numeric(12,2) not null default 0 check (pending >= 0),
  locked                numeric(12,2) not null default 0 check (locked >= 0),
  currency              char(3)       not null default 'USD',
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

create trigger trg_wallet_accounts_updated_at
before update on public.wallet_accounts
for each row
execute function public.set_updated_at();

-- wallet_ledger_entries: registro auditable de cada movimiento monetario
create table public.wallet_ledger_entries (
  id               uuid        primary key default gen_random_uuid(),
  profile_id       uuid        not null references public.user_profiles(id) on delete cascade,
  amount           numeric(12,2) not null check (amount <> 0),
  currency         char(3)     not null default 'USD',
  entry_type       public.monetary_entry_type not null,
  balance_bucket   text        not null check (balance_bucket in ('available_to_spend','available_to_withdraw','pending','locked')),
  status           text        not null default 'confirmed' check (status in ('confirmed','pending','reversed')),
  reference_type   text,
  reference_id     uuid,
  actor_profile_id uuid        references public.user_profiles(id) on delete set null,
  metadata         jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index idx_wallet_ledger_entries_profile_created_at
on public.wallet_ledger_entries(profile_id, created_at desc);

create index idx_wallet_ledger_entries_reference
on public.wallet_ledger_entries(reference_type, reference_id);

-- payout_methods: métodos de retiro registrados por usuario
create table public.payout_methods (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.user_profiles(id) on delete cascade,
  method_type public.payout_method_type not null,
  label       text        not null,
  details     jsonb       not null default '{}'::jsonb,
  is_active   boolean     not null default true,
  is_primary  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_payout_methods_profile_id
on public.payout_methods(profile_id);

create trigger trg_payout_methods_updated_at
before update on public.payout_methods
for each row
execute function public.set_updated_at();

-- payout_batches: lotes de pago mensual
create table public.payout_batches (
  id                    uuid               primary key default gen_random_uuid(),
  period_start          date               not null,
  period_end            date               not null,
  status                public.batch_status not null default 'pending',
  total_amount          numeric(12,2)      not null default 0 check (total_amount >= 0),
  currency              char(3)            not null default 'USD',
  created_by_profile_id uuid               references public.user_profiles(id) on delete set null,
  notes                 text,
  created_at            timestamptz        not null default now(),
  updated_at            timestamptz        not null default now(),
  constraint payout_batches_period_check check (period_end > period_start)
);

create trigger trg_payout_batches_updated_at
before update on public.payout_batches
for each row
execute function public.set_updated_at();

-- payouts: pagos individuales dentro de un batch
create table public.payouts (
  id                uuid               primary key default gen_random_uuid(),
  batch_id          uuid               not null references public.payout_batches(id) on delete restrict,
  profile_id        uuid               not null references public.user_profiles(id) on delete restrict,
  amount            numeric(12,2)      not null check (amount > 0),
  currency          char(3)            not null default 'USD',
  payout_method_id  uuid               references public.payout_methods(id) on delete set null,
  status            public.payout_status not null default 'pending',
  external_reference text,
  metadata          jsonb              not null default '{}'::jsonb,
  created_at        timestamptz        not null default now(),
  updated_at        timestamptz        not null default now()
);

create index idx_payouts_batch_id
on public.payouts(batch_id);

create index idx_payouts_profile_id
on public.payouts(profile_id);

create trigger trg_payouts_updated_at
before update on public.payouts
for each row
execute function public.set_updated_at();

-- provider_events: eventos de Stripe/Binance recibidos vía webhook (log idempotente)
create table public.provider_events (
  id                uuid                       primary key default gen_random_uuid(),
  provider          public.provider_name       not null,
  event_type        text                       not null,
  event_id          text                       not null,
  payload           jsonb                      not null,
  processing_status public.provider_event_status not null default 'pending',
  processed_at      timestamptz,
  error_message     text,
  created_at        timestamptz                not null default now(),
  constraint provider_events_unique_event unique (provider, event_id)
);

create index idx_provider_events_provider_status
on public.provider_events(provider, processing_status);

-- RLS
alter table public.wallet_accounts       enable row level security;
alter table public.wallet_ledger_entries enable row level security;
alter table public.payout_methods        enable row level security;
alter table public.payout_batches        enable row level security;
alter table public.payouts               enable row level security;
alter table public.provider_events       enable row level security;

-- Grants base
grant select on public.wallet_accounts       to authenticated;
grant select on public.wallet_ledger_entries to authenticated;
grant select, insert, update on public.payout_methods to authenticated;
grant select on public.payout_batches        to authenticated;
grant select on public.payouts               to authenticated;
-- provider_events: solo service_role (no grant a authenticated)

-- Policies: wallet_accounts — solo el propio usuario
create policy "wallet_accounts_select_self"
on public.wallet_accounts
for select
to authenticated
using (
  profile_id = auth.uid()
  and exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid() and p.is_active = true
  )
);

-- Policies: wallet_ledger_entries — solo el propio usuario
create policy "wallet_ledger_entries_select_self"
on public.wallet_ledger_entries
for select
to authenticated
using (
  profile_id = auth.uid()
  and exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid() and p.is_active = true
  )
);

-- Policies: payout_methods — CRUD solo el propio usuario
create policy "payout_methods_select_self"
on public.payout_methods
for select
to authenticated
using (profile_id = auth.uid());

create policy "payout_methods_insert_self"
on public.payout_methods
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid() and p.is_active = true
  )
);

create policy "payout_methods_update_self"
on public.payout_methods
for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

-- Policies: payout_batches — solo admin puede ver
create policy "payout_batches_select_admin"
on public.payout_batches
for select
to authenticated
using (
  exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active = true
  )
);

-- Policies: payouts — solo el propio usuario o admin
create policy "payouts_select_self_or_admin"
on public.payouts
for select
to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active = true
  )
);

-- Función: ensure_monetary_wallet — crea wallet_accounts si no existe (análogo a ensure_current_user_wallet)
create or replace function public.ensure_monetary_wallet()
returns public.wallet_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  account_row     public.wallet_accounts%rowtype;
begin
  if current_user_id is null then
    raise exception using errcode = 'P0001', message = 'UNAUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.user_profiles p
    where p.id = current_user_id and p.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'PROFILE_NOT_FOUND';
  end if;

  insert into public.wallet_accounts (profile_id)
  values (current_user_id)
  on conflict (profile_id) do nothing;

  select * into account_row
  from public.wallet_accounts
  where profile_id = current_user_id;

  return account_row;
end;
$$;

revoke all on function public.ensure_monetary_wallet() from public;
grant execute on function public.ensure_monetary_wallet() to authenticated;

commit;
