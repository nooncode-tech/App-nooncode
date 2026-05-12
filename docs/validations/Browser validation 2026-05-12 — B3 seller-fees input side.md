# B3 Chunk 3a — Seller-fee state machine (input side, browser validation)

**Date:** 2026-05-12
**Branch validated:** `develop` (post PRs #15, #16, #17, #18, #19, #20, #21, #23, #24, #25)
**Validator:** Pedro (browser) + Claude (Supabase MCP verification)
**Goal:** Confirm in real production data on `pdotsdahsrnnsoroxbfe` that the new `proposal creation → createSellerFee → state machine → activity log` chain works as designed before introducing the UI selector (Chunk 4) or removing the legacy fallback (Chunk 5).

## What's being validated

| Surface | Contract |
|---|---|
| `POST /api/leads/[leadId]/proposals` | After creating a `lead_proposals` row, if the lead is outbound, calls `createSellerFee` on the admin client and persists a `seller_fees` row in `state='potential'` linked to the proposal |
| `lib/server/seller-fees/service.ts` `createSellerFee` | Inserts the row + writes a `seller_fee_selected` activity into `lead_activities` |
| RLS policies on `seller_fees` | Service-role write succeeds (proposal route uses admin client per ADR-007 §rule 2) |
| Activity helper `logSellerFeeTransition` | Writes a `lead_activities` row with `activity_type='seller_fee_selected'`, the seller as actor, and the full metadata payload |
| `seller_profile_id` resolution | Set to `leads.assigned_to ?? leads.created_by` per the convention used by the Stripe webhook handler |

## Out of scope for this validation

- **Chunk 3b output side (webhook reads + confirmSellerFee)**: requires a real Stripe `checkout.session.completed` event; covered by unit tests (Tests 1, 4, 5 in `tests/server/api/webhooks/stripe-checkout-completed.test.ts`) and deferred to Chunk 5 closure for full end-to-end with Stripe CLI / test payment.
- **Chunk 4 UI selector**: not yet implemented. The default amount (100) used by Chunk 3a preserves prior behavior, so no observable change to users in this validation.

## Prerequisites

- [x] `.env.local` configured with `NOON_ENABLE_SUPABASE_AUTH="true"` + Supabase URL/anon/service-role keys for `pdotsdahsrnnsoroxbfe`
- [x] `develop` synced with all merged PRs through #25 (the 3a restore)
- [x] Migrations `0043_phase_18a_seller_fees.sql` and `0044_phase_18b_seller_fees_rls.sql` applied out-of-band to remote (verified via `list_tables` + `list_policies` 2026-05-11)
- [x] Dev server `corepack pnpm dev` running on `http://localhost:3000` (Next.js 16.2.6 + Turbopack, ready in 5.3s)
- [x] `seller_fees` table empty on remote pre-validation (`select count(*) → 0`) — confirms no prior runs contaminated the baseline

## Test scenario

Sales user creates a new outbound lead and a `draft` proposal through the existing dashboard UI (no selector — implicit default `sellerFeeAmount=100`). Verify that `seller_fees` and `lead_activities` are populated correctly without any UI changes visible to the user.

## Steps and evidence

### Step 1 — Lead created

- **You did:** Created an outbound lead through `/dashboard/leads` UI as a sales user.
- **Evidence:**
  ```text
  leads.id             = c99314a1-e555-47a6-8ae5-34f946f11163
  leads.lead_origin    = 'outbound'
  leads.assigned_to    = dae88316-6eea-4997-bc50-a71cbec25c3d
  leads.created_by     = dae88316-6eea-4997-bc50-a71cbec25c3d
  leads.created_at     = 2026-05-12 00:52:44 UTC
  ```
- **Activity log:** 1 row `activity_type='created'` (existing behavior, unchanged).

### Step 2 — Proposal created

- **You did:** Generated a proposal through the lead detail UI (title `"Propuesta - test"`, amount `100`, status `draft`).
- **Evidence:**
  ```text
  lead_proposals.id    = 3804fb31-2ed2-4ef9-987a-3beef82bba7d
  lead_id              = c99314a1-... (links to Step 1 lead)
  title                = "Propuesta - test"
  amount               = 100.00
  currency             = USD
  status               = draft
  created_at           = 2026-05-12 00:55:20 UTC
  ```
- **Activity log added:** 1 row `activity_type='proposal_created'` (existing trigger from migration `0004`, unchanged).

### Step 3 — `seller_fees` row created automatically — Chunk 3a behavior

- **What B3 Chunk 3a should do:** Detect `lead.lead_origin === 'outbound'` in the proposal POST handler, resolve `sellerProfileId = lead.assigned_to ?? lead.created_by`, instantiate an admin Supabase client (service-role), call `createSellerFee` with `amount = payload.sellerFeeAmount ?? 100`, and let `createSellerFee` persist the row + log the activity.
- **Evidence (MCP query 2026-05-12, ~1 second after Step 2):**
  ```text
  seller_fees.id                = 1f672115-d173-46ae-8129-507ab74d5804
  proposal_id                   = 3804fb31-... (links to Step 2 proposal)
  lead_id                       = c99314a1-... (links to Step 1 lead)
  seller_profile_id             = dae88316-... (matches lead.assigned_to)
  amount                        = 100.00
  currency                      = USD
  state                         = 'potential'
  payment_id                    = null
  payout_id                     = null
  cancellation_reason           = null
  formula_context_snapshot      = {}  (empty default per ADR-007)
  selected_at                   = 2026-05-12 00:55:21 UTC
  confirmed_at                  = null
  pending_payout_at             = null
  paid_out_at                   = null
  cancelled_at                  = null
  ```
- **Timing:** seller_fees row written ~1.064 seconds after the proposal row (`selected_at` − `proposal.created_at`).

### Step 4 — Activity log row `seller_fee_selected` written

- **What B3 Chunk 3a should do:** The `createSellerFee` service implementation calls `logSellerFeeTransition` which writes a `lead_activities` row with `activity_type='seller_fee_selected'`, the seller as `actor_profile_id`, a human-readable `note_body`, and a metadata payload that mirrors the `seller_fees` row plus prior/new state markers.
- **Evidence (MCP query 2026-05-12):**
  ```text
  lead_activities.activity_type  = 'seller_fee_selected'
  lead_id                        = c99314a1-... (Step 1 lead)
  actor_profile_id               = dae88316-... (matches seller_profile_id)
  note_body                      = "Seller fee $100 selected on proposal."
  created_at                     = 2026-05-12 00:55:21 UTC
  metadata                       = {
    "seller_fee_id":       "1f672115-...",
    "proposal_id":         "3804fb31-...",
    "seller_profile_id":   "dae88316-...",
    "amount":              100,
    "currency":            "USD",
    "prior_state":         "potential",
    "new_state":           "potential",
    "payment_id":          null,
    "payout_id":           null,
    "cancellation_reason": null
  }
  ```

## Invariants verified end-to-end

| # | Invariant | Result |
|---|---|---|
| 1 | `seller_fees` row is created when an outbound proposal is created via API | PASS |
| 2 | Row links to the proposal via `proposal_id` FK | PASS |
| 3 | `seller_profile_id` matches `leads.assigned_to ?? leads.created_by` | PASS |
| 4 | Initial state is `'potential'` (entry state per ADR-007) | PASS |
| 5 | Amount defaults to `100` when no `sellerFeeAmount` is passed (backwards-compat path for Chunk 4 absence) | PASS |
| 6 | `payment_id` is null (no payment yet) | PASS |
| 7 | `confirmed_at` is null (no transition fired yet) | PASS |
| 8 | A corresponding `lead_activities` row is written with `activity_type='seller_fee_selected'` | PASS |
| 9 | Activity `actor_profile_id` equals `seller_profile_id` | PASS |
| 10 | Activity `metadata` contains every documented field per the ADR-007 §Activity logging contract | PASS |
| 11 | Activity `note_body` is human-readable and reflects the actual amount | PASS |
| 12 | `formula_context_snapshot` is `{}` (default; ADR-007 §rule 7 — populated by Chunk 4 once selector exists) | PASS |
| 13 | RLS does not block the service-role write (admin client used in proposal route) | PASS (implicit — write succeeded) |
| 14 | No errors in dev server log during the flow | PASS |

## What did NOT happen (also a validation result)

| Scenario | Expected | Result |
|---|---|---|
| Webhook fires `confirmSellerFee` on the row | Not until a real Stripe payment confirms | Row stays in `state='potential'` — correct (no payment made) |
| Activity log gets a `seller_fee_confirmed` row | Not until confirmation | Absent — correct |
| Inbound proposal creates a `seller_fees` row | Should NOT happen | Not validated in this session (only an outbound lead was exercised) — deferred to Chunk 5 |

## State of the seller-fee elimination

Before this validation, the project had **4 functional hardcodes of `$100`** scheduled for elimination per ADR-007 §rule 1:

| Hardcode location | Status post-merges through PR #25 |
|---|---|
| `lib/maxwell/pricing.ts:56` — `sellerFee = isOutbound ? 100 : 0` | Eliminated (now `feeAmount` parameter) |
| `app/api/webhooks/stripe/route.ts:154` — `Math.max(activationAmount - 100, 0)` | Eliminated (now `activationAmount - sellerFeeAmount` from persisted row) |
| `app/api/webhooks/stripe/route.ts:163` — `amount: 100` | Eliminated (now `amount: sellerFeeAmount` from persisted row) |
| `app/api/webhooks/stripe/route.ts:169` — notes `"$100 fixed"` | Eliminated (dynamic note string per resolution path) |

The only `100` remaining in the integration code is `LEGACY_FALLBACK_SELLER_FEE_AMOUNT = 100` at `app/api/webhooks/stripe/route.ts:22` — an explicit named constant scoped for removal in Chunk 5 once backfill of in-flight proposals is verified.

## What this validation does NOT prove

- **Webhook side (Chunk 3b) was not exercised** because no Stripe payment was triggered. The webhook handler's read of `seller_fees` and call to `confirmSellerFee` are covered by 5 unit tests with a complex mock client (see `tests/server/api/webhooks/stripe-checkout-completed.test.ts`) but not by real Stripe data yet. Chunk 5 covers this with a real test payment or Stripe CLI replay.
- **RLS for non-admin reads** was not impersonation-tested. The structural exclusion of the developer role (ADR-007 §Hard rule 2) is verified by inspecting `pg_policies` (no policy matches `viewer.role = 'developer'`), but no developer login was attempted to confirm zero rows returned. Deferred to Chunk 5.
- **Cancellation paths** (`potential → cancelled` from proposal cancellation, `confirmed → cancelled` from refund) are covered by 21 service-layer unit tests but not by browser flow.

## Test data left in production

The four rows below remain in `pdotsdahsrnnsoroxbfe` from this validation:

```text
leads             id = c99314a1-e555-47a6-8ae5-34f946f11163
lead_proposals    id = 3804fb31-2ed2-4ef9-987a-3beef82bba7d
seller_fees       id = 1f672115-d173-46ae-8129-507ab74d5804
lead_activities   activity_type='seller_fee_selected' for the above lead_id
lead_activities   activity_type='proposal_created' for the above lead_id
lead_activities   activity_type='created' for the above lead_id
```

These rows are intentionally retained as durable evidence of the validation. They can be cleaned up later if needed (the lead is clearly a test, title `"Propuesta - test"`).

## Conclusion

**B3 Chunk 3a is verified to work in real production data.** Every invariant from the spec and ADR-007 holds against `pdotsdahsrnnsoroxbfe`. The integration is safe to leave running; the seller-fee state machine starts capturing data automatically for every new outbound proposal.

This validation does NOT close the Active risk for "Outbound seller fee is hard-coded at `$100` in `lib/maxwell/pricing.ts:56`" in `project.context.core.md` — that closure happens in Chunk 5 once:

1. The legacy fallback constant is removed.
2. A real Stripe payment validation confirms Chunk 3b end-to-end.
3. The Chunk 4 UI selector lets sellers choose 100 / 300 / 500.

Chunk 5 will reference this document as part of the closure evidence.
