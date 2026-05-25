# Handoff 2026-05-25 — C-slice ADR-023 router decision + arranque pendiente

> **Naturaleza:** handoff de sesión operator-driven 2026-05-25. No es spec ni ADR. Captura: lo entregado, el routing decision, y lo que la próxima sesión debe tomar como input para arrancar C0.
>
> **Sesión esta:** docs-only, no toca codebase. Roadmap externo actualizado + router decision firmado + spec predecesor lifecycle verificada.

---

## 1. Contexto del arranque

Operator trajo `D:\Pedro\archivos-pedro\Lista-App.md` (lista externa de 12 ítems generada por agente externo) y pidió cruzarla contra el roadmap (`D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md`).

Resultado del cruce:
- 2 ya hechos (Lista stale): #3 Stripe live keys (B1), #12 TDR-002 rate limiter (B14)
- 2 decisiones operator no-roadmap: #1 mirror v3 framework vs atajo, #2 commits de Juan
- 3 alineados pendientes: #6 C-slice ADR-023, #9 versioning header (deferred v2), #10 runbook secrets (parcial DR runbook §4)
- 2 con discrepancia de scope: #4 mirror v3 contracts (Lista 2h vs roadmap 1-2d), #5 B-slice mezclado con C
- **3 gaps reales capturados como G22/G23/G24** en novena ronda §16 del roadmap

Operator eligió priorizar **C-slice ADR-023** (#6 lista).

## 2. Cambios durables esta sesión

| Artefacto | Cambio |
|---|---|
| `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §16 | Nueva fila 9 con G22 (signed-read endpoint), G23 (outbound webhook retry App→Web), G24 (consolidación 4 helpers auth) |
| `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §11.2 | Tabla cruce "Handoff retry" ahora referencia G23 simétrico a B9 NoonWeb |
| `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §17 | Snapshot 2026-05-25 al tope con cruce + 3 bloques de priorización |
| `specs/fase-3-prototipo-decision-cross-repo-contract.md` (working tree) | Lifecycle line update verificada legit (predecesor PR #105 merged); permanece local hasta bundlearse con próximo PR (C-slice) per memory `feedback_develop_pr_only_or_local` |

Cero cambios en código `App-nooncode`. Cero PRs abiertos.

## 3. Router decision (firmado, NO relitigar)

| Dimensión | Valor |
|---|---|
| **Iteration ID** | `fase-3-adr-023-c-slice-prototype-decision-endpoint` |
| **Mode** | New Build (sin Refactor — predecesor era contract-only docs, no había implementación a refactorizar) |
| **Depth** | FULL (money-adjacent, nuevos contratos, endpoint sensible, cross-module) |
| **Chain** | analysis → architecture (MANDATORY) → backend → refactor → testing → security → docs → validator |
| **Chunks** | 4 secuenciales: **C0** spec+arch / **C1** persistence (migration + repo) / **C2** handler + 5 error codes + idempotency / **C3** side-effect Maxwell + cierre |
| **Spec filename** | `specs/fase-3-adr-023-c-slice-prototype-decision-endpoint.md` (a crear en C0) |

### 3.1 Override del router vs hint del operator

- **Architecture es mandatory, no opcional.** Razón: edge cases de error codes + side-effect contract con Maxwell + idempotency response shape requieren decisión arquitectural, no implementación ad-hoc. Puede ser lightweight (sección Contracts dentro del spec) **salvo** que Analysis surface table-design open question que requiera ADR-024 standalone.
- **Refactor va antes de Testing**, no después. Razón: handlers hermanos (`payment-confirmed`, `inbound-proposal`) deben enforzar simetría antes de que los tests calcifiquen drift.

### 3.2 Test minimums

- **10 unit tests**: 2 happy paths (accept + reject), 5 error codes, 1 idempotent retry, 1 HMAC fail, 1 body validation fail, 1 side-effect failure path
- **2 integration tests**: ledger symmetry con hermanos + token lifecycle (issue → supersede → 410)
- **Browser validation**: N/A (server-only endpoint)

### 3.3 Escalation triggers (pausar C-slice y abrir iteration separada si)

| Trigger | Acción |
|---|---|
| Analysis encuentra que `prototype_decisions` table design requiere schema choices fuera de ADR-023 D4 | Abrir ADR-024 sibling; pause al cierre de C0 |
| Architecture encuentra que side-effect Maxwell-draft requiere cambios dentro del módulo Maxwell mismo | Spin Maxwell-side a su iteration; C3 reduce a "dispatcher stub + admin notification on stub-failure" |
| Backend C2 encuentra que HMAC helper requiere generalización | Pause C2, refactor chico del auth helper, resume |
| Security review C3 con CRITICAL/HIGH unresolved | Validator → BLOCKED. Abrir security-fix follow-up |
| Operator scope expansion intento (ej. "ya que estamos agregamos G22") | Rechazar. Flag para próxima iteration |

## 4. Inputs que Analysis (C0) MUST leer primero

Lista exacta producida por router:

1. `docs/context/project.context.core.md`
2. `docs/adrs/ADR-023-prototype-decision-cross-repo-contract.md`
3. `docs/integrations/cross-repo-webhook-v1.md` (full file, §3/§4/§5)
4. `specs/fase-3-prototipo-decision-cross-repo-contract.md` (predecesor, working-tree lifecycle update verified legit)
5. `lib/server/website-webhook-auth.ts` (HMAC helper a reusar)
6. `lib/server/website/webhook-events.ts` (ledger module a reusar)
7. `app/api/integrations/website/payment-confirmed/route.ts` (handler reference para simetría)
8. `app/api/integrations/website/inbound-proposal/route.ts` (handler reference para simetría)

## 5. Ambiguidades pre-Analysis que Architecture resolverá dentro de C0

1. ¿`prototype_decisions` es source-of-truth única, o se duplica un flag `accepted_at`/`rejected_at` en `prototype_workspaces`? **Default**: tabla separada única, sin flag duplicado, salvo justificación escrita de Architecture.
2. ¿Qué hace handler si Maxwell-draft retorna error sync (bug, no transient)? **Default ADR-023**: log + `user_notifications` admin inbox. Confirmar.
3. Lead deleted / workspace soft-deleted: ¿cuál de los 5 error codes aplica? Architecture mapea.
4. ¿G22 signed-read impacta C-slice? **Default**: NO, son endpoints orthogonal (POST decision vs GET render). C-slice landa sin G22.
5. Idempotent retry response: ¿incluye `decided_at` original o el del retry? ¿Ledger registra el retry como segunda row? Architecture decide.

## 6. Operator note — "destrabar NoonWeb"

Operator cerró la sesión con: *"cortamos acá para que trabajemos para destrabar a NoonWeb"*. Interpretación: la próxima sesión prioriza trabajo que desbloquee a NoonWeb dev para que pueda arrancar su side de la Maxwell-chat flow.

Dos paths que destraban NoonWeb (no son mutually exclusive):

| Path | Scope | Tiempo | Qué le da a NoonWeb |
|---|---|---|---|
| **C-slice** (ya elegido) | Endpoint POST `/api/integrations/website/prototype-decision` + tabla + Maxwell draft + 5 error codes + idempotency | 2-3 días | El endpoint al que NoonWeb POSTea cuando cliente click accept/reject |
| **G22 signed-read spec** (opcional paralelo) | Architecture-led spec + ADR-024 chico para el render-read endpoint GET | ~3-4h spec only | El contrato del endpoint GET que NoonWeb llama on render para mostrar el prototipo. Sin esto, NoonWeb no puede renderizar `/maxwell/prototipo/[token]` |

**Recomendación operacional**: si la próxima sesión es larga, considerar arrancar G22 spec primero (3-4h, docs-only) para entregarle a NoonWeb dev el contrato del GET **antes** de empezar la C-slice. Después, C-slice puede correr en paralelo con la implementación NoonWeb-side. Esto maximiza el unblock real (NoonWeb arranca su `/maxwell/prototipo/[token]` con el GET spec sin esperar a que terminemos la C-slice).

Si la próxima sesión es chica, mantener la elección original (arrancar C0 de C-slice directo) sigue siendo válida — eventualmente terminás ambas igual.

**Decision punto** para la próxima sesión: confirmar con operator si arranca C-slice C0 directo, o si intercala G22 spec antes para destrabar NoonWeb más rápido.

## 7. Próximos pasos concretos (próxima sesión)

1. Re-leer este handoff.
2. Confirmar con operator: ¿C-slice C0 directo, o G22 spec primero como side-quest de 3-4h?
3. Si C-slice C0: invocar system-analysis con los 8 inputs del §4 arriba como reading list obligatoria. Producir `specs/fase-3-adr-023-c-slice-prototype-decision-endpoint.md`.
4. Si G22 spec primero: nueva iteration `fase-3-g22-signed-read-spec` con su propio router pass (será Refactor mode, depth FULL, Architecture-led, ~3-4h, single iteration single chunk porque docs-only).

## 8. Landmines del handoff

- Ninguna nueva. El working-tree lifecycle update del predecesor spec es benign y se bundlea con próximo PR.
- Memory rule reminder: post-Analysis output del C0, no hacer auto-merge — operator merges (per `feedback_no_auto_merge_prs`).
- Memory rule reminder: roadmap sync obligatorio post-C-slice closure (per `feedback_keep_roadmap_in_sync`).
