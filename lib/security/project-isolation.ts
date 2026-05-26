/**
 * Positive-allowlist sanitization primitive for client-facing surfaces.
 *
 * Forward-prep module per ADR-024 D4 §"E-1 escalation" + roadmap §9.1 Phase 2
 * v3 + Lista App item #4 (mirror v3 contracts). Materializes the formal
 * `sanitizeForClient()` helper that ADR-024 D4 declined to ship in the G22
 * iteration (the inline allowlist at `lib/server/website-integration.ts`
 * `serveWebsitePrototypeSignedRead` was sufficient for the single read
 * endpoint shipped 2026-05-26).
 *
 * Currently consumed by:
 *   — (none yet; G22 ships the inline pattern this module formalizes.)
 *
 * Future consumers (Phase 2 v3):
 *   — Client portal endpoints exposing project status, milestones, deliverables.
 *   — Any future read endpoint surfacing operator-internal rows to a
 *     client-facing render layer (NoonWeb, future client portal).
 *   — A second read endpoint that triggers ADR-024 D4 §E-1 retroactively.
 *
 * Design contract:
 *   — POSITIVE ALLOWLIST construction is the structural defense. Fields NOT
 *     on the allowlist are stripped by virtue of never being read.
 *   — Field-by-field construction; NEVER `{ ...source }` spreads. The helper
 *     interface enforces this by requiring an explicit mapping function or an
 *     explicit allowlist of keys.
 *   — Nested objects MAY be sanitized with a nested allowlist; depth is
 *     bounded to 1 level by design (deeper traversal is the E-1 trigger for a
 *     larger iteration — do NOT extend recursively here).
 *   — Returns a NEW object; the source object is never mutated.
 *   — No runtime cost beyond `Object.entries` + `Object.fromEntries` (V8 fast
 *     paths). Safe for hot read paths.
 *   — This module has zero runtime dependencies and is side-effect-free.
 *
 * Anti-patterns this module exists to prevent:
 *   — `{ ...sourceRow }` spread (leaks every column including future-added ones)
 *   — `Object.assign(response, sourceRow)` (same problem)
 *   — `pick`-style helpers that accept an allowlist but also a "rest" key
 *     (defeats the structural defense)
 *   — Blacklist / strip-list as the primary defense (every future column added
 *     to the source defaults to leakable until someone remembers to add it
 *     to the strip-list)
 */

/**
 * Sanitize a source object into a client-facing object by selecting only the
 * fields named in the allowlist. Fields whose value is `undefined` in the
 * source are preserved as `undefined` in the output (use `null` if the
 * caller wants explicit absence).
 *
 * The output type is computed from the allowlist via TypeScript's `Pick`
 * utility — the caller gets type-narrow output keyed exactly by what was
 * requested.
 *
 * @example
 * ```ts
 * const row = { id: 'x', name: 'A', notes: 'INTERNAL', score: 99 }
 * const safe = sanitizeForClient(row, ['id', 'name'])
 * // safe is { id: string; name: string }; notes + score absent.
 * ```
 */
export function sanitizeForClient<TSource extends Record<string, unknown>, TKey extends keyof TSource>(
  source: TSource,
  allowlist: readonly TKey[],
): Pick<TSource, TKey> {
  const output = {} as Pick<TSource, TKey>
  for (const key of allowlist) {
    output[key] = source[key]
  }
  return output
}

/**
 * Build a client-facing object from a source via an explicit field-by-field
 * mapper. The mapper function receives the source row and returns the
 * client-shape object directly. Use this when the output keys differ from the
 * source keys, when transformations (humanization, derivation) are needed, or
 * when the output is a composition of multiple sources.
 *
 * This is the canonical pattern for ADR-024 D4 §"Sanitization" — every G22
 * handler-style response should use this primitive to enforce field-by-field
 * construction at the type level.
 *
 * @example
 * ```ts
 * const out = buildClientView(workspaceRow, (row) => ({
 *   id: row.id,
 *   businessName: row.lead_company ?? row.lead_name,
 *   projectTypeLabel: humanizeProjectType(row.maxwell_snapshot_project_type),
 * }))
 * ```
 */
export function buildClientView<TSource, TOutput>(
  source: TSource,
  mapper: (source: TSource) => TOutput,
): TOutput {
  return mapper(source)
}

/**
 * Assertion helper for tests / dev: verify a serialized response body does NOT
 * contain any of the forbidden field names. Use in unit tests that grep over
 * `JSON.stringify(responseBody)` after construction; surfaces accidental leaks
 * even when the allowlist was the primary defense.
 *
 * Returns the list of leaked field names (empty when safe). Throws nothing;
 * the caller decides how to escalate.
 *
 * @example
 * ```ts
 * const leaked = findLeakedFieldNames(JSON.stringify(body), [
 *   'created_by', 'notes', 'share_token',
 * ])
 * assert.deepEqual(leaked, [], `forbidden fields leaked: ${leaked.join(', ')}`)
 * ```
 */
export function findLeakedFieldNames(
  serializedBody: string,
  forbiddenFieldNames: readonly string[],
): string[] {
  const leaked: string[] = []
  for (const name of forbiddenFieldNames) {
    if (serializedBody.includes(`"${name}"`)) {
      leaked.push(name)
    }
  }
  return leaked
}
