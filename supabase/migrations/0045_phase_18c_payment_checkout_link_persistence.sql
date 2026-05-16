-- Phase 18C: persist Stripe Checkout URL + expiration on payments so the
-- operator-driven outbound payment link survives page reloads and renders
-- without an extra Stripe API round-trip on read.
--
-- Additive only:
--   - stripe_checkout_url: full Stripe-hosted Checkout URL (~512 chars max in practice).
--   - stripe_checkout_expires_at: UTC timestamp from session.expires_at.
--
-- Both nullable, no defaults, no indexes. The existing (proposal_id, status)
-- access pattern already serves the read enrichment path. Legacy pending rows
-- continue to work because the create-or-reuse service path repopulates the
-- columns the next time the operator clicks the button (one-time UX nudge).

alter table public.payments
  add column if not exists stripe_checkout_url text;

alter table public.payments
  add column if not exists stripe_checkout_expires_at timestamptz;
