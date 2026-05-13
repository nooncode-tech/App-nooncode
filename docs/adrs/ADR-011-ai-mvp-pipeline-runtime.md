# ADR-011: AI MVP pipeline runtime — Vercel Functions + cron + queue, budget deferred to FASE 4 PoC

**Status:** Accepted
**Date:** 2026-05-13
**Deciders:** Pedro (Engineering owner)
**Closes:** roadmap §2 decisions #5 and #6 + roadmap §11.3 cross-repo decision #11
**Related:** ADR-010 (App-NoonWeb split), `docs/product/master-spec-v3.md` §15-§19, `docs/contracts/ai-mvp-pipeline-state.md`, `lib/server/v0/client.ts`, `app/api/prototypes/[prototypeWorkspaceId]/generate/route.ts`

---

## Context

Master spec v3 §15-§19 specifies an **AI MVP pipeline** that runs after the client's activation payment is confirmed. The pipeline takes the client's accepted proposal as input and auto-generates a website prototype through a multi-step LLM workflow:

```
client proposal accepted
  ↓
GPT — spec generation (structured product spec from proposal)
  ↓
V0 — prototype generation (React + Tailwind output)
  ↓
Opus — quality validation
  ↓
auto-fix loop (up to 5 iterations of GPT/V0/Opus refinement)
  ↓
ready MVP delivered to client portal
```

### What exists today (verified 2026-05-13 in App-nooncode)

- **V0 step is wired and operational.** `lib/server/v0/client.ts` wraps the `v0-sdk` and calls `v0.chats.create` in `responseMode: 'sync'`. Output is `{ content, demoUrl, chatUrl }`.
- **Generate endpoint exists.** `POST /api/prototypes/[prototypeWorkspaceId]/generate` loads the prototype workspace, fetches lead + proposal context, builds a prompt, calls V0, persists the result.
- **Schema columns exist.** Migration `0033_phase_5b_v0_generation_columns.sql` added the V0 output columns to `prototype_workspaces`.
- **Env var declared.** `V0_API_KEY` is declared in `.env.example` as optional.
- **Runtime today is one synchronous Vercel Function call** triggered by an authenticated operator request (`admin | pm | sales_manager | sales` per the route guard). Not yet wired to post-payment activation.

### What does not exist today

- **GPT spec generation step** (upstream of V0). The pipeline today goes directly from prompt → V0.
- **Opus validation step**. No quality gate after V0.
- **Auto-fix iteration loop**. No multi-pass refinement.
- **Async orchestration**. The V0 call is synchronous in the request lifecycle; Vercel Functions have a 300s timeout (Fluid Compute default per platform knowledge update 2026-02-27).
- **Post-payment activation trigger**. Today an operator triggers the generation manually; the v3 design fires it automatically when Stripe webhook confirms the activation payment.

Roadmap §2 decision #5 forces a choice on the **runtime** for the full pipeline when v3 Phase 5 (mes 3-7) builds out the remaining steps. Decision #6 forces a choice on the **LLM budget**. Cross-repo §11.3 #11 forces a choice on **who orchestrates** the pipeline (App or NoonWeb).

---

## Decision

### #5 — Runtime

**The AI MVP pipeline stays on Vercel Functions. When asynchronous orchestration is needed, it is added via Vercel Cron + a queue table in App's Supabase.** No external worker service is introduced.

Concretely:

- **Short steps (V0 call, GPT spec generation, Opus validation):** synchronous Vercel Functions, one function per step. Each step must individually fit within the 300s function timeout.
- **Auto-fix loop and orchestration:** a queue table (`ai_pipeline_jobs` or similar — schema to be designed in v3 Phase 5 spec) records pipeline state and pending steps. A Vercel Cron at a reasonable cadence (likely 1 minute) picks up pending jobs and advances them step by step.
- **Failure handling:** the queue table records retry counts; a per-job circuit breaker prevents runaway cost.
- **Re-evaluation trigger:** if the PoC in FASE 4 (one project end-to-end through the full pipeline) reveals that any individual step exceeds 300s consistently, this ADR is revisited and the offending step migrates to an external worker. The rest of the pipeline stays on Vercel.

### #6 — Budget

**The LLM budget ceiling is not defined today. It will be set after the FASE 4 PoC** based on measured cost per project, latency, and quality. Until then, the pipeline does not run autonomously (still operator-triggered only), and an explicit budget guard rail is **not in place**.

Concretely:

- Through FASE 1-3, the V0 step continues to be operator-triggered only. No client traffic drives LLM cost.
- FASE 4 includes a PoC: one project passes through GPT spec → V0 → Opus → validation → at most 5 auto-fix iterations. Cost per project is measured, latency is measured, quality is human-evaluated.
- The PoC outcome feeds a follow-up ADR that sets a monthly budget ceiling, a per-project cost ceiling, and a circuit-breaker policy. Until that follow-up ADR ships, no automatic activation of the pipeline runs in production.

### #11 — Orchestration owner

**App-nooncode orchestrates the pipeline. NoonWeb fires the activation event and renders status / result in the client portal.**

Concretely:

- The Stripe webhook for activation payment is received by App (already wired at `/api/webhooks/stripe`). The payment-confirmed event from NoonWeb is also received by App at `/api/integrations/website/payment-confirmed` (already wired).
- App's webhook handler enqueues a pipeline job in the queue table once the payment is confirmed and the proposal is in scope.
- The Vercel Cron in App runs each step, persists state in App's Supabase, and emits status events back to NoonWeb via the existing signed webhook contract when major milestones complete (pipeline started, prototype ready, validation passed, prototype delivered).
- NoonWeb's portal at `/portal/[projectId]` (to be built in v3 Phase 2-6) reads the milestone events and renders a status view + the MVP URL when ready. NoonWeb does not run any pipeline step itself.

---

## Rationale

### Why Vercel Functions for the runtime

- **Continuity:** the V0 step already runs as a Vercel Function. Extending the model (cron + queue) instead of migrating it preserves the working integration.
- **Cost floor:** Vercel Functions billing is active-CPU-time + invocations. For LLM-dominated workloads where most of the request lifecycle is waiting on the LLM provider, this is significantly cheaper than provisioning an always-on worker.
- **Operational simplicity:** no new infra to provision, no new deploy pipeline, no new monitoring surface. Everything stays inside the Vercel + Supabase ecosystem that the team already operates.
- **Fluid Compute fit:** the platform's Fluid Compute model reuses function instances across concurrent requests, reducing cold starts for LLM-bound workloads where the function is mostly idle waiting on the provider.

The main risk of staying on Vercel is the 300s function timeout. Mitigation: **individual pipeline steps** must fit within 300s. The orchestration of multi-step + auto-fix loop is achieved by **state in the queue table**, not by holding a single function execution open for the full pipeline. Each step is a fresh function invocation reading state, doing one unit of work, writing state.

### Why defer the budget decision

- The cost-per-project number for the full pipeline is unknowable without running it end-to-end. GPT pricing, Opus pricing, V0 pricing, and the average number of auto-fix iterations are all multiplicative.
- Setting a budget ceiling without measurement either over-constrains the pipeline (too low → useful work is blocked) or under-constrains it (too high → no protection against runaway loops).
- The FASE 4 PoC is explicitly designed to produce the cost number. Setting the budget after the PoC is the only way to set it correctly.
- Risk mitigation **until the PoC runs**: the pipeline does not auto-trigger in production. No client payment automatically initiates a pipeline run. Operator-triggered runs are bounded by manual oversight.

### Why App orchestrates (not NoonWeb)

- **Existing infrastructure:** App already has the queue table candidates (Supabase), the auth model (server-side roles), the wallet and earnings model (where pipeline costs will eventually deduct), the seller-fee state machine (which interacts with the activation event), and the V0 wrapper.
- **Webhook topology:** Stripe webhook lands in App. Adding pipeline orchestration in App keeps the activation event flow linear (Stripe → App → pipeline → status events → NoonWeb → client portal). Putting orchestration in NoonWeb would force App → NoonWeb roundtrips on every step.
- **NoonWeb scope discipline:** NoonWeb owns client identity, client portal, public site, marketing surface. Adding pipeline orchestration to NoonWeb expands its responsibility beyond client experience.

---

## Consequences

### What this enables

- v3 Phase 5 scoping (mes 3-7) can proceed with a known runtime constraint. The pipeline design is "Vercel + cron + queue, steps under 300s each" — clear architectural budget.
- The FASE 4 PoC can be scoped concretely: one project, full pipeline, end-to-end, measure cost.
- The V0 step that exists today (`lib/server/v0/client.ts`) is the reference for how every subsequent step is wired: Vercel Function, env-keyed provider client, sync call, persisted output.

### What this forbids

- **No external worker service is introduced before v3 Phase 5 PoC completes.** If a Phase 5 design needs to argue for external workers, it must produce measurement-backed evidence from the PoC.
- **No auto-triggered pipeline runs in production until the budget ADR follow-up ships.** Operator-triggered only until then.
- **No pipeline orchestration code lands in NoonWeb.** NoonWeb consumes milestone events; it does not produce them.

### Active risks created or updated

- Risk: until the FASE 4 PoC ships, the full-pipeline cost is unknown. If v3 Phase 5 development starts before the PoC, design assumptions may be wrong.
- Risk: Vercel Function 300s timeout may be tight for a future pipeline step. Mitigation is design-time (split the step) but if a real step refuses to fit, this ADR is revisited.
- Risk: the queue table design is not yet specified. The schema choice will shape the auto-fix loop semantics. Tracked as v3 Phase 5 design work.

### Re-evaluation triggers

This ADR must be revisited when:

- The FASE 4 PoC produces real cost-per-project and latency numbers → follow-up ADR sets the budget ceiling.
- Any pipeline step refuses to fit in 300s on Vercel → revisit runtime for that specific step (likely move to external worker; keep the rest on Vercel).
- A platform change in Vercel Functions affects the timeout or cost model → revisit cost-benefit.
- v3 Phase 5 spec lands and proposes a different orchestration topology → revisit owner.

---

## Alternatives considered

- **External worker from day one (Cloud Run / Railway / Fly.io):** rejected. Premature complexity. No evidence yet that the pipeline cannot fit Vercel Functions; introducing external infra before the PoC is over-engineering.
- **Pre-set LLM budget at €500-1000/mo with circuit breaker:** rejected (Decision 6 Option A). Without measurement the ceiling number is a guess. Either too low (blocks useful work) or too high (no protection).
- **NoonWeb orchestrates the pipeline:** rejected (cross-repo §11.3 #11 Option B). Expands NoonWeb scope beyond client experience; forces extra webhook roundtrips; duplicates existing App infra.

---

## Lifecycle

- **Author:** Pedro (system-docs)
- **Supersedes:** nothing
- **Superseded by:** nothing (the FASE 4 PoC follow-up ADR will extend, not supersede)
