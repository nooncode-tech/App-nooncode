begin;

-- Add notification preferences as JSONB on user_profiles.
-- Each key maps to a notification category. true = receive it, false = muted.
-- Critical ones (lead_assigned, task_assigned, payment_received) are always true
-- and cannot be disabled from the UI — enforced at the API layer.

alter table public.user_profiles
  add column notification_preferences jsonb not null default '{
    "lead_assigned": true,
    "lead_status_changed": true,
    "proposal_sent": true,
    "payment_received": true,
    "task_assigned": true,
    "task_status_changed": true,
    "project_status_changed": true,
    "project_field_changed": false
  }'::jsonb;

commit;
