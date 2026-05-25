# ADR-009: Bridge wallet — freeze the legacy credits table, USD wallet is single source of truth

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Pedro (Engineering owner)
**Closes:** roadmap §2 decision #3
**Related:** `supabase/migrations/0024_phase_3a_monetary_wallet_foundation.sql`, `supabase/migrations/0025_phase_3a_bridge_wallet_compatibility.sql`

---

## Context

Two wallet tables currently coexist in the App Supabase project (`pdotsdahsrnnsoroxbfe`):

- **Legacy `user_wallets`** — pre-FASE 1, credit-based. Each user has a `free` and `earned` credit balance. Used originally by the prototype credit consumption flow (`request_lead_prototype`).
- **New `wallet_accounts`** — landed in FASE 1 via migration `0024_phase_3a_monetary_wallet_foundation.sql`. Real USD balances with four buckets (`pending`, `available_to_spend`, `available_to_withdraw`, `total`) plus a structured ledger in `wallet_ledger_entries`.

Migration `0025_phase_3a_bridge_wallet_compatibility.sql` introduced the **bridge**:

- `ensure_monetary_wallet()` seeds `available_to_spend` from existing credits at a fixed conversion of **1 credit = $1.00 USD**.
- `request_lead_prototype()` now writes to **both** tables on prototype consumption: debits credits from `user_wallets` AND records a `service_debit` entry in `wallet_ledger_entries`.

The duplication was intentional: the bridge preserved demo continuity (existing credit balances still worked) while the new monetary wallet became the source of truth for new operations. But the bridge was always temporary — the dual-write pattern is fragile and drift-prone if anyone writes directly to `user_wallets` without going through the bridged RPC.

Roadmap §2 decision #3 forces a choice: **freeze** the bridge as a permanent invariant (cheap, 1d) or **retire** `user_wallets` entirely (clean, 5-8d backend, delays FASE 2).

---

## Decision

**Freeze the bridge.** The conversion `1 credit = $1.00 USD` is recorded as a **permanent invariant**. From this ADR onward:

1. **`wallet_accounts` is the single source of truth** for all monetary operations (debits, credits, balances, payouts, earnings).
2. **All new code writes only to `wallet_accounts` / `wallet_ledger_entries`.** Direct writes to `user_wallets` are forbidden except via the existing `request_lead_prototype` RPC that maintains the bridge.
3. **`user_wallets` becomes a read-only legacy cache** retained for historical balance lookups and for the `request_lead_prototype` dual-write path.
4. **Full retiro of `user_wallets`** is deferred to **before v3 Phase 8 (fee selector 100/300/500, mes 5-7)**. At that point the table will be dropped and the dual-write removed; until then it remains.

---

## Rationale

### Why freeze over full retiro now

The cost-benefit math at this point in the project:

| Option | Cost | Benefit | Risk |
|---|---|---|---|
| Freeze (this ADR) | 1 day of docs + guard rails | Clean source of truth from now on; bridge contained | Bridge stays until v3 Phase 8; one consumer (`request_lead_prototype`) still dual-writes |
| Full retiro now | 5-8 days backend; delays FASE 2 by a week | Cleaner code, no dual-write | Migration risk on real balances; retiro path needs careful backfill scripts and validation in production |

Full retiro is the right call **eventually** but the marginal value of doing it now (during FASE 1-3) is low. The bridge already works in production (validated in FASE 1 closure 2026-04-19). Dropping a week of FASE 2 to clean it up is a poor trade against the value of getting earnings auto-credit (FASE 3 lifecycle) live first.

### Why the invariant is permanent (not "to be migrated")

The conversion `1 credit = $1.00 USD` was chosen consciously. It does not break any economic assumption: credits were always implicitly worth $1 per the original pricing model. Recording the invariant as **permanent** rather than as transitional removes a class of "what if the conversion changes" bugs from the codebase and aligns the legacy table's economic meaning with the new one.

### Why retiro before v3 Phase 8 specifically

v3 Phase 8 (`docs/product/master-spec-v3.md` §24, the fee selector 100/300/500) is the last major touchpoint of the seller earnings + wallet model. After that ships, the wallet shape is stable for the foreseeable future. Doing the retiro before Phase 8 lands ensures Phase 8 builds on a clean wallet foundation without dragging the legacy table forward into v3 territory.

---

## Consequences

### What this enables

- All FASE 2-3 work that touches earnings/payouts can read and write `wallet_accounts` without worrying about keeping `user_wallets` in sync.
- The FASE 3 lifecycle automation (Stripe webhook → auto-credit earnings) writes only to `wallet_accounts`. No bridge writes needed for that flow.
- Documentation is unambiguous: future contributors read this ADR and understand the legacy table is "look-but-don't-touch".

### What this forbids

- **No new code may write directly to `user_wallets`**, with the sole grandfathered exception of the existing `request_lead_prototype` RPC. New prototype consumption flows must use `wallet_accounts` only.
- **No new bridge points may be added.** If a future feature needs the same dual-write pattern, it must be refused and routed back to "use `wallet_accounts` directly".
- The invariant `1 credit = $1.00 USD` must not be questioned without a separate ADR — changing it requires reconciling every historical balance and is not a single-iteration task.

### Active risks created or updated

- The Active risk in `project.context.core.md` line 298 (Bridge wallet 0025 conversion 1:1 temporal) is **superseded** by this ADR. The risk wording is downgraded from "temporal" to "frozen-permanent-until-v3-Phase-8".
- A new Active risk is implicit: if a future session writes directly to `user_wallets` without going through the bridged RPC, balances drift silently. Mitigation: the only legitimate writer is `request_lead_prototype`; future audits should check `git grep -E "from\\(.?user_wallets" -- 'app/' 'lib/'` for unauthorized callers.

### Re-evaluation triggers

This ADR must be revisited when **any** of the following happen:

- v3 Phase 8 scoping begins → retiro becomes part of Phase 8 spec.
- A new feature requires a wallet operation that does not fit `wallet_accounts` shape → escalate.
- An incident reveals that the bridge has drifted (balances inconsistent between tables) → escalate immediately.

---

## Alternatives considered

- **Full retiro now (5-8 days):** rejected for the cost-benefit reason above.
- **Status quo (no documentation, no freeze):** rejected. The risk of silent drift is real and the 1-day cost of writing this ADR + guard rails is trivial against that.
- **Conversion at 1 credit = some other USD value:** rejected. No economic reason to change the implicit ratio, and any change would force a backfill across all historical balances.

---

## Lifecycle

- **Author:** Pedro (system-docs)
- **Supersedes:** nothing
- **Superseded by:** nothing (will be by the v3 Phase 8 retiro ADR when that lands)
