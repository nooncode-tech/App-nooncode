import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPhase1APublicEnv } from '@/lib/env'
import type { Database } from '@/lib/server/supabase/database.types'

export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const env = getPhase1APublicEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // In read-only server contexts, cookie writes must happen in middleware or route handlers.
        }
      },
    },
  })
}
