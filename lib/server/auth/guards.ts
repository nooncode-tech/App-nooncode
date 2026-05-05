import { isSupabaseAuthEnabled } from '@/lib/env'
import { canAccessDashboardPath } from '@/lib/server/auth/policy'
import {
  getCurrentPrincipal,
  getCurrentProfile,
  getCurrentSession,
} from '@/lib/server/auth/session'
import type {
  AppRole,
  AuthenticatedPrincipal,
  UserProfile,
} from '@/lib/server/profiles/types'
import type { Session } from '@supabase/supabase-js'

export type AuthGuardErrorCode =
  | 'AUTH_DISABLED'
  | 'UNAUTHENTICATED'
  | 'PROFILE_NOT_FOUND'
  | 'INACTIVE_PROFILE'
  | 'FORBIDDEN'

export class AuthGuardError extends Error {
  constructor(
    public readonly code: AuthGuardErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'AuthGuardError'
  }
}

function assertAuthEnabled() {
  if (!isSupabaseAuthEnabled()) {
    throw new AuthGuardError(
      'AUTH_DISABLED',
      'Supabase auth is disabled. Set NOON_ENABLE_SUPABASE_AUTH=true before using server auth guards.',
      503
    )
  }
}

export async function requireSession(): Promise<Session> {
  assertAuthEnabled()

  const session = await getCurrentSession()

  if (!session) {
    throw new AuthGuardError('UNAUTHENTICATED', 'An active session is required.', 401)
  }

  return session
}

export async function requireProfile(): Promise<UserProfile> {
  assertAuthEnabled()
  await requireSession()

  const profile = await getCurrentProfile()

  if (!profile) {
    throw new AuthGuardError(
      'PROFILE_NOT_FOUND',
      'A user profile row is required for authenticated access.',
      403
    )
  }

  if (!profile.is_active) {
    throw new AuthGuardError(
      'INACTIVE_PROFILE',
      'This user profile is inactive.',
      403
    )
  }

  return profile
}

export async function requirePrincipal(): Promise<AuthenticatedPrincipal> {
  assertAuthEnabled()
  await requireSession()

  const principal = await getCurrentPrincipal()

  if (!principal) {
    throw new AuthGuardError(
      'PROFILE_NOT_FOUND',
      'A user profile row is required for authenticated access.',
      403
    )
  }

  if (!principal.profile.is_active) {
    throw new AuthGuardError(
      'INACTIVE_PROFILE',
      'This user profile is inactive.',
      403
    )
  }

  return principal
}

export async function requireRole(
  allowedRoles: readonly AppRole[]
): Promise<AuthenticatedPrincipal> {
  const principal = await requirePrincipal()

  if (!allowedRoles.includes(principal.role)) {
    throw new AuthGuardError(
      'FORBIDDEN',
      'The authenticated user does not have the required role.',
      403
    )
  }

  return principal
}

export async function requireDashboardAccess(
  pathname: string
): Promise<AuthenticatedPrincipal> {
  const principal = await requirePrincipal()

  if (!canAccessDashboardPath(principal.role, pathname)) {
    throw new AuthGuardError(
      'FORBIDDEN',
      'The authenticated user cannot access this dashboard route.',
      403
    )
  }

  return principal
}
