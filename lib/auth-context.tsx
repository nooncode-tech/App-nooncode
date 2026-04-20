'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  startTransition,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/server/supabase/browser'
import type { AuthMode } from '@/lib/auth-user'
import type { User, UserRole } from './types'
import { mockUsers } from './mock-data'

interface AuthContextType {
  authMode: AuthMode
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  switchRole: (role: UserRole) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

type DashboardAccessLevel = 'authenticated' | 'sales' | 'projects' | 'delivery' | 'admin'

interface DashboardRouteAccessRule {
  prefix: string
  access: DashboardAccessLevel
}

const dashboardRouteAccessRules: DashboardRouteAccessRule[] = [
  { prefix: '/dashboard/settings', access: 'authenticated' },
  { prefix: '/dashboard/leads', access: 'sales' },
  { prefix: '/dashboard/pipeline', access: 'sales' },
  { prefix: '/dashboard/prototypes', access: 'sales' },
  { prefix: '/dashboard/web-analysis', access: 'sales' },
  { prefix: '/dashboard/projects', access: 'projects' },
  { prefix: '/dashboard/tasks', access: 'delivery' },
]

function normalizeDashboardPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }

  return pathname
}

function matchesDashboardPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

interface AuthProviderProps {
  authMode: AuthMode
  initialUser: User | null
  children: ReactNode
}

export function AuthProvider({ authMode, initialUser, children }: AuthProviderProps) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(initialUser)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    setUser(initialUser)
  }, [initialUser])

  useEffect(() => {
    if (authMode !== 'supabase') {
      return
    }

    const supabase = createSupabaseBrowserClient()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null)
      }

      if (event !== 'INITIAL_SESSION') {
        setIsLoading(false)
        startTransition(() => {
          router.refresh()
        })
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [authMode, router])

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true)

    try {
      if (authMode === 'supabase') {
        const supabase = createSupabaseBrowserClient()
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })

        if (error) {
          return false
        }

        startTransition(() => {
          router.refresh()
        })

        return true
      }

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 800))

      const foundUser = mockUsers.find(u => u.email.toLowerCase() === email.toLowerCase())

      if (foundUser) {
        setUser(foundUser)
        return true
      }

      return false
    } finally {
      setIsLoading(false)
    }
  }, [authMode, router])

  const logout = useCallback(async () => {
    if (authMode === 'supabase') {
      const supabase = createSupabaseBrowserClient()
      setUser(null)
      setIsLoading(true)
      try {
        await supabase.auth.signOut()
      } finally {
        setIsLoading(false)
        startTransition(() => {
          router.refresh()
        })
      }
      return
    }

    setUser(null)
  }, [authMode, router])

  const switchRole = useCallback((role: UserRole) => {
    if (authMode === 'supabase') {
      return
    }

    const userWithRole = mockUsers.find(u => u.role === role)
    if (userWithRole) {
      setUser(userWithRole)
    }
  }, [authMode])

  return (
    <AuthContext.Provider value={{ authMode, user, isLoading, login, logout, switchRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Role-based access helpers
export function canAccessSales(role: UserRole): boolean {
  return ['admin', 'sales_manager', 'sales'].includes(role)
}

export function canAccessDelivery(role: UserRole): boolean {
  return ['admin', 'pm', 'developer'].includes(role)
}

export function canAccessProjects(role: UserRole): boolean {
  return ['admin', 'sales_manager', 'pm', 'developer'].includes(role)
}

export function canAccessAdmin(role: UserRole): boolean {
  return role === 'admin'
}

export function canManageTeam(role: UserRole): boolean {
  return ['admin', 'sales_manager', 'pm'].includes(role)
}

export function canViewAllStats(role: UserRole): boolean {
  return ['admin', 'sales_manager'].includes(role)
}

export function getDashboardAccessLevel(pathname: string): DashboardAccessLevel {
  const normalizedPath = normalizeDashboardPath(pathname)
  const matchedRule = dashboardRouteAccessRules.find((rule) =>
    matchesDashboardPrefix(normalizedPath, rule.prefix)
  )

  return matchedRule?.access ?? 'authenticated'
}

export function canAccessDashboardPath(role: UserRole, pathname: string): boolean {
  const accessLevel = getDashboardAccessLevel(pathname)

  if (accessLevel === 'sales') return canAccessSales(role)
  if (accessLevel === 'projects') return canAccessProjects(role)
  if (accessLevel === 'delivery') return canAccessDelivery(role)
  if (accessLevel === 'admin') return canAccessAdmin(role)

  return true
}

export function getAuthorizedDashboardPath(role: UserRole, pathname: string): string {
  if (canAccessDashboardPath(role, pathname)) {
    return normalizeDashboardPath(pathname)
  }

  return '/dashboard'
}

export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    admin: 'Administrador',
    sales_manager: 'Gerente de Ventas',
    sales: 'Vendedor',
    pm: 'Project Manager',
    developer: 'Desarrollador',
  }
  return labels[role]
}

export function getRoleColor(role: UserRole): string {
  const colors: Record<UserRole, string> = {
    admin: 'bg-chart-4 text-chart-4-foreground',
    sales_manager: 'bg-chart-1 text-primary-foreground',
    sales: 'bg-chart-2 text-primary-foreground',
    pm: 'bg-chart-3 text-primary-foreground',
    developer: 'bg-chart-5 text-primary-foreground',
  }
  return colors[role]
}
