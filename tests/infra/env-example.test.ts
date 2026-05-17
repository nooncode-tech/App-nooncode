import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const requiredExampleKeys = [
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
  'NOON_WEBSITE_WEBHOOK_SECRET',
  'NOON_WEBSITE_REVIEW_DECISION_WEBHOOK_URL',
  'CRON_SECRET',
  'EARNINGS_CONSOLIDATION_COOLING_DAYS',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
]

test('.env.example documents runtime validation keys', () => {
  const envExample = readFileSync('.env.example', 'utf8')

  for (const key of requiredExampleKeys) {
    assert.match(envExample, new RegExp(`^${key}=`, 'm'), `${key} is missing from .env.example`)
  }
})
