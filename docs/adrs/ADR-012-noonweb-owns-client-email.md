# ADR-012: NoonWeb is single owner of client-facing email

**Status:** Accepted (default; formal event catalog deferred to v3 Phase 2 scoping)
**Date:** 2026-05-13
**Deciders:** Pedro (Engineering owner)
**Closes:** roadmap §11.3 cross-repo decision #10 (default registered; full sign-off deferred)
**Related:** ADR-010 (client portal lives in NoonWeb), `docs/integrations/cross-repo-webhook-v1.md`, `nooncode-org/noon-web-main` at `lib/maxwell/proposal-email.ts`

---

## Context

Two surfaces could plausibly send email to the client final:

- **NoonWeb (`nooncode-org/noon-web-main`):** the client's identity lives here (NextAuth Google). Verified 2026-05-13 against the public repo: `lib/maxwell/proposal-email.ts:133` exports `sendProposalEmail(input: SendProposalEmailInput)` backed by Resend; the env var `RESEND_API_KEY` gates configuration; `isProposalEmailConfigured()` provides a runtime probe.
- **NoonApp (this repo):** has a structured logger with redaction (`lib/server/api/logger.ts`) but no email-provider integration. Sending client email from App would require adding Resend (or equivalent) as a new dependency, duplicating sender configuration, and reconciling sender domain with NoonWeb.

Roadmap §11.3 #10 records: "hoy ninguno manda email confiable al cliente despues del pago. Web tiene Resend + domain verification + `sendProposalEmail` (pero solo se invoca desde branch SLA muerto, B7+B8 Web). App tiene logger pero no manda mails al cliente."

Two facts narrow the decision:

1. **Through FASE 1-3, the client receives no automated email.** Operation is internal-only (ADR-008). Client communication is operator-mediated (the operator sends manually if needed).
2. **From v3 Phase 2 onward**, when the client portal goes live in NoonWeb, automated client emails become real (payment confirmation, proposal sent, MVP ready, version published, etc.). The owner of those emails must be settled before that work is scoped.

---

## Decision

**NoonWeb is the single owner of all client-facing email.**

Concretely:

1. **Resend (or any future email provider) integration lives only in NoonWeb.** App does not gain an email-provider dependency.
2. **Sender domain, From address, Reply-To address, and template rendering all live in NoonWeb.** A single brand voice for client-facing email is enforced at the infrastructure level.
3. **App publishes domain events to NoonWeb via the existing signed webhook contract** (`docs/integrations/cross-repo-webhook-v1.md`). When App produces an event that should result in a client email (e.g. `proposal_review_decision`, `milestone_reached`, `mvp_ready`), App fires the event over the contract; NoonWeb decides whether and how that event translates to an email.
4. **NoonWeb chooses email semantics.** App does not encode email copy, locale, or template choice in the webhook payload. App provides structured data; NoonWeb renders.
5. **The full catalog of email-triggering events**, the copy, the locale routing, and the template inventory are **deferred to v3 Phase 2 scoping**. This ADR records the ownership; the implementation specifics arrive when v3 Phase 2 (auth pre-pago client + portal activation) becomes the active iteration.

---

## Rationale

### Why NoonWeb owns the email surface

- **Infra is already there.** Resend is configured, domain is verified, `sendProposalEmail` exists with structured error types (`ProposalEmailConfigurationError`, `ProposalEmailSendError`) and a runtime probe (`isProposalEmailConfigured`). Adding the same to App is duplicated work with no benefit.
- **Identity ownership.** The client's address-on-record lives in their NoonWeb account. NoonWeb is the natural authority for "send to the client."
- **Brand consistency.** A single sender domain (mailable from a single repo) prevents the situation where two repos send under two slightly different `From:` headers or two slightly different brand voices.
- **i18n ready.** NoonWeb already uses `[locale]` route segmentation (`app/[locale]/...`). Client locale is a property of the NoonWeb user account. Email templates can read locale from the user; App would have to round-trip locale through every webhook payload.

### Why defer the event catalog

The roadmap explicitly notes the catalog (which event → which email → which template → which locale) is v3-shaped work. Pre-specifying it now would either:

- Lock in events that don't exist yet (e.g. `milestone_reached` is meaningful only after delivery state machine ships), or
- Be too vague to be useful (e.g. "send some email at some point").

The pragmatic record: NoonWeb owns the surface, App emits events through the existing webhook, and the event-to-email mapping is part of v3 Phase 2 spec when it lands.

---

## Consequences

### What this enables

- App-side webhook authors can fire domain events without thinking about email copy, locale, or template. Their contract is "fire a structured event; downstream concerns are NoonWeb's problem."
- NoonWeb can evolve its email stack (provider migration, template engine change, locale expansion) without coordinating with App.
- The existing `sendProposalEmail` dead-branch wiring in NoonWeb (the B7+B8 Web findings) becomes the concrete cleanup target when v3 Phase 2 scoping fires.

### What this forbids

- **No email provider integration in App-nooncode.** No Resend, Postmark, SES, etc. dependencies. No `From: noon` headers from App.
- **No App-side rendering of client-facing email copy.** App may render internal operator notifications (which are not client emails) but not client-bound HTML.
- **No App-side notifications that bypass the webhook contract.** If App needs to inform the client, it does so via a domain event that NoonWeb decides how to convert (email, in-portal notification, etc.).

### Operational gap (registered, not blocking)

Through FASE 1-3, the gap "no client receives automated email" is **accepted and intentional**. Internal operation per ADR-008 means the operator handles client communication out-of-band. If a client-facing email is needed during FASE 1-3 (rare case), it is sent manually by the operator from their own mailbox, not from any system.

### Re-evaluation triggers

This ADR must be revisited when:

- v3 Phase 2 scoping begins → the event-to-email catalog is built as part of that spec.
- A client-side incident exposes a missing notification → fast-track the relevant event into the webhook contract and the email mapping into NoonWeb.
- A provider change (e.g. Resend pricing or deliverability becomes a problem) → NoonWeb-side decision, but documented here as the trigger for ADR revision.

---

## Alternatives considered

- **App also sends some client emails (per-event ownership):** rejected. Splits the brand voice across two repos; duplicates infra; harder to evolve sender domain or template engine.
- **Mediate through a third service (e.g. customer.io, Knock, Loops):** rejected as premature. The current scale does not justify a separate notification platform. Revisit if NoonWeb's Resend integration becomes a bottleneck.
- **Defer the entire decision to v3 Phase 2:** rejected. Even without the event catalog, recording that NoonWeb owns the surface lets App stop entertaining "should I add Resend?" as a question.

---

## Lifecycle

- **Author:** Pedro (system-docs)
- **Supersedes:** nothing
- **Superseded by:** nothing (a v3 Phase 2 follow-up spec will extend with the event catalog, not supersede)
