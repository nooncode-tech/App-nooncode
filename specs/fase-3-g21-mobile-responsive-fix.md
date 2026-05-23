# spec.md — fase-3-g21-mobile-responsive-fix

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-23
- Session ID: fase-3-g21-mobile-responsive-fix
- Developer: Pedro (`noondevelop@gmail.com`)
- Main active skill: `system-analysis` (this spec); downstream `system-frontend → system-refactor (conditional) → system-testing → system-docs → system-validator`
- Router mode: Bugfix
- Depth: FULL

### OBJECTIVE
- What must be achieved in this session: produce the canonical spec for the G21 mobile responsive fix iteration; bound it strictly to four surfaces (sidebar/shell, `/dashboard` home, `/dashboard/leads` list, lead-detail dialog), 375×667 acceptance, and a "no horizontal scroll, navegable end-to-end" criterion. Spec is the Analysis output that frontend will consume; it locks the scope so the iteration cannot drift into the broader frontend-redesign track.
- Why this work matters now: G21 was deferred 2026-05-22 from the B23 a11y audit (PR #91) as a CRITICAL + HIGH gap. On 375×667 (iPhone SE) the dashboard is **not navigable** (`SidebarTrigger` lives only inside the closed sidebar — there is no mobile header trigger to open it), and `/dashboard/leads` cards cause horizontal scroll. The internal pilot (4-person team, desktop-only) tolerates this; any external customer exposure does not. Roadmap §G21 estimate: 3–5d for core surfaces.
- It is NOT the frontend-redesign track. The runbook `docs/runbooks/frontend-redesign-playbook.md` (3-phase A/B/C) is **not invoked**. This iteration is the explicitly-deferred minimal fix, reusing existing shadcn primitives, with **no** v2 design system, **no** URL restructure, **no** wire-contract changes, **no** `lib/data-context.tsx` touches.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: no — Bugfix FULL on UI shell only; no contracts/data-flow/auth/middleware/wire-types are modified. The sidebar primitive (`components/ui/sidebar.tsx`) already exposes mobile drawer behavior via `useSidebar().openMobile` + Sheet; the fix is composing the existing primitive, not redesigning the contract.
- `project.context.history.md` reviewed: no — no historical decisions are being revisited; this iteration is the closure of a known-deferred gap.
- `docs/runbooks/frontend-redesign-playbook.md` reviewed: yes — used to confirm what we are explicitly NOT doing. The playbook's "Lo que NO recomiendo" anti-patterns (touching `lib/data-context.tsx`, adding SWR/React Query, changing auth surface, redesigning `/client/[token]`) are the same exclusions enforced in this spec.

### ROUTER DECISION
- Why this mode is correct: Bugfix. G21 is a known defect (F14 CRITICAL + F15 HIGH from B23 audit). Success criterion is "make broken surface work," not "introduce new capability" (would be New Build) or "improve maintainability without behavior change" (would be Refactor).
- Why this depth is correct: FULL. The drawer-trigger pattern affects every authenticated route, not just one page. Router operator-LITE reasoning ("only UI layer, no contracts touched") is correct about blast radius but underweights cross-route shell behavior. FULL forces spec + Validator gate, which the operator's own memory note ("Agent usage proportional to scope") supports for substantial work.
- Why this skill is the right active skill now: nothing else can route until the four-surface boundary and the 375 acceptance bar are written down. Frontend cannot start the shell trigger placement without confirming which header it lives in. The spec is the authoritative scope contract Validator will measure against.
- Reroute already known at start: no.
- Skills explicitly skipped and why:
  - `system-architecture` skipped — no new contracts, no data-flow changes, no module boundary shifts. Drawer is a UI composition, not an architectural decision. **Reroute trigger**: if frontend discovers the responsive fix needs a new shared hook/context contract (e.g., a `useMobileChrome` provider, a global breakpoint context beyond `useIsMobile`), it must stop and reroute to architecture rather than silently introducing it.
  - `system-security` skipped — no auth, permissions, endpoints, validation, uploads, secrets, payments, or sensitive data are touched. CSS + component composition only.
  - `system-infra` skipped — no runtime/env/deploy/pipeline impact.
  - `system-refactor` **conditional** — runs only if frontend output shows the shell refactor compounds debt that the iteration would otherwise leave behind. Validator will check this decision was explicit (skipped-with-reason or executed-with-evidence).

### SCOPE
- In scope: see `## Scope Boundary`.
- Explicitly out of scope: see `## Scope Boundary`.
- Success criterion: see `## Success Criterion`.

### INPUTS
- Files/modules involved: see `## Affected Files / Modules`. Hot spots already confirmed by discovery:
  - `components/app-sidebar.tsx` (no mobile trigger rendered outside sidebar — F14 root cause)
  - `components/lead-card.tsx` (three `shrink-0` siblings + price competing for ~327px after score badge — F15 root cause)
  - `app/dashboard/leads/page.tsx` (DialogContent `max-w-2xl` > 375)
  - `app/dashboard/layout.tsx` (where the mobile-header chrome would mount inside `SidebarInset`)
- Contracts or architecture inputs available: none touched. `lib/data-context.tsx`, `lib/leads/serialization.ts`, `app/api/**`, `proxy.ts`, `lib/auth-context.tsx`, `docs/integrations/cross-repo-webhook-v1.md`, `docs/api-auth-matrix.md` — **all locked**.
- Relevant handoffs received:
  - Router handoff 2026-05-23 (this session): Bugfix / FULL / single iteration / shell-first internal sequence / browser validation 375×667 mandatory.
  - Operator scope confirmation 2026-05-23: "Responsive fix mínimo G21" — sin design system v2, sin redesign visual.
- External dependencies or environment assumptions: local `pnpm dev` session in `supabase` mode against dev/preview Supabase project. Mobile viewport simulation via browser DevTools responsive mode (Chrome / Firefox / Safari). Real-device verification optional but recommended for tap targets.

### RISK SNAPSHOT
- Known risks before starting: see `## Risks`.
- Known blockers before starting: none. The work can start immediately on `develop` HEAD.
- Known assumptions before starting: see `## Assumptions`.

### CONTINUITY NOTES
- Previous session relevant to this one:
  - **B23 a11y manual ronda** (PR #91, 2026-05-22, PARTIAL closure) — surfaced F14 + F15 during V3 mobile viewport sweep. Audit fixed 10/17 findings; mobile pair was deferred to this iteration as G21. Discovery of `app/globals.css:196` `[data-slot="card"] { box-shadow: none !important }` (F16 systemic) means any new card focus styling must use `outline` not `ring-*`.
  - **R3 Opción C** (PR #98 + #99, 2026-05-22) — closed FASE 3 coding canon. This iteration is part of the operational tail (B1.5 + G21) per roadmap §17.
- Expected next skill after this session if all goes well: `system-frontend` with the handoff payload below.

---

## Task Summary

Fix the mobile responsive gap on the four highest-impact dashboard surfaces so the app is **navigable end-to-end at 375×667 with no horizontal scroll**. The work is a composition of existing shadcn primitives — the sidebar primitive already implements offcanvas Sheet mode via `useSidebar().openMobile`; the current bug is that `app-sidebar.tsx` never renders a `SidebarTrigger` *outside* the sidebar, so on mobile (when the Sheet is closed) the user has no affordance to open it. The lead-card horizontal scroll is a flexbox layout issue inside `components/lead-card.tsx` where the title row places three `shrink-0` siblings next to a `truncate` heading at a viewport too narrow for them.

The four surfaces:

| # | Surface | Bug origin | Fix shape |
|---|---|---|---|
| 1 | Sidebar / shell | F14 (B23 V3 smoke) — no mobile drawer trigger | Mount a mobile-only header inside `SidebarInset` that renders `SidebarTrigger` + (optional) compact wordmark. `<768px` only. Verify `Sheet` (already wired in `components/ui/sidebar.tsx:183-205`) opens/closes correctly. |
| 2 | `/dashboard` home | Header action chips group + KPI grids reflow check | Verify `.metric-grid` (`grid sm:grid-cols-2 lg:grid-cols-4`) stacks to single column at <640. Verify header action chips group does not horizontal-scroll at 375. Adjust if any chip has `min-w-[170px]+` forcing overflow. |
| 3 | `/dashboard/leads` (list + cards) | F15 — `LeadCard` title row + quick actions overflow at 375 | Reflow `LeadCard` interior: title row stacks vertically at narrow widths; quick-actions group either drops below content or collapses to the dropdown-only at narrow widths; contact info wraps cleanly; Maxwell snapshot already uses flex-wrap and is OK. |
| 4 | `/dashboard/leads/[modal]` (lead-detail Dialog) | Implicit — `DialogContent max-w-2xl` (672px) > 375 | Override Dialog width to be near-full-width at <768px (with appropriate inset margins). Verify the Tabs + dense sections inside `LeadDetail` do not produce internal horizontal scroll. |

The iteration is **one spec, one Validator pass**. Surface order is sequential within the iteration (shell first to unblock testing of the other three).

---

## Scope Boundary

### In scope
- **Sidebar / shell mobile chrome**:
  - Add a mobile-only header inside `SidebarInset` containing a `SidebarTrigger`. Sticky/static position TBD by frontend (default: static at top of the inset's scroll container; sticky if discovery shows it improves the experience without conflicting with existing `.app-page-header` border/padding).
  - Confirm offcanvas Sheet from `components/ui/sidebar.tsx` opens/closes/dismisses (backdrop + Esc) correctly at 375.
  - Verify focus trap inside the open Sheet works (Radix handles by default — confirm not regressed by composition).
  - Verify route navigation inside the Sheet closes the Sheet (Link `onClick` semantics — Radix Sheet behavior).
- **`/dashboard` home reflow at <768px**:
  - Header action chips group does not overflow. Search input + Wallet + Rewards + "Nuevo lead" chips reflow into multiple rows cleanly.
  - KPI metric grids (`.metric-grid`) verified at 375 — already responsive per `app/globals.css`; pure verification.
  - Recharts `PieChart` (Pipeline por estado) at 375 — `ResponsiveContainer width={72} height={72}` is fixed-small so it should be fine; verify.
- **`/dashboard/leads` list + LeadCard reflow at <768px**:
  - Filter bar (search + status select + sort select + proximity button) — already uses `flex-col sm:flex-row` so it stacks; verify it's tap-target-friendly.
  - `LeadCard` interior:
    - Title row (`<h3>{lead.name}</h3>` + assignment badge + status badge + `$value`) does not horizontal-scroll. Acceptable patterns: stack the right-side group below the title at <640 (default mobile); or move price/value to a separate visible row; or hide the assignment badge at narrow widths if it duplicates info shown elsewhere (frontend chooses, must be a single consistent pattern across the card).
    - Quick-actions column (advance-status button + dropdown menu) does not push the card width past 375. Acceptable patterns: drop the advance-status button to a wrap row at narrow widths and keep only the dropdown trigger inline; or move both to a footer row inside the card.
    - Contact info row (email + phone + WA) — already `flex flex-wrap items-center gap-4` so wrapping; verify long emails don't overflow (add `break-all`/`truncate` if needed).
  - List pagination controls stay readable.
- **Lead-detail Dialog modal at <768px**:
  - Override `<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">` (in `app/dashboard/leads/page.tsx:650`) to be near-full-width on mobile (e.g., `w-[calc(100vw-1rem)] max-w-2xl` or equivalent Tailwind responsive override).
  - Verify `LeadDetail` internal layout (Tabs strip + dense field grids + activity log + proposal cards) does not produce horizontal scroll inside the Dialog body at 375.
  - No new dialog open/close behavior — preserve the existing `lingeringLead` + `justClosedLeadIdRef` G18 fix logic exactly.

### Explicitly out of scope (this iteration only)
- **All other dashboard surfaces**: `/dashboard/projects`, `/dashboard/tasks`, `/dashboard/earnings`, `/dashboard/notifications`, `/dashboard/pipeline`, `/dashboard/settings`, `/dashboard/updates`, `/dashboard/pm-queue`, `/dashboard/reports`, `/dashboard/rewards`, `/dashboard/prototypes`, `/dashboard/web-analysis`, `/dashboard/credits`. These remain desktop-broken on mobile until a follow-up iteration. The pilot tolerance applies (4-person team, desktop-primary).
- **Auth / login surface** (`/`) — login flow not in this iteration.
- **`/client/[token]` portal** — per ADR-010, migrates to NoonWeb; do not invest UX work here.
- **CommandPalette mobile UX** — bundled into `app/dashboard/layout.tsx` via `dynamic()` import; not in scope.
- **MaxwellFab mobile positioning** — bundled into `app/dashboard/layout.tsx`; not in scope unless it actively obstructs the four in-scope surfaces (in which case fix is the minimum nudge, not a redesign).
- **v2 design system / components/v2/** — the playbook's Fase A track is explicitly **not** invoked.
- **URL structure / `proxy.ts` / `dashboardRouteAccessRules`** — locked.
- **`lib/data-context.tsx`** (~1970 lines) — locked. No SWR / React Query / @tanstack additions per playbook anti-pattern.
- **Wire contracts** (`*Wire` types in `lib/leads/serialization.ts` etc.) — locked.
- **Auth surface** (`proxy.ts` middleware + `@supabase/ssr`) — locked.
- **API routes** (`app/api/**`) — locked.
- **Dark mode contrast review** — was bundled with B23, deferred separately; not in scope here.
- **Touch-target ≥44×44 audit across all components** — verify on in-scope surfaces only; broader sweep is a future iteration.
- **Tablet-specific UX (768–1024)** — verify it does not regress (breakpoint is at 768 per `useIsMobile`), but no tablet-targeted design work.
- **Landscape orientation, foldables, very small viewports (<320)** — not targeted. Acceptance bar is 375 portrait minimum.
- **Visual redesign / new typography / new color tokens** — not in scope. The fix preserves the current visual system.
- **`app/globals.css` `[data-slot="card"] box-shadow: none !important`** — known F16 systemic from B23; leave intact. Any new focus styling on mobile triggers must use `outline` not `ring-*`.

---

## Acceptance Criteria

Each criterion is verifiable in a browser at 375×667 viewport (Chrome DevTools responsive mode is sufficient evidence; real-device is recommended for tap-target verification but not required to close).

1. **Mobile navigation works** — On `/dashboard`, `/dashboard/leads`, and inside the lead-detail Dialog, the user can open the navigation drawer with a single visible affordance (the mobile `SidebarTrigger`), see the full nav list (Workspace / Ventas / Delivery / Finanzas / Admin per role), tap any link, and land on the requested route with the drawer auto-closed.
2. **No horizontal scroll on `/dashboard` at 375×667** — `document.documentElement.scrollWidth === window.innerWidth` (no body-level horizontal overflow). Header action chips reflow into multiple rows if needed. No KPI card clips its number.
3. **No horizontal scroll on `/dashboard/leads` at 375×667** — Same body-level test as above. `LeadCard` rows fit within the viewport. Long lead names truncate; long emails wrap or truncate; price/badges/quick-actions never push the card beyond viewport width.
4. **Lead-detail Dialog usable at 375×667** — Opening a lead from the list shows the modal with body content fully readable (no horizontal scroll inside the dialog body), tabs strip navigable, primary actions tappable. Dialog dismiss (X button, backdrop tap, Esc key) restores focus to the card that opened it (preserves G18 behavior).
5. **Desktop regression check** — At 1280×800, all four in-scope surfaces render identically to the pre-iteration baseline. No visual regression in:
   - Sidebar collapsed-icon mode behavior at desktop (`Sidebar collapsible="icon"` in `app-sidebar.tsx:209`)
   - LeadCard horizontal layout at desktop (the existing 3-column composition)
   - Lead-detail Dialog `max-w-2xl` centered at desktop
   - `/dashboard` home KPI grid at `lg:grid-cols-4`
6. **Tablet boundary check** — At 768×1024 (the `useIsMobile` boundary at `MOBILE_BREAKPOINT = 768`), navigation behavior switches cleanly from drawer mode (<768) to desktop sidebar mode (≥768). No flash, no double-rendered triggers, no stuck overlay.
7. **No new typecheck or lint errors** — `pnpm typecheck && pnpm lint` clean on the PR branch. Existing test count holds (currently 420 tests per B23 closure; verify no test breaks from layout changes).
8. **No out-of-scope diff drift** — Git diff at PR open shows changes only in: `components/app-sidebar.tsx`, `components/ui/sidebar.tsx` (only if a primitive override is unavoidable; default is do not touch), `app/dashboard/layout.tsx`, `app/dashboard/page.tsx`, `app/dashboard/leads/page.tsx`, `components/lead-card.tsx`, `components/lead-detail.tsx` (only if internal width overrides are needed), `app/globals.css` (only if a new mobile utility class is needed). Files outside this list trigger Validator scope-discipline check.

---

## Affected Files / Modules

Best-effort map. Frontend may discover additional files; if so, **must justify each addition in the PR description against the out-of-scope list**.

| Path | Why | Confidence |
|---|---|---|
| `components/app-sidebar.tsx` | Currently renders `SidebarTrigger` only inside `SidebarHeader` (lines 223, 230). Needs a mobile trigger rendered outside the sidebar (likely in a sibling header component inside `SidebarInset`). May need minor adjustments to the `Sidebar collapsible="icon"` prop if mobile interferes with desktop collapse behavior. | High |
| `app/dashboard/layout.tsx` | Natural mount point for a new mobile-header component as a child of `SidebarInset`, alongside `<CommandPalette />` and `{children}`. May import a new small component (e.g., `<MobileHeader />`) or render the chrome inline. | High |
| `components/lead-card.tsx` | Reflow the title row + quick actions interior layout at narrow widths. No prop changes — pure CSS / Tailwind class adjustments. | High |
| `app/dashboard/leads/page.tsx` | Override `<DialogContent>` className to widen on mobile (line 650). No logic changes (`handleLeadDialogChange`, `lingeringLead`, `justClosedLeadIdRef` preserved verbatim). | High |
| `app/dashboard/page.tsx` | Verify-only first. If the header action chips group overflows at 375, adjust the wrapping classes on its container (line 185) — minimum change only. | Medium |
| `app/globals.css` | Only if a new mobile-specific utility class is needed (e.g., a shared `.mobile-header` component class). Default: do not touch. If touched, may not modify the `[data-slot="card"]` F16 override. | Low |
| `components/lead-detail.tsx` | Verify-only first. If the `Tabs` strip or any internal section produces horizontal scroll inside the Dialog body at 375, adjust the offending section's classes — minimum change only. The file is 2271 lines; treat any change as targeted, not a rewrite. | Low–Medium |
| `components/ui/sidebar.tsx` | **Do not modify** unless a primitive bug is uncovered. The primitive already handles mobile (`isMobile` branch at lines 183-205). If a bug is found in the primitive, frontend stops and reroutes to architecture before patching. | Should-be-zero |

**Files explicitly NOT touched** (any change here is a scope violation):
- `lib/data-context.tsx`, `lib/dashboard-selectors.ts`, `lib/auth-context.tsx`, `lib/leads/serialization.ts`, `lib/server/**`
- `app/api/**`, `proxy.ts`
- `supabase/migrations/**`
- `hooks/use-mobile.ts` (the 768 breakpoint is the contract; do not move it)
- Any `*.test.ts` file outside the additions section of `## Recommended Testing Methodology`
- `docs/integrations/**`, `docs/api-auth-matrix.md`

---

## Dependencies

| Type | Dependency | Status | Impact if missing | Owner |
|---|---|---|---|---|
| Internal | `components/ui/sidebar.tsx` `useSidebar()` + `SidebarTrigger` + mobile `Sheet` branch | Present and wired (`isMobile` branch lines 183-205) | Iteration cannot proceed without this primitive | shadcn — no upstream coordination needed |
| Internal | `hooks/use-mobile.ts` `useIsMobile()` returning at `MOBILE_BREAKPOINT = 768` | Present | Iteration relies on this breakpoint as the navigation mode toggle | local — locked, do not modify |
| Internal | `components/ui/sheet.tsx` (Radix Dialog wrapper) | Present (imported by sidebar primitive) | Mobile drawer renders inside Sheet | local |
| Internal | `lib/data-context.tsx` API surface for `LeadCard` and `LeadDetail` | Present | Reflow needs no changes here — purely consume existing data | local — **locked** |
| Contract | None | n/a | No wire contracts touched | n/a |
| External | None | n/a | No new npm packages | n/a |
| Infra | `pnpm dev` against Supabase dev project | Operator local | Needed for browser validation evidence | operator |
| Data | None | n/a | No seed/schema dependencies | n/a |

---

## Assumptions

1. **The shadcn sidebar primitive's mobile Sheet behavior works as documented** — opening, backdrop-tap-to-close, Esc-to-close, focus trap. If it doesn't (e.g., a bug we haven't seen), this assumption breaks and frontend reroutes (architecture or directly to upstream primitive patching, which would be out of scope).
2. **`useIsMobile()` returning at 768 is the correct navigation-mode boundary** — matches Tailwind v4 `md:` default. Any deviation (e.g., wanting 1024 as the boundary so tablets get the drawer too) is a separate scope decision; this iteration uses 768.
3. **The current `Sidebar collapsible="icon"` prop in `app-sidebar.tsx:209` is intended desktop behavior** — adding mobile drawer support must not break the icon-collapse at desktop.
4. **Existing 420 unit tests do not implicitly test mobile layouts** — they cover logic, not viewport-dependent layout. New tests added for mobile chrome state are net-additions.
5. **The roadmap's "3–5d estimation for core coverage" assumed 5 surfaces (dashboard, leads list, lead detail, earnings, notifications)** — this iteration reduces scope to 4 (drops earnings + notifications, adds lead-detail as a distinct surface). Estimated effort is ~2–3d.
6. **G18 + G19 dialog lifecycle behavior (`justClosed*IdRef`, `lingeringLead`) is correct as-is** — the responsive fix does not touch this logic; only the `DialogContent` className changes.
7. **Browser DevTools responsive mode is sufficient evidence for the 375×667 acceptance** — real-device verification is preferred but not gating per the operator pilot context (internal-only, no external customers yet).

If any assumption breaks during implementation, frontend stops and updates this spec with a dated note before proceeding.

---

## Risks

| # | Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|---|
| R1 | Shell refactor scope balloons — adding the mobile trigger reveals that `app-sidebar.tsx` (318 lines) needs broader restructuring (e.g., splitting expanded vs collapsed branches, extracting a `<SidebarChrome>`) | Medium | Medium | Medium | If discovered, frontend stops at the minimum-needed change and explicitly invokes `system-refactor` for the cleanup. Do not absorb into the same commit. |
| R2 | `LeadCard` reflow regresses desktop layout — the existing 3-column composition (score / content / actions) is tight; mobile reflow classes accidentally apply at desktop | Medium | Medium | Medium | Use Tailwind responsive prefixes strictly (`md:` for desktop-only). Visual smoke at 1280×800 is mandatory before PR. Add a screenshot of desktop LeadCard pre/post to the PR description. |
| R3 | Lead-detail Dialog width override conflicts with Radix internal positioning — overriding `max-w-2xl` to be `w-[calc(100vw-1rem)]` at mobile interacts with Radix's centering / inset logic in unexpected ways | Low | Medium | Low–Medium | Use the same override pattern already present elsewhere in the codebase (verify what other mobile-dialog overrides exist) or fall back to the shadcn Dialog responsive recipe. Test dismiss behavior thoroughly. |
| R4 | A mobile-only header inside `SidebarInset` creates a sticky-position issue with the existing `.app-page-header` border-bottom — visual flicker on scroll | Low | Low | Low | Default to static positioning. Only go sticky if a clear UX win and verified non-conflict. |
| R5 | Recharts `ResponsiveContainer` in `app/dashboard/page.tsx:312` mis-sizes at viewport switch — width=72 height=72 is fixed but the parent flex may collapse oddly | Low | Low | Low | Verify only. If issue, wrap in a `min-w-[72px] shrink-0` guard. |
| R6 | Discovery during implementation finds an out-of-scope surface (e.g., `/dashboard/projects`) is so visibly broken at 375 that PM/operator wants it folded in | Medium | Medium | Medium | Frontend lists it in PR description as "noted, deferred to follow-up." Does NOT silently expand scope. Operator decides whether to amend this spec (with dated note) or open a new iteration. |
| R7 | Sidebar Sheet `[&>button]:hidden` (in `components/ui/sidebar.tsx:190`) hides Radix's default close button — verify the open Sheet has a visible affordance to close (links auto-close, but if user pauses they need a way) | Low | Medium | Low–Medium | Verify in browser; if missing, the fix is to remove the `[&>button]:hidden` rule or render a custom close affordance inside the Sheet header. This is a primitive change so trigger the do-not-modify-primitive caveat → escalate. |
| R8 | F16 `[data-slot="card"] box-shadow: none !important` and any new mobile focus styling conflict | Low | Low | Low | Use `outline` not `ring-*` on the new mobile chrome trigger; documented in CONTINUITY NOTES above and in the B23 closure. |
| R9 | Browser validation at 375 is done in DevTools responsive mode and a real-device test would have caught a tap-target issue | Medium | Low | Low | Acceptance bar accepts DevTools mode given internal-pilot context. Real-device test is recommended-not-required. Future external-customer milestone reopens this bar. |

---

## Open Questions

Items below do **not** block scoping; they record decisions frontend can make with documented reasoning. If any of them becomes load-bearing during implementation, frontend stops and asks.

1. **Mobile header content** — Just `SidebarTrigger`, or also a compact NoonApp wordmark + page title? Default: just trigger (left) + page title (center-truncated). Wordmark is sidebar-only.
2. **Mobile header position** — Static at top of inset's scroll container, or sticky? Default: static. Sticky introduces compositor concerns; defer unless visual UX demands it.
3. **`LeadCard` reflow pattern** — Stack-the-right-side-group (price + badges drop below name) vs hide-redundant-info-at-mobile (drop assignment badge if it duplicates info) vs both? Default: stack-the-right-side-group; keep all info visible. Assignment badge is functional, not decorative.
4. **`LeadCard` quick-actions at mobile** — Keep both advance-status button and dropdown trigger inline, or collapse advance-status into the dropdown menu at <640? Default: collapse advance-status into the dropdown at mobile (it's already in the dropdown's "Cambiar estado" section).
5. **Lead-detail Dialog width override pattern** — `w-[calc(100vw-1rem)]` vs `sm:max-w-2xl` (which makes mobile use Radix default behavior). Default: `w-[calc(100vw-1rem)] max-w-2xl` so mobile is explicit width and desktop preserves `max-w-2xl`.
6. **Test addition strategy** — Add a component test for the new mobile-header chrome (rendering + trigger toggles `openMobile` context), or rely on browser validation alone? Default: add one focused component test for the new chrome composition. Skip browser-snapshot tests (the repo doesn't use them).
7. **Where the mobile-header component lives** — Inline in `app/dashboard/layout.tsx`, or extracted to `components/dashboard-mobile-header.tsx`? Default: extract to a small dedicated component. Reusable if the iteration ever expands to other shells.

---

## Recommended Testing Methodology

**Integration-first with browser validation as the gate.**

- **Unit / component tests** (Vitest, existing pattern): one focused test that the new mobile-header component renders `SidebarTrigger` and that the trigger composition is functional inside `SidebarProvider`. If the mobile-header is extracted to `components/dashboard-mobile-header.tsx`, the test lives at `tests/components/dashboard-mobile-header.test.tsx`. No layout-snapshot tests.
- **Browser validation** (mandatory gate): operator runs `pnpm dev` against Supabase dev, opens Chrome DevTools responsive mode at 375×667, exercises:
  1. `/dashboard` → open drawer → tap each visible nav link → verify route changes + drawer closes
  2. `/dashboard/leads` → scroll the list → verify no horizontal scroll → open a lead → verify modal usable → close modal (X / backdrop / Esc) → verify focus returns to the card
  3. Toggle DevTools responsive mode to 768×1024 → verify drawer mode releases and desktop sidebar appears, no double trigger
  4. Toggle to 1280×800 → verify zero visual regression on the four surfaces
- **Evidence artefact**: `docs/validations/Browser validation 2026-05-23 — G21 mobile responsive fix.html` (or `.md`; HTML preferred since the existing 2026-05-13 validation file is HTML). Includes screenshots from at least 375×667, 768×1024, 1280×800.
- **Gates**: `pnpm typecheck && pnpm lint && pnpm test` clean on PR open. Existing 420 test count holds (deviation only if the one new component test increases the count by 1, expected to ~421).

Why integration-first and not TDD: the change is presentation-layer composition of existing primitives. Writing tests first for "the drawer opens" would just retest Radix's Sheet, which is already covered upstream. The valuable signal is the composition + the actual viewport behavior, which only browser validation can give.

---

## Definition of Done

Bounded to this iteration only.

- [ ] `specs/fase-3-g21-mobile-responsive-fix.md` Status moved from Draft → Approved before frontend starts.
- [ ] All four acceptance criteria (1–8 in `## Acceptance Criteria`) verified.
- [ ] PR opened on a feature branch with title following repo convention (e.g., `fix(g21): mobile responsive shell + leads surfaces`). PR description references this spec by path.
- [ ] PR description includes browser validation evidence (file path + at minimum 1 screenshot per surface × 1 viewport ≥ 375×667).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` clean on CI.
- [ ] Out-of-scope diff check: PR diff modifies only files listed in `## Affected Files / Modules` (or each addition justified in PR description against `## Scope Boundary § Explicitly out of scope`).
- [ ] `docs/context/project.context.core.md` updated with the close-in-runtime entry for G21 (PARTIAL or COMPLETE per Validator verdict).
- [ ] `D:\Pedro\Archivos Pedro\noon-app\roadmap\noonapp-roadmap.md` §G21 status updated (per `feedback_keep_roadmap_in_sync` memory note).
- [ ] `system-validator` returns COMPLETE or PARTIAL with explicit follow-up list.
- [ ] Spec lifecycle moved Approved → Implemented on Validator COMPLETE; or note added documenting the scope cut if PARTIAL.

---

## Chunking Decision

**Single iteration. Internal sequence is not chunking.**

The four surfaces share one fix pattern (compose existing primitives + reflow at the `md:` breakpoint), one Validator gate, one browser evidence file. Splitting into per-surface iterations would:
- Leave the shell trigger in a state where you can't navigate to test the content surfaces (sequencing problem)
- Duplicate Analysis + Testing overhead × 4
- Misuse the chunking mechanism, which exists for genuinely independent vertical slices

Within the iteration, frontend executes in this order (sequence, not chunks):
1. **Mobile shell chrome** (sidebar trigger placement + verify Sheet behavior). Until this lands, the other three surfaces cannot be browser-tested at mobile.
2. **`/dashboard` home** — verify-only first; adjust the header-chips container if it overflows.
3. **`/dashboard/leads` list + LeadCard reflow** — the largest behavioral change.
4. **Lead-detail Dialog width override** — small change, isolated to one className override.

If during the iteration any single surface reveals a scope balloon (e.g., LeadCard reflow requires extracting a `<LeadCardMobile>` variant > 100 lines), frontend stops and asks before continuing. The default response is to **close the iteration PARTIAL on the surfaces that landed cleanly** and open a follow-up for the ballooning surface.

---

## Success Criterion

> **On a clean checkout of the develop branch with the PR merged, an operator opening NoonApp at 375×667 in a mobile browser (or Chrome DevTools responsive mode) can: open the navigation drawer from any in-scope route via a visible trigger, navigate between `/dashboard` and `/dashboard/leads`, scroll the leads list without horizontal scroll, open a lead detail modal, read the modal body without horizontal scroll inside it, close the modal, and return to the list — all without the browser body or any in-scope surface ever exposing horizontal scroll.** At desktop (≥768), the four surfaces render identically to the pre-iteration baseline (visual regression smoke at 1280×800 confirms).

---

## Skill Chain Hypothesis

`system-analysis` (this spec) → `system-frontend` (implementation) → `system-refactor` *conditional* (only if shell scope reveals compounding debt) → `system-testing` (component test + browser validation evidence) → `system-docs` (context.core + roadmap §G21 update) → `system-validator` (COMPLETE / PARTIAL / BLOCKED).

`system-architecture` not invoked unless frontend discovers a contract gap (new shared hook/context needed). `system-security` not invoked (no auth/perm/input/secrets surfaces). `system-infra` not invoked (no runtime/env/deploy/pipeline impact).

---

## Handoff Payload — to `system-frontend`

- **Task summary**: see `## Task Summary`.
- **Scope boundary**: `## Scope Boundary` — strict. Out-of-scope list is the discipline anchor.
- **Acceptance criteria**: `## Acceptance Criteria` (8 items).
- **Affected files**: `## Affected Files / Modules`.
- **Dependencies**: `## Dependencies` — all internal; no coordination needed outside the repo.
- **Assumptions**: `## Assumptions` (7 items). Break any → stop and update spec.
- **Open questions**: `## Open Questions` (7 items) — each has a default; document deviations.
- **Risks**: `## Risks` (R1–R9) — R1 + R6 are the most likely to trigger; both have explicit stop-and-ask mitigations.
- **Recommended depth**: FULL.
- **Chunking decision**: single iteration; internal surface sequence shell → home → leads list → leads detail.
- **Success criterion**: see `## Success Criterion`.
- **Recommended testing methodology**: integration-first with browser validation as the gate.
- **Path to this spec**: `D:\Pedro\Proyectos\Noon\App-nooncode\specs\fase-3-g21-mobile-responsive-fix.md`.

---

## Lifecycle

- **Draft** — 2026-05-23 (analysis output)
- **Approved** — 2026-05-23 (operator sign-off: "Dale, arrancamos con el frontend")
- **Implemented** — 2026-05-23 (PR #100 merged at `f210d4a`, operator browser PASS, Validator verdict COMPLETE)
- **Archived** — n/a

Status changes recorded inline as dated notes when transitioned. Spec is not edited after Implemented; follow-up iterations create new spec files and reference this one.
