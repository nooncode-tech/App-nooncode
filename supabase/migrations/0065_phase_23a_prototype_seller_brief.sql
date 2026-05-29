-- Phase 23a — prototype seller brief
--
-- Adds an optional free-text brief the seller can attach when requesting a
-- prototype, so v0 generation can be steered with intent the lead row does not
-- capture (specific screens, tone, must-have features).
--
-- Design notes:
--   - Stored in its own column, NOT in `generation_prompt`. The generate
--     endpoint OWNS `generation_prompt` (it overwrites it with the composed
--     prompt at generation time), so reusing it would lose the seller intent.
--     `seller_brief` is the durable input; the generate step MERGES it into
--     the composed prompt.
--   - Written by the request service (admin client) right after the credits
--     RPC creates the workspace row, so the `SECURITY DEFINER`
--     `request_lead_prototype` function is left untouched (no change to the
--     credit / iteration-cap surface).
--   - Nullable: existing rows and brief-less requests keep `null`.

begin;

alter table public.prototype_workspaces
  add column if not exists seller_brief text;

comment on column public.prototype_workspaces.seller_brief is
  'Optional free-text brief the seller adds at request time to steer v0 generation. Merged into the composed prompt by the generate endpoint; never overwritten by generation.';

commit;
