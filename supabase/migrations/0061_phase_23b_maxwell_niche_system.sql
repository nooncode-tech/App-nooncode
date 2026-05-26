-- Phase 23b: Maxwell Niche System
-- Add niche_id to leads (for both Maxwell-generated and manual leads)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS niche_id TEXT;

-- Add niche_ids to maxwell_search_runs (for traceability and analytics)
ALTER TABLE maxwell_search_runs
  ADD COLUMN IF NOT EXISTS niche_ids TEXT[];

-- Add preferred_niche_ids to user_profiles (seller default niche)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS preferred_niche_ids TEXT[] DEFAULT '{}';
