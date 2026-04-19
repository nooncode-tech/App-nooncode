import { z } from 'zod'

function normalizeOptionalEnvString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const phase1AEnvSchema = z.object({
  NOON_ENABLE_SUPABASE_AUTH: z.enum(['true', 'false']).optional().default('false'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NOON_SEED_DEFAULT_PASSWORD: z.string().min(12).optional(),
})

type Phase1ARawEnv = z.infer<typeof phase1AEnvSchema>

export interface Phase1APublicEnv {
  authEnabled: boolean
  supabaseUrl: string
  supabaseAnonKey: string
}

export interface Phase1AAdminEnv extends Phase1APublicEnv {
  supabaseServiceRoleKey: string
  seedDefaultPassword: string | null
}

function readPhase1ARawEnv(): Phase1ARawEnv {
  return phase1AEnvSchema.parse({
    NOON_ENABLE_SUPABASE_AUTH:
      normalizeOptionalEnvString(process.env.NOON_ENABLE_SUPABASE_AUTH) ?? 'false',
    NEXT_PUBLIC_SUPABASE_URL: normalizeOptionalEnvString(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: normalizeOptionalEnvString(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: normalizeOptionalEnvString(process.env.SUPABASE_SERVICE_ROLE_KEY),
    NOON_SEED_DEFAULT_PASSWORD: normalizeOptionalEnvString(process.env.NOON_SEED_DEFAULT_PASSWORD),
  })
}

export function isSupabaseAuthEnabled(): boolean {
  return readPhase1ARawEnv().NOON_ENABLE_SUPABASE_AUTH === 'true'
}

export function hasSupabasePublicEnv(): boolean {
  const env = readPhase1ARawEnv()

  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export function getPhase1APublicEnv(): Phase1APublicEnv {
  const env = readPhase1ARawEnv()

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      'Phase 1A Supabase public env is incomplete. Expected NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }

  return {
    authEnabled: env.NOON_ENABLE_SUPABASE_AUTH === 'true',
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
}

export function hasSupabaseAdminEnv(): boolean {
  const env = readPhase1ARawEnv()

  return hasSupabasePublicEnv() && Boolean(env.SUPABASE_SERVICE_ROLE_KEY)
}

export function getPhase1AAdminEnv(): Phase1AAdminEnv {
  const publicEnv = getPhase1APublicEnv()
  const env = readPhase1ARawEnv()

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Phase 1A Supabase admin env is incomplete. Expected SUPABASE_SERVICE_ROLE_KEY.'
    )
  }

  return {
    ...publicEnv,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    seedDefaultPassword: env.NOON_SEED_DEFAULT_PASSWORD ?? null,
  }
}
