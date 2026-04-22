import type { Session, User } from '@supabase/supabase-js'
import { hasSupabasePublicEnv, isSupabaseAuthEnabled } from '@/lib/env'
import {
  getUserProfileById,
  touchUserLastLogin,
} from '@/lib/server/profiles/repository'
import type {
  AuthenticatedPrincipal,
  UserProfile,
} from '@/lib/server/profiles/types'
import { createSupabaseServerClient } from '@/lib/server/supabase/server'

async function getServerClientOrNull() {
  if (!isSupabaseAuthEnabled() || !hasSupabasePublicEnv()) {
    return null
  }

  return createSupabaseServerClient()
}

function isRecoverableSessionError(error: { message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase()

  if (!message) {
    return false
  }

  return (
    message.includes('auth session missing') ||
    message.includes('session missing') ||
    message.includes('invalid jwt') ||
    message.includes('token is expired') ||
    message.includes('jwt expired') ||
    message.includes('unable to parse or verify signature') ||
    message.includes('refresh token not found') ||
    message.includes('invalid refresh token')
  )
}

export async function getCurrentSession(): Promise<Session | null> {
  const client = await getServerClientOrNull()

  if (!client) {
    return null
  }

  const {
    data: { session },
    error,
  } = await client.auth.getSession()

  if (error && !isRecoverableSessionError(error)) {
    throw new Error(`Failed to resolve current session: ${error.message}`)
  }

  return session
}

export async function getCurrentUser(): Promise<User | null> {
  const client = await getServerClientOrNull()

  if (!client) {
    return null
  }

  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error && !isRecoverableSessionError(error)) {
    throw new Error(`Failed to resolve current user: ${error.message}`)
  }

  return user
}

export async function getCurrentProfile(): Promise<UserProfile | null> {
  const client = await getServerClientOrNull()

  if (!client) {
    return null
  }

  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error && !isRecoverableSessionError(error)) {
    throw new Error(`Failed to resolve current profile user: ${error.message}`)
  }

  if (!user) {
    return null
  }

  return getUserProfileById(client, user.id)
}

export async function getCurrentPrincipal(): Promise<AuthenticatedPrincipal | null> {
  const client = await getServerClientOrNull()

  if (!client) {
    return null
  }

  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error && !isRecoverableSessionError(error)) {
    throw new Error(`Failed to resolve current principal user: ${error.message}`)
  }

  if (!user) {
    return null
  }

  const profile = await getUserProfileById(client, user.id)

  if (!profile) {
    return null
  }

  return {
    userId: user.id,
    email: profile.email,
    role: profile.role,
    profile,
  }
}

export async function markCurrentUserLogin(at: Date = new Date()): Promise<void> {
  const client = await getServerClientOrNull()

  if (!client) {
    return
  }

  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error && !isRecoverableSessionError(error)) {
    throw new Error(`Failed to resolve login timestamp target user: ${error.message}`)
  }

  if (!user) {
    return
  }

  // Phase 1A allows only a narrow self-update path for login timestamp tracking.
  await touchUserLastLogin(client, user.id, at)
}
