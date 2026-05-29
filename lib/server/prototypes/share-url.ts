/**
 * Compose the client-facing URL for sharing a prototipo with a lead's customer.
 *
 * The URL points at NoonWeb's `/maxwell/prototipo/[token]` route, which
 * server-renders the prototipo via `prototype-signed-read` (ADR-024) and
 * captures the client's accept/reject via `prototype-decision` (ADR-023).
 *
 * The host is read from `NOON_WEBSITE_PUBLIC_BASE_URL`. The default
 * `https://noon-main.vercel.app` matches the current Production NoonWeb
 * deployment; operators can override in Vercel env vars for staging or
 * preview environments. NoonWeb uses `localePrefix: "always"` per
 * `noon-web-main/i18n/routing.ts`, so every URL MUST include a locale
 * segment — default `es` matches the operating market.
 *
 * Returns `null` when the token is missing (workspace in `pending_generation`
 * may carry a token, but the UX should not surface a link until the
 * prototipo is renderable — caller decides when to invoke this).
 */
const DEFAULT_NOON_WEBSITE_BASE = 'https://noon-main.vercel.app'
const DEFAULT_LOCALE = 'es'

function resolveNoonWebsiteBase(): string {
  const candidate = process.env.NOON_WEBSITE_PUBLIC_BASE_URL?.trim()
  if (!candidate) return DEFAULT_NOON_WEBSITE_BASE
  return candidate.replace(/\/+$/, '')
}

export function buildPrototypeShareUrl(
  token: string | null | undefined,
  options: { locale?: string } = {},
): string | null {
  if (!token || token.trim().length === 0) return null
  const base = resolveNoonWebsiteBase()
  const locale = options.locale?.trim() || DEFAULT_LOCALE
  return `${base}/${locale}/maxwell/prototipo/${token}`
}
