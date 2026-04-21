# Noon App — Roadmap completo hacia producción real
**Documento interno · Uso exclusivo del equipo de desarrollo**
Fecha: 2026-04-19 · Versión 1.0

---

## Resumen ejecutivo

La Noon App tiene una base interna sólida: auth real con Supabase, gestión de leads, proyectos, tareas, notificaciones y actividad del equipo están funcionando con datos reales. Lo que falta es la capa comercial y de monetización: pagos reales (Stripe), wallet monetaria, Maxwell con lógica de negocio, y el workspace externo del cliente.

Este documento define todas las fases de trabajo necesarias para llevar la app a producción completa. El último paso es eliminar los datos demo y activar cuentas reales que reciben dinero real.

---

## Estado actual del sistema

### Lo que ya funciona (no se toca)

| Módulo | Estado |
|--------|--------|
| Auth + roles + middleware (Supabase) | ✅ Completo |
| Leads: CRUD, pipeline, seguimiento, actividad | ✅ Completo |
| Propuestas comerciales internas | ✅ Completo (sin vigencia ni revisión humana aún) |
| Bloqueo, liberación y claim de leads entre vendedores | ✅ Completo |
| Proyectos: gestión, PM, equipo, fechas, presupuesto | ✅ Completo |
| Tareas: CRUD, actividad, comentarios por tarea | ✅ Completo |
| Timeline de eventos (status, PM, equipo, calendario) | ✅ Completo |
| Notificaciones internas por usuario | ✅ Completo |
| Feed de actualizaciones del equipo | ✅ Completo |
| Deep links a leads, proyectos y tareas | ✅ Completo |
| Trazabilidad ventas → delivery | ✅ Completo |
| Conversión lead → proyecto (badge Convertida) | ✅ Completo |
| Prototipos: solicitud, créditos, handoff, linkage | ✅ Foundation |
| Reportes con datos reales | ✅ Completo |
| Directorio real de usuarios en Settings | ✅ Completo |
| 23 migraciones aplicadas en Supabase real | ✅ Activo |

---

## Fases de implementación

---

### PASO 0 — Prerequisitos de entorno (antes de cualquier fase)
**Objetivo:** Resolver dos problemas de configuración que existen hoy y bloquean o ponen en riesgo el desarrollo.

---

#### Problema 1 — Maxwell está roto (sin API key de LLM)
**Estado actual:** `app/api/maxwell/route.ts` llama al modelo `openai/gpt-4o-mini` pero no existe `OPENAI_API_KEY` en ningún archivo de entorno. Maxwell falla en silencio o devuelve error 500 al usarse.

**Solución:**
- Opción A: Agregar `OPENAI_API_KEY=sk-...` al `.env.local` (si se usa GPT)
- Opción B: Cambiar el modelo a `anthropic/claude-haiku-4-5` y agregar `ANTHROPIC_API_KEY=sk-ant-...` (recomendado — mismo proveedor del stack)
- En ambos casos, actualizar `route.ts` línea 51 con el modelo correcto

**Impacto si no se resuelve:** Maxwell no funciona en ningún entorno. La Fase 6 (Maxwell con lógica comercial) no se puede validar.

---

#### Problema 2 — Claves live de Stripe expuestas en entorno de desarrollo
**Estado actual:** `.env.local` contiene `sk_live_51TIkgZ...` (claves de producción real). Next.js carga `.env.local` en todos los entornos incluyendo `npm run dev`. Cualquier prueba de pago durante desarrollo cobra dinero real.

**Solución:**
- Mover las claves `sk_live_...` y `pk_live_...` a las variables de entorno de producción en Vercel (nunca en archivos locales)
- Dejar en `.env.local` únicamente las claves de test (`sk_test_...`, `pk_test_...`) que ya están en `.env.development.local`
- Las claves live solo se activan en la Fase Final cuando se hace el switch a producción

**Impacto si no se resuelve:** Riesgo de cobros reales durante pruebas de desarrollo. Violación del principio "Stripe se prueba en modo test hasta la Fase Final".

---

### FASE 1 — Wallet monetaria real
**Objetivo:** Convertir el sistema de créditos enteros en una wallet monetaria auditada. La wallet es la fuente de verdad del saldo. Stripe y Binance son solo canales de entrada/salida.

**Por qué primero:** Todo lo que sigue (earnings, pagos, payouts) necesita una wallet sólida. Si construimos pagos antes de tener ledger interno, perdemos control del dinero.

**Qué se construye:**

- **Nuevas tablas en Supabase** (sin borrar las actuales):
  - `wallet_accounts` — una por usuario, con balances separados
  - `wallet_ledger_entries` — registro auditable de cada movimiento
  - `payout_methods` — métodos de retiro registrados por usuario
  - `payout_batches` — lotes de pago mensual
  - `payouts` — pagos individuales dentro de un batch
  - `provider_events` — eventos de Stripe/Binance recibidos vía webhook

- **Balances separados por estado:**
  - `available_to_spend` — puede usar ya (prototipos, servicios internos)
  - `available_to_withdraw` — puede retirar a banco o Binance
  - `pending` — confirmación en progreso
  - `locked` — bloqueado por admin/PM hasta validación

- **Bridge de compatibilidad:** El flujo de prototipo existente sigue funcionando sin cambios visibles. Internamente se migra para consumir `available_to_spend` del nuevo ledger.

- **Reglas de acreditación:**
  - No se acredita saldo retirable por crear leads, propuestas o mensajes
  - El saldo solo es retirable tras validación por reglas de negocio (ver Fase 2)
  - No se permite retiro inmediato de saldo no consolidado

**Archivos afectados:**
- `supabase/migrations/0024_phase_3a_monetary_wallet_foundation.sql`
- `lib/server/wallet/repository.ts` (extensión, no reemplazo)
- `lib/server/wallet/service.ts` (extensión)
- `app/dashboard/credits/page.tsx` (actualizar UI con nuevos balances)

---

### FASE 2 — Earnings reales (comisiones reales)
**Objetivo:** Reemplazar los datos mock de `/dashboard/earnings` con un backend real. Los sellers y developers empiezan a ver sus ganancias reales calculadas desde el ledger.

**Por qué:** La página de earnings hoy muestra datos de demostración. Nadie puede confiar en lo que ve.

**Qué se construye:**

- **Reglas de acreditación de earnings:**
  - Seller: se acredita tras cierre real del lead (ganado) + propuesta marcada como pagada por el cliente + validación de PM
  - Developer: se acredita tras milestone o fase validada en proyecto + pago correspondiente confirmado
  - Las ganancias van primero a `pending`, luego a `available_to_withdraw` tras el período de consolidación

- **Cálculo de reparto interno:**
  - Inbound: Activación → 50% developer / 50% Noon · Membresía → 40% developer / 60% Noon
  - Outbound: Activación → $100 fijo seller + resto: 50% developer / 50% Noon · Membresía → 40% developer / 60% Noon (seller: 0%)
  - El sistema aplica la regla correcta según el canal registrado en el lead

- **Nuevos endpoints:**
  - `GET /api/earnings` — resumen del ledger de ganancias por usuario
  - `GET /api/earnings/history` — historial de entradas del ledger

- **UI de earnings:**
  - Reemplaza mock data con datos reales del ledger
  - Muestra: Total ganado, Disponible para retirar, Pendiente de consolidación, Bloqueado, Historial de movimientos

**Archivos afectados:**
- `supabase/migrations/0025_phase_3b_earnings_backend.sql`
- `app/api/earnings/route.ts` (nuevo)
- `app/dashboard/earnings/page.tsx` (reemplazo de mock)
- `lib/server/wallet/repository.ts`

---

### FASE 3 — Vigencia y revisión humana de propuestas
**Objetivo:** Las propuestas tienen vida real: expiran, pasan por revisión humana antes de enviarse, y no se pueden editar una vez enviadas (se crea nueva versión).

**Reglas del documento maestro:**
- Toda propuesta entra en estado `pending_review` al generarse
- Notificación inmediata al responsable interno
- 5 min: re-notificación
- 10 min: escalamiento automático
- 15 min: envío automático solo en casos normales (no especiales)
- La vigencia de 15 días empieza desde la primera apertura real del enlace, no desde el envío
- Una propuesta enviada no se edita: cualquier cambio relevante crea nueva versión

**Qué se construye:**

- **Nuevos campos en `proposals`:**
  - `review_status` — `pending_review | approved | sent | expired | cancelled`
  - `first_opened_at` — timestamp de primera apertura real
  - `expires_at` — calculado como `first_opened_at + 15 días`
  - `sent_at` — cuándo fue enviada formalmente
  - `version_number` — para versionado
  - `superseded_by` — referencia a nueva versión si existe
  - `is_special_case` — si requiere validación especial de Noon

- **Flujo de revisión:**
  - Maxwell genera propuesta → estado `pending_review` → notificación interna
  - Admin/PM puede: aprobar y enviar, editar antes de enviar, devolver para ajuste, escalar
  - Escalamiento automático por tiempo (job o polling)

- **Seguimiento comercial automático:**
  - 24h sin apertura: notificación interna para hacer seguimiento
  - 24h/72h/recordatorio final si abrió pero no pagó

- **Contador visible de vigencia** en la UI de propuesta

- **Endpoint de apertura:**
  - `POST /api/proposals/[proposalId]/open` — registra primera apertura, calcula `expires_at`

**Archivos afectados:**
- `supabase/migrations/0026_phase_3c_proposal_lifecycle.sql`
- `app/api/leads/[leadId]/proposals/route.ts`
- `app/api/proposals/[proposalId]/open/route.ts` (nuevo)
- `components/lead-detail.tsx`
- `lib/server/notifications/` (nuevos eventos de propuesta)

---

### FASE 4 — Stripe: Pagos del cliente al proyecto
**Objetivo:** El cliente paga por una propuesta aprobada. Solo tras pago confirmado se activa el proyecto. Noon es el intermediario; Stripe ejecuta el movimiento de dinero.

**Principio fundamental:** Stripe es el canal de dinero. Noon es la fuente de verdad (qué propuesta está aprobada, cuánto cobra, cuándo activar el proyecto).

**Qué se construye:**

- **Configuración de Stripe:**
  - Modelo: Marketplace con Separate charges and transfers
  - Connected accounts: Express (para sellers y developers)
  - Payout de la plataforma: Manual (Noon controla cuándo sacar)

- **Flujo de pago al cliente:**
  - Propuesta aprobada → generar Stripe Payment Intent o Checkout Session
  - Cliente paga → webhook `payment_intent.succeeded` → Noon activa proyecto
  - Pago fallido → propuesta queda vigente, cliente puede reintentar
  - Pago en verificación → estado `payment_under_verification` visible al cliente
  - Si el pago se inició dentro de vigencia y confirma después → se respeta la propuesta

- **Nuevas tablas:**
  - `payment_intents` — referencia entre propuesta y Stripe payment intent
  - `payment_events` — log de todos los eventos de pago recibidos por webhook

- **Webhooks mínimos a procesar:**
  - `checkout.session.completed`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.refunded`
  - `charge.dispute.created`

- **Estados de pago visibles:**
  - Pendiente de pago / Payment under verification / Pagado / Fallido / Reembolsado

**Archivos afectados:**
- `supabase/migrations/0027_phase_4a_stripe_payments.sql`
- `app/api/proposals/[proposalId]/checkout/route.ts` (nuevo)
- `app/api/webhooks/stripe/route.ts` (nuevo)
- `lib/server/stripe/` (nuevo módulo)
- `components/lead-detail.tsx` (UI de estado de pago)

---

### FASE 5 — Stripe Connect: Payouts a sellers y developers
**Objetivo:** Sellers y developers reciben su dinero real en su banco o Binance a través de Stripe Connect Express.

**Qué se construye:**

- **Onboarding de Stripe Connect:**
  - `POST /api/connect/onboard` — inicia onboarding Express para el usuario
  - `GET /api/connect/status` — estado de la cuenta conectada (activa, pendiente, fallida)
  - Stripe account ID guardado en `user_profiles`

- **Settlement mensual automatizado:**
  - Job programado que corre en la fecha acordada cada mes
  - Lee `available_to_withdraw` del ledger interno por usuario
  - Crea Transfer de la plataforma → cuenta conectada del usuario
  - Registra en `payout_batches` y `payouts` con ID de transferencia, monto y período

- **Webhooks de payouts:**
  - `payout.created`, `payout.paid`, `payout.failed`
  - `account.updated` — saber si la cuenta conectada puede recibir pagos

- **Visibilidad en `/dashboard/earnings`:**
  - Estado de cuenta Stripe Connect (activa / pendiente / no configurada)
  - Historial de payouts recibidos
  - Próxima fecha estimada de pago

**Archivos afectados:**
- `supabase/migrations/0028_phase_4b_stripe_connect.sql`
- `app/api/connect/` (nuevo módulo)
- `app/api/webhooks/stripe/route.ts` (extender)
- `lib/server/stripe/connect.ts` (nuevo)
- `app/dashboard/earnings/page.tsx`

---

### FASE 6 — Maxwell con lógica comercial real
**Objetivo:** Maxwell deja de ser un asistente general y se convierte en el agente de cotización de Noon: recopila datos del lead, clasifica el proyecto, aplica la tabla de precios oficial y genera una propuesta formateada para revisión humana.

**Inputs mínimos que Maxwell debe recopilar:**
1. Tipo de proyecto (Web básica / E-commerce / Web App / Mobile / SaaS / AI / Otro)
2. Objetivo principal del cliente
3. Alcance general del flujo principal
4. Complejidad estimada (Bajo / Medio / Alto)
5. Canal / embudo (Inbound / Outbound)
6. Correo de contacto del cliente

**Lógica de cotización que Maxwell aplica:**

| Activación base | Bajo | Medio | Alto |
|-----------------|------|-------|------|
| Web básica / Landing / Corporate | $49 | $79 | $129 |
| E-commerce | $79 | $129 | $199 |
| Web App / Sistema | $99 | $179 | $279 |
| Mobile | $129 | $199 | $299 |
| SaaS / AI / Automation | $129 | $229 | $349 |

| Membresía mensual | Bajo | Medio | Alto |
|-------------------|------|-------|------|
| Web básica / Landing / Corporate | $25 | $32 | $49 |
| E-commerce | $39 | $55 | $79 |
| Web App / Sistema | $49 | $69 | $109 |
| Mobile | $49 | $69 | $109 |
| SaaS / AI / Automation | $69 | $99 | $149 |

**Reglas de outbound:** Activación final = base + $100 seller (no se desglosa al cliente). Membresía mantiene el mismo precio que inbound.

**Casos especiales (Maxwell no propone membresía automáticamente):**
Marketplace, legacy, offline/sync, compliance fuerte, migraciones pesadas, blockchain complejo, game development → escalar a Noon para validación interna.

**Qué se construye:**
- System prompt de Maxwell con toda la lógica comercial, tablas y reglas
- Flujo de recopilación de inputs antes de generar propuesta
- Generación de propuesta en formato estructurado → estado `pending_review`
- Notificación automática a admin/PM al generar
- Detección de casos especiales → flujo de escalamiento

**Archivos afectados:**
- `app/api/maxwell/route.ts` (extender con contexto comercial)
- `lib/maxwell/` (nuevo: system prompt, pricing logic, proposal formatter)
- `components/maxwell-chat.tsx`

---

### FASE 7 — Workspace externo del cliente
**Objetivo:** El cliente que pagó tiene su propio espacio dentro de Noon (separado del dashboard interno) donde puede ver el avance de su proyecto, la propuesta aprobada, el prototipo, y comunicarse con el equipo.

**Regla:** El workspace solo se activa tras pago confirmado. Si la propuesta expira sin pago, no se crea workspace activo.

**Estados del proyecto visibles al cliente:**
| Estado | Significado |
|--------|-------------|
| Active | Proyecto activado con pago confirmado |
| In Preparation | Organización de arranque, accesos y preparación inicial |
| In Development | Desarrollo activo |
| In Review | Revisión, validación o afinación |
| Delivered | Entrega formal del proyecto |

**Qué puede hacer el cliente:**
- Ver estado actual del proyecto
- Ver resumen del proyecto y propuesta aprobada
- Ver prototipo o avance disponible
- Subir materiales, accesos o archivos
- Dejar comentarios o notas
- Contactar a un agente de Noon

**Bloque Latest Update:**
- Resumen breve del último avance
- Fecha del evento
- Recurso relevante (enlace, archivo)
- Siguiente paso esperado

**Nuevas rutas:**
- `/client/[token]` — portal del cliente (autenticación por token único, no por Supabase auth)
- `GET /api/client/project` — datos del proyecto visible al cliente
- `POST /api/client/materials` — subir materiales
- `POST /api/client/comments` — dejar comentario

**Nuevas tablas:**
- `client_workspaces` — workspace por proyecto, con token único
- `client_materials` — archivos subidos por el cliente
- `client_comments` — comentarios del cliente

**Archivos afectados:**
- `supabase/migrations/0029_phase_5a_client_workspace.sql`
- `app/client/` (nueva sección, separada del dashboard)
- `app/api/client/` (nuevo módulo de API)

---

### FASE 8 — WhatsApp directo en leads
**Objetivo:** Desde la tarjeta y el detalle de un lead, el vendedor puede abrir WhatsApp directamente si el lead tiene número registrado.

**Qué se construye:**
- Campo `whatsapp` en `leads` (puede diferir del teléfono principal)
- Acción en lead card: icono WhatsApp → abre `https://wa.me/[número]`
- Acción en lead detail: botón WhatsApp en la sección de contacto
- Registro como actividad: "Contacto por WhatsApp"

**Archivos afectados:**
- `supabase/migrations/0030_phase_6a_lead_whatsapp.sql`
- `components/lead-card.tsx`
- `components/lead-detail.tsx`

---

### FASE 9 — Leads por proximidad geográfica
**Objetivo:** El vendedor puede ver leads cercanos a su ubicación dentro de un radio aproximado de 10km. Es una opción, no una obligación.

**Qué se construye:**
- Campos `latitude` y `longitude` en `leads`
- Opción "Leads cercanos" en `/dashboard/leads`: solicita ubicación del navegador
- Filtro por radio configurable (~10km por defecto)
- Muestra distancia aproximada en la tarjeta del lead
- No expone coordenadas exactas al vendedor, solo distancia

**Archivos afectados:**
- `supabase/migrations/0031_phase_6b_lead_geolocation.sql`
- `app/dashboard/leads/page.tsx`
- `components/lead-card.tsx`

---

### FASE 10 — Módulo de análisis de webs (Actualizaciones)
**Objetivo:** El vendedor puede pegar un URL de una web existente, la app analiza qué se puede mejorar, y desde ahí puede generar un prototipo y construir una propuesta de mejora o de hosting mensual.

**Importante:** Este módulo es diferente al `/dashboard/updates` actual (que es el feed de actividad interna del equipo). Este es un módulo de oportunidades comerciales outbound.

**Flujo:**
1. Vendedor entra al módulo, pega el URL del sitio web del lead
2. La IA analiza la web (velocidad, diseño, estructura, presencia digital)
3. La app muestra un resumen de oportunidades de mejora
4. Si el vendedor tiene créditos, puede generar un prototipo de cómo se vería mejorada
5. Con el prototipo, construye una propuesta más fuerte y concreta
6. El objetivo es vender no solo la mejora sino el hosting mensual recurrente (membresía)

**Nueva ruta:** `/dashboard/web-analysis`

**Archivos afectados:**
- `app/dashboard/web-analysis/` (nuevo módulo)
- `app/api/web-analysis/` (nuevo)
- Integración con Maxwell para análisis de URL

---

### FASE 11 — Seguimiento automático de leads sin respuesta
**Objetivo:** Reducir trabajo manual del vendedor. Si un lead no responde después de cierto tiempo, la IA puede enviar un recordatorio automático.

**Qué se construye:**
- Job periódico que detecta leads con `next_follow_up_at` vencido sin actividad reciente
- Maxwell genera mensaje de seguimiento cordial personalizado según el contexto del lead
- El mensaje se registra como actividad en el lead
- Notificación interna al vendedor avisando que se envió el seguimiento
- El vendedor puede desactivar el seguimiento automático por lead

---

## FASE FINAL — Limpieza: eliminar demos, activar cuentas reales

**Este es el último paso. No se ejecuta antes de que todos los flujos anteriores estén validados en producción.**

### Paso 1 — Validación pre-limpieza (checklist)
Antes de borrar cualquier dato, confirmar que:
- [ ] Al menos un pago real de Stripe está procesado y reflejado en el ledger
- [ ] Al menos un seller tiene cuenta Stripe Connect activa y recibió una transferencia real
- [ ] Al menos un developer tiene cuenta Stripe Connect activa y recibió una transferencia real
- [ ] El workspace de cliente externo está activo con al menos un proyecto real
- [ ] Maxwell genera propuestas con precios correctos y pasan revisión humana
- [ ] Las propuestas expiran correctamente a los 15 días desde primera apertura
- [ ] El flujo completo cliente → propuesta → pago → workspace está validado end-to-end

### Paso 2 — Crear usuarios reales de producción
- Admin real: cuenta con nombre y correo oficial de Noon
- Sales manager real: primer manager con Stripe Connect configurado
- Sellers reales: con Stripe Connect Express onboarding completo
- PMs reales: con acceso a proyectos reales
- Developers reales: con Stripe Connect Express y cuenta bancaria o Binance conectada

### Paso 3 — Eliminar datos de demostración
Los siguientes usuarios seed serán eliminados de la base de datos de producción:
- `admin@noon.app`
- `maria@noon.app` (sales_manager demo)
- `juan@noon.app` (sales demo)
- `qa.sales2@noon.app` (sales demo)
- `ana@noon.app` (pm demo)
- `pedro@noon.app` (developer demo)
- `laura@noon.app` (developer demo)

Y con ellos, todos los datos de demostración asociados:
- Leads de demo
- Propuestas de demo
- Proyectos de demo (excepto si hay proyectos reales enlazados)
- Tareas de demo
- Wallets y entradas de crédito de demo
- Prototype workspaces de demo
- Actividad y notificaciones de demo

### Paso 4 — Activar Stripe en modo live
- Cambiar de claves de test a claves live en las variables de entorno
- Activar webhooks en el endpoint de producción
- Confirmar que el payout schedule de la plataforma sigue en Manual hasta que el primer ciclo mensual esté validado

### Paso 5 — Verificación post-limpieza
- Hacer login con la cuenta real de admin
- Confirmar que no hay datos de demo visibles en ningún módulo
- Crear primer lead real, seguir el flujo completo hasta que el proyecto esté activo
- Verificar que el ledger registra el movimiento correctamente

---

## Cronograma estimado

| Fase | Alcance | Estimado |
|------|---------|----------|
| Fase 1: Wallet monetaria real | Migración de créditos + ledger | 1–2 semanas |
| Fase 2: Earnings reales | Backend de comisiones + UI | 1 semana |
| Fase 3: Vigencia + revisión humana de propuestas | Lifecycle completo | 1–2 semanas |
| Fase 4: Stripe pagos al cliente | Checkout + webhooks | 1–2 semanas |
| Fase 5: Stripe Connect (payouts) | Connected accounts + settlement | 1–2 semanas |
| Fase 6: Maxwell con lógica comercial | System prompt + pricing + propuesta | 1–2 semanas |
| Fase 7: Workspace externo del cliente | Portal separado | 2 semanas |
| Fase 8: WhatsApp directo | Campo + acciones | 2–3 días |
| Fase 9: Proximidad geográfica | Geolocalización + filtro | 3–5 días |
| Fase 10: Módulo análisis de webs | Nuevo módulo IA | 1–2 semanas |
| Fase 11: Seguimiento automático | Job + Maxwell | 3–5 días |
| Fase Final: Cleanup + producción real | Eliminar demos + activar live | 1 semana |
| **Total estimado** | | **~14–20 semanas** |

---

## Reglas de trabajo durante el desarrollo

1. **Cada fase se valida antes de pasar a la siguiente.** No se puede activar Stripe sin tener el ledger interno validado.
2. **Nunca se rompe un flujo ya validado.** Si algo deja de funcionar, se detiene y se arregla antes de continuar.
3. **Las migraciones de Supabase son irreversibles.** Siempre se agrega, nunca se reemplaza de golpe sin bridge de compatibilidad.
4. **El ledger interno es la fuente de verdad del dinero.** Stripe es el canal. La app calcula, Stripe ejecuta.
5. **Los datos de demo no se eliminan hasta que la Fase Final esté aprobada.** Sirven para pruebas mientras se construye.
6. **Stripe se prueba en modo test** hasta que toda la lógica esté validada. Solo se cambia a live en la Fase Final.

---

*Noon · Documento interno · 2026 · Confidencial*
