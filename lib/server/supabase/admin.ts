import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getPhase1AAdminEnv } from '@/lib/env'
import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>

export function createSupabaseAdminClient(): DatabaseClient {
  const env = getPhase1AAdminEnv()

  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
