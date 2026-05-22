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

## Smoke pass findings (2026-05-22, operator+Claude pair session)

The operator (Pedro) ran the V queue interactively during the same session as the static audit. Findings below are NEW issues surfaced during execution, plus updates to previously-deferred findings.

### Finding 14 — Mobile dashboard navigation completely broken at 375 × 667, **CRITICAL**
- **Surface**: every dashboard route at iPhone SE viewport (375 × 667).
- **Category**: A. Mobile viewport.
- **Severity**: CRITICAL.
- **Repro**: DevTools → Device toolbar (Ctrl+Shift+M) → iPhone SE → navigate to `/dashboard`. The operator reports the sidebar nav is not usable as a mobile drawer pattern, so it is impossible to change between pages on mobile.
- **Impact**: the app is **completely unusable on mobile**. Operator cannot navigate. This is a structural responsive-design gap, not a single-component fix.
- **Recommended fix**: out of B23 scope. Requires a dedicated mobile-responsive iteration that introduces a proper mobile drawer pattern (offcanvas sidebar with overlay + close button, or a bottom tab bar, or both depending on chosen design language). The existing `<Sidebar collapsible="icon">` shadcn primitive supports an `offcanvas` mode that may be the right path; needs design + implementation work.
- **Status**: **DEFERRED to dedicated mobile-responsive iteration**. The frontend redesign playbook documented at `docs/runbooks/frontend-redesign-playbook.md` is the natural home for this work.

### Finding 15 — `/dashboard/leads` cards overlap + horizontal scroll on mobile, **HIGH**
- **Surface**: `/dashboard/leads` at 375 × 667.
- **Category**: A. Mobile viewport.
- **Severity**: HIGH.
- **Repro**: DevTools → iPhone SE → `/dashboard/leads`. The operator reports lead card content is visually overlapping, AND the page has horizontal scroll (overflow).
- **Impact**: leads list is unusable on mobile because content overlap makes it impossible to read individual lead cards reliably; horizontal scroll is a strong indicator that an inner element has fixed width or improper `flex-wrap` / `min-width` settings that force the viewport to overflow.
- **Recommended fix**: out of B23 scope. The `components/lead-card.tsx` layout is a multi-column flex layout that was designed for desktop (~1024+ px wide). On 375 px it cannot reflow gracefully. Needs targeted rework: stack columns vertically at narrow widths, ellipsis-truncate long values, hide non-critical badges, etc. Same iteration as Finding 14.
- **Status**: **DEFERRED to dedicated mobile-responsive iteration**.

### Finding 16 — `<Card>` primitive `box-shadow: none !important` blocks Tailwind `ring-*` utility, **MEDIUM (systemic)**
- **Surface**: any consumer of `components/ui/card.tsx` that tries to use `focus-visible:ring-*` for accessible focus indication.
- **Category**: C. A11y smoke (focus indicator).
- **Severity**: MEDIUM (systemic — affects any future component built on Card).
- **Repro**: `app/globals.css:196` applies `[data-slot="card"] { box-shadow: none !important }` globally. Tailwind v4 `ring-*` utility implements ring via `box-shadow` under the hood. The `!important` override silently eats every `ring-*` class on Card, producing no visible focus indicator even though the className IS applied.
- **Impact**: discovered during V4 smoke. Initial fix (commit `3b4cc52` ring-2 ring-primary ring-offset) appeared not to render on LeadCard. After multiple debug iterations and a yellow-background test confirming `focus-visible` itself was firing, the root cause was identified.
- **Fix shipped**: switched `components/lead-card.tsx` to use native CSS `outline-2 outline-primary outline-offset-2` (commit `d239c75`). Native `outline` is not affected by the box-shadow override.
- **Status**: **FIXED on LeadCard**. Systemic guidance: any future component built on Card that needs a focus ring MUST use `outline-*`, not `ring-*`. Documented in commit message for `d239c75`. Future operator-decision: should `[data-slot="card"]` override be relaxed (e.g., to only suppress non-focus box-shadows)? Out of B23 scope.

### Finding 17 — Card-level `onKeyDown` open-handler fires when keydown is on a descendant button, **HIGH**
- **Surface**: `components/lead-card.tsx` LeadCard + `app/dashboard/pipeline/page.tsx` PipelineCard.
- **Category**: C. A11y smoke (keyboard behavior).
- **Severity**: HIGH (broke keyboard interaction with inner action buttons).
- **Repro**: in `/dashboard/leads`, Tab to the status-change button inside a lead card → Enter. Expected: status changes. Actual: dialog opens AND status does NOT change. Same with the MoreVertical dropdown trigger: Tab + Enter opens BOTH the dropdown AND the dialog.
- **Impact**: keyboard users cannot interact with inner buttons on lead cards without triggering the wrong action. Mouse users were not affected because the inner buttons' `onClick` already had `e.stopPropagation()`.
- **Root cause**: when Enter is pressed on an inner `<Button>`, the browser dispatches a synthetic click which triggers the button's `onClick`. The `stopPropagation` there suppresses click bubbling. BUT the original `keydown` event continues bubbling up to the outer Card's `onKeyDown` handler, which checks `e.key === 'Enter'` and calls `onClick()` (open dialog).
- **Fix shipped**: added `if (e.target !== e.currentTarget) return` guard to the Card-level `onKeyDown` in both LeadCard and PipelineCard (commit `429b984`). Only fires the open-handler when keydown happened on the Card itself, not on a descendant.
- **Status**: **FIXED**.

### Finding 9 (V1 verification) — Sidebar text-white low-opacity contrast measurement: **CONFIRMED FAIL**
- **Status update**: was deferred MEDIUM-MANUAL in initial static audit. **V1 smoke promoted to HIGH and fixed in this iteration.**
- **Method**: analytical computation against confirmed sidebar bg `#000000` (per `app/globals.css:33 --sidebar`).
- **Measurement results**:
  - `text-white/20` → blended grey 51 → **1.66:1** → FAIL (used: SidebarTrigger icon, balance Zap icon, ChevronDown).
  - `text-white/25` → blended grey 64 → **2.07:1** → FAIL HARD (used: "balance" label text at 10px).
  - `text-white/30` → blended grey 77 → **2.56:1** → FAIL (used: group labels Ventas/Delivery/Finanzas/Admin, balance value, user role, "platform" tag).
  - `text-white/35` → 3.12:1 → borderline PASS as UI (kept).
  - `text-white/45` → 4.59:1 → borderline PASS as text (kept).
- **Fix shipped** (commit `0a40185`): replace_all in `components/app-sidebar.tsx`:
  - All `text-white/20` → `text-white/50` (1.66:1 → 5.6:1).
  - All `text-white/25` → `text-white/50` (2.07:1 → 5.6:1).
  - All `text-white/30` → `text-white/55` (2.56:1 → 6.2:1).
- **Hover state preservation**: replace_all collapsed two hover progressions; manually restored:
  - SidebarTrigger expanded: was `text-white/20 hover:text-white/50` → after replace_all became `/50 hover:/50` (no progression) → fixed to `/50 hover:/80`.
  - ChevronDown: was `text-white/20 group-hover:text-white/40` → after replace_all became `/50 group-hover:/40` (reversed!) → fixed to `/50 group-hover:/80`.
- **Visual trade-off accepted by operator**: the "muted nav" look is now slightly less muted but still subtle. All resting states now pass WCAG AA.

## Smoke pass V queue results

| V | Status | Notes |
|---|---|---|
| V1 sidebar contrast | ✅ CLOSED 2026-05-22 | Analytical measurement against `--sidebar: #000000`. Finding 9 promoted MEDIUM-MANUAL → HIGH → fixed in commit `0a40185`. |
| V2 palette contrast | ⏳ SKIPPED | F10 (deferred token migration to `--success/--warning/--info`) already covers; no value re-measuring. |
| V3 mobile viewport sweep | ⚠️ **CRITICAL findings surfaced** | At 375 × 667: dashboard navigation broken (Finding 14 CRITICAL), `/dashboard/leads` cards overlap + horizontal scroll (Finding 15 HIGH). Deferred to dedicated mobile-responsive iteration / frontend-redesign-playbook. Other viewports (390/414/768) not tested — likely same class of issues at narrow widths. |
| V4 keyboard nav | ✅ CLOSED (leads + pipeline desktop) | Focus ring visible via outline (Finding 16), Tab + Enter on inner buttons isolated (Finding 17). `/dashboard/projects` + `/dashboard/tasks` + `components/lead-detail.tsx` NOT executed — operator follow-up. |
| V5 screen reader | ⏳ DEFERRED operator follow-up | Requires Narrator setup (Win+Ctrl+Enter) — non-trivial to invoke mid-session. |
| V6 prefers-reduced-motion | ⏳ DEFERRED operator follow-up | OS setting toggle + reload + observation. |
| V7 focus indicator visibility | ✅ implicit via V4 | Outline visible on dark mode bg-card surface; sidebar contrast fixes also improve focus visibility there. |

## Closed-in-iteration findings (final)

- **CRITICAL fixed**: 1 / 2 (Finding 1 closed; Finding 14 deferred to mobile redesign iteration).
- **HIGH fixed**: 8 / 9 (Findings 2, 3, 4, 5, 6, 12, 17, 9-promoted; Finding 15 deferred to mobile redesign iteration).
- **MEDIUM fixed**: 2 / 5 (Findings 7, 16). F10 + F11 deferred per Q2 default + scope; F13 deferred LOW systemic.
- **LOW deferred**: 1 (Finding 13).
- **Total commits shipped on PR #91**:
  - `515401d` — initial fixes (Findings 1-6, 7, 12)
  - `3b4cc52` — focus ring visibility + pipeline focus restore
  - `0f782a4`, `8ca4975` — outline experiment (reverted)
  - `cf3f356` — ring-4 attempt before discovering box-shadow override
  - `ebda392`, `794c24d` — Vercel diagnostic + revert (Vercel issue platform-side, unrelated)
  - `d239c75` — Finding 16 fix: LeadCard outline instead of ring
  - `429b984` — Finding 17 fix: keydown target guard
  - `0a40185` — Finding 9 V1 fix: sidebar contrast bumps

## Iteration closure (final)

- Verdict (this pass): **PARTIAL** — significant code-side improvements shipped; mobile responsive gap surfaced as CRITICAL and deferred to dedicated iteration; remaining V queue items (V3 mobile partial, V4 secondary surfaces, V5, V6) deferred to operator follow-up.
- **Mobile responsive iteration** newly identified as the natural follow-up. Aligns with the frontend redesign playbook at `docs/runbooks/frontend-redesign-playbook.md` (referenced in operator's persistent memory). Findings 14 + 15 are inputs to that work.
- **Operator decision queue carried forward**:
  - F11 — shadcn h-9 vs Apple HIG h-11. WCAG AA 2.5.8 currently passes at h-9.
  - F10 — semantic color token migration (`--success/--warning/--info` for `text-yellow/green/blue-*` consumers).
  - F13 — codemod to add `aria-hidden="true"` to decorative lucide icons.
- **New gap surfaced**: **G20 — desktop scroll-to-top on dashboard interaction** (root cause unconfirmed, possibly Radix Dialog body-scroll-lock behavior; investigation pending). Recorded in roadmap §16 for follow-up.
- Roadmap §7 row updated: **yes** (post-merge).
- core.md Closed-in-runtime entry updated: **yes** (post-merge).
- Next session natural step: open mobile-responsive iteration spec using the frontend-redesign-playbook as guide; or, if operator prefers, continue B23 operator-side V4 (projects/tasks/lead-detail keyboard nav) + V5 (screen reader) + V6 (reduced motion) checks against the desktop surface before scoping the mobile rework.

### Notes on what this audit did NOT cover

- `/dashboard/projects` (1407 lines), `/dashboard/tasks` (675 lines), `components/lead-detail.tsx` (2271 lines) were not read line-by-line. Pattern-grep across these surfaces did not surface aria-label-missing-on-icon-button hits beyond the ones already listed. Operator-side V4 covers the keyboard nav check for these.
- MEDIUM priority surfaces (`/dashboard/updates`, `/dashboard/settings`, `/dashboard/pm-queue`, `/dashboard/reports`, `components/maxwell-chat.tsx`, `components/project-detail.tsx`, `components/task-detail.tsx`) were not audited beyond the targeted grep for `<Button size="icon">`. Browser pass should sample-check these.
- Color contrast measurement was DONE for the sidebar (V1, computed analytically). The earnings/palette badges (F10) were NOT measured because the fix is deferred regardless to the token migration iteration.
