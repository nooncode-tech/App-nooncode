# Feature: Lead Lifecycle

## Intent
A seller can acquire, qualify, and hand off a lead through a structured pipeline — from first contact to confirmed proposal — without losing context or duplicating effort.

---

## Scenarios

### Scenario: Seller creates an outbound lead
```
Given the user has role 'sales' or 'sales_manager' or 'admin'
When they submit a new lead with name, email, and source
Then the lead is created with status 'new' and assigned to the creating user
And the creation is recorded in the lead activity log
```

### Scenario: Seller claims a released lead
```
Given a lead with status 'released' (no_response release)
And the lead is not locked by another proposal
When a seller calls claim on that lead
Then the lead is re-assigned to the claiming seller
And status transitions back to 'contacted'
```

### Scenario: Lead is locked by a proposal
```
Given a lead with an active proposal in progress
When another seller attempts to claim or propose on that lead
Then the operation is rejected with a conflict error
And the lead remains locked to the original proposal
```

### Scenario: Proposal is submitted and accepted (hand-off)
```
Given a lead with status that allows proposals
When a seller creates a proposal with amount and content
And the proposal is marked 'handoff_ready'
Then the lead transitions to reflect a pending hand-off
And the PM queue receives the proposal for review
```

### Scenario: Lead released after no response
```
Given a lead assigned to a seller
When the auto-followup job or the seller triggers a no-response release
Then the lead status becomes 'released'
And the lock is cleared
And the release is recorded in activity
```

### Scenario: Maxwell suggests leads by location
```
Given a seller with a location (current GPS or manual zone)
When they open the Maxwell lead search
Then Maxwell returns a ranked list of nearby business opportunities
Filtered by allowed radius for the seller's role
And scored by confidence (min threshold enforced)
And deduplicated against existing leads
```

---

## Status transitions

```
new → contacted → qualified → proposal_sent → handoff_ready
                                           ↓
                                        released (no_response)
```

---

## API surface

| Method | Route | Role |
|---|---|---|
| GET | `/api/leads` | sales, sales_manager, admin |
| POST | `/api/leads` | sales, sales_manager, admin |
| GET | `/api/leads/[leadId]` | sales, sales_manager, admin |
| PATCH | `/api/leads/[leadId]` | sales, sales_manager, admin |
| DELETE | `/api/leads/[leadId]` | admin |
| POST | `/api/leads/[leadId]/claim` | sales, sales_manager, admin |
| POST | `/api/leads/[leadId]/release` | admin |
| GET/POST | `/api/leads/[leadId]/proposals` | sales, sales_manager, admin |
| POST | `/api/maxwell/lead-searches` | sales, sales_manager |

---

## Invariants

- A lead always has an `assigned_to` once claimed.
- `locked_by_proposal_id` is set atomically via DB RPC (`claim_released_lead`).
- Activity log entries are append-only — never deleted or updated.
- Maxwell search results are deduplicated via `maxwell_dedupe_key` before insert.
