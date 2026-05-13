# ADR-010: Client portal lives in NoonWeb — NoonApp is internal-only

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Pedro (Engineering owner)
**Closes:** roadmap §2 decision #4 + roadmap §11.3 cross-repo decisions #8 and #9
**Related:** ADR-008 (commercial scope), `docs/product/master-spec-v3.md` §2.1, §8.1, `docs/audits/v3-phase-0-audit.md` F-10

---

## Context

The Noon product is split into two repositories with two distinct surfaces:

- **`nooncode-org/App-nooncode`** (this repo): internal workspace used by sellers, PMs, developers, sales managers, and admins. Internal CRUD, lead management, delivery, earnings, Maxwell outbound. The client final never enters here.
- **`nooncode-org/noon-web-main`** (NoonWeb): public site, client-facing surfaces, identity provider for the client final.

Master spec v3 §2.1 + §8.1 + flow §10 prescribe that the **client portal** (the post-payment client experience: see project status, request changes, view MVP, manage versions, publish) lives in NoonWeb at `/portal/[projectId]` inside the client's authenticated account.

The current App-nooncode codebase contains a legacy placeholder route `/client/[token]` that was scaffolded before this architectural split was formalized. It does not implement the full v3 portal — it is essentially a token-gated read-only view. Audit finding F-10 in `docs/audits/v3-phase-0-audit.md` flagged this placeholder as a violation of the v3 architecture.

Verification 2026-05-13 against `nooncode-org/noon-web-main` confirmed that **the `/portal/[projectId]` route does not yet exist in NoonWeb**. The only client-facing route in NoonWeb today is `/app/[locale]/maxwell/proposal/[token]/page.tsx`, which handles proposal review and Stripe Checkout payment **before** the client account is even active.

Roadmap §2 decision #4 and roadmap §11.3 cross-repo decisions #8 (path of payment) and #9 (portal location) were the open gating items.

---

## Decision

**The client portal lives in NoonWeb, period. NoonApp is internal-only and will never expose a client-facing portal surface.**

Concretely:

1. **Portal lives at `/portal/[projectId]`** inside `nooncode-org/noon-web-main`, gated by the client's NextAuth (Google) session in their NoonWeb account.
2. **Stripe Checkout runs in NoonWeb** for the client final. The client pays from inside their NoonWeb account; Stripe redirects back to NoonWeb. NoonApp's role in the payment flow is **strictly as receiver** of the `payment-confirmed` webhook from NoonWeb's bridge (already implemented at `/api/integrations/website/payment-confirmed`).
3. **The legacy `/client/[token]` route in App-nooncode is reclassified as legacy debt to be removed.** No new feature work lands on that route. Its removal is scheduled but not blocking; tracked as deferred cleanup in `project.context.core.md` Active risks.
4. **NoonApp internal operators are forbidden from referencing client-facing URLs to clients directly.** All client-visible URLs are NoonWeb URLs. Internal operators (PMs, sellers, admins) may share an App-side URL only among themselves.

This decision closes:

- **§2 #4:** portal lives where? → NoonWeb (until v3 Phase 6 ships the full portal).
- **§11.3 #8:** path of payment? → Stripe Checkout in NoonWeb; App receives `payment-confirmed` webhook. The B7 task in roadmap §6 (persist `stripe_checkout_session_id`) is reframed: App stores the session id received via webhook for traceability, but does not generate it.
- **§11.3 #9:** portal owner? → NoonWeb (same as #4, cross-repo framing).

---

## Architectural truth (capture for `project.context.full.md`)

To remove ambiguity for future sessions, this ADR captures the three-entity model explicitly:

| Entity | Where it lives | Who enters | Purpose |
|---|---|---|---|
| **NoonApp** | `nooncode-org/App-nooncode`, internal route tree under `/dashboard/*` | sellers, PMs, developers, sales managers, admins | Internal workspace: lead/proposal management, delivery, earnings, outbound Maxwell |
| **Client portal** | `nooncode-org/noon-web-main`, route `/portal/[projectId]` (to be built in v3 Phase 2-6) | client final, authenticated via their NoonWeb account | Post-payment client experience: see project status, request changes, view/publish MVP, view proposal, manage payment plan |
| **MVP** | Independent URL per project (deployed by the project itself) | end users of the client's product | The product Noon built for the client (their site / app / store). Embedded into or linked from the client portal |

The portal **is not** the MVP. The MVP is the deliverable. The portal is where the client accesses and manages the deliverable.

The portal **is not** NoonApp. NoonApp is the operator workspace. The client never sees NoonApp.

---

## Rationale

### Why portal in NoonWeb (not App)

- **Identity ownership:** The client's identity is already in NoonWeb via NextAuth (Google). Building portal in NoonApp would require duplicating client auth and dealing with cross-domain SSO. Single identity domain is simpler.
- **Spec alignment:** Master spec v3 §2.1 + §8.1 explicitly place the portal in NoonWeb. Building it in App would lock in a divergence from the spec that has to be paid back later.
- **Surface separation:** NoonApp is the operator workspace. Mixing client and operator routes in the same app increases the blast radius of any RLS / permission mistake. Separation by repository forces explicit cross-repo contracts (already in place via signed webhooks) instead of relying on auth middleware to keep operators and clients apart inside the same app.

### Why now (not deferred to v3 Phase 2-6 scoping)

- The decision is **architectural**, not implementation. Deferring it means every FASE 1-3 design conversation has to entertain "what if portal is in App?" — a hypothesis we have already ruled out.
- Decision #8 (path of payment) cascades from this: knowing Stripe Checkout runs in NoonWeb changes the scope of B7 in FASE 2 immediately. Deferring forces redoing B7 scoping later.
- The legacy `/client/[token]` route is debt. Recording that it is debt today, even if removal is deferred, prevents new feature work from accumulating on top of it.

---

## Consequences

### What this enables

- FASE 1-3 design conversations have a clean architectural ground truth: NoonApp is operator-only.
- The NoonWeb roadmap can scope the `/portal/[projectId]` route as the canonical implementation target without having to argue against an App-side alternative.
- Cross-repo webhook design (`docs/integrations/cross-repo-webhook-v1.md`) stays bounded: payment flows go Web→App via signed webhook; review-decision and milestone events go App→Web via signed webhook. No shared databases, no direct cross-repo reads.

### What this forbids

- **No new client-facing UI work in App-nooncode.** Any UI that the client final would see must be built in NoonWeb. If a FASE 1-3 task seems to require a client-facing surface, escalate to revise scope, not to add to App.
- **No Stripe Checkout creation logic in App.** App may consume Stripe events (webhooks) and may render internal Stripe-related UI (admin views), but App does not create checkout sessions for the client final.
- **`/client/[token]` in App-nooncode must not receive new features.** Bug fixes for existing functionality during the legacy window are acceptable; new functionality is not.

### Legacy debt: `/client/[token]` removal

The placeholder route at App-side `/client/[token]` will be removed after one of the following triggers fires:

- NoonWeb ships `/portal/[projectId]` and proves equivalent functionality for any feature currently on the placeholder.
- A scheduled cleanup iteration explicitly removes it as part of v3 Phase 2 scoping.

Until removal, the route stays in maintenance-only mode. The removal is tracked as deferred cleanup in `project.context.core.md` Active risks rather than as an FASE 1-3 priority.

### Active risks created or updated

- Roadmap §11.3 cross-repo decisions #8 and #9 are reclassified from open to closed.
- Audit finding F-10 in `docs/audits/v3-phase-0-audit.md` is closed: the violation is acknowledged, the path forward is documented, and the placeholder is reclassified as legacy debt rather than as production code.
- New Active risk: until `/portal/[projectId]` ships in NoonWeb (v3 Phase 2-6, mes 3-7), there is **no functional client portal**. FASE 1-3 operates without a client surface; client communication is operator-mediated. This is consistent with ADR-008 internal-only scope.

### Re-evaluation triggers

This ADR must be revisited when:

- v3 Phase 2 scoping begins → confirm `/portal/[projectId]` design hooks into the cross-repo webhook contract correctly.
- A first client signs up in NoonWeb and expects portal access → the gap becomes operational pressure.
- A FASE 2-3 task surfaces a need for client-facing UI in App → escalate before building.

---

## Alternatives considered

- **Build portal in App-nooncode** (Decision 4 Option B "queda en App"): rejected. Diverges from v3 spec, duplicates client identity, increases blast radius.
- **Defer the decision to v3 Phase 2 scoping** (Decision 4 Option C): rejected. Architectural decisions taken under deadline pressure during Phase 2 will be worse than one taken cleanly now. Deferral also leaves `/client/[token]` legacy debt unclassified.

---

## Lifecycle

- **Author:** Pedro (system-docs)
- **Supersedes:** nothing
- **Superseded by:** nothing
