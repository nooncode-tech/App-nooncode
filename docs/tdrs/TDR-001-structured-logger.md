# TDR-001: Custom structured logger with recursive secret redaction

**Status:** Implemented  
**Date:** 2026-05-04  
**File:** `lib/server/api/logger.ts`

---

## Problem

Server-side logs in Next.js API routes default to `console.log` with unstructured strings. This creates two problems:
1. Sensitive data (tokens, signatures, API keys) can leak into log output.
2. Logs cannot be reliably parsed, aggregated, or filtered by external tooling.

---

## Decision

Implement a minimal custom logger that:
- Emits JSON to stdout/stderr (structured, machine-parseable)
- Includes `level`, `event`, and `timestamp` on every entry
- Recursively redacts values whose key matches a sensitive pattern before serializing
- Truncates string values longer than 500 characters
- Is silenceable via `NOON_LOG_SILENT=true` for test environments

---

## Implementation details

**Sensitive key pattern:**
```ts
/secret|password|token|authorization|cookie|signature|key|credential/i
```

This is applied recursively to nested objects. Arrays are mapped element-by-element.

**Output format:**
```json
{ "level": "info", "event": "lead.created", "timestamp": "2026-05-04T00:00:00Z", "leadId": "abc" }
```

**Usage:**
```ts
logger.info('lead.created', { leadId, assignedTo })
logger.error('stripe.webhook.failed', { ...errorToLogContext(error) })
```

---

## Tradeoffs

| Concern | Decision |
|---|---|
| External logging provider (Sentry, Datadog) | Deferred — JSON stdout is compatible with any log aggregator |
| Log correlation / request IDs | Partially done: hardened routes include a `requestId` in responses, but it is not propagated to log context yet |
| Frontend error logging | Not implemented — client-side errors are unobserved |
| Distributed tracing | Not implemented |

---

## Test coverage

`tests/server/api/logger.test.ts` verifies:
- Recursive redaction of sensitive keys in nested objects
- Truncation of strings longer than 500 characters

---

## Known gaps

- `logger` is only used in 5 routes (maxwell, stripe webhook, website integration). The rest use no logging at all.
- Request ID is not threaded through to log context — correlation requires manual effort.
- No log aggregation pipeline exists yet. Output goes to stdout only.
