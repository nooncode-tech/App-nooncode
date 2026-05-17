-- Phase 19A: persist project_type + complexity on lead_proposals so the
-- server-side proposal-amount validator (per ADR-013) has the matrix
-- coordinates needed to revalidate the activation pricing.
--
-- Context: ADR-013 (2026-05-17) confirmed the additive pricing model is
-- already implemented end-to-end via Maxwell + lib/maxwell/pricing.ts.
-- The remaining gap is governance: the seller can bypass Maxwell by
-- typing into the editable `Monto estimado` input on the proposal form.
-- Closing this requires the server-side validator to recompute
-- `computePricing(projectType, complexity, channel, sellerFeeAmount)`
-- and reject mismatches. Persisting both fields on the proposal is the
-- single source of truth the validator + future audit / refund / re-quote
-- flows consume.
--
-- Additive only:
--   - project_type: one of landing | ecommerce | webapp | mobile | saas_ai
--     (TypeScript enum lives in lib/maxwell/pricing.ts; not a DB enum
--     because matrix updates ship without migrations under ADR-013's
--     "API layer is authoritative" rule).
--   - complexity: one of low | medium | high (same rationale).
--
-- Both nullable, no defaults, no CHECK constraints. Legacy outbound
-- proposals pre-0047 have null in both columns and bypass the validator
-- (ADR-013 §Consequences §Legacy rows). New outbound proposals require
-- both fields at the API layer (createLeadProposalSchema).
--
-- Inbound proposals do not set these fields (no seller fee model on
-- inbound; ADR-010 keeps inbound pricing owned by NoonWeb). Nullable
-- columns therefore stay null for inbound rows by design.

alter table public.lead_proposals
  add column if not exists project_type text;

alter table public.lead_proposals
  add column if not exists complexity text;
