import type { User } from '@/lib/types'
import type { UserProfile } from '@/lib/server/profiles/types'

export type AuthMode = 'mock' | 'supabase'

export function mapProfileToClientUser(profile: UserProfile): User {
  return {
    id: profile.legacy_mock_id ?? profile.id,
    email: profile.email,
    name: profile.full_name,
    role: profile.role,
    avatar: profile.avatar_url ?? undefined,
    createdAt: new Date(profile.created_at),
    points: 0,
    balance: 0,
  }
}
