# Handoff 2026-05-25 — B+C slice ADR-023 implementation + G22 signed-read contract — combined closure

> **Naturaleza:** handoff combinado de cierre. Cubre dos iteraciones que corrieron en serie durante el periodo 2026-05-23 → 2026-05-25 y comparten el mismo dominio (Maxwell-chat lead-creation flow, ADR-023 family). Producido durante la sesión 2026-05-26 night, post-rebase contra develop con PR #108 ya mergeado.
>
> **Sesión productora:** continuación post-Architecture-pass (`docs/adrs/ADR-025-prototype-decision-impl-architecture-firmups.md` firmado 2026-05-25 late evening). Backend + Refactor + Testing + Security corrieron 2026-05-25 día. Close-out (rebase, drift handling, docs sync, validator gate, PR open) es esta sesión.

---

## 1. Scope de las dos iteraciones cubiertas

### 1.1 Iteración `fase-3-g22-signed-read-spec` — RESUELTA 2026-05-25 morning (docs-only)

- Spec: `specs/fase-3-g22-signed-read-spec.md` (Draft → Approved post-Validator).
- ADR firmado: `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md` (7 decisiones D1-D7 + 4 operator locks L-1..L-4 + 2 ADR-023 inherits D3+D8 discharge).
- Cross-repo contract: `docs/integrations/cross-repo-webhook-v1.md` §6 nueva subsección "Inbound read endpoints" (renumber cascade §6→§17).
- Naturaleza: Architecture-led docs-only iteration que cierra el deferred render-read endpoint declaration de ADR-023 D8.
- Output: contrato wire-level firmado para que NoonWeb-dev pueda arrancar `/maxwell/prototipo/[token]` D-slice sin esperar la implementation App-side.
- Handler iteration (App-side `app/api/integrations/website/prototype-signed-read/[token]/route.ts` + sanitization allowlist + tests) sigue pendiente como iteration separada — **OUT OF SCOPE** de este handoff.

### 1.2 Iteración `fase-3-adr-023-b-c-slice-prototype-decision-impl` — RESUELTA 2026-05-25 + close-out 2026-05-26 night

- Spec: `specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md` (Draft → Architecture-firmed → Backend-implemented → Refactor-cleaned → Testing-verified → Security-cleared).
- ADR firmado: `docs/adrs/ADR-025-prototype-decision-impl-architecture-firmups.md` (3 decisiones D1-D3 + Closure notes CN-1..CN-3).
- Naturaleza: Backend-heavy iteration que materializa el wire contract `POST /api/integrations/website/prototype-decision` de ADR-023 + persistence + Maxwell draft side-effect on accept.
- Output: endpoint vivo (HMAC-authed, ledger-backed, dual-gate enforcement, RLS-protected); `prototype_decisions` table operativa; regenerate semantics con token rotation; seller fan-out via `user_notifications`.

Ambas iteraciones bundlearon su PR en uno solo (PR contra `develop` desde `feat/b-c-slice-prototype-decision-impl`) — la docs-only G22 quedó pendiente de bundling al PR de implementation per memory rule `feedback_develop_pr_only_or_local`.

---

## 2. Chain executed (agent flow)

| Iteración | Router | Analysis | Architecture | Backend | Refactor | Testing | Security | Docs | Validator |
|---|---|---|---|---|---|---|---|---|---|
| G22 (docs-only) | ✅ Refactor mode FULL | ✅ docs-as-design | ✅ ADR-024 | N/A | N/A | N/A | N/A | ✅ §6 + spec | ✅ COMPLETE 2026-05-25 |
| B+C slice impl | ✅ New Build FULL | ✅ parallel-authored spec absorbed | ✅ ADR-025 firm-ups | ✅ migration 0060 + route + handler + draft | ✅ handler sibling symmetry pass | ✅ integration-first per ADR-016 | ✅ 5 findings SD-1..SD-5 (none CRITICAL/HIGH unresolved) | ✅ cross-repo §5 flip + core treat-as + api-auth-matrix | **PENDIENTE — esta sesión** |

Validator de B+C slice corre al final de esta sesión (PASO 5 del prompt) — Validator no fue ejecutado todavía al momento de redactar este handoff.

---

## 3. Decisions firmed (immutable inputs para sesiones futuras)

### 3.1 ADR-024 — Signed-read endpoint contract (G22)

7 decisiones load-bearing:
- **D1**: HMAC-envelope-only sobre opaque-token URL path (no signed-JWT). Ledger declined by design (GET HTTP-idempotent).
- **D2**: 200-with-flags post-accept/reject + 410 PROTOTYPE_READ_TOKEN_SUPERSEDED / _LEAD_DELETED + namespace `PROTOTYPE_READ_*`.
- **D3**: Choice C closed shape (13 fields, no extension points para v1).
- **D4**: ad-hoc inline allowlist (E-1 trigger si >2h refactor; futuro `lib/sanitization/*` shared helper).
- **D5**: extend `cross-repo-webhook-v1.md` no new file (E-6 NOT triggered).
- **D6**: rate-limit 60 req/min combined key `${token}:${remoteIp}`.
- **D7**: cache headers `private, max-age=30, stale-while-revalidate=60` on 200; `no-store` on errors.

4 operator locks L-1..L-4 (verbatim de memory) capturados en ADR §"Operator locks".

2 ADR-023 inherits: D3 state-driven token invalidation, D8 discharge (deferred declaration cerrada).

### 3.2 ADR-025 — Prototype-decision impl architecture firm-ups

3 decisiones load-bearing:
- **D1 (resuelve OQ-1)**: replay-path joins `prototype_decisions` via existing `webhook_event_id` FK (ADR-023 D4); ledger schema stays generic per ADR-016 D9; B-slice adds partial index on `webhook_event_id`. Sibling helper `composePrototypeDecisionReplayResponseFromLedger` preferred sobre modificar el existente `composeReplayResponseFromLedger`. Narrowly amends ADR-016 D6 con per-endpoint replay-table convention.
- **D2 (resuelve OQ-4)**: lifetime cap semantics — `count(*) from prototype_workspaces where lead_id = $1` con **no status filter**; archived workspaces count. Gate B evaluates **FIRST** (before Gate A credits) per architectural sequencing — surfaces `ITERATION_CAP_REACHED` antes de deducir credits del wallet (better seller UX).
- **D3 (bundling override)**: confirma bundle B+C en single iteration (overrides router 4-chunk split del handoff 2026-05-25 router decision); router conservatism era driven por Maxwell-draft destabilization fear que ADR-023 D6 fire-and-forget + spec R3/R4 ya bound; R1 grep-pass es first Backend step + explicit re-cut safety valve si `lead_id UNIQUE` drop surface >2-3 callers needing refactor.

Closure notes CN-1/CN-2/CN-3 capturan deviations + test debts + security debts (ver §6 abajo).

---

## 4. Security verdict

`system-security` review 2026-05-25 produjo 5 findings (1 MEDIUM-fixed-in-iteration M-2, 4 MEDIUM-or-INFO-deferred SD-1..SD-5):

| ID | Severity | Status | Description |
|---|---|---|---|
| M-2 | MEDIUM | **FIXED in iteration** | Verbose error message en replay-path narraba internal schema names → reemplazado por generic operator-friendly string; structured log retains full detail. |
| M-3 | MEDIUM | **FIXED in iteration (deviation accepted)** | Orphan-FK on replay reconstruction → defensive 500 vs literal re-run. Closure note CN-1 amends ADR-025 D1. |
| SD-1 | MEDIUM | DEFERRED | Rate-limit precedes HMAC verify on all 3 inbound routes (sibling convention). Hardening across all 3 routes in one iteration. |
| SD-2 | (was promoted to M-2) | FIXED | — |
| SD-3 | MEDIUM | DEFERRED → CN-1 | Closure note about M-3 deviation. |
| SD-4 | LOW | DEFERRED | No body-text length cap before HMAC compute. Future global hardening. |
| SD-5 | INFO | DEFERRED | `metadata` payload field accepted but silently dropped — observability gap. Consider persisting on the decision row in a follow-up. |

**Verdict:** No CRITICAL/HIGH unresolved. Validator gate can proceed.

---

## 5. Test coverage (AC-1..AC-12)

| AC | Description | Status |
|---|---|---|
| AC-1 | Migration `0060_phase_23a_prototype_decisions.sql` applies cleanly; `database.types.ts` regen carries all 5 schema deltas | ✅ Applied to remote (ledger row `20260525195022`); regen clean |
| AC-2 | RPC `request_lead_prototype` respects both gates (Cap-FIRST then Credits) | ✅ Verified via live `pg_get_functiondef` (CN-2 discharge); operator-driven Supabase test branch smoke recommended on first regenerate |
| AC-3 | Endpoint happy-path accept: 201 + row persisted + draft enqueued + 1 notification + `draftPropuestaQueued: true` | ✅ Integration test in `tests/server/api/integrations/website/prototype-decision.test.ts` |
| AC-4 | Endpoint happy-path reject: 201 + row persisted + NO draft + 1 notification + `draftPropuestaQueued: false` | ✅ Integration test |
| AC-5 | Idempotency bit-identical replay: 200 + wire-identical response + no double-write | ✅ Integration test (replay path via `composePrototypeDecisionReplayResponseFromLedger`) |
| AC-6 | 7 error codes surface correct HTTP status | ✅ Integration test (each code exercised) |
| AC-7 | HMAC + rate limit reuse: 401 / 429 behavior | ✅ Reused from sibling-handler infra; no regression |
| AC-8 | Maxwell draft persists with placeholder `amount = computePricing(...).activationBase`, no `seller_fees` row | ✅ Unit test on `lib/server/maxwell/prototype-decision-draft.ts` |
| AC-9 | Maxwell draft failure path: decision row stays + structured log + escalated notification | ✅ Integration test with mocked-failure Maxwell helper |
| AC-10 / R5 | RLS verification on `prototype_decisions` | ✅ Discharged via static predicate-equivalence proof (CN-2) + live INSERT-as-authenticated denial (`42501`) + live anon SELECT = 0 rows |
| AC-11 | Project gates green | ✅ `tsc --noEmit` clean; `tsx --test` 515 pass / 0 fail (baseline 511 + 4 nuevos integration tests) |
| AC-12 | Cross-repo doc + ADR alignment; no contract deviations | ✅ §5 status flipped firmed → implemented; ADR-025 D1 amended via CN-1 (defensive 500 deviation explicit) |

**Suite final:** 515 tests pass / 0 fail / exit=0.

---

## 6. Debts diferidos explícitamente (no blocking COMPLETE)

### 6.1 Security debts SD-1..SD-5

Ver §4 arriba. Todos MEDIUM-or-LOWER, ninguno block release. Tracked en ADR-025 Closure notes CN-3.

### 6.2 ADR-025 Closure notes CN-1..CN-3

- **CN-1**: D1 implementation deviation — defensive 500 on orphan-FK over re-run. Rationale: avoid double-firing non-idempotent Maxwell-draft side-effect on ledger row marked `processed`. ADR amended.
- **CN-2**: Test debts deferred to operator post-merge:
  - AC-2 RPC dual-gate live SQL smoke against Supabase test branch on first regenerate.
  - AC-10 RLS live SELECT-as-3-personas (admin / sales_manager / sales / pm) on fixture data.
- **CN-3**: 5 security debt items recorded (see §4 / SD-1..SD-5).

### 6.3 PR #108 drift absorbed in this session (no separate ticket)

Rebase contra develop post-PR #108 (`863d0ea`) surfaced 4 mechanical drift items, all absorbed:

1. **Migration renumber 0059→0060** — PR #108 trajo `0059_phase_18c_prototype_handoff_ready_status.sql` ANTES de que landeáramos. Renumbered + 5 file ref updates + ledger row `20260525205120` (PR #108) coexiste con `20260525195022` (nuestra 0060).
2. **`share_token` required at insert** post-regen `database.types.ts` — 2 INSERT paths de PR #108 fixados: `lib/server/prototypes/website-inbound.ts:69` + `scripts/validate-prototype-flow.ts:91`. Both already imported `randomUUID` from `node:crypto`. Fix: append `share_token: randomUUID()` to each `.insert(...)` call. No contract change — complies with ADR-023 D4.
3. **Stale comment ref** en `lib/server/prototypes/repository.ts:52`: `migration 0059` → `migration 0060`.
4. **Mock script gap** en `tests/server/api/integrations/website/payment-confirmed-earnings.test.ts` — PR #108 agregó `linkInboundPrototypeWorkspaceToProject(...)` call en `receiveWebsitePaymentConfirmed` (line 635) que dispara `getPrototypeWorkspaceByLeadId.maybeSingle()` sobre `prototype_workspaces`. Test file no scripteaba esa response. Fix test-only: agregar `prototype_workspaces: [{ data: null, error: null }]` al `maybeSingleByTable` del `baseMockArgs()` + del literal del test "replay (link already has project_id)". No toca production code. Reproduce el comportamiento implícito que PR #108 asume (no workspace to link in these payment-confirmed scenarios → early-return at `website-integration.ts:157`).

### 6.4 Iteration-explicit out-of-scope (per spec lifecycle)

- **NoonWeb D-slice** (`/maxwell/prototipo/[token]` render) — different repo, owner NoonWeb-dev. Ahora desbloqueado.
- **App-side G22 handler iteration** (`app/api/integrations/website/prototype-signed-read/[token]/route.ts` + sanitization allowlist) — independent iteration; spec G22 + ADR-024 ya firmados. ~2-3 días Backend.
- **Admin UI para `prototype_credit_settings.max_iterations_per_lead`** — future Frontend iteration. Column ships con default 3; admin override via direct DB hasta que UI landee.
- **Seller fee-pick UI sobre Maxwell draft** — future Frontend iteration. Draft sendable solo después de seller pick fee; `proposal-amount-validation.ts` enforces at submit-to-PM time.
- **Queue infrastructure para Maxwell draft retry** — future scope upgrade (QStash / Inngest / Postgres job runner). Hybrid fire-and-forget locked para esta iteration.
- **Phase 23A Maxwell Niches** — separate initiative (handoff doc `D:\Pedro\Descargas\maxwell-lead-engine-niches.md`). Compartían el slot `0059` originalmente; resolved by renumbering (this iteration moved to 0060, Maxwell Niches sigue libre).

---

## 7. Próximos pasos concretos (próxima sesión)

### 7.1 Inmediato (esta sesión)

1. PASO 5 — `system-validator` gate sobre la B+C slice iteration. Inputs: spec + ADR-025 (incluyendo Closure notes) + reports previos (Backend, Refactor, Testing, Security) + estado del repo + git log + este handoff. Validator cierra G22 también en la misma pasada (ya RESUELTO en §16 — Validator solo necesita confirmar).
2. PASO 6 — `gh pr create` desde `feat/b-c-slice-prototype-decision-impl` → `develop`. NO auto-merge per memory rule. Operator merges post-CI green.

### 7.2 Próxima sesión natural

**Path A — desbloquear NoonWeb completamente**:
- NoonWeb-dev arranca D-slice `/maxwell/prototipo/[token]` render con el contrato ADR-024 §6.
- App-side G22 handler iteration (`app/api/integrations/website/prototype-signed-read/[token]/route.ts`) ~2-3 días. Independent de NoonWeb D-slice (NoonWeb fetcha este endpoint on render, no on build).

**Path B — Maxwell flow polish**:
- Admin UI para `max_iterations_per_lead` settings.
- Seller fee-pick UI sobre Maxwell draft.

**Path C — operator-priority items** (no agendados aún):
- G23 outbound webhook retry App→NoonWeb (B9 simétrico).
- G24 consolidación de 4 auth helpers.

Recomendación dura: **Path A** primero. Sin G22 handler + NoonWeb D-slice, la flow Maxwell-chat E2E sigue rota client-facing (cliente ve `/maxwell/prototipo/[token]` pero no puede leer el prototipo). Con A cerrado, el bloque Maxwell-chat lead-creation flow está completo end-to-end y se puede smokearlo bilateral.

---

## 8. Landmines del handoff

- Migration 0060 + 0059 cohabitan en `supabase/migrations/`. Ledger remoto tiene ambas filas. No hay collision real — solo coincidencia visual de "phase_23a en el filename de la 0060" + "phase_18c en el filename de la 0059".
- `share_token` ahora required at insert en TS. Cualquier futuro insert path a `prototype_workspaces` debe emitir el token (RPC `request_lead_prototype` ya lo hace; PR #108 paths fueron parcheados esta sesión; grep cross-codebase no surfacea otros call sites).
- ADR-025 amend narrow a ADR-016 D6 (per-endpoint replay-table convention) está vivo. Cualquier futuro endpoint inbound debe declarar su replay-table side en su ADR.
- `prototype_decisions.webhook_event_id` es soft-FK `on delete set null`. Si un ledger row se purga manualmente en producción, el orphan-FK trigger surface el defensive 500 documentado en CN-1. No es bug — es behavior diseñado.
- G22 handoff `docs/handoffs/2026-05-25-maxwell-chat-cross-repo-contracts-noonweb-handoff.md` (renombrado durante late-evening session) sigue siendo la referencia NoonWeb-dev para arrancar D-slice. NoonWeb-dev acknowledgment de §6 still required as closure condition per memory rule (no afecta nuestro PR).

---

## 9. Referencias

### Documentos firmados esta sesión

- `specs/fase-3-adr-023-b-c-slice-prototype-decision-impl.md`
- `specs/fase-3-g22-signed-read-spec.md` (firmado 2026-05-25 morning)
- `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md` (firmado 2026-05-25 morning)
- `docs/adrs/ADR-025-prototype-decision-impl-architecture-firmups.md` (firmado 2026-05-25 late evening; Closure notes 2026-05-26 night)
- `docs/integrations/cross-repo-webhook-v1.md` §5 status flip + §6 new section
- `docs/context/project.context.core.md` treat-as rule flip + new rules
- `docs/api-auth-matrix.md` new endpoint row
- `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §16 G25 + §17 snapshot 2026-05-26 night

### Handoffs predecesores

- `docs/handoffs/2026-05-25-c-slice-adr-023-router-handoff.md` (router decision; partially overridden by ADR-025 D3 bundling)
- `docs/handoffs/2026-05-25-maxwell-chat-cross-repo-contracts-noonweb-handoff.md` (NoonWeb-dev arrancada)

### Artifacts en repo

- Migration: `supabase/migrations/0060_phase_23a_prototype_decisions.sql`
- Route: `app/api/integrations/website/prototype-decision/route.ts`
- Handler + replay sibling + schedule helper: `lib/server/website-integration.ts` (lines ~1049, ~1142)
- Maxwell draft sibling: `lib/server/maxwell/prototype-decision-draft.ts`
- Integration tests: `tests/server/api/integrations/website/prototype-decision.test.ts`

---

**Cierre operativo:** Validator gate + PR open son los dos pasos restantes antes de que el operator pueda mergear. Todo lo demás está en el repo o en el roadmap externo. Sin landmines críticos.
