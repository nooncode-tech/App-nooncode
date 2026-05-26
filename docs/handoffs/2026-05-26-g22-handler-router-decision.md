# Router decision 2026-05-26 — G22 prototype-signed-read handler iteration

> **Naturaleza:** router output formal para la iteración `fase-3-g22-prototype-signed-read-handler-impl`. Producido por `system-router` agent 2026-05-26 post-PR #110 merge. Lee como Tier-0 input antes del Analysis.

---

## 1. Iteration ID

`fase-3-g22-prototype-signed-read-handler-impl`

Aligns con predecessor `specs/fase-3-g22-signed-read-spec.md` (contract-firming iteration que produjo ADR-024) y sibling `fase-3-adr-023-b-c-slice-prototype-decision-impl` naming. El sufijo `-impl` distingue de la iteración contract-firming.

## 2. Mode + Depth + Chain

| Dimension | Valor |
|---|---|
| **Mode** | New Build (greenfield handler; no legacy code) |
| **Depth** | **LITE** |
| **Chain** | Analysis → Backend → Testing → Security → Docs → Validator |
| **Skipped** | Architecture (ADR-024 ya firma D1-D7), Refactor (greenfield) |
| **Branch base** | `feat/g22-prototype-signed-read-handler` desde develop @ `d41e6ed` post-PR #110 merge |

### Justificación LITE

- Contracts firmados completamente en ADR-024. Nada queda por decidir architecturalmente.
- Single-file deliverable principal (`route.ts`) + test file + minor docs touches.
- Sibling pattern de PR #110 (prototype-decision/route.ts) es hours-old y directly mirror-able.
- Sin cross-module impact; sin contract negotiation; sin data-flow change beyond reading existing columns.

### Caveats que forzarían FULL escalation mid-iteration

- ADR-024 D4 inline sanitization allowlist exceeds ~2h effort → spin sibling iteration `fase-3-sanitization-shared-helper`.
- `getPrototypeWorkspaceByShareToken` (o equivalente) missing en `repository.ts` y agregar lo toca RLS policies → Architecture re-entry para RLS review.
- RLS posture para `share_token`-keyed read difiere de lead-id-keyed read → Architecture re-entry.

## 3. Spec filename predicted

`specs/fase-3-g22-prototype-signed-read-handler-impl.md`

Analysis output lands aquí. Lifecycle: lista `specs/fase-3-g22-signed-read-spec.md` como predecessor (no superseded — ambos durables; este extiende).

## 4. Reading list para Analysis

### Tier 1 — Immutable contract inputs (no relitigar)

1. `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md` — full read, decisiones D1-D7
2. `docs/integrations/cross-repo-webhook-v1.md` — §6 Inbound read endpoints subsection

### Tier 2 — Predecessor + sibling pattern (mirror, no reinventar)

3. `specs/fase-3-g22-signed-read-spec.md` — contract-firming iteration output
4. `app/api/integrations/website/prototype-decision/route.ts` — sibling handler shape (PR #110)
5. `tests/server/api/integrations/website/prototype-decision.test.ts` — test pattern mirror

### Tier 3 — Reused primitives (consumir, no rediseñar)

6. `lib/server/website-webhook-auth.ts` — HMAC verifier
7. `lib/server/api/rate-limit.ts` — rate-limit primitive
8. `lib/server/prototypes/repository.ts` — workspace lookup helpers (flag si falta `getPrototypeWorkspaceByShareToken` o equivalente)

### Tier 4 — Context (skim only)

9. `docs/context/project.context.core.md` — current treat-as state para §6
10. `supabase/migrations/0060_phase_23a_prototype_decisions.sql` — verificar shape de `share_token` + `share_token_superseded_at` (no asumir, leer)
11. `docs/handoffs/2026-05-26-smoke-a-prototype-decision-fire.mjs` — sibling smoke script (pattern reference para futuro smoke A G22; informational only esta iteración)

`project.context.full.md` **no required** bajo LITE — ADR-024 + sibling pattern cargan la verdad estructural necesaria. Validator puede re-pull al close.

## 5. Test minimums

11 tests baseline (operator 8-10 + 3 structural-mandatory router-added):

| # | Test | Categoría |
|---|---|---|
| 1 | Happy 200 — valid token + valid HMAC → sanitized payload + correct cache headers | Happy path |
| 2 | 404 — token does not exist | Error taxonomy |
| 3 | 410 — `share_token_superseded_at IS NOT NULL` (superseded) | Error taxonomy |
| 4 | 410 — parent lead soft-deleted | Error taxonomy |
| 5 | 401 — HMAC signature mismatch | Auth |
| 6 | 401 — HMAC timestamp skew (replay window violation) | Auth |
| 7 | 429 — rate-limit budget exhausted | Rate-limit |
| 8 | Sanitization allowlist — fields NOT in allowlist stripped from response | Security boundary |
| 9 | Cache headers — `Cache-Control` per ADR-024 D5 exact spec | Cache contract |
| 10 | RLS — service-role read bypasses RLS as expected (no leakage to anon role in equivalent direct query) | Structural-mandatory |
| 11 | Idempotency-equivalent — same token + same HMAC twice → byte-identical response body | GET-idempotency |

Analysis puede consolidar 5+6 si HMAC verifier ya tiene unit tests de timestamp skew.

## 6. Escalation triggers

| Trigger | Acción |
|---|---|
| ADR-024 D4 inline sanitization allowlist >~2h effort | **Pause Backend.** Abrir sibling `fase-3-sanitization-shared-helper`. Resume después. |
| `repository.ts` lacks `getPrototypeWorkspaceByShareToken` + adding it touches RLS | **Pause Analysis → Architecture re-entry** para RLS review only. Documentar en spec. |
| GET endpoint surfacea need for write-side ledger entry (audit trail of reads) | **HARD STOP.** ADR-024 D1 declined-by-design. Spin separate ADR proposal. NO agregar ledger esta iteración. |
| HMAC scheme en `website-webhook-auth.ts` es request-body-bound y GET no tiene body | **Pause Backend → Architecture re-entry.** ADR-024 puede needar amendment clarifying GET HMAC signing (URL + timestamp only). Flag immediately. |
| Test 10 (RLS) reveala service-role bypass más broader que esperado | **Security skill early-entry** antes de más tests. |

## 7. Out-of-band notes (Docs touch list para close-out)

| File | Acción |
|---|---|
| `docs/integrations/cross-repo-webhook-v1.md` §6 | Flip status `firmed` → `implemented`, agregar PR ref |
| `docs/api-auth-matrix.md` | Agregar row para `GET /api/integrations/website/prototype-signed-read/[token]` — auth: HMAC, rate-limit: per ADR-024 D6, cache: per ADR-024 D5 |
| `docs/context/project.context.core.md` | Flip treat-as for §6 "firmed, awaiting impl" → "implemented" (sin plan-refs) |
| `docs/context/project.context.full.md` | Append endpoint a surface inventory si tal sección existe |
| Roadmap `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` | G22 status update post-merge per `feedback_keep_roadmap_in_sync` |
| `specs/fase-3-g22-prototype-signed-read-handler-impl.md` | Lifecycle closure annotation at Validator pass |

## 8. Landmines anticipados

1. **HMAC GET body problem.** Sibling `prototype-decision` es POST con body; HMAC probablemente firma body hash. GET no tiene body — sign URL path + query + timestamp. Si `website-webhook-auth.ts` is body-bound only, Backend no puede reuse verifier as-is. **Mitigación:** Analysis inspecciona `website-webhook-auth.ts` signature surface antes de escribir spec; flag como Tier-1 reading critical.

2. **Token uniqueness + collision posture.** `share_token` column added en migration 0060 pero Analysis debe verificar: (a) unique constraint or unique index, (b) generation scheme (CSPRNG length, encoding), (c) si token rotation on supersede zeroes el old token o solo set `share_token_superseded_at`. ADR-024 D3 should cover; si ambiguous, Architecture re-entry.

3. **Sanitization scope drift.** ADR-024 D4 says "inline default". Temptation será "do it properly" con shared helper. Resistir. Si real complexity emerges, escalate per §6, no silently absorb.

4. **Cache header collisions con rate-limit.** ADR-024 D5 + D6 must compose cleanly. Si `Cache-Control: public, max-age=N` returns alongside per-IP rate-limit, intermediate caches pueden serve cached body y bypass rate-limit (acceptable per ADR-024) — pero Security debe confirmar es intentional y documentado.

5. **Smoke A out-of-scope esta iteración.** PR #110 incluyó sibling smoke fire-script. Tempting escribir G22 smoke en esta iteración. **No.** Out-of-scope per ADR-024. Abrir follow-up iteration post-merge per established pattern.

6. **Develop is PR-only.** Per memory `feedback_develop_pr_only_or_local`, even tiny docs flips para §6 status deben ride this iteration's PR, no a separate mini-PR. Docs skill bundles todo en el same branch.

---

**Decision: PROCEED.** Handoff a `system-analysis` con este documento como Tier-0 input. Reading list Tier 1 + Tier 2 mandatory antes de que spec.md sea written.
