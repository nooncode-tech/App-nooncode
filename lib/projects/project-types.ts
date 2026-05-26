/**
 * Canonical project-type vocabulary for App-nooncode.
 *
 * Forward-prep module per roadmap §9.1 Phase 2 v3 + Lista App item #4 (mirror
 * v3 contracts). Holds the closed enum of project-type identifiers + the human
 * labels exposed to client-facing surfaces.
 *
 * Currently consumed by:
 *   — (none yet; the G22 prototype-signed-read handler at
 *     `lib/server/website-integration.ts` ships an inline humanization map
 *     that mirrors this content. A future iteration may refactor that handler
 *     to import from here, collapsing the duplicate.)
 *
 * Future consumers (Phase 2 v3):
 *   — Maxwell ingestion (`leads.maxwell_snapshot.project_type` populator).
 *   — Outbound `lead_proposals.project_type` enum (already a string column in
 *     migration 0047; this module canonicalizes the allowed values).
 *   — Client portal v3 surfaces rendering project-type badges.
 *
 * Design contract:
 *   — `ProjectType` is the closed set of identifier strings recognized at
 *     ingest. Sources outside this set (legacy data, user-typed free text)
 *     pass through `humanizeProjectType` and degrade to the `DEFAULT_LABEL`.
 *   — Synonyms (e.g., `landing` and `landing_page`) MAY map to the same label;
 *     storage normalization is NOT a concern of this module.
 *   — The labels are user-facing copy (Spanish). Localization is a future
 *     iteration; do NOT import i18n machinery here.
 *   — This module has zero runtime dependencies and is side-effect-free.
 */

export type ProjectType =
  | 'landing'
  | 'landing_page'
  | 'webapp'
  | 'web_app'
  | 'ecommerce'
  | 'e_commerce'
  | 'sitio_web'
  | 'website'

/**
 * Default label returned by `humanizeProjectType` when the raw input is null,
 * empty, or not a recognized `ProjectType`. Used as the safe fallback at
 * client-facing render time.
 */
export const DEFAULT_PROJECT_TYPE_LABEL = 'Sitio Web' as const

/**
 * Canonical map from identifier to user-facing label. Synonyms (`landing`
 * vs `landing_page`) intentionally collapse to the same label.
 */
export const PROJECT_TYPE_LABELS: Readonly<Record<ProjectType, string>> = Object.freeze({
  landing: 'Landing Page',
  landing_page: 'Landing Page',
  webapp: 'Web App',
  web_app: 'Web App',
  ecommerce: 'E-commerce',
  e_commerce: 'E-commerce',
  sitio_web: 'Sitio Web',
  website: 'Sitio Web',
})

/**
 * Type guard for narrowing an arbitrary string to a known `ProjectType`.
 * Comparison is case-insensitive and trims surrounding whitespace; callers
 * may pass raw JSONB extractions without pre-normalization.
 */
export function isKnownProjectType(value: unknown): value is ProjectType {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(PROJECT_TYPE_LABELS, normalized)
}

/**
 * Humanize a raw project-type identifier into a user-facing label.
 *
 * Returns `DEFAULT_PROJECT_TYPE_LABEL` (`'Sitio Web'`) when:
 *   — `raw` is null / undefined / non-string,
 *   — `raw.trim()` is empty,
 *   — `raw` does not match any key in `PROJECT_TYPE_LABELS` after case-fold +
 *     trim normalization.
 *
 * Never throws.
 */
export function humanizeProjectType(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PROJECT_TYPE_LABEL
  const normalized = raw.trim().toLowerCase()
  if (normalized.length === 0) return DEFAULT_PROJECT_TYPE_LABEL
  // `hasOwnProperty` guards against prototype keys (`__proto__`, `constructor`,
  // `toString`) that would otherwise resolve via prototype chain rather than
  // the canonical map.
  if (!Object.prototype.hasOwnProperty.call(PROJECT_TYPE_LABELS, normalized)) {
    return DEFAULT_PROJECT_TYPE_LABEL
  }
  return PROJECT_TYPE_LABELS[normalized as ProjectType]
}
