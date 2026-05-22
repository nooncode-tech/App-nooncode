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
  // DIAGNOSTIC 2026-05-22: outputFileTracingIncludes temporarily disabled on
  // this branch to test if it triggers the Vercel modifyConfig "path argument
  // undefined" error. If build passes without it, this is the culprit and
  // needs an alternative syntax. MUST be restored before merge to develop.
  // See ADR-017 §D5.
  // outputFileTracingIncludes: {
  //   '/api/admin/migrations-health': ['./supabase/migrations/**/*.sql'],
  // },
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
