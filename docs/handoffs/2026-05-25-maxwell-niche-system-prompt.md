# Prompt de inicio — Maxwell Lead Engine: Sistema de Nichos

## Repo
`App-nooncode`

## Qué hacer
Implementar el sistema de nichos de negocio para el Maxwell Lead Engine según la especificación completa en `maxwell-lead-engine-niches.md`.

## Antes de escribir una sola línea de código

Lee estos archivos en este orden exacto:

1. `maxwell-lead-engine-niches.md` — especificación completa. Todo lo que necesitas está aquí.
2. `lib/server/maxwell/lead-engine.ts` — implementación actual del engine
3. `lib/server/leads/schema.ts` — schema actual de leads
4. `lib/server/leads/mappers.ts` — mappers actuales
5. `lib/server/leads/repository.ts` — repository actual
6. `lib/leads/serialization.ts` — tipos wire actuales
7. `lib/types.ts` — tipos de dominio
8. `lib/data-context.tsx` — contexto del cliente
9. `app/api/notifications/preferences/route.ts` — úsalo como patrón exacto para el nuevo endpoint de nicho
10. `app/dashboard/leads/page.tsx` — UI actual de búsqueda
11. `app/dashboard/settings/page.tsx` — settings actual
12. `components/lead-form-dialog.tsx` — formulario actual de leads

## Orden de implementación

1. **Migración SQL** — `supabase/migrations/0059_phase_23a_maxwell_niche_system.sql`
2. **`lib/server/maxwell/niches.ts`** — archivo nuevo con los datos (no tocar después)
3. **Tipos y serialización** — `lib/types.ts` → `lib/leads/serialization.ts` → `lib/server/leads/schema.ts`
4. **Mappers y repository** — `lib/server/leads/mappers.ts` → `lib/server/leads/repository.ts`
5. **Data context** — `lib/data-context.tsx`
6. **Lead Engine** — `lib/server/maxwell/lead-engine.ts`
7. **API routes** — `app/api/maxwell/lead-searches/route.ts` → `app/api/maxwell/niche-preferences/route.ts` (nuevo)
8. **UI** — `app/dashboard/leads/page.tsx` → `app/dashboard/settings/page.tsx` → `components/lead-form-dialog.tsx`

## Lo que NO debes tocar

- `lib/server/maxwell/lead-engine.ts` — el query genérico de Overpass existente debe preservarse íntegro cuando no hay nicho seleccionado
- `app/api/leads/[leadId]/route.ts` — no necesita cambios
- Cualquier archivo de tests — no modificar
- El modelo `gpt-4o-mini` en cualquier archivo que no sea `lead-engine.ts`

## Nota crítica sobre tipos

Después de crear la migración SQL, los campos nuevos (`niche_id`, `niche_ids`, `preferred_niche_ids`) **aún no existen** en `lib/server/supabase/database.types.ts`. Usa `(row as any).niche_id` donde sea necesario hasta que los tipos se regeneren. Está documentado en el `.md`.
