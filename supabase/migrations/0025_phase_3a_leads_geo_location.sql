begin;

-- Phase 3A: Add geographic location fields to leads for proximity filtering.
-- latitude and longitude store geocoded coordinates.
-- location_text stores the human-readable location entered by the user (e.g. "Monterrey NL").

alter table public.leads
  add column if not exists location_text text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

commit;
