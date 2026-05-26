# Handoff 2026-05-26 — G22 prototype-signed-read handler iteration — close-out

> **Naturaleza:** close-out handoff de la iteración `fase-3-g22-prototype-signed-read-handler-impl`. Producido al cerrar Backend → Testing → Security → Docs; previo a Validator gate + PR open.

---

## 1. Scope

Iteración LITE (Router → Analysis → Backend → Testing → Security → Docs → Validator). Materializa el contract firmado por ADR-024 (D1-D7 + A1) en código ejecutable:

- Endpoint nuevo: `GET /api/integrations/website/prototype-signed-read/[token]`
- Source-of-truth contract: `docs/integrations/cross-repo-webhook-v1.md` §6
- Trigger: NoonWeb's D-slice render path (Pull pattern B.2 per ADR-023 L-2 / D8 → ADR-024 discharge) — server-to-server GET fetch on render

Cierra el último gap App-side de la Maxwell-chat lead-creation flow. Después de este PR + D-slice NoonWeb-side, el flow está completo end-to-end client-facing.

---

## 2. Chain executed

| Skill | Status | Output |
|---|---|---|
| Router | ✅ | `docs/handoffs/2026-05-26-g22-handler-router-decision.md` (LITE depth, chain skipea Architecture+Refactor) |
| Analysis | ✅ | `specs/fase-3-g22-prototype-signed-read-handler-impl.md` |
| Architecture | ⏭️ Skipped | ADR-024 ya firma contract; no design decisions remain |
| Backend | ✅ | 4 files (1 route, 1 handler-helper, 1 repository extension, 1 test) |
| Refactor | ⏭️ Skipped | Greenfield handler; no legacy code to refactor |
| Testing | ✅ | 10 unit tests passing |
| Security | ✅ | Verdict: CLEAR (0 CRITICAL, 0 HIGH, 1 MEDIUM + 3 LOW deferred) |
| Docs | ✅ | 5 docs touches (cross-repo §6 + api-auth-matrix + core.md + roadmap + this handoff) |
| Validator | ⏳ Pending | Next step |

---

## 3. Decisions firmed (immutable inputs going forward)

### 3.1 ADR-024 §Amendments A1 (2026-05-26)

Lead-context source column mapping correction:

| Response field | Mapped to |
|---|---|
| `data.leadContext.businessName` | `leads.company ?? leads.name` (handler coalesces) |
| `data.leadContext.projectTypeLabel` | `humanizeLabel(leads.maxwell_snapshot ->> 'project_type' ?? 'Sitio Web')` |

Original ADR-024 D3 referenced `leads.business_name` and `leads.project_type` columns that do not exist in the schema. Amendment chose Option A (amend ADR over schema backfill or contract drift) because the endpoint had not shipped, so NoonWeb-dev has no client implementation to break.

### 3.2 OQ-2 + OQ-3 resolved by Backend

- **OQ-2 (`getClientIp` reuse):** inline 4-line replication in `route.ts`. Tracked as S-2 deferred debt (future iteration: export from `rate-limit.ts`).
- **OQ-3 (handler-helper extraction):** extracted `serveWebsitePrototypeSignedRead` to `lib/server/website-integration.ts` (sibling location to POST handler). Discriminated-union return shape `PrototypeSignedReadServeResult` (ok / error + cache-control embedded). Tests verify the helper directly, no NextResponse marshalling needed in tests.

### 3.3 Inline humanization map

`PROTOTYPE_PROJECT_TYPE_LABELS` in `website-integration.ts` — 8 entries normalized (`landing`, `landing_page`, `webapp`, `web_app`, `ecommerce`, `e_commerce`, `sitio_web`, `website`). Default `'Sitio Web'` on unknown or missing. Lives inline per ADR-024 D4 + spec §"Project-type label derivation". If grows to >5 expected values or needs localization, future iteration extracts to `lib/maxwell/project-type-labels.ts`.

---

## 4. Security verdict

**CLEAR** — agent verdict 2026-05-26.

| ID | Severity | Status | Description |
|---|---|---|---|
| S-1 | MEDIUM | Deferred (debt) | Document invariant: helper owns all 500 mapping; never throw `ApiError` with raw DB messages |
| S-2 | LOW | Deferred (debt) | Inline `getClientIp` duplicate; future iteration export from rate-limit.ts |
| S-3 | LOW | No action | Forbidden-substring test redundancy — positive allowlist is the structural defense, test is adequate |
| S-4 | LOW | Acknowledged | Token enumeration via rate-limit timing — ~122-bit CSPRNG + HMAC gate make this infeasible |
| S-5 | INFO | Acknowledged | Edge-cache + rate-limit budget composition per ADR-024 D6+D7 |
| S-6 | INFO | Acknowledged | Zero-body HMAC signing input robustness; replay benign on idempotent GET |
| S-7 | INFO | Acknowledged | Service-role bypass intentional and scope-bounded |
| S-8 | INFO | Acknowledged | 8-char token prefix in logs is forensic-safe |
| S-9 | INFO | Acknowledged | Maxwell-snapshot poisoning vector closed by typeof checks + default |
| S-10 | INFO | Acknowledged | Lifecycle ordering does not leak token existence (HMAC-gated) |

**No CRITICAL / HIGH unresolved. Validator NOT blocked by Security.**

---

## 5. Test coverage (AC-1..AC-14)

| AC | Description | Status |
|---|---|---|
| AC-1 | Happy 200 (pending decision) | ✅ Unit test |
| AC-2 | Happy 200 (accepted decision) | ✅ Unit test |
| AC-3 | Happy 200 (rejected decision; notes echoed verbatim) | ✅ Unit test |
| AC-4 | 404 `PROTOTYPE_READ_TOKEN_NOT_FOUND` | ✅ Unit test |
| AC-5 | 410 `PROTOTYPE_READ_TOKEN_SUPERSEDED` | ✅ Unit test |
| AC-6 | 410 `PROTOTYPE_READ_LEAD_DELETED` (precedes superseded check) | ✅ Unit test |
| AC-7 | 401 HMAC mismatch | ⏭️ Reused from `tests/server/website-webhook-auth.test.ts` (per spec line 137) |
| AC-8 | Sanitization allowlist (12 forbidden field names absent from serialized body) | ✅ Unit test (grep-asserts) |
| AC-9 | Cache header byte-exactness (`private, max-age=30, stale-while-revalidate=60` on 200; `no-store` on errors) | ✅ Unit test |
| AC-10 | RLS posture defense-in-depth | ⏭️ Deferred to operator manual SQL post-merge per spec line 142 |
| AC-11 | GET idempotency (deep-equal bodies modulo serverTime) | ✅ Unit test |
| AC-12 | Rate-limit 429 | ⏭️ Reused from `tests/server/api/rate-limit.test.ts` (in-memory engine path) |
| AC-13 | Project gates green | ✅ tsc clean, eslint clean, tsx --test 525/525 |
| AC-14 | Docs touches landed | ✅ This handoff lists all 5 |

**Suite total: 525 pass / 0 fail (515 baseline + 10 new G22).**

---

## 6. Debts diferidos (no blocking)

### 6.1 Security debts

See §4 above. S-1 (MEDIUM) is a documentary debt; S-2 (LOW) is a future-iteration cleanup.

### 6.2 Test debts (deferred per spec)

- AC-10 RLS live SELECT-as-anon defense-in-depth check (no anon-role SELECT harness in repo).
- AC-12 G22-specific rate-limit test (reused infra from `rate-limit.test.ts` is sufficient for LITE scope).

### 6.3 Out-of-scope per spec

- **Smoke A G22 fire-script** — sibling pattern to `2026-05-26-smoke-a-prototype-decision-fire.mjs`. Open follow-up iteration post-merge per established pattern (per spec §"Scope-out" line 93 + Landmine #5 of router decision).
- **`lib/security/project-isolation.ts` shared sanitization helper** — ADR-024 D4 E-1 conditional; not triggered (inline allowlist is ~30 lines).
- **NoonWeb-side D-slice render** — different repo (`noon-web-main`), different owner. Unblocked by this iteration.
- **No new env vars, no new migrations, no `database.types.ts` regen** — all required columns from migration 0060.

---

## 7. Docs touches landed (5)

1. `docs/integrations/cross-repo-webhook-v1.md` §6 status banner: `firmed by ADR-024 (2026-05-25)` → `Endpoint shipped 2026-05-26`. Also §14 references row update + §15 open issues row strike-through.
2. `docs/api-auth-matrix.md`: new row for `GET /api/integrations/website/prototype-signed-read/[token]` (HMAC zero-body signing, rate-limit 60/min combined key, cache headers, transport ledger declined-by-design).
3. `docs/context/project.context.core.md` line 459: "future endpoint" → "implemented fourth inbound entry" + ADR-024 §Amendments A1 reference + file pointers.
4. `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §16 G22 row flip + §17 snapshot 2026-05-26 late night at top.
5. This handoff (`docs/handoffs/2026-05-26-g22-handler-closure.md`).

---

## 8. Próximos pasos concretos

### 8.1 Inmediato (esta sesión)

1. **Validator gate** — invoke `system-validator` with this handoff + spec + ADR-024 + Backend commit `2888fb2` + Security verdict + Docs touches + suite green.
2. **PR open** — `gh pr create` from `feat/g22-prototype-signed-read-handler` → `develop`. NO auto-merge per memory rule. Operator merges post-CI green.

### 8.2 Próxima sesión natural

- **Path A — NoonWeb desbloqueado completo**: NoonWeb-dev arranca D-slice render `/maxwell/prototipo/[token]`. App-side está completo.
- **Smoke A G22** — sibling fire-script para validar el endpoint contra production. Patrón heredado de PR #110.
- **Bilateral smoke test** — NoonWeb-dev confirma su D-slice render contra App preview/prod.
- **NoonWeb-dev acknowledgment** del §6 wire contract — still pending per memory rule. Wire shape no cambió por A1; recordatorio recovery-friendly.

---

## 9. Landmines del handoff

- **Endpoint público nuevo en surface.** Aunque HMAC-gated, log carefully (8-char token prefix only — no full token leak).
- **`getClientIp` duplicado en `route.ts:24-32`** (S-2) — drift risk si `lib/server/api/rate-limit.ts:36-44` cambia. Mitigated por inline comment + S-2 tracking.
- **Service-role bypass intentional** — RLS no aplica al endpoint (HMAC-only auth). Defense-in-depth check via manual SQL (AC-10) deferred a operator post-merge.
- **Cache eventual-consistency window** — `private, max-age=30, stale-while-revalidate=60` significa 30-90s window during supersede. Write-side 410 sobre POST `prototype-decision` (§5) sigue siendo authoritative guard.
- **Humanization map default `'Sitio Web'`** — si el client espera siempre el label correcto, malformed snapshots fallback silenciosamente. Documented as acceptable behavior per ADR-024 §Amendments A1.
- **ADR-024 §Amendments A1** vivo — futuras Architecture iterations MUST read A1 before referencing `leads.business_name` or `leads.project_type` (don't exist).

---

## 10. Referencias

### Documentos firmados / amended esta sesión

- `specs/fase-3-g22-prototype-signed-read-handler-impl.md` (Analysis output)
- `docs/handoffs/2026-05-26-g22-handler-router-decision.md` (Router decision)
- `docs/adrs/ADR-024-prototype-signed-read-cross-repo-contract.md` §Amendments A1 (lead-context column mapping)
- `docs/integrations/cross-repo-webhook-v1.md` §6 status + §14 + §15
- `docs/context/project.context.core.md` line 459
- `docs/api-auth-matrix.md` new endpoint row
- `D:\Pedro\archivos-pedro\noon-app\roadmap\noonapp-roadmap.md` §16 G22 + §17 snapshot

### Code artifacts (Backend commit `2888fb2`)

- New: `app/api/integrations/website/prototype-signed-read/[token]/route.ts`
- New: `tests/server/api/integrations/website/prototype-signed-read.test.ts`
- Modified: `lib/server/website-integration.ts` (added `serveWebsitePrototypeSignedRead` + helpers + cache constants)
- Modified: `lib/server/prototypes/repository.ts` (added `getPrototypeWorkspaceByShareToken` + `countPrototypeWorkspaceVersionForLead` + `PrototypeSignedReadRow` interface)

### Predecessor handoffs

- `docs/handoffs/2026-05-25-b-c-slice-and-g22-closure.md` — B+C slice closure (PR #110) + G22 spec closure (signed 2026-05-25)
- `docs/handoffs/2026-05-25-maxwell-chat-cross-repo-contracts-noonweb-handoff.md` — NoonWeb-dev handoff (now flagged with A1 amendment notice)

---

**Cierre operativo:** Validator gate + PR open son los dos pasos restantes antes de que el operator pueda mergear. App-side completamente cerrado para la Maxwell-chat lead-creation flow.
