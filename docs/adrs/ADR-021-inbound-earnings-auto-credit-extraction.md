# ADR-021: Inbound earnings auto-credit — extract `creditActivationEarnings` shared service, idempotency-key namespace separation, inbound allocation policy

**Status:** Accepted
**Date:** 2026-05-23
**Deciders:** Architecture (Claude Opus 4.7 · 1M context); operator validates downstream.
**Supersedes:** None
**Related:** spec `specs/fase-3-r4-inbound-earnings-auto-credit.md` (Analysis output, Approved 2026-05-23), ADR-007 (seller-fee state machine — payment-event-driven model preserved), ADR-010 (client portal lives in NoonWeb — architectural constraint anchor for this iteration), ADR-015 (earnings consolidation atomic RPC + refund discipline), ADR-016 (website webhook transport-level ledger — already in place upstream of `receiveWebsitePaymentConfirmed`).

---

## Context

The Stripe webhook handler (`app/api/webhooks/stripe/route.ts:184-279`) embeds the full earnings allocation+credit logic inline: it builds an `earningRows` array (seller + developer + noon), upserts into `earnings_ledger` with `onConflict: 'idempotency_key'`, then loops per row calling `creditWalletBucket` to credit `wallet_accounts.pending` via the Postgres RPC `credit_wallet_bucket`. This pathway is verified working end-to-end (B1.3a outbound smoke, 2026-05-17, $1 USD real on live Stripe).

The symmetric inbound path (`lib/server/website-integration.ts::receiveWebsitePaymentConfirmed`, lines 475-559) — invoked when NoonWeb sends `POST /api/integrations/website/payment-confirmed` post-client-payment — only calls `activatePaidProposal` (creates the project record) and **never credits developer or noon shares**. Real inbound customer payments today silently leave colaborador wallets at zero until an admin runs `POST /api/admin/earnings/credit` by hand. This is a money-allocation gap invisible to UX, observed but not regression-tested by the B1.3b inbound smoke (2026-05-18, 8/10 PASS).

Analysis (Approved spec) routes 4 risks and 7 open questions to Architecture before backend implementation begins:

- **R1** — Allocation asymmetry between outbound (`base = activationAmount - sellerFeeAmount`) and inbound (`base = activationAmount`) is a policy decision, not a bug. Architecture must declare the asymmetry policy explicitly so future readers do not "fix" it.
- **R2** — `developerUserId` is nullable in inbound (and sometimes in outbound). Architecture must define the null-handling semantic.
- **R5** — Refactor of the outbound inline loop could subtly change behavior the existing test suite does not catch. Architecture must structure the refactor so regression is mechanically verifiable.
- **R6** — Service must not accidentally write the seller row in inbound (which would produce a NOT NULL violation or a silent-skip audit gap). Architecture must lock the split between service responsibilities and caller responsibilities.
- **Q1** — Service surface: writes both `earnings_ledger` and `wallet_ledger_entries`, or only one?
- **Q2** — `developerUserId=null` policy: skip the row entirely or insert audit row with `actor_id=null` and skip wallet credit?
- **Q4** — Points policy in inbound: any awarded?
- **Q5** — `creditWalletBucket` helper: stay local in Stripe handler, move into service, or service calls RPC directly?
- **Q7** — Logging contract per call.

This ADR closes all 4 risks and all 7 open questions in one pass.

**Architectural constraint anchor (ADR-010, load-bearing):** the client portal lives in NoonWeb. App-nooncode is the internal colaborador workspace. The client never touches any App surface — paying happens in NoonWeb, post-payment portal lives in NoonWeb. The earnings credited by this iteration are 100% internal to colaboradores (developer + noon). No client-visible UI, no client-callable endpoint, no client portal change. Wire contract `websitePaymentConfirmedPayloadSchema` (NoonWeb-side) is FROZEN; only what App does post-receipt changes.

---

## Decision

### D1 — Extraction shape: `creditActivationEarnings(client, params)` is the allocation policy holder; writes both `earnings_ledger` and `wallet_ledger_entries`; seller row is service-managed (not caller-managed)

**Resolves Q1, Q5, R6.**

The service lives at `lib/server/earnings/activation-credit.ts`. It is the **allocation policy holder**: given the activation amount and (optionally) a seller, it computes `base`, builds the appropriate earnings rows (1-3 actors), upserts into `earnings_ledger`, and loops through `credit_wallet_bucket` RPC calls for each non-null actor.

**Why the service writes ALL rows including seller (not just dev/noon):**

The analyst-default split ("service writes only dev/noon, Stripe handler writes seller separately") was considered and rejected. Splitting the writes means:
- Two separate `earnings_ledger` upserts per webhook (one for seller, one for dev/noon). If the first succeeds and the second fails, the table is in an inconsistent partial state.
- The allocation policy (`base = activationAmount - sellerFeeAmount`) becomes split between the service (computes base) and the caller (already inserted seller row using sellerFeeAmount). This is exactly the duplicated-implicit-knowledge anti-pattern this iteration is trying to remove.

Instead, the service receives an optional `seller` parameter. When present, it includes the seller row in the upsert. When null (inbound), it does not. This makes the asymmetry explicit at the type-system level (one parameter discriminates), preserves atomicity (one upsert per call covering all rows), and resolves R6 by construction: the service literally cannot write a seller row when `seller === null` because there is no data to write.

**TypeScript signature** (the binding contract for Backend):

```typescript
// lib/server/earnings/activation-credit.ts

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/server/supabase/database.types'

type SupabaseAdminClient = SupabaseClient<Database>

export interface CreditActivationEarningsSellerInput {
  /** Profile UUID of the seller credited. */
  actorId: string
  /** The seller's persisted take from `seller_fees.amount` (outbound only). */
  amount: number
}

export interface CreditActivationEarningsParams {
  /** Money */
  activationAmount: number
  currency: string  // 'USD' in current scope

  /** IDs (from `activatePaidProposal` return) */
  paymentId: string
  proposalId: string
  leadId: string

  /** Actors */
  /** Outbound only. When provided, the service includes the seller row + uses `base = activationAmount - amount` */
  seller: CreditActivationEarningsSellerInput | null
  /** Project's developer assignee. Null when not yet assigned at payment time (common for inbound). */
  developerUserId: string | null

  /** Idempotency + tracing */
  /** `'outbound'` for Stripe webhook callers, `'inbound'` for NoonWeb webhook callers. Drives both metadata + idempotency-key namespace selection. */
  channel: 'inbound' | 'outbound'
  /**
   * The unique per-event idempotency-key base. Service appends row-specific suffixes.
   *  - Outbound callers pass `'stripe:${session.id}'`.
   *  - Inbound callers pass `'website:${external_payment_id}'`.
   * The service rejects (throws `Error('IDEMPOTENCY_KEY_BASE_NAMESPACE_MISMATCH')`) if `channel='inbound'` but the base does not start with `'website:'`, or vice versa. This is a defensive guard against caller misuse — see D2.
   */
  idempotencyKeyBase: string

  /** Audit actor (passed through to `wallet_ledger_entries.actor_profile_id`). Both webhook callers pass null (they run under the service-role admin client, no human actor). */
  actorProfileId: string | null

  /** Optional override for the wallet credit timestamp. Defaults to `new Date().toISOString()` at the service. */
  createdAt?: string
}

export interface CreditActivationEarningsRowResult {
  actorRole: 'seller' | 'developer' | 'noon'
  /** null for `noon` and for `developer` when `developerUserId` was null at call time */
  actorId: string | null
  amount: number
  /** earnings_ledger row's idempotency_key (column-level UNIQUE) */
  earningsLedgerIdempotencyKey: string
  /** wallet_ledger_entries metadata.idempotencyKey (partial-index UNIQUE). null when no wallet credit attempted (actorId was null). */
  walletIdempotencyKey: string | null
  /** false when actor_id was null (no wallet credit attempted), or when the RPC returned false (deduped). True when a new wallet_ledger row was inserted this call. */
  walletCredited: boolean
}

export interface CreditActivationEarningsResult {
  /** computed: `activationAmount - (seller?.amount ?? 0)` */
  base: number
  /** The full list of rows considered. Always includes developer + noon. Includes seller only when `params.seller !== null`. */
  rows: CreditActivationEarningsRowResult[]
}

export async function creditActivationEarnings(
  client: SupabaseAdminClient,
  params: CreditActivationEarningsParams,
): Promise<CreditActivationEarningsResult>
```

**Helper placement (Q5):** the `creditWalletBucket` helper at `app/api/webhooks/stripe/route.ts:23-56` is **moved** into the new service file (renamed `creditWalletBucketRpc` to avoid module-export name collision) and STAYS exported from the route file as a re-export from the service for one minor commit-history reason: the existing unit test `tests/server/api/webhooks/stripe-checkout-completed.test.ts` imports it. Backend may choose to either (a) keep the route-file re-export for one iteration then retire in a follow-up cleanup, or (b) update the test imports to point at the new location in this same PR. Either is acceptable; the choice is recorded in the PR description but does not block readiness.

The new service calls `client.rpc('credit_wallet_bucket', { ... })` directly through the moved-helper. No new abstraction. The RPC is the existing migration-0036-defined function; no schema change.

**Order of writes (preserves Stripe-handler current semantics):**

Per call to `creditActivationEarnings`, the service does:

1. Compute `base = activationAmount - (seller?.amount ?? 0)`.
2. Build the `earningRows` array: seller (if `seller !== null`) + developer + noon (last two only when `base > 0`).
3. Upsert all rows into `earnings_ledger` in a single call: `client.from('earnings_ledger').upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true })`. The unique constraint `earnings_ledger_idempotency_key_unique` (migration 0036) enforces dedup at the SQL level.
4. For each row where `actor_id !== null`, call the `credit_wallet_bucket` RPC. The RPC returns boolean (`true` = inserted, `false` = deduped via partial unique index on `(metadata->>'idempotencyKey')`). Service records the result per row.
5. Return the `CreditActivationEarningsResult` summary.

**What stays in the Stripe handler (out of service scope):**

- Lookup of `sellerFeeRow` via `getSellerFeeByProposalId` — outbound-specific, requires the dedicated repository call.
- Construction of the `seller` param from the lookup result — caller's responsibility.
- The `confirmSellerFee` state-machine transition — outbound-only by design (ADR-007), called AFTER the service returns. Stays in Stripe handler with its existing try/catch (fail-open per current behavior).
- The points award — outbound-only (only `sellerId` gets points today; inbound has no seller). Stays in Stripe handler.
- The lookup of `developerUserId` from the project record — caller's responsibility (both handlers do this independently; the lookup uses different code paths).

**What stays in the inbound handler (out of service scope):**

- Project lookup to derive `developerUserId` (new code in `receiveWebsitePaymentConfirmed` — see D1.b below).
- The `website_inbound_links` update — already in place, unchanged.

---

### D1.b — Caller-side delta in the two webhook handlers

**`app/api/webhooks/stripe/route.ts` (refactor — preserves behavior):**

The block at lines 184-279 (95 lines of inline allocation+credit logic) collapses to approximately:

```typescript
// (pseudo-code — Backend produces the actual diff)
const sellerInput = leadOrigin === 'outbound' && sellerFeeRow
  ? { actorId: sellerId, amount: Number(sellerFeeRow.amount) }
  : null

const allocationResult = await creditActivationEarnings(client, {
  activationAmount: activationAmountNum,
  currency: 'USD',
  paymentId: activation.payment_id,
  proposalId: activation.proposal_id,
  leadId: proposal.lead_id,
  seller: sellerInput,
  developerUserId,
  channel: leadOrigin === 'outbound' ? 'outbound' : 'inbound',
  idempotencyKeyBase: `stripe:${session.id}`,
  actorProfileId: null,
})
```

Net diff in the Stripe handler:
- Remove: lines 184-279 (the inline allocation/upsert/credit loop). Approximately 95 LOC.
- Keep verbatim: lines 100-182 (paid_at + activation + proposal/lead/seller lookups + `sellerFeeAmount` derivation + `developerUserId` lookup). These compute the inputs that go into the service.
- Add: the ~15-line call shown above.
- Keep verbatim: lines 281-316 (`confirmSellerFee` try/catch + points award). These are outbound-specific post-service-call.

Note: the Stripe handler today calls the service for BOTH outbound proposals AND the (rare) inbound-via-Stripe path. This means a real inbound proposal whose checkout was somehow created App-side (forbidden by ADR-010, but possible historically) would also auto-credit dev+noon via this same service call. This is correct behavior — the service is path-agnostic for the allocation math.

**`lib/server/website-integration.ts::receiveWebsitePaymentConfirmed` (new wire — additive):**

The new call is inserted between the existing `activatePaidProposal(...)` (line 526) and the `website_inbound_links` update (line 539). Approximately:

```typescript
// (pseudo-code — Backend produces the actual diff)
// activation already exists; below is additive

const { data: project } = await client
  .from('projects')
  .select('developer_user_id')
  .eq('id', activation.project_id)
  .maybeSingle()
const developerUserId = project?.developer_user_id ?? null

await creditActivationEarnings(client, {
  activationAmount: payload.payment?.amount ?? payload.proposal?.amount ?? proposalForPayment.amount,
  currency: payload.payment?.currency ?? payload.proposal?.currency ?? proposalForPayment.currency,
  paymentId,
  proposalId: link.proposal_id,
  leadId: link.lead_id,
  seller: null,  // inbound has no seller by design
  developerUserId,
  channel: 'inbound',
  idempotencyKeyBase: `website:${payload.external_payment_id}`,
  actorProfileId: null,
})

// then the existing `website_inbound_links` update at line 539 stays unchanged
```

Net diff in `receiveWebsitePaymentConfirmed`:
- Add: project lookup for `developerUserId` (~5 lines).
- Add: service call (~12 lines).
- Keep verbatim: everything else.

**Backend MUST NOT** change the function's return shape; the route handler keeps the existing response contract.

---

### D2 — Idempotency-key strategy: namespace separation `stripe:` vs `website:`, dual-key model per row (earnings_ledger + wallet_ledger_entries)

**Resolves Q3 (was pre-resolved by Analysis discovery), refines key shape, locks namespace separation.**

Every row written by the service receives **two distinct idempotency keys** (the existing tables enforce uniqueness through different constraints):

1. **`earnings_ledger.idempotency_key`** — column-level UNIQUE constraint (`earnings_ledger_idempotency_key_unique`, migration 0036). Key pattern:
   ```
   {idempotencyKeyBase}:earning:{actorRole}:{actorId ?? 'unassigned'}
   ```
   Examples:
   - Outbound seller: `stripe:cs_live_abc123:earning:seller:550e8400-e29b-41d4-a716-446655440000`
   - Outbound developer (unassigned): `stripe:cs_live_abc123:earning:developer:unassigned`
   - Inbound noon: `website:pi_live_xyz789:earning:noon:unassigned` (noon always has `actorId=null` → `'unassigned'` suffix)

2. **`wallet_ledger_entries` `metadata.idempotencyKey`** — partial unique index on `(metadata ->> 'idempotencyKey') WHERE metadata ? 'idempotencyKey'` (migration 0036). Key pattern:
   ```
   {idempotencyKeyBase}:wallet:{actorRole}:{actorId}
   ```
   Note: `actorId` is REQUIRED here because the wallet credit is only attempted when `actorId !== null` (see D3 for the null-handling). No `'unassigned'` fallback needed for the wallet key.
   Examples:
   - Outbound seller: `stripe:cs_live_abc123:wallet:seller:550e8400-e29b-41d4-a716-446655440000`
   - Inbound developer: `website:pi_live_xyz789:wallet:developer:6a1b2c3d-e4f5-6789-abcd-ef1234567890`
   - (Noon never receives a wallet credit because `actorId === null` for noon — see D3.)

**Namespace separation is a HARD invariant.** The service enforces it at call time: if `channel === 'inbound'` but `idempotencyKeyBase` does not start with `'website:'`, the service throws `Error('IDEMPOTENCY_KEY_BASE_NAMESPACE_MISMATCH')` before any database call. Likewise for `channel === 'outbound'` + missing `'stripe:'` prefix. This defensive guard prevents accidental cross-contamination (e.g., a caller copy-pasting an outbound code path into an inbound handler and forgetting to swap the namespace prefix).

**Why namespace separation matters:** `stripe:cs_live_abc123` and `website:pi_live_xyz789` are guaranteed to be unique within their own systems but COULD theoretically collide as raw strings if NoonWeb ever sent an `external_payment_id` shaped like a Stripe session ID. The namespace prefix removes that risk forever. Per-namespace, the rest of the key is unique by construction (Stripe session IDs are universally unique; NoonWeb `external_payment_id` is required + min(1) per the FROZEN wire schema, and NoonWeb's own ledger enforces its uniqueness).

**Why two keys per row (not one):** the existing tables already enforce uniqueness differently (column-level vs partial-index on metadata JSON). Reusing both gives defense-in-depth: if the transport-level `website_webhook_events` ledger somehow lets a duplicate webhook through (it shouldn't, per ADR-016, but defensive), the SQL constraints catch it. If the SQL constraints were bypassed in some future refactor (e.g., a migration regression), only one of the two would fail — the other still protects.

---

### D3 — Inbound allocation policy + `developerUserId=null` handling + points policy

**Resolves R1, R2, Q2, Q4.**

**Allocation policy asymmetry between outbound and inbound is POLICY, not bug.** Future readers who attempt to "fix" the asymmetry would break outbound's seller-fee semantics.

**Outbound** (`channel: 'outbound'`, `seller !== null`):
- `base = activationAmount - seller.amount`
- Seller row inserted into `earnings_ledger`: `actor_id = seller.actorId`, `amount = seller.amount`.
- Developer row inserted: `actor_id = developerUserId` (may be null), `amount = base * 0.5`.
- Noon row inserted: `actor_id = null` (noon never has a user profile), `amount = base * 0.5`.
- Wallet credits attempted in iteration order: seller (always, because `seller.actorId` is required), developer (only if `developerUserId !== null`), noon (never — noon has no profile_id).

**Inbound** (`channel: 'inbound'`, `seller === null`):
- `base = activationAmount` (no seller deduction; full amount distributed).
- NO seller row.
- Developer row inserted: `actor_id = developerUserId` (may be null), `amount = base * 0.5`.
- Noon row inserted: `actor_id = null`, `amount = base * 0.5`.
- Wallet credits attempted: developer only (only if `developerUserId !== null`).

**`developerUserId === null` policy (resolves Q2, R2):** **preserve current Stripe webhook semantics — insert audit row with `actor_id = null`, skip wallet credit.**

The earnings_ledger row IS inserted regardless (audit invariant: "every payment activation has 2 or 3 earnings_ledger rows depending on channel"). The wallet credit loop short-circuits per row via `if (!row.actor_id) continue` (preserving the current Stripe-handler behavior at line 258). Net effect: the developer-share money is documented in `earnings_ledger` for audit/reconciliation, but no `wallet_ledger_entries` row exists for it; the money is effectively unallocated until a developer is assigned to the project and an admin runs `POST /api/admin/earnings/credit` to reconcile (or a follow-up iteration introduces an auto-reconcile mechanism — out of scope here).

This matches what already happens for outbound projects whose developer assignment is delayed past payment time. The semantic does not change; the inbound path now exhibits the same behavior the outbound path has had since FASE 1.

**Points policy in inbound (resolves Q4): NO points awarded.**

The existing Stripe handler awards 50 points to the seller (`points_ledger`, line 307-316). Inbound has no seller (`sellerId === null`), so the existing skip-on-null-seller logic naturally produces no points. Architecture explicitly confirms: **no developer-points-in-inbound** is introduced in this iteration. If operator later wants per-developer activation points (independent of seller existence), that is a separate iteration with its own contract.

The service does NOT touch `points_ledger` at all. Points stay in the Stripe handler post-service-call.

---

### D4 — Error semantics: fail-closed for the entire service call

**Resolves R5 (refactor cannot drift) + analyst-default error policy.**

The service does NOT swallow errors. Any failure during:
- `earnings_ledger.upsert` → throws (let webhook fail; Stripe/NoonWeb retries).
- `credit_wallet_bucket` RPC for any row → throws (let webhook fail; retry).

This matches the current Stripe handler behavior pre-refactor:
- The `earnings_ledger` upsert at line 252 throws on `earningsError`.
- The `creditWalletBucket` helper at line 53 throws on RPC error.

The current Stripe handler's only fail-open path is `confirmSellerFee` (line 295-302 try/catch). That stays in the Stripe handler, not in the service. Per ADR-007 the seller-fee state transition is an audit secondary; the money is already moved.

**Idempotency is the safety net for retries.** If the service throws mid-loop (e.g., dev credit succeeded, noon credit RPC errored), retry replays the entire service call. The earnings_ledger upsert dedupes on `idempotency_key`. The wallet RPC returns `false` (deduped) for the already-credited dev row, then attempts noon again. No double-credit.

**One caveat surfaced by Architecture review:** the `earnings_ledger.upsert` happens once per service call with all rows. If the upsert succeeds and then the wallet-credit loop fails partway, retry replays both — the upsert dedupes cleanly, the wallet loop dedupes per row. The non-deduped failed row gets a second chance. This is the same atomicity story the Stripe handler has today; no new risk introduced.

---

### D5 — Logging contract (resolves Q7)

The service emits one INFO log per call (allocation summary) and WARN/ERROR on failure paths:

```typescript
// Success path (info)
logger.info('earnings.activation_credit.allocated', {
  channel,                                      // 'inbound' | 'outbound'
  paymentId,
  proposalId,
  leadId,
  activationAmount,
  base,
  sellerAmount: seller?.amount ?? null,
  developerUserId,
  rowCount: result.rows.length,
  rowsCreditedToWallet: result.rows.filter(r => r.walletCredited).length,
})

// Failure path (error)
logger.error('earnings.activation_credit.failed', {
  channel,
  paymentId,
  proposalId,
  leadId,
  stage: 'earnings_ledger_upsert' | 'wallet_credit',
  failedActorRole?: 'seller' | 'developer' | 'noon',
  failedActorId?: string | null,
  ...errorToLogContext(err),
})
```

**No PII** (no email, no name, no business name). Amounts are internal-workspace money data and are logged — consistent with existing earnings logging precedent (Stripe handler logs `amount` already). Payment IDs and proposal IDs are internal identifiers, not PII.

**No raw payload logging** (the inbound webhook's `payload` is not logged from inside the service; the upstream route handler already logs `external_payment_id` + `external_proposal_id` + `external_session_id` at INFO with `requestId`).

---

## Consequences

### Positive

- **Single source of truth for activation earnings allocation policy.** Future changes (e.g., different split percentages, new actor roles, seller-fee ladder changes) happen in one file.
- **Inbound payments from NoonWeb now auto-credit dev + noon shares.** Operator no longer needs to manually run `POST /api/admin/earnings/credit` for every inbound payment.
- **Atomicity preserved.** Single `earnings_ledger` upsert per call; per-row wallet credit with idempotency at RPC level. Retry semantics unchanged from pre-iteration outbound behavior.
- **R6 (seller-share leak into inbound) impossible by construction.** The service literally cannot insert a seller row when `seller === null`.
- **Namespace separation prevents future cross-system collisions.** `stripe:` vs `website:` is a hard invariant enforced at service entry.
- **Refactor regression is mechanically verifiable.** The existing Stripe webhook test suite (`tests/server/api/webhooks/stripe-checkout-completed.test.ts`) is the regression gate; if it passes unchanged, the refactor preserves outbound behavior.

### Negative

- **Subtle behavior change in outbound** if Backend gets the refactor diff wrong (R5). Mitigation: regression suite must pass unchanged + diff inspection in code review + the refactor step is explicitly separate from the wire step per spec chunking.
- **Helper move complicates one existing test import** (`stripe-checkout-completed.test.ts` currently imports `creditWalletBucket` from the route file). Backend chooses re-export-and-retire OR update-imports-in-this-PR; either is fine, documented in PR description.
- **`receiveWebsitePaymentConfirmed` grows by ~17 lines.** Acceptable; the function is already 85 lines and this addition is cohesive with its existing responsibility.
- **No live-Stripe smoke in this iteration loop.** Per operator decision + router. Validator records this as a deferred-but-known smoke; operator may run a NoonWeb staging inbound payment after merge to confirm production wiring.

### Neutral

- **No schema change. No new migration. No new RPC.** All persistence dependencies are the existing migration-0036 surfaces.
- **Cross-repo NoonWeb-side: zero changes.** Wire contract `websitePaymentConfirmedPayloadSchema` is FROZEN by spec + ADR-010 anchor. Confirmed re-read of `lib/server/website-integration.ts:66-87` — schema is what it is.
- **No new env vars.** No infra change.

---

## Allowed shortcuts

- **Backend may keep `creditWalletBucket` re-exported from `app/api/webhooks/stripe/route.ts`** for the lifetime of this iteration (only) to avoid touching the existing unit test imports. Follow-up iteration may retire the re-export. Documented in PR description if chosen.
- **The service may use the existing manual cast pattern (`as never` / `as unknown as ...`) for Supabase generated-types boundary issues** if any surface, consistent with the recently-retired override-block pattern (post-G7 closure). If Backend has zero such casts, even better.

## Forbidden shortcuts

- **Do NOT modify `confirmSellerFee` behavior.** Stays as-is, called from Stripe handler post-service for outbound only.
- **Do NOT add try/catch around the service call** in either webhook handler. Fail-closed per D4 is the contract.
- **Do NOT change `websitePaymentConfirmedPayloadSchema`** under any pretext. The wire contract is frozen.
- **Do NOT introduce a parallel idempotency-key strategy** (e.g., per-actor unique constraint on a different column). The dual-key model (earnings_ledger column + wallet metadata index) is the contract.
- **Do NOT auto-trigger earnings on lead-status-won.** Out of scope by spec + ADR-007 (payment-event-driven).
- **Do NOT touch the admin manual endpoint** `POST /api/admin/earnings/credit`. Escape hatch stays.
- **Do NOT add any client-facing surface** (UI, route, endpoint, portal change). Violates ADR-010.

---

## Implementation readiness

**Verdict: GREEN.**

Backend may begin immediately following the spec's chunking sequence:

1. **Backend Phase A** — Create `lib/server/earnings/activation-credit.ts` per D1 signature + unit tests (`tests/server/earnings/activation-credit.test.ts`). Move `creditWalletBucket` helper into the service (optionally re-export from Stripe route file). All existing tests stay passing including the Stripe webhook regression suite.
2. **Refactor Phase** — Replace lines 184-279 of `app/api/webhooks/stripe/route.ts` with a single `creditActivationEarnings(...)` call per D1.b. Outbound regression suite MUST pass identically (zero test diff). Diff review confirms the seller-fee lookup + `confirmSellerFee` + points award stay in the handler.
3. **Backend Phase B** — Wire `lib/server/website-integration.ts::receiveWebsitePaymentConfirmed` per D1.b. Add project lookup for `developerUserId`. Add service call. New integration test (`tests/server/api/integrations/website/payment-confirmed.test.ts` — verify existence, create if missing) covers: single-call dev+noon credit, duplicate-call dedupe, `developerUserId=null` boundary, no seller row in inbound, no `confirmSellerFee` side effect.

After Backend completes all three phases, the chain proceeds to Testing → Security → Docs → Validator per the router-locked sequence.

---

## Risks tracked forward

- **R1 (allocation asymmetry as policy)**: documented in D3. Service signature requires `channel` discriminator + `seller` nullable parameter — asymmetry is impossible to "accidentally fix".
- **R2 (`developerUserId` nullable)**: documented in D3 with explicit semantic. Test coverage required per spec AC #6.
- **R5 (refactor drift)**: mitigated by D1.b (clear diff shape) + explicit Refactor step in chain + existing test suite as regression gate.
- **R6 (seller-share leak in inbound)**: impossible by construction per D1 (`seller === null` → no seller row).
- **R7 (live smoke deferred)**: accepted by operator. Validator records.

---

## References

- Spec: `specs/fase-3-r4-inbound-earnings-auto-credit.md` (Approved 2026-05-23).
- ADR-007: seller-fee state machine (payment-event-driven model, preserved).
- ADR-010: client portal lives in NoonWeb (architectural constraint anchor for this iteration).
- ADR-015: earnings consolidation atomic RPC + refund discipline.
- ADR-016: website webhook transport-level ledger.
- Migration 0036: `credit_wallet_bucket` RPC + earnings_ledger/wallet_ledger_entries idempotency constraints.
- Current outbound implementation reference: `app/api/webhooks/stripe/route.ts:184-316` (the inline pattern being extracted + the seller-fee post-call behavior staying in the handler).
- Current inbound implementation reference: `lib/server/website-integration.ts:475-559` (the function receiving the new service wire).
