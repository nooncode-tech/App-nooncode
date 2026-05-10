# Contracts home

This directory is the canonical home for entity-level contract documents in this repository. A contract here describes **what** an entity is, **how** it behaves over its lifecycle, and **who** produces or consumes it. Contracts here are **doc-only skeletons**: they intentionally exclude SQL, API surface, component paths, migration filenames, and any other implementation detail. Implementation lives elsewhere (`supabase/migrations/`, `app/api/*`, `lib/server/*`, `components/*`) and must conform to the contract; the contract does not pre-author the implementation.

## Convention

- All entity-level contracts go under `docs/contracts/` using kebab-case filenames (e.g. `client-requests.md`).
- Each contract follows the same structural sections: title + responsibility, entity, lifecycle/states, conceptual data shape, inputs/triggers, outputs/consumers, cross-entity references, cross-refs to ADRs / audit / spec / flows, and OPEN markers.
- A contract is the **first** thing produced after Analysis closes and **before** Architecture moves to implementation. It is not a substitute for an ADR; it is a parallel artifact describing entity shape.
- ADRs in `docs/adrs/` are the canonical place for cross-cutting decisions (naming, conventions, runtime choices). When a contract depends on an ADR's decision, the contract cites the ADR by file path.

## Resolved Pre-Phase decisions referenced by these contracts

- **`docs/adrs/ADR-005-maxwell-modules-shared-brand.md`** — resolves audit §7 Q1 (Maxwell naming and ownership). Maxwell is a shared brand identity under which two functionally separate modules operate: `Maxwell Lead Engine V1` (App / outbound / seller-only — already shipped) and `Maxwell Inbound` (website-side, owns post-payment AI MVP pipeline — not yet implemented). A third surface, `Maxwell Chat` (App copilot), is preserved as an independent App-internal copilot under the same brand.
- **`docs/adrs/ADR-006-migration-prefix-convention-and-rename.md`** — resolves audit §7 Q3 (migration numbering). Formalizes the CI guard at `scripts/check-migrations.mjs` as the migration-prefix convention: no new prefix collisions allowed; the existing 8 grandfathered files will be renamed (conditionally) to fresh prefixes starting above the current highest. Execution is deferred pending ledger verification.

## Index of contracts

| Contract | One-line responsibility |
|---|---|
| [`client-requests.md`](./client-requests.md) | Defines the durable client-request entity that captures every request a client submits from the portal and routes it through classification, prioritization, execution, and escalation. |
| [`project-versions.md`](./project-versions.md) | Defines the per-project version entity that owns the Private Preview / Published / Previous Published / Rolled Back / Delivered Version lifecycle the client portal exposes. |
| [`ai-mvp-pipeline-state.md`](./ai-mvp-pipeline-state.md) | Defines the post-payment Maxwell AI MVP pipeline run as a stateful entity (GPT specification → V0 base → Opus improvement → minimum validation, with bounded auto-fix and escalation). |
| [`seller-fee-state-machine.md`](./seller-fee-state-machine.md) | Defines the seller-fee entity for outbound activation payments and its state transitions (Potential → Confirmed → Pending payout → Paid out / Cancelled). |

## Cross-cutting OPEN markers (decided at index level, not per-contract)

These two open audit questions affect more than one contract simultaneously and are tracked here rather than duplicated inside individual contracts.

- OPEN: gated by audit §7 Q8 (i18n scope)
- OPEN: gated by audit §7 Q9 (notifications channels)

## OPEN-marker canonical format

All contracts in this directory use a single canonical format for unresolved questions:

```text
OPEN: gated by audit §7 Q<N> (<short topic>)
```

`<N>` is the question number from `docs/audits/v3-phase-0-audit.md` §7. `<short topic>` is a brief tag identifying the open thread. Validator and downstream skills treat any unresolved OPEN marker as a contract-level blocker for the corresponding implementation iteration.

## Skeleton-depth boundary

Contracts in this directory are intentionally bounded:

- No SQL fragments, no DDL, no migration filenames invented.
- No API route paths.
- No component or file-path references in `app/`, `lib/`, `components/`, or `supabase/migrations/`.
- No prescribed implementation steps; no library names beyond what the v3 spec or audit already names.
- No plan-IDs, no R-codes, no Sprint references, no Phase-N references.

When a contract grows beyond this boundary, it stops being a contract and starts being an Architecture deliverable. In that case, escalate back to the router rather than expanding the contract in place.
