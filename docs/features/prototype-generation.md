# Feature: Prototype Generation (v0)

## Intent
A seller can request a UI prototype for a lead directly from the dashboard. The prototype is generated automatically by v0 using the lead's business data, and the result is shared as a live demo link — reducing the time-to-proposal and increasing conversion.

---

## Scenarios

### Scenario: Seller requests a prototype
```
Given a lead with notes, tags, company, and an associated proposal with amount
When the seller clicks "Generar con v0" on a pending workspace
Then POST /api/prototypes/[workspaceId]/generate is called
And a prompt is built automatically from the lead data
And the v0 API generates a React/Next.js component
And the result (code + demo URL) is saved to the workspace
And the workspace status transitions from 'pending_generation' to 'ready'
```

### Scenario: Seller views the generated prototype
```
Given a workspace with status 'ready'
When the seller opens the prototype view
Then they see the generated code inline
And a link to the v0.dev chat for further iteration
And a live demo URL
```

### Scenario: v0 API key is missing
```
Given the V0_API_KEY environment variable is not set
When the generate endpoint is called
Then the operation fails with a clear server error
And the workspace status remains 'pending_generation'
```

---

## Prompt construction

The prompt is built automatically from:
- Lead: `name`, `company`, `tags`, `notes`
- Proposal: `amount`, `content` (title/description)

No manual brief required from the seller.

---

## API surface

| Method | Route | Role |
|---|---|---|
| POST | `/api/prototypes/[workspaceId]/generate` | admin, pm, sales |
| POST | `/api/prototypes/[workspaceId]/handoff` | admin, pm |
| GET/POST | `/api/prototypes` | admin, pm |
| GET/PATCH | `/api/prototype-settings` | admin |

---

## Invariants

- Workspace status only transitions to `ready` after a successful v0 response is persisted.
- `generated_content` is stored as-is from v0 — no post-processing.
- A workspace in `ready` state can still trigger a new generation (iteration use case).
- v0 client is instantiated via `lib/server/v0/client.ts` using `V0_API_KEY` env var.
