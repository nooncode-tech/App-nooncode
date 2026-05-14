# FASE 1 — UX honesty bundle (browser validation)

**Date:** 2026-05-14
**Branch validated:** `feature/fase-1-ux-bundle-dia-2` at HEAD `41b550a` (2 commits ahead of develop `c3ba069`: spec landing + the impl).
**Validator:** Pedro (browser) + Claude (file edit / orchestration)
**Spec:** `specs/fase-1-ux-honesty-bundle.md`
**Goal:** Confirm in the local dev runtime that the 8 in-scope items in the spec render correctly. Six are pure copy / label / empty-state changes; two are hide decisions. No backend, no migrations, no contracts.

## What's being validated

| # | Item | Surface | Locked target |
|---|---|---|---|
| F-V09 | Earnings Pendiente helper | `/dashboard/earnings` | `En revision por administracion` |
| F-V11 | Pipeline empty-column state | `/dashboard/pipeline` | `Inbox` icon + `Sin leads` + `Arrastra un lead a esta etapa.` |
| F-V13 | Lead detail Propuesta empty state | lead detail → Propuesta tab | Section: `Propuestas`; empty: `Todavia no creaste una propuesta...` |
| F-V18 | Sidebar group restructure | sidebar | `Reportes` under workspace group; `Finanzas` keeps 3 items |
| F-V19 | Role-aware `Mis tareas` quick action | `/dashboard` | admin/pm in supabase → `Tareas del equipo`; else → `Mis tareas` |
| F-V20 | Login third value-prop block | `/` | `Wallet y comisiones internas` + new body |
| F-V04 | Web-analysis CTAs hidden | `/dashboard/web-analysis` | No `Abrir en Maxwell` / `Crear Lead desde análisis` buttons |
| F-V05 | Maxwell-on-Propuesta hidden in supabase | lead detail → Propuesta tab | No `Generar con Maxwell` button in supabase |

## Out of scope for this validation

- Pixel-perfect snapshots / visual regression tooling.
- Browser walkthrough of F-V06 / V07 / V08 (Tier 3, deferred).
- Browser walkthrough of F-V12 / V14 / V15 / V16 / V17 (Tier 4, deferred).
- Mobile viewport rendering (covered by FASE 3 a11y / mobile pass per roadmap §7).
- F-V04 wiring path (deferred — current iteration hides the dead CTAs only).
- F-V05 wiring path (deferred — blocked on the `IA Asistente` non-operational rule being lifted).

## Prerequisites

- [ ] `.env.local` configured with `NOON_ENABLE_SUPABASE_AUTH="true"` + Supabase URL/anon/service-role keys for `pdotsdahsrnnsoroxbfe`.
- [ ] Branch synced: `git checkout feature/fase-1-ux-bundle-dia-2 && git pull --ff-only origin feature/fase-1-ux-bundle-dia-2`.
- [ ] Dev server running: `npm run dev` on `http://localhost:3000` (Next.js 16.2.6 + Turbopack — pass `--no-turbopack` to dodge the OOM landmine on `D:\` per the 2026-05-13 closure note).
- [ ] At least one seeded supabase admin/pm user (`admin@noon.app` works) and one developer user (`pedro@noon.app`) available for the F-V19 dual check.
- [ ] At least one lead with zero proposals available for the F-V13 + F-V05 check.

## Scenarios

---

### Scenario 1 — F-V09: Earnings Pendiente helper

- **What to do:**
  1. Log in as `juan@noon.app` (or any user with a non-zero `pending` bucket — admin can credit one via `/dashboard/settings` → `Ganancias` tab if needed).
  2. Open `/dashboard/earnings`.
  3. Locate the `Pendiente` KPI card.
- **What to confirm:**
  - Helper note under the value reads **`En revision por administracion`**.
  - Old string `En validacion por PM` no longer appears anywhere on the page.
- **Expected outcome:** the actor + workflow described matches reality (admin credits + consolidate routine), not the previous PM-validation misframing.
- **Status:** **PASS** (2026-05-14)
- **Notes / screenshot:** validated as `admin@noon.app`; helper note rendered the new string; no occurrence of the old `En validacion por PM` string on the page.

---

### Scenario 2 — F-V11: Pipeline empty-column state

- **What to do:**
  1. Log in as any seller (`juan@noon.app`) or admin.
  2. Open `/dashboard/pipeline`.
  3. Identify a kanban column with zero leads (move a card out if needed to create an empty one).
- **What to confirm:**
  - Empty column renders an `Inbox` icon + title `Sin leads` + description `Arrastra un lead a esta etapa.` (min height ~120px).
  - Old terse `Vacío` string is gone.
  - Drag a card over the empty column — the cell switches to the `Suelta aquí` drop-target hint (preserved verbatim, ~80px height) while hovering.
  - Drop the card or move the pointer away — the rich empty state returns.
- **Expected outcome:** matches the projects kanban's richer empty state pattern; drag-over visual unchanged.
- **Status:** **PASS** (2026-05-14) — with scope expansion folded into closure (see "Validation finding folded into closure" below)
- **Notes / screenshot:** initial validation showed the new visual empty state correctly (Inbox icon + `Sin leads` + `Arrastra un lead a esta etapa.`), but surfaced a **pre-existing limitation**: drops into truly-empty columns silently failed because the kanban-board component never registered columns as `useDroppable` — only cards via `useSortable` — so the `closestCorners` collision detection never resolved to an empty column. Fix folded into the same iteration closure: `useDroppable({ id: column.id })` on the column container + collision detection swapped from `closestCorners` to a `pointerWithin` → `rectIntersection` fallback pattern. After the fix, dropping into an empty column shows `Suelta aquí` while hovering and accepts the drop (column counter 0 → 1). Card-to-card drag in populated columns continues to work normally.

---

### Scenario 3 — F-V13: Lead detail Propuesta empty state + section rename

- **What to do:**
  1. Log in as a seller (`juan@noon.app`) or admin.
  2. Open a lead detail for a lead with **zero** proposals (use `/dashboard/leads?leadId=<uuid>` to deep-link if needed, or create a fresh lead).
  3. Switch to the `Propuesta` tab.
- **What to confirm:**
  - Section header reads **`Propuestas`** (no longer `Hand-off comercial`).
  - Empty body reads **`Todavia no creaste una propuesta para este lead. Usa el formulario de arriba para guardar la primera.`**.
  - Old string `Aun no hay propuestas persistidas para este lead.` is gone.
  - The form to create a proposal still renders above the empty state.
  - No regression on a lead WITH proposals — pick a populated lead and confirm the proposal cards render unchanged.
- **Expected outcome:** first-time operators see a wayfinding hint, not internal-jargon language.
- **Status:** **PASS** (2026-05-14)
- **Notes / screenshot:** section header renders `Propuestas` (not `Hand-off comercial`); empty body renders the new wayfinding hint; populated-proposals path unchanged when checked against a lead with existing proposals.

---

### Scenario 4 — F-V18: Sidebar group restructure

- **What to do:**
  1. Log in as any role.
  2. Inspect the sidebar (any dashboard route works — the sidebar is global).
- **What to confirm:**
  - Workspace group (top group with `Dashboard`, `Actualizaciones`, `Notificaciones`) now ALSO contains `Reportes` as the fourth item (after `Notificaciones`).
  - `Finanzas` group has exactly three items: `Creditos`, `Earnings`, `Recompensas`. The green section color marker is preserved.
  - Navigation to `/dashboard/reports` still works from the new sidebar location.
- **Expected outcome:** `Reportes` correctly framed as a read-only operational surface, not a personal-money one.
- **Status:** **PASS** (2026-05-14)
- **Notes / screenshot:** workspace group renders the 4-item list ending in `Reportes`; `Finanzas` group renders exactly the 3 personal-money items; `/dashboard/reports` navigation works from the new location.

---

### Scenario 5 — F-V19: Role-aware `Mis tareas` quick action

- **What to do:**
  1. Log in as `admin@noon.app` (or `ana@noon.app` as pm).
  2. Open `/dashboard`.
  3. Inspect the `Acciones rapidas` block — locate the quick-action card linking to `/dashboard/tasks`.
- **What to confirm (admin / pm in supabase):**
  - Label reads **`Tareas del equipo`** — matches the sidebar relabel for these roles.
- **Then:**
  4. Log out, log in as `pedro@noon.app` (developer).
  5. Open `/dashboard` again, inspect the same quick-action card.
- **What to confirm (developer in supabase):**
  - Label reads **`Mis tareas`**.
- **Mock-mode regression check (optional):**
  6. Toggle `NOON_ENABLE_SUPABASE_AUTH="false"` (or use whichever mock user the dev runtime supports), reload.
  7. Confirm the label reads `Mis tareas` regardless of role (mock branch unchanged).
- **Expected outcome:** quick action agrees with the sidebar's role-aware label.
- **Status:** **PASS** (2026-05-14) — for both admin/pm and developer paths
- **Notes / screenshot:** admin path validated and shows `Tareas del equipo`; developer path validated and shows `Mis tareas`. Mock-mode regression check skipped (covered by existing unit test in `tests/lib/dashboard-selectors.test.ts`).

---

### Scenario 6 — F-V20: Login third value-prop block

- **What to do:**
  1. Log out (or open `/` in an incognito window).
- **What to confirm:**
  - The third value-prop card (with the `TrendingUp` icon) reads:
    - Headline: **`Wallet y comisiones internas`**
    - Body: **`Balance, comisiones y créditos internos visibles para tu equipo.`**
  - Substrings `automatizados` and `sistema de puntos` no longer appear anywhere on the page.
  - The two value-prop blocks above this one are unchanged.
- **Expected outcome:** login copy describes what the runtime actually provides (wallet + commissions + credits), not aspirational automation.
- **Status:** **PASS** (2026-05-14)
- **Notes / screenshot:** logout + page reload showed the new headline + body; `automatizados` and `sistema de puntos` no longer appear anywhere on the page.

---

### Scenario 7 — F-V04: Web-analysis CTAs hidden

- **What to do:**
  1. Log in as `admin@noon.app` (or any role with access to web-analysis).
  2. Open `/dashboard/web-analysis`.
  3. Submit a URL for analysis (or load a cached/previous analysis result).
- **What to confirm:**
  - Analysis result card renders normally (summary, scoring, opportunities list, pricing block — all the content above the deleted strip).
  - **No** `Abrir en Maxwell` button.
  - **No** `Crear Lead desde análisis` button.
  - **No** `<Separator />` divider where the action strip used to be — the page ends cleanly with the analysis card.
- **Expected outcome:** the false-action CTAs that landed users on `/dashboard/leads` with query params nothing reads are gone; the analysis content itself is preserved.
- **Status:** **PASS** (2026-05-14)
- **Notes / screenshot:** analysis result card renders preserved; no `Abrir en Maxwell` or `Crear Lead desde análisis` buttons; no leftover `<Separator />` at the end of the page.

---

### Scenario 8 — F-V05: Maxwell-on-Propuesta hidden in supabase

- **What to do:**
  1. Log in as a supabase user (`juan@noon.app`).
  2. Open any lead detail.
  3. Switch to the `Propuesta` tab.
  4. Locate the `Propuestas` section header (renamed under F-V13).
- **What to confirm:**
  - **No** `Generar con Maxwell` button on the right side of the section header. The header row now contains only the icon + label.
  - The `IA Asistente` tab still renders its existing non-operational state (this rule is unchanged).
  - Open the same lead in mock mode (if available) — the button was already hidden there per the existing `isSupabaseMode &&` gate, so no regression should appear.
- **Expected outcome:** both AI surfaces in `lead-detail.tsx` now agree: non-operational in supabase mode, consistent with operating rule line 387 of `core.md`.
- **Status:** **PASS** (2026-05-14)
- **Notes / screenshot:** Propuesta tab section header `Propuestas` renders with only the icon + label on the left; no `Generar con Maxwell` button on the right; `IA Asistente` tab unchanged in its non-operational state.

---

## Validation finding folded into closure

Scenario 2 (F-V11) surfaced a real bug beyond the spec's locked visual scope. The audit's complaint was visual asymmetry between `/dashboard/pipeline` and `/dashboard/projects` empty cells; the spec asked for richer copy and an icon, which landed correctly in the impl PR. Browser validation then revealed that dropping a card into a truly-empty column had **never actually worked** — `components/kanban-board.tsx` only registered cards as droppable via `useSortable`, never the column container, so `closestCorners` collision detection had no empty-column target to resolve to. The `isOver` prop on the empty-state branch (the old `'Suelta aquí'` hint) was unreachable code.

**Fix folded into iteration closure** (same branch `feature/fase-1-ux-bundle-dia-2`, separate commit on top of the bundle impl):
- Added `useDroppable({ id: column.id })` to `KanbanColumnComponent` and attached `setNodeRef` to the column outer wrapper so dnd-kit can resolve `over.id` to the column id when the cursor is inside an empty column.
- Swapped the `DndContext` collision strategy from `closestCorners` to a `pointerWithin` → `rectIntersection` fallback pattern. Rationale: `closestCorners` on a kanban where columns are much taller than cards systematically favors small cards in adjacent columns over the wide empty-column rect even when the cursor is inside the column. `pointerWithin` returns the droppable whose rect actually contains the pointer (the empty column when cursor is over it), and `rectIntersection` covers the mid-air / between-columns case so card-to-card drag in populated columns is not regressed.

**Why folded into the same iteration rather than a separate one:** the visual change in F-V11 is what made the bug operator-noticeable — without the richer empty state, an operator might not have tried to drop into an empty column. The fix is structurally part of completing the same audit finding to a working state. The scope expansion is small (~15 lines), low-risk (no cross-file changes, no contract changes, no test surface change), and the alternative — leaving the empty-column drop broken across all kanban consumers — would have re-surfaced the same complaint a sprint later.

**Tests:** `npm run typecheck`, `lint`, and `npm test` (218/218) all re-ran clean after the fix.

**Operating rule** in `project.context.core.md` for the kanban empty-column state was updated in closure to reflect both the visual contract AND the drop-target contract (see core.md Closed-in-runtime entry and the new operating rule below).

---

## Summary at validation close

| Scenario | F-V item | Status |
|---|---|---|
| 1 | F-V09 | **PASS** |
| 2 | F-V11 | **PASS** (with closure-folded fix for drop-target on empty columns) |
| 3 | F-V13 | **PASS** |
| 4 | F-V18 | **PASS** |
| 5 | F-V19 | **PASS** (both admin/pm and developer paths) |
| 6 | F-V20 | **PASS** |
| 7 | F-V04 | **PASS** |
| 8 | F-V05 | **PASS** |

Overall verdict: **PASS**

8/8 in-scope scenarios PASS. One scope expansion folded into the same iteration closure (kanban drop-target fix surfaced by Scenario 2's deeper validation). No deferred deviations.
