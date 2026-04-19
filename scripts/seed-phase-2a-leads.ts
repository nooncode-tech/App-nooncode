import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { getPhase1AAdminEnv } from '../lib/env'
import { mockLeads } from '../lib/mock-data'
import type { Database } from '../lib/server/supabase/database.types'

loadEnvConfig(process.cwd())

async function seedPhase2ALeads() {
  const env = getPhase1AAdminEnv()

  const admin = createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  const { data: profiles, error: profilesError } = await admin
    .from('user_profiles')
    .select('id, legacy_mock_id, role')

  if (profilesError) {
    throw new Error(`Failed to load user profiles: ${profilesError.message}`)
  }

  const profilesByLegacyId = new Map(
    (profiles ?? [])
      .filter((profile) => profile.legacy_mock_id)
      .map((profile) => [profile.legacy_mock_id!, profile])
  )

  const fallbackOwner =
    profilesByLegacyId.get('3') ??
    (profiles ?? []).find((profile) =>
      ['admin', 'sales_manager', 'sales'].includes(profile.role)
    ) ??
    null

  if (!fallbackOwner) {
    throw new Error(
      'No eligible user_profiles rows found for seeding leads. Seed Phase 1A users first.'
    )
  }

  for (const mockLead of mockLeads) {
    const assignedProfile =
      (mockLead.assignedTo ? profilesByLegacyId.get(mockLead.assignedTo) : null) ?? fallbackOwner

    const { error } = await admin.from('leads').upsert(
      {
        legacy_mock_id: mockLead.id,
        name: mockLead.name,
        email: mockLead.email.toLowerCase(),
        phone: mockLead.phone ?? null,
        company: mockLead.company ?? null,
        source: mockLead.source,
        status: mockLead.status,
        score: mockLead.score,
        value: mockLead.value,
        assigned_to: assignedProfile.id,
        created_by: assignedProfile.id,
        notes: mockLead.notes ?? null,
        tags: mockLead.tags,
        last_contacted_at: mockLead.lastContactedAt?.toISOString() ?? null,
        created_at: mockLead.createdAt.toISOString(),
        updated_at: mockLead.updatedAt.toISOString(),
      },
      { onConflict: 'legacy_mock_id' }
    )

    if (error) {
      throw new Error(
        `Failed to upsert lead ${mockLead.email.toLowerCase()}: ${error.message}`
      )
    }
  }

  console.log(`Seeded ${mockLeads.length} Phase 2A leads.`)
}

seedPhase2ALeads().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown lead seed failure'
  console.error(message)
  process.exitCode = 1
})
