/** @type {import('next').NextConfig} */

// Baseline security headers applied to every response.
// CSP is intentionally not set here yet — designing a CSP that is
// compatible with Next 16, React 19, Stripe Elements, v0 SDK and the
// AI SDK streaming endpoints needs a focused survey of actual script,
// style, image, and connect sources. Track separately.
const securityHeaders = [
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // camera + microphone are not used; geolocation is used by Maxwell's
    // location-aware lead search in app/dashboard/leads/page.tsx, so
    // first-party access is allowed.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), interest-cohort=()',
  },
  {
    // Two-year HSTS with subdomains. Vercel terminates TLS so this is
    // safe even when Next is invoked over plain HTTP locally; browsers
    // honour HSTS only on responses received over HTTPS.
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
]

const nextConfig = {
  images: {
    // No <Image> usage in the app yet. Keeping unoptimized=true means
    // any future <Image src="..." /> renders without the optimizer.
    // When images are introduced, switch to an explicit remotePatterns
    // allowlist instead of opting back into the optimizer blindly.
    unoptimized: true,
  },
  // Force inclusion of supabase/migrations/*.sql in the serverless function
  // bundle for the migrations-health endpoint. Without this, Vercel's
  // automatic file-tracing infers code dependencies only and would exclude
  // the `supabase/` directory entirely, causing the endpoint to false-
  // positive every disk file as drift. The defensive
  // `MigrationsBundleConfigError` in lib/server/migrations/ledger-adapter.ts
  // is the safety net that turns a missed config entry into a loud
  // 500 + MIGRATIONS_BUNDLE_MISSING instead of a silent false alarm.
  // See ADR-017 §D5.
  outputFileTracingIncludes: {
    '/api/admin/migrations-health': ['./supabase/migrations/**/*.sql'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
