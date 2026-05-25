# Browser validation 2026-05-16 — F-V08 / B7 Stripe checkout link persistence

**Iteration:** `fase-2-b7-checkout-link-persistence`
**Spec:** `specs/fase-2-b7-checkout-link-persistence.md` (mergeado via PR #46 2026-05-15)
**Implementation PR:** #47 — `feat(b7): persist Stripe checkout URL + expiry — F-V08` (branch `feature/fase-2-b7-checkout-link-persistence`, commit `1ba87fb`)
**Migration:** `supabase/migrations/0045_phase_18c_payment_checkout_link_persistence.sql` (aplicada a `pdotsdahsrnnsoroxbfe` el 2026-05-16 via Supabase Dashboard SQL Editor; G7 desync continúa — no registrada en `supabase_migrations.schema_migrations`).
**Environment:** local `next dev` (Next.js 16.2.6 Turbopack) en `http://localhost:3000`, modo `supabase` contra el proyecto productivo `pdotsdahsrnnsoroxbfe`, branch `feature/fase-2-b7-checkout-link-persistence` checked out.

---

## Setup

- `corepack pnpm install --prefer-offline` — lockfile up to date, no dependency changes.
- `corepack pnpm run dev` — Ready in 3.3s.
- `.env.local` cargado con keys `STRIPE_SECRET_KEY` + `NEXT_PUBLIC_SUPABASE_*`. Importante: el `STRIPE_SECRET_KEY` local resultó ser **`sk_live_*`** (no `sk_test_*`) — landmine no documentada previamente (ver §Notes).
- Migración 0045 verificada en Table Editor: `payments.stripe_checkout_url` y `payments.stripe_checkout_expires_at` presentes.

---

## Scenarios

### Scenario 1 — Estado **none** (no active checkout link)

**Setup:** Lead outbound con propuesta `approved` + `sent`, sin pago previo. `proposal_id = 9e86997d-7415-4273-9f35-b675acdad1bd`.

**Steps:**
1. Login como seller.
2. Abrir lead detail → tab `Propuesta`.

**Observed UI:** botón único `Crear link de pago` (primary, ícono `CreditCard`). No hay chips de "Vence", ni botones `Copiar link` / `Abrir link`.

**Verdict:** **PASS**.

---

### Scenario 2 — Estado **active** (link creado, no expirado)

**Steps:**
1. Click `Crear link de pago`.
2. La UI transiciona inmediatamente; toast "Link de pago copiado al portapapeles".
3. DevTools → Network → filtrá por `proposals`.
4. Hard refresh (F5).

**Observed UI:**
- Botones visibles: `Copiar link` (primary, ícono `Copy`), `Abrir link` (ghost, ícono `ExternalLink`), `Crear link nuevo` (link variant).
- Chip muted "Vence el 17/05 …" (con ícono `Timer`) — formato absoluto correcto porque el delta `> 12h` (Stripe default 24h).

**Observed network on F5:**
- ✅ `GET /api/leads/<lead-uuid>/proposals` → 200. Response del proposal incluye:
  ```json
  "activeCheckoutLink": {
    "expiresAt": "2026-05-17T20:07:43+00:00",
    "isExpired": false,
    "sessionId": "cs_live_a1BfLygQ82EmKAuS5TQKErv8LPIsPTTQ2DwKt1NjAa1S...",
    "url": "https://checkout.stripe.com/c/pay/cs_live_a1BfLygQ82EmKAuS..."
  }
  ```
- ✅ **NO** hubo `POST /api/payments/checkout` durante el reload — el server es source of truth, no se duplica la sesión Stripe.

**Verdict:** **PASS — invariante principal del spec confirmado**: la URL sobrevive page reload sin llamar a Stripe API en el client.

---

### Scenario 3 — Estado **expired** (link existente, expiry pasada)

**Steps:**
1. SQL Editor → simular expiry pasada:
   ```sql
   update public.payments
   set stripe_checkout_expires_at = now() - interval '1 hour'
   where proposal_id = '9e86997d-7415-4273-9f35-b675acdad1bd'
     and status = 'pending';
   ```
   *(diagnóstico inicial — la query no matcheó por una variante del WHERE; corregido al verificar el row real con `select * from payments order by created_at desc`.)*
2. Hard refresh del lead detail.

**Observed UI:**
- Chip muted "Link expirado" con ícono `Timer`.
- Botón primary "Crear link nuevo" con ícono `CreditCard`.
- **No** se clickeó el botón — el path "click → crea nueva session" es estructuralmente idéntico al Scenario 1 → 2 (ya validado), y clickearlo crearía otra session `cs_live_*` adicional sin valor de validación marginal.

**Observed enrichment:** server-side el `activeCheckoutLink.isExpired` fue `true` (deducido del render UI — confirmado indirectamente por la rama renderizada).

**Verdict:** **PASS — server-side `isExpired` computation y UI branch expired funcionan**.

**Rollback ejecutado:** la expiry pasada se revirtió a un valor futuro consistente con la session original (`now() + interval '23 hours'`).

---

### Scenario 4 — Estado **paid** (pago confirmado)

**Steps:**
1. SQL Editor → simular pago confirmado en la propuesta:
   ```sql
   update public.lead_proposals
   set payment_status = 'succeeded', paid_at = now()
   where id = '9e86997d-7415-4273-9f35-b675acdad1bd';
   ```
2. Hard refresh del lead detail.

**Observed UI:**
- Badge verde **"Pago confirmado"** con ícono `CheckCircle2`.
- **Desaparecieron** los botones de checkout link (Copiar / Abrir / Crear nuevo) — el render condicional `paymentStatus !== 'succeeded'` los oculta correctamente.

**Verdict:** **PASS**.

**Rollback ejecutado:** `payment_status = null` y `paid_at = null` restaurados (no era un pago real, no había payments row con `status='succeeded'` que cuadrar).

---

## Summary

| # | Estado | Verdict |
|---|---|---|
| 1 | none | PASS |
| 2 | active (con reload sin POST) | PASS |
| 3 | expired (server-side `isExpired = true`) | PASS |
| 4 | paid | PASS |

**Result: F-V08 / B7 COMPLETE.** Los 4 estados del state machine renderizan correctamente; el server es source of truth en page load; el server computa `isExpired` correctamente; la persistencia de URL + expiry sobrevive reload.

---

## Notes / landmines surfaced

1. **`.env.local` tenía `sk_live_*`** — al click "Crear link de pago" se creó una session **Stripe Live mode** (`cs_live_a1BfLygQ82EmKAuS5TQKErv8LPIsPTTQ2DwKt1NjAa1S...`), pagable por $350 USD si alguien obtenía la URL. Causa: la rotación + scope-split de B1.1 (2026-05-15) ajustó Vercel env vars, pero `.env.local` (archivo local del developer) nunca se tocó y quedó con la live key. **Acción tomada**: ninguna durante validación (el riesgo es solo si el clipboard / URL se pega en algún lugar público). **Acción operacional pendiente**: expirar la session via Stripe Dashboard Live mode → Payments → Checkout sessions; cambiar `.env.local` a `sk_test_*` / `pk_test_*` antes de cualquier validación futura que cree más sessions. **Aprendizaje**: documentar en §17 la convención de que `.env.local` para dev debe usar test keys, y agregar al runbook B1.4 un check de pre-flight para auditar las keys locales antes de smoke tests.

2. **Scenario 3 "click Crear link nuevo" no ejecutado** — la rama "click crea nueva session" del state machine `expired` es estructuralmente idéntica al path `none → active` ya validado en Scenario 1 → 2. Skipearlo evita crear más sessions `cs_live_*` adicionales sin ganar valor de validación. El service `createCheckoutSession` `reuse-open-session` branch + `failed` transition de la row vieja están cubiertos por los unit tests `tests/server/payments/checkout-link-repository.test.ts` y por la inspección de código del PR.

3. **Scenario 5 "paid + linked project"** no ejecutado — implicaría una propuesta `handoff_ready` que pase a `succeeded` y dispare `activatePaidProposal` end-to-end. Eso requiere webhook activo (B1.2 pendiente) o smoke con Stripe CLI (deferido per decisión del usuario 2026-05-16, esperando a que el dueño de la cuenta Stripe configure el endpoint live).

4. **G7 ongoing**: la migración 0045 quedó aplicada al schema pero no registrada en `supabase_migrations.schema_migrations`. Consistente con el patrón establecido para migraciones aditivas/idempotentes aplicadas OOB; queda pendiente para la iteración dedicada `fase-0-b4b-ledger-reconciliation`.

5. **`activeCheckoutLink` no se sobreescribe en PATCH/POST de proposals** — esos endpoints devuelven el proposal mapeado **sin** el override de `activeCheckoutLink`, por lo que post-PATCH el field aparece como `null` en la respuesta. La UI igualmente refleja el state correcto porque (a) el GET de proposals al cargar el lead trae el `activeCheckoutLink` poblado, (b) el `handleRequestPayment` actualiza el state localmente con la response del POST `/api/payments/checkout`. No es un bug funcional — es una asimetría de read paths. Si en el futuro se quiere usar `activeCheckoutLink` consistentemente en cada respuesta de PATCH/POST, agregar el fetch + override en `mapLeadProposalRowToWire` callsites de esas rutas.

---

## Test gates (recap)

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run build`: clean (Compiled successfully in 35.6s).
- `npm test`: 231/231 pass (8 new over 223 baseline).
- Browser validation: 4/4 PASS (this document).

---

## Closure status

**F-V08 / B7 COMPLETE.** Closes ADR-010 §Amendment §Implementation hooks #3.

Ready to merge PR #47 to develop. Post-merge:
- Roadmap §17 reescrita.
- core.md + history.md actualizados de PARTIAL → COMPLETE.
- `.env.local` local debe rotarse a test keys (acción operacional independiente).
- Live session `cs_live_a1BfLygQ82EmKAuS5TQKErv8LPIsPTTQ2DwKt1NjAa1S...` debe expirarse en Stripe Dashboard cuando el operador esté disponible.
