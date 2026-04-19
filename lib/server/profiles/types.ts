import type { Database } from '@/lib/server/supabase/database.types'

export type AppRole = Database['public']['Enums']['user_role']
export type UserProfile = Database['public']['Tables']['user_profiles']['Row']
export type UserProfileInsert = Database['public']['Tables']['user_profiles']['Insert']
export type UserProfileUpdate = Database['public']['Tables']['user_profiles']['Update']

export type DeliveryDirectoryRole = Extract<AppRole, 'admin' | 'pm' | 'developer'>

export interface DeliveryUser {
  id: string
  profileId: string
  email: string
  name: string
  role: DeliveryDirectoryRole
  avatar?: string
  isActive: boolean
}

export interface AdminDirectoryUser {
  profileId: string
  legacyMockId: string | null
  email: string
  name: string
  role: AppRole
  avatar: string | null
  isActive: boolean
  createdAt: string
  lastLoginAt: string | null
}

export interface AuthenticatedPrincipal {
  userId: string
  email: string
  role: AppRole
  profile: UserProfile
}

export interface SeedProfileInput {
  email: string
  fullName: string
  role: AppRole
  legacyMockId: string
}
