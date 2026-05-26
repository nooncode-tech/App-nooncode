# Closure drafts — FASE 1 UX honesty bundle (2026-05-14)

> **NOT COMMITTED.** This file lives in `docs/handoffs/` which is untracked. Once the browser pass is done with all 8 scenarios PASS (or with FAIL evidence to address), I apply the relevant blocks below to the real files and open the closure PR. Drafts assume PASS; FAIL would force scope re-decision.

## Closure plan

1. Pedro fills in `docs/validations/Browser validation 2026-05-14 — fase-1 UX honesty bundle.md` with PASS/FAIL per scenario.
2. I apply the blocks below verbatim to:
   - `docs/context/project.context.core.md` (Closed-in-runtime entry + 5 new operating rules)
   - `docs/context/project.context.history.md` (Session note appended)
   - `C:\Users\pbu50\Desktop\Noon App\roadmap\NoonApp Roadmap.md` (§17 snapshot rewritten)
3. I stage:
   - The two context files
   - The roadmap (Desktop path — outside repo, separate edit)
   - The filled-in validation file at `docs/validations/Browser validation 2026-05-14 — fase-1 UX honesty bundle.md`
4. I delete this drafts file (or leave it untracked indefinitely — it's `.handoffs/`, doesn't pollute git).
5. I open the closure PR against `develop` from a new branch `chore/fase-1-ux-bundle-closure` (mirrors the F-V03 closure PR #40 pattern — separate from the impl PR #41 so each has a clean review unit).

---

## Block 1 — `core.md` Closed-in-runtime entry

Inserted as a new bullet **immediately after line 372** (the F-V03 closure entry), before the existing B14 entry. Single line, follows the existing style:

```markdown
- Closed in runtime: FASE 1 UX honesty bundle — F-V04/05/09/11/13/18/19/20 (2026-05-14, fourth FASE 1 iteration). Single Bugfix Lite pass against `specs/fase-1-ux-honesty-bundle.md`: six copy / label / empty-state honesty fixes plus two hide decisions. F-V09 renames the `Pendiente` earnings helper to `En revision por administracion` (admin, not PM, credits + consolidates). F-V11 enriches the per-column empty state in `components/kanban-board.tsx` for `/dashboard/pipeline` (Inbox icon + `Sin leads` + `Arrastra un lead a esta etapa.`) while preserving the `Suelta aquí` drop-target hint verbatim. F-V13 renames the lead detail Propuesta section from `Hand-off comercial` to `Propuestas` and rewrites the empty body as a wayfinding hint to the form directly above. F-V18 moves `Reportes` from the `Finanzas` sidebar group into the workspace group after `Notificaciones`; `Finanzas` keeps only the three personal-money surfaces (`Creditos`, `Earnings`, `Recompensas`). F-V19 inlines the existing `authMode === 'supabase' && user.role !== 'developer'` check at `app/dashboard/page.tsx` so the `Mis tareas` quick action label agrees with the sidebar (`Tareas del equipo` for admin/pm in supabase, `Mis tareas` otherwise). F-V20 rewrites the login third value-prop block to `Wallet y comisiones internas` / `Balance, comisiones y créditos internos visibles para tu equipo.` — drops the dishonest `Sistema de puntos y pagos automatizados` claim. F-V04 deletes the two `/dashboard/web-analysis` CTAs (`Abrir en Maxwell`, `Crear Lead desde análisis`) that built query strings (`maxwell|msg|newLead|company|notes`) the leads page does not parse — wiring path explicitly deferred; the analysis result card above remains untouched. F-V05 hides the `Generar con Maxwell` button in `supabase` on the Propuesta tab to align both AI surfaces in `components/lead-detail.tsx` with the existing operating rule that frames `IA Asistente` as non-operational; the now-orphan `setShowMaxwellDialog` setter, dialog mount, and `MaxwellChat`/`Dialog` imports were removed under the same change. 7 source files. +36 / −80 net. No new deps, no env vars, no migrations, no backend changes. `npm run typecheck` / `lint` / `build` clean; `npm test` 218/218 (no new tests — pure copy / label / empty-state / hide changes). Browser validation 2026-05-14 confirmed all 8 scenarios PASS — full evidence in `docs/validations/Browser validation 2026-05-14 — fase-1 UX honesty bundle.md`. Merged via PR #41 (impl) + PR #<TBD> (closure).
```

> **TBD placeholder:** I replace `#<TBD>` with the actual closure PR number once it's opened. If any scenario was FAIL/PARTIAL during the browser pass, that gets a one-line caveat appended before the merge sentence.

---

## Block 2 — `core.md` Operating rules

The bundle leans on existing rules. Six **new** rules are added (one per item that bound future behavior). Inserted at the end of the Operating rules section (currently line 405, before `Do not mark Phase 1 complete...` at line ~404 — append in the natural cluster between line 387 and the closing Phase-1 rules). Final exact line numbers depend on the file at apply-time; the inserted block is contiguous and self-explanatory.

```markdown
- Treat `/dashboard/earnings` `Pendiente` bucket helper copy in `supabase` as `En revision por administracion` — the actor is admin (not PM) and the action is the manual credit + consolidate routine; do not reintroduce `En validacion por PM` or any other PM-validation wording until a real PM-validation step is added to the earnings lifecycle.
- Treat `/dashboard/pipeline` per-column empty cells as the richer `Empty` component (`Inbox` icon + `Sin leads` + `Arrastra un lead a esta etapa.`) consumed via the shared `components/kanban-board.tsx`; the `isOver` drop-target hint (`Suelta aquí`) must be preserved verbatim. Do not regress to the terse `Vacío` placeholder.
- Treat the `components/lead-detail.tsx` Propuesta-tab section header as `Propuestas`, not `Hand-off comercial`; the `Hand-off comercial` term is internal vocabulary not user-facing in this tab. Do not reintroduce a `Generar con Maxwell` CTA on this tab in `supabase` mode — both AI surfaces in this component must agree with the existing `IA Asistente` non-operational rule until contextual Maxwell wiring is real.
- Treat the `components/app-sidebar.tsx` `Finanzas` group as personal-money surfaces only (`Creditos`, `Earnings`, `Recompensas`). `Reportes` lives in the workspace group with `Dashboard`, `Actualizaciones`, `Notificaciones` because it is a read-only operational view; do not reintroduce `Reportes` under `Finanzas`.
- Treat the `Mis tareas` quick action label in `app/dashboard/page.tsx` as role-aware in `supabase`: `Tareas del equipo` for non-developer roles (admin / pm / sales_manager / sales), `Mis tareas` for developer or any user in `mock`. Use the existing inline pattern (`authMode === 'supabase' && user.role !== 'developer'`); do not introduce a separate role helper just for this label.
- Treat the `/dashboard/web-analysis` analysis-result surface in `supabase` as read-only (no follow-up CTAs) until a prefilled-dialog contract on `/dashboard/leads` exists; do not reintroduce `Abrir en Maxwell` or `Crear Lead desde análisis` buttons that build query strings the leads page does not parse.
- Treat the `app/page.tsx` login value-prop copy as honesty-first pre-launch: do not promise automated payouts, automated points-store fulfillment, or any productized rewards system. The third value-prop block must describe what the runtime actually exposes (wallet + commissions + internal credits) per the F-V20 chosen wording until a real payout / points system is shipped.
```

> Seven rules total — F-V19's role rule is new even though the sidebar already had analogous behavior; explicit duplication here prevents future drift in the dashboard surface.

---

## Block 3 — `history.md` Session note

Appended after the F-V03 session note (line 2187). Mirrors the F-V03 format used at lines 2147+.

```markdown

## Session note: FASE 1 UX honesty bundle — F-V04/05/09/11/13/18/19/20 (FASE 1 fourth iteration)
- Date: 2026-05-14
- Iteration id: `fase-1-ux-honesty-bundle`
- Route used: system-router -> system-analysis -> system-frontend -> system-testing -> system-validator -> system-docs
- Objective: close 8 UX findings from the 2026-05-10 audit (`NoonApp UX findings 10-05-2026.md`) in a single Bugfix Lite pass. Six items are pure copy / label / empty-state honesty fixes (F-V09 earnings helper, F-V11 pipeline empty cells, F-V13 lead-detail Propuesta empty state, F-V18 sidebar group restructure, F-V19 role-aware quick action label, F-V20 login copy). Two items are hide-or-wire decisions on contradictory CTAs (F-V04 web-analysis CTAs build dead query strings; F-V05 Maxwell-on-Propuesta contradicts the IA Asistente non-operational rule). Router pre-decided hide-not-wire as the default for both.
- Spec landed: `specs/fase-1-ux-honesty-bundle.md` (Approved 2026-05-14 via PR #41, commit `9768642`).
- Implemented (PR #41, commit `41b550a`):
  - `app/dashboard/earnings/page.tsx` — `metric-note` under `Pendiente` rewritten as `En revision por administracion`. Diacritics-free to match the surrounding strings (`En disputa o retencion`, `Consolidado y listo`).
  - `components/kanban-board.tsx` — `isOver` branch preserved verbatim (`Suelta aquí` drop-target hint, same 80px height); default branch replaced with the `Empty` component pattern (`min-h-[120px]`, `Inbox` icon, `Sin leads` title, `Arrastra un lead a esta etapa.` description). Affects only `/dashboard/pipeline`; `/dashboard/projects` builds its own kanban inline and is untouched.
  - `components/lead-detail.tsx` — Propuesta tab section header `Hand-off comercial` → `Propuestas`. Empty body `Aun no hay propuestas persistidas para este lead.` → `Todavia no creaste una propuesta para este lead. Usa el formulario de arriba para guardar la primera.`. F-V05 removed the `Generar con Maxwell` button (only call site of `setShowMaxwellDialog`); after the button was deleted the state setter, the `Dialog`/`DialogContent` mount at line 2001-2012, and the `MaxwellChat` + `Dialog`/`DialogContent` imports all became orphaned and were removed under the same change. `Sparkles` import preserved — still used by the `IA Asistente` tab.
  - `components/app-sidebar.tsx` — `Reportes` moved from `financeNavItems` (now 3 items) into `workspaceNavItems` (now 4 items, appended after `Notificaciones`). `BarChart3` icon import preserved (still referenced).
  - `app/dashboard/page.tsx` — `Mis tareas` quick action label inlines `authMode === 'supabase' && user.role !== 'developer'` → `Tareas del equipo` vs `Mis tareas`. Same inline pattern the sidebar already uses; no new helper. `user` is non-null inside the render path (guarded by the existing `if (!user) return null` early return at line 115).
  - `app/page.tsx` — third value-prop block rewritten (`Comisiones y recompensas` → `Wallet y comisiones internas`; `Sistema de puntos y pagos automatizados para todo el equipo` → `Balance, comisiones y créditos internos visibles para tu equipo.`). The `TrendingUp` icon and surrounding markup unchanged.
  - `app/dashboard/web-analysis/page.tsx` — Deleted the `<Separator />` and the entire action-strip `<div>` containing both CTAs (lines 300-336 in pre-change layout). Dropped now-unused imports: `Separator` (from `@/components/ui/separator`), `Sparkles` and `ArrowRight` (from `lucide-react`). All other lucide imports still referenced elsewhere in the file.
- Scope boundary kept:
  - no migrations
  - no API route changes
  - no contract changes (no shape change to `/api/wallet`, `/api/leads`, `/api/notifications`, or any other endpoint)
  - no new dependencies
  - no new env vars
  - no new tests (pure copy / label / empty-state / hide changes; optional F-V11 smoke unit test skipped because the repo's test runner is `tsx --test` without jsdom and adding component-test infrastructure would expand scope)
  - no edits to any operating rule in `core.md` lines 376-405 (the bundle leans on existing rules; new rules are appended, none weakened)
- Validation outcome:
  - `npm run typecheck`: clean
  - `npm run lint`: clean
  - `npm run build`: clean (Compiled successfully in 28.7s)
  - `npm test`: **218/218 pass** (no regression from F-V03 baseline; no new tests added)
  - Browser validation 2026-05-14 — full evidence in `docs/validations/Browser validation 2026-05-14 — fase-1 UX honesty bundle.md`:
    - Scenario 1 (F-V09 earnings helper): PASS — `Pendiente` reads `En revision por administracion`; old PM-validation copy gone.
    - Scenario 2 (F-V11 pipeline empty cells): PASS — Inbox icon + `Sin leads` + `Arrastra un lead a esta etapa.` rendered; `Suelta aquí` hint still appears on drag-over.
    - Scenario 3 (F-V13 Propuesta empty state): PASS — section header `Propuestas`; empty body uses the new wayfinding hint; populated proposals path unchanged.
    - Scenario 4 (F-V18 sidebar restructure): PASS — `Reportes` under workspace group after `Notificaciones`; `Finanzas` has exactly 3 items.
    - Scenario 5 (F-V19 role-aware label): PASS — admin/pm in supabase see `Tareas del equipo`; developer in supabase sees `Mis tareas`; mock-mode unchanged.
    - Scenario 6 (F-V20 login copy): PASS — new headline + body rendered; no `automatizados` / `sistema de puntos` substring anywhere.
    - Scenario 7 (F-V04 web-analysis hide): PASS — analysis result card preserved; both CTAs gone; no leftover `<Separator />`.
    - Scenario 8 (F-V05 Maxwell-on-Propuesta hide): PASS — no `Generar con Maxwell` button on the Propuesta tab in supabase; mock-mode unchanged; `IA Asistente` tab still in its existing non-operational state.
- Operating rules added in this closure (in `project.context.core.md`):
  - `Pendiente` earnings helper copy
  - pipeline kanban empty-cell pattern
  - lead-detail Propuesta tab section header + Maxwell-CTA agreement
  - sidebar `Finanzas` membership
  - dashboard `Mis tareas` quick action role-awareness
  - web-analysis read-only analysis surface until prefilled-dialog contract exists
  - login value-prop honesty-first pre-launch
- Docs updated:
  - `project.context.core.md` (Closed-in-runtime entry + 7 new operating rules)
  - `project.context.history.md` (this session note)
  - local NoonApp Roadmap §17 (snapshot rewritten for 2026-05-14 closure of the UX bundle)
- Completion status:
  - FASE 1 UX honesty bundle closed. FASE 1 fourth iteration COMPLETE.
  - next FASE 1 iteration candidates (per roadmap §17): (a) provisioning Upstash via Vercel Marketplace + B14 production verification, (b) `fase-0-b4b-ledger-reconciliation` for the broader G7 desync, (c) B1 Stripe live keys + ADR-010 cleanup in `app/api/payments/checkout/route.ts`.
```

---

## Block 4 — Roadmap §17 snapshot rewrite

Replaces the current `### Snapshot 2026-05-14 (cierre F-V03 + materialización G7 resuelta OOB)` section (lines 597-655 in the roadmap file). New section title: `### Snapshot 2026-05-14 (cierre UX honesty bundle FASE 1 Día 2)`.

```markdown
### Snapshot 2026-05-14 (cierre UX honesty bundle FASE 1 Día 2)

**Lo que se hizo en esta sesion:**

- **UX honesty bundle cerrado end-to-end** (FASE 1 cuarta iteración). 8 hallazgos del audit 2026-05-10 (`NoonApp UX findings 10-05-2026.md`) cerrados en una sola Bugfix Lite pass contra `specs/fase-1-ux-honesty-bundle.md`. Seis copy / label / empty-state honesty fixes (F-V09 earnings helper "En revision por administracion", F-V11 pipeline empty-cells enriched, F-V13 lead-detail Propuesta tab renamed + wayfinding empty body, F-V18 Reportes movido a workspace sidebar group, F-V19 Mis tareas quick action role-aware, F-V20 login third value-prop "Wallet y comisiones internas") más dos hide decisions (F-V04 web-analysis CTAs muertas removidas; F-V05 Generar con Maxwell button removido en supabase para alinear con la operating rule de IA Asistente non-operational).
- **7 source files modificados, +36 / -80 net.** Ningún cambio backend, migración, contrato, env var, ni dependencia. `npm test` se mantuvo en **218/218**. Spec aterrizó como commit doc separado (`9768642`); impl como `41b550a`.
- **PR #41 abierto contra develop.** Browser validation 2026-05-14 confirmó los 8 escenarios PASS — evidencia completa en `docs/validations/Browser validation 2026-05-14 — fase-1 UX honesty bundle.md`. Closure PR pendiente con `core.md` + `history.md` + este §17 + validation evidence file.
- **7 nuevas operating rules** agregadas a `core.md` (no se eliminó ni debilitó ninguna existente): `Pendiente` earnings helper, pipeline kanban empty-cell pattern, Propuesta tab section header + Maxwell-CTA agreement, sidebar `Finanzas` membership, dashboard quick action role-awareness, web-analysis read-only until prefilled-dialog contract, login honesty-first pre-launch.

**Pendiente al iniciar proxima sesion:**

1. **Mergear PR #41 (impl)** y el closure PR que sigue (CI verde necesario para ambos).
2. **Provisionar Upstash en Vercel Marketplace** (~5-10 min ops). Vercel Dashboard → Storage → Add → Upstash → Upstash Redis. Auto-inyecta `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` en Production + Preview. Sigue siendo el closure pendiente de B14.
3. **Verificación producción B14**: rapid requests contra endpoint rate-limited → esperar HTTP 429 cluster-wide + logs Vercel sin `rate_limit.upstash.fallback`.
4. **Próxima iteración FASE 1**: decisión del usuario entre 3 paths (cualquier orden es defensible):
   - **(a)** `fase-0-b4b-ledger-reconciliation` para cerrar G7 completo (backend-heavy 1-2 días). Prioridad bumped desde 2026-05-14 cuando G7 se materializó como bug funcional en F-V03 Scenario 1.
   - **(b)** B1 — Stripe live keys cutover + cleanup de la violación ADR-010 en `app/api/payments/checkout/route.ts`. 1-2 días + coordinación con NoonWeb por el cross-repo payment path.
   - **(c)** Tier 3 audit items (F-V06 prototype embed, F-V07 notification preferences disclaimer, F-V08 stripe checkout link persistence). Frontend-medium, 2-3 días.

**Gaps abiertos al cerrar sesion:**

| ID      | Resumen                                                                         | Bloqueo                                                                                                                           |
| ------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **G7**  | Schema↔ledger desync amplio (14 missing + 6 huerfanas + drift de tipos). Migración 0042 aplicada OOB 2026-05-14; resto sigue abierto. | Prioridad **bumped** desde 2026-05-14 a "scheduled before next code-level migration push to remote". Iteración dedicada: `fase-0-b4b-ledger-reconciliation`. |
| **G8**  | Plan-refs en `scripts/check-migrations.mjs` (`R1.1 (Sprint 2)`, `pending R1.1`) | No bloqueador. PR de cleanup simple cuando convenga.                                                                              |
| **G10** | Selector seller fee no persiste valor entre saves consecutivos                  | UX, no funcional. Diferido a iteracion UX post-cutover.                                                                           |
| **B14-ops** | Upstash provisioning + production verification                              | Ops del usuario, 5-10 min Vercel + 15 min smoke test. Iteración B14 closure pendiente de esa evidencia.                            |

**Bloqueadores criticos restantes:**

| ID     | Resumen                                                                      | Decision pendiente                                                                              |
| ------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **B1** | Stripe live keys + cutover real                                              | Recon 2026-05-13 reveló violación ADR-010 (`app/api/payments/checkout/route.ts` crea Checkouts en App). Plan A/B/C documentado. Decisión usuario: cuándo atacar el cleanup. |
| **B2** | Bridge wallet 1:1 (credits ↔ USD)                                            | Cerrado conceptualmente por ADR-009 (freeze permanente); retiro completo deferido a antes de v3 Phase 8. No bloquea FASE 1.   |
| **B5** | Sentry / observabilidad alertable                                            | Deferido per PR #30. Operator-in-the-loop como mitigación. Re-evaluable antes de exposición a clientes externos.   |

**Siguiente paso natural recomendado al iniciar proxima sesion:**

1. **Mergear PR #41 + closure PR del UX bundle** (CI verde) — cierra la cuarta iteración FASE 1 y libera la branch para nuevo trabajo.
2. **Decisión usuario entre (a)/(b)/(c)** de la lista de arriba. La sesión 2026-05-13 sugirió que el bundle (esta sesión) iba antes de G7. Con el bundle cerrado, el orden natural ahora es: Upstash provisioning + B14 verification (operator-side, 5-10 min) ANTES de cualquier path largo, después decidir entre G7 y B1.
3. **FASE 1 status**: ~75% cerrada. B18 (error pages), B14 (rate limiter Upstash), F-V03 (wallet chip), UX bundle — 4 de las ~6 iteraciones planeadas en roadmap §5 están done. Quedan B1 (Stripe cutover) y opcional FASE 1 Día 5 buffer (ya absorbido por este bundle vía F-V04/V05).

**Landmines operacionales a tener en cuenta:**

- **Tests count baseline**: 218 al cerrar sesion (sin cambio respecto del cierre F-V03; el bundle no agregó tests porque son cambios de copy / hide). Si baja, hay regresión.
- **G9 sigue activa como convención**: PRs encadenadas (`base != develop`) deben revisarse manualmente o abrirse con `base = develop` desde el inicio.
- **Turbopack OOM** sigue observable en `D:\` filesystem (registrado 2026-05-13 durante B18 validation, sin recurrencia documentada en F-V03 ni en este bundle). Mitigaciones registradas: `--no-turbopack`, más memoria Node, mover `.next/dev` a SSD local.
- **B14 fail-open silencioso**: si Upstash exhauste free tier (10K commands/día), el limiter degrada a in-memory sin alertar fuera de `logger.warn`. Monitorear command count en Upstash dashboard; trigger de upgrade a ~70% del cap mensual.
- **MCP Supabase auth**: la sesión del auth de Supabase MCP expira eventualmente. Re-autenticar al inicio de cada sesión si se necesita acceso al ledger.
- **Aplicar migraciones OOB vía MCP es seguro solo cuando son additive/idempotentes**. Para futuras migraciones de G7 que tengan cambios destructivos o tabla state, NO usar `apply_migration` OOB — esperar a la iteración `fase-0-b4b-ledger-reconciliation` con plan completo.
- **Hide-not-wire defaults**: F-V04 y F-V05 quedaron hidden, no wired. Si en una iteración futura el equipo decide cablear (prefilled-dialog en /dashboard/leads para F-V04, contextual Maxwell para F-V05), las paths de wiring están documentadas verbatim en el spec (`specs/fase-1-ux-honesty-bundle.md` §Out-of-scope).

**Referencias docs producidos en esta sesion:**

- `specs/fase-1-ux-honesty-bundle.md` (mergeado PR #41)
- `docs/validations/Browser validation 2026-05-14 — fase-1 UX honesty bundle.md` (template llenado con evidencia 8 scenarios; commit en closure PR)
- `docs/context/project.context.core.md` (Closed-in-runtime entry + 7 nuevas operating rules)
- `docs/context/project.context.history.md` (session note completo)
- este roadmap §17 (este snapshot)
- 7 source files con +36 / -80 net (lista en el body del PR #41)
```

---

## Apply order at closure

Once the 8 scenarios are all PASS:

1. Apply Block 1 + Block 2 to `D:\Pedro\Proyectos\Noon\App-nooncode\docs\context\project.context.core.md`. Single Edit per block, inserted at the right offset (Block 1 after line 372; Block 2 inside Operating rules, append before the Phase-1-completion rules at the bottom).
2. Apply Block 3 to `D:\Pedro\Proyectos\Noon\App-nooncode\docs\context\project.context.history.md` — single Edit, append at end of file.
3. Apply Block 4 to `C:\Users\pbu50\Desktop\Noon App\roadmap\NoonApp Roadmap.md` — replace the existing §17 snapshot section (currently at lines 597-655 of the roadmap file).
4. Update validation evidence file: replace each `PENDING / **PASS** / FAIL — (fill)` with the actual outcome; fill the summary table at the bottom.
5. Create new branch `chore/fase-1-ux-bundle-closure` from `feature/fase-1-ux-bundle-dia-2` (or from `develop` after PR #41 merges — TBD when closure happens).
6. Commit: `docs(fase-1-ux-bundle): iteration closure — validation evidence + context updates`. Include the validation evidence file, both context files, AND delete this drafts file (or leave it untracked — `docs/handoffs/` is permanent).
7. Push, open closure PR against `develop` with summary citing PR #41 as the impl half.

If any scenario was FAIL/PARTIAL, the drafts above need surgical edits before applying — specifically:
- Drop the affected line from Block 1 (Closed-in-runtime entry).
- Drop the corresponding rule from Block 2.
- Add a Validation outcome note in Block 3 explaining what failed and what was done about it (revert? defer? folded fix?).
- Reflect in Block 4's "Pendiente al iniciar proxima sesion" list.
