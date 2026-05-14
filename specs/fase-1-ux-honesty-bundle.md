# spec.md — fase-1-ux-honesty-bundle

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-14
- Session ID: fase-1-ux-honesty-bundle
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-frontend → system-testing → system-docs → system-validator
- Router mode: Bugfix
- Depth: Lite

### OBJECTIVE
- What must be achieved in this session: scope a single-iteration UX honesty bundle that closes 8 UX findings from the 2026-05-10 audit. Six are pure copy / label / empty-state honesty fixes (F-V09, F-V11, F-V13, F-V18, F-V19, F-V20). Two are hide-or-wire decisions on contradictory CTAs (F-V04 web-analysis CTAs, F-V05 Maxwell-in-proposal-tab). Default per router: hide both. Analysis only — no code edits.
- Why this work matters now: FASE 1 operator-in-the-loop pilot needs the surface to be coherent before the cutover. Today the dashboard contradicts itself: header copy promises "automated payments" the runtime does not have, the Pendiente bucket on `/dashboard/earnings` names a workflow (PM validation) that does not match the actual admin-credit + consolidate pipeline, Maxwell appears as an actionable CTA on the Propuesta tab while the operating rule treats `IA Asistente` as non-operational, two CTAs in `/dashboard/web-analysis` build URLs the leads page does not parse, the Finanzas sidebar group contains `Reportes` (an operational read-only surface), and the `Mis tareas` quick action label ignores the role-aware framing already adopted by the sidebar. Closing this bundle reduces operator confusion right before the real-card smoke test.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: no (no contract / architecture / data-flow changes; copy, empty-state, label, and hide-decisions only)
- `project.context.history.md` reviewed: no
- Reason `full` was included if applicable: not required — no module boundary changes, no contracts, no data flow shifts.
- Reason `history` was included if applicable: not required.

### ROUTER DECISION
- Why this mode is correct: the bundle is Bugfix in the broader sense — each item closes a defect (misleading copy, missing empty state, contradictory CTA, role-blind label). No new product capability is introduced. The 8 items share a single review unit ("UX honesty"), share zero new contracts, and the cheapest-correct path for all of them is the same chain (Frontend → Testing → Docs → Validator).
- Why this depth is correct: Lite. The bundle touches 7 files. No contract / interface / data-flow changes. No new endpoint, no new component, no role-permission shift. Architecture / Security / Refactor / Infra add no value to copy + hide decisions. A Full path would inflate cost without reducing risk.
- Why this skill is the right active skill now: nothing else can route until per-item target copy is fixed, hide-or-wire decisions are locked, and the operating rules that bind F-V05 are quoted verbatim. Frontend cannot implement without scope.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules".
- Contracts or architecture inputs available: none required. All decisions are bounded by existing operating rules in `docs/context/project.context.core.md` lines 376-405 (treat `IA Asistente` as non-operational; rewards/points honest-unavailable; etc.) and by the post-cutover wallet copy posture established by F-V03.
- Relevant handoffs received: user confirmed Día 2 UX bundle scope on 2026-05-14, citing `C:\Users\pbu50\Desktop\Noon App\audits\NoonApp UX findings 10-05-2026.md`. Router pre-decided: Bugfix Lite, single PR, hide-not-wire defaults for F-V04 and F-V05.
- External dependencies or environment assumptions: none. No new env vars. No new deps. No migrations.

### RISK SNAPSHOT
- Known risks before starting:
  - **F-V18 sidebar restructure may misalign with operator mental model.** Moving `Reportes` out of `Finanzas` is a sidebar-level change every authenticated user sees. Mitigation: keep the move minimal — `Reportes` rejoins the workspace block (the top group with `Dashboard`, `Actualizaciones`, `Notificaciones`). No new label, no new color, no new group. The Finanzas group keeps `Créditos / Earnings / Recompensas` — the three personal-money surfaces. Documented as decision below.
  - **F-V19 quick action label must not invent a new role helper.** The sidebar already does this exact swap at `components/app-sidebar.tsx:194-197` using `authMode === 'supabase' && user.role !== 'developer'`. Mitigation: Frontend replicates that inline check at the call site in `app/dashboard/page.tsx:347` — no new helper function, no new import. Documented under F-V19 below.
  - **F-V05 hide on Propuesta tab vs operating rule on `IA Asistente`.** The operating rule binds `IA Asistente` specifically; the Propuesta tab is a different tab. Mitigation: the rule below is quoted verbatim and the decision below extends the same posture to the Propuesta-tab CTA explicitly, with one-line rationale ("two AI surfaces in the same component must not contradict each other"). Frontend cannot deviate.
  - **F-V04 hide vs wire.** Hiding is the cheaper path. Wiring would require a new prefilled-dialog contract in `app/dashboard/leads/page.tsx` (currently only reads `leadId` per line 109). Mitigation: hide explicitly, document the wiring path as deferred to a future iteration (out-of-scope below) so the operator path can be reinstated without re-discovery work. Confirmed the page retains other actions: the `result` card above the CTAs at `app/dashboard/web-analysis/page.tsx` still renders the analysis output, scoring, opportunities list, and pricing block — the page does not become useless without the CTAs.
  - **Pipeline empty-state regression risk.** `components/kanban-board.tsx:203-210` already renders a per-column empty state ("Vacío" / "Suelta aquí"). The audit's complaint is that this minimal copy is meaningfully thinner than `app/dashboard/projects/page.tsx:490-501` (which uses the `Empty` component with `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`). Mitigation: enrich the empty state inside `components/kanban-board.tsx` itself — the change benefits every kanban consumer, not just `/dashboard/pipeline`, and avoids forking the kanban implementation. Care needed because `/dashboard/projects` does NOT use the shared `KanbanBoard` (it builds its own kanban inline at lines 475-505), so the enrichment only affects pipeline.
- Known blockers before starting: none.
- Known assumptions before starting:
  - The 218/218 test baseline established by F-V03 holds at iteration start. Pure copy / label / empty-state changes do not require new unit tests beyond a smoke test for the kanban empty state. Documented under Test Plan below.
  - `app/page.tsx` is the login page (verified by user-supplied line range 108-112).
  - The sidebar restructure does not break any tests (sidebar tests, if any, assert presence of nav items, not group membership).

### CONTINUITY NOTES
- Previous session relevant to this one: 2026-05-13 / 2026-05-14 closed F-V03 (PR #39 merged, then closure PR with retry-on-error fix + docs scrub via PR #40). This bundle is the fourth FASE 1 iteration and closes the Día 2 UX bundle plus the Día 5 buffer items F-V04 / F-V05 per roadmap §5.
- Expected next skill after this session if all goes well: system-frontend, with the handoff payload below.

---

## Task Summary

Close 8 UX findings from the 2026-05-10 audit in one bundled iteration:

1. **F-V09** — Rename the `Pendiente` bucket helper text on `/dashboard/earnings` to match the actual admin-credit + consolidate workflow.
2. **F-V11** — Enrich the per-column empty state in `components/kanban-board.tsx` so `/dashboard/pipeline` shows a richer empty cell matching the operator's expectation set by `/dashboard/projects`.
3. **F-V13** — Replace the jargon-heavy "Hand-off comercial" / "Aún no hay propuestas persistidas" first-time empty state in the Propuesta tab of `components/lead-detail.tsx` with friendly first-proposal copy.
4. **F-V18** — Move `Reportes` out of the `Finanzas` sidebar group into the top workspace group (with `Dashboard`, `Actualizaciones`, `Notificaciones`).
5. **F-V19** — Make the `Mis tareas` quick action label role-aware in `app/dashboard/page.tsx`, reusing the existing `authMode === 'supabase' && user.role !== 'developer'` pattern already in the sidebar.
6. **F-V20** — Replace the pre-launch dishonest "Comisiones y recompensas / Sistema de puntos y pagos automatizados" copy on `app/page.tsx` with operator-honest copy.
7. **F-V04** — Hide the two contradictory CTAs in `app/dashboard/web-analysis/page.tsx` (lines 304-319 "Abrir en Maxwell" and 320-336 "Crear Lead desde análisis") because the leads page does not parse `maxwell=1&msg=...` or `newLead=1&company=...&notes=...` query params; the wiring path is deferred.
8. **F-V05** — Hide the "Generar con Maxwell" button in `components/lead-detail.tsx:1620-1630` (Propuesta tab) in `supabase` mode to align both AI surfaces in the same component with the operating rule that treats `IA Asistente` as non-operational.

One chunk, one PR. Approximately 3-5 hours of system-frontend + a single smoke test for F-V11. No backend changes. No new dependencies.

---

## Scope Boundary

### Included

#### F-V09 — `Pendiente` helper text on `/dashboard/earnings`
- **Location:** `app/dashboard/earnings/page.tsx:312-315`.
- **Current state (verbatim from file):**
  ```
  <div className="metric-card">
    <p className="metric-label">Pendiente</p>
    <p className="metric-value text-yellow-600">{fmt(summary?.pending ?? 0)}</p>
    <p className="metric-note">En validacion por PM</p>
  </div>
  ```
- **Target state:** keep the bucket; rewrite the helper note to match the runtime. The pending bucket is created when admin credits an earning via `POST /api/admin/earnings/credit` and waits to be consolidated by the consolidate routine (no operator-visible surface; F-V02 deferred). The current "En validacion por PM" misnames the actor (admin, not PM) and the action (credit + consolidate, not validation).
- **Exact replacement note:** `En revisión por administración` (8 characters of breathing room for the `metric-note` styling; matches the no-accents conventions used in surrounding labels — note that `validacion` had no accent either, so `revisión` here is acceptable Spanish or `revision`; Frontend uses whichever matches the existing repo convention for this file, defaulting to no-accent `revision` to match `validacion por PM`).
- **Rationale:** the user must not see a PM workflow that does not exist. "Revisión por administración" is honest about the actor (admin), generic about the timing (no specific SLA promised), and consistent with the existing `Earnings` page tone.
- **Success criterion:** the text under `Pendiente` reads `En revision por administracion` (or `En revisión por administración`) and the previous string "En validacion por PM" no longer appears anywhere in the file.

#### F-V11 — Per-column empty state on `/dashboard/pipeline`
- **Location:** `components/kanban-board.tsx:203-210`. This shared component is consumed by `/dashboard/pipeline` (via `app/dashboard/pipeline/page.tsx:99-104`). `/dashboard/projects` does NOT use this component (it builds its own kanban inline at `app/dashboard/projects/page.tsx:475-505`) — so the enrichment here affects only the pipeline surface, which is the audit target.
- **Current state (verbatim):**
  ```
  {column.items.length === 0 && (
    <div className={cn(
      "h-[80px] border-2 border-dashed rounded-lg flex items-center justify-center text-muted-foreground/50 text-xs transition-colors",
      isOver && "border-primary/50 bg-primary/5 text-primary"
    )}>
      {isOver ? 'Suelta aquí' : 'Vacío'}
    </div>
  )}
  ```
- **Target state:** preserve the `isOver` branch (drop-target hint stays as `Suelta aquí`). Replace the default `Vacío` branch with an `Empty` component instance matching the pattern at `app/dashboard/projects/page.tsx:491-501`. Use a `Building2` icon (already imported elsewhere in pipeline contexts — Frontend picks the closest match; `Building2` is used for lead company in pipeline cards, so a different generic icon like `Inbox` or `LayoutGrid` is acceptable and may be more semantically neutral for "no leads in this stage"). Copy:
  - `EmptyTitle`: `Sin leads`
  - `EmptyDescription`: `Arrastra un lead a esta etapa.`
- **Sizing constraint:** the existing default branch uses `h-[80px]`. The richer `Empty` component naturally needs more height; the projects page uses `min-h-[120px]`. Apply the same `min-h-[120px]` here. The `isOver` branch keeps its existing height behavior to avoid layout shift during drag.
- **Rationale:** the audit's complaint is asymmetry between the projects kanban (rich `Empty` with `Sin proyectos / No hay elementos en esta etapa por ahora`) and the pipeline kanban (terse `Vacío`). Aligning the two patterns is a 5-line change inside one shared component and serves every future consumer.
- **Success criterion:** rendering `/dashboard/pipeline` with at least one column empty shows an icon + `Sin leads` title + `Arrastra un lead a esta etapa.` description. Dragging a card over an empty column still shows `Suelta aquí`. The shared component still compiles with no new prop required at call sites — the change is internal.

#### F-V13 — First-proposal empty state in `components/lead-detail.tsx`
- **Location:** `components/lead-detail.tsx:1614-1641` (the `Hand-off comercial` section header at line 1618 plus the `proposals.length === 0` empty state at lines 1638-1641).
- **Current state (verbatim):**
  ```
  <div className="flex items-center gap-2">
    <ArrowRightLeft className="size-4 text-muted-foreground" />
    <p className="text-sm font-medium">Hand-off comercial</p>
  </div>
  ...
  ) : proposals.length === 0 ? (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      Aun no hay propuestas persistidas para este lead.
    </div>
  ) : (
  ```
- **Target state:**
  - Section header label: replace `Hand-off comercial` with `Propuestas` (matches the tab name `Propuesta` already visible above; removes the internal-jargon term `Hand-off comercial` from the user-visible label).
  - Empty-state body text: replace `Aun no hay propuestas persistidas para este lead.` with `Todavía no creaste una propuesta para este lead. Usa el formulario de arriba para guardar la primera.` (no-accent variant `Todavia no creaste una propuesta para este lead. Usa el formulario de arriba para guardar la primera.` is also acceptable to match the file's existing no-accent convention — Frontend picks whichever matches surrounding strings in the same file).
- **Rationale:** "Hand-off comercial" is internal vocabulary that no first-time operator should need to understand to create their first proposal. "Propuestas" matches the tab they are already on. The empty-state body acts as a wayfinding hint to the form directly above it instead of explaining a missing infrastructure concept ("persistidas").
- **Success criterion:** rendering the Propuesta tab on a lead with zero proposals shows the new section header `Propuestas` (no `Hand-off comercial` substring anywhere in the rendered tab) and the new empty-state body text. No regression on the populated-proposals path (the `proposals.length > 0` branch is untouched).

#### F-V18 — Sidebar group restructure
- **Location:** `components/app-sidebar.tsx:73-79`.
- **Current state (verbatim):**
  ```
  const financeNavItems = [
    { title: 'Creditos', href: '/dashboard/credits', icon: Wallet },
    { title: 'Earnings', href: '/dashboard/earnings', icon: DollarSign },
    { title: 'Recompensas', href: '/dashboard/rewards', icon: Gift },
    { title: 'Reportes', href: '/dashboard/reports', icon: BarChart3 },
  ]
  ```
- **Decision (locked):** move `Reportes` out of `financeNavItems` into `workspaceNavItems` (the top group with `Dashboard`, `Actualizaciones`, `Notificaciones`). Do NOT create a new "Operaciones" group. Rationale: a new group inflates sidebar visual hierarchy for one item. The workspace group already represents the operator's read-only situational-awareness surfaces (`Dashboard` = read-only KPIs, `Actualizaciones` = read-only event feed, `Notificaciones` = read-only inbox), which is exactly what `/dashboard/reports` is.
- **Target state:**
  ```
  const workspaceNavItems = [
    { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { title: 'Actualizaciones', href: '/dashboard/updates', icon: Activity },
    { title: 'Notificaciones', href: '/dashboard/notifications', icon: Bell },
    { title: 'Reportes', href: '/dashboard/reports', icon: BarChart3 },
  ]

  const financeNavItems = [
    { title: 'Creditos', href: '/dashboard/credits', icon: Wallet },
    { title: 'Earnings', href: '/dashboard/earnings', icon: DollarSign },
    { title: 'Recompensas', href: '/dashboard/rewards', icon: Gift },
  ]
  ```
- **Insertion order:** `Reportes` lands at the end of the workspace group (after `Notificaciones`). Keeps `Dashboard` first as the home anchor; appends `Reportes` last as the most operational of the four.
- **Icon:** keep `BarChart3` (already imported at line 21).
- **Rationale:** `Reportes` is a read-only operational view, not a personal-money surface like `Créditos`, `Earnings`, or `Recompensas`. Misclassifying it in `Finanzas` implies it is per-user financial data. Moving it to the workspace group correctly frames it as "team situational awareness".
- **Success criterion:** sidebar renders with `Reportes` under the workspace group (no group label) immediately after `Notificaciones`. The `Finanzas` group renders with exactly three items (`Creditos`, `Earnings`, `Recompensas`) and the green color marker is preserved.

#### F-V19 — Role-aware `Mis tareas` quick action label
- **Location:** `app/dashboard/page.tsx:342-352` (the delivery `Link` to `/dashboard/tasks` with hardcoded title `Mis tareas`). The role check is already done via `canAccessDelivery(user.role)` at line 330 (already imported at line 6).
- **Pattern to replicate (verbatim from `components/app-sidebar.tsx:194-197`):**
  ```
  if (item.href !== '/dashboard/tasks') return item
  const shouldShowTeam = authMode === 'supabase' && user.role !== 'developer'
  return { ...item, title: shouldShowTeam ? 'Tareas del equipo' : item.title }
  ```
- **Target state:** inline the same check at the quick-action label site. Pseudocode:
  ```
  const tasksQuickActionLabel =
    authMode === 'supabase' && user.role !== 'developer'
      ? 'Tareas del equipo'
      : 'Mis tareas'
  ```
  Then render `tasksQuickActionLabel` at line 347 in place of the hardcoded `Mis tareas`. The companion sub-line `{delivery.actionableTasks} pendientes` at line 348 stays unchanged (the count is real either way).
- **Rationale:** the sidebar already does this. The quick action is a parallel surface and must agree. Reusing the existing condition (not a new helper) prevents drift.
- **No new helper.** Do NOT create a `getTasksLabel(user, authMode)` function in `lib/auth-context` or anywhere else. The audit and the router both said reuse the existing pattern verbatim; introducing a helper would expand scope and create a second source of truth.
- **Success criterion:** on `/dashboard` rendered for an admin or pm in `supabase` mode, the quick-action card under `Proyectos` reads `Tareas del equipo`. For a developer in `supabase` mode and for any user in `mock` mode, it reads `Mis tareas`.

#### F-V20 — Login page operator-honest copy
- **Location:** `app/page.tsx:104-112`.
- **Current state (verbatim):**
  ```
  <div className="flex items-start gap-4">
    <div className="size-10 rounded-lg bg-sidebar-accent flex items-center justify-center shrink-0">
      <TrendingUp className="size-5 text-primary" />
    </div>
    <div>
      <h3 className="font-semibold mb-1">Comisiones y recompensas</h3>
      <p className="text-sm text-sidebar-foreground/60">Sistema de puntos y pagos automatizados para todo el equipo</p>
    </div>
  </div>
  ```
- **Reality check:** payouts are manual (admin form + `scripts/withdraw-payout.ts`); credits are prototype-level ($1 = 1 credit invariant; not productized); rewards has no fulfillment surface. The current copy promises "automatizados" (automated payments) and "sistema de puntos" (operational points system) — neither is true at the cutover.
- **Decision (locked):** rewrite the headline + body to describe the wallet + commissions + internal credits the runtime actually has. Drop the points / automation language.
- **Target state — chosen wording (locked):**
  - Headline: `Wallet y comisiones internas`
  - Body: `Balance, comisiones y créditos internos visibles para tu equipo.`
- **Alternate considered (rejected):** `Comisiones y créditos internos / Sistema de wallet y créditos para tu equipo.` Rejected because the chosen wording leads with the operator-visible surface (`Wallet`) which matches the now-real balance chip from F-V03, while still naming `comisiones` for the commissions story. The alternate buried the wallet under "comisiones" first.
- **Rationale:** must be honest pre-launch about what an operator actually sees once logged in (the F-V03 wallet chip; commissions accrued via `/api/admin/earnings/credit`; rewards/points stay honest unavailable per the operating rule). No promise of automated payouts. No reference to a points system.
- **Success criterion:** login page renders with exactly the new headline and body. No occurrences of "automatizados" or "sistema de puntos" in `app/page.tsx`.

#### F-V04 — Hide contradictory CTAs on `/dashboard/web-analysis`
- **Location:** `app/dashboard/web-analysis/page.tsx:302-336` (the two `Button`s `Abrir en Maxwell` at 304-319 and `Crear Lead desde análisis` at 320-335, wrapped in a `<div className="flex flex-col sm:flex-row gap-3">` opened at 303).
- **Why hide (not wire):**
  - `Abrir en Maxwell` builds `/dashboard/leads?maxwell=1&msg=...`. The leads page at `app/dashboard/leads/page.tsx:109` only reads `leadId` from the query string. The `maxwell` and `msg` params are silently dropped.
  - `Crear Lead desde análisis` builds `/dashboard/leads?newLead=1&company=...&notes=...`. The same page only reads `leadId`; `newLead`, `company`, and `notes` are silently dropped. The user lands on the leads page with no prefilled dialog.
  - Wiring either CTA would require a new contract: a prefilled-dialog state shape, validation rules, and conflict resolution with the existing `leadId` overlay model. That work belongs in a separate iteration with explicit scope.
  - Hide is the cheapest path to honesty; the wiring path is documented as deferred so it can be picked up without re-discovery.
- **Decision (locked):** hide both buttons and the wrapping `<div>` and the `<Separator />` at line 300 that introduced them. Keep everything above line 300 unchanged: the result card with summary, scoring, opportunities list, pricing block — the page still serves its analysis-output purpose.
- **Target state:** delete the block from the `<Separator />` at line 300 through the closing `</div>` at line 336 inclusive. The page returns its analysis JSX without the action strip.
- **What remains visible on the page (after the change):** the analysis output block (everything above the deleted `<Separator />`). The user can still read the analysis; they cannot trigger a CTA that lands on a page that ignores their parameters. If they want to act on the analysis, they navigate to leads or pipeline manually — the same way they would today after closing the leads page.
- **Imports to drop if unused:** `Sparkles` and `ArrowRight` icons may become unused after deletion. Frontend removes them from the lucide-react import if they are not referenced elsewhere in the file (TypeScript `noUnusedLocals` will catch it on `pnpm run typecheck` if missed).
- **Rationale:** false-action CTA is worse than no CTA. Until the leads page accepts a prefilled-dialog contract, the buttons cannot do what they advertise.
- **Success criterion:** rendering `/dashboard/web-analysis` with an analysis result shows the analysis card but no `Abrir en Maxwell` or `Crear Lead desde análisis` button. The result block above renders identically. `pnpm run typecheck` and `pnpm run lint` are clean (no unused-import warnings).

#### F-V05 — Hide `Generar con Maxwell` on the Propuesta tab in `supabase`
- **Location:** `components/lead-detail.tsx:1620-1630`.
- **Current state (verbatim):**
  ```
  {isSupabaseMode && (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => setShowMaxwellDialog(true)}
    >
      <Sparkles className="size-3.5 mr-1.5" />
      Generar con Maxwell
    </Button>
  )}
  ```
- **Binding operating rule (verbatim from `docs/context/project.context.core.md` line 387):**
  > Treat `components/lead-detail.tsx` `IA Asistente` in `supabase` as an intentionally non-operational surface until contextual Maxwell wiring is real; do not reintroduce simulated generation/send affordances.
- **Companion rule (verbatim from `docs/context/project.context.core.md` line 390):**
  > Treat `components/maxwell-chat.tsx` in `supabase` as a general assistant without automatic workspace grounding; do not reintroduce lead-aware or account-aware claims/prompts unless Maxwell is actually wired to real business context.
- **Decision (locked):** hide the `Generar con Maxwell` button in `supabase` mode. The audit's contradiction is that `IA Asistente` is non-operational per line 387, but the Propuesta tab still surfaces a Maxwell CTA — both AI affordances live in the same component (`components/lead-detail.tsx`) and an operator cannot reconcile "AI is not wired" with "but here's a button to generate with AI". Aligning both surfaces to non-operational in `supabase` mode resolves the contradiction.
- **Target state:** remove the `{isSupabaseMode && (...)}` block at lines 1620-1630. The `Hand-off comercial` (renamed to `Propuestas` per F-V13) section header keeps its icon + label but no action button on the right side. In `mock` mode the button was already not shown (the existing `isSupabaseMode &&` gate hid it for non-supabase), so this is a strict subtraction.
- **Side-effect on `setShowMaxwellDialog`:** the state setter is presumably still referenced elsewhere in the file (the `MaxwellDialog` consumer may exist). Frontend confirms on first read that the dialog mount is still reachable from another entry point (the `IA Asistente` tab itself, which is the surface the operating rule binds). If `setShowMaxwellDialog` becomes unreferenced after this change, Frontend removes it under the same PR (no scope creep — it is part of the same hide decision). If it stays reachable from another entry point, leave it.
- **Why this does not violate the `IA Asistente` rule:** the `IA Asistente` rule binds the `IA Asistente` tab specifically. The Propuesta tab is a different tab. The hide decision here extends the same posture (non-operational in `supabase`) to a contradictory CTA in a sibling tab — this is consistent with, not a relaxation of, the operating rule.
- **Rationale:** two AI surfaces in the same component must not contradict each other.
- **Success criterion:** rendering a lead detail in `supabase` mode shows the Propuesta tab without the `Generar con Maxwell` button. Rendering the same lead in `mock` mode is unchanged (the button was already gated off). No regression on the `Hand-off comercial → Propuestas` rename in F-V13 (the two changes are in the same line range and Frontend lands them together).

### Excluded
- **F-V04 wiring path.** Building a prefilled-dialog contract in `/dashboard/leads` so `Abrir en Maxwell` and `Crear Lead desde análisis` actually land in a usable state. Deferred to a future iteration with its own spec; the current iteration only hides the false CTAs.
- **F-V05 wiring path.** Wiring Maxwell to real lead context so `Generar con Maxwell` is a true affordance. Deferred until contextual Maxwell wiring is real (per the operating rule at line 387). The current iteration only hides the contradictory CTA in `supabase` mode.
- **F-V06, F-V07, F-V08 — Tier 3 items from the audit.** Out of scope for this bundle per router decision; queued for a later iteration if still relevant after the cutover.
- **F-V12, F-V14, F-V15, F-V16, F-V17 — Tier 4 items from the audit.** Out of scope per router decision; deferred.
- **F-V02 — admin consolidate UI surface for the `Pendiente` bucket.** Already deferred per the F-V09 context. F-V09 in this bundle is copy-only.
- **Sidebar group color changes, new groups, or icon swaps beyond the explicit `Reportes` move in F-V18.** Out of scope.
- **Login page hero copy beyond F-V20.** The other two value-prop blocks at `app/page.tsx` (the lead intelligence promise above and the hand-off promise above F-V20) are NOT touched by this iteration. If they need honesty review later, that is a separate scoping question.
- **Adding new tests for pure copy changes (F-V09, F-V13, F-V18, F-V19, F-V20, F-V05's hide).** Pure string changes do not need unit tests beyond the existing typecheck + lint + build. Adding tests would inflate cost without reducing risk; the baseline 218/218 tests must stay green.
- **A test for F-V04 hide.** No unit test required; visual validation is sufficient.
- **A test for the pipeline kanban empty state F-V11.** OPTIONAL: a single component test asserting the new `Sin leads` / `Arrastra un lead a esta etapa.` strings render when `column.items.length === 0`. Documented in Test Plan as recommended but not blocking — Frontend may choose to add it if the existing kanban-board test file exists.
- **i18n / locale switching** for any of the new copy. Spanish-only per ADR-010.
- **Refactor of unrelated lead-detail / sidebar / dashboard code.** Untouched.
- **Telemetry / Sentry wiring on the hidden CTAs.** Deferred per the observability decision (PR #30).
- **Changes to `docs/context/project.context.core.md` operating rules.** The existing rules at lines 376-405 are sufficient to support this iteration; no new rule is needed, since hiding is a tightening of existing posture, not a new posture.

---

## Affected Files / Modules

| File | Type | Action |
|---|---|---|
| `app/dashboard/earnings/page.tsx` | source | EDIT — F-V09 `metric-note` text under `Pendiente` (line 314) |
| `components/kanban-board.tsx` | source | EDIT — F-V11 enrich the per-column empty state at lines 203-210 |
| `components/lead-detail.tsx` | source | EDIT — F-V13 rename `Hand-off comercial` → `Propuestas` (line 1618) + empty state body (line 1640); F-V05 hide `Generar con Maxwell` button (lines 1620-1630) |
| `components/app-sidebar.tsx` | source | EDIT — F-V18 move `Reportes` from `financeNavItems` to `workspaceNavItems` (lines 68-79) |
| `app/dashboard/page.tsx` | source | EDIT — F-V19 inline role-aware label for the `Mis tareas` quick action (around line 347) |
| `app/page.tsx` | source | EDIT — F-V20 headline + body of the third value-prop block (lines 109-111) |
| `app/dashboard/web-analysis/page.tsx` | source | EDIT — F-V04 delete the action strip (lines 300-336, the `<Separator />` + the wrapping `<div>` with both CTAs); drop unused imports if any |
| `tests/components/kanban-board.test.tsx` | test | OPTIONAL NEW — single smoke test for the new pipeline empty state copy (only if Frontend judges it valuable; not gating) |
| `specs/fase-1-ux-honesty-bundle.md` | spec | NEW (this file) |
| `docs/context/project.context.core.md` | context | UPDATE at iteration close — Closed-in-runtime entry covering this bundle |
| `docs/context/project.context.history.md` | context | UPDATE at iteration close — Session note for the bundle |

No migrations. No schema changes. No new API routes. No new deps. No new env vars.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| Existing `Empty`, `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription` from `@/components/ui/empty` | internal | available | F-V11 implementation cannot proceed (would have to invent ad-hoc empty UI) | this repo |
| Existing `lucide-react` icon set (`Inbox`, `LayoutGrid`, or similar for F-V11) | external | available | minor cosmetic choice; any of several icons works | platform |
| Existing role helpers (`canAccessDelivery`, `useAuth`) in `lib/auth-context` | internal | available | F-V19 inline check would have to be reinvented; mitigation is unnecessary since the check is inline | this repo |
| Existing `KanbanBoard` shared component | internal | available | F-V11 hits the right consumer (`/dashboard/pipeline`) and does not affect `/dashboard/projects` which uses its own inline kanban | this repo |
| Existing F-V03 wallet copy posture in `app/page.tsx` rendering context | internal | informational | F-V20 chosen wording (`Wallet y comisiones internas`) aligns with the now-real balance chip | this repo |

---

## Assumptions
1. The repo's existing convention for diacritics in `metric-note` style copy follows the surrounding strings (`En validacion por PM`, `Consolidado y listo`, `En disputa o retencion` — all no-accent). F-V09's chosen target keeps the no-accent convention. If a future review imposes accents project-wide, that is a separate iteration.
2. `components/kanban-board.tsx` is used only by `/dashboard/pipeline` for board-style rendering. Spot-checked: `/dashboard/projects` builds its own kanban inline. If a third consumer is discovered during implementation, the F-V11 change still benefits it (a richer empty state is a strict improvement).
3. `setShowMaxwellDialog` in `components/lead-detail.tsx` is reachable from at least one other entry point after F-V05 removes the Propuesta-tab button. Validated by Frontend on first read of the file; if the setter becomes orphaned, Frontend removes it as part of the same hide decision (no scope creep).
4. The existing 218/218 test baseline holds at iteration start (last validated 2026-05-13 closure of F-V03).
5. The login page at `app/page.tsx` is a Server Component or a Client Component that does not depend on the new copy for any runtime logic — copy-only changes are safe (validated by user-supplied line range 108-112 indicating a value-prop block, not interactive logic).
6. ADR-010 (Spanish-only) holds for all the new copy.

---

## Open Questions
- **(F-V11 icon choice)** The audit cited the projects kanban pattern which uses `FolderKanban`. Pipeline columns hold leads, not projects. **Default chosen:** `Inbox` from `lucide-react` (semantically "an empty list awaiting items"; already in the lucide bundle so no new import cost). Frontend may select `LayoutGrid` if `Inbox` feels too email-coded for a sales pipeline. Either is acceptable; the audit did not require a specific icon.
- **(F-V09 diacritics)** Whether to write `revision` (matching the no-accent file convention) or `revisión` (correct Spanish). Default: `revision` (no accent) to match the surrounding strings in the same component. Frontend confirms on first read.

Neither blocks bounded progress; both are documented defaults.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| F-V11 enrichment breaks the kanban's drag-over interaction (the `isOver` highlight) | low | medium (drag UX degraded on every pipeline column) | low | preserve the existing `isOver` branch verbatim; only the `else` branch (empty + not-over) gets the richer Empty component; explicit success criterion above asserts both branches |
| F-V18 move surfaces a broken `Reportes` route under workspace group | very low | low | low | the route already works; the only change is its sidebar group membership |
| F-V19 inline check diverges from the sidebar pattern after a future role-system refactor | medium | low | low | inline is intentional — when the sidebar's pattern changes, both call sites are co-located by grep on `user.role !== 'developer'` |
| F-V20 chosen copy ages poorly when payouts become automated | low | low | low | the copy describes the runtime as of cutover; future iterations rewrite |
| F-V04 hide reduces operator workflow efficiency (they cannot one-click from analysis to lead creation) | low | low | low | the workflow was already broken (CTAs landed on a page that ignored params); hiding does not remove a real capability |
| F-V05 hide hides a path operators use today in production | very low | low | low | `IA Asistente` is non-operational per the operating rule at line 387; an honest no-button state matches the surrounding posture |
| Bundle is too large for one PR review | low | low | low | 7 small files, 6 of them ~5-line copy edits, 1 component-level empty-state enrichment; review unit is "UX honesty" not 8 unrelated changes |
| Baseline 218/218 regression from the kanban empty-state change | low | medium | low | no test currently asserts the `Vacío` string specifically (grep before edit confirms it); if one does, Frontend updates it under the same PR |

---

## Recommended Route Depth (Full / Lite)
**Lite.** Pure copy / label / empty-state changes plus two hide decisions. No contracts, no interfaces, no data flow shifts, no new modules. Architecture, Security, Refactor, Infra add no value to copy and hide decisions. Lite is the cheapest-correct path.

---

## Chunking Decision
**One chunk, one PR.** The 8 items share a single review unit ("UX honesty"). Each item is too small to justify its own PR (~5 lines each except F-V11 which is a single component-internal change). Splitting would create 8 PRs that no reviewer would want to inspect serially. Atomicity also makes the closure entry in `core.md` a single line instead of eight.

---

## Recommended Testing Methodology
**Integration-first.** Pure copy / label / empty-state changes are validated visually in the browser (one operator pass through the affected surfaces). No unit-test methodology applies meaningfully to string changes. The one optional unit test (F-V11 empty-state strings in `components/kanban-board.tsx`) is a smoke regression net, not a behavioral assertion. Justification: TDD / BDD / CDD all require behavioral verification that the iteration does not introduce; the deliverable is honest copy + a hidden CTA, both visual outcomes.

---

## Test Plan

Minimum gate for system-testing:
- `pnpm run typecheck` clean (catches unused-import regressions from F-V04 deletion, F-V18 reshuffle, F-V05 setter cleanup if applied).
- `pnpm run lint` clean.
- `pnpm run build` clean.
- `pnpm test` reports baseline 218/218 still green. No new tests are required by this iteration.

Optional regression net (recommended, not blocking):
- One smoke test in `tests/components/kanban-board.test.tsx` (new file if none exists for kanban-board; if it does exist, extend it). The test renders `<KanbanBoard columns={[{ id: 'a', title: 'A', color: 'bg-blue-500', items: [] }]} ... />`, asserts the rendered output contains the strings `Sin leads` and `Arrastra un lead a esta etapa.`, and asserts it does NOT contain the legacy `Vacío` string.
- Rationale for it being optional: the audit complaint is visual asymmetry, not a behavioral regression. The visual outcome is asserted by browser validation. The unit test only matters if a future PR accidentally regresses the empty-state strings.

Browser validation gate (gating artifact for system-validator):
- Evidence file at `docs/validations/Browser validation 2026-05-14 — fase-1 UX honesty bundle.md` (or `.html`) confirming each of the 8 items below renders correctly. Each item gets one scenario:
  1. F-V09: `/dashboard/earnings` Pendiente bucket helper note reads the new string.
  2. F-V11: `/dashboard/pipeline` with at least one empty column renders the richer empty state (icon + `Sin leads` + `Arrastra un lead a esta etapa.`). Dragging a card over the empty column still shows `Suelta aquí`.
  3. F-V13: a lead with zero proposals on the Propuesta tab renders `Propuestas` (not `Hand-off comercial`) and the new empty-state body (no `propuestas persistidas` substring).
  4. F-V18: sidebar renders with `Reportes` under the workspace group; `Finanzas` group has exactly 3 items.
  5. F-V19: as admin or pm in `supabase`, the `Mis tareas` quick action on `/dashboard` reads `Tareas del equipo`. As developer in `supabase` (or any user in `mock`), it reads `Mis tareas`.
  6. F-V20: login page at `/` renders the new headline + body; no `automatizados` / `sistema de puntos` substrings.
  7. F-V04: `/dashboard/web-analysis` shows the analysis result card and no `Abrir en Maxwell` / `Crear Lead desde análisis` buttons.
  8. F-V05: lead detail in `supabase` mode on the Propuesta tab shows no `Generar con Maxwell` button. In `mock` mode the same view is unchanged (button was already gated off).

---

## Validator pre-flight checklist
The iteration is ready for system-validator when:
- [ ] All 8 in-scope items are landed in a single PR against `develop`.
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` all clean.
- [ ] `pnpm test` reports 218/218 (or 219/219 if the optional F-V11 smoke test is added) — no regression from baseline.
- [ ] Browser validation evidence file exists with all 8 scenarios documented.
- [ ] No commit, PR title, PR body, code comment, or doc text contains an R-code, Sprint number, or plan-ID (memory rule).
- [ ] No absolute local filesystem path appears in committed files (PR #40 scrub rule).
- [ ] The PR is not auto-merged (memory rule).
- [ ] No operating rule in `docs/context/project.context.core.md` has been deleted or weakened by this iteration; lines 376-405 are untouched.

---

## Success Criterion
The iteration is COMPLETE when **all** of the following are true:

1. All 8 in-scope items above match their respective success criteria as observed in the browser validation evidence.
2. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` are clean.
3. `pnpm test` is green at 218/218 (or 219/219 if the optional smoke test was added).
4. The PR is opened against `develop` and is reviewed; not merged by Claude (memory rule).
5. system-validator returns COMPLETE.
6. `docs/context/project.context.core.md` is updated with a single Closed-in-runtime entry referencing this spec and the browser validation file.
7. `docs/context/project.context.history.md` is updated with a Session note covering Route used, Implemented, Scope boundary kept, Validation outcome, Docs updated, Completion status.

---

## Handoff payload to system-frontend

- **Task summary**: implement the 8 items per the file table. F-V11 enriches the shared kanban; F-V13 and F-V05 share the same file (`components/lead-detail.tsx`) and overlap in line range — land them together to avoid merge churn. F-V18 sidebar reshuffle is the only structural sidebar change; do not re-color, do not rename groups.
- **Scope boundary**: see "## Scope Boundary" above. Each item has explicit current state and target state.
- **Affected files/modules**: see "## Affected Files / Modules".
- **Dependencies**: see "## Dependencies".
- **Assumptions**: 1-6 above. Validate #2 (kanban-board has only one consumer for board-style usage) and #3 (`setShowMaxwellDialog` is reachable from another entry point) on first read.
- **Open questions**: F-V11 icon (default `Inbox`); F-V09 diacritics (default no-accent `revision`). Neither blocks.
- **Risks that may alter design**: F-V11 isOver branch must be preserved verbatim. F-V05 should not orphan state setters silently — if `setShowMaxwellDialog` becomes unreferenced, remove it; if reachable elsewhere, leave it.
- **Recommended depth**: Lite.
- **Chunking decision**: one chunk, one PR. Do NOT split into 8 micro-PRs.
- **Recommended testing methodology**: integration-first (browser validation gates closure; optional F-V11 smoke unit test).
- **Success criterion**: see "## Success Criterion" above. Browser validation evidence is the gating artifact for system-validator.
- **Spec location**: `specs/fase-1-ux-honesty-bundle.md` (this file).

---

## Out-of-scope (explicit deferred work)
- **F-V04 wiring** — building a prefilled-dialog contract in `/dashboard/leads` so the two web-analysis CTAs can land in a usable state. Separate iteration with its own spec.
- **F-V05 wiring** — wiring Maxwell to real lead context so a generation CTA is a true affordance. Blocked on the `IA Asistente` non-operational rule being lifted (line 387 in `core.md`).
- **F-V02 admin consolidate UI** — already deferred; F-V09 in this iteration is copy-only.
- **F-V06, F-V07, F-V08** — Tier 3 audit items, deferred to a later iteration.
- **F-V12, F-V14, F-V15, F-V16, F-V17** — Tier 4 audit items, deferred.
- **Login hero copy beyond F-V20** — the two value-prop blocks above F-V20 in `app/page.tsx` are not touched by this iteration.

---

## Forbidden constraints carried forward
- Auto-merging the resulting PR.
- Introducing R-codes / Sprint numbers / plan-IDs into `docs/context/*`, code comments, commit messages, or PR body.
- Using absolute local filesystem paths in docs, commit messages, or PR body.
- Creating a new role helper (`getTasksLabel` or similar) for F-V19. The inline check is the locked decision.
- Creating a new sidebar group (`Operaciones` or similar) for F-V18. The locked decision is to move `Reportes` into the existing workspace group.
- Wiring the F-V04 CTAs or the F-V05 button — both are hide decisions for this iteration.
- Modifying any operating rule at lines 376-405 of `core.md`. The bundle leans on existing rules; it does not add or weaken any.
- Adding new dependencies.
- Adding new env vars.
- Modifying unrelated dashboard / sidebar / lead-detail code.
- Including `.claude/settings.local.json` or `lib/server/seller-fees/schema.ts` working-tree noise in the bundle PR (per the 2026-05-13 handoff note — these are local-only line-endings / config drift).
- Including the untracked `docs/handoffs/` directory or the prior-session validation HTML in this PR.

---

## Spec lifecycle
- Status: **Approved (Analysis output)**; ready to route to system-frontend.
- Author: system-analysis (Pedro acting as Analysis in this session)
- Date: 2026-05-14
- Supersedes: nothing
- Superseded by: nothing
- Closes (roadmap §5): Día 2 UX bundle + Día 5 buffer items F-V04 / F-V05
