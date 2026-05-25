-- Phase 22b — Dashboard summary aggregates RPC
--
-- Implements the single-round-trip server-side aggregate function backing
-- `GET /api/dashboard/summary`. The function returns the 13 numeric KPI
-- fields plus a `leads_by_status` JSON histogram plus a `checked_at`
-- timestamp inside one MVCC snapshot.
--
-- Auth posture: SECURITY INVOKER (the default). The function runs as the
-- calling user. PostgREST executes the RPC under the session's `auth.uid()`
-- and the existing row-level policies on `leads`, `projects`, and `tasks`
-- filter the underlying row sets before the `count(*) / sum()` aggregates
-- fire. No RLS bypass.
--
-- The function reproduces the JS `deriveProjectDisplayStatus` rule from
-- `lib/projects/progress.ts:19-46` via a CTE with four task-status
-- booleans (`has_any_tasks`, `all_tasks_done`, `any_review`,
-- `any_in_progress_or_done`) and a 7-branch ordered `CASE`. The branch
-- order is locked — branch 1 (`NOT has_any_tasks`) MUST evaluate before
-- branch 3 (`persisted = delivered AND all_tasks_done`) so a project
-- with `persisted_status = 'delivered'` and zero tasks returns
-- `'delivered'` (branch 1), not `'delivered'` via branch 3's vacuous
-- `all_tasks_done = true` on an empty set.
--
-- The `payment_activated = true` filter on `projects` matches the
-- application convention in `lib/server/projects/repository.ts:83` and
-- the `/api/projects` list endpoint, so the summary's project counters
-- agree with the list endpoint for the same principal.
--
-- `checked_at` uses `now()` (transaction start) so the entire returned
-- row reflects one consistent moment. Documented in ADR-020 §D9.
--
-- `leads_by_status` is computed as a sub-aggregate then coerced to a
-- JSONB object. `jsonb_object_agg` over zero rows returns NULL; the
-- repository layer coerces `null → {}` on the wire side. The RPC keeps
-- the NULL because forcing `coalesce(..., '{}'::jsonb)` here would hide
-- the empty-aggregate signal from server-side observability.
--
-- Volatility: STABLE. Reads only; no mutation. The planner may cache
-- results within a single statement; cross-statement reads see fresh
-- data on each invocation.
--
-- GRANT scope: `authenticated` only. `anon` is explicitly REVOKEd
-- (defense-in-depth — no public surface). `service_role` retains its
-- implicit access via the bypass-RLS role.
--
-- Rollback (run as postgres or via Dashboard SQL Editor):
--   REVOKE EXECUTE ON FUNCTION public.get_dashboard_summary() FROM authenticated;
--   DROP FUNCTION IF EXISTS public.get_dashboard_summary();
--
-- References:
--   - docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md §D2, §D3, §D9
--   - lib/projects/progress.ts:19-46 (the JS reference the SQL must match)
--   - lib/dashboard-selectors.ts:484-523 (the JS KPI selector parity target)
--   - lib/server/projects/repository.ts:83 (payment_activated filter precedent)
--   - supabase/migrations/0002_phase_2a_leads.sql (leads RLS)
--   - supabase/migrations/0005_phase_2d_projects.sql (projects RLS)
--   - supabase/migrations/0006_phase_2e_tasks.sql + 0009 fix (tasks RLS)

begin;

create or replace function public.get_dashboard_summary()
returns table (
  open_leads            bigint,
  won_leads             bigint,
  pipeline_value        numeric,
  total_revenue         numeric,
  closed_leads          bigint,
  overdue_follow_ups    bigint,
  leads_by_status       jsonb,
  active_projects       bigint,
  projects_in_review    bigint,
  completed_projects    bigint,
  pending_tasks         bigint,
  in_progress_tasks     bigint,
  review_tasks          bigint,
  checked_at            timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with project_task_facts as (
    select
      p.id     as project_id,
      p.status as persisted_status,
      exists (
        select 1
        from public.tasks t
        where t.project_id = p.id
      ) as has_any_tasks,
      not exists (
        select 1
        from public.tasks t
        where t.project_id = p.id
          and t.status <> 'done'
      ) as all_tasks_done,
      exists (
        select 1
        from public.tasks t
        where t.project_id = p.id
          and t.status = 'review'
      ) as any_review,
      exists (
        select 1
        from public.tasks t
        where t.project_id = p.id
          and t.status in ('in_progress', 'done')
      ) as any_in_progress_or_done
    from public.projects p
    where p.payment_activated = true
  ),
  project_display_status as (
    select
      project_id,
      case
        -- Branch 1: no tasks at all → persisted status as-is.
        when not has_any_tasks
          then persisted_status
        -- Branch 2: persisted 'completed' is sticky.
        when persisted_status = 'completed'
          then 'completed'::public.project_status
        -- Branch 3: persisted 'delivered' AND every task done.
        when persisted_status = 'delivered' and all_tasks_done
          then 'delivered'::public.project_status
        -- Branch 4: any task in review → review.
        when any_review
          then 'review'::public.project_status
        -- Branch 5: any task in_progress OR done → in_progress.
        when any_in_progress_or_done
          then 'in_progress'::public.project_status
        -- Branch 6: fallback to persisted only when review or delivered.
        when persisted_status in ('review', 'delivered')
          then persisted_status
        -- Branch 7: otherwise backlog.
        else 'backlog'::public.project_status
      end as display_status
    from project_task_facts
  ),
  project_counters as (
    select
      count(*) filter (where display_status = 'in_progress') as active_projects,
      count(*) filter (where display_status = 'review')      as projects_in_review,
      count(*) filter (where display_status = 'completed')   as completed_projects
    from project_display_status
  ),
  lead_counters as (
    select
      count(*) filter (where status not in ('won','lost'))                                  as open_leads,
      count(*) filter (where status = 'won')                                                as won_leads,
      coalesce(sum(value) filter (where status not in ('won','lost')), 0)                   as pipeline_value,
      coalesce(sum(value) filter (where status = 'won'), 0)                                 as total_revenue,
      count(*) filter (where status in ('won','lost'))                                      as closed_leads,
      count(*) filter (
        where next_follow_up_at is not null
          and next_follow_up_at < now()
          and status not in ('won','lost')
      ) as overdue_follow_ups
    from public.leads
  ),
  lead_status_histogram as (
    select jsonb_object_agg(status::text, status_count) as payload
    from (
      select status, count(*)::int as status_count
      from public.leads
      group by status
    ) per_status
  ),
  task_counters as (
    select
      count(*) filter (where status = 'todo')        as pending_tasks,
      count(*) filter (where status = 'in_progress') as in_progress_tasks,
      count(*) filter (where status = 'review')      as review_tasks
    from public.tasks
  )
  select
    lc.open_leads,
    lc.won_leads,
    lc.pipeline_value,
    lc.total_revenue,
    lc.closed_leads,
    lc.overdue_follow_ups,
    lh.payload                       as leads_by_status,
    pc.active_projects,
    pc.projects_in_review,
    pc.completed_projects,
    tc.pending_tasks,
    tc.in_progress_tasks,
    tc.review_tasks,
    now()                            as checked_at
  from lead_counters     lc
  cross join lead_status_histogram lh
  cross join project_counters       pc
  cross join task_counters          tc;
$$;

revoke execute on function public.get_dashboard_summary() from public;
revoke execute on function public.get_dashboard_summary() from anon;
grant  execute on function public.get_dashboard_summary() to authenticated;

commit;
