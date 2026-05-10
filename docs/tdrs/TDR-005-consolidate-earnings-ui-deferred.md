# TDR-005: Admin earnings consolidate UI deferred until v3 reshape

**Status:** Deferred
**Date:** 2026-05-10
**Detected during:** FASE 2 browser validation (`docs/validations/Browser validation 10-05-2026.md`)
**Related route:** `app/api/admin/earnings/consolidate/route.ts`
**Related function:** `consolidateEarnings()` in `lib/server/earnings/admin.ts`
**Related screen (where the UI would normally live):** `app/dashboard/settings/page.tsx` — `Ganancias` tab

---

## Problem

The admin earnings consolidation endpoint is fully implemented backend-side:

- Route at `app/api/admin/earnings/consolidate/route.ts` validates input with zod, requires `admin` role via `requireRole(['admin'])`, and calls `consolidateEarnings()` from `lib/server/earnings/admin.ts`.
- `consolidateEarnings()` reads the recipient's `wallet_accounts.pending`, decrements it by the requested amount, increments `wallet_accounts.available_to_withdraw` by the same, and inserts a `wallet_ledger_entries` row with `entry_type=earnings_distribution`, `balance_bucket=available_to_withdraw`, `reference_type=consolidation`, and `metadata.consolidatedFrom=pending`.
- Validated end-to-end on 2026-05-10 against the linked Supabase project (`pdotsdahsrnnsoroxbfe`, Development scope) for `juan@noon.app` with a $5 amount; the bucket movement was correct and the ledger row was inserted.

But there is **no UI surface** in the repo that calls this endpoint. The `Ganancias` tab in `/dashboard/settings` exposes only the credit action. Admin users have no in-app way to trigger consolidation today.

Triggering consolidation requires either:

- A direct API call (curl, fetch from a script with cookies, etc.), or
- A service-role helper such as `scripts/consolidate-earnings-validation.ts` (which imports `consolidateEarnings()` directly).

---

## Decision

**Do not build the consolidate UI on the current `pending → available_to_withdraw` bucket model.** Hold the gap open in `docs/context/project.context.core.md` Active risks. Reabordar como parte del rediseño v3 cuando los nuevos estados estén definidos.

---

## Why deferred

Two upcoming, already-documented changes will reshape the underlying earnings model in ways that make any UI built today disposable:

### 1. v3 master spec sec. 24.4 introduces a new bucket state machine

The current `wallet_accounts` model uses two buckets that matter for this flow:

```
pending  →  available_to_withdraw
```

`docs/product/master-spec-v3.md` sec. 24.4 introduces a different state machine:

```
Potential  →  Confirmed  →  Pending payout  →  Paid out
                                            ↘  Cancelled
```

These do not map cleanly onto the current model. The current "consolidate" verb (`pending → available_to_withdraw`) does not have a direct equivalent in the v3 model. The closest analogues — `Confirmed → Pending payout` or `Pending payout → Paid out` — represent different lifecycle moments and would have different triggers, different actors, and probably different UI affordances.

A button labeled "Consolidar pendiente" built today would be relabeled, repositioned, or removed when the v3 buckets land.

### 2. Pending FASE 3 automates the credit trigger

`docs/context/project.context.core.md` `Corrected roadmap status` lists FASE 3 as Pending: "Propuesta con lifecycle (paid/won trigger automático de earnings desde `wallet_accounts`)."

Once FASE 3 lands, the current manual admin credit + consolidate flow becomes a fallback for exceptional cases (corrections, manual adjustments, etc.). The primary path becomes automatic state transitions driven by proposal events. UI investment for an admin-only fallback that is about to be deprecated is exactly the premature optimization the project rules warn against.

### Combined effect

The UI would be replaced **twice** within the v3 reshape: once when bucket semantics change, once when the trigger model moves from manual to automatic. Building it now is debt that pays back negative.

---

## Workaround until v3 reshape

For any one-off operational need to consolidate earnings today, use:

```bash
corepack pnpm@9 dlx tsx scripts/consolidate-earnings-validation.ts
```

That script is currently parameterized for `juan@noon.app` + `$5.00` (validation noise from FASE 2 validation). To use for other recipients/amounts, edit the constants at the top of the file or copy it into a new one-off helper. The script imports the same `consolidateEarnings()` function the API route calls, so the DB writes are identical.

---

## When this debt should be reopened

Reopen this TDR (or close it with a fresh design) when **any** of the following is true:

- v3 spec sec. 24.4 earnings bucket state machine is implemented (or the spec is revised away from that model).
- FASE 3 automatic credit trigger is implemented and operational.
- A clear product/operational need to manually consolidate earnings appears that the script workaround cannot serve (e.g., non-admin operator who needs the action).

The right entry point for reopening is the v3 router → analysis → architecture flow, not a one-off UI patch.

---

## Risk if left untouched

| Concern | Severity |
|---|---|
| Functional gap blocking a user (admin) | Low — admin can always reach the script |
| Data correctness | Zero — the endpoint and underlying function are validated; only the UI is missing |
| Security | Zero — endpoint is `requireRole(['admin'])` regardless of caller |
| Discoverability for new admins | Medium — they will not know the script exists; mitigated by this TDR being indexable from `project.context.core.md` Active risks and from `docs/validations/Browser validation 10-05-2026.md` |
| Forgetting to reopen at v3 time | Medium — mitigated by linking from `project.context.core.md` Active risks (always loaded by Claude sessions) |

---

## Cross-references

- `docs/context/project.context.core.md` — Active risks line for this gap
- `docs/validations/Browser validation 10-05-2026.md` — full session record where F-V02 was detected (search for `F-V02`)
- `docs/validations/fase-2-earnings-browser-validation.md` — runbook for the FASE 2 validation
- `docs/product/master-spec-v3.md` sec. 24.4 — v3 earnings bucket state machine
- `docs/audits/v3-phase-0-audit.md` — Phase 0 audit that catalogued the broader v3 reshape risks
- `app/api/admin/earnings/consolidate/route.ts` — the unwired endpoint
- `lib/server/earnings/admin.ts` `consolidateEarnings()` — the underlying function
- `app/dashboard/settings/page.tsx` `Ganancias` tab — where the UI would naturally live
- `scripts/consolidate-earnings-validation.ts` — the workaround
