# spec.md — fase-3-b23-a11y-manual-ronda

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-22 (scope spec); execution date TBD by operator
- Session ID: fase-3-b23-a11y-manual-ronda
- Developer: Pedro (`noondevelop@gmail.com`)
- Main active skill: `system-analysis` (this spec); downstream skill chain depends on what the audit surfaces — see `## Skill Chain Hypothesis`
- Router mode: Bugfix-class (audit + targeted fixes), with a possible Refactor character if findings are systemic
- Depth: LITE proposed (the audit is structured but the deliverable is well-bounded). FULL only if findings reveal an architectural a11y gap (e.g., missing focus management strategy across all dialogs) — escalation rule below

### OBJECTIVE
- What must be achieved in this session: produce a documented accessibility audit across the highest-impact dashboard surfaces, fix every finding classified CRITICAL or HIGH inside the same iteration, and record MEDIUM / LOW findings as deferred follow-ups with concrete repro + remediation suggestions. The audit covers three categories: **mobile viewport sweep**, **dark mode contrast**, and **manual a11y smoke** (keyboard + screen reader + focus management + touch target).
- Why this work matters now: B23 is the last canonical FASE 3 coding item (per roadmap §7). FASE 3 closure depends on it. The audit is also a precondition for any external customer exposure beyond the 4-person pilot — the pilot operators are technical and tolerate broken keyboard nav or low-contrast badges; a real customer would not. Catching CRITICAL/HIGH issues before that exposure is the entire point.
- It is NOT a feature surface — there are no new routes, no new components, no new APIs. The deliverable shape is `findings document + commit-level fixes + deferred list`, not a feature flag or migration.

### CONTEXT USED
- `project.context.core.md` reviewed: yes (default operating context — Operating rules govern which surfaces are "intentionally honest-unavailable" and stay out of scope)
- `project.context.full.md` reviewed: no (no architectural contracts being modified; the rule set in `core.md` is sufficient for surface classification)
- `project.context.history.md` reviewed: no (no historical decisions are being revisited)
- Reason `full` was excluded: B23 modifies presentation layer only. Server contracts, database schemas, RLS policies, and integration contracts are all untouched. The architecture-tier docs do not constrain audit scope.

### ROUTER DECISION
- Why this mode is correct: Bugfix-class. The work consists of finding defects (issues) in existing surfaces and fixing the ones that meet the severity bar. No new feature is being introduced. If the audit surfaces a systemic gap (e.g., zero dialogs have focus restoration on close), the iteration can escalate to Refactor-class for that subset — see `## Escalation rules` below.
- Why this depth is correct: LITE. The deliverable is well-bounded (audit doc + fixes for HIGH+ findings). Standard skill chain is `analysis → frontend → testing → docs → validator`. Skip architecture (no contracts changed), skip backend (no server changes), skip security (no auth surfaces), skip refactor (only ad-hoc fixes), skip infra (no runtime/deploy changes). FULL is reserved for the escalation case below.
- Why this skill is the right active skill now: nothing else can route until the audit scope is closed. The execution of the audit IS the analysis output — the findings document IS the spec evidence. `system-frontend` cannot fix issues until they are surfaced.
- Reroute already known at start: no.

### SCOPE
- In scope: see `## Scope Boundary`.
- Explicitly out of scope: see `## Scope Boundary`.
- Success criterion: see `## Success Criterion`.

### INPUTS
- Files/modules involved: see `## Affected Files / Modules`. The list is hypothesis-only — the actual files touched depend on what the audit surfaces. Expected hot spots: `components/lead-detail.tsx` (most-used modal), `components/app-sidebar.tsx` (nav), `app/dashboard/page.tsx` (KPI cards), `components/ui/*` (shared primitives).
- Contracts or architecture inputs available: none. B23 does not change contracts.
- Relevant handoffs received: roadmap §17 marks B23 as the last canonical FASE 3 coding item; operator picked the iteration at 2026-05-22 while G18+G19 were closing in parallel.
- External dependencies or environment assumptions: a local `pnpm dev` session running the app in `supabase` mode against the dev/preview Supabase project. Mobile viewport simulation via browser DevTools responsive mode. Screen reader smoke via macOS VoiceOver (operator default), Windows Narrator as fallback if running on the Windows machine. Color contrast verification via browser DevTools Accessibility panel or the axe-core extension.

### RISK SNAPSHOT
- Known risks before starting: see `## Risks`.
- Known blockers before starting: none. The work can start immediately on `develop` HEAD (currently `ab919b6`).
- Known assumptions before starting: see `## Assumptions`.

### CONTINUITY NOTES
- Previous session relevant to this one:
  - F-V14/15/16/17 (PR #79 + #80, 2026-05-20) — the UI Tier 4 cleanup is the most recent presentation-layer iteration. Some F-V findings were a11y-adjacent (the F-V17 `DropdownMenuItem disabled "Llamar no disponible"` removal). B23 may surface similar fake-affordance leftovers.
  - G18 + G19 (PR-pending, 2026-05-22 parallel session) — touched `app/dashboard/{leads,projects,tasks}/page.tsx` + `lib/auth-context.tsx`. The G18 fix introduces `justClosed*IdRef` refs in three dashboard pages — audit should verify the dialog close behavior is also keyboard-driven (Esc key works, focus restores correctly).
  - F-V20 login copy (per roadmap) — login surface should pass audit.
- Expected next skill after this session if all goes well: `system-frontend` to apply the fixes for CRITICAL / HIGH findings, then `system-testing` to verify no regression, then `system-docs` to file the findings document in `docs/validations/`, then `system-validator` to close.

---

## Task Summary

Execute a structured manual accessibility audit across the highest-impact NoonApp dashboard surfaces and fix the findings that meet the severity bar. The work produces three artefacts:

1. **`docs/validations/b23-a11y-manual-ronda-YYYY-MM-DD.md`** — the canonical findings document. One per execution session (operator may run the audit in multiple sittings; each sitting appends to the same dated file or files a new one — Architecture-equivalent decision flagged in Open Questions).
2. **Commit-level fixes** for every finding classified CRITICAL or HIGH. Each fix is scoped to the minimum surface change necessary; no surrounding cleanup, no opportunistic refactors (per `CLAUDE.md` operating rules).
3. **Deferred follow-ups list** in the findings document — MEDIUM / LOW issues recorded with severity, repro, recommended fix, and (if applicable) future-iteration name.

The audit covers three categories. Each surface is evaluated against all three.

| Category | Coverage |
|---|---|
| **Mobile viewport sweep** | Layouts must render correctly at 375 × 667 (iPhone SE 2nd gen), 390 × 844 (iPhone 14), 414 × 896 (iPhone Pro Max), 768 × 1024 (iPad portrait). No horizontal scroll, no clipped text, no overflowing elements, no tap targets smaller than 44 × 44 px. |
| **Dark mode contrast** | WCAG AA contrast ratios verified across all visible text/background pairs and UI components in dark mode: ≥ 4.5:1 for normal text, ≥ 3:1 for large text (18 pt+ regular or 14 pt+ bold) and UI components (badges, focus rings, button borders). Light mode is **out of scope** for this iteration unless a finding is identical across modes. |
| **A11y manual smoke** | Keyboard navigation (Tab order, Escape behavior, Enter activation, focus trap + restore on modal open/close), screen reader compatibility (icon-only buttons have `aria-label`, form fields have associated labels, live regions for toasts), heading hierarchy, alt text policy (decorative `aria-hidden`, functional labeled), touch target minimums, and `prefers-reduced-motion` respect. |

Out of band but explicitly named so they are not forgotten:

- **Automated a11y testing (axe-core in CI / Playwright a11y tests)** — out of scope; future iteration. The current iteration is manual.
- **WCAG AAA compliance** — out of scope. Target is AA, which is the industry-standard internal-tool bar.
- **Full screen reader certification across JAWS / NVDA / VoiceOver / TalkBack** — out of scope. Smoke against one screen reader (operator-default VoiceOver, fallback Narrator) is the bar.
- **Internationalization (i18n) of error messages / labels** — out of scope. Spanish-only is the current product state; i18n is a v3 cross-cutting concern per roadmap §9.

---

## Scope Boundary

### In scope

**Surfaces audited (HIGH priority — must pass)**:
- `/` (login surface)
- `/dashboard` (home)
- `/dashboard/leads` (sales main)
- `/dashboard/pipeline` (kanban board — DnD a11y is the hardest single check)
- `/dashboard/projects` (delivery main)
- `/dashboard/tasks` (delivery detail)
- `/dashboard/earnings` (money — wallet + buckets + history)
- `/dashboard/notifications` (recent F-V14 surface)
- `components/lead-detail.tsx` (lead detail dialog — most-used modal across the workspace)
- `components/app-sidebar.tsx` (nav — present on every dashboard route)

**Surfaces audited (MEDIUM priority — audit if HIGH priority pass leaves time)**:
- `/dashboard/updates` (F-V15)
- `/dashboard/settings` (admin tabs: General / Integraciones / Notificaciones / Prototipos / Ganancias)
- `/dashboard/pm-queue` (PM inbound review)
- `/dashboard/reports` (analytics)
- `components/maxwell-chat.tsx` (Maxwell dialog)
- `components/project-detail.tsx` (project detail dialog)
- `components/task-detail.tsx` (task detail dialog)

**Fixes applied within iteration**:
- Every finding classified CRITICAL (P0 — surface is unusable for an entire input modality) or HIGH (P1 — surface degrades but still usable; affects a load-bearing flow like leads / earnings / login).
- MEDIUM and LOW findings: recorded, NOT fixed in this iteration.

**Deliverables**:
- `docs/validations/b23-a11y-manual-ronda-YYYY-MM-DD.md` — findings document with the matrix + issues + fixes + deferred list.
- Commits for CRITICAL/HIGH fixes (one PR or multiple small PRs at operator discretion).
- `docs/context/project.context.core.md` — append a Closed-in-runtime entry describing the audit outcome + the operating rules introduced by any fixes (e.g., "every dialog must use the shared `<Dialog>` primitive whose default behavior restores focus on close" — only if such a rule emerges from the audit).
- Roadmap update (`D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md`) — §7 status row + §17 handoff snapshot + §16 if new gaps surface.

### Explicitly out of scope

- **Surfaces intentionally honest-unavailable per operating rules** (per `core.md`): `/dashboard/rewards` (honest unavailable), Notificaciones tab in `/dashboard/settings` is preferences-only (no real delivery), `web-analysis` analysis-result surface is read-only per F-V04 rule. These pages have their UX state pinned by existing operating rules; auditing them for a11y of unimplemented features is wasted effort. They ARE audited for the existing visible content (the honest-unavailable message must itself meet contrast + screen reader rules), but the underlying unavailable-feature surface is not.
- **`/client/[token]` legacy route per ADR-010** — deuda técnica, scheduled for removal pre-v3. Auditing it is wasted effort.
- **`/dashboard/credits`** — bridge wallet frozen per ADR-009; surface is legacy-ish. SKIP for B23; audit when retiring per Phase 8.
- **`/dashboard/prototypes` iframe content** — iframe a11y is content-side (the prototype HTML, not our chrome). The chrome around the iframe IS audited; the iframe content is not.
- **Automated a11y testing infrastructure (axe-core, Playwright a11y, eslint-plugin-jsx-a11y enforcement)** — future iteration.
- **Light mode contrast audit** — out of scope unless a finding is identical across both modes. Dark mode is the operator-default theme today; light mode is a secondary path.
- **WCAG AAA targets** — AA is the bar.
- **Mobile screen reader testing (iOS VoiceOver, Android TalkBack on real devices)** — out of scope. Desktop screen reader smoke (macOS VoiceOver or Windows Narrator) is the bar.
- **Tablet landscape orientation (1024 × 768)** — out of scope; portrait (768 × 1024) is the only iPad target.
- **Browser zoom up to 200%** (WCAG 1.4.4) — out of scope unless surfaced by an existing complaint. Future iteration if needed.
- **Refactor of every component touched** — fixes are scoped minimum-necessary per `CLAUDE.md`.

---

## Success Criterion

The iteration is COMPLETE when **all four** conditions hold:

1. **Audit coverage**: every surface in the HIGH priority list above has been evaluated against all three categories. The findings document shows a PASS / FAIL / N/A entry for each surface × category cell. MEDIUM priority surfaces have at least the dark mode contrast category evaluated (the cheapest of the three).
2. **CRITICAL / HIGH severity zero**: every finding classified CRITICAL or HIGH has either (a) been fixed in this iteration with a commit linked from the findings document, or (b) been explicitly deferred with operator approval recorded inline in the findings document (e.g., "deferred to v3 i18n cross-cutting, operator-acknowledged").
3. **Deferred follow-ups recorded**: every MEDIUM / LOW finding has a one-line entry in the deferred section with severity, surface, category, repro, and recommended fix. The entries are descriptive enough that a future operator can pick them up without re-running the audit.
4. **Context updated**: `project.context.core.md` reflects the audit outcome (Closed-in-runtime entry); roadmap §7 row, §17 handoff snapshot, and §16 (if new gaps surfaced) all reflect the closure.

PARTIAL is acceptable IF the audit completes but a CRITICAL finding cannot be fixed in-iteration (e.g., requires a system-architecture decision on focus-management strategy). The findings document records the gap; a follow-up iteration is opened with the deferred CRITICAL.

BLOCKED is acceptable IF the audit cannot start (local dev environment unavailable, dark mode broken in dev, etc.). The findings document records why; the iteration reschedules.

---

## Affected Files / Modules

Hypothesis-only; the actual file list emerges from findings. Expected hot spots:

| Likely surface | Why expected hot spot |
|---|---|
| `components/lead-detail.tsx` | Largest single component; many tabs (Estado / IA Asistente / Propuestas / Actividad / etc.); fake-affordance history (F-V17); recently touched by G18 (close handler timing). |
| `components/app-sidebar.tsx` | Present on every dashboard page; recently touched by F-V16 follow-up (PR #80) for the Earnings menu visibility. |
| `app/dashboard/page.tsx` | Multiple KPI cards with custom layouts; `Mis tareas` / `Tareas del equipo` role-aware label (operating rule) is the kind of branch that often has a contrast or screen-reader gap. |
| `components/kanban-board.tsx` | DnD via @dnd-kit. Keyboard a11y of DnD is notoriously hard; the recent pipeline drop-target fix (operating rule about `pointerWithin` + `Empty` placeholder) introduced complexity. |
| `components/ui/*` (shared primitives) | Any contrast or focus issue here propagates to every consumer. Highest leverage to fix once. |
| `app/page.tsx` (login) | Pre-auth surface; first impression. The F-V20 wording landed but a11y wasn't reviewed. |
| `components/lead-card.tsx` | Dropdown menu (F-V17 cleanup), quick actions; mobile viewport tight. |
| `tailwind.config.ts` + `app/globals.css` | If contrast fixes require token updates rather than per-component overrides. |

NOT in the hot spot list but in scope for audit (no expected fixes):
- `app/dashboard/notifications/page.tsx` (recent F-V14, expected clean)
- `app/dashboard/updates/page.tsx` (recent F-V15, expected clean)
- `app/dashboard/earnings/page.tsx` (Tier 4 cleanup recent)

---

## Audit checklist

The findings document is structured around this checklist. Each surface evaluates against each row.

### A. Mobile viewport sweep

For each viewport size (`375 × 667`, `390 × 844`, `414 × 896`, `768 × 1024`):

- [ ] No horizontal scroll on body. (Diagnose: `document.documentElement.scrollWidth > document.documentElement.clientWidth`.)
- [ ] No clipped text (no `text-overflow: ellipsis` on content that should wrap, no content cut off by `overflow: hidden`).
- [ ] No overlapping elements (sidebar + main content, button + adjacent button, etc.).
- [ ] All interactive elements (buttons, links, form inputs) have hit area ≥ 44 × 44 px. Inspect via DevTools.
- [ ] Sticky / fixed elements (top nav, sidebar trigger, FAB if any) do not block content at the smallest viewport.
- [ ] Modals / dialogs render fully inside the viewport (no off-screen close button, no inaccessible action).
- [ ] Forms scroll into view when the keyboard opens on mobile (test in DevTools mobile mode with software keyboard simulation if available).

### B. Dark mode contrast

For each visible text + background pair AND each UI component (badges, focus rings, button borders, disabled states):

- [ ] Normal text contrast ≥ 4.5:1.
- [ ] Large text contrast ≥ 3:1 (18 pt+ regular or 14 pt+ bold).
- [ ] UI component contrast ≥ 3:1 (badges, focus indicators, button borders against adjacent surfaces).
- [ ] No "near miss" pairs (3.0–4.4:1 for normal text — these often pass DevTools' coarse check but fail axe-core's stricter measurement; record as MEDIUM if found).
- [ ] Disabled state is visually distinct from enabled state AND from background (must not be invisible).
- [ ] Focus indicator is visible against all backgrounds where the focusable element can appear.

Tooling: browser DevTools → Accessibility panel → Contrast picker; or install the axe-core browser extension for automated batch checks on a given page.

### C. A11y manual smoke

For each high-priority surface, exercise these flows with the keyboard only and observe via screen reader:

- [ ] Tab order follows visual reading order. No focus traps outside of modals.
- [ ] Skip-to-main-content link is present and works (Tab from page load → first focusable should be the skip link OR the logo; the skip link should expose itself with a visible focus ring).
- [ ] Every icon-only button has an accessible name (`aria-label`, `title`, or visually-hidden text).
- [ ] Every form input has an associated `<label>` (or `aria-labelledby` / `aria-label` if the visible label is decorative).
- [ ] Form validation errors are associated with their inputs (`aria-invalid` + `aria-describedby` pointing to error text).
- [ ] Toast / notification announcements use `role="status"` (or `role="alert"` for errors) — verified by hearing the screen reader announce them automatically.
- [ ] Modal open: focus moves into the modal automatically.
- [ ] Modal escape: pressing `Esc` closes the modal AND restores focus to the trigger.
- [ ] Modal close button has accessible name.
- [ ] Heading hierarchy is sensible (no skipped levels; one `<h1>` per page).
- [ ] Decorative images / icons use `aria-hidden="true"` or empty `alt`; functional images / icons have accessible names.
- [ ] `prefers-reduced-motion` is respected on at least the dialog open/close animation, the page transition (if any), and any auto-playing media (none expected, but verify).
- [ ] No reliance on color alone to convey meaning (status badges use icon + text, error states use icon + text, etc.).

Tooling: macOS VoiceOver (Cmd+F5 to toggle, VO+→ to navigate). Windows Narrator (Win+Ctrl+Enter, Caps Lock+→). Browser DevTools → Accessibility tab → Show ARIA tree for static inspection.

### D. Touch targets (covered by A but tracked separately)

- [ ] All hit areas ≥ 44 × 44 px (Apple HIG) for primary interactive elements.
- [ ] 8 px minimum spacing between adjacent independent targets (per Material guidelines; not WCAG-strict but Microsoft Inclusive Design recommended).
- [ ] Targets that are smaller than 44 × 44 px have either (a) enough padding around them to be reliably tappable, OR (b) a documented exception (e.g., dense data tables where Material's 44 px would break the layout).

---

## Severity ladder

| Severity | Definition | Fix policy |
|---|---|---|
| **CRITICAL** | Surface is **completely unusable** with at least one input modality (keyboard, screen reader, or smallest mobile viewport). Example: kanban board is impossible to operate without a mouse AND there is no alternative flow. | Fix in iteration. If blocked on an architectural decision, deferral requires explicit operator acknowledgement recorded in the findings document. |
| **HIGH** | Surface **degrades materially** but remains usable. Affects a load-bearing flow (leads, earnings, login, lead detail). Example: lead detail dialog opens but cannot be closed via keyboard. | Fix in iteration. |
| **MEDIUM** | Surface has a known issue that does NOT block the flow. Example: dark mode badge contrast is 4.0:1 (below 4.5:1 but readable). | Record as deferred. Not fixed in iteration. |
| **LOW** | Cosmetic or near-miss. Example: tab order skips a non-interactive heading. | Record as deferred. Not fixed in iteration. |

---

## Evidence template

The findings document at `docs/validations/b23-a11y-manual-ronda-YYYY-MM-DD.md` follows this template:

```markdown
# B23 a11y manual ronda — YYYY-MM-DD

## Audit metadata
- Operator: <name + email>
- Date(s): <YYYY-MM-DD> (and follow-up dates if multi-session)
- Browser: <Chrome 130 / Firefox 134 / Safari 18.x>
- OS: <macOS 15.x / Windows 11>
- Screen reader: <VoiceOver / Narrator / NVDA / none>
- Local app build: <git commit SHA of develop at audit time>

## Coverage matrix

| Surface | A. Mobile (375 / 390 / 414 / 768) | B. Dark mode contrast | C. A11y smoke | D. Touch targets |
|---|---|---|---|---|
| `/` (login) | PASS | PASS | FAIL (1) | PASS |
| `/dashboard` | PASS | FAIL (2) | PASS | PASS |
| `/dashboard/leads` | FAIL (3) | PASS | PASS | PASS |
| ... | ... | ... | ... | ... |

`(N)` = number of findings; see issues below.

## Findings

### Finding 1 — `/` login, A11y smoke, CRITICAL
- Surface: `/` (login)
- Category: A11y smoke
- Severity: CRITICAL
- Repro: Tab from page load → Tab order skips the password field; cannot reach Submit via keyboard.
- Recommended fix: <one or two sentences>.
- Status: <FIXED commit `abc1234` / DEFERRED to follow-up iteration / DEFERRED per operator ack>.

### Finding 2 — `/dashboard`, Dark mode contrast, MEDIUM
- Surface: `/dashboard`
- Category: Dark mode contrast
- Severity: MEDIUM
- Repro: KPI badge "Win rate" — text color `var(--muted-foreground)` against badge background `var(--card)` measures 3.8:1. Below 4.5:1.
- Recommended fix: bump muted-foreground tone in dark mode OR change badge background to surface-strong.
- Status: DEFERRED.

(... one Finding entry per defect, ordered by severity then by surface ...)

## Deferred follow-ups summary

| ID | Severity | Surface | Category | One-line summary |
|---|---|---|---|---|
| F1 | MEDIUM | `/dashboard` | Dark mode | Win rate badge contrast 3.8:1 |
| ... | ... | ... | ... | ... |

## Iteration closure

- CRITICAL fixed: <count> / <total>
- HIGH fixed: <count> / <total>
- MEDIUM deferred: <count>
- LOW deferred: <count>
- Verdict: COMPLETE / PARTIAL / BLOCKED
- Roadmap §7 row updated: <yes / no>
- core.md Closed-in-runtime entry: <linked>
```

---

## Open Questions

For Architecture (or operator, if no Architecture skill is invoked):

- **Q1**: Findings document — one file per audit-execution session, or one canonical evolving file updated across sessions?
  - **(a)** One file per session (`b23-a11y-manual-ronda-2026-05-23.md`, `-2026-05-25.md`, etc.) — clean audit trail, no merge fights, easy to diff between runs.
  - **(b)** One canonical file (`b23-a11y-manual-ronda.md`) updated across all sessions, with a changelog at the top.
  - **Default**: (a) — matches the existing `docs/validations/` convention (every other validation doc is dated).

- **Q2**: Severity bar for in-iteration fix — CRITICAL + HIGH only, or extend to MEDIUM?
  - **(a)** CRITICAL + HIGH only (as currently scoped). Keeps iteration bounded to ~1d. MEDIUM accumulates as backlog.
  - **(b)** CRITICAL + HIGH + MEDIUM. Closes more issues but iteration expands to 1.5–2d.
  - **Default**: (a) — keep the iteration day-sized; MEDIUM backlog is acceptable for an internal pilot.

- **Q3**: PR shape — one PR per fix (small + focused) or one PR for all CRITICAL/HIGH fixes (single review)?
  - **(a)** One PR per fix. Better review focus per fix; more git overhead.
  - **(b)** One PR for the whole audit + all fixes + findings doc. Easier single review; harder to revert one fix in isolation.
  - **Default**: (b) — the audit is one logical unit. If a single fix needs revert, it can be backed out within the PR before merge.

- **Q4**: Surface-level fix policy when the root cause is a shared primitive (e.g., `components/ui/badge.tsx` has the contrast bug) — fix the primitive (affects every consumer) or override per-surface?
  - **(a)** Fix the primitive. Higher leverage; one fix closes many findings; risk that other surfaces (out-of-scope ones) change visually.
  - **(b)** Override per-surface. Lower leverage; only fixes the audited surface; no risk to out-of-scope surfaces.
  - **Default**: (a) — primitives should be correct. Visual change to out-of-scope surfaces is acceptable when the change is "contrast goes up" (always wins) vs "contrast goes down" (never expected from a fix). Architecture / operator can override if a primitive fix would meaningfully shift the visual identity.

- **Q5**: VoiceOver vs Narrator vs NVDA — which is the smoke standard, and is one enough?
  - **(a)** Operator-default only (whatever the auditing operator runs). VoiceOver on Mac, Narrator on Windows.
  - **(b)** Specify NVDA on Windows as the bar (NVDA is the most-used assistive tech on Windows per WebAIM surveys).
  - **(c)** All three.
  - **Default**: (a) — internal pilot tolerance; smoke against one screen reader catches the obvious failures. The audit recommends NVDA for follow-up if external customer exposure approaches.

- **Q6**: Dark mode token system audit — should B23 also produce a `docs/design-tokens-dark-mode.md` companion doc that catalogues every dark mode color token and its computed contrast against expected adjacent surfaces?
  - **(a)** Yes — long-term-valuable artefact; future iterations can verify against it.
  - **(b)** No — out of scope for B23; only the findings document is mandated.
  - **Default**: (b) — keep iteration focused. If the audit surfaces enough token-level issues to warrant a catalogue, the operator can open a follow-up iteration for it.

- **Q7**: Should fixes be applied as the audit progresses (interleaved) or in a batched fix pass at the end?
  - **(a)** Interleaved — fix CRITICAL/HIGH the moment they are found. Faster feedback; risk of context loss between audit and fix.
  - **(b)** Batched — finish the audit, then fix. Cleaner mental model; risk of forgetting subtle context of a finding by the time the fix is applied.
  - **Default**: (a) for CRITICAL only (don't let a CRITICAL sit even one hour); (b) for HIGH (batched at the end of audit pass).

- **Q8**: B23 closure if the audit surfaces something that requires a v3-scope decision (e.g., "no global ARIA live region exists for toast notifications, adding one requires deciding the global toast strategy")?
  - **(a)** Close B23 as PARTIAL with the v3-scope deferral named, escalate to operator for v3-planning input.
  - **(b)** Stop B23, open the v3-scope iteration first, resume B23 after the dependency lands.
  - **Default**: (a) — keep B23 progress visible; the v3-scope item joins the FASE 4 / FASE 5 backlog.

---

## Risks

- **R1**: The audit surfaces too many MEDIUM/LOW issues to record cleanly. **Mitigation**: enforce one-line summaries in the deferred table; do not expand each into a full Finding entry unless severity ≥ HIGH.
- **R2**: A fix for a shared primitive (per Q4 default) introduces unintended visual regression in an out-of-scope surface. **Mitigation**: take a screenshot diff (DevTools → snapshot the primitive's gallery page if one exists; or manual visual diff in the operator's recall) before/after each primitive change. Roll back if a regression is unintentional.
- **R3**: The audit takes longer than 1d because findings are denser than estimated. **Mitigation**: the iteration can split — finish HIGH-priority surfaces audit in day 1, MEDIUM-priority surfaces in a follow-up day. The findings document tracks coverage progress; closure does not require MEDIUM surfaces if HIGH surfaces all PASS or have fixes shipped.
- **R4**: Dark mode contrast token changes cascade to many components — typecheck/lint passes but visual regression is broad. **Mitigation**: prefer per-component overrides for any token change that would affect more than 5 distinct surfaces; route a real token-system update to a dedicated future iteration.
- **R5**: Screen reader behavior in dev mode differs from production (Next.js dev mode injects React DevTools / HMR overlay nodes that confuse the AT tree). **Mitigation**: run a production build (`pnpm build && pnpm start`) for the screen reader smoke pass; dev mode is acceptable for the keyboard navigation and viewport sweep passes.
- **R6**: Findings the operator decides to defer get forgotten. **Mitigation**: the deferred table at the end of the findings document is the canonical backlog; every entry MUST have a recommended fix one-liner so it can be picked up later without re-audit.
- **R7**: G18+G19 fixes that land on the same day as B23 audit shift the audit's baseline mid-flight. **Mitigation**: capture the develop commit SHA in the audit metadata; if a fix lands during the audit, re-audit the affected surface only (typically just `/dashboard/leads` and `/dashboard/projects` for the G18 scope) rather than redoing the whole sweep.

---

## Assumptions

- The operator has a local `pnpm dev` environment that boots successfully against the dev/preview Supabase project (auth works, leads load, dashboards render).
- The operator has at least one screen reader installed and minimally familiar with its keyboard shortcuts.
- The operator is on the same machine as the parallel session — file conflicts handled by the same git discipline used for PR #89 (explicit file naming on `git add`, branch separation per scope).
- The dark mode toggle works in the current build. If dark mode is broken in the build, B23 audits light mode and flags dark mode as BLOCKED for a separate iteration.
- The audit does not need to cover internationalization — Spanish-only is the current product state.

---

## Skill Chain Hypothesis

Standard LITE chain expected:

1. **`system-analysis`** — this spec.
2. **`system-frontend`** — apply fixes for CRITICAL + HIGH findings. Touches presentation-layer files only (`components/*`, `app/dashboard/**/page.tsx`, possibly `app/globals.css` or `tailwind.config.ts` if a token change is required).
3. **`system-testing`** — verify no regression. Methodology: existing 420/420 test suite must remain green; manual smoke of any fixed surface to confirm the fix lands as expected. No new tests required (a11y findings are typically too presentation-specific to unit-test without heavy DOM/ARIA assertion libraries).
4. **`system-docs`** — finalize the findings document, update core.md Closed-in-runtime entry, update roadmap.
5. **`system-validator`** — close.

Skipped skills (with rationale):
- `system-architecture` — no contracts changed; no module boundaries shifted. (Re-enter only if Q8 escalation applies — a v3-scope decision surfaces.)
- `system-backend` — no server code.
- `system-security` — no auth surface changed; no input validation changed. (Re-enter only if an a11y fix accidentally introduces an XSS sink, which is implausible for presentation-only changes.)
- `system-refactor` — fixes are minimum-scope per the operating rule. No cleanup pass.
- `system-infra` — no runtime / build / deploy changes.

### Escalation rules

The iteration escalates from LITE to FULL **and** invokes `system-architecture` if any of these surface during the audit:

- A CRITICAL finding cannot be fixed without a cross-component architectural change (e.g., "we need a global focus-management context provider mounted at the layout level"). Architecture must design the boundary before frontend implements.
- A finding requires a new operating rule in `core.md` that constrains future development beyond the immediate fix (e.g., "every dialog MUST consume the shared `<Dialog>` primitive whose default behavior restores focus on close"). Operating rules are core.md material and warrant Architecture's explicit sign-off.
- A finding touches both NoonApp AND NoonWeb (e.g., the inbound proposal form on NoonWeb has the same a11y bug as the lead detail dialog on NoonApp because both render the same shared schema). Cross-repo coordination kicks in.

---

## Effort breakdown

| Block | Estimate | Notes |
|---|---|---|
| Local dev boot + DevTools setup + tool sanity | 15 min | One-shot at start |
| Audit pass — HIGH priority surfaces (10 surfaces × ~20 min) | ~3 h | Includes capturing findings inline in the document |
| Audit pass — MEDIUM priority surfaces (7 surfaces × ~10 min) | ~1 h | Lighter touch; mostly contrast-only |
| Fix CRITICAL findings (estimate 0–2 findings × 30 min each) | 0–1 h | If any |
| Fix HIGH findings (estimate 2–5 findings × 30–60 min each) | 1–5 h | Variable; depends on root cause depth |
| Findings document polish + deferred table | ~30 min | Convert inline findings into the canonical template |
| Roadmap + core.md updates | ~20 min | §7 row + §17 snapshot + §16 if new gaps + Closed-in-runtime |
| Validator pass | ~10 min | Re-run if any open question is answered after closure |
| **Total** | **~6–10 h** | Day-sized if HIGH findings are moderate; expands beyond 1d if HIGH findings cascade into multiple primitive changes |

Buffer rationale: a11y audits are notoriously variable. The 6h floor assumes few findings (mature codebase, recent Tier 4 cleanup). The 10h ceiling assumes 4–5 HIGH findings requiring shared-primitive fixes. Operator should plan a full day and accept that closure may slip to day 2 if the audit hits the ceiling.

---

## Iteration deliverable summary

When B23 closes:

- ✅ `docs/validations/b23-a11y-manual-ronda-YYYY-MM-DD.md` exists with the audit matrix, findings, and deferred table.
- ✅ Every CRITICAL / HIGH finding is FIXED or explicitly DEFERRED with operator acknowledgement.
- ✅ One PR (or multiple, per Q3 decision) lands on `develop` containing the fixes + the findings document.
- ✅ `docs/context/project.context.core.md` has a Closed-in-runtime entry for B23.
- ✅ Roadmap §7 row updated to `[x]` (assuming no DPA-style deferral mark); §17 handoff snapshot reflects the closure; §16 records any new gaps surfaced.
- ✅ B23 is the last canonical FASE 3 coding item — its closure unblocks the formal FASE 3 closure conversation (B1.5 operator items remain separately).

The iteration does NOT produce:

- ❌ A v3-scope decision document (deferral is fine for findings that need v3 input).
- ❌ Automated a11y test infrastructure.
- ❌ A token-system overhaul (unless the audit explicitly demands one, in which case the escalation rule fires and Architecture is invoked).

---

## Lifecycle

- **2026-05-22**: spec authored (`system-analysis` skill). Iteration READY-FOR-EXECUTION.
- **TBD**: operator picks an audit date. The 1d window can be a single block or split across 2 sittings.
- **TBD**: execution. `system-frontend` (fixes) → `system-testing` (regression check) → `system-docs` (findings finalization + roadmap) → `system-validator` (closure verdict).

Superseded by: nothing. This is the first B23 spec. If a future iteration needs a different a11y bar (e.g., AAA for external customer compliance), it opens a new spec rather than amending this one.
