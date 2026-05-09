# NoonApp Roadmap Reconciliado

> **Documento canónico de roadmap.** Reemplaza a `roadmap-v2.md` y `ROADMAP_NOON_APP.md`,
> ambos archivados en `docs/business/archive/` el 2026-05-09.
> Cualquier nueva planificación de roadmap debe ir aquí, no en los archivados.

## Base usada
- PDFs ya revisados:
  - `tmp_roadmap.txt`
  - `tmp_recap.txt`
  - `tmp_faltantes.txt`
- Contexto fuente agregado el 2026-05-04:
  - `docs/product/source/LeadEngine_Codex_FIXED.pdf`
  - `docs/product/source/NoonApp_Seller_Speech_Codex_Addendum.pdf`
  - `docs/product/maxwell-lead-engine-v1.md`
- Estado real confirmado en el repo:
  - auth/session Supabase
  - middleware de dashboard
  - perfil `user_profiles`
  - checklist QA de auth
  - fix de Gmail en Leads
  - dominio comercial ya parcialmente persistente y delivery aun mixto en `lib/data-context.tsx`

## Fases cerradas
- `Fase 1A - Auth/session Supabase`
  - Login real por Supabase
  - Sesion server-backed en `app/layout.tsx`
  - Proteccion de `/dashboard` en `proxy.ts`
  - Perfil/rol activo en `public.user_profiles`
  - Script de seed y checklist QA de runtime
- `Fase 3 - Slice cerrado en Leads`
  - Accion directa de Gmail en `components/lead-card.tsx`
  - Accion directa de Gmail en `components/lead-detail.tsx`

## Fases parciales
- `Fase 1 - Base real del sistema`
  - Cerrado:
    - cuenta real
    - login real
    - sesion real
    - base de permisos por rol en dashboard
  - Pendiente:
    - persistencia real de leads, proyectos, tareas, rewards, puntos, pagos y saldos
    - reemplazar `lib/data-context.tsx` como fuente principal del dominio
    - registro durable de acciones de negocio
  - Estado real: `PARCIAL`

- `Fase 2 - Flujo comercial real`
  - Existe UI para leads y pipeline
  - Ya existe persistencia real implementada para leads y cambios de estado
  - `DataProvider` consume `/api/leads` en modo Supabase
  - Ya existe implementacion en codigo para notas persistentes e historial durable de actividad por lead
  - Leads/pipeline y seguimiento comercial ya fueron validados en runtime en el flujo local
  - Ya existe implementacion en codigo para propuestas persistentes y hand-off comercial base por lead
  - Propuestas y hand-off comercial ya fueron validados en runtime en el flujo local
  - Ya existe implementacion en codigo para conversion explicita `lead -> proyecto`
  - La migracion `0005` ya fue aplicada al proyecto Supabase enlazado
  - La conversion `lead -> proyecto` ya fue validada en runtime
  - Ya existe implementacion en codigo para tareas persistentes ligadas a proyectos reales
  - La migracion `0006` ya fue aplicada al proyecto Supabase enlazado
  - La validacion runtime ya existe para tareas persistentes, incluyendo reflejo en `/dashboard/projects`
  - Estado real: `PARCIAL`, con `2A/2B/2C/2D/2E` cerradas en runtime

- `Fase 3 - Leads accionables y cercania`
  - Cerrado:
    - email directo por Gmail
    - telefono visible/usable en detalle
    - ficha visual del lead ya existe
    - Maxwell Lead Engine V1 ya implementa busqueda por ubicacion actual, zona manual, radio permitido por ventas/rol, coordenadas del negocio y filtro visual de cercania en `/dashboard/leads`
  - Pendiente:
    - WhatsApp directo
    - flujo explicito para oportunidad presencial
  - Estado real: `PARCIAL`

- `Fase 4 - Maxwell funcional`
  - Existe `/api/maxwell`
  - Existe `/api/maxwell/lead-searches` como entrypoint real del Maxwell Lead Engine V1 outbound para sellers
  - El motor outbound ya tiene schema/migracion, busqueda por ubicacion/zona, radio permitido, fuentes gratuitas, auditoria GPT estructurada, score minimo, dedupe, limites de batch, speech del seller, TTS/copia y feedback
  - El chat global `/api/maxwell` sigue siendo asistente general sin grounding automatico
  - Pendiente: validacion runtime fresca de `/dashboard/leads`, etapas server-streamed y analitica completa de eventos
  - Estado real: `PARCIAL CON FOUNDATION REAL`

## Fases aun no iniciadas de forma real
- `Fase 5 - Prototipos y creditos`
- `Fase 6 - Bloqueo y liberacion real de leads`
- `Fase 7 - Modulo de actualizaciones`
- `Fase 8 - Hand-off real de propuesta a proyecto`
- `Fase 9 - Pagos reales`
- `Fase 10 - Comisiones y retiros`
- `Fase 11 - Rewards reales`
- `Fase 12 - Notificaciones reales`
- `Fase 13 - Flujo final del cliente`

## Orden corregido para continuar
1. `Fase 2A - Validacion de leads/pipeline persistentes`
   - aplicar migracion `0002`
   - correr seed opcional
   - validar create / edit / status / delete / reload
2. `Fase 2B - Seguimiento comercial persistente`
  - notas
  - actividad
  - cambios de estado durables
  - estado actual del repo: `VALIDADA EN RUNTIME`
3. `Fase 2C - Base de hand-off comercial`
  - dejar listo el paso lead -> propuesta -> proyecto
  - estado actual del repo: `VALIDADA EN RUNTIME`
4. `Fase 2D - Conversion explicita lead -> proyecto`
  - crear proyecto durable desde una propuesta `handoff_ready`
  - estado actual del repo: `VALIDADA EN RUNTIME`
5. `Fase 2E - Tareas persistentes base`
  - crear y actualizar tareas durables para proyectos reales
  - estado actual del repo: `VALIDADA EN RUNTIME`
6. `Fase 3A - Ubicacion y cercania`
   - foundation ya implementada por Maxwell Lead Engine V1; requiere smoke runtime fresco antes de cerrarla completamente

## Modulo recomendado para arrancar ahora
- validar y cerrar el foundation real de Maxwell Lead Engine V1 antes de agregar mas comportamiento

## Por que este es el siguiente modulo correcto
- El nuevo documento fuente define Maxwell Lead Engine V1 como App/outbound/seller-only.
- El repo ya contiene una foundation real para ese modulo, por lo que el siguiente paso responsable no es inventar mas alcance sino validar lo existente contra la especificacion.
- Cualquier gap debe resolverse como slice pequeno dentro de Leads/Maxwell, sin tocar website, inbound, pagos, workspace ni developers.

## Criterio de listo del slice ya implementado
- Un PM/admin puede crear una tarea sobre un proyecto real
- Un PM o dev asignado puede cambiar estado/progreso y la tarea sobrevive recarga
- `/dashboard/tasks` y `/dashboard/projects` reflejan esas tareas persistidas
- Las tareas demo siguen funcionando para proyectos mock sin romper el modo mixto

## Evidencia usada para cerrar esta fase
- proyecto persistido `2f39ac50-1bce-4364-9133-1317160d8a5a`
- tarea persistida `25d532a6-ce53-46db-96b1-8a519768e03b`
- derivacion actual en la misma logica de la app: estado `review`, progreso `85`

## Explicitamente fuera de esta siguiente iteracion
- Rehacer auth/session
- Repetir el fix de Gmail
- Pagos, comisiones, rewards
- Notificaciones
- Modulo de actualizaciones
- Website, inbound, pagos, workspace, developer board y post-pago para cualquier trabajo de Maxwell Lead Engine V1
