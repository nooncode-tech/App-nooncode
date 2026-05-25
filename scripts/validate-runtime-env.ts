import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

type EnvState = 'present' | 'missing'
type StripeMode = 'live' | 'test' | 'unknown' | 'missing'

const coreKeys = [
  'NOON_ENABLE_SUPABASE_AUTH',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'OPENAI_API_KEY',
  'V0_API_KEY',
] as const

const integrationKeys = [
  'NOON_WEBSITE_WEBHOOK_SECRET',
  'NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL',
  'CRON_SECRET',
] as const

// The rate limiter accepts either naming convention Vercel uses for the
// Upstash-backed Redis integration. UPSTASH_* is preferred; KV_REST_API_* is
// the same backend exposed under Vercel's KV product branding.
const distributedRateLimitKeyPairs = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
] as const

function presence(key: string): EnvState {
  return process.env[key]?.trim() ? 'present' : 'missing'
}

function stripeMode(value: string | undefined, livePrefix: string, testPrefix: string): StripeMode {
  const normalized = value?.trim()
  if (!normalized) return 'missing'
  if (normalized.startsWith(livePrefix)) return 'live'
  if (normalized.startsWith(testPrefix)) return 'test'
  return 'unknown'
}

const secretMode = stripeMode(process.env.STRIPE_SECRET_KEY, 'sk_live', 'sk_test')
const publishableMode = stripeMode(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  'pk_live',
  'pk_test'
)
const failures: string[] = []
const warnings: string[] = []

for (const key of coreKeys) {
  if (presence(key) === 'missing') {
    failures.push(`${key}: missing`)
  }
}

if (secretMode === 'unknown') {
  failures.push('STRIPE_SECRET_KEY: unknown mode')
}

if (publishableMode === 'unknown') {
  failures.push('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: unknown mode')
}

if (
  secretMode !== 'missing'
  && publishableMode !== 'missing'
  && secretMode !== 'unknown'
  && publishableMode !== 'unknown'
  && secretMode !== publishableMode
) {
  failures.push('Stripe secret and publishable keys use different modes')
}

for (const key of integrationKeys) {
  if (presence(key) === 'missing') {
    warnings.push(`${key}: missing; related integration smoke tests are blocked`)
  }
}

const distributedRateLimitConfigured = distributedRateLimitKeyPairs.some(
  ([urlKey, tokenKey]) => presence(urlKey) === 'present' && presence(tokenKey) === 'present'
)
if (!distributedRateLimitConfigured && process.env.NODE_ENV === 'production') {
  warnings.push(
    'Distributed rate limiter not configured (neither UPSTASH_REDIS_REST_URL/_TOKEN nor KV_REST_API_URL/_TOKEN are set); falling back to in-memory per-process buckets — inconsistent across Fluid Compute instances. Provision the Upstash Redis or Vercel KV integration via Vercel Marketplace.'
  )
}

if (secretMode === 'live' || publishableMode === 'live') {
  warnings.push('Stripe is configured in live mode; do not create checkout/payment side effects without action-time approval')
}

console.log('Runtime environment check')
console.log('Core keys:')
for (const key of coreKeys) {
  console.log(`- ${key}: ${presence(key)}`)
}

console.log('Stripe modes:')
console.log(`- STRIPE_SECRET_KEY: ${secretMode}`)
console.log(`- NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ${publishableMode}`)

console.log('Integration keys:')
for (const key of integrationKeys) {
  console.log(`- ${key}: ${presence(key)}`)
}

console.log('Distributed rate limiter (Upstash via Vercel Marketplace):')
for (const [urlKey, tokenKey] of distributedRateLimitKeyPairs) {
  console.log(`- ${urlKey}: ${presence(urlKey)}`)
  console.log(`- ${tokenKey}: ${presence(tokenKey)}`)
}
console.log(`- configured: ${distributedRateLimitConfigured ? 'yes' : 'no (using in-memory fallback)'}`)

if (warnings.length > 0) {
  console.warn('\nWarnings:')
  for (const warning of warnings) {
    console.warn(`- ${warning}`)
  }
}

if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exitCode = 1
}
