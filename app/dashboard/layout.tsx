'use client'

import React from "react"

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getAuthorizedDashboardPath, useAuth } from '@/lib/auth-context'
import { DataProvider } from '@/lib/data-context'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import { MaxwellFab } from '@/components/maxwell-fab'
import dynamic from 'next/dynamic'

const CommandPalette = dynamic(
  () => import('@/components/command-palette').then((m) => m.CommandPalette),
  { ssr: false }
)

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const authorizedPath = user && pathname
    ? getAuthorizedDashboardPath(user.role, pathname)
    : null
  const isAuthorized = !!user && !!pathname && authorizedPath === pathname

  useEffect(() => {
    if (!user) {
      router.replace('/')
      return
    }

    if (pathname && authorizedPath && authorizedPath !== pathname) {
      router.replace(authorizedPath)
    }
  }, [authorizedPath, pathname, router, user])

  if (!user || !isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    )
  }

  return (
    <DataProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <div className="flex-1" />
            <CommandPalette />
            <Button
              variant="outline"
              size="sm"
              className="hidden md:flex items-center gap-2 text-muted-foreground text-xs h-8 px-3"
              onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
            >
              <Search className="size-3.5" />
              Buscar
              <kbd className="pointer-events-none ml-1 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                ⌘K
              </kbd>
            </Button>
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </SidebarInset>
        <MaxwellFab />
      </SidebarProvider>
    </DataProvider>
  )
}
