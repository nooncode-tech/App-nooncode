# Contract: dashboard summary

**Responsibility:** Define the dashboard-summary entity — the role-aware, server-aggregated view of an authenticated principal's currently-visible sales and delivery key performance indicators (KPIs), rendered on the dashboard home — and its lifecycle, role visibility, and invalidation triggers.

## Entity

`dashboard_summary` is the conceptual entity representing one read of the principal's role-scoped KPI numbers at one point in time. It is **read-only and derived** — there is no persisted `dashboard_summary` row. Each read recomputes the values from the underlying sales (`leads`) and delivery (`projects`, `tasks`) entities under the principal's row-level visibility. The contract treats this read as a first-class entity (a payload with a stable shape and stable semantics across the lifecycle of the application) so that consumer surfaces and invalidation triggers can be reasoned about without referring to specific implementation files.

The dashboard summary is **not the same as** the raw entity lists. The lists are paginated per-page surfaces; the summary is a single payload of pre-aggregated counters and sums covering the entire visible set under the principal's RLS scope.

The exact server-side composition strategy (single composite query vs fan-out), the wire field naming, the parity rules for delivery counters that depend on a derived project display status, and the cache and invalidation policy on the consumer side are **resolved in `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`**. This contract names the entity and its lifecycle; the ADR pins implementation.

## States / lifecycle / transitions

The summary itself has no entity-state machine (it is a derived read). It has a **freshness lifecycle** on the consumer side:

- **Loading** — the consumer has requested a summary but no payload has yet arrived.
- **Fresh** — a payload has arrived and is within the configured freshness window (TTL set in ADR-020).
- **Stale-but-displayable** — the payload is older than the freshness window. The consumer continues to display the existing values while a background refetch is in flight.
- **Errored** — the most recent refresh failed. The consumer continues to display the last successful payload (if any) and surfaces an error affordance.
- **Invalidated** — a known input has changed (a mutation enumerated in the invalidation surfaces list, see Inputs / triggers). The consumer treats the cached payload as immediately stale and triggers a refresh.

Transitions:

- `Loading → Fresh` on successful response.
- `Loading → Errored` on transport / server failure.
- `Fresh → Stale-but-displayable` on TTL expiry.
- `Stale-but-displayable → Fresh` on background refetch success.
- `Stale-but-displayable → Errored` on background refetch failure (payload kept displayed; error surfaced separately).
- `Fresh → Invalidated → Loading or Stale-but-displayable` after a known mutation; the consumer triggers a refresh and either swaps the displayed payload or shows a loading state depending on policy in ADR-020.
- `Errored → Fresh` on operator-initiated retry.

The summary is **idempotent**: two reads in a row over the same underlying data return identical payloads. This is a hard contract — non-idempotent reads would break consumer caching.

## Conceptual data shape

Named fields (no SQL types, no DDL):

**Sales section**

- `open leads count` — number of leads the principal can see whose state is not in the closed set (won / lost).
- `won leads count` — number of leads the principal can see whose state is the won terminal state.
- `pipeline value sum` — sum of the value attribute over the open leads visible to the principal.
- `total revenue sum` — sum of the value attribute over the won leads visible to the principal.
- `closed leads count` — number of leads the principal can see whose state is in the closed set (won or lost). Provided as raw input for the consumer's conversion-rate derivation; the contract does NOT pre-divide.
- `overdue follow-ups count` — number of leads the principal can see whose scheduled follow-up moment is in the past AND whose state is not closed. Count only; no row preview on the wire (see Outputs / consumers).
- `leads by status histogram` — a status-to-count map covering every status enum value the principal can see (zero entries are omitted; the consumer fills zeros locally if needed for layout).

**Delivery section**

- `active projects count` — number of projects the principal can see whose derived display status is the active in-progress state. The derived display status is governed by the project's persisted status combined with the status pattern of its own visible tasks; the exact rule is the `deriveProjectDisplayStatus` contract referenced in cross-entity references.
- `projects in review count` — same shape, for the review display status.
- `completed projects count` — same shape, for the completed display status.
- `pending tasks count` — number of tasks the principal can see whose state is the not-yet-started state.
- `in progress tasks count` — number of tasks the principal can see whose state is the active state.
- `review tasks count` — number of tasks the principal can see whose state is the under-review state.
- `actionable tasks count` — sum of pending and in-progress task counts; provided server-side for consumer convenience.

**Envelope**

- `checked at moment` — the server-side moment the read was computed. Consumers MAY surface this in operator tooling; consumers MUST NOT use it for client-side cache decisions (the TTL is consumer-side, not server-side).

**Role visibility (the contract that binds field availability to role):**

| Section / field | `admin` | `sales_manager` | `sales` | `pm` | `developer` |
|---|---|---|---|---|---|
| Sales section, all fields | all visible leads | all visible leads | own visible leads | own visible leads (typically empty under existing RLS) | own visible leads (typically empty under existing RLS) |
| Delivery section, project counters | all visible projects | all visible projects | own-lineage visible projects | all visible projects | all visible projects |
| Delivery section, task counters | all visible tasks | **not available** (RLS denies SELECT) | **not available** (RLS denies SELECT) | all visible tasks | own-assigned visible tasks |
| `checked at moment` | always present | always present | always present | always present | always present |

When a field is "not available" for a role, the wire returns an explicit absence marker (the exact encoding — `null` vs missing — is pinned in `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`). The consumer renders the field as a non-actionable placeholder ("—" or equivalent honesty affordance), never as zero.

The role-scoped numbers for the delivery counters on tasks are an intentional product characteristic: the developer role, by design, sees only their own delivery surface. This means two principals reading the same dashboard on the same tenant at the same moment legitimately see different numbers; that is not a defect.

## Inputs / triggers (what causes a refresh)

A consumer obtains a refreshed payload when:

- **The dashboard home mounts** for the first time in a session.
- **The freshness window expires** (TTL elapses while the dashboard is displayed; the consumer triggers a background refetch).
- **A known mutation completes successfully.** The enumerated mutation surfaces that MUST trigger a refresh are: every operation that creates, deletes, or changes a state-bearing or value-bearing attribute on a lead, project, or task that the principal can see. The complete list (15 surfaces) is pinned in the analysis spec referenced under cross-refs; ADR-020 wires each surface to the refresh trigger.
- **The principal manually retries** after an errored state.

The summary is NOT refreshed on:

- Read-only consumer interactions (opening a lead detail, hovering a card).
- Navigation away from the dashboard and back, if the freshness window has not expired.
- Mutations to entities outside the sales / delivery scope (notifications, settings, earnings, wallet, points). These are explicitly out-of-trigger because they do not contribute to any sales or delivery KPI field.

Out-of-band mutations (changes to the underlying entities that originate outside the consumer's session — for example, a server-to-server webhook that flips a project's payment-activation state, or an inbound review approval that changes a proposal status) are **acknowledged stale-window inputs**: the next consumer-side refresh picks them up, but the consumer is not actively notified. The contract treats this as an accepted limitation of the current iteration; the consumer-visible window is bounded by the freshness TTL.

## Outputs / consumers (who reads or reacts)

- **Dashboard home page** — the canonical consumer. Renders the sales section, the delivery section, and the three header-row extras (conversion rate, overdue follow-ups, leads-by-status histogram).
- **Sales section** — rendered only when the principal has sales access (per role-aware UI gating).
- **Delivery section** — rendered only when the principal has delivery access (per role-aware UI gating); task counters within the section render only when the wire field is present (not the role-RLS "not available" marker).
- **Conversion rate derivation** — the consumer divides won leads count by closed leads count, rounding to the nearest integer percent, and renders `null` (placeholder) when closed leads count is zero. The server does NOT pre-compute the percentage to keep the wire shape stable (one server-side change cannot accidentally change the consumer's rounding semantics).
- **Overdue follow-ups card** — renders the count and a deep-link to the leads list. Does NOT render a preview of overdue rows; the consumer who wants a list of overdue rows uses the leads list page's own filtered view. The contract pins this as the current product decision (see "Open markers").
- **Sidebar badges** — explicitly NOT consumers of the dashboard summary. Sidebar notifications continue to read their own independent endpoint.
- **Reports page** — NOT a consumer of the summary; the reports page loads its own per-section data because its rendering shape is different (per-period series, not point-in-time counters).
- **Mock mode** — does NOT consume the summary. The mock consumer derives KPI values entirely from in-memory mock data using the existing client-side selector. The summary entity is a `supabase`-mode concept; the mock path is preserved untouched to keep demo continuity.

## Cross-entity references

- `lead` entity — the source of all sales-section counters and sums. The summary respects the lead state enum (`new`, `contacted`, `qualified`, `proposal`, `negotiation`, `won`, `lost`) and the lead's `next follow up moment` attribute.
- `project` entity — the source of all delivery-section project counters. The summary respects the project's persisted state enum (`backlog`, `in_progress`, `review`, `delivered`, `completed`) AND the `payment activated` application filter (projects with `payment activated = false` are excluded from the counters, consistent with the project list surface).
- `task` entity — the source of all delivery-section task counters AND the per-project derived display-status rule. The summary respects the task state enum (`todo`, `in_progress`, `review`, `done`).
- `derived project display status` (`deriveProjectDisplayStatus`) — the rule that combines a project's persisted state with the state pattern of its tasks to produce the display state used by the delivery project counters. The exact rule is implementation-side (`lib/projects/progress.ts`); the contract treats it as a referenced parity contract. ADR-020 reproduces the rule in the aggregate query.

## Cross-refs to ADRs / audit / spec / flows

- **ADR:** `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md` — implementation decisions (RLS posture, SQL parity body for the derived display-status rule, wire shape, cache TTL, invalidation policy, module boundaries).
- **Spec:** `specs/fase-3-r3-lazy-load-with-aggregates.md` — analysis output; enumerates the 15 mutation surfaces, the 12 base KPIs + 3 dashboard-home extras, the role coverage matrix, the parity acceptance criteria, the test fixture rule.
- **Sibling contract precedent:** `docs/contracts/seller-fee-state-machine.md` — same skeleton-depth convention; no SQL, no routes, no migrations.
- **Audit:** none directly. The dashboard summary is a structural rewrite, not an audit deliverable.
- **Flows:** none directly. Dashboard rendering is implementation; no master-spec flow document covers this.

## OPEN markers

- **CLOSED 2026-05-22 by `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`:** RLS aggregate scoping (§D1).
- **CLOSED 2026-05-22 by `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`:** parity body for the derived project display status rule (§D2).
- **CLOSED 2026-05-22 by `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`:** server-side composition strategy (§D3).
- **CLOSED 2026-05-22 by `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`:** wire shape for the overdue follow-ups field (count-only, no preview) (§D4).
- **CLOSED 2026-05-22 by `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`:** consumer cache freshness window (§D5).
- **CLOSED 2026-05-22 by `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`:** consumer-side invalidation mechanism after the 15 enumerated mutation surfaces (§D6).
- **CLOSED 2026-05-22 by `docs/adrs/ADR-020-dashboard-summary-aggregates-and-invalidation.md`:** hook location for the consumer-side summary state (§D7).
- **OPEN (deferred by spec §4, acknowledged in ADR-020 §R5):** real-time push for out-of-band mutations originating outside the consumer session (Stripe payment confirmation, inbound proposal review webhook). Current contract: the next consumer-side refresh picks these up; the consumer is not actively notified. Reconsider in a future iteration if pilot feedback indicates the stale window is uncomfortable.
- **OPEN (pre-authorized by ADR-020 §future extensibility):** optional `overdue follow-ups preview` array of up to N most-overdue lead summaries. Current contract: count only. Field is reserved by name; addition requires a contract amendment and an ADR amendment together.
