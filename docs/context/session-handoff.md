# Nooncode App — Session Handoff

## Completed phases
- Projects/tasks dashboard reads consolidated onto shared useData()
- Home/dashboard reads consolidated onto shared useData() with KPIs derived via lib/dashboard-selectors.ts
- Dashboard UI cleanup completed for home, projects, and tasks surfaces
- Reports read-model/report derivation was extracted into lib/dashboard-selectors.ts
- app/dashboard/reports/page.tsx now consumes report selectors for KPI summary, pipeline aggregation, monthly trend projection, source breakdown, project-status breakdown, and chart colors
- The reports source-label mismatch was fixed by supporting both normalized keys and legacy aliases
- Reports behavior was preserved
- Reports still keeps the following page-local: auth reads, canViewAll behavior, Tabs shell and chart tab composition, chart rendering/configuration, and all page UI/layout
- Rewards read-model/display derivation was extracted into lib/dashboard-selectors.ts
- app/dashboard/rewards/page.tsx now consumes shared rewards from useData()
- Direct mockRewards coupling was removed
- Rewards behavior was preserved
- Rewards still keeps the following page-local: auth gating, local UI state (selectedReward, categoryFilter, activeTab), tab composition, dialog open/close flow, redeem handler, toast behavior, and all page rendering/layout
- Direct mockPointEvents coupling still remains in app/dashboard/rewards/page.tsx because there is not yet a safe shared point-history source in useData()
- Settings read-model/display projection logic was extracted into lib/dashboard-selectors.ts
- app/dashboard/settings/page.tsx now consumes useData().users plus settings selectors for users table projection, demo-role card projection, permissions rows, and notification option definitions
- No direct mockUsers coupling remains in app/dashboard/settings/page.tsx
- Settings behavior was preserved
- Settings still keeps the following page-local: access gating, SwitchRole behavior, activeTab state, all tabs/UI composition, general tab form defaults, integration cards, save/toast handlers, button wiring, and restricted-access fallback
- app/dashboard/layout.tsx was audited and found stable enough to leave frozen
- app/dashboard/layout.tsx acts as a thin shell around auth, data, sidebar, and Maxwell boundaries
- No safe in-bounds implementation work is justified on app/dashboard/layout.tsx right now
- Pipeline read-model logic was extracted into lib/dashboard-selectors.ts
- app/dashboard/pipeline/page.tsx now consumes selectors for stage metadata, filtering, column construction, total pipeline value, column stats, and score-color display mapping
- Pipeline behavior was preserved; completed surfaces stay frozen unless explicitly audited later
- Pipeline still keeps the following page-local: useData() access, page state (selectedLead, showNewLeadDialog), drag/status handlers, selected-lead synchronization after status changes, card click behavior, dialog/form wiring, and all UI composition/rendering
- Lead read-model logic was extracted into lib/dashboard-selectors.ts
- app/dashboard/leads/page.tsx now consumes selectors for status-label mapping, filtering, sorting, and KPI/stat derivation
- Lead behavior was preserved; pipeline remains untouched unless explicitly audited later
- Leads still keeps the following page-local: auth gating, page state (searchQuery, statusFilter, sortBy), dialogs, selected lead, delete target, lead actions (updateLeadStatus, deleteLead), selected-lead synchronization after status/delete, toast behavior, and all UI composition/rendering
- Earnings page minimally consolidated: earnings balance now reads from shared useData().users
- Earnings page keeps auth usage only for identity/role as needed
- Earnings read-model calculations were extracted into lib/dashboard-selectors.ts
- app/dashboard/earnings/page.tsx is now a lighter composition layer consuming selector output
- Earnings commissions/transactions remain intentionally page-local and unconsolidated
- Earnings intentionally keeps the following page-local: Commission, mockCommissions, Transaction, mockTransactions, statusConfig, and hardcoded display assumptions like +18%, 5%, and $500
- Dashboard entry authorization is now centralized in lib/auth-context.tsx and enforced in app/dashboard/layout.tsx
- Auth now exposes a reusable dashboard access contract with route access levels plus path authorization helpers
- Unauthenticated users are redirected to /
- Authenticated but unauthorized users are redirected to /dashboard
- Unauthorized dashboard content is prevented from mounting while redirect resolution is in progress
- Auth behavior was preserved
- The following page-level auth/authorization inconsistencies still remain:
  - app/dashboard/settings/page.tsx admin-only UI guard and SwitchRole behavior
  - app/dashboard/projects/page.tsx local canManageTeam view logic
  - app/dashboard/tasks/page.tsx local role-based task filtering
  - app/dashboard/reports/page.tsx local canViewAll semantics
  - earnings/rewards currently rely on layout-level authenticated access only

## Stable files touched
- app/dashboard/page.tsx
- app/dashboard/reports/page.tsx
- app/dashboard/rewards/page.tsx
- app/dashboard/settings/page.tsx
- app/dashboard/leads/page.tsx
- app/dashboard/pipeline/page.tsx
- app/dashboard/projects/page.tsx
- app/dashboard/tasks/page.tsx
- app/dashboard/earnings/page.tsx
- app/dashboard/layout.tsx
- lib/dashboard-selectors.ts
- lib/auth-context.tsx

## Constraints / out-of-scope
- Do not reopen completed dashboard data consolidation unless a direct regression is found
- Out of scope: Maxwell, reports, sidebar, recent activity/activity source, new features, new data sources, provider/domain contract changes, speculative refactors
- Rewards and settings remain untouched and out of scope

## Known tooling limitations
- eslint unavailable in-session
- next build unavailable because local next binary is not executable in-session
- These are tooling limitations only; current dashboard work is functionally stable

## Next iteration
- Next iteration remains open
- Do not choose rewards or settings automatically
