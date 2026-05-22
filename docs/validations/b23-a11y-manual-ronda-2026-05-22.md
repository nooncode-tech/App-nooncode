# B23 a11y manual ronda — 2026-05-22

> Execution evidence for the B23 iteration scoped at `specs/fase-3-b23-a11y-manual-ronda.md`. This document is the canonical output of the audit + fix pass.

## Audit metadata

- Operator: Pedro (`noondevelop@gmail.com`) + Claude (Opus 4.7) for code-side static analysis
- Date: 2026-05-22 (static code audit pass — browser-side manual verification pending operator follow-up; see "Operator verification queue" section below)
- App build: develop branch HEAD at audit time = `20537b8` (Merge PR #90); audit branch `feature/fase-3-b23-a11y-execution`
- Tooling used in this pass: code-side static analysis only (no browser, no screen reader, no DevTools — those checks are deferred to the operator-side manual pass enumerated at the end of this document)
- Audit method: per spec §"Audit checklist", surface-by-surface, code-side. Each surface evaluated for: missing `aria-label` on icon-only buttons, form input label association, modal focus management strategy (Radix vs custom), color tokens vs hardcoded values, disabled state visibility, touch target sizes via Tailwind classes, semantic HTML usage, heading hierarchy, and `prefers-reduced-motion` respect.

## Important framing — what this pass produces

A static code audit can verify **structural / contract-level** accessibility (does this button have an accessible name? does this dialog use Radix's focus-trap?). It **cannot** verify:

- Actual computed contrast ratios against rendered backgrounds (need browser).
- Real screen reader announcement behavior (need OS-level AT).
- Mobile viewport rendering at 375/390/414/768 (need browser responsive mode).
- `prefers-reduced-motion` effect at runtime (need OS-level setting + browser).
- Real focus indicator visibility (need rendered focus rings).

For those categories, this document produces a **"Operator verification queue"** at the end with concrete repros the operator can run in a follow-up browser session. The iteration closes COMPLETE only after the operator runs that queue and either confirms PASS or files new findings.

## Coverage matrix

Status legend: `PASS` = no findings of severity ≥ HIGH for this category on this surface; `FAIL(N)` = N findings of severity ≥ HIGH; `MANUAL` = code-side cannot verify; deferred to operator-side pass; `N/A` = not applicable.

| Surface | A. Mobile viewport (code-side) | B. Dark mode contrast (code-side) | C. A11y smoke (code-side) | D. Touch targets (code-side) |
|---|---|---|---|---|
| `/` (login) | PASS | MANUAL (opacity-modified tokens) | PASS | MANUAL (shadcn h-9 — see Finding 1) |
| `/dashboard` (home) | PASS | FAIL(1) hardcoded `text-emerald-500/600` | FAIL(2) icon-only search-close button + custom input lacks label | FAIL(1) icon-only search-close |
| `/dashboard/leads` (LeadCard component) | PASS | MANUAL | FAIL(1) clickable Card div without keyboard support | PASS (card is large hit area) |
| `/dashboard/pipeline` | PASS | MANUAL (`selectLeadScoreColor` not audited) | FAIL(1) `<div onClick>` PipelineCard without keyboard support | PASS (card-sized) |
| `/dashboard/projects` | not deeply audited (1407 lines) | MANUAL | MANUAL (likely same patterns as projects/tasks) | MANUAL |
| `/dashboard/tasks` | not deeply audited (675 lines) | MANUAL | MANUAL | MANUAL |
| `/dashboard/earnings` | PASS | FAIL(1) hardcoded `bg-yellow-500/text-yellow-600` etc. palette | PASS | MANUAL |
| `/dashboard/notifications` | PASS | MANUAL (`text-muted-foreground/70`) | PASS (uses `<button>` semantic, has text labels) | FAIL(1) per-item "Leída" button at text-[10px] |
| `components/lead-detail.tsx` | not deeply audited (2271 lines) | MANUAL | MANUAL (G18 fix already addresses dialog open/close timing) | MANUAL |
| `components/app-sidebar.tsx` | PASS | FAIL(2) heavy use of `text-white/20..45` on dark sidebar (likely sub-WCAG-AA at low opacities) | FAIL(1) collapsed-state avatar trigger accessible name is only initials | FAIL(1) SidebarTrigger `size-7` (28px) |

**Surfaces NOT deeply audited** (read briefly, no findings extracted beyond pattern-grep):
- `/dashboard/projects` (1407 lines — biggest non-modal surface). Spot-grep showed no icon-only-button-without-aria-label. Operator should run the manual browser pass on this surface specifically.
- `/dashboard/tasks` (675 lines). Same as projects.
- `components/lead-detail.tsx` (2271 lines). The G18 fix landed today (PR #88) addresses the dialog close timing race; that's the most a11y-impactful behavior. Operator-side browser pass should verify keyboard close (Esc), focus restore (focus returns to trigger), and tab order through the tabs (Estado, IA Asistente, Propuestas, Actividad, etc.).

## Findings

Ordered by severity (CRITICAL → HIGH → MEDIUM → LOW), then by surface.

### Finding 1 — `components/lead-card.tsx` + `app/dashboard/pipeline/page.tsx`, A11y smoke, **CRITICAL**
- **Surface**: `components/lead-card.tsx:138-141` (LeadCard component) and `app/dashboard/pipeline/page.tsx:143-149` (PipelineCard component).
- **Category**: A11y smoke (keyboard accessibility).
- **Severity**: CRITICAL.
- **Repro**: Both components render the whole clickable card as a `<div onClick={onClick}>` (or `<Card onClick=...>` which is also a div internally) without `role="button"`, `tabIndex={0}`, or `onKeyDown` handlers for Enter/Space. A keyboard-only user cannot focus the card or activate it. A screen reader user does not hear it announced as interactive — only its text content as static markup.
- **Impact**: leads list and pipeline kanban (two HIGH-priority sales surfaces) become **completely unusable** to keyboard-only and screen-reader users. The only escape is via the sidebar nav to a different surface.
- **Recommended fix**: convert the outer wrapping element to a proper interactive element. Two options:
  - **(a)** Replace `<Card onClick=...>` / `<div onClick=...>` with `<button onClick=...>` + matching styles (preferred — proper semantic).
  - **(b)** Add `role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}` to the existing element (less invasive — preserves Card visual semantics).
  - For PipelineCard specifically, watch for DnD interaction with @dnd-kit — the keyboard activation must not conflict with the drag handle. The kanban-board library usually wraps the card in a SortableContext draggable; the inner clickable surface is independent.
- **Status**: FIXED IN THIS ITERATION (option (b) — least invasive; preserves DnD compatibility).

### Finding 2 — `app/dashboard/page.tsx:149-151`, A11y smoke, **HIGH**
- **Surface**: `app/dashboard/page.tsx:149` (search-expanded close button).
- **Category**: A11y smoke (accessible name).
- **Severity**: HIGH.
- **Repro**: The X icon close button has no `aria-label`, no visually-hidden text, and no surrounding label. Screen reader users encounter "button" with no further context.
- **Impact**: a search-expanded user cannot collapse the search without using a mouse (or pressing Escape, which IS wired at lines 56-61 — that mitigates but doesn't excuse the missing accessible name).
- **Recommended fix**: add `aria-label="Cerrar busqueda"` on the button at line 149.
- **Status**: FIXED IN THIS ITERATION.

### Finding 3 — `components/maxwell-chat.tsx:98, 103, 220`, A11y smoke, **HIGH**
- **Surface**: `components/maxwell-chat.tsx` — three icon-only `<Button size="icon">` instances: expand/collapse toggle (line 98), close (line 103), submit message (line 220).
- **Category**: A11y smoke (accessible name).
- **Severity**: HIGH (the chat is the primary Maxwell AI surface across the dashboard).
- **Repro**: Each button uses `<Button size="icon">` with only a lucide icon child (Maximize2/Minimize2, X, Send/Loader2). No `aria-label` or `<span className="sr-only">` text. Screen reader users hear "button" without function context.
- **Impact**: Maxwell chat unusable for screen reader users without significant guessing.
- **Recommended fix**: add `aria-label` per button:
  - Line 98: `aria-label={isExpanded ? "Colapsar chat" : "Expandir chat"}`
  - Line 103: `aria-label="Cerrar chat"`
  - Line 220: `aria-label="Enviar mensaje"`
- **Status**: FIXED IN THIS ITERATION.

### Finding 4 — `app/dashboard/settings/page.tsx:505, 508`, A11y smoke, **HIGH**
- **Surface**: `app/dashboard/settings/page.tsx` — two icon-only `<Button size="icon">` instances per user row: edit (line 505, Edit icon) and delete (line 508, Trash2 icon).
- **Category**: A11y smoke (accessible name + destructive action without context).
- **Severity**: HIGH (the delete one is destructive — accidental activation is high-cost).
- **Repro**: Each button is `<Button variant="ghost" size="icon" className="size-8">` with only the lucide icon child. No `aria-label`. Screen reader users hear "button button" for the two adjacent buttons and cannot tell which is destructive.
- **Impact**: admin settings page is unsafe for screen reader users — they could activate Delete thinking it's Edit.
- **Recommended fix**: add `aria-label`:
  - Line 505: `aria-label={"Editar " + user.name}` (or similar contextual label using the row's user data).
  - Line 508: `aria-label={"Eliminar " + user.name}`.
- **Status**: FIXED IN THIS ITERATION.

### Finding 5 — `components/maxwell-fab.tsx:45`, A11y smoke, **HIGH**
- **Surface**: `components/maxwell-fab.tsx:45` — the Maxwell floating action button (FAB), `<Button size="icon">` with conditional icon content (open/close).
- **Category**: A11y smoke (accessible name).
- **Severity**: HIGH (the FAB is the entry point to Maxwell from any dashboard surface).
- **Repro**: `<Button size="icon">` with only icon children. No `aria-label`.
- **Recommended fix**: add `aria-label={isOpen ? "Cerrar Maxwell" : "Abrir Maxwell"}`.
- **Status**: FIXED IN THIS ITERATION.

### Finding 6 — `components/lead-card.tsx:284`, A11y smoke, **HIGH**
- **Surface**: `components/lead-card.tsx:284` — MoreVertical dropdown menu trigger.
- **Category**: A11y smoke (accessible name).
- **Severity**: HIGH (load-bearing lead-card action menu).
- **Repro**: `<Button size="icon" variant="ghost" className="size-8">` wrapping `<MoreVertical>`. Even though it's a `<DropdownMenuTrigger asChild>`, the underlying button has no accessible name unless the trigger primitive injects one. Radix does NOT inject one by default — it relies on the consumer.
- **Recommended fix**: add `aria-label="Acciones del lead"` (or similar).
- **Status**: FIXED IN THIS ITERATION.

### Finding 7 — `app/dashboard/page.tsx:137-148` (custom search input), A11y smoke, **MEDIUM**
- **Surface**: `app/dashboard/page.tsx:137-148` (custom `<input>` inside the search-expanded state).
- **Category**: A11y smoke (form input label association).
- **Severity**: MEDIUM (the input is exposed only when search is expanded; the placeholder partially mitigates).
- **Repro**: Native `<input type="text" placeholder="Buscar...">` without `<Label>`, `aria-label`, or `aria-labelledby`. Placeholder is not a substitute for a label per WCAG 1.3.1.
- **Recommended fix**: add `aria-label="Buscar"` on the input.
- **Status**: FIXED IN THIS ITERATION (single-line addition).

### Finding 8 — `components/app-sidebar.tsx:278-289` (collapsed avatar trigger), A11y smoke, **MEDIUM**
- **Surface**: `components/app-sidebar.tsx:278-289` (DropdownMenuTrigger button wrapping the avatar + user info).
- **Category**: A11y smoke (accessible name in collapsed state).
- **Severity**: MEDIUM.
- **Repro**: The trigger button has no `aria-label`. Its visible content is the Avatar + user name + role. When the sidebar is **collapsed** (icon-only mode), `group-data-[collapsible=icon]:hidden` hides the name and role text — the only remaining accessible name is the avatar fallback initials (e.g., "PA" for "Pedro Andres"). Screen reader users hear "button PA" with no useful context.
- **Recommended fix**: add `aria-label={user.name + ', menu de usuario'}` on the trigger button (line 278). Visible when collapsed, redundant-but-harmless when expanded.
- **Status**: FIXED IN THIS ITERATION.

### Finding 9 — `components/app-sidebar.tsx` (text contrast at low opacity), Dark mode contrast, **MEDIUM-MANUAL**
- **Surface**: Multiple `text-white/20`, `text-white/25`, `text-white/30`, `text-white/35` in `app-sidebar.tsx` (lines 101, 132, 235, 269, 270, 273, 286, 288).
- **Category**: Dark mode contrast.
- **Severity**: MEDIUM (likely below WCAG AA 4.5:1).
- **Repro** (operator browser pass): on the sidebar, inspect the elements at the listed lines via DevTools → Accessibility panel → Contrast picker. Measure against the `bg-sidebar` value. Record actual ratios. If < 4.5:1 for normal text, this becomes HIGH.
- **Recommended fix**: if browser pass confirms < 4.5:1, bump opacity to a value that passes (e.g., `text-white/50` for the lowest contrast cells). Be aware that the design intent is a "muted nav" look — bumping opacity changes the visual hierarchy.
- **Status**: MANUAL VERIFICATION REQUIRED (operator-side browser pass). Not fixed in this iteration because the fix depends on the measured value.

### Finding 10 — `app/dashboard/earnings/page.tsx:78-95` + `app/dashboard/page.tsx:211-212` (hardcoded Tailwind palette colors), Dark mode contrast, **MEDIUM**
- **Surface**: `app/dashboard/earnings/page.tsx:78-95` — `bg-yellow-500/10 text-yellow-600`, `bg-green-500/10 text-green-600`, `bg-blue-500/10 text-blue-600`. `app/dashboard/page.tsx:211-212` — `text-emerald-500`, `text-emerald-600`.
- **Category**: Dark mode contrast + token discipline.
- **Severity**: MEDIUM (bypasses the design token system; may or may not have contrast issues in actual dark mode rendering).
- **Repro**: grep for `text-(yellow|green|blue|emerald|red|orange)-[0-9]00` against `app/`. Any hits are bypassing the semantic token system (`--success`, `--warning`, `--destructive`, `--info` etc.).
- **Recommended fix**: replace hardcoded Tailwind palette with semantic tokens. Specifically:
  - `bg-yellow-500/10 text-yellow-600` → `bg-warning/10 text-warning` (assuming the token exists; otherwise the operator may need to add a `--warning` token to globals.css).
  - `bg-green-500/10 text-green-600` → `bg-success/10 text-success`.
  - `bg-blue-500/10 text-blue-600` → `bg-info/10 text-info`.
  - `text-emerald-500/600` → `text-success`.
- **Status**: DEFERRED — this is a design-system iteration in itself. Adding semantic tokens to globals.css plus migrating every consumer is broader than B23's spec scope (per spec §"Out of scope" — token catalogue is Q6 default (b) skip). Flag for a future iteration "design-tokens-color-semantic-migration".

### Finding 11 — `components/ui/button.tsx` + `components/ui/input.tsx` (touch target size), Touch targets, **MEDIUM**
- **Surface**: shared primitives — `Button` `default` size = `h-9` (36px), `lg` size = `h-10` (40px), `icon` size = 36×36 px. `Input` height = `h-9` (36px).
- **Category**: Touch targets.
- **Severity**: MEDIUM (below Apple HIG 44×44 but passes WCAG 2.2 AA 2.5.8 which sets the bar at 24×24 with exceptions).
- **Spec inconsistency**: the B23 spec's checklist says "All hit areas ≥ 44 × 44 px" (Apple HIG) but also says (in `Scope Boundary` → `Explicitly out of scope`) "WCAG AAA targets — AA is the bar". WCAG 2.5.5 (44×44) is AAA; WCAG 2.5.8 (24×24) is AA. The spec's checklist therefore contradicts its own scope statement. **Operator decision required**.
- **Repro**: inspect the `Button` and `Input` primitives in `components/ui/`. Confirm `h-9` = 36px.
- **Recommended fix** (if operator chooses Apple HIG): bump default `Button` size to `h-11` (44px). Visual change is broad — every button in the app gets larger. Consider per-context overrides instead of changing the primitive.
- **Recommended fix** (if operator chooses WCAG AA 2.5.8): current `h-9` (36px) passes the AA bar; no change needed. Document the decision in core.md.
- **Status**: DEFERRED to operator decision (this iteration does not pick between AA 2.5.8 and AAA 2.5.5).

### Finding 12 — `app/dashboard/notifications/page.tsx:211-218` (per-item "Leída" button), Touch targets, **HIGH (per Apple HIG) or MEDIUM (per WCAG AA)**
- **Surface**: `app/dashboard/notifications/page.tsx:211-218` — `<button>` with class `text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5`. No explicit padding; effective height is roughly the line-height of 10px text ≈ 14-16px.
- **Category**: Touch targets.
- **Severity**: HIGH per Apple HIG (way below 44×44); MEDIUM per WCAG AA 2.5.8 (below 24×24).
- **Repro**: inspect the button in DevTools; measure the bounding box.
- **Recommended fix**: add explicit padding (e.g., `px-2 py-1.5`) and/or increase font-size to `text-xs` (12px) so the line-height puts the hit area at ≥ 24px.
- **Status**: FIXED IN THIS ITERATION (size bumped to `text-xs px-2 py-1.5` — adds ~12px to the hit area without changing visual hierarchy materially).

### Finding 13 — Decorative lucide icons missing `aria-hidden="true"`, A11y smoke, **LOW (systemic)**
- **Surface**: virtually every page that imports lucide icons (login, dashboard, leads, projects, tasks, earnings, notifications, sidebar, lead-detail, ...). Lucide-react renders icons as `<svg>` with no aria attributes by default.
- **Category**: A11y smoke (extra noise for screen reader users).
- **Severity**: LOW (most screen readers handle untagged decorative SVG as decorative by default; the impact is minor verbose announcements).
- **Repro**: in screen reader, navigate any page that has icons with companion text. Some readers announce "graphic" before the text.
- **Recommended fix**: a systemic codemod could add `aria-hidden="true"` to every lucide icon that is followed by descriptive text in the same element. Out of scope for B23 single-day iteration.
- **Status**: DEFERRED to a separate codemod-style iteration if escalated by operator-side browser pass. Not blocking.

## Deferred follow-ups summary

| ID | Severity | Surface | Category | One-line summary |
|---|---|---|---|---|
| F9 | MEDIUM-MANUAL | `components/app-sidebar.tsx` | Dark mode contrast | `text-white/20..45` on dark sidebar — verify ≥ 4.5:1 in browser; bump opacity if not. |
| F10 | MEDIUM | `app/dashboard/earnings/page.tsx:78-95` + `app/dashboard/page.tsx:211-212` | Dark mode contrast + token discipline | Migrate hardcoded `text-yellow/green/blue/emerald-*` palette to semantic tokens. Requires new `--success/--warning/--info` tokens in globals.css. Future "design-tokens-color-semantic-migration" iteration. |
| F11 | MEDIUM (decision required) | `components/ui/button.tsx`, `components/ui/input.tsx` | Touch targets | Operator decides: stick with shadcn `h-9` (36px, passes WCAG AA 2.5.8) or bump to `h-11` (44px, Apple HIG). Spec is internally inconsistent. |
| F13 | LOW (systemic) | All pages with lucide icons | A11y smoke | Codemod to add `aria-hidden="true"` to decorative lucide icons (icons followed by text labels). |

## Operator verification queue (browser-side pass)

The static audit produces structural findings only. The categories below require operator-side browser execution to close. Each entry lists the precise repro steps.

### V1 — Sidebar text contrast in dark mode (resolves Finding 9)
- **Steps**: Open `/dashboard` in browser. Toggle theme to dark mode (if not default). Open DevTools → Accessibility panel → Contrast picker. Select the following elements one by one and record the contrast ratio against the sidebar background:
  - `[class*="text-white/20"]` (e.g., the SidebarTrigger icon, the balance icon, the user role label).
  - `[class*="text-white/25"]`
  - `[class*="text-white/30"]`
  - `[class*="text-white/35"]`
  - `[class*="text-white/45"]`
- **Record**: ratio per opacity tier (e.g., "text-white/20 measures 2.1:1 on bg-sidebar dark").
- **Pass criterion**: all ratios ≥ 4.5:1 for normal text, ≥ 3:1 for UI components.
- **Fail action**: bump opacity to the next tier that passes (e.g., /20 → /50). Record the change here as Finding 9 resolution.

### V2 — Hardcoded palette colors in dark mode (resolves Finding 10)
- **Steps**: Open `/dashboard/earnings` in dark mode. Inspect each badge in the `bucketConfig` (lines 78-82): Pendiente (yellow), Disponible retiro (green), Disponible gasto (blue), Bloqueado (destructive). Measure contrast.
- **Record**: ratio per badge.
- **Pass criterion**: ≥ 4.5:1 for the badge text against the badge background.
- **Fail action**: if any badge fails, treat as confirmation that the token migration in Finding 10 is needed.

### V3 — Mobile viewport sweep (resolves the "MANUAL" cells for category A in the matrix)
- **Steps**: DevTools → Toggle Device Toolbar. Set viewport to **375 × 667** (iPhone SE). Walk through each HIGH priority surface: login, dashboard, leads, pipeline, projects, tasks, earnings, notifications, opening lead-detail dialog. For each:
  - Record any horizontal scroll on body.
  - Record any clipped text.
  - Record any overlapping elements.
  - Record any tap target < 24 × 24 px (WCAG AA 2.5.8 bar).
- **Repeat** for 390 × 844, 414 × 896, 768 × 1024.
- **Record**: per-viewport findings table.

### V4 — Keyboard navigation smoke (resolves the "MANUAL" cells for category C on un-deeply-audited surfaces)
- **Steps**: For each surface in `/dashboard/projects`, `/dashboard/tasks`, `components/lead-detail.tsx`, walk through the page with **only the keyboard** (no mouse). Tab through every focusable element. Verify:
  - Tab order matches visual reading order.
  - All interactive elements are reachable.
  - Enter / Space activate the focused element.
  - Esc closes any open modal/dialog and returns focus to the trigger.
  - Arrow keys behave per expectation in lists and dropdowns.
- **Record**: per-surface findings.

### V5 — Screen reader smoke (operator-default AT — VoiceOver on macOS, Narrator on Windows)
- **Steps**: Enable screen reader. Navigate by heading (VO+Cmd+H on Mac) through `/dashboard`, `/dashboard/leads`, `/dashboard/earnings`. Verify heading hierarchy is sensible. Open lead detail dialog → verify focus moves into dialog → verify dialog title is announced.
- **Record**: per-surface findings (heading hierarchy issues, missing announcements, focus management problems).

### V6 — `prefers-reduced-motion` respect
- **Steps**: macOS → System Settings → Accessibility → Display → Reduce Motion ON (or Windows equivalent). Reload the app. Open and close the lead detail dialog. Open and close Maxwell chat. Open and close any dropdown menu. Verify no jarring animations remain (the underlying primitives — Radix Dialog, DropdownMenu — respect `prefers-reduced-motion` by default; this check confirms no custom CSS animations bypass it).
- **Record**: any animations that persist when reduced-motion is set.

### V7 — Focus indicator visibility
- **Steps**: Tab through each HIGH priority surface in dark mode. Verify a visible focus ring appears around the focused element. Check the focus ring against the surrounding background — if the ring blends into the background, that's a finding.
- **Record**: per-surface findings.

## Iteration closure

Initial closure (static code audit + code-side fixes only — operator-side V1-V7 queue pending):

- CRITICAL fixed: **1 / 1** (Finding 1 — clickable card keyboard a11y in `lead-card.tsx` + `pipeline/page.tsx`).
- HIGH fixed: **6 / 6** (Findings 2, 3, 4, 5, 6, 12).
- MEDIUM fixed: 1 / 4 (Finding 7 — the easy single-line one). Findings 9, 10, 11 deferred per Q2 default + token-system scope.
- LOW deferred: 1 (Finding 13 — systemic codemod).
- Verdict (this pass): **PARTIAL** — code-side audit complete; static-verifiable findings fixed; operator-side browser verification queue (V1-V7) pending before iteration can be marked COMPLETE per spec §"Success Criterion".
- Roadmap §7 row updated: **yes** (post-merge of this PR).
- core.md Closed-in-runtime entry: **yes** (post-merge of this PR).
- Next session: operator runs V1-V7 in browser, files findings if any, and either marks the iteration COMPLETE or escalates to follow-up iterations for unresolved categories.

### Notes on what this audit did NOT cover

- `/dashboard/projects` (1407 lines), `/dashboard/tasks` (675 lines), `components/lead-detail.tsx` (2271 lines) were not read line-by-line. Pattern-grep across these surfaces did not surface aria-label-missing-on-icon-button hits beyond the ones already listed. Operator-side V4 covers the keyboard nav check for these.
- MEDIUM priority surfaces (`/dashboard/updates`, `/dashboard/settings`, `/dashboard/pm-queue`, `/dashboard/reports`, `components/maxwell-chat.tsx`, `components/project-detail.tsx`, `components/task-detail.tsx`) were not audited beyond the targeted grep for `<Button size="icon">`. Browser pass should sample-check these.
- Color contrast measurement requires browser pixel-level inspection; this pass relied on heuristic class-name pattern detection (low-opacity, hardcoded palette).
