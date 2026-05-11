# Integrations home

This directory documents interface contracts between NoonApp and external systems that share state across process / repo / company boundaries. These are NOT entity contracts (those live in `docs/contracts/` and have a stricter convention: no API paths, no SQL, no migration filenames). An integration contract documents the wire-level protocol of an external integration: URLs, headers, payload shapes, error codes, idempotency, versioning.

## Convention

- Filenames are kebab-case and end with a version suffix: `<integration-name>-v<N>.md`.
- A version bump (`-v1` → `-v2`) preserves the previous file as historical reference and adds the new file.
- Each integration contract follows the same structural sections: overview, authentication, endpoints (per direction), error responses, rate limiting, idempotency, versioning strategy, env vars, test fixtures, reference implementation paths, open issues, change control, references.
- The contract is the source of truth. Code on both sides MUST conform. Drift between code and contract is a bug.

## Index

| Contract | Scope | Status |
|---|---|---|
| [`cross-repo-webhook-v1.md`](./cross-repo-webhook-v1.md) | Bidirectional signed HTTPS webhooks between NoonApp (this repo) and NoonWeb (`noon-web-main`) | v1, live in production |

## Cross-repo coordination

Each integration contract that crosses a repo boundary MUST be maintained as an identical copy in both repos. Any change requires:

1. Daily-sync alignment between the two repo maintainers.
2. Simultaneous PRs in both repos.
3. Breaking changes follow the per-contract migration window (see each contract's §9 / Versioning section).

## When to add a new file here

- A new external system starts sharing state with App (e.g. a third-party CRM, a billing provider with custom webhook payloads beyond Stripe).
- An existing integration changes shape in a breaking way and needs a `-v2` file.

## When NOT to add a file here

- The integration is fully library-managed (e.g. Stripe webhook is documented by Stripe; we use their SDK; no need to duplicate their docs). The exception is when our specific event subset and idempotency layer add meaningful interface detail — then it belongs here.
- The integration is internal to the App repo only (no external recipient). That belongs in `lib/server/*` JSDoc or a `docs/architecture/` design doc.
