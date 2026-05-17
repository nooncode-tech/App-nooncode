-- Phase 18D: persist v0 demo_url + chat_url on prototype_workspaces
-- so the prototype iframe surface (F-V06) survives page reloads
-- without an extra v0 API round-trip.
--
-- Pre-0046 schema kept a single `generated_content text` column that
-- the v0 generate route used as `demoUrl ?? chatUrl ?? content`, which
-- destroyed the semantic distinction between the three values once
-- the API response was consumed. Splitting them into dedicated
-- columns lets the read path render the iframe (demo URL) while
-- still preserving the source code in `generated_content` for audit.
--
-- Additive only:
--   - demo_url: v0-hosted preview URL (used by the iframe in
--     app/dashboard/prototypes/page.tsx)
--   - chat_url: v0.dev session URL (used by the developer-facing
--     "Ver en v0.dev →" external link)
--
-- Both nullable, no defaults, no indexes. Legacy rows pre-0046
-- continue to work — the UI falls back to "no iframe, status ready"
-- and the user can re-generate to repopulate the new columns.

alter table public.prototype_workspaces
  add column if not exists demo_url text;

alter table public.prototype_workspaces
  add column if not exists chat_url text;
