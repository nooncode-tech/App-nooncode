import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { getPhase1AAdminEnv } from '../lib/env'
import { mockUsers } from '../lib/mock-data'
import type { Database } from '../lib/server/supabase/database.types'

loadEnvConfig(process.cwd())

async function seedPhase1AUsers() {
  const env = getPhase1AAdminEnv()

  if (!env.seedDefaultPassword) {
    throw new Error(
      'NOON_SEED_DEFAULT_PASSWORD is required to seed Phase 1A auth users.'
    )
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
    throw new Error(`Failed to list existing auth users: ${listError.message}`)
  }

  const existingUsersByEmail = new Map(
    listedUsers.users
      .filter((candidate) => candidate.email)
      .map((candidate) => [candidate.email!.toLowerCase(), candidate])
  )

  for (const mockUser of mockUsers) {
    const normalizedEmail = mockUser.email.toLowerCase()
    let authUser = existingUsersByEmail.get(normalizedEmail) ?? null

    if (!authUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password: env.seedDefaultPassword,
        email_confirm: true,
      })

      if (error || !data.user) {
        throw new Error(
          `Failed to create auth user for ${normalizedEmail}: ${error?.message ?? 'No user returned.'}`
        )
      }

      authUser = data.user
      existingUsersByEmail.set(normalizedEmail, authUser)
    }

    const { error: profileError } = await admin.from('user_profiles').upsert({
      id: authUser.id,
      email: normalizedEmail,
      full_name: mockUser.name,
      role: mockUser.role,
      is_active: true,
      legacy_mock_id: mockUser.id,
    })

    if (profileError) {
      throw new Error(
        `Failed to upsert user profile for ${normalizedEmail}: ${profileError.message}`
      )
    }
  }

  console.log(`Seeded ${mockUsers.length} Phase 1A auth users and profiles.`)
}

seedPhase1AUsers().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown seed failure'
  console.error(message)
  process.exitCode = 1
})
