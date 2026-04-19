import type { AppRole } from '@/lib/server/profiles/types'

export type DashboardAccessLevel = 'authenticated' | 'sales' | 'projects' | 'delivery' | 'admin'

export interface DashboardRouteAccessRule {
  prefix: string
  access: DashboardAccessLevel
}

export const salesRoles: AppRole[] = ['admin', 'sales_manager', 'sales']
export const projectReadRoles: AppRole[] = ['admin', 'sales_manager', 'pm', 'developer']
export const deliveryRoles: AppRole[] = ['admin', 'pm', 'developer']
export const adminRoles: AppRole[] = ['admin']
export const teamManagerRoles: AppRole[] = ['admin', 'sales_manager', 'pm']
export const fullStatsRoles: AppRole[] = ['admin', 'sales_manager']

export const dashboardRouteAccessRules: DashboardRouteAccessRule[] = [
  { prefix: '/dashboard/settings', access: 'authenticated' },
  { prefix: '/dashboard/leads', access: 'sales' },
  { prefix: '/dashboard/pipeline', access: 'sales' },
  { prefix: '/dashboard/prototypes', access: 'sales' },
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

export function isProtectedDashboardPath(pathname: string): boolean {
  const normalizedPath = normalizeDashboardPath(pathname)

  return matchesDashboardPrefix(normalizedPath, '/dashboard')
}

export function canAccessSales(role: AppRole): boolean {
  return salesRoles.includes(role)
}

export function canAccessDelivery(role: AppRole): boolean {
  return deliveryRoles.includes(role)
}

export function canAccessProjects(role: AppRole): boolean {
  return projectReadRoles.includes(role)
}

export function canAccessAdmin(role: AppRole): boolean {
  return adminRoles.includes(role)
}

export function canManageTeam(role: AppRole): boolean {
  return teamManagerRoles.includes(role)
}

export function canViewAllStats(role: AppRole): boolean {
  return fullStatsRoles.includes(role)
}

export function getDashboardAccessLevel(pathname: string): DashboardAccessLevel {
  const normalizedPath = normalizeDashboardPath(pathname)
  const matchedRule = dashboardRouteAccessRules.find((rule) =>
    matchesDashboardPrefix(normalizedPath, rule.prefix)
  )

  return matchedRule?.access ?? 'authenticated'
}

export function canAccessDashboardPath(role: AppRole, pathname: string): boolean {
  const accessLevel = getDashboardAccessLevel(pathname)

  if (accessLevel === 'sales') return canAccessSales(role)
  if (accessLevel === 'projects') return canAccessProjects(role)
  if (accessLevel === 'delivery') return canAccessDelivery(role)
  if (accessLevel === 'admin') return canAccessAdmin(role)

  return true
}

export function getAuthorizedDashboardPath(role: AppRole, pathname: string): string {
  if (canAccessDashboardPath(role, pathname)) {
    return normalizeDashboardPath(pathname)
  }

  return '/dashboard'
}
