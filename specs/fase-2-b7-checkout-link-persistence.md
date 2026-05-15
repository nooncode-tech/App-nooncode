# spec.md — fase-2-b7-checkout-link-persistence

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-15
- Session ID: fase-2-b7-checkout-link-persistence
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-backend (migration + service + enrichment) → system-frontend (UI states) → system-testing → system-validator → system-docs
- Router mode: New Build (small) — adds two persisted columns + a new read-enrichment field + a UI state expansion
- Depth: Lite

### OBJECTIVE
- What must be achieved in this session: scope F-V08 (UX audit Tier 3) / B7 (FASE 2 Bloque B) — persist the Stripe Checkout URL + expiry on the `payments` table so the operator-driven outbound payment link is a visible, durable artifact on the proposal surface instead of an ephemeral client-side React state that disappears on page reload. Analysis only — no code changes in this session; downstream implementation is one Bugfix Lite iteration of ~4-6h.
- Why this work matters now: the ADR-010 amendment 2026-05-14 legitimized the outbound Checkout URL as an App-side artifact that can be persisted for audit / re-share without violating the website-owns-inbound principle. Once persisted, the operator stops having to re-click "Crear link" on every page load to recover the same URL, and the seller has a reliable copy-paste source for the link they share with the client out-of-band. Newly in-scope post-amendment; explicitly listed in roadmap §6 Bloque B as "B7" (4-6h estimate).

### CONTEXT USED
- `project.context.core.md` reviewed: yes (Active risk on outbound Checkout exception; ADR-010 amendment operating rule).
- `project.context.full.md` reviewed: no (no entity contract change beyond two nullable columns; no architecture change; no auth-model change).
- `project.context.history.md` reviewed: no (recent sessions covered B14 ops + ADR-010 amendment + B1 cutover — none of which change F-V08 scope).
- Reason `full` was included if applicable: not required — additive columns on `payments`, additive enrichment field on the proposal read model, no contract evolution.
- Reason `history` was included if applicable: not required.

### ROUTER DECISION
- Why this mode is correct: New Build (small) because it adds a new persisted field (URL) + a new derived read field (`expiresAt`) + a new UI state ("link expired / re-create"). Lite depth because the change is bounded (one route handler + one service function + one read-enrichment hook + one component branch) and does not touch contracts beyond the additive columns. Not Refactor — observable behavior gains a new artifact, it doesn't preserve current behavior bit-for-bit.
- Why this depth is correct: Lite because (a) the existing idempotency contract in `createCheckoutSession` is preserved verbatim, (b) the new columns are nullable so legacy rows continue to work via the existing Stripe round-trip path, (c) no security-surface expansion (the link is already visible to internal-role principals; we are only making it visible without an API call), (d) no env/runtime/deploy change, (e) tests are small.
- Why this skill is the right active skill now: nothing else can route until the schema decisions (column placement, type, nullability), the API contract (response shape, enrichment field), and the UI state machine are explicit. Backend cannot implement without scope; frontend cannot consume without the contract.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules".
- Contracts or architecture inputs available:
  - `docs/adrs/ADR-010-client-portal-lives-in-noonweb.md` §Amendment 2026-05-14 — explicitly notes F-V08 remains in scope post-amendment because the operator-driven outbound link can be persisted on App-side without violating the website-owns-inbound principle.
  - `lib/server/stripe/service.ts:49-220` (`createCheckoutSession`) — current idempotency contract: looks up the most recent pending `payments` row by `proposal_id`, retrieves the Stripe session by `stripe_checkout_session_id`, and reuses the URL if `session.status === 'open'`. Expired sessions are marked `failed` with metadata `replacedByNewCheckout: true` and a new session is created.
  - `app/api/payments/checkout/route.ts` — internal-role principal gate, inbound rejection, proposal-state preconditions. None of these change.
  - `components/lead-detail.tsx:876-916` + `:1790-1822` — current UI state machine. The button label `Crear/copiar link de pago` is the call site that today writes the URL into ephemeral `checkoutLinksByProposalId` React state.
- Relevant handoffs received: user chose F-V08 over G7 + Tier 3 UX bundle alternatives on 2026-05-15 after B1.2 went into standby (waiting on Stripe account owner to create the live webhook endpoint via `docs/handoffs/b1-2-stripe-webhook-live-setup.md`). Spec-only iteration today; implementation deferred to a follow-up session.
- External dependencies or environment assumptions: Stripe Checkout sessions expose `expires_at` (Unix seconds) on the session object. Default expiration is 24h after creation; Stripe allows up to 24h forward at create time but no extension after creation. The Stripe SDK in use (`getStripeClient()` → API version `2026-03-25.dahlia`) returns `expires_at` on the session response.

### RISK SNAPSHOT
- Known risks before starting:
  - **Schema drift discipline (G7).** Per the 2026-05-15 pre-flight, migrations 0041/0043/0044 are absent from `supabase_migrations.schema_migrations` even though their tables physically exist. Until `fase-0-b4b-ledger-reconciliation` runs, any new migration must be applied via the Supabase Dashboard SQL Editor or `mcp__supabase__apply_migration`, not via `supabase db push`. Migration `0045` for F-V08 inherits this constraint.
  - **Stripe Connect-style account assumption** does not apply here. The Checkout sessions in question are standard `mode: 'payment'` for outbound flows, not Connect transfers. No impact from Connect account state.
  - **Backfill non-coverage.** Existing pending `payments` rows have `stripe_checkout_session_id` but neither `stripe_checkout_url` nor `stripe_checkout_expires_at`. On the read path, the enrichment falls back to **null `activeCheckoutLink`** when both columns are null, even though a session may still exist on Stripe. Mitigation: the existing button still says "Crear/copiar link de pago" which re-runs `createCheckoutSession` and (per its idempotency) returns the same URL if the Stripe session is still open. The user click re-populates the columns transparently — no data loss, just a one-time UX nudge per legacy row. A one-time backfill via Stripe API is **out of scope** unless data shows it matters.
  - **Race in session creation cleanup.** If the Stripe session is created but the DB update fails, the existing code calls `stripe.checkout.sessions.expire(session.id)`. With the two new columns added to the same UPDATE statement, the failure surface stays the same — atomic update succeeds or fails as a unit. No new race introduced.
  - **Operator confusion if a link is "almost expired".** Currently no UX signal exists for "this link expires in 30 minutes." Once `expiresAt` is persisted and surfaced, the UI can render a warning. Out of scope for this iteration to design the warning UX; we surface the value, the next iteration can add visual treatment.
- Known blockers before starting: none.
- Known assumptions before starting:
  - Stripe always returns `expires_at` on `checkout.sessions.create` response. Verified per Stripe docs current API version.
  - `payments` table writes are within RLS for service_role admin client (used in `route.ts:31`); no policy change needed.
  - The new columns will not exceed Supabase row size limits (URL is bounded ~512 chars, timestamp is fixed).

### CONTINUITY NOTES
- Previous session relevant to this one: 2026-05-14 ADR-010 amendment moved F-V08 from "deferred" to "in scope". 2026-05-15 B1.0 spec + B1.1 rotation/scope-split closed; B1.2-B1.5 still operationally pending but architecturally unblocked.
- Expected next skill after this session if all goes well: system-backend in a follow-up session (4-6h estimated), executing migration + service update + enrichment + UI updates per this spec. The spec is the analysis output and can sit unconsumed until a focused implementation window opens.

---

## Task Summary

Persist the Stripe Checkout URL and expiration on the `payments` table so the operator's outbound payment link survives page reloads, doesn't require a Stripe API round-trip to display, and renders in a visible state on the proposal surface. Add a new server-side read-enrichment field `activeCheckoutLink` on the proposal read model, consumed by `components/lead-detail.tsx` to drive a four-state UI (none / active / expired / paid).

The implementation is one Bugfix Lite iteration: one migration (two nullable columns), one service write update, one enrichment hook, one component state expansion, and four small unit tests. Estimated 4-6h elapsed including PR review cycle.

---

## Scope Boundary

### Included
- **Migration `0045_phase_18c_payment_checkout_link_persistence.sql`** — additive only:
  - `alter table public.payments add column if not exists stripe_checkout_url text;`
  - `alter table public.payments add column if not exists stripe_checkout_expires_at timestamptz;`
  - No RLS change, no index change (the `proposal_id, status` index already serves the read path), no default value.
- **`lib/server/stripe/service.ts` (`createCheckoutSession`)** — after Stripe returns the session, include the URL and expires_at in the UPDATE on `payments`:
  ```ts
  await client.from('payments').update({
    stripe_checkout_session_id: session.id,
    stripe_checkout_url: session.url,                                    // NEW
    stripe_checkout_expires_at: new Date(session.expires_at * 1000).toISOString(), // NEW
    metadata: { ... },                                                   // unchanged
  }).eq('id', pendingPaymentId)
  ```
  The "reuse existing session" path also returns the persisted columns so the route handler can pass them back to the client without an extra DB read.
- **`app/api/payments/checkout/route.ts`** — response shape gains `expiresAt`:
  ```ts
  return jsonWithRequestId({
    data: { url, paymentId, checkoutSessionId, expiresAt }              // NEW: expiresAt
  }, ...)
  ```
  Type: ISO 8601 string. The `url`, `paymentId`, `checkoutSessionId` fields are unchanged.
- **Proposal read enrichment.** `getLeadProposalsForLead` (or equivalent in `lib/server/leads/proposal-repository.ts`) gains an `activeCheckoutLink` field per proposal, computed as:
  ```sql
  SELECT stripe_checkout_url, stripe_checkout_session_id, stripe_checkout_expires_at
  FROM payments
  WHERE proposal_id = $proposal_id
    AND status = 'pending'
    AND stripe_checkout_url IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1
  ```
  Returns shape:
  ```ts
  activeCheckoutLink: {
    url: string
    sessionId: string
    expiresAt: string            // ISO 8601
    isExpired: boolean           // derived at read time: new Date() > expiresAt
  } | null
  ```
  Null when no pending payment exists OR all pending rows have null URL (legacy).
- **`components/lead-detail.tsx`** — state machine expansion on the Propuesta tab. The current button `Crear/copiar link de pago` is replaced by a conditional render driven by `proposal.activeCheckoutLink` and `proposal.paymentStatus`:

  | State | Trigger | UI |
  |---|---|---|
  | **paid** | `proposal.paymentStatus === 'succeeded'` | "Pago confirmado" badge, no link button |
  | **active** | `activeCheckoutLink && !activeCheckoutLink.isExpired` | "Copiar link" (primary) + "Abrir link" (ghost) + "Crear link nuevo" (link variant). Show `expiresAt` formatted as "Vence en Xh Ym" or "Vence el DD/MM HH:mm" |
  | **expired** | `activeCheckoutLink && activeCheckoutLink.isExpired` | "Link expirado" indicator (muted) + "Crear link nuevo" (primary) |
  | **none** | `activeCheckoutLink === null` (and not paid, and eligibility precondidions met) | "Crear link de pago" (primary) — current default |

  The ephemeral `checkoutLinksByProposalId` React state goes away because the server is now the source of truth on page load. After `handleRequestPayment` succeeds, the new URL/expiresAt come back from the API and feed a local optimistic update of the proposal until the next refetch.

- **Tests** (in the implementation iteration; spec captures planned coverage):
  - Unit on `createCheckoutSession`: new session creation writes all 3 columns (session_id, url, expires_at). Mock-Stripe path.
  - Unit on `createCheckoutSession`: reused-open-session path returns persisted URL without a new write.
  - Unit on proposal enrichment: returns active link when pending payment exists with URL, returns null when no pending exists, returns null when pending exists but URL is null (legacy backfill case).
  - Unit on proposal enrichment: `isExpired` is true when `expires_at` is in the past, false otherwise.

### Excluded
- **Backfill via Stripe API.** Legacy pending rows with null URL fall back to the existing "click to create/copy" flow which re-uses the same Stripe session via the idempotency path. A retroactive backfill (iterate over pending rows, call `stripe.checkout.sessions.retrieve`, write URL + expires_at) is not required and is **out of scope**. If at the next pilot session we see operators repeatedly clicking the same proposal's link button, a backfill iteration can be queued.
- **Expiration warning UX.** The spec exposes `expiresAt` to the UI but does not prescribe a "link is about to expire" warning treatment. That's a separate UX iteration once the field is available.
- **Custom expiration window.** The Stripe default of 24h is preserved. We do not pass `expires_at` into `stripe.checkout.sessions.create` to override it.
- **Multi-link history.** The proposal surface shows only the **active** link (most recent pending row with a URL). Historical expired/replaced links are not surfaced. They remain in `payments` as audit trail and can be inspected via direct DB query if ever needed.
- **GET endpoint for the link standalone.** The link is delivered via the proposal read enrichment. No new route. No new auth surface.
- **Real-time expiration tick.** The UI computes `isExpired` once on render. It does not re-render every minute as the clock advances toward expiry. If a session expires while the operator is staring at the dialog, they'll see the "active" state until they refetch. Out of scope for this iteration; the next-step "warning UX" iteration can add a ticking countdown.
- **Inbound payment link persistence.** Inbound flows are NoonWeb-owned per ADR-010. No App-side persistence of inbound URLs.

---

## Affected Files / Modules

### New files
- `supabase/migrations/0045_phase_18c_payment_checkout_link_persistence.sql` — additive columns.

### Modified files
- `lib/server/stripe/service.ts` — `createCheckoutSession` write path (both new-session and reused-session branches) + return shape.
- `app/api/payments/checkout/route.ts` — response shape (one extra field).
- `lib/server/leads/proposal-repository.ts` — read enrichment (one new derived field on the row shape).
- `components/lead-detail.tsx` — UI state machine expansion at the Propuesta tab; removal of the ephemeral `checkoutLinksByProposalId` React state and replacement with server-derived state; type updates on the `LeadProposal` client type.
- `lib/types/leads.ts` (or wherever `LeadProposal` is defined) — add the `activeCheckoutLink` field to the type.

### Test files (created or extended)
- `tests/server/stripe/service.test.ts` (extend or create) — 2 new tests (write path, reused-session path).
- `tests/server/leads/proposal-repository.test.ts` (extend or create) — 2 new tests (enrichment present, enrichment null, isExpired computation).

### Files exercised but not modified
- `app/api/webhooks/stripe/route.ts` — webhook handler does not need to know about the persisted URL. The URL becomes stale automatically when payment status moves off `pending`.
- All other Stripe-handling code paths.

---

## Success Criterion

F-V08 is COMPLETE when **all** of the following hold:

1. Migration `0045_phase_18c_payment_checkout_link_persistence.sql` is applied to the production Supabase via Dashboard SQL Editor or `mcp__supabase__apply_migration` (per G7 mitigation), and verified by `\d public.payments` showing the two new columns.
2. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all clean. Test count baseline 223 + new tests (~4) = expected 227/227.
3. End-to-end browser validation in `supabase` mode confirms the four-state UI renders correctly:
   - Create a fresh proposal, click "Crear link de pago" → state transitions to **active**, URL is visible, expiresAt is shown.
   - Hard refresh the page → state stays **active**, the URL is rendered without an API call to `/api/payments/checkout`.
   - Wait for or simulate expiration (manually set `stripe_checkout_expires_at` in DB to a past date) → state transitions to **expired** on next refresh, "Crear link nuevo" CTA appears.
   - Click "Crear link nuevo" → new session created, state transitions back to **active** with fresh URL and expiresAt.
4. `project.context.core.md` updated with a Closed-in-runtime entry for F-V08 and an operating rule that captures the new contract:
   - "Treat `payments.stripe_checkout_url` + `payments.stripe_checkout_expires_at` as the canonical durable artifact of the outbound Checkout link. The proposal read enrichment surfaces `activeCheckoutLink` server-side so the lead-detail UI never needs a client-side fetch to display the link on mount. Do not re-introduce ephemeral React state for the URL — server is the source of truth on page load."
5. ADR-010 amendment §Implementation hooks list updated to mark F-V08 as implemented.
6. `project.context.history.md` session note appended.
7. Local NoonApp Roadmap §17 snapshot rewritten (lives outside the repo).

If any of (1)-(7) fails the iteration is PARTIAL or BLOCKED.

---

## API Contract Changes

### `POST /api/payments/checkout` response

**Before:**
```json
{ "data": { "url": "...", "paymentId": "...", "checkoutSessionId": "cs_live_..." } }
```

**After:**
```json
{
  "data": {
    "url": "...",
    "paymentId": "...",
    "checkoutSessionId": "cs_live_...",
    "expiresAt": "2026-05-16T14:23:00.000Z"
  }
}
```

Pure addition; existing consumers are unaffected.

### `GET /api/leads/[leadId]/proposals` response (per proposal)

**Before:** (only the relevant slice)
```json
{
  "id": "...",
  "status": "sent",
  "paymentStatus": "pending",
  "linkedProject": null
}
```

**After:**
```json
{
  "id": "...",
  "status": "sent",
  "paymentStatus": "pending",
  "linkedProject": null,
  "activeCheckoutLink": {
    "url": "https://checkout.stripe.com/c/pay/cs_live_...",
    "sessionId": "cs_live_...",
    "expiresAt": "2026-05-16T14:23:00.000Z",
    "isExpired": false
  }
}
```

When the proposal has no pending payment with a persisted URL: `activeCheckoutLink: null`.

---

## Risks and Mitigations (consolidated)

| Risk | Severity | Mitigation |
|---|---|---|
| Migration applied via OOB path (G7 ongoing) | Medium | Use `mcp__supabase__apply_migration` exactly as for previous G7-era migrations. Additive only; idempotent (`add column if not exists`). |
| Legacy pending rows show "Crear link" instead of "Copiar link" | Low | One-click recreate retrieves the same Stripe session via existing idempotency. UX nudge per legacy row, no data lost. |
| Stripe API version returns null `expires_at` | Low | Defensive null check; if null, persist null and treat `isExpired = false` (most-permissive interpretation). |
| UI state machine regression on non-Supabase modes | Low | Mock mode keeps current behavior; the new state only activates when `proposal.activeCheckoutLink` is non-null, which is only populated server-side in `supabase` mode. |
| Race between "create new" click and "currently open" Stripe session | None | Existing idempotency in `createCheckoutSession` already handles this: looks up pending row, retrieves Stripe session, reuses if open. New columns are written in the same UPDATE statement. No race introduced. |

---

## Notes for Downstream Skills

### For system-backend (implementation)
- Migration goes via `mcp__supabase__apply_migration`, not `supabase db push`, per the G7 convention.
- Service write path must update both new columns in the same UPDATE statement; do not split into two UPDATE calls.
- Reuse-existing-session branch: after `stripe.checkout.sessions.retrieve()`, also update the new columns if they are null (catches legacy backfill case implicitly: clicking the button on a legacy row populates the columns).
- New columns are `text` and `timestamptz`, both nullable, no defaults, no indexes. Keep it boring.

### For system-frontend (implementation)
- Remove `checkoutLinksByProposalId` React state entirely. The server is the source of truth on page load; mutations come back from the API and update the local proposal record optimistically until the next refetch.
- The four-state UI is the contract. Render conditions are exact — see the table in Scope §Included.
- `expiresAt` formatting: ISO string in JSON, parsed via `new Date()`, formatted with the project's existing `date-fns` patterns. Use relative ("Vence en 4h 23m") if delta < 12h, otherwise absolute ("Vence el 16/05 14:23").
- Do not implement a real-time countdown ticker. Static render on mount.

### For system-testing
- Mock-Stripe tests should use a fake session object with `expires_at` set to `Math.floor(Date.now() / 1000) + 86400` (24h forward).
- Test the `isExpired = true` branch with `expires_at` set to past.
- Snapshot test on the lead-detail render is optional but useful for catching state-machine regressions.

### For system-validator
- Validate that the new operating rule is added verbatim to `core.md`.
- Validate that the migration applied state matches local file via `list_migrations` (it won't — G7 ongoing — but the table inspection should show both columns).
- Validate browser evidence covers all four UI states.

---

## Out-of-band steps

None. F-V08 is purely repo-side work plus a migration that follows the existing G7 mitigation playbook. No Stripe Dashboard config, no env vars, no cross-repo coordination, no operator window required for execution (just for browser validation).
