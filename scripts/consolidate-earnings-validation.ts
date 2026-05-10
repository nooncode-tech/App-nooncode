// One-shot validation helper for FASE 2 browser validation 2026-05-10.
// Calls consolidateEarnings() — the same function the /api/admin/earnings/consolidate
// route calls — using the service-role client. Validates that the business logic
// + DB writes work end-to-end while the consolidate UI is still missing (F-V02).
//
// Usage:
//   corepack pnpm@9 dlx tsx scripts/consolidate-earnings-validation.ts

import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { consolidateEarnings } from '../lib/server/earnings/admin'

loadEnvConfig(process.cwd())

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
}

const TARGET_EMAIL = 'juan@noon.app'
const ACTOR_EMAIL = 'admin@noon.app'
const AMOUNT_USD = 5

async function main() {
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listErr) throw new Error(`listUsers: ${listErr.message}`)

  const target = listed.users.find((u) => u.email?.toLowerCase() === TARGET_EMAIL)
  const actor = listed.users.find((u) => u.email?.toLowerCase() === ACTOR_EMAIL)

  if (!target) throw new Error(`Target user ${TARGET_EMAIL} not found`)
  if (!actor) throw new Error(`Actor user ${ACTOR_EMAIL} not found`)

  console.log(`target: ${TARGET_EMAIL} (${target.id})`)
  console.log(`actor:  ${ACTOR_EMAIL} (${actor.id})`)

  const { data: walletBefore, error: readErr } = (await admin
    .from('wallet_accounts' as never)
    .select('pending, available_to_withdraw')
    .eq('profile_id', target.id)
    .single()) as { data: { pending: number; available_to_withdraw: number } | null; error: unknown }

  if (readErr || !walletBefore) throw new Error(`Read wallet before: ${(readErr as Error)?.message ?? 'no data'}`)

  console.log(`before: pending=$${Number(walletBefore.pending).toFixed(2)}  available_to_withdraw=$${Number(walletBefore.available_to_withdraw).toFixed(2)}`)

  if (Number(walletBefore.pending) < AMOUNT_USD) {
    throw new Error(`INSUFFICIENT_PENDING: juan has $${Number(walletBefore.pending).toFixed(2)} pending, cannot consolidate $${AMOUNT_USD}`)
  }

  await consolidateEarnings(admin, {
    targetProfileId: target.id,
    amount: AMOUNT_USD,
    actorProfileId: actor.id,
  })

  const { data: walletAfter, error: readErr2 } = (await admin
    .from('wallet_accounts' as never)
    .select('pending, available_to_withdraw')
    .eq('profile_id', target.id)
    .single()) as { data: { pending: number; available_to_withdraw: number } | null; error: unknown }

  if (readErr2 || !walletAfter) throw new Error(`Read wallet after: ${(readErr2 as Error)?.message ?? 'no data'}`)

  console.log(`after:  pending=$${Number(walletAfter.pending).toFixed(2)}  available_to_withdraw=$${Number(walletAfter.available_to_withdraw).toFixed(2)}`)
  console.log(`delta:  pending=${(Number(walletAfter.pending) - Number(walletBefore.pending)).toFixed(2)}  available_to_withdraw=+${(Number(walletAfter.available_to_withdraw) - Number(walletBefore.available_to_withdraw)).toFixed(2)}`)
  console.log(`✓ consolidated $${AMOUNT_USD} pending → available_to_withdraw for ${TARGET_EMAIL}`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
