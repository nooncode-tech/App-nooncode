'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Sun,
  Activity,
  Bell,
  Blocks,
  LayoutDashboard,
  Users,
  Kanban,
  FolderKanban,
  ListTodo,
  DollarSign,
  Wallet,
  Gift,
  Settings,
  LogOut,
  ChevronDown,
  BarChart3,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  useAuth,
  canAccessSales,
  canAccessDashboardPath,
  canAccessAdmin,
  getRoleLabel,
} from '@/lib/auth-context'
import { selectPersonalStatsAvailability } from '@/lib/dashboard-selectors'
import { NOTIFICATIONS_UPDATED_EVENT } from '@/lib/notifications/client-events'
import { useRouter } from 'next/navigation'

const salesNavItems = [
  { title: 'Leads', href: '/dashboard/leads', icon: Users },
  { title: 'Pipeline', href: '/dashboard/pipeline', icon: Kanban },
  { title: 'Prototipos', href: '/dashboard/prototypes', icon: Blocks },
]

const deliveryNavItems = [
  { title: 'Proyectos', href: '/dashboard/projects', icon: FolderKanban },
  { title: 'Mis Tareas', href: '/dashboard/tasks', icon: ListTodo },
]

const workspaceNavItems = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { title: 'Actualizaciones', href: '/dashboard/updates', icon: Activity },
  { title: 'Notificaciones', href: '/dashboard/notifications', icon: Bell },
]

const financeNavItems = [
  { title: 'Creditos', href: '/dashboard/credits', icon: Wallet },
  { title: 'Earnings', href: '/dashboard/earnings', icon: DollarSign },
  { title: 'Recompensas', href: '/dashboard/rewards', icon: Gift },
  { title: 'Reportes', href: '/dashboard/reports', icon: BarChart3 },
]

const adminNavItems = [
  { title: 'Configuracion', href: '/dashboard/settings', icon: Settings },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { authMode, user, logout } = useAuth()
  const router = useRouter()
  const [unreadNotifications, setUnreadNotifications] = useState(0)

  useEffect(() => {
    let isActive = true

    if (authMode !== 'supabase' || !user) {
      setUnreadNotifications(0)
      return () => {
        isActive = false
      }
    }

    const loadUnreadNotifications = () => {
      fetch('/api/notifications?limit=1', {
        method: 'GET',
        cache: 'no-store',
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null)

          if (!response.ok) {
            throw new Error(
              payload && typeof payload.error === 'string'
                ? payload.error
                : 'No se pudo cargar el contador de notificaciones.'
            )
          }

          return payload as { meta?: { unreadCount?: number } }
        })
        .then((payload) => {
          if (isActive) {
            setUnreadNotifications(payload.meta?.unreadCount ?? 0)
          }
        })
        .catch(() => {
          if (isActive) {
            setUnreadNotifications(0)
          }
        })
    }

    loadUnreadNotifications()

    const handleNotificationsUpdated = () => {
      loadUnreadNotifications()
    }

    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, handleNotificationsUpdated)

    return () => {
      isActive = false
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, handleNotificationsUpdated)
    }
  }, [authMode, user])

  if (!user) return null

  const personalStats = selectPersonalStatsAvailability(authMode, user)
  const deliveryItems = deliveryNavItems
    .filter((item) => canAccessDashboardPath(user.role, item.href))
    .map((item) => {
      if (item.href !== '/dashboard/tasks') {
        return item
      }

      const shouldShowTeamTasks = authMode === 'supabase' && user.role !== 'developer'

      return {
        ...item,
        title: shouldShowTeamTasks ? 'Tareas del equipo' : item.title,
      }
    })

  const handleLogout = async () => {
    await logout()
    router.push('/')
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center">
            <Sun className="size-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-sidebar-foreground">NoonApp</span>
        </Link>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        {/* Main Dashboard */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {workspaceNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href}>
                    <Link href={item.href}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.href === '/dashboard/notifications' && authMode === 'supabase' && unreadNotifications > 0 ? (
                    <SidebarMenuBadge>
                      {unreadNotifications > 99 ? '99+' : unreadNotifications}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Sales Section */}
        {canAccessSales(user.role) && (
          <SidebarGroup>
            <SidebarGroupLabel>Ventas</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {salesNavItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname === item.href}>
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Delivery Section */}
        {deliveryItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Delivery</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {deliveryItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname === item.href}>
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Finance Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Finanzas</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {financeNavItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href}>
                    <Link href={item.href}>
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Settings — visible to all */}
        <SidebarGroup>
          <SidebarGroupLabel>{canAccessAdmin(user.role) ? 'Admin' : 'Cuenta'}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === '/dashboard/settings'}>
                  <Link href="/dashboard/settings">
                    <Settings className="size-4" />
                    <span>Configuracion</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-sidebar-accent transition-colors text-left">
              <Avatar className="size-9">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
                <p className="text-xs text-sidebar-foreground/60 truncate">{getRoleLabel(user.role)}</p>
              </div>
              <ChevronDown className="size-4 text-sidebar-foreground/60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/earnings">
                <DollarSign className="size-4 mr-2" />
                {personalStats.sidebarBalanceLabel}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/rewards">
                <Gift className="size-4 mr-2" />
                {personalStats.sidebarPointsLabel}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="size-4 mr-2" />
              Cerrar sesion
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
