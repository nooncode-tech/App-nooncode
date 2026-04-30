import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPhase1APublicEnv } from '@/lib/env'
import type { Database } from '@/lib/server/supabase/database.types'

type DatabaseClient = SupabaseClient<Database>
type CookieToSet = { name: string; value: string; options: CookieOptions }

export async function createSupabaseServerClient(): Promise<DatabaseClient> {
  const env = getPhase1APublicEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // In read-only server contexts, cookie writes must happen in middleware or route handlers.
        }
      },
    },
  })
}
