# UI Intention: Dashboard Navigation

## Purpose

The dashboard is a role-gated operational surface. Every section is only visible to the roles that have work to do there. Navigation is not decorative — it is a filtered view of the user's operational domain.

---

## Navigation model

Navigation items are defined in `lib/dashboard-navigation.ts` and filtered by `lib/server/auth/policy.ts` at render time. Users never see sections they cannot access.

| Section | Roles with access | Primary intent |
|---|---|---|
| Pipeline | sales, sales_manager, admin | Visual kanban of active leads by stage |
| Leads | sales, sales_manager, admin | Full lead list with search, filter, and actions |
| PM Queue | pm, admin | Proposals awaiting PM review and assignment |
| Projects | pm, admin, developer | Active project cards with task progress |
| Tasks | pm, admin, developer | Cross-project task board (personal or all) |
| Updates | pm, admin, developer | Activity feed per project |
| Earnings | sales, admin | Commission ledger, pending payout, withdrawal |
| Rewards | sales, admin | Points balance, tier progress, reward store |
| Web Analysis | sales, sales_manager, admin | Lead research and website analysis tools |
| Notifications | all | In-app notification list with unread count |
| Settings | all (filtered) | Role-dependent tabs (admin sees all, others see Notifications only) |
| Reports | admin | Platform-level analytics |

---

## Key UX principles

**No empty states that require guessing.** Every section should explain what it does when empty and what action the user should take.

**Actions close to context.** Lead actions (call, email, whatsapp) are on the lead card itself — not in a separate menu. The user should not navigate away to act.

**Status is always visible.** Leads, proposals, projects, and tasks all have a visible status badge. The user should never have to open a detail view just to know the current state.

**Role-aware copy.** A developer should see "my tasks" framing. A PM should see "project tasks" framing. A seller should see "my leads" framing. One interface, multiple mental models.

---

## Maxwell integration point

Maxwell (AI assistant) is accessible from within the Leads section. It is not a global overlay. It operates in the seller's context — lead discovery, scoring, and speech generation are tightly scoped to the commercial workflow.

Maxwell chat (`/api/maxwell`) is a general assistant fallback. Maxwell lead search (`/api/maxwell/lead-searches`) is the scoped outbound search tool.

---

## Client portal (outside dashboard)

The client portal (`/client/[token]`) is intentionally minimal:
- No navigation
- No account required
- Read-only: project name, status, payment amount
- Single action: "Pagar ahora" (triggers Stripe Checkout)

The portal's visual language should feel trustworthy and simple, not like an internal tool. It is the only surface a client ever sees.
