import type { Database } from '@/lib/server/supabase/database.types'

export type UserNotificationRow = Database['public']['Tables']['user_notifications']['Row']
