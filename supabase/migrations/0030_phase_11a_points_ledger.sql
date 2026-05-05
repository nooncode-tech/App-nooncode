begin;

-- ── Points event types ───────────────────────────────────────────────────────
create type public.points_event_type as enum (
  'lead_won',
  'payment_received',
  'project_milestone',
  'manual_grant',
  'redemption'
);

-- ── Points ledger ────────────────────────────────────────────────────────────
-- One row per event. Positive points = earned, negative = spent.
create table public.points_ledger (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null references public.user_profiles(id) on delete restrict,
  event_type   public.points_event_type not null,
  points       integer not null,            -- positive = earn, negative = spend
  reference_id uuid,                        -- lead_id, project_id, redemption_id, etc.
  notes        text,
  created_at   timestamptz not null default now()
);

create index idx_points_ledger_actor_id   on public.points_ledger(actor_id);
create index idx_points_ledger_created_at on public.points_ledger(created_at desc);

alter table public.points_ledger enable row level security;

grant select on public.points_ledger to authenticated;

create policy "points_ledger_select_scope"
on public.points_ledger for select to authenticated
using (
  actor_id = auth.uid()
  or exists (
    select 1 from public.user_profiles v
    where v.id = auth.uid() and v.is_active = true and v.role in ('admin', 'pm')
  )
);

-- ── Reward store items ───────────────────────────────────────────────────────
create table public.reward_store_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  category     text not null default 'general',
  points_cost  integer not null check (points_cost > 0),
  stock        integer,                     -- null = unlimited
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_reward_store_items_updated_at
before update on public.reward_store_items
for each row execute function public.set_updated_at();

alter table public.reward_store_items enable row level security;

grant select on public.reward_store_items to authenticated;

create policy "reward_store_items_select_all"
on public.reward_store_items for select to authenticated
using (is_active = true);

-- ── Redemption records ───────────────────────────────────────────────────────
create table public.point_redemptions (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references public.user_profiles(id) on delete restrict,
  item_id     uuid not null references public.reward_store_items(id) on delete restrict,
  points_used integer not null check (points_used > 0),
  status      text not null default 'pending' check (status in ('pending', 'fulfilled', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_point_redemptions_actor_id on public.point_redemptions(actor_id);

create trigger trg_point_redemptions_updated_at
before update on public.point_redemptions
for each row execute function public.set_updated_at();

alter table public.point_redemptions enable row level security;

grant select, insert on public.point_redemptions to authenticated;

create policy "point_redemptions_select_scope"
on public.point_redemptions for select to authenticated
using (
  actor_id = auth.uid()
  or exists (
    select 1 from public.user_profiles v
    where v.id = auth.uid() and v.is_active = true and v.role in ('admin', 'pm')
  )
);

create policy "point_redemptions_insert_scope"
on public.point_redemptions for insert to authenticated
with check (actor_id = auth.uid());

-- ── Seed default store items ─────────────────────────────────────────────────
insert into public.reward_store_items (name, description, category, points_cost, stock) values
  ('Día libre extra',          'Un día adicional de descanso pagado',           'beneficio',   500,  null),
  ('Voucher Amazon $50',       'Tarjeta de regalo Amazon por $50 USD',          'voucher',     300,  20),
  ('Almuerzo del equipo',      'Almuerzo grupal pagado por la empresa',         'experiencia', 200,  null),
  ('Créditos de prototipo x5', '5 créditos adicionales para prototipos',        'creditos',    150,  null),
  ('Reconocimiento mensual',   'Mención destacada en reunión de equipo',        'reconocimiento', 100, null),
  ('Curso online',             'Acceso a un curso de tu elección hasta $100',   'desarrollo',  400,  10);

commit;
