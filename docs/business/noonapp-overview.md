# NoonApp — Business Overview

## What is NoonApp

NoonApp is a B2B SaaS platform that digitizes the commercial and delivery cycle for a software agency. It connects three roles — sales, project management, and developers — through a single operational surface: from lead acquisition to client payment and project delivery.

The product is internal-facing. Clients interact only through a limited portal (read-only project status + payment). All operational work happens inside the dashboard.

---

## Core business flows

### 1. Lead acquisition and qualification
A seller identifies a business opportunity (outbound) or receives one from the website (inbound). The lead is scored, assigned, and tracked through a commercial pipeline. Maxwell AI assists sellers with lead discovery by location, zone, and business profile.

### 2. Commercial hand-off
The seller submits a proposal for a lead. When the proposal is accepted, it converts into a project. This is the boundary between sales and delivery.

### 3. Project delivery
The PM creates tasks and tracks progress. Developers receive and update their assigned tasks. Updates are communicated through the project activity feed.

### 4. Client payment
A checkout session is created via Stripe and shared with the client through a public token-based portal. No client account required. Payment confirms the project and triggers earnings distribution.

### 5. Earnings and commissions
On every confirmed payment, the earnings ledger is automatically populated. Sellers earn a fixed commission ($100) plus points. Developers earn a percentage of the base amount. Withdrawals are requested via the dashboard.

---

## Roles

| Role | Primary domain | Key capabilities |
|---|---|---|
| `admin` | Full access | All operations, earnings consolidation, admin directory |
| `sales_manager` | Commercial | Lead and proposal management, team oversight |
| `sales` | Commercial | Lead acquisition, proposal creation, Maxwell access |
| `pm` | Delivery | Project management, task assignment, PM queue |
| `developer` | Delivery | Task updates, developer board, wallet |

---

## Key entities

| Entity | Description |
|---|---|
| Lead | A potential client opportunity. Has a status, score, value, and assignment. |
| Proposal | A commercial offer tied to a lead. Contains amount, content, and lineage. |
| Project | A confirmed engagement derived from an accepted proposal. |
| Task | A unit of work within a project, assigned to a developer or PM. |
| Prototype | A UI mockup generated via v0 and linked to a lead/proposal. |
| Payment | A Stripe checkout session tied to a proposal. Triggers earnings on success. |
| Earning | A ledger entry crediting a collaborator after a confirmed payment. |
| Notification | An in-app alert triggered by activity on leads, projects, or tasks. |

---

## Business constraints

- A lead can only be claimed by one seller at a time (locking via `locked_by_proposal_id`).
- A proposal must be in `handoff_ready` state to convert to a project.
- A payment can only succeed once per proposal. Duplicate confirmation is idempotent via Stripe event ledger.
- Withdrawal requests are manual — admin reviews and marks them as paid externally.
- Client portal access is token-based and time-limited. No authentication required.

---

## Revenue model (platform)

- Outbound leads: noon takes 50% of the base amount (after the $100 seller commission).
- Inbound leads: noon takes 50% of the base amount. Developer gets the other 50%.

---

## Boundaries — what NoonApp is NOT

- Not a public-facing product. The website (separate repo) handles public presence and inbound.
- Not a billing system. Stripe handles payment processing.
- Not a database admin UI. Supabase handles infrastructure.
- Not a design tool. v0 handles prototype generation.
