# Secret rotation runbook — App-nooncode (single-repo + cross-repo)

> **Scope:** planned and incident-driven rotation of every operational secret used by App-nooncode. Covers single-repo secrets (Supabase, Stripe, OpenAI, V0, Upstash, Cron) AND the one cross-repo shared secret (`NOON_WEBSITE_WEBHOOK_SECRET`). For full-disaster scenarios where many secrets rotate together, defer to `docs/runbooks/disaster-recovery.md`.
>
> **Out of scope:** Vercel platform credentials (ownership / billing — operator-side), GitHub repository secrets (covered by GitHub's own rotation flow), local developer machine `.env.local` files (per-developer; replicate the procedure individually).
>
> **Status:** living document. Update when adding a new secret to `.env.example`.

---

## §1. Secret inventory (as of 2026-05-26)

| Secret | Source / format | Cross-repo shared? | Live-data blast radius |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → service_role | No | **CRITICAL** — bypass RLS, full DB read/write |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → anon | No | Public-safe (RLS-gated) but rotated with service_role |
| `STRIPE_SECRET_KEY` (`sk_live_*`) | Stripe Dashboard → Developers → API keys | No | **CRITICAL** — full Stripe account read/write |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_live_*`) | Stripe Dashboard → Developers → API keys | No | Public-safe (client-only Stripe ops) |
| `STRIPE_WEBHOOK_SECRET` (`whsec_*`) | Stripe Dashboard → Webhooks → endpoint details | No | HIGH — webhook signature verification |
| `NOON_WEBSITE_WEBHOOK_SECRET` | Operator-generated CSPRNG (`openssl rand -hex 32`) | **YES — shared with NoonWeb** | HIGH — HMAC envelope for §3/§4/§5/§6 inbound endpoints |
| `OPENAI_API_KEY` | OpenAI dashboard → API keys | No | HIGH — Maxwell compute spend |
| `V0_API_KEY` | v0.dev → account settings | No | MEDIUM — prototype generation spend |
| `UPSTASH_REDIS_REST_TOKEN` / `KV_REST_API_TOKEN` | Vercel Marketplace → Upstash integration | No | MEDIUM — rate-limit store |
| `CRON_SECRET` | Operator-generated CSPRNG | No | MEDIUM — cron endpoint bearer token |
| `NOON_SEED_DEFAULT_PASSWORD` | Operator choice | No | LOW (seed scripts only, non-prod) |
| `.mcp.json` Supabase access token (`sbp_*`) | Supabase account → Access Tokens | No | HIGH — only operator-side dev tooling, never in build |

**Rule:** any future secret added to `.env.example` must be added to this table in the same PR.

---

## §2. Trigger taxonomy

| Trigger | When | Coordination |
|---|---|---|
| **Scheduled (planned)** | Operator-defined cadence (e.g., quarterly for HIGH/CRITICAL secrets). No incident; just hygiene. | Standalone change window. |
| **Suspected leak (incident)** | Public-repo commit of a secret (G13 pattern, 2026-05-17); password manager compromise; ex-team-member offboarding; credential observed in logs. | Bilateral with NoonWeb-dev if `NOON_WEBSITE_WEBHOOK_SECRET`. Single-repo otherwise. |
| **Confirmed exploit** | Unauthorized access detected in audit logs (Supabase Auth, Stripe ledger, Vercel deploy logs). | Immediate — coordinated with affected providers (Stripe support, Supabase support). |
| **Disaster recovery** | Vercel project loss, full DB compromise. | Full-DR — see `disaster-recovery.md`. |
| **Provider mandate** | Stripe forces rotation (live-key migration, account upgrade), Supabase migrates auth schema. | Provider-driven; follow their schedule. |

The procedures below cover **planned** + **suspected-leak** + **confirmed-exploit** triggers. Disaster-recovery defers to its own runbook.

---

## §3. Operational principles (do these, every time)

1. **Rotate the secret at the provider FIRST.** Never delete the old value before generating the new one — many providers display the new secret only once.
2. **Update Vercel Production env BEFORE Preview/Development.** Production is the audit surface; Preview can lag briefly.
3. **Trigger a Vercel redeploy after env-var update.** Vercel env changes are not picked up until the next build. Use Vercel Dashboard → Deployments → Redeploy with current env, OR push a trivial commit, OR use a Deploy Hook.
4. **Verify the new secret works** before revoking the old one at the provider. The verification step per secret is in §5 below.
5. **Revoke the old secret at the provider** once verification passes. Do not leave dual-keys active longer than the verification window.
6. **Record the rotation** in the operator-side password manager AND in a short note in `docs/context/project.context.history.md` if it was incident-driven (planned rotations can be silent).
7. **Never commit secrets** to git. `.env.local` is gitignored; `.mcp.json` is gitignored (per `.gitignore:31`); `.env.example` carries variable NAMES with empty values only.
8. **Do not force-push to rewrite history** unless the leak is active and the secret cannot be rotated (e.g., a hardware-bound key). Once the new secret is in use, the leaked one in git history is permanently revoked. History rewrite breaks every collaborator's local repo and is rarely worth it.

---

## §4. Cross-repo coordination — `NOON_WEBSITE_WEBHOOK_SECRET` only

This is the **only** secret shared between App-nooncode and NoonWeb. Coordination protocol:

### 4.1 Pre-rotation handshake (planned)

1. **Operator coordinates a window** with NoonWeb-dev (15-30 min). Both repos prepare to deploy in that window.
2. **Generate new secret** locally:
   ```bash
   openssl rand -hex 32
   ```
   Treat the output as the new value of `NOON_WEBSITE_WEBHOOK_SECRET`.
3. **Update Vercel Production env in BOTH repos simultaneously**:
   - App-nooncode: Vercel Dashboard → `nooncode-app` project → Settings → Environment Variables → edit `NOON_WEBSITE_WEBHOOK_SECRET` → new value → Save → Redeploy.
   - NoonWeb: same procedure in NoonWeb's Vercel project.
4. **Both repos must deploy within the same window.** Brief drift is acceptable (the HMAC envelope verification is the only thing that breaks; webhooks return 401 during the gap and the sender retries per §5.9 / §6.7 of the cross-repo doc). >5-minute drift triggers operator-visible 401 alerts.
5. **Verify both directions** (§5.6 below).
6. **No code change required** in either repo — env-var change only.

### 4.2 Incident response (suspected leak)

If `NOON_WEBSITE_WEBHOOK_SECRET` is suspected leaked:

1. **Rotate immediately** without waiting for a coordinated window. App-side cutover first (App is the receiver — webhooks failing for ~30s is acceptable; an attacker holding the leaked secret could replay valid signatures within the 5-min clock-skew window).
2. **Notify NoonWeb-dev** in the same minute. NoonWeb must deploy the new secret ASAP — outbound webhooks from App→NoonWeb (review-decision per §7 of cross-repo doc) will start failing on signature mismatch.
3. **Window of fragility:** webhooks in both directions fail until both repos hold the new value. The cross-repo retry policy (per §5.9 / §6.7) bounds the data loss to whatever can replay within the retry budget; for `prototype-decision` per ADR-023 D5 retry is acceptable on 5xx and 401-during-rotation; for `inbound-proposal` / `payment-confirmed` retry is acceptable on 5xx.

### 4.3 NoonWeb-dev acknowledgment record

Bilateral handshake required for any cross-repo secret change. Keep a one-line record in `docs/context/project.context.history.md`:

```
- 2026-MM-DD — NOON_WEBSITE_WEBHOOK_SECRET rotated. Coordinated with NoonWeb-dev (acknowledged HH:MM UTC). Reason: <planned | suspected-leak | exploit-confirmed>.
```

---

## §5. Per-secret rotation procedures

### 5.1 `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`

> **CRITICAL — rotate together.** Supabase rotates both keys atomically when you cycle the project's JWT secret.

1. Supabase Dashboard → Project Settings → API → "Reset JWT secret". This rolls both anon and service_role keys; you cannot rotate one without the other.
2. Capture the new `anon` and `service_role` values immediately (displayed once).
3. Update Vercel env vars in App-nooncode (both keys, all environments).
4. Redeploy.
5. **Verify:** open the live deploy in a browser, log in as an admin user, navigate to `/dashboard`. If login works, the anon key is correct. Run any admin route (e.g., `/dashboard/leads` table loads) to verify the service_role key works (the dashboard summary RPC requires admin client).
6. The old keys are revoked automatically by Supabase on JWT rotation. No separate "delete" step.
7. **Side effect:** all logged-in users are signed out (JWT signing key changed). Communicate to operator team.

### 5.2 Stripe — `STRIPE_SECRET_KEY` (`sk_live_*`)

1. Stripe Dashboard → Developers → API keys → Standard keys → "Roll" the live secret key. Stripe gives a grace period (default 12h) during which both keys work.
2. Capture the new `sk_live_*` value.
3. Update Vercel env in App-nooncode (Production scope only — test keys do not rotate this way).
4. Redeploy.
5. **Verify:** make a small live test charge via a controlled flow (operator-side card, $1, refunded immediately) and confirm in Stripe Dashboard. The dashboard mode of the new key must be `live`. The webhook does NOT need re-verifying here (different secret — see §5.3).
6. After verification, expire the old key at Stripe Dashboard (do not wait for the grace period to end).

### 5.3 Stripe — `STRIPE_WEBHOOK_SECRET` (`whsec_*`)

> One webhook secret per Stripe webhook endpoint. App-nooncode has one webhook endpoint (production) and one (test). Rotate them independently.

1. Stripe Dashboard → Developers → Webhooks → select the production endpoint → "Roll signing secret".
2. Stripe shows the new `whsec_*`. Old secret remains active for ~24h.
3. Update Vercel env (Production scope only).
4. Redeploy.
5. **Verify:** trigger a live webhook event (e.g., refund a $1 test charge via Stripe Dashboard). Watch Vercel Function logs for the `stripe.webhook.*` info entries — a 200 from `app/api/webhooks/stripe/route.ts` confirms the new secret verifies.
6. After verification, the old secret expires automatically per the grace period; no manual delete.

### 5.4 `NOON_WEBSITE_WEBHOOK_SECRET` (cross-repo)

See §4 above. Cross-repo coordinated.

### 5.5 `OPENAI_API_KEY` / `V0_API_KEY`

1. OpenAI dashboard → API keys → create new → label `nooncode-app-production-<YYYY-MM-DD>`. Capture the value.
2. Update Vercel env in App-nooncode (all environments share the same key by convention; revisit if per-env keys are introduced).
3. Redeploy.
4. **Verify:** invoke a Maxwell flow (e.g., admin-side "generate prototype" trigger from a test lead) and confirm the LLM call succeeds. For V0, trigger a prototype generation.
5. OpenAI dashboard → revoke the old key.

### 5.6 `UPSTASH_REDIS_REST_TOKEN` / `KV_REST_API_TOKEN`

> Vercel Marketplace integration auto-injects these on link. To rotate, re-link the integration.

1. Vercel Dashboard → Storage → Upstash Redis → settings → "Rotate access token".
2. The token regenerates; Vercel auto-updates the env var on the linked project.
3. Trigger a redeploy (env-var change does not auto-redeploy on Vercel for Marketplace-injected vars; verify by checking the var value in Vercel Dashboard and forcing a deploy).
4. **Verify:** hit a rate-limit-gated endpoint 60+ times in a minute (the prototype-signed-read endpoint per ADR-024 D6) and confirm 429 surfaces; check Vercel logs for `rate_limit.upstash.fallback` — absence confirms Upstash is the active engine. Per `lib/server/api/rate-limit.ts` the fallback engine is in-memory, so a stale token would also degrade silently to in-memory; the log line is the canary.

### 5.7 `CRON_SECRET`

1. Generate new:
   ```bash
   openssl rand -base64 48
   ```
2. Update Vercel env. Update the Vercel Cron job header in `vercel.json` (if it references the secret literally — it should not; the cron route reads from env at runtime).
3. Redeploy.
4. **Verify:** wait for the next scheduled cron tick OR trigger manually with the new secret:
   ```bash
   curl -X POST https://<app-host>/api/cron/consolidate-earnings \
        -H "Authorization: Bearer $NEW_CRON_SECRET"
   ```
   Expect 200 (or 204 / appropriate status per the cron route's own contract). Stale-secret invocations return 401.

### 5.8 `.mcp.json` Supabase access token (`sbp_*`)

> **G13 incident pattern (2026-05-17)** — this token was rotated after being detected in public git history. Procedure codified from that incident.

1. **Rotate at Supabase** — Supabase account → Access Tokens → revoke the old token + generate new. Label the new token clearly (`nooncode-app-mcp-<YYYY-MM-DD>`).
2. **Update `.mcp.json` locally** with the new token. `.mcp.json` is gitignored per `.gitignore:31`.
3. **Reload the MCP server** (Claude Code restart, or whichever client consumes `.mcp.json`).
4. **Do NOT force-push to remove the old token from git history.** Once revoked at Supabase the old token is permanently inactive; the leaked copy is worthless. History rewrite breaks every collaborator and is not justified by a revoked secret.
5. **Verify:** invoke any MCP tool that needs Supabase access (e.g., `list_tables`).
6. **Record** in `project.context.history.md` if the rotation was incident-driven; planned rotations can be silent.

---

## §6. Verification — end-to-end smoke checklist

After any secret rotation, run the smoke checks for the affected surfaces:

| Surface | Smoke check |
|---|---|
| Supabase auth | Log in via the live deploy as an admin user; navigate to `/dashboard/leads`; data loads. |
| Supabase service-role | Open `/dashboard` (loads the dashboard summary RPC via admin client). |
| Stripe live charge | Operator-side $1 test charge → confirm in Stripe Dashboard. |
| Stripe webhook | Refund $1 charge → watch Vercel Function logs for `stripe.webhook.*` info line. |
| `NOON_WEBSITE_WEBHOOK_SECRET` inbound | Operator runs `docs/handoffs/b1-3b-noonweb-fire-script.mjs` Scenario 1 (signed `inbound-proposal` POST) → expects 201. |
| `NOON_WEBSITE_WEBHOOK_SECRET` outbound | Approve a draft proposal in `/dashboard/pm-queue` → watch Vercel logs for `proposal-review-decision` outbound success. |
| OpenAI / V0 | Trigger a Maxwell flow (admin-side test) → LLM response renders. |
| Upstash rate-limit | Run 70 GETs against `/api/integrations/website/prototype-signed-read/<token>` in one minute → expect 429 by request ~61. Check Vercel logs for absence of `rate_limit.upstash.fallback`. |
| Cron | Trigger `/api/cron/consolidate-earnings` with the new bearer → 200. |

If any check fails, **investigate before revoking the old secret.** Most likely cause: Vercel env var did not propagate (force redeploy) OR provider has a grace period delay (wait 30s and retry).

---

## §7. Incident response template

When responding to a suspected leak, use this checklist:

```
Incident: <date / time UTC>
Suspected leaked secret: <name>
Source of suspicion: <e.g., committed to public repo, observed in logs, ex-team-member offboarding>

Immediate actions:
[ ] Rotate at provider (record new value in password manager)
[ ] Update Vercel Production env (and Preview/Development if relevant)
[ ] Trigger Vercel redeploy
[ ] Verify per §6 smoke check for the affected surface
[ ] Revoke old secret at provider
[ ] (If cross-repo) Notify NoonWeb-dev + confirm their deploy

Forensic actions (after stabilization):
[ ] Review audit logs (Supabase, Stripe, Vercel deploy logs) for the period the leaked secret was active
[ ] Detrack from git if applicable (`git rm --cached <file>` + ensure `.gitignore` covers it)
[ ] Record one-line note in project.context.history.md with date + reason
[ ] If exploit confirmed: open follow-up iteration for additional hardening (e.g., shorter TTLs, IP allowlists)
```

---

## §8. References

- `docs/runbooks/disaster-recovery.md` — full-DR scenarios (multi-vector rotation, project rebuild)
- `docs/runbooks/cutover-pilot.md` — short-rotation procedures (single Stripe key, webhook secret) — referenced inline above
- `docs/integrations/cross-repo-webhook-v1.md` §12 (env vars) + §15 (open issues)
- `docs/context/project.context.core.md` line 462 (`.mcp.json` gitignored discipline; G13 pattern)
- `.env.example` — canonical inventory of env vars
- ADR-024 D1 (HMAC envelope reuse — no new secret per the prototype-signed-read iteration)

---

## §9. Maintenance

- **Update this runbook** when adding a new secret to `.env.example` (§1 table).
- **Update §4 cross-repo procedure** if a second cross-repo shared secret is introduced (currently only one).
- **Reference this runbook** in the open-issues row of `docs/integrations/cross-repo-webhook-v1.md` §15 (was "Add `docs/runbooks/cross-repo-secret-rotation.md`" — now resolved).
