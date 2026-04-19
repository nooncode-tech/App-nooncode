import type { SettingsUser } from '@/lib/types'

export interface AdminDirectoryUserWire {
  profileId: string
  legacyMockId: string | null
  email: string
  name: string
  role: SettingsUser['role']
  avatar: string | null
  isActive: boolean
  createdAt: string
  lastLoginAt: string | null
}

export function deserializeAdminDirectoryUser(user: AdminDirectoryUserWire): SettingsUser {
  return {
    profileId: user.profileId,
    legacyMockId: user.legacyMockId ?? undefined,
    email: user.email,
    name: user.name,
    role: user.role,
    avatar: user.avatar ?? undefined,
    isActive: user.isActive,
    createdAt: new Date(user.createdAt),
    lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : undefined,
  }
}
