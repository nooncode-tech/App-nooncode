-- Phase 5b: v0 prototype generation columns
-- Adds generation result columns to prototype_workspaces

alter table public.prototype_workspaces
  add column if not exists generation_prompt    text,
  add column if not exists generated_content    text,
  add column if not exists generated_at         timestamptz;
