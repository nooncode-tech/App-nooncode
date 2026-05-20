# B26 — Infra review (schema_migrations gating endpoint health)

**Date:** 2026-05-20
**Iteration:** B26 — schema_migrations drift gating endpoint health
**Reviewer role:** system-infra (consultative co-sign per LITE-depth chain: analysis → architecture → backend → testing → security → infra → docs → validator)
**Depth:** LITE — proportional review for an admin-gated, read-only, internal health endpoint. No pipeline / runtime / env-var changes ship in this iteration; infra runs as consultative co-sign, not primary implementation.
**Verdict:** **READY-TO-MERGE WITH WARNINGS.** No infra change required for B26 itself; one carry-over deployment risk (G11 reopened post repo-private flip) recorded as a warning that affects how the merge lands on production, not whether the code is sound.

## Scope

The review covers infra-side concerns for the B26 endpoint as shipped:

- Status-code semantics (200 / 503 / 500) vs Vercel serverless function lifecycle behavior.
- `outputFileTracingIncludes` correctness in `next.config.mjs` against Next 16.2.6 config schema.
- Rate-limit / WAF posture against an admin-gated `/api/admin/**` endpoint.
- R5 (cross-schema SELECT permission) preview-verify checklist for the operator.
- R6 (Vercel bundle inclusion) preview-verify checklist for the operator.
- Operator runbook entry for the 503 drift response.
- Bundle-size sanity check after `outputFileTracingIncludes` activates.
- G11 (Vercel auto-deploy regression) carry-over risk for the merge itself.
- Confirmation that cron / dashboard / external consumer wiring is OUT of scope.

Out of scope (handled by other gates / future iterations):

- Live preview-deploy verification of R5 + R6 — operator-driven post-merge per ADR-017 §D5 (this skill writes the checklist; the operator runs it).
- Cron / dashboard / external-probe consumer wiring — explicitly excluded per spec §Scope Boundary → §Excluded.
- A standalone migration to add a GRANT if R5 fires — pre-authorized as a follow-up iteration per ADR-017 §Risk register row R5 + B26-SEC-F3 in security review.
- NoonWeb side (no cross-repo coupling, intentionally — ADR-017 §D7).

## Reference

- Spec `specs/fase-2-c-b26-schema-migrations-gating-endpoint-health.md` (§Success Criterion, §Risks R5/R6, §Scope Boundary).
- ADR-017 `docs/adrs/ADR-017-schema-migrations-drift-gating-endpoint.md` (§D2 status mapping, §D3 auth posture, §D5 bundling strategy, §Risk register).
- Testing review `docs/validations/B26 testing review 2026-05-20.md` (verdict SUFFICIENT; F-1 informational count drift 51 → 55; §R5 / R6 preview-verify checklist baseline).
- Security review `docs/validations/B26 security review 2026-05-20.md` (verdict GATE-OPEN; S7 rate-limit posture LOW; S8 bundle-size spot check < 500KB; B26-SEC-F3 conditional-MEDIUM pre-authorization for the deferred R5 GRANT iteration).
- ADR-006 `docs/adrs/ADR-006-migration-prefix-convention-and-rename.md` (KNOWN_COLLISION_FILES source).
- ADR-014 `docs/adrs/ADR-014-migration-ledger-reconciliation.md` (EXPECTED_ORPHAN_LEDGER_NAMES source; the manual-reconciliation playbook the operator follows on 503).
- B15 security review `docs/validations/B15 security review 2026-05-20.md` (structural template parity).
- `docs/runbooks/cutover-pilot.md` §5.3 (G11 historical narrative; §0 caveat about manual redeploys).
- Implementation files reviewed: `next.config.mjs`, `app/api/admin/migrations-health/route.ts`, `lib/server/migrations/ledger-adapter.ts`.

## I-1 — Status-code semantic verification (200 / 503 / 500 vs Vercel)

**Question:** does Vercel's serverless platform interpret a `503` response from a function invocation as a signal to mark the function unhealthy, remove it from the routing pool, or trigger auto-restart — which would defeat the deploy-gate purpose of the endpoint?

**Verification:**

- Vercel's serverless function model is **stateless per-invocation**. Each invocation runs a fresh-ish function instance (warm or cold) and the platform does NOT inspect the response body or status code to decide whether to keep the instance, recycle it, or remove it from any pool. There is no Kubernetes-style liveness/readiness probe model on Vercel serverless. A function returning `503` to invocation N has zero effect on whether invocation N+1 is served.
- The Vercel Edge Network routing is **DNS + region-pinning + cold-start latency budget**, not response-code based. Routing decisions happen before the function executes; the function's response status is forwarded verbatim to the client.
- Auto-restart in Vercel terminology means **redeploying the function code**, which requires a git push / deploy-hook trigger; it is never response-driven.
- Background functions (Vercel Cron, fluid compute, etc.) similarly do not react to a function's HTTP status by recycling instances; the status is returned to the caller (cron scheduler logs the result, but no infra-side action).

**Conclusion:** `503 Service Unavailable` is a safe deploy-gate signal on Vercel. The status is faithfully delivered to whoever called the endpoint (today: the operator's browser or curl). The function instance is not recycled, removed from any pool, or marked unhealthy by the platform. The deploy-gate consumer (today operator; tomorrow possibly a CI script or cron probe per ADR-017 §D3 follow-up) can interpret `503` as "do not promote" without parsing the body.

`500 Internal Server Error` for the `MIGRATIONS_READ_FAILED` and `MIGRATIONS_BUNDLE_MISSING` codes is similarly safe — same per-invocation behavior. The distinction between `503` (drift exists) and `500` (cannot determine drift state) is preserved end-to-end from the function to the caller.

**ADR-017 §D2 status mapping locks in:** 200 synced / 503 drift / 500 read failure. This mapping is confirmed Vercel-compatible.

**Note for future:** if a future iteration adds Vercel's optional "Health Check" deployment configuration (e.g., `headers` blocking deploys that return 5xx on a path), this endpoint MUST be excluded from that check — its whole purpose is to legitimately return 503. Today no such config exists in `next.config.mjs` or in Vercel project settings (verified via review of `next.config.mjs` headers block — only static security headers are emitted).

**Verdict:** PASS. No conflict with Vercel platform semantics. No escalation to architecture.

## I-2 — `outputFileTracingIncludes` correctness verification

**Question:** is the `outputFileTracingIncludes` entry in `next.config.mjs` correctly keyed, located at the right config level for Next 16.2.6, and pointed at the right glob?

**Verification:**

- Project Next.js version: **16.2.6** (`package.json:"next": "16.2.6"`).
- Next 16 schema location for `outputFileTracingIncludes`: **top-level** of `nextConfig`, NOT under `experimental.*`. Verified directly against `node_modules/next/dist/server/config-schema.js:668`:

  ```js
  outputFileTracingIncludes: _zod.z.record(_zod.z.string(), _zod.z.array(_zod.z.string())).optional(),
  ```

  The `experimental` block is defined separately (line 547) and does not contain `outputFileTracingIncludes` in Next 16 — that location belongs to Next 13/14. Backend's choice of top-level placement is correct for the project's Next version.

- Config shape per schema: `Record<string, string[]>` where the key is the route path and the value is an array of glob patterns (paths or globs to include). Backend's entry at `next.config.mjs:54-56`:

  ```js
  outputFileTracingIncludes: {
    '/api/admin/migrations-health': ['./supabase/migrations/**/*.sql'],
  },
  ```

  - Key `'/api/admin/migrations-health'` matches the route path under `app/api/admin/migrations-health/route.ts`. Correct.
  - Glob `'./supabase/migrations/**/*.sql'` matches all `.sql` files under the migrations directory recursively. Today the migrations directory is flat (no subdirectories — verified by Glob), so the `**` recursion is harmless future-proofing. Correct.
  - Path is relative-to-project-root (Next.js resolves trace-includes relative to the project root, not the route's `app/` directory). Correct.

- Sanity check: backend's `npm run build` (per testing review §Gate re-validation) succeeded with the route listed as `ƒ /api/admin/migrations-health` in the build output. Next.js would have surfaced a config-schema validation error at build time if `outputFileTracingIncludes` were placed under the wrong key or had the wrong value shape — it did not.

- Empirical bundle-inclusion confirmation is the R6 operator smoke (see I-5 below). Static config-shape correctness is confirmed here; runtime effectiveness is confirmed on the first preview deploy.

**Verdict:** PASS. Config entry is correctly keyed (top-level), correctly typed (Record), correctly globbed, and correctly scoped to the single route. No escalation to backend.

## I-3 — Rate-limit / WAF posture confirmation

**Question:** the route does NOT opt into the shared `@upstash/ratelimit` infrastructure (per security review S7 / F-2). Is this intentional for an admin-gated endpoint? Could Vercel-layer WAF or DDoS-mitigation rules block legitimate admin traffic?

**Verification:**

- Admin-only via `requireRole(['admin'])` is the only gate (route.ts:45). No per-route rate-limit, no project-level `middleware.ts` rate-limit (verified by Glob for `middleware.{ts,js,mjs}` at project root — none present).
- This matches the project's pattern for other admin-gated endpoints (`app/api/admin/earnings/consolidate/route.ts` uses the same posture: admin gate only, no per-route Ratelimit). Consistent with B15 / B1 / ADR conventions.
- Cost per call is cheap (S7 quantified: < 1ms `readdir` + ~30-100ms Supabase SELECT). An authenticated admin DoS'ing this endpoint is bounded by Supabase's per-project rate ceiling, not by this endpoint's missing limiter. No fan-out, no external service hits.
- Vercel WAF: the project is on Vercel's standard plan (per `cutover-pilot.md` §0 — Vercel project `App-nooncode`). Standard plan does NOT include the optional Vercel WAF / Firewall product with custom rule sets. Vercel's default DDoS mitigation operates at the network edge and is keyed on traffic volume / pattern signatures (e.g., flood from a single IP), not on URL path matching. There is no documented or default rule that would block `/api/admin/*` GET traffic from a logged-in admin.
- Vercel Deployment Protection is active on the production URL (per Operating rules entry from B-rate-limiter verification). Deployment Protection gates **access to preview deployments** via SSO / token; it does not block admin paths on production. Admin smoke against production goes through the production alias (`nooncode-app-pi.vercel.app`) which is not protected; preview smoke requires either the protection bypass token header (`x-vercel-protection-bypass`) or an SSO login.

**Conclusion:** intentional and consistent with project posture. No legitimate admin traffic will be blocked by Vercel-layer rules. Carry-forward debt: when the ADR-017 §D3 internal-token follow-up materializes a non-admin consumer, per-route rate-limiting becomes mandatory (per security review B26-SEC-F2). Not material today.

**Verdict:** PASS. Rate-limit posture is admin-gate-equivalent and matches project conventions. WAF posture is the Vercel default (no custom rules). No escalation.

## I-4 — R5 preview-verify checklist (cross-schema SELECT permission)

This is the operator-runnable checklist for the first preview-deploy hit. R5 is "the service-role client may need a GRANT to SELECT from `supabase_migrations.schema_migrations`." Today the assumption (ADR-017 §Risk register) is that the service-role has unrestricted schema access by Supabase default, but it has never been empirically verified on `pdotsdahsrnnsoroxbfe`. The first preview hit is the verification.

### Steps (run after preview deploy, before merging to develop)

1. **Wait for preview to deploy.** After pushing the B26 branch, Vercel emits a preview URL like `https://app-nooncode-git-fase-2-c-b26-...vercel.app` (or similar). Per G11 carry-over (see I-9 below), preview auto-deploys may also be unreliable — if no preview URL is emitted within ~5 minutes of push, manually trigger via Vercel Dashboard → Deployments → "Redeploy" against the branch head.

2. **Resolve preview Deployment Protection.** Two paths:
   - **Path A (recommended for human smoke):** open the preview URL in a browser. Vercel SSO prompts for login; authenticate with the project's Vercel account.
   - **Path B (for scripted smoke):** use the project's protection bypass token in a `x-vercel-protection-bypass` header on the curl request. Token lives in the Vercel project's Deployment Protection settings.

3. **Sign in as an admin in the preview environment.** Navigate to the preview's `/login` and authenticate with an admin-role profile. The preview shares the production Supabase project (`pdotsdahsrnnsoroxbfe`), so admin sessions issued in production are NOT valid in the preview — log in fresh with admin credentials.

4. **Hit the endpoint.** With the admin session active in the same browser, open `<preview-url>/api/admin/migrations-health` directly in a new tab (GET), or `curl` it with the session cookie attached.

5. **Interpret the response:**

   | Response | Meaning | Action |
   |---|---|---|
   | **HTTP 200**, body has `data.synced === true`, `data.summary.filesystem_count === 55`, `data.summary.ledger_count === 53`, `data.summary.grandfathered_collisions_count === 4`, `data.summary.expected_orphans_count === 6`, `data.summary.unexpected_drift_count === 0`, `data.summary.missing_in_ledger_count === 0` | R5 closed (service-role can SELECT), R6 closed (bundle is correctly included), endpoint operational | **Proceed to merge.** Re-run the smoke against production after merge lands; same expected response. |
   | **HTTP 500**, body has `error: "Could not read the schema migrations ledger: ..."` and `code: "MIGRATIONS_READ_FAILED"`, message contains `permission denied for schema supabase_migrations` (or PostgREST equivalent, `42501`) | **R5 fired.** Service-role lacks the SELECT grant on the `supabase_migrations` schema. | **DO NOT MERGE B26 AS-IS.** Escalate iteration to FULL per ADR-017 §Risk register row R5: backend authors a GRANT migration (`GRANT USAGE ON SCHEMA supabase_migrations TO service_role; GRANT SELECT ON supabase_migrations.schema_migrations TO service_role;` — exact statement per backend); system-security reviews the GRANT scope per B26-SEC-F3 (standalone iteration, standalone spec, standalone security review with REVOKE rollback documented); system-infra signs off; only then the migration ships ahead of B26 (or as part of an escalated B26-FULL). |
   | **HTTP 500**, body has `code: "MIGRATIONS_READ_FAILED"`, message NOT containing `permission denied` (transient PostgREST or network error) | Likely transient. | Retry once. If reproducible, check Supabase status dashboard. If persistent and not permission-related, escalate to backend. |
   | **HTTP 500**, body has `code: "MIGRATIONS_BUNDLE_MISSING"` | R5 not testable yet (R6 fires first). | See I-5 R6 checklist; resolve R6 first, then re-run R5. |
   | **HTTP 401** | Auth gate not wired correctly OR session not active | Re-verify admin session in the preview (sign in again). If the auth gate is genuinely failing for a logged-in admin → escalate to backend. |
   | **HTTP 403** | Logged-in user is not admin-role | Confirm the role on the logged-in profile via Supabase Dashboard → Authentication; promote to admin if needed; re-run. If a confirmed admin still gets 403 → escalate to backend (likely a `requireRole` regression). |

6. **Record the verdict** in the close-out evidence — the response body, status code, and timestamp — so docs / validator can confirm the iteration's success criterion 5 (production smoke returns synced=true).

### What R5 closure looks like

The cross-schema SELECT succeeds because the service-role JWT issued by Supabase has the standard `supabase_admin` privilege equivalent, which includes USAGE on the `supabase_migrations` schema and SELECT on its `schema_migrations` table by default. This is the assumed posture per ADR-017. If true → no GRANT needed, B26 ships as-shipped. Empirically confirmed when the smoke returns 200.

## I-5 — R6 preview-verify checklist (Vercel bundle inclusion)

R6 is "the `supabase/migrations/` directory may not be bundled into the function runtime; `readdir` returns 0 entries; the endpoint false-positives every disk file as drift." The defensive `MigrationsBundleConfigError` guard in `ledger-adapter.ts:118-121` turns silent false-positive into a loud 500 with `code: 'MIGRATIONS_BUNDLE_MISSING'`. The first preview hit empirically confirms the `outputFileTracingIncludes` config is effective.

### Steps (run alongside I-4 R5 smoke — same browser session, same request)

1. From the same response read in I-4 step 4, check `data.summary.filesystem_count`.

2. **Interpret:**

   | `filesystem_count` value | Meaning | Action |
   |---|---|---|
   | **55** | R6 closed. Bundle includes all 55 `.sql` files. `outputFileTracingIncludes` is effective. | Proceed. |
   | **0** AND HTTP 500 with `code: "MIGRATIONS_BUNDLE_MISSING"` AND error message containing `next.config.mjs outputFileTracingIncludes` hint | **R6 fired** in the most plausible failure mode (config didn't take effect). | **DO NOT MERGE.** Backend investigates: verify the config entry shape against Next 16 schema (I-2 above confirms it's correct, so the issue is more likely glob or path); verify `process.cwd()` resolves to the project root on Vercel (it should — Vercel sets cwd to the deployed package root); verify the route key matches the deployed route path exactly. Fix `next.config.mjs`, redeploy preview, re-verify. |
   | Between 1 and 54 (partial inclusion) | Bundle is partially included. | Backend investigates which files were excluded. Most likely cause: glob excludes files at certain prefixes, or the glob pattern is subtly wrong. Fix and re-verify. Bundle accuracy is required for the endpoint's correctness — partial-inclusion is just as bad as zero-inclusion because some real drift could be masked by missing files. |
   | Greater than 55 | Unexpected — additional `.sql` files in the bundle from a sibling location | Investigate; not a security risk, but the diff function would report the extra files as `missing_in_ledger`. Fix the glob to scope only to `supabase/migrations/`. |

3. **Combined success target after R5 + R6 close:** the response body matches the JSON sample in the testing review §"Combined success target (post-merge production)" — `filesystem_count: 55`, `ledger_count: 53`, `grandfathered_collisions_count: 4`, `expected_orphans_count: 6`, `unexpected_drift_count: 0`, `missing_in_ledger_count: 0`, arrays populated only with the 4 ADR-006 §B2 filenames and the 6 ADR-014 §Orphans names. `data.synced === true`.

### Why R6 cannot be tested in unit tests (acceptable per LITE)

The `outputFileTracingIncludes` effect is a Next.js build-time pipeline behavior on the Vercel platform. There is no unit-test surface that exercises it; the only test is the live deploy. ADR-017 §D5 explicitly accepts this as the operator-driven verification. The defensive guard ensures that a misconfig surfaces as a loud 500 with a specific error code (`MIGRATIONS_BUNDLE_MISSING`), not as a silent false-positive drift report — that is the test-substitute.

## I-6 — Operator runbook entry for 503 drift response

When the endpoint returns `503` (synced=false, unexpected drift), what does the operator do? This is operator-facing documentation that gets lifted into `docs/runbooks/` or `docs/context/project.context.core.md` by system-docs in this chain.

### When the endpoint returns 503

The body looks like:

```jsonc
{
  "data": {
    "synced": false,
    "summary": {
      "filesystem_count": 56,                            // 55 plus the new file
      "ledger_count": 53,                                // unchanged
      "grandfathered_collisions_count": 4,
      "expected_orphans_count": 6,
      "unexpected_drift_count": 1,                       // the new mismatch
      "missing_in_ledger_count": 1                       // or unexpected_drift_orphans_count
    },
    "missing_in_ledger": ["0052_phase_21a_new_thing.sql"],
    "unexpected_drift_orphans": [],
    "grandfathered_collisions": [/* 4 expected */],
    "expected_orphans": [/* 6 expected */],
    "checked_at": "2026-MM-DDTHH:MM:SS.SSSZ"
  }
}
```

Two diagnostic arrays drive the operator's response:

### Case A — `missing_in_ledger` is non-empty

Meaning: a `.sql` file exists on disk under `supabase/migrations/` but its `name` is not in `supabase_migrations.schema_migrations`. The migration was authored locally (committed to git) but never applied to remote OR was applied via Dashboard SQL Editor without the manual ledger row insert.

**Operator response** (follows ADR-014's playbook):

1. **Identify the file.** From the response body, get the filename (e.g., `0052_phase_21a_new_thing.sql`).
2. **Decide which apply path:**
   - **Path A1: MCP fresh.** If the operator has a recently-authenticated Supabase MCP session (`mcp__supabase__apply_migration` available), use it: `mcp__supabase__apply_migration` with the file's contents. MCP applies the SQL AND inserts the matching ledger row in one atomic operation. Re-hit `/api/admin/migrations-health` to confirm `synced=true`.
   - **Path A2: Dashboard fallback (when MCP is stale or unavailable).** Open Supabase Dashboard → SQL Editor → paste the file's contents → Run. Then in a separate SQL Editor query, INSERT the ledger row manually:

     ```sql
     INSERT INTO supabase_migrations.schema_migrations (version, name)
     VALUES ('0052', 'phase_21a_new_thing');
     ```

     (The `version` is the 4-digit prefix; the `name` is the slug without prefix or `.sql` extension. Per ADR-014's reconciliation convention.) Re-hit the endpoint to confirm `synced=true`. If `synced=false` persists with the same file in `missing_in_ledger`, the INSERT did not commit or used the wrong `name` — re-verify.
3. **Audit trail.** Record the apply (commit SHA + timestamp + path used) in the iteration's close-out or in the operator's session notes. The B26 endpoint surfaces the drift but does NOT persist an audit log of remediation.

### Case B — `unexpected_drift_orphans` is non-empty

Meaning: a row exists in `supabase_migrations.schema_migrations` whose `name` is neither a disk file nor in `EXPECTED_ORPHAN_LEDGER_NAMES`. The migration was applied to remote but no `.sql` file exists locally. This is the more dangerous direction — the next `supabase db push` from a clean checkout would NOT re-apply the orphan (good), but the schema state is anchored to code that doesn't exist in the repo.

**Operator response:**

1. **Identify the orphan.** From the response body's `unexpected_drift_orphans` array, get the ledger `name` (e.g., `phase_22x_orphan_thing`).
2. **Decide intent:**
   - **Path B1: should-be-grandfathered.** If the orphan is a legitimate pre-CLI-convention migration that should join the 6 already in `EXPECTED_ORPHAN_LEDGER_NAMES`, this is an ADR-014 amendment. Open ADR-014 → append the name to §Orphans with the verification evidence (Dashboard SQL Editor screenshot or query result). Then update `lib/server/migrations/known-exceptions.mjs` to add the name to the `EXPECTED_ORPHAN_LEDGER_NAMES` set. This is a 2-line code change + an ADR amendment; ships as a small iteration. After the change deploys, re-hit the endpoint — the row should now classify as `expected_orphans` (not drift). **Note:** this path mutates the project's known-exceptions set. Do not use it for transient drift; only for true grandfathering decisions that need a durable ADR home.
   - **Path B2: should-have-a-file.** If the orphan represents work that should be in the repo but isn't (e.g., a migration applied to remote was never committed), the operator authors the matching `.sql` file under `supabase/migrations/`, commits, and the next deploy carries it. The endpoint reclassifies the row as a matched pair (no drift).
   - **Path B3: should-be-removed.** If the orphan represents a misapplied migration (wrong project, wrong environment, applied by mistake), the operator may DELETE the row from `supabase_migrations.schema_migrations` via Dashboard SQL Editor. **Caution:** this is destructive. Verify the schema state does not depend on the orphan's effect before removing the row. ADR-014 documents the 6 expected orphans as "intentionally retained to prevent re-application"; removing an orphan without first verifying its schema effect risks the next `supabase db push` re-applying it.
3. **Audit trail.** Same as Case A — record the apply path and the orphan's outcome.

### Case C — both arrays non-empty

Both Case A and Case B apply. Address Case A first (it's the more common path), re-hit, then handle Case B.

### Case D — endpoint returns 500 with `MIGRATIONS_READ_FAILED` or `MIGRATIONS_BUNDLE_MISSING`

This is not a drift response; the endpoint cannot determine drift state. See I-4 R5 / I-5 R6 checklists. Do not interpret as drift.

### What the endpoint does NOT do

- It does not insert missing ledger rows automatically. Remediation is always operator-driven.
- It does not DELETE orphan rows automatically.
- It does not retry. Hitting the endpoint twice in a row returns the same result (modulo the `checked_at` timestamp).
- It does not alert. There is no out-of-band notification; the operator must actively hit the endpoint or read the response of a future automated probe.
- It does not cache. Every call re-reads the filesystem AND re-queries the ledger.

**System-docs decision:** lift this runbook section into either a new file `docs/runbooks/migrations-health.md` OR fold it into `docs/context/project.context.core.md` Operating rules as a single-paragraph operator rule. Both are acceptable; my recommendation is the Operating rules path — the iteration is operator-light and a dedicated runbook may be over-engineering for an admin endpoint that's hit on-demand, not on a schedule. System-docs decides per project documentation discipline.

## I-7 — Bundle-size sanity check

**Question:** does the `outputFileTracingIncludes` addition push the route's serverless function bundle over Vercel's hard limit (50MB unzipped) or close to operational risk (≈10MB practical recommendation)?

**Verification:**

- 55 `.sql` files in `supabase/migrations/`. Typical sizes 1-10KB each, occasional larger files at 20-50KB for migrations with embedded function definitions (`0040`, `0042`, `0048`, `0049`, `0050` — RPC hardening + RPC additions).
- Estimated total: **~250-500KB** uncompressed, well under 1MB even on the high side.
- Vercel serverless function hard limit (Hobby + Pro plans): 50MB unzipped per function. The route's existing bundle (Next.js handler + Supabase SDK + auth helpers + transitive deps) is dominated by `node_modules` and is typically in the 5-15MB range for routes in this project. Adding 500KB of `.sql` files brings it nowhere near the limit.
- Vercel "smart practice" threshold (their docs note cold-start latency increases with bundle size): ≈10MB. The B26 bundle stays comfortably below.
- Security review S8 also performed an embedded-secret spot-check across the 55 `.sql` files: zero hits for credential patterns (`password=`, `api_key=`, `sk_live`, `sk_test`, `whsec_`, `postgres://`, bearer tokens). The bundle is content-clean.

**Conclusion:** bundle-size growth is **negligible**. No operational risk. No infra escalation.

**Future watch:** the `.sql` file count grows monotonically with each merged migration. Today 55; at 200 the bundle size would still be < 2MB and well under limits. At ≈5000 files (impractical for a SaaS project), bundle inflation could become material — but that is not a realistic concern for this project in the foreseeable future. No proactive limit-monitoring needed.

**Verdict:** PASS. Bundle stays well under all Vercel limits.

## I-8 — G11 carry-over deployment risk

**Background:** G11 = "Vercel auto-deploys do not fire reliably on merges to `develop`." Originally registered 2026-05-15; cutover-pilot runbook §5.3 lists it as RESOLVED 2026-05-17 (root cause: Production Branch misconfigured to `main` + Preview-locked env vars on `develop`). The task brief states the current session re-confirmed empirically that auto-deploys are broken again post repo-PRIVATE flip — meaning G11 has effectively **reopened** after the public→private toggle on 2026-05-18, with the same `incorrect_git_source_info` symptom as before.

**Implication for B26:**

When the operator merges this PR to `develop`, **the auto-deploy will likely NOT fire**. Two mitigation paths exist:

### Path A — Band-aid (matches the documented sequence for the current PUBLIC→PRIVATE-pending state)

If the repo is still PUBLIC at merge time (or temporarily flipped public for the deploy):

1. Merge the PR to `develop`.
2. In Vercel Dashboard → Project `App-nooncode` → Deployments → click "Redeploy" on the latest commit, ensure "Use existing Build Cache" is **unchecked**.
3. Wait for the deploy to land (~2-3 minutes).
4. Run I-4 R5 + I-5 R6 smoke against the new production deployment.

If the repo was flipped to PRIVATE post the public-window per Operating rules:

1. Flip repo back to PUBLIC (Vercel's GitHub App needs read access).
2. In Vercel Dashboard → trigger Redeploy as above.
3. After deploy lands and smoke passes, flip repo back to PRIVATE.
4. The same Operating rules constraint applies: the public window must be minimized.

### Path B — Correct fix (one-time, ahead of the next merge)

Re-grant Vercel's GitHub App access at GitHub → Settings → Applications → Installed GitHub Apps → Vercel → Repository access → grant `nooncode-org/App-nooncode`. This restores the App's webhook delivery for push events on `develop`, which re-enables auto-deploys without needing the band-aid. Once this lands, B26 (and all future B-codes) can merge without manual redeploy intervention.

**Recommendation:** Path B is the right long-term fix; the band-aid (Path A) is acceptable for B26 specifically if the operator wants to ship B26 today without resolving the GitHub App access issue first.

**Status as deployment risk:** this is a process-level / platform-level risk, not a code-level risk. The B26 code is sound. The risk is that the merge lands in `develop` but does NOT propagate to production until the operator runs Path A or Path B. The endpoint cannot smoke-verify until the deploy happens.

**Recorded as a warning, not a blocker.** The B26 iteration verdict is READY-TO-MERGE WITH WARNINGS — the warnings are this G11 carry-over and the dependent R5/R6 empirical confirmation gate at I-4/I-5.

**Note for system-docs:** the Operating rules in `project.context.core.md` already capture the public→private repo state. If the band-aid path is used for B26, no new docs entry needed. If Path B (correct fix) is executed, system-docs should record the G11 closure verbatim and strike the corresponding caveat in cutover-pilot runbook §5.3 + §0. Not in scope for system-infra to write that update; flagging for system-docs awareness.

## I-9 — Out-of-scope confirmation

Per spec §Scope Boundary → §Excluded and ADR-017 §"Why future extensibility is documented but not built":

| Item | Scope status | Future-iteration owner |
|---|---|---|
| Cron probe wiring (Vercel Cron, Upstash QStash, external uptime probe) | OUT — explicitly excluded | Future iteration if/when a consumer materializes |
| Dashboard / UI route consuming this endpoint | OUT — explicitly excluded | Future iteration; would need system-frontend in the chain |
| External consumer (CI deploy-gate, oncall script) wiring | OUT — depends on internal-token posture (ADR-017 §D3 follow-up) | Future iteration; would loop in system-security for the new env var and the broader auth surface |
| GRANT migration if R5 fires | OUT for B26 as-shipped — pre-authorized as follow-up per B26-SEC-F3 | Standalone future iteration with standalone spec + standalone security review + REVOKE rollback |
| Caching of filesystem read or ledger query | OUT — explicitly excluded | Optional follow-up if cold-start cost becomes operational |
| Promotion of the wire shape into `docs/contracts/` | OUT — pinned to ADR-017 §D2 today | Future iteration when a consumer materializes |
| Per-route rate-limit | OUT for admin-only B26 — pre-authorized in security B26-SEC-F2 | Mandatory in the ADR-017 §D3 internal-token follow-up |

**Infra confirms:** I will NOT propose any of the above as part of B26's infra co-sign. These are all clearly downstream of B26 and would expand the iteration outside its bounded scope.

## I-10 — Production-deploy posture (read-only summary)

The B26 iteration ships:

- One new admin-gated GET endpoint (no mutation).
- One new helper module (pure function; no I/O).
- One new orchestrator (filesystem read + cross-schema SELECT + diff invocation).
- One new shared `.mjs` constants module.
- One refactor of `scripts/check-migrations.mjs` (single import; byte-identical CI behavior per testing F-3).
- One `next.config.mjs` addition (`outputFileTracingIncludes` for the new route only).
- One new test file (14 cases).

It does NOT introduce:

- A new migration.
- A new env var.
- A new secret.
- A new public endpoint surface.
- A new cron / dashboard / external consumer.
- A new dependency on `package.json`.
- A change to the deploy pipeline.

**Production readiness from infra perspective:** the change is additive, scoped, and the two empirical verifications (R5 + R6) are operator-driven post-merge with defensive safety nets (loud 500s on misconfig, not silent false positives). The bundle-size impact is negligible. The status-code semantics are Vercel-compatible. The auth gate matches the canonical admin-route pattern. No infra escalation required.

**The only deployment friction is G11** (auto-deploy regression), which is a known platform-level issue unrelated to B26's code and addressed via the documented band-aid + the correct-fix paths in I-8.

## Verdict

**READY-TO-MERGE WITH WARNINGS.**

**Conditions:**
- All static-correctness gates have passed (npm test, typecheck, lint, build, check-migrations — per testing review).
- ADR-017 §D2 status mapping is Vercel-compatible (I-1).
- `outputFileTracingIncludes` is correctly placed top-level for Next 16.2.6 and correctly keyed to the route (I-2).
- Rate-limit posture matches project conventions; WAF posture is the Vercel default with no risk to admin traffic (I-3).
- Bundle-size impact is negligible (< 500KB added; well under all Vercel limits) (I-7).
- The defensive `MigrationsBundleConfigError` + `MigrationsLedgerReadError` safety nets ensure R5 / R6 misconfig surfaces as loud 500s, not silent false-positive drift (cross-confirmed with testing F-3 and security S11).

**Warnings (recorded; do not block the merge):**

| Warning | Severity | Resolution path |
|---|---|---|
| W1 — G11 carry-over: Vercel auto-deploys are empirically broken post repo-PRIVATE flip. Merging B26 will land the commit on `develop` but auto-deploy to production will likely NOT fire. | OPERATIONAL | Path A (band-aid: manual Redeploy or temporary repo-public toggle) or Path B (correct fix: re-grant Vercel GitHub App repo access at GitHub Installed Apps). See I-8. |
| W2 — R5 not yet empirically verified. Service-role's SELECT permission on `supabase_migrations.schema_migrations` is assumed-default but unconfirmed against `pdotsdahsrnnsoroxbfe`. | DEPLOYMENT | Operator runs the I-4 R5 checklist on the first preview deploy. If permission denied → escalate to FULL per ADR-017 §Risk register row R5 + B26-SEC-F3 (standalone GRANT iteration with standalone security review). If 200 → R5 closed. |
| W3 — R6 not yet empirically verified. `outputFileTracingIncludes` is statically correct but its runtime effect depends on Vercel's build-time file tracing. | DEPLOYMENT | Operator runs the I-5 R6 checklist on the first preview deploy. If `filesystem_count === 55` → R6 closed. If `MIGRATIONS_BUNDLE_MISSING` 500 fires → backend investigates `next.config.mjs` glob/key/path. |

**Not blockers:**
- F-1 from testing review (steady-state count drift 51 → 55 in spec/ADR documentation) is informational and handed to system-docs, not infra.
- F-2 from testing review (route handler not unit-tested) is intentional per LITE methodology and matches the project's testing-pyramid posture for thin admin glue.
- B26-SEC-F1 / F2 from security review are LOW informational; F3 is conditional on R5 firing and does not block B26 as-shipped.

**Handoff:** to system-docs.

## Handoff to system-docs

Items system-docs should cover for the B26 close-out:

1. **Update `docs/context/project.context.core.md` Operating rules** with a new entry documenting:
   - Existence of `/api/admin/migrations-health` and its auth posture (admin-only).
   - The 53-row ledger baseline post-B15 and the 55-file disk baseline today (replacing the spec's stale "51" target where it appears, per testing F-1).
   - The R5 + R6 verification status (verified-clean once the operator confirms; until then "pending first deploy smoke").
   - **No B-codes, R-codes, Sprint IDs, or plan-IDs** in the entry per MEMORY rule.

2. **Decide runbook placement for the 503 operator response** documented in I-6:
   - Option A: new file `docs/runbooks/migrations-health.md` (heavier but dedicated).
   - Option B: condensed paragraph in `project.context.core.md` Operating rules (lighter; my recommendation per I-6).

3. **Update ADR-017 §D2 example response** to reflect `filesystem_count: 55` (current disk count) instead of the as-written 51, OR add a footnote that the example was written when 51 files were on disk and the steady-state count grows monotonically per testing F-1's recommendation. Architecture-author decision, but flagged here.

4. **Optional: update ADR-014 §Orphans verification snapshot** to reflect the 53-row baseline (52 reconciled + B15's 0051 manual insert) for forward consistency. Already captured in Operating rules per the spec's review; ADR-014 may or may not need a touch-up.

5. **G11 status decision** — if the operator chooses Path A (band-aid) for the B26 deploy, no docs update needed for G11. If the operator chooses Path B (correct fix: re-grant GitHub App access), system-docs strikes G11 from `cutover-pilot.md` §5.3 and §0 caveat + the §7 known-limitations row (line 478 marked "RESOLVED 2026-05-17" but with empirical re-confirmation noting the post-private re-occurrence + the App-access fix). Operator confirms which path was taken before docs runs.

6. **Roadmap sync** per MEMORY rule — update `D:\Pedro\Archivos Pedro\Noon App\roadmap\NoonApp Roadmap.md` with the B26 closure entry (ADR-017 filed, endpoint live, R5/R6 verified or pending).

7. **Validator handoff** — once docs lands, validator runs the COMPLETE/PARTIAL/BLOCKED gate. Validator should confirm: (a) all 10 success criteria from spec §Success Criterion are met; (b) the R5 + R6 empirical confirmation has either landed (READY → COMPLETE) or is explicitly held (BLOCKED-on-operator-smoke until the preview hit is done).

**Infra gate: READY-TO-MERGE WITH WARNINGS. Handoff to system-docs is unblocked.**
