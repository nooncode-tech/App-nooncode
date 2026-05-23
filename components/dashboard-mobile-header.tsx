'use client'

import Link from 'next/link'
import { SidebarTrigger } from '@/components/ui/sidebar'

export function DashboardMobileHeader() {
  return (
    <header
      className="md:hidden sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border/70 bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      data-slot="dashboard-mobile-header"
    >
      <SidebarTrigger
        aria-label="Abrir navegación"
        className="size-9 text-foreground/70 hover:text-foreground hover:bg-muted/40 [&>svg]:size-4"
      />
      <Link
        href="/dashboard"
        scroll={false}
        className="flex items-center gap-2 min-w-0"
      >
        <div className="size-6 rounded-md bg-primary flex items-center justify-center shrink-0">
          <span className="text-[11px] font-black text-white tracking-tighter leading-none">N</span>
        </div>
        <span className="text-sm font-semibold tracking-tight truncate">noon</span>
      </Link>
    </header>
  )
}
