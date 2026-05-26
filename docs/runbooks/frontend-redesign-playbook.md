# Frontend Redesign Playbook (optional track)

> **Status**: opcional / no agendado. Documento de referencia para cuando se decida rediseñar el frontend de NoonApp (workspace interno). NO incluye el portal cliente — ese se rige por la decisión F-10 (queda en App-nooncode hasta v3 Phase 2-6 cierre, luego migra a NoonWeb).
>
> **Última actualización**: 2026-05-22.

## Veredicto resumen

**Riesgo de romper el backend: bajo a medio**, depende de qué tan adentro entres. El backend está encapsulado detrás de un wire contract bien definido, así que un rediseño visual + UX es relativamente seguro. Lo peligroso son los rediseños que tocan la estructura de URLs, el shape de `lib/data-context.tsx`, o el access-rules layer en `lib/auth-context.tsx`.

## Las 3 capas y su nivel de exposición

| Capa | Archivos | Riesgo si la tocás |
|---|---|---|
| Componentes UI (shadcn/Radix + Tailwind v4) | `components/*`, `app/globals.css` | **Muy bajo** — son hojas. Reemplazar el sistema visual no toca backend. |
| Selectores + view-models | `lib/dashboard-selectors.ts`, `lib/leads/*`, `lib/projects/*`, `lib/tasks/*` | **Bajo** — pure functions sobre wire types. Cambiar shape de la vista no rompe nada server-side, pero rompés unit tests que pivotean sobre estos. |
| Data context (cliente) | `lib/data-context.tsx` (~1970 líneas) | **Medio** — es el API surface real del frontend. Si lo reescribís, hay que mantener los mismos endpoints/payloads o coordinar cambios server-side. |
| URL structure + access rules | `proxy.ts` (middleware), `lib/auth-context.tsx` (`dashboardRouteAccessRules`), `lib/dashboard-navigation.ts` | **Alto** — el middleware bloquea por prefix. Cambiar rutas requiere actualizar middleware + access rules + sidebar + deep-link helpers en sincronía. |
| API routes + wire contracts | `app/api/**`, `lib/server/**`, tipos `*Wire` | **Crítico** — si los tocás, rompés cross-repo (NoonWeb consume `inbound-proposal` + `payment-confirmed`), webhooks Stripe, RLS policies, state machines. Pero **no necesitás tocarlos para un rediseño visual**. |

## Las 3 cosas que sí rompen backend

1. **Cambiar URL structure** (ej. `/dashboard/leads` → `/workspace/sales`): rompe `proxy.ts` middleware + `dashboardRouteAccessRules` en `lib/auth-context.tsx` + 52 routes del auth-matrix (`docs/api-auth-matrix.md`) + bookmarks + deep-link helpers en `lib/dashboard-navigation.ts`.
2. **Cambiar shape de los `*Wire` types** (`LeadWire`, `ProjectWire`, `TaskWire`, etc. en `lib/leads/serialization.ts` + paralelos): rompe la serialización server↔client. Es contrato, no fachada.
3. **Cambiar endpoints o sus payloads** (`app/api/**`): rompe NoonWeb (8 superficies cross-repo per roadmap §11.2) + Stripe webhooks + cron jobs + cualquier consumer del auth-matrix.

## Approach recomendado (incremental, ~3 fases)

### Fase A — Design system swap (~bajo riesgo, ~1-2 semanas)

- Nuevo set de componentes UI primitives en una carpeta paralela (ej. `components/v2/*`): `Button`, `Card`, `Dialog`, `Input`, `Select`, `Table`, etc.
- Nuevo `globals.css` o `app/styles/tokens.css` con design tokens (color, type, spacing) usando Tailwind v4 `@theme` directive.
- Componentes shadcn quedan como fallback durante la transición — no se borran hasta que la última page los suelte.
- Cero cambio en data-context, selectors o rutas. Tests deberían seguir verde porque el wire contract no se toca.
- Gates: typecheck + lint + tests + visual smoke por componente.

### Fase B — Page-level redesign (~medio, ~2-3 semanas)

- Reescribís cada `app/dashboard/*/page.tsx` con la nueva UX usando los primitives `v2`.
- Mantenés `lib/data-context.tsx` intacto. Si necesitás nuevos view-models, los agregás a `lib/dashboard-selectors.ts` como funciones nuevas — no cambies las existentes hasta que todas las consumidoras migren.
- Migrá página por página: leads → projects → tasks → pipeline → earnings → settings. Cada migración es un PR independiente.
- Gates: typecheck + lint + tests + browser repro por página (golden path + dialog open/close + filtros + paginación).

### Fase C — URL/IA restructure si aplica (~alto, ~1-2 semanas)

- Solo si el rediseño exige cambiar rutas (ej. agrupar bajo `/workspace/*` o introducir tabs en lugar de sub-rutas).
- Update sincrónico en mismo PR de: `proxy.ts` middleware + `dashboardRouteAccessRules` + `lib/dashboard-navigation.ts` + sidebar + cada `redirect()` server-side.
- NoonWeb no se afecta porque las rutas internas de App no son parte del contrato cross-repo (ver `docs/integrations/cross-repo-webhook-v1.md`).
- Riesgo: bookmarks/deep-links de usuarios internos se rompen. Considerá un redirect map en middleware para los primeros ~30 días.
- Gates: typecheck + lint + tests + smoke por rol (admin/PM/dev/sales).

## Lo que NO recomiendo (anti-patterns)

- **Rediseñar y tocar `lib/data-context.tsx` en la misma pasada.** Es donde está la deuda técnica más densa (el bug G19 vivió ahí — ver `noonapp-roadmap.md` §16 G19). Hacelo en una iteración separada y aislada.
- **Agregar SWR / React Query / @tanstack en la misma pasada que el rediseño visual.** El repo intencionalmente no los usa (ver memory + grep confirmando 0 matches). Introducir uno cambia la semántica de revalidate-on-focus y puede reproducir G19 desde otro ángulo.
- **Cambiar la auth surface (Supabase SSR + middleware) mientras rediseñás.** Auth es load-bearing para FASE 1 producción ya activa. Cualquier cambio acá debe ser una iteración propia con `system-security` y `system-validator`.
- **Rediseñar `/client/[token]` portal.** Ese sale de App-nooncode en v3 Phase 2-6 per ADR-010 (decisión F-10). No invertir UX trabajo ahí.
- **Tocar las pages bajo `app/api/**`.** Cualquier UI change que requiera nuevos campos o endpoints debe pasar por `system-architecture` con contract update antes — no improvisar inline.

## Checklist pre-arranque

- [ ] Decisión operator firmada: ¿es un rediseño visual o también UX/IA? (define si se queda en Fase A-B o llega a Fase C).
- [ ] Lock de los `*Wire` types como contrato cerrado durante el rediseño. Si una página nueva necesita un campo nuevo, abrir iteración separada para extender el wire (Architecture → Backend → regen types → Frontend consume).
- [ ] Branch de larga duración (`feature/frontend-redesign-vN`) con merges parciales por componente/página a la rama larga, y un merge final a `develop` por bloque cerrado.
- [ ] Browser test plan por página: golden path + dialog open/close + filtros + paginación + dark mode (cubre carry-over de B23 a11y ronda si todavía está abierta).
- [ ] Cross-repo coordinación con NoonWeb: cero — el rediseño es App-only siempre que NO toque URL structure o wire contracts.

## Referencias del repo

- `CLAUDE.md` — disciplina de agentes y session templates.
- `docs/context/project.context.core.md` — módulos confirmados y arquitectura.
- `docs/context/project.context.full.md` — contratos detallados y conventions.
- `docs/integrations/cross-repo-webhook-v1.md` — wire contract NoonApp↔NoonWeb (no tocar).
- `docs/api-auth-matrix.md` — 52 routes API + auth rules.
- `lib/data-context.tsx` — single source of truth del frontend para state remoto.
- `lib/dashboard-selectors.ts` — view-models actuales.

## Cuándo re-evaluar este playbook

- Si NoonWeb absorbe el portal cliente (decisión F-10 cierra hacia "migrate to web"): re-leer §"Lo que NO recomiendo" para confirmar que `/client/[token]` ya no se toca acá.
- Si se introduce un design system shared cross-repo: la Fase A se vuelve un swap a la lib compartida en vez de un build local.
- Si el rediseño viene acompañado de migrar a otra UI framework (ej. Mantine, MUI, custom): el playbook completo cambia — esto NO está cubierto acá y debería abrirse como su propio análisis previo.
