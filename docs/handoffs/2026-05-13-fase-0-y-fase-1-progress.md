# Handoff — FASE 0 + FASE 1 progreso al 2026-05-13

> **Snapshot:** dónde estamos al final de la sesión 2026-05-13, qué quedó merged, qué está pendiente para cerrar FASE 1 completa, y qué destraba cada bloque restante. Documento de referencia rápido — el state-of-truth detallado vive en `docs/context/project.context.core.md` + `history.md`.

---

## 1. Resumen ejecutivo

- **FASE 0 (decisiones gating + auditoría pre-cutover): cerrada al 85%.** Las 7 decisiones §2 + 3 de 4 decisiones cross-repo §11.3 firmadas como ADRs. Quedan 3 ítems operacionales (B13 leaked-password, B28 plan Supabase, B29 Vercel env audit) y branch protection en `master`. No bloquean código.
- **FASE 1 (cutover pilot interno): cerrada al ~30%.** B18 (error pages) closed end-to-end; B14 (rate limiter Upstash) implementation merged y esperando provisioning de Upstash en Vercel + production verification. B1 (Stripe live keys) parqueado hasta resolver violación de ADR-010 con Checkout-en-App. UX honesty bundle + runbook pendientes.
- **Tests baseline:** 210/210 pass. Build clean en Vercel. Sin observability alertable activa (decisión consciente — operator-in-the-loop).

---

## 2. Lo que hicimos en esta sesión

Cronológicamente, ordenado por PR mergeada.

### PR #29 — Backfill de session notes B3 + B4 en history.md + full.md
- `docs/context/project.context.history.md`: dos Session notes para B4 (ADR-006 migration reconciliation) y B3 (seller-fee state machine 5 chunks).
- `docs/context/project.context.full.md`: nueva sección "Confirmed seller-fee state machine slice".
- Cerró drift entre `core.md` (que sí tenía las cierres) y los layers `full`/`history` que se habían quedado atrás.

### PR #30 — Registrar deferral de observabilidad alertable
- Active risk explícito en `core.md`: FASE 1 opera sobre Vercel native logs (Dashboard + `vercel logs` CLI). Sin alertas push (Slack/email) para 5xx en webhooks. Operator-in-the-loop como mitigation.
- Decisión consciente; re-evaluable cuando llegue tráfico real / exposición a clientes externos.

### PR #31 — 5 ADRs cerrando FASE 0 gating decisions (§2 + §11.3)
- `ADR-008` (operación interna + equipo variable) — §2 #1 + #7
- `ADR-009` (bridge wallet freeze permanente) — §2 #3
- `ADR-010` (portal cliente vive en NoonWeb) — §2 #4 + §11.3 #8 + #9. **Cierra audit F-10.**
- `ADR-011` (AI MVP pipeline en Vercel + cron + queue, budget deferido) — §2 #5 + #6 + §11.3 #11
- `ADR-012` (NoonWeb único owner de email cliente) — §11.3 #10
- Plus update en `full.md` con la sección "Confirmed client-facing architecture (App / portal / MVP three-entity model)".

### PR #32 — B18 spec (analysis output)
- `specs/fase-1-b18-error-pages.md`: scope completo de los 4 archivos framework de Next.js que faltaban.

### PR #33 — B18 implementation (error pages)
- `app/not-found.tsx` (Server Component, 404 branded con auth-aware CTA)
- `app/error.tsx` (Client Component, route-segment boundary con Reintentar)
- `app/loading.tsx` (Server Component, spinner branded lightweight)
- `app/global-error.tsx` (Client Component, fallback inline-styled cuando root layout falla)
- `tests/app/error-pages.test.ts` (4 smoke tests)
- Sin Sentry (deferred per PR #30), sin per-segment error pages.

### PR #34 — B18 validation evidence + iteration closure
- `docs/validations/Browser validation 2026-05-13 — B18 error pages.md`: 5 scenarios verificados, todos PASS (con nota: scenario 5 global-error usa Next.js dev overlay en `next dev`, visual verification de la fallback branded queda diferida a production build).
- Closed-in-runtime entry en `core.md`.
- Session note B18 en `history.md`.

### PR #35 — B14 spec (analysis output)
- `specs/fase-1-b14-rate-limiter-upstash.md`: scope del swap de in-memory a Upstash Redis vía Vercel Marketplace, con in-memory como fallback dev, fail-open policy explícita.

### PR #36 — B14 implementation (merged y pendiente de provisioning Upstash)
- Refactor `lib/server/api/rate-limit.ts` con engine pattern:
  - `inMemoryEngine` (default cuando no hay env vars Upstash)
  - `makeUpstashEngine(url, token)` (cuando los env vars están — auto-detectados)
  - `withFailOpenLogging` wrapper aislado para testabilidad
- `assertRateLimit` async ahora; los 11 callsites en 10 routes actualizados con `await`.
- 5 tests nuevos (engine injection allow/deny, fail-open swallow/rethrow, escape hatch). Total **210/210**.
- TDR-002 renombrado a `TDR-002-rate-limiting-distributed.md` y reescrito.
- `.env.example` + `scripts/validate-runtime-env.ts` + `tests/infra/env-example.test.ts` actualizados.
- Deps: `@upstash/ratelimit 2.0.8` + `@upstash/redis 1.38.0`.

---

## 3. Estado FASE 1 — bloque por bloque

El roadmap §5 estructura FASE 1 en 5 días. Mi mapping de estado a 2026-05-13:

### Día 1 — Bloqueadores operacionales

| Ítem | Estado | Notas |
|---|---|---|
| **B1** subir Stripe live keys a Vercel Production | **PARQUEADO** | Recon 2026-05-13 reveló que `app/api/payments/checkout/route.ts` crea Checkouts en App, violando ADR-010. Decisión: NO subir live keys hasta resolver esa violación (cleanup ~1-2 días + coordinación con NoonWeb). |
| Option C seller fee feature-flag | **CLOSED** | B3 ejecutó Option C completa en lugar de feature-flag (state machine de 5 estados). Cerrado 2026-05-12. |

### Día 2 — UX honestidad mínima

| Ítem | Estado | Notas |
|---|---|---|
| **F-V03** fix `lib/dashboard-selectors.ts:300-313` `selectPersonalStatsAvailability` (que lea de `/api/wallet` y `/api/rewards` reales) | PENDIENTE | Code-only, ~4h. Cierra una contradicción real: dashboard hoy muestra "no disponible" para personal stats cuando `/dashboard/earnings` ya muestra wallet monetario real. |
| **F-V09** copy "En validación por PM" → "En validación por admin" en `/dashboard/earnings:312-315` | PENDIENTE | 30 min. |
| Bundle copy **F-V11 + F-V13 + F-V18 + F-V19 + F-V20** | PENDIENTE | ~4h. Per-column empty states pipeline, copy hand-off, mover "Reportes" fuera de "Finanzas", relabel "Mis tareas" para admin/PM, login copy. |

### Día 3 — Errores + observabilidad mínima

| Ítem | Estado | Notas |
|---|---|---|
| **B18** error pages (`app/error.tsx`, `not-found.tsx`, `loading.tsx`, `global-error.tsx`) | **CLOSED** | PR #32 → #33 → #34. Validación 5/5 PASS. |
| **B5** Sentry + alertas Slack/email | **DIFERIDO** | Decisión 2026-05-13 (PR #30): operar con Vercel native logs por ahora. Re-evaluable antes de cutover real / exposición a clientes externos. |
| `docs/runbooks/cutover-pilot.md` (rollback Vercel + restore Supabase + replay webhook ledger + on-call) | PENDIENTE | ~1-2h docs. Tiene más sentido escribirlo en paralelo a B1 cuando se desbloquee (las decisiones operacionales reales aparecen durante el cutover). |

### Día 4 — Validación end-to-end pilot

| Ítem | Estado | Notas |
|---|---|---|
| Smoke test con tarjeta real (website inbound → PM queue → pago → Stripe webhook → developer asignado → earnings → withdraw via Connect) | **BLOQUEADO** | Depende de B1 cerrado (live keys + webhook live configurado). |

### Día 5 buffer

| Ítem | Estado | Notas |
|---|---|---|
| **F-V04** web-analysis CTAs muertas | PENDIENTE | 3h. Esconder o cablear. |
| **F-V05** lead detail Maxwell consistency | PENDIENTE | Detalle en `docs/audits/v3-phase-0-audit.md`. |

### Producción hardening (originalmente FASE 2 Bloque C, traído a FASE 1)

| Ítem | Estado | Notas |
|---|---|---|
| **B14** rate limiter Upstash | **MERGED, awaiting ops** | PR #35 spec + #36 implementation. Pendiente: provisioning Upstash via Vercel Marketplace (5 min ops) + production verification. |

---

## 4. ¿Cuánto falta de FASE 1?

**Si "falta" significa todos los ítems del roadmap §5 cerrados:**

| Categoría | Items | Esfuerzo | Comentario |
|---|---|---|---|
| **Liviano frontend** (F-V03 + F-V09 + bundle copy) | 6 sub-ítems | ~8h | Sin dependencias externas. Sería la próxima iteración natural. |
| **F-V04 + F-V05** (Día 5 buffer) | 2 ítems | ~4h | Sin dependencias. Puede mergearse con el bundle anterior. |
| **B14 production ops** (Upstash provisioning + verification) | 1 ítem | ~30 min ops + 30 min verify | Tuyo en Vercel Dashboard cuando convenga. |
| **Runbook** `cutover-pilot.md` | 1 doc | ~1-2h | Mejor escribirlo cuando B1 esté listo, no aislado. |
| **B1 cutover Stripe live** | 1 ítem grande | 1-2 días | Bloqueado por ADR-010 cleanup. Decisión pendiente: full removal de Checkout-en-App (Opción B del plan B1 que hablamos), o feature-flag pragmático (Opción A), o aceptar la violación (Opción C). |
| **Día 4 smoke test real** | 1 ítem | ~1-2h ops | Bloqueado por B1. |

**Total estimado:** ~3-5 días de trabajo + decisiones tuyas + provisioning ops.

**Si "falta" significa "lista para procesar dinero real":**

Es básicamente B1 cerrado + Día 4 smoke test. Todo lo demás (UX, runbook, B14 ops) es polish + hardening pero no bloquea procesar pagos.

**Mi recomendación para próxima iteración (sin B1 todavía):**

1. **Provisionar Upstash en Vercel** (5-10 min ops) + verificación rápida → cierra B14 formal.
2. **F-V03 solo** (~4h frontend) → fix funcional limpio que cierra una contradicción visible. PR único, bajo riesgo, alto valor de honestidad UX.
3. **Bundle copy F-V09 + F-V11 + F-V13 + F-V18 + F-V19 + F-V20** (~4-6h) → cleanup final UX pre-cutover. Otro PR.
4. **F-V04 + F-V05** (~4h) → buffer Día 5 + cierre cosmético.
5. **Decisión B1** (cuándo querés atacar el ADR-010 cleanup + cutover real).

Con eso FASE 1 queda al ~75% (todo menos B1 + Día 4 smoke + runbook). El último 25% es el cutover real cuando estés listo.

---

## 5. Estado de PRs y branches al cierre

**Merged a develop:**
- #29 docs hygiene history + full
- #30 observability deferral
- #31 ADRs 008-012 FASE 0 gating
- #32 B18 spec
- #33 B18 implementation
- #34 B18 validation closure
- #35 B14 spec

**Abierto, esperando merge:**
- **#36 B14 implementation** — CI verde, 210/210 tests, fail-open verificado, deps audit clean. Te queda mergearlo + provisionar Upstash + verificar producción.

**Branch local actual:** `feature/fase-1-b14-implementation` (la del PR #36). Develop al día con `1707875` antes de empezar B14.

**Tests baseline:** 210/210 (post-merge de #36 se mantiene).

---

## 6. Riesgos activos a tener presentes

Capturados en `docs/context/project.context.core.md` Active risks:

1. **Mock-only surfaces:** rewards/points + users directory en `lib/data-context.tsx:442-443`.
2. **Bridge wallet 1:1 (créditos ↔ USD):** invariante permanente per ADR-009. Retiro completo deferido a antes de v3 Phase 8.
3. **Stripe live keys NO en Vercel:** B1 parqueado.
4. **Maxwell terminology conflict:** dos módulos con marca compartida pero scope distintos.
5. **Migration prefix collisions:** convencion permanente per ADR-006 Branch B.
6. **Schema↔ledger desync (G7):** `supabase db push` no es seguro contra prod hasta reconciliación dedicada.
7. **Admin earnings consolidate UI gap:** workaround vía script.
8. **Observabilidad alertable diferida:** Vercel native logs only.
9. **Legacy `/client/[token]` en App:** deuda per ADR-010, removal scheduled cuando NoonWeb ship `/portal/[projectId]`.

Nuevos riesgos potenciales a registrar al cerrar B14 formalmente:
- Upstash free tier exhaustion silenciosa cuando llegue tráfico — operator-in-loop hasta tener alerting.
- ADR-010 violation residual en `app/api/payments/checkout/route.ts` — explicitada en spec B14 y en plan B1 deferido.

---

## 7. Decisiones pendientes del lado tuyo

Ninguna gating de iteración. Cosas estratégicas / ops que vos manejás:

- ¿Cuándo provisionás Upstash en Vercel? (5-10 min, no bloquea código)
- ¿Cuándo arrancás el cleanup ADR-010 + B1 cutover? (1-2 días + coordinación con NoonWeb cuando vos decidas)
- ¿Cerramos FASE 1 con el bundle UX honesty + F-V04/F-V05 antes de B1, o lo dejamos para después del cutover?
