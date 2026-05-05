import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { getPhase1AAdminEnv } from '../lib/env'
import { mockUsers } from '../lib/mock-data'
import type { Database } from '../lib/server/supabase/database.types'

loadEnvConfig(process.cwd())

async function resetPasswords() {
  const env = getPhase1AAdminEnv()

  if (!env.seedDefaultPassword) {
    throw new Error('NOON_SEED_DEFAULT_PASSWORD is required.')
  }

  const admin = createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })

  if (listError) {
    throw new Error(`Failed to list auth users: ${listError.message}`)
  }

  const existingUsersByEmail = new Map(
    listedUsers.users
      .filter((u) => u.email)
      .map((u) => [u.email!.toLowerCase(), u])
  )

  let updated = 0
  let notFound = 0

  for (const mockUser of mockUsers) {
    const normalizedEmail = mockUser.email.toLowerCase()
    const existing = existingUsersByEmail.get(normalizedEmail)

    if (!existing) {
      console.warn(`User not found, skipping: ${normalizedEmail}`)
      notFound++
      continue
    }

    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: env.seedDefaultPassword,
    })

    if (error) {
      throw new Error(`Failed to reset password for ${normalizedEmail}: ${error.message}`)
    }

    console.log(`Reset password: ${normalizedEmail}`)
    updated++
  }

  console.log(`\nDone. Updated: ${updated}, Not found: ${notFound}`)
}

resetPasswords().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown failure'
  console.error(message)
  process.exitCode = 1
})
