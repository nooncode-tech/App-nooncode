'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
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
  Globe,
  Zap,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
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
import type { LucideIcon } from 'lucide-react'

const salesNavItems = [
  { title: 'Leads', href: '/dashboard/leads', icon: Users },
  { title: 'Pipeline', href: '/dashboard/pipeline', icon: Kanban },
  { title: 'Prototipos', href: '/dashboard/prototypes', icon: Blocks },
  { title: 'Análisis Web', href: '/dashboard/web-analysis', icon: Globe },
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

type NavItem = { title: string; href: string; icon: LucideIcon; badge?: number }

function NavGroup({
  label,
  color,
  items,
  pathname,
  badgeMap,
}: {
  label?: string
  color?: string
  items: NavItem[]
  pathname: string
  badgeMap?: Record<string, number>
}) {
  return (
    <div className="px-3 mb-1 group-data-[collapsible=icon]:px-1.5">
      {label && (
        <div className="flex items-center gap-2 mb-1 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          {color && <span className="size-1.5 rounded-full shrink-0" style={{ background: color }} />}
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">
            {label}
          </span>
        </div>
      )}
      <div className="space-y-0.5">
        {items.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)
          const badge = badgeMap?.[item.href]
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.title}
              className={[
                'group/link flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 relative',
                'group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-0 group-data-[collapsible=icon]:justify-center',
                isActive
                  ? 'bg-white/[0.09] text-white'
                  : 'text-white/45 hover:text-white/80 hover:bg-white/[0.05]',
              ].join(' ')}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-full group-data-[collapsible=icon]:hidden" />
              )}
              <item.icon
                className={[
                  'size-4 shrink-0 transition-colors',
                  isActive ? 'text-white' : 'text-white/35 group-hover/link:text-white/60',
                ].join(' ')}
              />
              <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">{item.title}</span>
              {badge != null && badge > 0 && (
                <span className="ml-auto text-[10px] font-semibold bg-primary/80 text-white px-1.5 py-0.5 rounded-full leading-none tabular-nums group-data-[collapsible=icon]:hidden">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function AppSidebar() {
  const pathname = usePathname()
  const { authMode, user, logout } = useAuth()
  const router = useRouter()
  const [unreadNotifications, setUnreadNotifications] = useState(0)

  // Reset sidebar scroll to top on every route change so top items are always visible
  useEffect(() => {
    const el = document.querySelector('[data-sidebar="content"]') as HTMLElement | null
    if (el) el.scrollTop = 0
  }, [pathname])

  useEffect(() => {
    let isActive = true

    if (authMode !== 'supabase' || !user) {
      setUnreadNotifications(0)
      return () => { isActive = false }
    }

    const load = () => {
      fetch('/api/notifications?limit=1', { cache: 'no-store' })
        .then(async (r) => {
          const p = await r.json().catch(() => null)
          if (!r.ok) throw new Error()
          return p as { meta?: { unreadCount?: number } }
        })
        .then((p) => { if (isActive) setUnreadNotifications(p.meta?.unreadCount ?? 0) })
        .catch(() => { if (isActive) setUnreadNotifications(0) })
    }

    load()
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, load)
    return () => { isActive = false; window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, load) }
  }, [authMode, user])

  if (!user) return null

  const personalStats = selectPersonalStatsAvailability(authMode, user)
  const deliveryItems = deliveryNavItems
    .filter((item) => canAccessDashboardPath(user.role, item.href))
    .map((item) => {
      if (item.href !== '/dashboard/tasks') return item
      const shouldShowTeam = authMode === 'supabase' && user.role !== 'developer'
      return { ...item, title: shouldShowTeam ? 'Tareas del equipo' : item.title }
    })

  const handleLogout = async () => {
    await logout()
    router.push('/')
  }

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)

  const badgeMap: Record<string, number> = {
    '/dashboard/notifications': unreadNotifications,
  }

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      {/* ── Wordmark + Toggle ── */}
      <SidebarHeader className="px-4 pt-4 pb-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:items-center">
        {/* Expanded: logo left + trigger right */}
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
          <Link href="/dashboard" className="flex items-center gap-3 flex-1 min-w-0">
            <div className="size-8 rounded-lg bg-primary flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(18,0,197,0.4)] hover:shadow-[0_0_16px_rgba(18,0,197,0.7)] transition-shadow">
              <span className="text-[13px] font-black text-white tracking-tighter leading-none">N</span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[17px] font-black tracking-[-0.04em] text-white">noon</span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/25 mt-0.5">platform</span>
            </div>
          </Link>
          <SidebarTrigger className="shrink-0 text-white/20 hover:text-white/50 hover:bg-white/[0.05] size-7 [&>svg]:size-3.5" />
        </div>
        {/* Collapsed: logo + trigger stacked */}
        <div className="hidden group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-2">
          <Link href="/dashboard" className="size-8 rounded-lg bg-primary flex items-center justify-center shadow-[0_0_12px_rgba(18,0,197,0.4)] hover:shadow-[0_0_16px_rgba(18,0,197,0.7)] transition-shadow">
            <span className="text-[13px] font-black text-white tracking-tighter leading-none">N</span>
          </Link>
          <SidebarTrigger className="text-white/25 hover:text-white/60 hover:bg-white/[0.07] size-7 [&>svg]:size-3.5" />
        </div>
      </SidebarHeader>

      {/* ── Navigation ── */}
      <SidebarContent className="pt-1 gap-0">
        <NavGroup items={workspaceNavItems} pathname={pathname} badgeMap={badgeMap} />

        {canAccessSales(user.role) && (
          <NavGroup label="Ventas" color="#1200c5" items={salesNavItems} pathname={pathname} />
        )}

        {deliveryItems.length > 0 && (
          <NavGroup label="Delivery" color="oklch(0.50 0.26 264)" items={deliveryItems} pathname={pathname} />
        )}

        <NavGroup label="Finanzas" color="#22c55e" items={financeNavItems} pathname={pathname} />

        <NavGroup
          label={canAccessAdmin(user.role) ? 'Admin' : 'Cuenta'}
          color="oklch(0.45 0.02 275)"
          items={[{ title: 'Configuracion', href: '/dashboard/settings', icon: Settings }]}
          pathname={pathname}
        />
      </SidebarContent>

      {/* ── User footer ── */}
      <SidebarFooter className="p-3 border-t border-white/[0.06]">
        {/* Balance strip — hidden when collapsed */}
        <div className="flex items-center gap-2 px-2 py-2 mb-1 group-data-[collapsible=icon]:hidden">
          <Zap className="size-3.5 text-white/20 shrink-0" />
          <span className="text-[11px] text-white/30 flex-1 tabular-nums truncate">
            {personalStats.balanceValueLabel}
          </span>
          <span className="text-[10px] text-white/20 font-medium uppercase tracking-wide">balance</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 w-full p-2 rounded-lg hover:bg-white/[0.06] transition-colors text-left group group-data-[collapsible=icon]:justify-center">
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="bg-primary/80 text-white text-[11px] font-bold">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-[13px] font-medium text-white/90 truncate leading-tight">{user.name}</p>
                <p className="text-[10px] text-white/30 truncate mt-0.5">{getRoleLabel(user.role)}</p>
              </div>
              <ChevronDown className="size-3.5 text-white/20 group-hover:text-white/40 transition-colors shrink-0 group-data-[collapsible=icon]:hidden" />
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
