# [ARCHIVED] NoonApp — Roadmap v2 hacia producción real

> **Archivado el 2026-05-09.** Este documento ya no es la fuente de verdad.
> El roadmap canónico vigente es `docs/business/roadmap-reconciled.md`.
> Se conserva como referencia histórica; **no actualizar**.

**Fecha original:** 2026-05-04  
**Contexto:** MVP funcional bien documentado. Toda la funcionalidad existe. Faltan las capas que hacen a una app production-ready con volumen real y operación en múltiples países.

---

## Visión objetivo

```
Frontend Next.js (solo UI)
        ↓ REST
Backend Go (Hexagonal)
        ↓
PostgreSQL (Supabase o directo)
        + Stripe
        + OpenAI
```

Backoffice independiente consumiendo la misma API Go con rol admin.

---

## Fase 1 — Estabilización del MVP actual
**Objetivo:** Que lo que existe hoy no rompa en producción.  
**Duración estimada:** 3-4 semanas

### 1.1 Observabilidad mínima
- Extender el logger estructurado existente a TODAS las routes (hoy solo 5 de ~30)
- Agregar request ID en cada request y propagarlo al log
- Integrar Sentry para errores client-side y server-side
- **Por qué urgente:** con pagos reales, si algo falla no te enterás hasta que el usuario se queja

### 1.2 Seguridad básica
- Rate limiting en todos los endpoints públicos (hoy solo algunos)
- Sanitizar contenido generado por OpenAI y v0 antes de guardarlo (XSS potencial)
- Validar input en Maxwell route
- Corregir el `as never` en el webhook de Stripe

### 1.3 Desacoplar `data-context.tsx`
- Separar en 4 contextos independientes: `useLeads`, `useProjects`, `useTasks`, `useUsers`
- Eliminar el modo mock del cliente — el modo mock solo existe en el servidor
- Eliminar `legacy_mock_id` de todas las tablas
- **Por qué urgente:** bloquea todo lo demás, causa bugs silenciosos con datos

### 1.4 Paginación
- Agregar paginación en leads, proyectos y tareas
- Sin esto, con 500+ leads la app se cae

---

## Fase 2 — Backend Go (Hexagonal)
**Objetivo:** Backend independiente, testeable, sin acoplamiento a infraestructura.  
**Duración estimada:** 6-8 semanas

### Arquitectura
```
cmd/api/
internal/
  domain/         ← structs puros (Lead, Project, Task, Payment...)
  ports/          ← interfaces (ILeadRepository, IPaymentGateway, IMaxwellEngine)
  usecases/       ← lógica de negocio pura, testeada sin DB
  adapters/
    postgres/     ← implementa ports con pgx (conecta directo a Postgres/Supabase)
    stripe/       ← implementa IPaymentGateway
    openai/       ← implementa IMaxwellEngine
  transport/
    http/         ← handlers REST, middlewares, auth JWT
```

### Orden de migración de dominios

| Semana | Dominio | Endpoints |
|--------|---------|-----------|
| 1-2 | Auth + Usuarios | Login, session, roles, perfil |
| 2-3 | Leads + Proposals | CRUD completo, claim, release |
| 3-4 | Projects + Tasks | CRUD, actividad, asignación |
| 4-5 | Pagos + Earnings | Stripe checkout, webhook, ledger |
| 5-6 | Maxwell | Lead search, chat, scoring |
| 6-7 | Notificaciones | In-app, preferences |
| 7-8 | Wallet + Rewards | Puntos, retiros, store |

### Beneficios
- Cualquier DB soportada (PostgreSQL, MySQL, DynamoDB) — solo cambiás el adapter
- Tests unitarios sin infraestructura (adapter en memoria)
- Deploy independiente del frontend
- Performance predecible con concurrencia real

---

## Fase 3 — Frontend desacoplado
**Objetivo:** Next.js como capa de UI pura que consume la API Go.  
**Duración estimada:** 3-4 semanas (en paralelo con Fase 2)

### 3.1 Migrar API calls al backend Go
- Reemplazar las API routes de Next.js por calls al backend Go
- Las routes de Next.js desaparecen — quedan solo las páginas

### 3.2 Descomponer God Components
- `leads/page.tsx` (580 líneas) → separar en contenedor + presentacionales
- `lead-detail.tsx` → mismo tratamiento
- Regla: ninguna page más de 200 líneas

### 3.3 Server Components reales
- Con el data-context desacoplado, las pages pueden ser Server Components
- Datos fetched en el servidor, no en el browser
- Eliminar `"use client"` de donde no sea necesario

---

## Fase 4 — Backoffice
**Objetivo:** Superficie operativa para admin, separada del dashboard de usuarios.  
**Duración estimada:** 3-4 semanas

### Secciones
| Sección | Descripción |
|---------|-------------|
| Gestión de usuarios | Crear, activar, cambiar roles, ver actividad |
| Gestión de retiros | Ver pendientes, aprobar, historial por usuario |
| Ledger de pagos | Todos los pagos, estados, eventos de Stripe |
| Ledger de earnings | Comisiones por pago y por usuario |
| Asignación de leads inbound | Leads del website sin asignar |
| Configuración de plataforma | Costos, límites de Maxwell, radios por rol |
| Event log | stripe_webhook_events, errores, replays manuales |

### Stack recomendado
Refine o React Admin apuntando a la API Go con token de rol `admin`. No es un proyecto separado — es otra surface de la misma API.

---

## Fase 5 — Internacionalización y múltiples países
**Objetivo:** Operar en múltiples países sin cambios de infraestructura.  
**Duración estimada:** 2-3 semanas

### 5.1 Timezone
- Guardar y mostrar fechas siempre en el timezone del usuario
- Crítico para seguimientos de leads y fechas de tareas

### 5.2 Monedas
- Soporte completo de múltiples monedas en el ledger de earnings
- Formateo correcto por locale (`$1,000` vs `$1.000`)

### 5.3 Maxwell por región
- Radio de búsqueda configurable por país
- Fuentes de datos de negocios por región

### 5.4 i18n (si aplica)
- Solo si operan en países no hispanohablantes
- next-intl para el frontend, i18n middleware en Go

---

## Fase 6 — Escala y resiliencia
**Objetivo:** La app aguanta volumen real sin degradarse.  
**Duración estimada:** Continua

### 6.1 Caché
- Redis para resultados de Maxwell (búsquedas por zona se repiten)
- Cache de sesión distribuido

### 6.2 Queue para operaciones asíncronas
- Distribución de earnings en background (hoy es síncrona en el webhook)
- Generación de prototipos con v0 en background
- Notificaciones en background

### 6.3 Rate limiting distribuido
- Reemplazar el rate limiter en memoria (no sobrevive múltiples instancias) por Redis

---

## Resumen ejecutivo del roadmap

```
Hoy          Fase 1          Fase 2          Fase 3+4        Fase 5+6
MVP          Estable         Go Backend      Backoffice      Escala
funcional  → sin bugs    →  hexagonal    →  + Frontend   →  real
             en prod        desde cero      limpio
             
3-4 sem      6-8 sem         3-4 sem         continuo
```

---

## Lo que NO tocar hasta Fase 2

- Auth y roles — funcionan, no romper
- RLS de Supabase — válido mientras Postgres sea la DB
- Stripe webhook — funciona, solo mejorar resiliencia
- Las 35+ migraciones — son el schema real, documentan la historia

---

## Deuda técnica a eliminar en el proceso

| Deuda | En qué fase se resuelve |
|-------|------------------------|
| `data-context.tsx` god object | Fase 1 |
| `legacy_mock_id` en todas las tablas | Fase 1 |
| Sistema de wallet dual (legacy + nuevo) | Fase 2 |
| 41+ usos de `any` en `/lib` | Fase 2 |
| Sin ports ni interfaces | Fase 2 (nativo en Go) |
| Sin paginación | Fase 1 |
| Sin caché | Fase 6 |
| Sin queue async | Fase 6 |
