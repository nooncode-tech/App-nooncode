# spec.md — fase-1-b18-error-pages

## template-session-start
> Filled per session-templates skill before active work begins.

### SESSION METADATA
- Date: 2026-05-13
- Session ID: fase-1-b18-error-pages
- Developer: Pedro (noondevelop@gmail.com)
- Main active skill: system-analysis (this spec); downstream system-frontend → system-testing → system-docs → system-validator
- Router mode: Bugfix
- Depth: Full

### OBJECTIVE
- What must be achieved in this session: scope the implementation of B18 (branded error / not-found / loading pages for the App-nooncode root) as a single bounded iteration; produce an explicit handoff for system-frontend covering the four files to create, the auth-awareness contract, and the validation evidence required to close the iteration.
- Why this work matters now: FASE 1 cutover (B1 Stripe live keys + Día 4 real-card smoke test) must run on a UI that handles failure cases gracefully. Today the app has **no** `app/error.tsx`, `app/not-found.tsx`, `app/loading.tsx`, or `app/global-error.tsx` (verified 2026-05-13 via `Glob`). Any 404 or runtime error during the pilot surfaces Next.js's default unstyled fallback — which a real operator or visiting client may interpret as the app being broken. Per roadmap §5 Día 3 this is a pre-cutover requirement, and per the observability deferral risk landed in PR #30 it is also part of the "operator-in-the-loop" mitigation: at minimum, the operator must see a branded "something broke, try this" state instead of a raw stack trace.

### CONTEXT USED
- `project.context.core.md` reviewed: yes
- `project.context.full.md` reviewed: no (per Bugfix FULL default; no contract changes, no architecture changes, no security-sensitive surfaces)
- `project.context.history.md` reviewed: no
- Reason `full` was included if applicable: not required — this iteration touches only Next.js App Router framework conventions, no business contracts, no persisted data shape, no auth model changes.
- Reason `history` was included if applicable: not required.

### ROUTER DECISION
- Why this mode is correct: B18 is a Bugfix in the broader sense (the absence of error pages is a defect, not a new feature) but the files are net-new. There is no New Build framing because no new product capability is introduced, no Recovery framing because the project state is clear, no Refactor framing because no observable behavior is being preserved (the current behavior is the unstyled default). Bugfix FULL fits.
- Why this depth is correct: Full because the change touches the global app shell (root-level error / not-found / loading) and `global-error.tsx` specifically replaces the entire root layout when the root layout itself throws — a wrong design here can degrade the recovery UX for every page in the app.
- Why this skill is the right active skill now: nothing else can route until the affected-files inventory is complete and the auth-awareness contract is fixed. Frontend cannot implement without scope.
- Reroute already known at start: no.
- If yes, explain: n/a.

### SCOPE
- In scope: see "## Scope Boundary" below.
- Explicitly out of scope: see "## Scope Boundary" below.
- Success criterion: see "## Success Criterion" below.

### INPUTS
- Files/modules involved: see "## Affected Files / Modules".
- Contracts or architecture inputs available: `docs/adrs/ADR-008-fase-0-commercial-and-scope.md` (internal-only operation: no client final sees these pages), `docs/adrs/ADR-010-client-portal-lives-in-noonweb.md` (any operator-visible error must steer them back to App's `/dashboard`, never to a "portal cliente" surface that lives in NoonWeb).
- Relevant handoffs received: user confirmed scope "Solo B18 error pages" on 2026-05-13 after iteration scope question. The previous turn closed the FASE 0 §2 gating decisions; B18 is the first FASE 1 iteration.
- External dependencies or environment assumptions: Next.js 16.2.6 App Router conventions (`error.tsx` client component requirement, `global-error.tsx` replaces root html/body, `not-found.tsx` server component default). `@supabase/ssr` 0.10.2 + `@supabase/supabase-js` 2.105.1 for client-side session check. Tailwind v4 + shadcn-style component stack with existing `Button` at `components/ui/button.tsx`. Sonner toaster mounted at root. Root layout brand theme `#080717` (dark NoonApp).

### RISK SNAPSHOT
- Known risks before starting:
  - `app/error.tsx` is REQUIRED to be a Client Component (`'use client'`). It cannot call `getCurrentPrincipal()` directly. Auth-awareness for its CTA must come from the existing `AuthProvider` React Context via the project's `useAuth` (or equivalent) hook.
  - `app/global-error.tsx` replaces the entire root HTML document when the root layout throws. It must render its own `<html>` and `<body>` tags and **cannot** rely on `globals.css` styles being applied if the layout that imports them is the one that failed.
  - `app/loading.tsx` is rendered while a Server Component below it suspends. A heavyweight loading component (large bundle, animation libs) defeats the purpose. Must stay light.
  - `app/not-found.tsx` can be a Server Component but must NOT call code paths that themselves can `notFound()` or throw, or the user sees recursive fallbacks.
- Known blockers before starting: none.
- Known assumptions before starting: the existing `useAuth` hook (from `@/lib/auth-context`) is the established way client components read session state. There is no other identity-resolution path needed for this iteration.

### CONTINUITY NOTES
- Previous session relevant to this one: 2026-05-13 closed FASE 0 §2 gating decisions via 5 ADRs (PRs #29-#31 all merged). No specs were open before this iteration.
- Expected next skill after this session if all goes well: system-frontend, with the handoff payload below.

---

## Task Summary

Implement the four App-Router-level framework pages that NoonApp is currently missing: `app/not-found.tsx` (404 fallback), `app/error.tsx` (runtime-error boundary for route segments below root), `app/loading.tsx` (navigation suspense fallback), and `app/global-error.tsx` (last-resort fallback when the root layout itself throws). All four render NoonApp brand styling, copy in Spanish (the app is español-only per ADR-010 context), and an auth-aware primary CTA that takes the operator either back to `/dashboard` (if a Supabase session exists) or back to `/` (if anonymous). No telemetry wiring (Sentry deferred per the observability decision in PR #30). No per-route segment-level error pages (only the global root-level set).

The work is one chunk, one PR. Approximately 3-4 hours of system-frontend + light system-testing.

---

## Scope Boundary

### Included
- New `app/not-found.tsx` — Server Component. Renders branded 404 page; auth-aware CTA via Server-side `getCurrentPrincipal()` check (this file can be a Server Component because it does not need client-side error recovery).
- New `app/error.tsx` — Client Component (`'use client'`). Receives `error: Error & { digest?: string }` and `reset: () => void` props per Next.js convention. Renders branded error page. Auth-aware CTA via existing React Context (`useAuth` from `@/lib/auth-context`). Exposes a `Reintentar` button wired to `reset()`.
- New `app/loading.tsx` — Server Component. Renders a lightweight branded loading state (centered logo + spinner; no animation libs).
- New `app/global-error.tsx` — Client Component. Renders its own `<html lang="es">` + `<body>` shell because it replaces the root layout entirely. Brand styling applied inline or via minimal Tailwind classes that do not depend on `globals.css` being loaded (the root layout import of globals.css may not have run by the time this file renders).
- Reuse of existing `components/ui/button.tsx` for the CTA where applicable in client components. `global-error.tsx` may need an inline-styled button if `components/ui/button.tsx` indirectly depends on layout-loaded styles.
- Spanish copy throughout, brand-consistent with the existing dashboard UI tone (informative, not alarming; no emojis; no exclamation marks).
- Minimum automated test: a smoke test that imports each new file and asserts it exports a React component (catches accidental `default export` regression). Visual validation is manual / browser-level.
- One PR against `develop`. Not merged by Claude. User merges per memory rule.

### Excluded
- **Per-route segment error pages.** `app/dashboard/error.tsx`, `app/dashboard/leads/error.tsx`, etc. are explicitly NOT included. The root-level pages catch everything by default; segment-level pages are an optimization for cases where part of a dashboard should keep working while another part recovers. That optimization is post-cutover work, not B18.
- **Sentry / external telemetry wiring** in `error.tsx` or `global-error.tsx`. Deferred per the observability decision (PR #30). The pages record nothing beyond what Vercel native logs already capture from Next.js's default error logging.
- **i18n / locale routing.** App is español-only per ADR-010. No translation layer.
- **`app/not-found.tsx` per-segment overrides.** Only the root-level file.
- **Custom error-class taxonomies** (e.g. distinguishing `NetworkError`, `AuthError`, `ValidationError` in `error.tsx`). The error boundary receives a generic `Error` object; we render a generic message. Distinguishing classes is a separate iteration if it ever becomes valuable.
- **Storybook / design-doc visual records** for the new pages. Tracked as deferred polish if anyone wants to add it later.
- **Service-worker / offline support.** Out of scope.
- **Changes to the existing root layout (`app/layout.tsx`).** It remains as-is.
- **Changes to existing route group layouts (`app/dashboard/layout.tsx`, etc.).** Untouched.

---

## Affected Files / Modules

| File | Type | Action |
|---|---|---|
| `app/not-found.tsx` | Server Component | NEW |
| `app/error.tsx` | Client Component | NEW |
| `app/loading.tsx` | Server Component | NEW |
| `app/global-error.tsx` | Client Component | NEW |
| `components/ui/button.tsx` | existing | READ ONLY (reuse) |
| `lib/auth-context.tsx` | existing | READ ONLY (consume `useAuth`) |
| `lib/server/auth/session.ts` | existing | READ ONLY (consume `getCurrentPrincipal` in `not-found.tsx`) |
| `tests/app/error-pages.test.ts` | new test file | NEW (minimum smoke test) |
| `specs/fase-1-b18-error-pages.md` | this file | NEW (Analysis output) |
| `docs/context/project.context.core.md` | existing | UPDATE at iteration close (Closed-in-runtime entry) |
| `docs/context/project.context.history.md` | existing | UPDATE at iteration close (Session note) |

No migrations. No schema changes. No API route changes. No new dependencies.

---

## Dependencies

| Dependency | Type | Status | Impact if missing | Owner |
|---|---|---|---|---|
| Next.js 16.2.6 App Router conventions | external | available | implementation cannot proceed | platform |
| `useAuth` hook in `@/lib/auth-context` | internal | available | client-side error.tsx loses auth awareness; falls back to anonymous CTA | this repo |
| `getCurrentPrincipal` in `@/lib/server/auth/session` | internal | available | not-found.tsx loses auth awareness; falls back to anonymous CTA | this repo |
| `Button` component at `components/ui/button.tsx` | internal | available | CTA styling has to be inlined | this repo |
| Tailwind v4 utility classes loaded by `app/globals.css` | internal | available except in `global-error.tsx` context | `global-error.tsx` must use inline styles or a minimal subset of classes that survive without the root layout | this repo |
| Brand color `#080717` and existing iconography under `public/` | internal | available | branding inconsistent | this repo |

---

## Assumptions
1. The existing `useAuth()` hook in `@/lib/auth-context` returns at minimum `{ user: User | null }` from React Context. (To be validated by system-frontend on first read of that file.)
2. `getCurrentPrincipal()` is safe to call from a Server Component without an active request context; it returns `null` for anonymous and a principal for authenticated. (Validated indirectly by `app/layout.tsx` using it in the same way.)
3. The dashboard route `/dashboard` is the correct landing target for an authenticated operator recovering from an error. Public root `/` is the correct landing target for an anonymous user.
4. Spanish copy is preferred over English. No locale negotiation. No translation strings system.
5. The Sonner toaster mounted at root is not required to be available in `global-error.tsx` (since the root layout is not present); errors do not need to fire toasts in that recovery path.
6. The `Reintentar` button in `error.tsx` calling `reset()` is sufficient to recover from a transient error; we do not need a "send error report" affordance (consistent with no Sentry).
7. `app/loading.tsx` will be triggered by Next.js automatically during route transitions that suspend; no manual instrumentation is required.

---

## Open Questions
None blocking. All design decisions are bounded by the Next.js App Router conventions and by ADR-008 / ADR-010 already-firm rules.

---

## Risks

| Risk | Probability | Impact | Severity | Mitigation |
|---|---|---|---|---|
| `global-error.tsx` styling breaks because `globals.css` is not loaded | medium | low (page is functional but ugly) | low | use inline styles for the minimum critical visual identity (background color, text color, font); accept that this last-resort page is intentionally minimal |
| `useAuth()` hook is not safe to call during error recovery (e.g. it itself depends on a failed provider) | low | medium (error.tsx falls back to anonymous CTA when user is actually logged in) | low | wrap `useAuth()` in a try/catch and default to "Volver al inicio" CTA when it throws |
| Adding a smoke test imports cause unrelated tests to fail (e.g. JSX in a `.ts` file) | low | low | low | use `.tsx` for the test file or render via `@testing-library/react` if the project already pulls it in; verify the project's existing test patterns first |
| Branding inconsistency between the four pages | low | low | low | shared local helper or copied constants for the brand color / spacing / typography across the four files |
| User reaches a 404 via deep-link entity-not-found inside the dashboard (e.g. `/dashboard/leads?leadId=<invalid-uuid>`) and the root `not-found.tsx` overrides the dashboard layout | low | medium (operator loses dashboard chrome) | medium | document that deep-link entity-not-found cases should ideally call `notFound()` from a server component below `app/dashboard/layout.tsx`, which would benefit from a `app/dashboard/not-found.tsx` — but that's out of scope. Root not-found is acceptable for cutover. |
| Test coverage too thin to catch a future regression that removes the file | medium | low | low | the smoke test is intentionally minimal (existence + default export); the real validation is browser-level and one-shot. Visual regression would require a different tool entirely, out of scope. |

---

## Recommended Route Depth (Full / Lite)
**Full.** The change touches the global app shell. A Lite path would skip the documentation update + the smoke test, which would leave the iteration without a regression net.

---

## Chunking Decision
**One chunk, one PR.** The four files are tightly coupled (shared branding, shared auth-awareness pattern, shared CTA helpers) and a single PR is the cleanest review unit at ~3-4 hours of work. Splitting into "not-found first, error second, loading third, global-error fourth" creates four micro-PRs that each have no validatable value alone (an operator cares about "errors look branded", not about "404 looks branded but 500 does not yet").

---

## Success Criterion
The iteration is COMPLETE when **all** of the following are true:

1. The four new files exist in `app/` and each exports a default React component matching Next.js App Router contract:
   - `app/not-found.tsx` exports a default React component (Server Component allowed).
   - `app/error.tsx` is a Client Component (`'use client'` at top), exports a default component receiving `{ error, reset }` props.
   - `app/loading.tsx` exports a default React component (Server Component allowed).
   - `app/global-error.tsx` is a Client Component, exports a default component receiving `{ error, reset }`, renders its own `<html>` and `<body>`.
2. Manual browser validation produces evidence under `docs/validations/Browser validation 2026-05-13 — B18 error pages.md`:
   - Navigating to `/this-route-does-not-exist` (or any non-existing path) renders the branded `not-found.tsx` page with the correct auth-aware CTA for the logged-in operator.
   - Same path while logged out renders the same page with the anonymous CTA.
   - Forcing an error in a `app/dashboard/*` route (e.g. via a deliberate `throw new Error('test')` inside a server component, then reverted) renders the branded `error.tsx` page with `Reintentar` button working.
   - Navigation between two heavy routes shows the branded `loading.tsx` briefly (or, if Next.js renders the loading state too quickly to capture, the test confirms the file is invoked via React DevTools).
   - Forcing an error in the root layout itself (e.g. temporary throw inside `getInitialAuthState`, then reverted) renders the branded `global-error.tsx` page.
3. `pnpm test` passes 201/201 (or 202/202 if the new smoke test adds one).
4. `pnpm run lint` and `pnpm run typecheck` are clean for the new files.
5. `pnpm run build` succeeds without warnings related to the new files.
6. system-validator returns COMPLETE based on this checklist.
7. `project.context.core.md` is updated with a Closed-in-runtime entry referencing this spec and the validation document.
8. `project.context.history.md` is updated with a Session note covering Route used, Implemented, Scope boundary kept, Validation outcome, Docs updated, and Completion status.

---

## Handoff payload to system-frontend

- **Task summary**: implement the four Next.js App Router framework pages per the file table above. Match brand styling to existing dashboard surfaces (dark `#080717` background, accent colors from `app/globals.css` Tailwind theme tokens, typography from existing dashboard headers).
- **Scope boundary**: see "## Scope Boundary" above.
- **Affected files/modules**: see "## Affected Files / Modules" above.
- **Dependencies**: see "## Dependencies" above.
- **Assumptions**: assumptions 1-7 above. Validate assumption #1 (`useAuth` shape) on first read of `lib/auth-context.tsx` before importing it into `error.tsx`.
- **Open questions**: none blocking.
- **Risks that may alter design**: the `global-error.tsx` styling risk is the most likely source of design adjustment — system-frontend may decide to keep that page intentionally minimal (single-color background, system font, basic button) rather than fight Tailwind-not-loaded edge cases.
- **Recommended depth**: Full.
- **Chunking decision**: one chunk, one PR. Do NOT split into per-file PRs.
- **Success criterion**: see "## Success Criterion" above. Specifically, the manual browser validation document is the gating artifact for system-validator.
- **Spec location**: `specs/fase-1-b18-error-pages.md` (this file).

---

## Forbidden constraints carried forward
- Auto-merging the resulting PR.
- Introducing R-codes / Sprint numbers / plan-IDs into `docs/context/*` or any durable repo doc or code comment or commit message or PR body.
- Using absolute local filesystem paths in docs, commit messages, or PR body.
- Wiring Sentry or any external telemetry provider into `error.tsx` / `global-error.tsx`. Observability is deferred per PR #30 risk.
- Adding new dependencies. The implementation must use only what is already in `package.json`.
- Modifying `app/layout.tsx` or any existing route group layout.
- Creating per-segment `error.tsx` / `not-found.tsx` files outside the root.
- Adding i18n / locale routing. App stays español-only.
- Emitting client-facing copy that implies a portal/client-side surface (the operator is the only audience).

---

## Spec lifecycle
- Status: **Approved (Analysis output)**; ready to route to system-frontend.
- Author: system-analysis (Pedro acting as Analysis in this session)
- Date: 2026-05-13
- Supersedes: nothing
- Superseded by: nothing
