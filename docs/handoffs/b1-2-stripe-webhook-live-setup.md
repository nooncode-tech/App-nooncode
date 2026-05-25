# Setup webhook live de NoonApp en Stripe

Necesito que crees un **segundo** webhook endpoint en la cuenta de Stripe de Noon (modo **Live**) que apunte a nuestra app de producción **NoonApp**, y me pases de vuelta el signing secret. Es un setup one-time de ~10 minutos.

## ⚠️ Lectura importante antes de empezar

En la pestaña **Developers → Webhooks** ya vas a ver un endpoint configurado apuntando a algo tipo `https://noon-main.vercel.app/api/stripe/webhook` — **ese NO lo toques**. Ese es el webhook de **NoonWeb** (el sitio público / portal del cliente), maneja el flow de pago inbound desde el website y está bien donde está.

Lo que falta es un **segundo webhook endpoint separado** para **NoonApp** (la app interna que usamos nosotros para gestión de leads / proyectos / earnings). NoonApp necesita su propio endpoint porque maneja eventos diferentes:
- Pagos del flow **outbound** (cuando un seller de Noon le manda un link de pago a un cliente directamente, sin pasar por el website)
- Eventos de **Stripe Connect** (cuando un seller retira sus comisiones a su cuenta bancaria)
- Refunds + payment failures que necesitan actualizar el estado del proyecto en NoonApp

Stripe permite múltiples webhook endpoints en la misma cuenta — los dos pueden coexistir sin pisarse. Cada uno tiene su propio signing secret.

## Contexto rápido

NoonApp procesa pagos outbound vía Stripe Checkout. Hasta hoy ese flow funcionaba en modo test. Estamos activando producción real, y para eso Stripe necesita saber a qué URL mandarnos las notificaciones de eventos. Esa URL la configurás vos en el Stripe Dashboard, y Stripe te genera un secret de firma que después yo subo a Vercel para que nuestro código pueda validar que las notificaciones realmente vienen de Stripe.

---

## Lo que necesito que hagas

### 1. Crear el endpoint

1. Entrá al [Stripe Dashboard](https://dashboard.stripe.com) con la cuenta de Noon.
2. **Asegurate de estar en modo Live** — el toggle está arriba a la derecha. Si dice "Test mode" o "Viewing test data", apagalo. Tiene que decir solo "Live".
3. En el menú izquierdo: **Developers** → **Webhooks**.
4. Click **Add an endpoint** (botón arriba a la derecha).
5. Completá los campos:

   | Campo | Valor |
   |---|---|
   | **Endpoint URL** | `https://nooncode-app-pi.vercel.app/api/webhooks/stripe` |
   | **Description** | `NoonApp production webhook` |
   | **Listen to** | Dejá "Events on your account" (NO selectes "Events on Connected accounts" como evento adicional — los de Connect que sí necesitamos están en la lista de abajo) |

6. En **Select events**, agregá exactamente estos 6 eventos (uno por uno, podés escribirlos en el buscador):

   - `checkout.session.completed`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `account.updated`
   - `transfer.paid`
   - `transfer.reversed`

   **No agregues otros eventos** aunque parezcan útiles — nuestro código no los maneja todavía y los va a ignorar o devolver error.

7. Click **Add endpoint** abajo.

### 2. Copiar el signing secret

Stripe te lleva al detalle del endpoint recién creado.

- Buscá la sección **Signing secret** (suele estar arriba a la derecha).
- Click **Reveal** o **Click to reveal**.
- Vas a ver una string que empieza con `whsec_` seguida de unos 40-50 caracteres aleatorios.
- **Copialo inmediatamente**. Stripe solo te lo muestra una vez por sesión — después solo podés regenerarlo, no re-verlo.

### 3. Pasámelo de vuelta de forma segura

**Importante**: ese signing secret es como una password. Si alguien lo obtiene puede falsificar notificaciones de Stripe y engañar a nuestra app.

Por favor **NO** lo mandes:
- Por email en texto plano
- Por WhatsApp / Telegram / SMS sin cifrado
- Pegado en un Slack/Discord público

Sí está bien:
- **1Password Share Link** con expiración corta (1 hora)
- **Signal** (mensaje directo)
- **Bitwarden Send** con expiración

Si no tenés ninguno de esos, decímelo y armamos algo. En último caso podés borrar el mensaje después de que te confirme que lo recibí.

### 4. Mantené el endpoint encendido

Una vez creado, **no toques el endpoint** (no lo deshabilites, no lo borres, no le agregues más eventos sin avisarme). El secret que me pasaste queda atado a ese endpoint específico — si lo borrás y lo recreás, el secret cambia y tengo que subirlo otra vez a nuestro deploy.

---

## Qué vas a ver si todo salió bien

Después de crear el endpoint, en la pestaña **Webhooks** vas a ver **dos rows**:

1. **El que ya existía** (no tocaste):
   - URL: `https://noon-main.vercel.app/api/stripe/webhook`
   - Eventos: 1 event
   - Status: Active
   - → Es el webhook de NoonWeb, sigue funcionando como estaba.

2. **El nuevo que creaste**:
   - URL: `https://nooncode-app-pi.vercel.app/api/webhooks/stripe`
   - Eventos: **6 events**
   - Mode: **Live**
   - Status: **Enabled**
   - → Es el de NoonApp.

Eso es todo lo que vos tenés que dejar. El resto del setup lo hago yo del lado de la app.

Una vez que yo termine de configurar el lado nuestro (probablemente esa misma tarde), voy a mandarte un **test webhook** desde el Stripe Dashboard — vas a poder ver en la sección **Events** del endpoint una delivery con status `200 OK`. Esa es la confirmación de que la conexión funciona end-to-end. Te aviso cuando llegue.

---

## Si algo se rompe

- **No encontrás un campo / botón** → mandame screenshot, te confirmo dónde.
- **Stripe te pide algo que no entendés** (verificación adicional, mode upgrades, etc.) → no le des click, mandame screenshot primero.
- **Te pide registrar un dominio** en alguna sección de "trusted domains" → eso es para Apple Pay, no es lo que estamos haciendo. Saltátelo.

Cualquier duda antes de hacer algo: preguntame.

— Pedro
