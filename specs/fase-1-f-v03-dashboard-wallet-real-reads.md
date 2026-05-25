# spec.md — fase-1-f-v03-dashboard-wallet-real-reads

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-13
- Session ID: fase-1-f-v03-dashboard-wallet-real-reads
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-frontend → system-testing → system-docs → system-validator
- Router mode: Bugfix
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope F-V03 to close the visible contradiction between the dashboard / sidebar "Balance: no disponible" chips and the real wallet UI at `/dashboard/earnings` + `/dashboard/credits`. In `supabase` mode, `selectPersonalStatsAvailability` should derive the balance chip from a real read of `/api/wallet` instead of returning fake "Sin datos reales" copy. Analysis only — no code edits.
- Why this work matters now: the operator-in-the-loop FASE 1 pilot needs the dashboard to tell a coherent story. Today an admin or seller sees "Balance: no disponible" at the top of `/dashboard` but the real wallet ledger at `/dashboard/earnings` and `/dashboard/credits` shows actual USD. The discrepancy creates support-burden ("¿por qué dice no disponible si tengo plata?") and undermines trust in the operator surface right before the cutover.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: no (no contract / architecture changes; reads existing endpoint and renames a chip)
- `project.context.history.md` reviewed: no
- Reason `full` was included if applicable: not required — frontend honesty fix over existing real endpoint.
- Reason `history` was included if applicable: not required.

### ROUTER DECISION
- Why this mode is correct: the change reduces a long-standing visual lie ("no disponible" when in fact real data exists). It is a Bugfix because no new product capability is introduced — the bug is the fake copy. Files touched: 3 (selector + dashboard page + sidebar) + 1 new hook + 1 test. Bugfix FULL fits.
- Why this depth is correct: Full because the change touches the global dashboard shell and the sidebar (visible to every authenticated user) and the selector signature change has 2 callers. A Lite path would skip the test and miss the regression risk of the selector signature change.
- Why this skill is the right active skill now: nothing else can route until the affected-files inventory and the chip-mapping policy (`availableToSpend` only? plus `availableToWithdraw`? include `pending`?) are fixed. Frontend cannot implement without scope.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules".
- Contracts or architecture inputs available: existing `/api/wallet` endpoint at `app/api/wallet/route.ts` returns `WalletSummaryWire` via `getVisibleWallet`. Wire shape includes `monetaryWallet: { availableToSpend, availableToWithdraw, pending, locked }` (USD cents).
- Relevant handoffs received: user confirmed F-V03 as next iteration on 2026-05-13 after closing B14 PR #37.
- External dependencies or environment assumptions: none. `/api/wallet` is auth-gated by `requirePrincipal`; existing auth flow is reused. No new env vars.

### RISK SNAPSHOT
- Known risks before starting:
  - **Operating rule on `/dashboard/rewards`.** `project.context.core.md` line ~384 explicitly says "Treat `/dashboard/rewards` and the sidebar user dropdown as intentionally honest unavailable-state UI in `supabase` for rewards/points, **not as real implementations**". F-V03 does NOT change that posture. The rewards/points chip stays as honest "no disponible" — only the balance/wallet chip becomes real. This is documented and bounded inside the spec.
  - **Loading state visibility.** A fresh dashboard mount briefly shows "Balance: cargando..." (or equivalent) until the wallet fetch resolves. Acceptable; aligns with how `/dashboard/credits` already behaves.
  - **Error state.** If `/api/wallet` fails (rate limit, server error, transient network), the chip falls back to a clearly-labeled error state ("Balance: no se pudo cargar"), not silently to the fake "no disponible".
  - **Both callers fetch independently.** `app/dashboard/page.tsx` and `components/app-sidebar.tsx` both consume the selector. Without coordination, both would issue independent `/api/wallet` requests on every mount. Mitigation: introduce a thin `useWallet` hook that memoizes per-mount and de-dupes when both components render in the same tree.
  - **Mock mode regression.** The selector preserves the existing `mock` branch (read `user.balance` / `user.points`). The new branch handles `supabase`. No behavior change for `mock`.
- Known blockers before starting: none.
- Known assumptions before starting:
  - `WalletSummaryWire.monetaryWallet.availableToSpend` is the right value for the "Balance" chip. The spec uses `availableToSpend + availableToWithdraw` as the displayed total (the "liquid" portion of the wallet — what the user can use or withdraw right now). Pending and locked are NOT included in the chip; they stay only in `/dashboard/earnings` + `/dashboard/credits` detail views.
  - The wallet is per-user (always equal to `principal.userId`). No multi-account or shared-wallet scenarios.
  - The auth-aware sidebar dropdown reads the same wallet data; no separate API needed.

### CONTINUITY NOTES
- Previous session relevant to this one: 2026-05-13 closed B14 iteration (PR #37). F-V03 is the third FASE 1 iteration after B18 and B14.
- Expected next skill after this session if all goes well: system-frontend, with the handoff payload below.

---

## Task Summary

Close the visible contradiction in `lib/dashboard-selectors.ts:300-313`: in `supabase` mode, `selectPersonalStatsAvailability` should derive the balance chip from a real read of `/api/wallet` instead of returning the fake "Sin datos reales" / "Balance: no disponible" copy. The change introduces a small `useWallet()` hook in `lib/hooks/use-wallet.ts`, refactors the selector to accept an optional `walletSummary` argument, updates both callers (`app/dashboard/page.tsx` and `components/app-sidebar.tsx`) to fetch and pass the wallet, and explicitly preserves the honest-unavailable behavior for rewards/points per the operating rule in `core.md` line ~384.

The work is one chunk, one PR. Approximately 3-4 hours of system-frontend + light system-testing.

---

## Scope Boundary

### Included
- New `lib/hooks/use-wallet.ts` — a React hook that:
  - Returns `{ wallet: WalletSummary | null, isLoading, error }`
  - Only fetches when `authMode === 'supabase'` and `user !== null`
  - In `mock` mode, returns `{ wallet: null, isLoading: false, error: null }` so the selector falls through to the existing mock branch
  - Single fetch per mount (no SWR / no refresh on focus). Two-level coordination across dashboard page + sidebar via React Context (`WalletContext`) so the same value is shared without double-fetching
  - Deserializes wire shape using existing `deserializeWalletSummary` from `lib/wallet/serialization` (already used by `/dashboard/credits`)
- New `lib/wallet/context.tsx` (or similar) — `WalletProvider` + `useWalletContext` that fetches once on mount when in supabase mode, exposes the snapshot to children. Mounted inside `AuthProvider` so both `app/dashboard/page.tsx` and `components/app-sidebar.tsx` consume from the same value
- Refactor `selectPersonalStatsAvailability(authMode, user)` to `selectPersonalStatsAvailability(authMode, user, walletSummary?)`:
  - `mock` branch unchanged
  - `supabase` branch now reads `walletSummary` if present:
    - `isRealDataAvailable: true` for balance, **still `false` for points** (rewards out of scope per operating rule)
    - `balanceValueLabel: $<availableToSpend + availableToWithdraw>` formatted as USD
    - `balanceDescription: 'Disponible para gastar y retirar (USD).'`
    - `sidebarBalanceLabel: 'Balance: $<n>'`
    - `pointsValueLabel: 'Sin programa real'` — unchanged (rewards honest)
    - `pointsDescription: 'Puntos y recompensas todavía no están conectados al runtime real.'` — unchanged
    - `earningsTitle: 'Ganancias'` (was 'Ganancias no conectadas')
    - `earningsDescription: 'Balance, comisiones y retiros visibles en /dashboard/earnings.'`
    - `earningsActionLabel: 'Solicitar Retiro'` (was 'Retiros no disponibles')
    - `rewardsTitle: 'Rewards no conectadas'` — unchanged
    - `rewardsDescription: 'No existe una fuente real de puntos, historial o canje para esta cuenta en modo Supabase.'` — unchanged
    - `rewardsActionLabel: 'Canje no disponible'` — unchanged
  - When `walletSummary === null` in supabase (loading or error), the labels show explicit `Balance: cargando` / `Balance: no se pudo cargar` instead of the previous "no disponible". The selector accepts an `isLoading` and `error` arg or branches on `walletSummary` being null vs an explicit error marker
- Update `app/dashboard/page.tsx`:
  - Mount `useWalletContext` (or fallback `useWallet` if no provider)
  - Pass the wallet snapshot to `selectPersonalStatsAvailability`
- Update `components/app-sidebar.tsx`:
  - Same as above
- Add `WalletProvider` to the dashboard layout (`app/dashboard/layout.tsx`) so both sidebar + page tree share the same context
- New test `tests/lib/dashboard-selectors.test.ts` (or extend an existing one):
  - `mock` mode returns existing labels with `user.balance` (regression net)
  - `supabase` mode with `walletSummary` returns real `$<n>` label
  - `supabase` mode without `walletSummary` (loading) returns "cargando" or equivalent
  - `supabase` mode with explicit error marker returns "no se pudo cargar"
  - Rewards/points branch unchanged in all cases (still honest unavailable)
- Update `docs/context/project.context.core.md` operating rules at iteration close:
  - Operating rule line ~384 still says rewards is honest-unavailable — unchanged
  - New operating rule: dashboard / sidebar balance chip in `supabase` reads `/api/wallet`; do not regress to "no disponible" copy
- One PR against `develop`. Not merged by Claude.

### Excluded
- **Rewards / points wiring.** Per `core.md` line ~384, the rewards chip stays honest-unavailable. F-V03 is bounded to the balance/wallet half of the selector. A future F-V03b would address rewards when that domain is productized.
- **`/api/wallet` server-side changes.** The endpoint is reused as-is.
- **SWR / cache invalidation strategy.** Single fetch per dashboard mount is enough for FASE 1 pilot. No mutation triggers.
- **Toast notifications on wallet error.** A silent fallback to "no se pudo cargar" is enough for FASE 1 — the operator can refresh.
- **Loading skeleton.** Inline "cargando" text is enough; no skeleton component required.
- **Animations / micro-interactions** on the chip during transitions between loading / loaded / error states.
- **i18n / locale switching** for the new copy. Spanish-only per ADR-010.
- **Refactor of the existing `mock` branch.** Untouched.
- **Wallet polling / live updates.** One-shot fetch on mount.

---

## Affected Files / Modules

| File | Type | Action |
|---|---|---|
| `lib/dashboard-selectors.ts` | source | EDIT — refactor `selectPersonalStatsAvailability` to accept optional `walletSummary` + loading + error |
| `lib/hooks/use-wallet.ts` | source | NEW |
| `lib/wallet/context.tsx` | source | NEW (or reuse existing wallet helpers if any) |
| `app/dashboard/page.tsx` | source | EDIT — mount/consume wallet context, pass to selector |
| `app/dashboard/layout.tsx` | source | EDIT — wrap children with `WalletProvider` |
| `components/app-sidebar.tsx` | source | EDIT — consume wallet context, pass to selector |
| `tests/lib/dashboard-selectors.test.ts` | test | NEW (mock + supabase + loading + error) |
| `specs/fase-1-f-v03-dashboard-wallet-real-reads.md` | spec | NEW (this file) |
| `docs/context/project.context.core.md` | context | UPDATE at iteration close — operating rules + Closed-in-runtime entry |
| `docs/context/project.context.history.md` | context | UPDATE at iteration close — Session note |

No migrations. No schema changes. No new API routes. No new deps.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| `/api/wallet` endpoint | internal | available | implementation cannot proceed | this repo |
| `WalletSummary` + `deserializeWalletSummary` from `lib/wallet/serialization` | internal | available | duplicate deserialization work | this repo |
| `useAuth()` from `lib/auth-context` for `authMode` + `user` | internal | available | hook cannot determine mode | this repo |
| Existing fetch pattern in `app/dashboard/credits/page.tsx` (auth-aware, error handling) | internal | available | hook would need to reinvent | this repo |

---

## Assumptions
1. `WalletSummary.monetaryWallet.availableToSpend + availableToWithdraw` is the right number for "Balance" semantics. Validated by inspecting the existing UI at `/dashboard/credits` which already breaks down the same buckets.
2. The dashboard layout (`app/dashboard/layout.tsx`) is the right place to mount the `WalletProvider`. Validated by the fact that the sidebar is rendered inside that layout for every dashboard route.
3. `useAuth().user` is always non-null inside `/dashboard/*` (route is protected by the proxy / middleware). Validated by the existing code paths that already assume it.
4. `mock` mode users continue to have `.balance` and `.points` fields. Validated by `mockUsers` having them.
5. Brief flash of "Balance: cargando" is acceptable UX. If user disagrees, we can pre-fetch via React Server Component or pass initial value through the layout — but that's a separate iteration.
6. The selector's existing role-based config (the `mock` branch returning `Solicitar Retiro` etc.) does not need parallel role checks in the `supabase` branch — wallet auth is per-user, not per-role.

---

## Open Questions
None blocking.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| Both dashboard page and sidebar issue separate `/api/wallet` requests | high if no context | low (~one extra request) | low | `WalletProvider` shared via React Context; both components consume the same value |
| `/api/wallet` rate-limited under high concurrency now that more pages hit it | low (limit not aggressive) | low | low | reuse the existing rate-limit policy; no new namespace |
| Selector signature change breaks an external caller we missed | low | medium | low | grep covered both call sites; if a 3rd caller appears later, it gets the old behavior (omit `walletSummary` argument → fall back to existing fake copy) |
| `useAuth` throws (no provider) inside the new hook | very low | medium | low | the hook is consumed only inside the dashboard tree where AuthProvider is mounted at root; same guarantee as B18's `error.tsx` |
| Wallet fetch fails silently and user sees stale "Balance: no se pudo cargar" forever | low | low | low | the chip clearly labels the error state; manual refresh resolves it; no observability wiring needed beyond browser console |

---

## Recommended Route Depth (Full / Lite)
**Full.** The change touches the global dashboard shell + sidebar (visible to every authenticated user), refactors a selector signature with 2 callers, and introduces a new React Context provider mounted in the layout. A Lite path would skip the test or the provider abstraction, leaving regression risk for the next visual fix.

---

## Chunking Decision
**One chunk, one PR.** Hook + context + selector refactor + caller updates + tests must land atomically to keep `tsc` valid and the UI coherent. Splitting into "hook first, callers second" creates a sequence of broken PRs.

---

## Success Criterion
The iteration is COMPLETE when **all** of the following are true:

1. `lib/hooks/use-wallet.ts` exists with signature `useWallet(): { wallet: WalletSummary | null, isLoading: boolean, error: Error | null }`.
2. `lib/wallet/context.tsx` (or equivalent) exposes `WalletProvider` + `useWalletContext` so the dashboard tree shares a single fetch.
3. `app/dashboard/layout.tsx` mounts the `WalletProvider` for the dashboard subtree.
4. `selectPersonalStatsAvailability` accepts an optional `walletSummary` argument (plus loading/error markers as needed). The `mock` branch is unchanged. The `supabase` branch returns real balance copy when data is loaded, "cargando" when loading, "no se pudo cargar" when error, and never the previous fake "no disponible".
5. `app/dashboard/page.tsx` and `components/app-sidebar.tsx` both consume the wallet context and pass to the selector.
6. Rewards / points labels in `supabase` mode preserve the existing honest-unavailable copy. The operating rule in `core.md` line ~384 is unchanged.
7. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` all clean.
8. `pnpm test` reports green with at least 4 new tests (mock branch regression, supabase with wallet, supabase loading, supabase error). Baseline 210 → at least 214.
9. Browser validation evidence under `docs/validations/Browser validation YYYY-MM-DD — F-V03 dashboard wallet real reads.md` confirming:
   - Admin / seller / pm user sees real `Balance: $<n>` in the dashboard header chip + sidebar dropdown
   - On a slow connection, the brief loading state shows "Balance: cargando" instead of fake "no disponible"
   - On a forced fetch error (e.g. via DevTools network blocking), the chip shows "Balance: no se pudo cargar"
   - Rewards / points chip remains honest "no disponible" (no regression)
   - `mock` mode dashboard still works (no regression for the demo path)
10. system-validator returns COMPLETE.
11. `project.context.core.md` updated: Closed-in-runtime entry + new operating rule for the dashboard balance chip.
12. `project.context.history.md` updated: Session note for F-V03.

---

## Handoff payload to system-frontend

- **Task summary**: implement per the file table. Mount the `WalletProvider` once in the dashboard layout; both consumers read the same snapshot. Selector signature change is mechanical for the 2 call sites.
- **Scope boundary**: see "## Scope Boundary" above.
- **Affected files/modules**: see "## Affected Files / Modules".
- **Dependencies**: see "## Dependencies".
- **Assumptions**: 1-6 above. Validate assumption #1 (`availableToSpend + availableToWithdraw` is the right "Balance" number) by spot-checking how `/dashboard/credits` displays the same buckets.
- **Open questions**: none.
- **Risks that may alter design**: the React Context vs. direct hook decision. If the dashboard layout already has a similar provider pattern, follow that. Otherwise introduce `WalletProvider` cleanly.
- **Recommended depth**: Full.
- **Chunking decision**: one chunk, one PR. Do NOT split into "hook → consumers".
- **Success criterion**: see above.
- **Spec location**: `specs/fase-1-f-v03-dashboard-wallet-real-reads.md` (this file).

---

## Forbidden constraints carried forward
- Auto-merging any of the resulting PRs (spec PR or implementation PR).
- Introducing R-codes / Sprint numbers / plan-IDs into `docs/context/*` or any durable repo doc or code comment or commit message or PR body.
- Wiring rewards / points to real data in this iteration. That stays honest-unavailable per `core.md` operating rule.
- Adding SWR, react-query, or any new state-management dep.
- Adding new env vars.
- Modifying the existing `mock` branch behavior.
- Adding observability / telemetry wiring (Sentry deferred per PR #30).
- Refactoring unrelated dashboard / sidebar code.

---

## Spec lifecycle
- Status: **Approved (Analysis output)**; ready to route to system-frontend.
- Author: system-analysis (Pedro acting as Analysis in this session)
- Date: 2026-05-13
- Supersedes: nothing
- Superseded by: nothing
