import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPhase1APublicEnv } from '@/lib/env'
import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>

let browserClient: DatabaseClient | null = null

export function createSupabaseBrowserClient(): DatabaseClient {
  const env = getPhase1APublicEnv()

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey)
  }

  return browserClient
}
