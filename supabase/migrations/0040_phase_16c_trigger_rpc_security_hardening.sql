begin;

-- Trigger/helper SECURITY DEFINER functions should not be callable directly
-- through PostgREST by anon or regular authenticated users. Triggers and other
-- owner-executed functions can still invoke them internally.
revoke all on function public.handle_lead_activity_notifications() from public, anon, authenticated;
revoke all on function public.handle_project_activity_notifications() from public, anon, authenticated;
revoke all on function public.handle_project_insert_side_effects() from public, anon, authenticated;
revoke all on function public.handle_project_update_activity() from public, anon, authenticated;
revoke all on function public.handle_task_activity_notifications() from public, anon, authenticated;
revoke all on function public.lock_lead_from_proposal_status() from public, anon, authenticated;
revoke all on function public.log_lead_insert_activity() from public, anon, authenticated;
revoke all on function public.log_lead_proposal_insert_activity() from public, anon, authenticated;
revoke all on function public.log_lead_proposal_update_activity() from public, anon, authenticated;
revoke all on function public.log_lead_update_activity() from public, anon, authenticated;
revoke all on function public.log_task_update_activity() from public, anon, authenticated;
revoke all on function public.notify_on_proposal_created() from public, anon, authenticated;

revoke all on function public.log_lead_activity(uuid, public.lead_activity_type, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.log_project_activity(uuid, public.project_activity_type, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.log_task_activity(uuid, public.task_activity_type, uuid, text, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function public.handle_lead_activity_notifications() to service_role;
grant execute on function public.handle_project_activity_notifications() to service_role;
grant execute on function public.handle_project_insert_side_effects() to service_role;
grant execute on function public.handle_project_update_activity() to service_role;
grant execute on function public.handle_task_activity_notifications() to service_role;
grant execute on function public.lock_lead_from_proposal_status() to service_role;
grant execute on function public.log_lead_insert_activity() to service_role;
grant execute on function public.log_lead_proposal_insert_activity() to service_role;
grant execute on function public.log_lead_proposal_update_activity() to service_role;
grant execute on function public.log_lead_update_activity() to service_role;
grant execute on function public.log_task_update_activity() to service_role;
grant execute on function public.notify_on_proposal_created() to service_role;

grant execute on function public.log_lead_activity(uuid, public.lead_activity_type, uuid, text, jsonb, timestamptz) to service_role;
grant execute on function public.log_project_activity(uuid, public.project_activity_type, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.log_task_activity(uuid, public.task_activity_type, uuid, text, jsonb, timestamptz) to service_role;

-- Pin search_path for helper/trigger functions reported by Supabase Advisor.
alter function public.collect_lead_update_fields(public.leads, public.leads) set search_path = public;
alter function public.normalize_legacy_user_ids(text[]) set search_path = public;
alter function public.notification_format_hours(jsonb) set search_path = public;
alter function public.notification_format_name_list(text[]) set search_path = public;
alter function public.notification_jsonb_text_array(jsonb) set search_path = public;
alter function public.notification_label_for_lead_status(public.lead_status) set search_path = public;
alter function public.notification_label_for_project_status(public.project_status) set search_path = public;
alter function public.notification_label_for_proposal_status(public.proposal_status) set search_path = public;
alter function public.notification_label_for_task_status(public.task_status) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.sync_lead_proposal_status_timestamps() set search_path = public;
alter function public.sync_proposal_expiry_on_first_open() set search_path = public;

commit;
