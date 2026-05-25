# ADR-010: Client portal lives in NoonWeb — NoonApp is internal-only

**Status:** Accepted (amended 2026-05-14 — operator-driven outbound Checkout exception)
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
- **No client-facing Stripe Checkout creation logic in App.** App may consume Stripe events (webhooks), may render internal Stripe-related UI (admin views), and may create Checkout sessions through **operator-driven outbound flows** where an internal user (seller, PM, admin) shares the resulting URL out-of-band to the client final. App does not create Checkout sessions that the client final triggers from a client-authenticated surface — that flow lives in NoonWeb per decision #8. See "Amendment 2026-05-14" below for the operator-driven vs client-driven distinction.
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

## Amendment 2026-05-14: operator-driven outbound Checkout exception

### Context

When the original ADR was accepted on 2026-05-13, the "What this forbids" section included a blanket prohibition: *"No Stripe Checkout creation logic in App. App may consume Stripe events (webhooks) and may render internal Stripe-related UI (admin views), but App does not create checkout sessions for the client final."*

Recon during FASE 1 B1 planning surfaced a concrete tension with this prohibition: the route `app/api/payments/checkout/route.ts` already exists in App and is used by **outbound** flows only (rejects `lead_origin === 'inbound'` with `INBOUND_PAYMENT_LINK_OWNED_BY_WEBSITE` at lines 45-50). Its sole UI consumer is the "Crear/copiar link de pago" button on `components/lead-detail.tsx:881`, used by sellers when sending a proposal to a lead they prospected themselves (outbound), as opposed to leads that arrived via the NoonWeb inbound webhook.

The original rule, read literally, made this route a violation. Read in light of the architectural intent — *separate operator-side and client-side surfaces by repository* — the situation is different: the outbound flow is fully operator-driven. The seller authenticates in App, requests a Checkout link via App's API, receives the URL, and shares it with the lead out-of-band (Gmail, WhatsApp, etc.). The client final never interacts with App; they receive a URL by email/message and click through to Stripe directly.

This is **not** the architectural anti-pattern the ADR was guarding against. The anti-pattern is: *client final authenticates into App and pays from inside an App surface*. That remains forbidden. The intent of the original prohibition was always "no client-facing payment surfaces in App" — the literal wording was over-broad.

### Decision (amendment)

The original prohibition is **narrowed**, not lifted. Stripe Checkout session creation in App is allowed if and only if **all** of the following hold:

1. **Operator-authenticated request:** the API route requires a NoonApp internal-role principal (`admin`, `sales_manager`, `sales`, `pm`). Anonymous, client-facing, or token-only access is forbidden.
2. **Outbound provenance:** the route refuses any flow whose origin is the NoonWeb inbound bridge (current implementation: rejects `lead_origin === 'inbound'`). Inbound payment links stay owned by NoonWeb per decision #8.
3. **Operator-mediated delivery to the client final:** the seller / operator receives the Checkout URL inside App and is responsible for sharing it out-of-band (email, message, link copy). The client final must not be sent into App to retrieve the URL.
4. **No client identity in App:** the client final is never authenticated into App for the purpose of paying. Payment completion is verified by App via the existing Stripe webhook (`/api/webhooks/stripe`), not by any client-side surface in App.

The route `app/api/payments/checkout/route.ts` already satisfies (1), (2), and (4) by construction (auth guard at line 28, inbound rejection at lines 45-50, webhook idempotency ledger via `lib/server/stripe/webhook-events.ts`). Constraint (3) is operational, not code-enforceable; it is recorded as an operating rule for sellers.

Under this amendment, that route is **architecturally consistent with ADR-010**, not a violation. The original "What this forbids" bullet has been rewritten in place to use the precise wording "client-facing Stripe Checkout creation" and to make the operator-driven exception explicit.

### Why this is not erosion of the principle

The principle of ADR-010 is **surface separation by repository**: client-facing surfaces live in NoonWeb; operator-facing surfaces live in App. Each surface owns its own identity, its own auth model, and its own UI.

The outbound Checkout flow is an operator-facing surface (the URL-creation request originates from a seller authenticated into App). It is not a client-facing surface (the client final never sees an App URL during the operator-driven path). The amendment realigns the rule with the principle, rather than weakening either.

The amendment does **not** open the door to:

- Adding a client login / sign-up to App.
- Building a portal / project-status / publish surface in App.
- Routing inbound payment links through App (they stay owned by NoonWeb).
- Allowing client-side JS in App to call `/api/payments/checkout` without an operator principal.

If any of those start looking attractive in a future iteration, ADR-010 must be re-opened, not stretched further.

### What this enables

- **B1 unblocks for Plan C.** The Stripe live keys cutover can proceed without removing `/api/payments/checkout/route.ts` first. The outbound seller flow continues to work in production under the amended interpretation. Plan B (cross-repo migration to NoonWeb-owned outbound checkout) remains a future option if outbound volume justifies the cross-repo work, but it is no longer a blocker for cutover.
- **F-V08** (Stripe checkout link persistence in App) — **implemented 2026-05-16**. Migration `0045_phase_18c_payment_checkout_link_persistence.sql` adds `payments.stripe_checkout_url` + `payments.stripe_checkout_expires_at`; `lib/server/stripe/service.ts` writes both columns on session create and on legacy-row backfill during reuse; `lib/server/payments/checkout-link-repository.ts` + `lib/server/leads/proposal-mappers.ts` surface `activeCheckoutLink` (with server-computed `isExpired`) on `GET /api/leads/[leadId]/proposals`; `components/lead-detail.tsx` consumes it as a four-state UI (paid / active / expired / none) and no longer carries an ephemeral `checkoutLinksByProposalId` React state. The link is delivered via the existing proposal read path; no new client-facing surface introduced. Confirmed not to introduce a client-side read path (re-evaluation trigger below satisfied).

### What this preserves

- **Inbound (client pays from NoonWeb portal) → NoonWeb owns the Checkout creation, App receives the webhook.** Unchanged.
- **`/client/[token]` legacy placeholder → still legacy debt scheduled for removal.** Unchanged.
- **No client-facing UI in App.** Unchanged.
- **NoonWeb is the canonical home of the future `/portal/[projectId]` client experience.** Unchanged.

### Operating rule added to `project.context.core.md`

> Treat `app/api/payments/checkout/route.ts` and the `Crear/copiar link de pago` UI in `components/lead-detail.tsx` as the operator-driven outbound Checkout flow per ADR-010 amendment 2026-05-14. Allowed because (1) the route requires an internal-role principal, (2) it rejects `lead_origin === 'inbound'`, (3) the seller delivers the URL to the client out-of-band, and (4) payment completion is verified by App via the Stripe webhook with no client-side authentication into App. Do not re-introduce a client-authenticated path to this route. Do not let inbound flows bypass the rejection guard.

### Re-evaluation triggers (amendment-specific)

The amendment must be revisited when:

- An outbound flow proposal surfaces that requires the client final to authenticate into App to complete payment (the principle says no — escalate to revise scope).
- Cross-repo migration of outbound checkout to NoonWeb becomes desirable (volume, regulatory, or unification reasons). The amendment does not block migration; Plan B remains the documented path.
- F-V08 (Checkout link persistence) is implemented — confirm the persistence layer does not introduce a client-side read path.

---

## Lifecycle

- **Author:** Pedro (system-docs)
- **Supersedes:** nothing
- **Superseded by:** nothing
- **Amendments:** 2026-05-14 (operator-driven outbound Checkout exception — `What this forbids` clarified, new operating rule recorded in `project.context.core.md`); 2026-05-16 (F-V08 Checkout link persistence implemented — durable `payments` columns + server-side `activeCheckoutLink` enrichment; re-evaluation trigger #3 satisfied)
