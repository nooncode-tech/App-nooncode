# GDPR Art. 15 / Art. 17 operator runbook — NoonApp

> **Status:** ACTIVE 2026-05-21. First-use checklist: verify migration `0057_phase_22a_gdpr_sentinel_profile.sql` is applied to the target Supabase project (see §2 Step 0) before any erase invocation.

## 0. Audiencia y propósito

Este runbook es para el operador de NoonApp (hoy Pedro; backup Andres Velasco) cuando aterriza una solicitud GDPR de un colaborador. Se aplica en exactamente tres casos:

- **Art. 15 — Right of Access**: el titular de los datos pide una copia de todo lo que NoonApp guarda sobre él. Procedimiento en §3.
- **Art. 17 — Right to Erasure**: el titular pide borrado completo de su cuenta. Procedimiento en §4.
- **Art. 16 — Right to Rectification**: el titular pide corrección de un dato específico. **NO está cubierto por este runbook.** Escalar al ownership legal del proyecto. Ver §9.

Este runbook **no** cubre solicitudes de clientes finales (los compradores / leads de los colaboradores). Esa data es co-propiedad de NoonWeb y se canaliza por el runbook B14 de NoonWeb. Ver §12.

Es operacional. Asume que el operador tiene credenciales de service-role, autorización escrita del owner del proyecto, y la solicitud firmada del titular. Si falta alguno de los tres, **PARAR** y conseguirlos antes de continuar.

El sistema bajo el runbook se compone de:

- Sentinel `user_profiles` row anclado en UUID `00000000-0000-0000-0000-000000000000` (RFC 4122 nil UUID), pre-sembrado por migration 0057.
- Helpers en `lib/server/gdpr/{sentinel,inventory,export,erase}.ts`.
- Dos scripts CLI en `scripts/gdpr/{export-user-data,erase-user-data}.ts`.
- Inventory de 26 tablas colaborator-rooted clasificadas como `CASCADE-delete` (7) o `ANONYMIZE-in-place` (19) más el row de `user_profiles` parent.

Política de anonimización + decisión de orden firmadas en `docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md`. Inventory autoritativo en `specs/fase-3-b16-gdpr-art-15-17.md` §Authoritative PII / `profile_id`-linked table inventory.

---

## 1. Prerrequisitos absolutos

**No proceder hasta que los seis ítems estén satisfechos.**

### 1.1 Documentación legal

- [ ] Solicitud firmada del titular (email o documento) en archivo. Conserva la referencia de ticket.
- [ ] Autorización escrita del owner del proyecto para ejecutar este runbook contra esta cuenta específica.
- [ ] Si la solicitud invoca Art. 16 (rectificación de un dato específico): **PARAR**. No es este runbook. Escalar a legal.

### 1.2 Identidad técnica del operador

- [ ] Acceso al `SUPABASE_SERVICE_ROLE_KEY` del proyecto Supabase de producción (`pdotsdahsrnnsoroxbfe`). Si trabajas contra dev/staging para ensayar, verifica que NO estás apuntado a prod (`grep NEXT_PUBLIC_SUPABASE_URL .env.local` no debe contener `pdotsdahsrnnsoroxbfe`).
- [ ] `tsx` disponible (`npx tsx --version`).
- [ ] Working directory: raíz del repo `App-nooncode`.

### 1.3 Postura de la máquina del operador

- [ ] Full-disk encryption activa en la máquina (FileVault / BitLocker / LUKS).
- [ ] Terminal con history disable activo para la sesión GDPR (ver §5).
- [ ] Sin grabación de pantalla, screen-share, ni "screencast for support" activos.

### 1.4 Sentinel profile pre-sembrado

- [ ] Migration `0057_phase_22a_gdpr_sentinel_profile.sql` aplicada al proyecto destino. **Este es el primer task del §2 Step 0.**

### 1.5 Two-person rule para `--allow-admin`

Si la solicitud apunta a un colaborador con `role = 'admin'`:

- [ ] Sign-off por escrito (email, ticket o doc) de un segundo administrador **ANTES** de invocar el script con `--allow-admin`. No se ejecuta `--allow-admin` con autorización verbal. Detalle en §6.

### 1.6 Verificación post-prerrequisitos

Antes de continuar, confirma en voz alta o por escrito al ticket: "Tengo solicitud firmada, autorización del owner, key service-role, sentinel aplicado, máquina endurecida. Procedo."

---

## 2. Step 0 — Verificar / aplicar migration 0057

**Esta migración debería estar ya aplicada en prod.** Si no lo está, este step es bloqueante: la primera línea del erase script es `assertSentinelExists`, que rechaza con exit code 6 si no encuentra el row sentinel.

### 2.1 Verificación

Pega en Supabase Dashboard SQL Editor (proyecto destino):

```sql
select id, email from auth.users
  where id = '00000000-0000-0000-0000-000000000000';

select id, email, role, is_active, legacy_mock_id from public.user_profiles
  where id = '00000000-0000-0000-0000-000000000000';
```

Las dos queries deben retornar exactamente 1 row con `email = 'deleted-user@noon.invalid'`. Si ambas retornan 1 row → continúa a §3 o §4. Si alguna retorna 0 rows → §2.2.

### 2.2 Aplicación (si la verificación falló)

Sigue el patrón ADR-014 (Dashboard SQL Editor + ledger registration), igual que el cierre de migration 0056 G17:

1. Abre `supabase/migrations/0057_phase_22a_gdpr_sentinel_profile.sql`.
2. Copia el contenido completo a Supabase Dashboard → SQL Editor.
3. Ejecuta. La migración usa `begin / commit` interno y es idempotente (`on conflict do nothing` en ambos inserts).
4. Re-ejecuta las dos queries de §2.1 — ahora ambas deben retornar 1 row.
5. Registra la row en el ledger:
   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
     values ('0057', 'phase_22a_gdpr_sentinel_profile')
     on conflict do nothing;
   ```
6. Si la migration falla por columnas NOT NULL nuevas en `auth.users` (Supabase puede agregar columnas con el tiempo), aplica la extensión documentada en ADR-019 §D4 binding y registra la extensión en el header del archivo de migración.

**No corras esto durante una sesión de erase real.** Si descubres en mitad de un Art. 17 que la migration no está aplicada, aborta el erase, aplica la migration, y reinicia desde §4 Step 0.

---

## 3. Procedimiento Art. 15 — Right of Access (export)

### 3.1 Verificar autenticidad del request

Out-of-band (no es trabajo del script):

- Confirma que la solicitud vino del titular real (call-back al teléfono registrado, confirmación por canal secundario, doc firmado). Phishing-resistance básica.
- Documenta el método de verificación en el ticket.

### 3.2 Resolver el identificador objetivo

Prefiere lookup por email (el script lo normaliza a lowercase):

```sql
select id, email, full_name, role, is_active
  from public.user_profiles
  where email = lower(trim('<email-del-titular>'));
```

Anota el `id` (UUID) y el `full_name` exactos. Si retorna 0 rows → el titular no tiene cuenta NoonApp; responde out-of-band confirmando "no records held" y cierra el ticket (no hay nada que exportar).

### 3.3 Ejecutar el export

```bash
mkdir -p ./gdpr-artefacts
npx tsx scripts/gdpr/export-user-data.ts \
  --email <email-del-titular> \
  --output ./gdpr-artefacts/gdpr-export-<profile-id>-$(date -u +%Y%m%dT%H%M%SZ).json \
  --ticket "<ticket-ref>"
```

PowerShell equivalent (Windows):

```powershell
New-Item -ItemType Directory -Force ./gdpr-artefacts
$ts = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
npx tsx scripts/gdpr/export-user-data.ts `
  --email <email-del-titular> `
  --output ./gdpr-artefacts/gdpr-export-<profile-id>-$ts.json `
  --ticket "<ticket-ref>"
```

Output esperado: `Exported N rows across 26 tables to <path>.`

Exit codes (referencia rápida): `0` success, `1` env/CLI error, `2` profile not found, `3` Supabase query failure, `4` write error.

### 3.4 Endurecer permisos del archivo inmediatamente

**Esta es la primera acción defensiva después del write.** El archivo contiene PII en claro.

POSIX (macOS/Linux):

```bash
chmod 600 ./gdpr-artefacts/gdpr-export-<profile-id>-<ts>.json
ls -l ./gdpr-artefacts/gdpr-export-<profile-id>-<ts>.json
# Expect: -rw-------
```

Windows (PowerShell as the operator, NOT admin):

```powershell
icacls .\gdpr-artefacts\gdpr-export-<profile-id>-<ts>.json /inheritance:r
icacls .\gdpr-artefacts\gdpr-export-<profile-id>-<ts>.json /grant:r "$env:USERNAME:(R,W)"
icacls .\gdpr-artefacts\gdpr-export-<profile-id>-<ts>.json
# Expect: only your user has access; no inherited entries
```

### 3.5 Calcular SHA-256 fingerprint

Para que la entrega quede tamper-evidente:

```bash
sha256sum ./gdpr-artefacts/gdpr-export-<profile-id>-<ts>.json
```

PowerShell:

```powershell
Get-FileHash ./gdpr-artefacts/gdpr-export-<profile-id>-<ts>.json -Algorithm SHA256
```

Anota el digest en el ticket. Inclúyelo en el email/canal de entrega.

### 3.6 Entrega al titular

Out-of-band, por canal cifrado:

- Email con el archivo como adjunto encriptado (gpg / 7zip con AES-256 + password fuera-de-banda), **OR**
- Signed download link via servicio aprobado por el ownership (Vercel Storage signed URL, Supabase Storage signed URL con TTL ≤ 7 días), **OR**
- Handoff en persona en formato encriptado.

**No envíes el archivo por mensaje de texto plano, Slack, ni Gmail attachment sin encriptación.**

Documenta en el ticket:
- Fecha + hora UTC de la entrega.
- Canal usado.
- SHA-256 confirmado por el titular (idealmente — sirve como acuse de recibo).

### 3.7 Retención en la máquina del operador

- Mantén el artefacto local **90 días desde la entrega** (alineado con `client_access_tokens` lifecycle, ADR-019 §D6).
- Después de 90 días — o ante confirmación escrita de recepción por el titular, lo que llegue primero — borra el archivo con shred / sdelete:

  ```bash
  shred -u -n 3 ./gdpr-artefacts/gdpr-export-<profile-id>-<ts>.json
  ```

  Windows (Sysinternals SDelete, instalable desde Microsoft):

  ```powershell
  sdelete -p 3 .\gdpr-artefacts\gdpr-export-<profile-id>-<ts>.json
  ```

- Documenta la fecha del borrado en el ticket.

### 3.8 Audit-log off-machine para el export

Anota en el ticket / store off-machine (signed S3, password-manager secure note, etc.):

- `ts_utc`, `op = 'export'`, `profile_id`, `ticket_ref`, `output_sha256`, `delivery_channel`, `delivered_at_utc`.

No commitees esa información al repo.

---

## 4. Procedimiento Art. 17 — Right to Erasure

**Pre-requisito implícito**: el script de erase **rechaza con exit code 5** si no se le pasa el `--export-artefact` apuntando a un export válido para este mismo `profile_id`. **Siempre corre §3 primero**, aun cuando el titular dice "no necesito copia, solo bórralo" — la copia es para tu defensa legal del ack del Art. 15.

### 4.1 Verificar autenticidad y autorización

- Solicitud firmada del titular → archivada.
- Autorización del owner → archivada.
- Si el target tiene `role = 'admin'`: sign-off del segundo admin → archivado. Ver §6.

### 4.2 Resolver identificador objetivo

Mismo lookup de §3.2. Anota `id`, `email`, `full_name`, `role`.

Si `role = 'admin'`, **PARAR** y bajar a §6 antes de continuar.

### 4.3 Dry-run (mandatorio antes del live)

```bash
npx tsx scripts/gdpr/erase-user-data.ts \
  --email <email-del-titular> \
  --export-artefact ./gdpr-artefacts/gdpr-export-<profile-id>-<ts>.json \
  --reason "<ticket-ref> — Art. 17 request received <fecha>"
```

El script imprime el plan por tabla:

```
GDPR erase plan for <profile-id> (<email>) — DRY-RUN
--------------------------------------------------------------------------------
  wallet_ledger_entries          ANONYMIZE-in-place        N rows → ANONYMIZED-to-sentinel
  earnings_ledger                ANONYMIZE-in-place        N rows → ANONYMIZED-to-sentinel
  ... (one line per inventory table)
  user_profiles                  CASCADE-delete            1 rows → DELETED

No mutations performed. Pass --execute to apply.
```

**Inspecciona el plan contra el inventory** en `lib/server/gdpr/inventory.ts` (también enumerado en `specs/fase-3-b16-gdpr-art-15-17.md` §Authoritative inventory):

- ¿El conteo de ANONYMIZE rows en `wallet_ledger_entries` + `earnings_ledger` + `payouts` corresponde con la actividad financiera conocida del colaborador?
- ¿Hay alguna tabla del inventory ausente del plan? (Indicaría drift entre código y schema.)
- ¿Aparece la tabla `user_profiles` al final con verdict `CASCADE-delete` y `1 rows → DELETED`? Es el row parent; el cascade lo elimina vía `auth.users` delete.

Si el plan se ve correcto, continúa a §4.4. Si no, **PARAR** y escalar a Architecture.

### 4.4 Live erase (`--execute`)

**Última oportunidad de abortar.** Después de este step la acción no es reversible.

Bash:

```bash
I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1 \
npx tsx scripts/gdpr/erase-user-data.ts \
  --email <email-del-titular> \
  --export-artefact ./gdpr-artefacts/gdpr-export-<profile-id>-<ts>.json \
  --reason "<ticket-ref> — Art. 17 request received <fecha>" \
  --execute
```

PowerShell:

```powershell
$env:I_UNDERSTAND_THIS_IS_DESTRUCTIVE = "1"
npx tsx scripts/gdpr/erase-user-data.ts `
  --email <email-del-titular> `
  --export-artefact .\gdpr-artefacts\gdpr-export-<profile-id>-<ts>.json `
  --reason "<ticket-ref> — Art. 17 request received <fecha>" `
  --execute
$env:I_UNDERSTAND_THIS_IS_DESTRUCTIVE = $null
```

El script imprime el target resuelto y pide confirmación interactiva:

```
--- CONFIRM TARGET ---
  profile-id: <uuid>
  email:      <email>
  full_name:  <name>

This will ANONYMIZE all ledger references and DELETE the auth user.
The action is NOT reversible.

Type the email or profile-id EXACTLY (case-sensitive) to confirm:
```

Pega el email o el profile-id (case-sensitive, sin espacios). Cualquier mismatch aborta con exit code 8.

Después de la confirmación, el script ejecuta en orden (ADR-019 §D2):

1. Anonimiza las 19 tablas ANONYMIZE-in-place (set actor columns a sentinel UUID).
2. Explicit DELETE para tablas CASCADE-delete que no cascadean (actualmente ninguna).
3. `supabase.auth.admin.deleteUser(profile_id)` → cascade a `user_profiles` y a las 7 tablas CASCADE-delete.
4. Verification queries por tabla.

Output esperado:

```
GDPR erase verification for <profile-id> — DONE
--------------------------------------------------------------------------------
  wallet_ledger_entries          affected=N  remaining=0  sentinel=N
  earnings_ledger                affected=N  remaining=0  sentinel=N
  ... (one line per touched table)
auth.users deleted: true
```

`remaining=0` en cada row es la garantía operacional. Si alguna row muestra `remaining > 0`, exit code 10 dispara y la sesión queda en estado inconsistente — escalar inmediato a §7.

Exit codes (referencia rápida): `0` success; `2` profile not found; `3` Supabase query failure durante anonymize; `4` auth-side delete failed (anonymize ya committed — recovery en §7); `5` export artefact missing/malformed/mismatched; `6` sentinel not seeded (apply 0057 — §2); `7` `I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1` ausente; `8` interactive confirmation mismatch; `9` admin target sin `--allow-admin`; `10` post-erase verification mismatch.

### 4.5 Verification queries post-erase

Pega en Supabase Dashboard SQL Editor para confirmar el state final:

```sql
-- ANONYMIZE-in-place rows ahora referencian el sentinel
select count(*) from public.wallet_ledger_entries
  where profile_id = '00000000-0000-0000-0000-000000000000';
-- Expect: >= 1 (los rows previamente del titular, ahora anonimizados)

select count(*) from public.wallet_ledger_entries
  where profile_id = '<profile-id-original>';
-- Expect: 0

select count(*) from public.earnings_ledger
  where actor_id = '<profile-id-original>';
-- Expect: 0

select count(*) from public.payouts
  where profile_id = '<profile-id-original>';
-- Expect: 0

select count(*) from public.leads
  where created_by = '<profile-id-original>';
-- Expect: 0

-- CASCADE-delete rows están gone
select count(*) from public.user_notifications
  where profile_id = '<profile-id-original>';
-- Expect: 0

select count(*) from public.payout_methods
  where profile_id = '<profile-id-original>';
-- Expect: 0

-- auth.users está gone (cascade fired)
select count(*) from auth.users where email = '<email-original>';
-- Expect: 0

-- user_profiles parent está gone (cascade fired)
select count(*) from public.user_profiles where id = '<profile-id-original>';
-- Expect: 0
```

Cualquier query que retorne `> 0` cuando se espera `0` significa que el cascade no completó. Escalar a §7.

### 4.6 Audit-log de la erasure

El script appendea automáticamente una línea a `.gdpr-erasure-audit.log` (gitignored, operator-local) con:

```json
{"ts":"<iso>","profile_id":"<uuid>","email_at_run":"<email>","reason":"<ticket-ref>","ticket_ref":null,"verification_ok":true}
```

**Backup off-machine obligatorio** (§F2 security requirement):

- Sube esa línea a un store off-machine inmediatamente: signed S3 PUT con KMS, password-manager secure note, ledger interno tamper-evident, o equivalente.
- Documenta el sink usado en el ticket.
- No commitees `.gdpr-erasure-audit.log` al repo (ya está en `.gitignore`).

---

## 5. Session hygiene (REQUIRED por F8)

Estos pasos se ejecutan **antes** de abrir el shell que va a correr los scripts, y **después** del cierre.

### 5.1 Antes de abrir la sesión

Bash:

```bash
unset HISTFILE
export HISTFILE=/dev/null
set +o history
```

(En zsh: `unset HISTFILE; setopt no_history`.)

PowerShell (Windows PowerShell 5.1 / PowerShell 7):

```powershell
Set-PSReadLineOption -HistorySaveStyle SaveNothing
Clear-History
```

Confirma con `echo $HISTFILE` (bash) o `Get-PSReadLineOption | Select-Object HistorySaveStyle` (PowerShell). Debe mostrar la disable.

### 5.2 Durante la sesión

- No copies emails ni profile-ids al portapapeles del sistema más allá del prompt que los necesita. Si necesitas anotar para el ticket, escríbelos a mano o sobre un editor que sepas que no sincroniza a la nube.
- No abras tabs paralelos con clipboards de plugins de password-manager que sincronizan.
- No tomes screenshots del shell con el target visible.

### 5.3 Al cerrar la sesión

Limpia scrollback:

Bash:

```bash
clear && printf '\033[3J'
```

PowerShell:

```powershell
Clear-Host
[Console]::Clear()
```

Cierra el terminal completamente (no dejarlo en background). Si tu terminal app tiene scrollback persistente cross-restart (iTerm2, Windows Terminal con buffer extendido), abre Preferences y verifica que el buffer está vaciado o configurado a 0 para esta sesión.

---

## 6. Admin erasure (`--allow-admin`) — Two-person rule

**Aplica cuando el target tiene `user_profiles.role = 'admin'`.** Sin esta verificación adicional, el script rechaza con exit code 9.

### 6.1 Pre-conditions adicionales

- [ ] Sign-off escrito (email firmado, ticket con campos `requestor`/`reviewer`, doc en password-manager compartido) de un segundo administrador autorizado **ANTES** de invocar el script con `--allow-admin`.
- [ ] Confirmación del segundo admin que entiende que la acción es no-reversible y aplica a un peer.
- [ ] El ticket que documenta esta sesión cita el sign-off por referencia (link al email, doc-id, etc.).

**Autorización verbal no cuenta.** Si no hay registro escrito, no se ejecuta `--allow-admin`. Si el segundo admin está unreachable y el request es urgente, escalar al owner del proyecto, no ejecutar.

### 6.2 Invocación

Bash:

```bash
I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1 \
npx tsx scripts/gdpr/erase-user-data.ts \
  --email <email-del-admin-target> \
  --export-artefact ./gdpr-artefacts/gdpr-export-<profile-id>-<ts>.json \
  --reason "<ticket-ref> — Art. 17 admin erasure, second sign-off: <sign-off-ref>" \
  --execute \
  --allow-admin
```

El `--reason` debe contener la referencia al sign-off del segundo admin. Esa string termina en `.gdpr-erasure-audit.log` y es el eslabón forense que conecta la ejecución con la autorización.

### 6.3 Audit-log heightened requirements

Para erasure de admin:

- Sube la línea de `.gdpr-erasure-audit.log` al store off-machine **antes** de cerrar la sesión.
- Incluye en el ticket: identidad del primer admin (ejecutor), identidad del segundo admin (sign-off), referencia al sign-off doc, timestamp UTC.
- Considera notificar al owner del proyecto post-hoc por canal separado.

---

## 7. Failure recovery

Procedimientos para los failure modes conocidos.

### 7.1 Pre-flight failures

**Exit 6 (sentinel not seeded):**
- Causa: migration 0057 no aplicada al proyecto destino.
- Fix: §2 — aplica la migration, verifica con las dos SELECT, reinicia el procedimiento.

**Exit 2 (profile not found):**
- Causa: email tipeado mal, o cuenta ya fue erased en una sesión previa, o el titular nunca tuvo cuenta NoonApp.
- Fix: re-verifica el lookup en §3.2 / §4.2. Si confirmas que la cuenta no existe, responde out-of-band "no records held" y cierra ticket.

**Exit 5 (export artefact missing/malformed/mismatched):**
- Causa: olvidaste correr el export, el path es incorrecto, o el `profile_id` del export no matchea el target del erase (e.g., dos ejecuciones contra emails diferentes).
- Fix: re-corre §3, asegúrate del path absoluto/relativo correcto, re-invoca §4.4.

**Exit 7 (`I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1` ausente):**
- Fix: setea el env var en el mismo shell antes de la invocación (`export I_UNDERSTAND_THIS_IS_DESTRUCTIVE=1` o `$env:I_UNDERSTAND_THIS_IS_DESTRUCTIVE = "1"`), retry.

**Exit 8 (interactive confirmation mismatch):**
- Causa: el string tipeado en el prompt no matchea exactamente el email o el profile-id (case-sensitive, sin espacios).
- Fix: copia el valor exacto desde la línea del prompt arriba, retry. Si fallaste 3+ veces seguidas, abre Architecture review — puede haber drift entre el email mostrado y el valor en DB (encoding, trailing space).

**Exit 9 (admin target sin `--allow-admin`):**
- Causa: target tiene `role = 'admin'` pero no pasaste `--allow-admin`.
- Fix: cumple el §6 Two-person rule, luego re-invoca con `--allow-admin`.

### 7.2 Mid-anonymization failure (exit 3)

Este es el caso que la relajación de D7 documenta (ver `lib/server/gdpr/erase.ts` comentario header):

**Síntoma**: `[gdpr-erase] Erase failed: GDPR erase step "anonymize" failed on table "<tabla>": <causa>` con exit code 3.

**Estado**: anonymize parcial. Las tablas previas a la fallida tienen sus rows ya anonimizadas; la tabla que falló tiene rows intactos (la UPDATE retornó error sin escribir). `auth.admin.deleteUser` **NO se invocó** (la safeguard del helper bloquea el step 4 si cualquier step 1-2 falla — ver `tests/server/gdpr/erase.test.ts` "eraseUserData does NOT invoke auth.admin.deleteUser if any ANONYMIZE step fails").

**Recovery**:

1. Diagnostica la causa concreta del error reportado (permission denied, FK violation inesperada, timeout, network blip).
2. Resuelve la causa raíz (e.g., restaurar GRANT, esperar a que termine un job conflictivo).
3. **Re-corre el live erase con los mismos argumentos.** El helper es idempotente por construcción: cada UPDATE filtra por `eq(col, originalProfileId)`. Las tablas ya anonimizadas filtran a 0 rows (no-op, affected=0); la tabla que falló filtra a sus rows pendientes y los anonimiza; el step 4 procede y dispara el cascade.
4. Verifica con las queries del §4.5.

**No intentes "rollback manual"** revirtiendo los sentinel anonymizations a los valores originales. Eso requeriría reconstruir el original profile-id desde el export artefact, lo cual es exactly the kind of mapping table que ADR-019 §D1 (opción c) rechaza explícitamente.

### 7.3 Auth-side delete failure (exit 4)

**Síntoma**: anonymize completó exitosamente, pero `supabase.auth.admin.deleteUser(profile_id)` devolvió error.

**Estado**: 19 tablas anonymize-in-place tienen sentinel actors (commit). `user_profiles` row sigue existiendo. `auth.users` row sigue existiendo. Las 7 tablas CASCADE-delete todavía referencian al profile-id original (no se les disparó el cascade).

**Recovery** (manual, sin re-ejecutar el script):

1. Diagnostica la causa del error (network blip a Auth API, rate limit, transient Supabase issue).
2. Abre un Node REPL en el repo:

   ```bash
   npx tsx
   ```

3. Dentro del REPL:

   ```js
   const { createClient } = await import('@supabase/supabase-js')
   const url = process.env.NEXT_PUBLIC_SUPABASE_URL
   const key = process.env.SUPABASE_SERVICE_ROLE_KEY
   const client = createClient(url, key, {
     auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
   })
   const { error } = await client.auth.admin.deleteUser('<profile-id-original>')
   console.log('error:', error)
   ```

   `error` debe ser `null`. Si retorna error, repite hasta resolver la causa raíz.

4. Verifica con las queries del §4.5 — auth.users count = 0, user_profiles count = 0, CASCADE-delete tables = 0.
5. Anota en el ticket que el auth-side se completó por recovery manual, con el `ts_utc` del REPL invocation.
6. Append manualmente la línea de cierre a `.gdpr-erasure-audit.log` con `verification_ok: true` (el script ya appendeó una con `verification_ok: false` al exit 4 — registra la corrección).
7. Backup off-machine ambas líneas.

### 7.4 Post-erase verification mismatch (exit 10)

**Síntoma**: el script reporta `EraseVerificationError` con una o más tablas que todavía referencian el profile-id original.

**Estado**: extremadamente raro. Significa que el cascade no propagó a una tabla CASCADE-delete (FK violation suprimida, view en lugar de table, RLS bypass anomaly).

**Recovery**:

1. **NO corras el script de nuevo.** El profile-id ya no existe en `user_profiles`; el resolve va a fallar con exit 2.
2. Inspecciona las tablas reportadas como mismatch directamente con SQL. Verifica que el FK efectivamente cascadea (`select conname, confupdtype, confdeltype from pg_constraint where conrelid = 'public.<table>'::regclass`).
3. Si confirma que el cascade está roto, escalar a Architecture: el inventory + el FK chain de ADR-019 §D2 step 6 no se cumplió. Requiere fix de schema, no de runbook.
4. Como mitigación inmediata, manually DELETE los rows huérfanos:
   ```sql
   delete from public.<table> where <filter-column> = '<profile-id-original>';
   ```
5. Re-verifica con §4.5. Documenta extensamente en el ticket — esto es una falla del modelo de erasure y necesita análisis post-hoc.

---

## 8. Free-text PII / Art. 16 disclaimer (REQUIRED por F4)

**El erase script NO escanea texto libre.** Las siguientes columnas pueden contener menciones incidentales del titular (su nombre, email tipeado en una nota) y **no se redactan**:

- `lead_activities.note_body`
- `task_activities.note_body`
- `project_activities.note_body`

Otros campos JSONB se procesan según el inventory (e.g., `wallet_ledger_entries.metadata` se wipea a `{}`), pero los `note_body` texts permanecen literal.

**Implicación para el operador**: si el titular invoca Art. 16 (Right to Rectification) y específicamente pide la remoción de menciones nominales en notas de actividad, ese trabajo **NO está cubierto por este runbook**. Acciones:

1. Documenta la solicitud Art. 16 en un ticket separado.
2. Escalar al ownership del proyecto / legal para coordinar revisión caso-por-caso.
3. La rectificación de free-text es una operación manual con riesgo de leer PII por encima de lo necesario; requiere su propio playbook que no se ha producido todavía.

ADR-019 §D3 documenta esta gap como riesgo LOW aceptado; spec §Allowed shortcuts lo registra como future iteration.

---

## 9. Sentinel visibility note (REQUIRED por F1)

Después de la erasure, el row sentinel `Deleted User` (UUID `00000000-...`) aparece en:

- Cualquier query sobre `public.user_profiles` que no filtre por `is_active = true`. El sentinel tiene `is_active = false`.
- El admin directory `/api/users/admin` (que enumera todos los profiles para el admin) — verás un `Deleted User` row en la lista.

**Esto es esperado y por diseño** (ADR-019 §Consequences). El sentinel ancla las FK constraints de los rows anonimizados; eliminarlo después de una erasure violaría integrity.

Si el ownership reporta "veo un 'Deleted User' en mi panel, ¿qué es?": confirmar que es el sentinel pos-GDPR, no acción adicional necesaria. Si surge feedback de UX que el row contamina vistas, registrar como follow-up de system-frontend para filtrar las admin surfaces que listan profiles inactivos. Out of B16 scope.

Verificación rápida del sentinel post-erasure (debe seguir existiendo):

```sql
select id, email, is_active from public.user_profiles
  where id = '00000000-0000-0000-0000-000000000000';
-- Expect: 1 row, is_active = false
```

---

## 10. Audit-log off-machine backup (REQUIRED por F2)

`.gdpr-erasure-audit.log` es **operator-local + gitignored**. No tiene replicación automática. Debes appendear cada línea a un store off-machine inmediatamente después de cada `--execute`.

### 10.1 Opciones de sink aprobadas

- **Signed S3 PUT con KMS encryption** y bucket retention policy. Object key recomendado: `gdpr-audit/<year>/<month>/<timestamp>-<profile-id>.json`.
- **Password-manager secure note** (1Password / Bitwarden / equivalente) con shared vault del ownership. Una note por erasure, título `GDPR-erase <profile-id> <ts>`.
- **Ledger interno tamper-evident** si existe en la organización (out of scope de este repo).

### 10.2 Lo que se sube

La línea exacta que el script appendeó:

```json
{"ts":"<iso>","profile_id":"<uuid>","email_at_run":"<email>","reason":"<ticket-ref>","ticket_ref":<value-or-null>,"verification_ok":true}
```

Más metadata adicional que el operador agrega:
- `export_sha256` (del §3.5)
- `delivery_channel` (del §3.6)
- `second_admin_signoff_ref` (si aplica §6)
- `recovery_notes` (si aplica §7)

### 10.3 Cuándo

- Para Art. 15 export: después de §3.7 retention setup.
- Para Art. 17 erase normal: inmediatamente después del exit 0 del live run.
- Para Art. 17 erase con recovery (§7.2 o §7.3): después de completar el recovery, con ambas líneas (la del exit non-zero y la de la corrección).

### 10.4 No hacer

- No subas `.gdpr-erasure-audit.log` completo a un repo público.
- No incluyas el export artefact en el mismo store sin encriptación adicional.
- No uses Slack / email plano como audit-log store. Slack edits son posibles, el log debe ser append-only tamper-evident.

---

## 11. Cross-repo coordination

NoonApp y NoonWeb son productos separados (ver `docs/context/project.context.core.md` §Confirmed architecture shape).

**El scope de este runbook es App-only.** Si el titular invoca Art. 17 y NoonWeb también tiene datos del mismo individuo (ejemplo: el colaborador también fue cliente en el website pre-NoonApp, o tiene un row en `stripe_customers` o `website_inbound_links`), esos rows **NO se tocan por este runbook**.

### 11.1 Escalación a NoonWeb

Si después del erase NoonApp confirmas que el titular pudo haber tenido superficie en NoonWeb:

1. Abre un ticket / hand-off al ownership de NoonWeb (`noondevelop@gmail.com` shared inbox).
2. Solicita ejecutar el runbook B14 (`docs/runbooks/gdpr-art-15-17.md` en `noon-web-main`).
3. Comparte el `profile_id` original (post-erase ya no existe en NoonApp, pero NoonWeb puede buscarlo por email histórico) y el ticket de la solicitud.
4. NoonWeb cierra su parte y reporta back; consolidas la respuesta al titular.

**El scope NoonWeb cubre**: `website_inbound_links.inbound_payload`, `stripe_customers`, `projects.client_name`, `client_access_tokens.client_email`, leads.{name,email,phone,company} si el lead es client-side. Inventario detallado vive en NoonWeb B14, no acá.

### 11.2 Escalación a Stripe / Binance / providers externos

NoonApp no controla los rows en Stripe Connect / Stripe Customers / Binance / otros providers externos. Si el titular pide GDPR-Art-17 también contra esos providers:

- Stripe Dashboard → Settings → Data Privacy → "Request data deletion" para la cuenta.
- Binance Wallet Pay → support ticket.
- Cada provider tiene su propio SLA (Stripe documenta 30 días; verificar el de cada uno al momento del request).

Documenta las solicitudes en el ticket; no son ejecutables desde este runbook.

---

## 12. Links

- Spec autoritativo: `specs/fase-3-b16-gdpr-art-15-17.md`
- ADR-019 anonymization policy: `docs/adrs/ADR-019-gdpr-erasure-anonymization-policy.md`
- Migration sentinel: `supabase/migrations/0057_phase_22a_gdpr_sentinel_profile.sql`
- Helpers: `lib/server/gdpr/sentinel.ts`, `lib/server/gdpr/inventory.ts`, `lib/server/gdpr/export.ts`, `lib/server/gdpr/erase.ts`
- Scripts: `scripts/gdpr/export-user-data.ts`, `scripts/gdpr/erase-user-data.ts`
- Tests (53 unit tests): `tests/server/gdpr/{sentinel,inventory,export,erase}.test.ts`
- Integration test (manual procedure): `docs/handoffs/2026-05-21-b16-gdpr-integration-manual.md`
- Security review: `docs/validations/B16 security review 2026-05-21.md` (findings F1–F12 referenciadas en este runbook como **REQUIRED por Fn**)
- ADR-014 (migration ledger pattern, usado en §2.2): `docs/adrs/ADR-014-migration-ledger-reconciliation.md`

---

## 13. Update discipline

Este runbook es un documento vivo. Update cadence:

- **Después de cada Art. 15 o Art. 17 ejecutado**: revisa los §3 y §4 contra lo que efectivamente ocurrió. Si encontraste un edge case nuevo, append a §7.
- **Después de cualquier cambio al inventory (`lib/server/gdpr/inventory.ts`)**: revisa que §4.3 dry-run sample sigue siendo representativo del schema actual.
- **Después de cualquier ADR nuevo que ajuste la política de anonimización**: actualiza §0 + §4.
- **Si se agrega un cron de cleanup del sentinel u otra automatización**: anota en §9.

No borres entries del §7 cuando se resuelvan — el siguiente operador puede enfrentar el mismo síntoma desde una causa distinta. Tachar y anotar resolución, igual que el patrón de `docs/runbooks/cutover-pilot.md`.
