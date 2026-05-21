-- 0055_phase_21c_cron_notification_kinds.sql
--
-- B25 (FASE 3 — Crons faltantes):
-- extends the `user_notifications.source_kind` CHECK constraint to
-- accept the two new kinds produced by the alerting crons introduced
-- in this iteration:
--   - 'project_sla_breach'  — emitted by /api/cron/project-sla-breach-alert
--   - 'webhook_failure'     — emitted by /api/cron/webhook-failure-alert
--
-- The third cron added by B25 (/api/cron/cleanup-revoked-tokens) does
-- not emit notifications; it only deletes rows and therefore does not
-- need a new source_kind.
--
-- The pre-existing kinds remain unchanged:
--   - 'lead_activity', 'task_activity', 'project_activity' from
--     migration 0018 (trigger-backed inserts)
--   - 'proposal_review' from migration 0027 (review_proposal RPC).
--     ⚠️ Initially omitted from this migration's DROP+ADD set; the
--     remote apply 2026-05-20 failed with check_violation on existing
--     47 rows. Re-added to preserve the 0027 extension.
--
-- ROLLBACK companion (DO NOT RUN unless reverting):
--   alter table public.user_notifications
--     drop constraint user_notifications_source_kind_check;
--   alter table public.user_notifications
--     add constraint user_notifications_source_kind_check
--     check (source_kind in (
--       'lead_activity', 'task_activity', 'project_activity', 'proposal_review'
--     ));
-- (Note: if any 'project_sla_breach' or 'webhook_failure' rows exist
--  at rollback time they must be deleted or the CHECK will fail.)
--
-- @see docs/context/project.context.core.md "Internal notifications foundation"

begin;

-- Postgres requires dropping the old constraint before installing a
-- new one with the same name and different definition.
alter table public.user_notifications
  drop constraint if exists user_notifications_source_kind_check;

alter table public.user_notifications
  add constraint user_notifications_source_kind_check
  check (source_kind in (
    'lead_activity',
    'task_activity',
    'project_activity',
    'proposal_review',
    'project_sla_breach',
    'webhook_failure'
  ));

commit;
